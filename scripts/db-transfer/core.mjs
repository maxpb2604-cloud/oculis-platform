/**
 * Logical, schema-aware transfer primitives used by the PGlite -> PostgreSQL
 * migration commands. The implementation deliberately discovers every public
 * base table instead of maintaining a fragile, hand-written table allow-list.
 */

const PUBLIC_SCHEMA = "public";
const MAINTENANCE_LOCK_KEY_1 = 1_329_774_051;
const MAINTENANCE_LOCK_KEY_2 = 2_026_092_801;

export class MigrationSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationSafetyError";
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function qualifiedName(tableName) {
  return `${quoteIdentifier(PUBLIC_SCHEMA)}.${quoteIdentifier(tableName)}`;
}

async function listTables(client) {
  const result = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [PUBLIC_SCHEMA],
  );
  return result.rows.map((row) => row.table_name);
}

async function listColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name,
            ordinal_position,
            data_type,
            udt_schema,
            udt_name,
            is_nullable,
            is_identity,
            identity_generation,
            is_generated,
            (column_default IS NOT NULL) AS has_default
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position`,
    [PUBLIC_SCHEMA, tableName],
  );
  return result.rows;
}

async function listForeignKeys(client, tables) {
  if (tables.length === 0) return [];
  const result = await client.query(
    `SELECT child.relname AS child_table,
            parent.relname AS parent_table
       FROM pg_constraint constraint_record
       JOIN pg_class child ON child.oid = constraint_record.conrelid
       JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
       JOIN pg_class parent ON parent.oid = constraint_record.confrelid
       JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      WHERE constraint_record.contype = 'f'
        AND child_ns.nspname = $1
        AND parent_ns.nspname = $1
      ORDER BY child.relname, parent.relname`,
    [PUBLIC_SCHEMA],
  );
  const tableSet = new Set(tables);
  return result.rows.filter(
    (row) => tableSet.has(row.child_table) && tableSet.has(row.parent_table),
  );
}

function stableColumnShape(column) {
  return {
    name: column.column_name,
    position: Number(column.ordinal_position),
    dataType: column.data_type,
    udtSchema: column.udt_schema,
    udtName: column.udt_name,
    nullable: column.is_nullable,
    identity: column.is_identity,
    identityGeneration: column.identity_generation,
    generated: column.is_generated,
    hasDefault: Boolean(column.has_default),
  };
}

function compareTableColumns(tableName, sourceColumns, destinationColumns) {
  const sourceShape = sourceColumns.map(stableColumnShape);
  const destinationShape = destinationColumns.map(stableColumnShape);
  if (JSON.stringify(sourceShape) !== JSON.stringify(destinationShape)) {
    throw new MigrationSafetyError(
      `Schema mismatch for ${tableName}. Source columns: ${JSON.stringify(sourceShape)}; ` +
        `destination columns: ${JSON.stringify(destinationShape)}. ` +
        "Apply the current Oculis schema to PostgreSQL before migrating.",
    );
  }
}

export async function inspectCompatibleSchema(source, destination) {
  const sourceTables = await listTables(source);
  if (sourceTables.length === 0) {
    throw new MigrationSafetyError("The PGlite source has no public base tables.");
  }

  const destinationTables = await listTables(destination);
  const destinationSet = new Set(destinationTables);
  const missingTables = sourceTables.filter((table) => !destinationSet.has(table));
  if (missingTables.length > 0) {
    throw new MigrationSafetyError(
      `PostgreSQL is missing ${missingTables.length} source table(s): ${missingTables.join(", ")}. ` +
        "Run the migration command with --bootstrap-schema, or bootstrap the current Oculis schema first.",
    );
  }

  const columnMap = new Map();
  for (const tableName of sourceTables) {
    const [sourceColumns, destinationColumns] = await Promise.all([
      listColumns(source, tableName),
      listColumns(destination, tableName),
    ]);
    compareTableColumns(tableName, sourceColumns, destinationColumns);
    columnMap.set(tableName, sourceColumns);
  }

  const foreignKeys = await listForeignKeys(source, sourceTables);
  return {
    tables: sourceTables,
    columns: columnMap,
    foreignKeys,
    extraDestinationTables: destinationTables.filter((table) => !sourceTables.includes(table)),
  };
}

export function orderTablesForCopy(tables, foreignKeys) {
  const parentsByChild = new Map(tables.map((table) => [table, new Set()]));
  const childrenByParent = new Map(tables.map((table) => [table, new Set()]));

  for (const foreignKey of foreignKeys) {
    const child = foreignKey.child_table;
    const parent = foreignKey.parent_table;
    if (child === parent) {
      throw new MigrationSafetyError(
        `Self-referential foreign key detected on ${child}. ` +
          "The automatic transfer refuses to guess a safe row order.",
      );
    }
    parentsByChild.get(child)?.add(parent);
    childrenByParent.get(parent)?.add(child);
  }

  const ready = tables
    .filter((table) => parentsByChild.get(table)?.size === 0)
    .sort((left, right) => left.localeCompare(right));
  const ordered = [];

  while (ready.length > 0) {
    const table = ready.shift();
    ordered.push(table);
    for (const child of childrenByParent.get(table) ?? []) {
      const parents = parentsByChild.get(child);
      parents.delete(table);
      if (parents.size === 0 && !ordered.includes(child) && !ready.includes(child)) {
        ready.push(child);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length !== tables.length) {
    const blocked = tables.filter((table) => !ordered.includes(table));
    throw new MigrationSafetyError(
      `Foreign-key cycle detected among: ${blocked.join(", ")}. ` +
        "The automatic transfer refuses to disable referential integrity.",
    );
  }
  return ordered;
}

async function tableCount(client, tableName) {
  const result = await client.query(
    `SELECT count(*)::text AS row_count FROM ${qualifiedName(tableName)}`,
  );
  return Number(result.rows[0].row_count);
}

export async function collectCounts(client, tables) {
  const counts = new Map();
  for (const tableName of tables) {
    counts.set(tableName, await tableCount(client, tableName));
  }
  return counts;
}

function renderCounts(counts) {
  return [...counts.entries()].map(([table, count]) => `${table}=${count}`).join(", ");
}

async function assertDestinationEmpty(destination, tables) {
  const counts = await collectCounts(destination, tables);
  const occupied = [...counts.entries()].filter(([, count]) => count > 0);
  if (occupied.length > 0) {
    throw new MigrationSafetyError(
      `Destination is not empty (${renderCounts(new Map(occupied))}). ` +
        "Use a fresh PostgreSQL database; this command never truncates or merges data.",
    );
  }
}

async function lockDestinationTables(destination, tables) {
  for (const tableName of [...tables].sort((left, right) => left.localeCompare(right))) {
    await destination.query(`LOCK TABLE ${qualifiedName(tableName)} IN ACCESS EXCLUSIVE MODE`);
  }
}

function insertableColumns(columns) {
  return columns.filter((column) => column.is_generated !== "ALWAYS");
}

async function copyTable({
  source,
  destination,
  tableName,
  columns,
  batchSize,
  maxBatchBytes,
  onProgress,
}) {
  const copiedColumns = insertableColumns(columns);
  if (copiedColumns.length === 0) {
    throw new MigrationSafetyError(`${tableName} has no insertable columns.`);
  }

  const columnSql = copiedColumns.map((column) => quoteIdentifier(column.column_name)).join(", ");
  const hasIdentity = copiedColumns.some((column) => column.is_identity === "YES");
  const overridingSql = hasIdentity ? " OVERRIDING SYSTEM VALUE" : "";
  let cursor = null;
  let copied = 0;

  while (true) {
    const batch = await source.query(
      `SELECT ctid::text AS transfer_cursor,
              row_to_json(source_row)::text AS row_json
         FROM ${qualifiedName(tableName)} AS source_row
        WHERE ($1::text IS NULL OR ctid > $1::tid)
        ORDER BY ctid
        LIMIT $2`,
      [cursor, batchSize],
    );
    if (batch.rows.length === 0) break;

    let payloadBytes = 2;
    const transferableRows = [];
    for (const row of batch.rows) {
      const rowBytes = Buffer.byteLength(row.row_json, "utf8") + 1;
      if (transferableRows.length > 0 && payloadBytes + rowBytes > maxBatchBytes) break;
      transferableRows.push(row);
      payloadBytes += rowBytes;
    }
    const jsonPayload = `[${transferableRows.map((row) => row.row_json).join(",")}]`;
    await destination.query(
      `INSERT INTO ${qualifiedName(tableName)} (${columnSql})${overridingSql}
       SELECT ${columnSql}
         FROM json_populate_recordset(NULL::${qualifiedName(tableName)}, $1::json)`,
      [jsonPayload],
    );

    copied += transferableRows.length;
    cursor = transferableRows.at(-1).transfer_cursor;
    onProgress?.({
      phase: "copy",
      table: tableName,
      rows: copied,
      batchRows: transferableRows.length,
      batchBytes: payloadBytes,
      oversizedRow: transferableRows.length === 1 && payloadBytes > maxBatchBytes,
    });
  }
  return copied;
}

async function listOwnedSequences(client, tables) {
  if (tables.length === 0) return [];
  const result = await client.query(
    `SELECT sequence_ns.nspname AS sequence_schema,
            sequence_record.relname AS sequence_name,
            table_record.relname AS table_name,
            attribute_record.attname AS column_name,
            sequence_parameters.seqstart::text AS start_value,
            sequence_parameters.seqincrement::text AS increment_by,
            sequence_parameters.seqmin::text AS minimum_value,
            sequence_parameters.seqmax::text AS maximum_value,
            sequence_parameters.seqcycle AS cycles
       FROM pg_class sequence_record
       JOIN pg_namespace sequence_ns ON sequence_ns.oid = sequence_record.relnamespace
       JOIN pg_depend dependency_record
         ON dependency_record.classid = 'pg_class'::regclass
        AND dependency_record.objid = sequence_record.oid
        AND dependency_record.deptype IN ('a', 'i')
       JOIN pg_class table_record ON table_record.oid = dependency_record.refobjid
       JOIN pg_namespace table_ns ON table_ns.oid = table_record.relnamespace
       JOIN pg_attribute attribute_record
         ON attribute_record.attrelid = table_record.oid
        AND attribute_record.attnum = dependency_record.refobjsubid
       JOIN pg_sequence sequence_parameters ON sequence_parameters.seqrelid = sequence_record.oid
      WHERE sequence_record.relkind = 'S'
        AND table_ns.nspname = $1
      ORDER BY table_record.relname, attribute_record.attname`,
    [PUBLIC_SCHEMA],
  );
  const tableSet = new Set(tables);
  return result.rows.filter((row) => tableSet.has(row.table_name));
}

function quotedRegclass(schemaName, objectName) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(objectName)}`;
}

function sequenceKey(sequence) {
  return `${sequence.table_name}.${sequence.column_name}`;
}

function sequencesAreCompatible(sourceSequence, destinationSequence) {
  return (
    sourceSequence.increment_by === destinationSequence.increment_by &&
    sourceSequence.minimum_value === destinationSequence.minimum_value &&
    sourceSequence.maximum_value === destinationSequence.maximum_value &&
    sourceSequence.cycles === destinationSequence.cycles
  );
}

async function readRawSequenceState(client, sequence) {
  const result = await client.query(
    `SELECT last_value::text AS last_value, is_called
       FROM ${quotedRegclass(sequence.sequence_schema, sequence.sequence_name)}`,
  );
  return result.rows[0];
}

async function readSequenceColumnBoundary(client, sequence) {
  const aggregate = BigInt(sequence.increment_by) > 0n ? "max" : "min";
  const result = await client.query(
    `SELECT ${aggregate}(${quoteIdentifier(sequence.column_name)})::text AS boundary
       FROM ${qualifiedName(sequence.table_name)}`,
  );
  return result.rows[0].boundary;
}

function nextFromRawState(sequence, rawState) {
  const lastValue = BigInt(rawState.last_value);
  return rawState.is_called === true ? lastValue + BigInt(sequence.increment_by) : lastValue;
}

function assertSequenceValueInRange(sequence, nextValue) {
  const minimum = BigInt(sequence.minimum_value);
  const maximum = BigInt(sequence.maximum_value);
  if (nextValue < minimum || nextValue > maximum) {
    throw new MigrationSafetyError(
      `Next value ${nextValue} for ${sequenceKey(sequence)} is outside its sequence range.`,
    );
  }
}

async function determineSafeNextSequenceValue({ source, sourceSequence, destinationSequence }) {
  const increment = BigInt(destinationSequence.increment_by);
  const boundaryRaw = await readSequenceColumnBoundary(
    source,
    sourceSequence ?? destinationSequence,
  );
  const boundary = boundaryRaw === null ? null : BigInt(boundaryRaw);
  let sourceNext = null;
  if (sourceSequence) {
    try {
      sourceNext = nextFromRawState(
        sourceSequence,
        await readRawSequenceState(source, sourceSequence),
      );
    } catch {
      // Some managed/read-only roles cannot inspect sequence state. The table
      // boundary still provides a collision-safe fallback.
    }
  }

  let safeNext;
  if (boundary === null) {
    safeNext = sourceNext ?? BigInt(destinationSequence.start_value);
  } else {
    const boundaryNext = boundary + increment;
    if (sourceNext === null) safeNext = boundaryNext;
    else if (increment > 0n) safeNext = sourceNext > boundary ? sourceNext : boundaryNext;
    else safeNext = sourceNext < boundary ? sourceNext : boundaryNext;
  }
  assertSequenceValueInRange(destinationSequence, safeNext);
  return { nextValue: safeNext, preservedSourceState: sourceNext !== null };
}

async function sequenceTransferPlan(source, destination, tables) {
  const [sourceSequences, destinationSequences] = await Promise.all([
    listOwnedSequences(source, tables),
    listOwnedSequences(destination, tables),
  ]);
  const sourceByColumn = new Map(
    sourceSequences.map((sequence) => [sequenceKey(sequence), sequence]),
  );
  const plan = [];
  for (const destinationSequence of destinationSequences) {
    const sourceSequence = sourceByColumn.get(sequenceKey(destinationSequence));
    if (sourceSequence && !sequencesAreCompatible(sourceSequence, destinationSequence)) {
      throw new MigrationSafetyError(
        `Sequence definition mismatch for ${sequenceKey(destinationSequence)}.`,
      );
    }
    const next = await determineSafeNextSequenceValue({
      source,
      sourceSequence,
      destinationSequence,
    });
    plan.push({ sourceSequence, destinationSequence, ...next });
  }
  return plan;
}

export async function resetOwnedSequences(source, destination, tables, onProgress) {
  const plan = await sequenceTransferPlan(source, destination, tables);
  for (const sequencePlan of plan) {
    const sequence = sequencePlan.destinationSequence;
    // ALTER SEQUENCE RESTART participates in the surrounding transaction;
    // unlike setval(), it is rolled back if later parity verification fails.
    await destination.query(
      `ALTER SEQUENCE ${quotedRegclass(sequence.sequence_schema, sequence.sequence_name)} ` +
        `RESTART WITH ${sequencePlan.nextValue.toString()}`,
    );
    onProgress?.({
      phase: "sequence",
      table: sequence.table_name,
      column: sequence.column_name,
      nextValue: sequencePlan.nextValue.toString(),
      preservedSourceState: sequencePlan.preservedSourceState,
    });
  }
  return plan.length;
}

export async function verifyOwnedSequences(source, destination, tables, onProgress) {
  const plan = await sequenceTransferPlan(source, destination, tables);
  const mismatches = [];
  for (const sequencePlan of plan) {
    const sequence = sequencePlan.destinationSequence;
    const currentState = await readRawSequenceState(destination, sequence);
    const destinationNext = nextFromRawState(sequence, currentState);
    const matches = destinationNext === sequencePlan.nextValue;
    onProgress?.({
      phase: "verify-sequence",
      table: sequence.table_name,
      column: sequence.column_name,
      matches,
    });
    if (!matches) {
      mismatches.push({
        table: sequence.table_name,
        column: sequence.column_name,
        expectedNext: sequencePlan.nextValue.toString(),
        actualNext: destinationNext.toString(),
        ...currentState,
      });
    }
  }
  if (mismatches.length > 0) {
    throw new MigrationSafetyError(
      `Sequence verification failed for ${mismatches.length} column(s): ${mismatches
        .map((mismatch) => `${mismatch.table}.${mismatch.column}`)
        .join(", ")}.`,
    );
  }
  return plan.length;
}

async function tableFingerprint(client, tableName) {
  const result = await client.query(
    `SELECT count(*)::text AS row_count,
            COALESCE(sum((('x' || substr(row_hash, 1, 16))::bit(64)::bigint)::numeric), 0)::text AS hash_left,
            COALESCE(sum((('x' || substr(row_hash, 17, 16))::bit(64)::bigint)::numeric), 0)::text AS hash_right
       FROM (
         SELECT md5(to_jsonb(fingerprint_row)::text) AS row_hash
           FROM ${qualifiedName(tableName)} AS fingerprint_row
       ) AS row_hashes`,
  );
  return result.rows[0];
}

export async function verifyDatabaseParity({ source, destination, tables, onProgress }) {
  const mismatches = [];
  const fingerprints = new Map();
  for (const tableName of tables) {
    const [sourceFingerprint, destinationFingerprint] = await Promise.all([
      tableFingerprint(source, tableName),
      tableFingerprint(destination, tableName),
    ]);
    fingerprints.set(tableName, { source: sourceFingerprint, destination: destinationFingerprint });
    const matches =
      sourceFingerprint.row_count === destinationFingerprint.row_count &&
      sourceFingerprint.hash_left === destinationFingerprint.hash_left &&
      sourceFingerprint.hash_right === destinationFingerprint.hash_right;
    onProgress?.({
      phase: "verify",
      table: tableName,
      rows: Number(sourceFingerprint.row_count),
      matches,
    });
    if (!matches) {
      mismatches.push({
        table: tableName,
        source: sourceFingerprint,
        destination: destinationFingerprint,
      });
    }
  }
  if (mismatches.length > 0) {
    throw new MigrationSafetyError(
      `Parity verification failed for ${mismatches.length} table(s): ${mismatches
        .map((mismatch) => mismatch.table)
        .join(", ")}. No successful migration should be declared.`,
    );
  }
  return fingerprints;
}

export async function planMigration({ source, destination }) {
  const schema = await inspectCompatibleSchema(source, destination);
  const copyOrder = orderTablesForCopy(schema.tables, schema.foreignKeys);
  const [sourceCounts, destinationCounts] = await Promise.all([
    collectCounts(source, schema.tables),
    collectCounts(destination, schema.tables),
  ]);
  return { ...schema, copyOrder, sourceCounts, destinationCounts };
}

export async function configureSerialization(client) {
  const settings = [
    "SET LOCAL TimeZone = 'UTC'",
    "SET LOCAL DateStyle = 'ISO, YMD'",
    "SET LOCAL IntervalStyle = 'postgres'",
    "SET LOCAL bytea_output = 'hex'",
    "SET LOCAL extra_float_digits = 3",
    "SET LOCAL standard_conforming_strings = on",
  ];
  for (const setting of settings) await client.query(setting);
}

export async function acquireMaintenanceLock(client) {
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    MAINTENANCE_LOCK_KEY_1,
    MAINTENANCE_LOCK_KEY_2,
  ]);
}

export async function migrateDatabase({
  source,
  destination,
  batchSize = 50,
  maxBatchBytes = 2 * 1024 * 1024,
  dryRun = false,
  onProgress,
}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5_000) {
    throw new MigrationSafetyError("batchSize must be an integer between 1 and 5000.");
  }
  if (
    !Number.isSafeInteger(maxBatchBytes) ||
    maxBatchBytes < 64 * 1024 ||
    maxBatchBytes > 64 * 1024 * 1024
  ) {
    throw new MigrationSafetyError("maxBatchBytes must be an integer between 65536 and 67108864.");
  }

  let sourceTransaction = false;
  let destinationTransaction = false;
  try {
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    sourceTransaction = true;
    await configureSerialization(source);
    await destination.query(
      dryRun
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN ISOLATION LEVEL SERIALIZABLE",
    );
    destinationTransaction = true;
    await destination.query("SET LOCAL statement_timeout = 0");
    await configureSerialization(destination);
    await acquireMaintenanceLock(destination);
    const plan = await planMigration({ source, destination });
    onProgress?.({ phase: "plan", plan });

    const occupied = [...plan.destinationCounts.entries()].filter(([, count]) => count > 0);
    if (occupied.length > 0) {
      throw new MigrationSafetyError(
        `Destination is not empty (${renderCounts(new Map(occupied))}). ` +
          "Use a fresh PostgreSQL database; this command never truncates or merges data.",
      );
    }
    if (dryRun) {
      await destination.query("ROLLBACK");
      destinationTransaction = false;
      await source.query("ROLLBACK");
      sourceTransaction = false;
      return { dryRun: true, plan, copiedRows: 0, resetSequences: 0 };
    }

    await lockDestinationTables(destination, plan.tables);
    await assertDestinationEmpty(destination, plan.tables);

    let copiedRows = 0;
    for (const tableName of plan.copyOrder) {
      copiedRows += await copyTable({
        source,
        destination,
        tableName,
        columns: plan.columns.get(tableName),
        batchSize,
        maxBatchBytes,
        onProgress,
      });
    }
    const resetSequences = await resetOwnedSequences(source, destination, plan.tables, onProgress);
    await verifyOwnedSequences(source, destination, plan.tables, onProgress);

    // Verify while the destination transaction is still reversible. A mismatch
    // aborts the transaction instead of publishing an incomplete database.
    await verifyDatabaseParity({
      source,
      destination,
      tables: plan.tables,
      onProgress,
    });

    await destination.query("COMMIT");
    destinationTransaction = false;
    await source.query("ROLLBACK");
    sourceTransaction = false;
    return { dryRun: false, plan, copiedRows, resetSequences };
  } catch (error) {
    if (destinationTransaction) {
      try {
        await destination.query("ROLLBACK");
      } catch {
        // Preserve the original migration failure.
      }
    }
    if (sourceTransaction) {
      try {
        await source.query("ROLLBACK");
      } catch {
        // Preserve the original migration failure.
      }
    }
    throw error;
  }
}
