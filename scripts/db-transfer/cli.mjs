import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { MigrationSafetyError } from "./core.mjs";

const MAINTENANCE_LOCK_KEY_1 = 1_329_774_051;
const MAINTENANCE_LOCK_KEY_2 = 2_026_092_801;

function isLiveProcess(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireOfflinePgliteSource(value) {
  if (!value) {
    throw new MigrationSafetyError(
      "Set SRC_PGLITE_DIR or pass --source <directory>. The source is intentionally not guessed.",
    );
  }
  const requestedDirectory = resolve(value);
  if (!existsSync(requestedDirectory) || !statSync(requestedDirectory).isDirectory()) {
    throw new MigrationSafetyError(`PGlite source directory does not exist: ${requestedDirectory}`);
  }
  const directory = realpathSync(requestedDirectory);
  const versionPath = resolve(directory, "PG_VERSION");
  if (!existsSync(versionPath) || !statSync(versionPath).isFile()) {
    throw new MigrationSafetyError(
      `${directory} is not an initialized PGlite/PostgreSQL data directory (PG_VERSION missing).`,
    );
  }
  const version = readFileSync(versionPath, "utf8").trim();
  if (!/^\d+(?:\.\d+)?$/.test(version)) {
    throw new MigrationSafetyError(`Invalid PG_VERSION in PGlite source: ${versionPath}`);
  }

  const lockPath = `${directory}.oculis.lock`;
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      let lockWritten = false;
      try {
        writeFileSync(
          descriptor,
          JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }),
          "utf8",
        );
        lockWritten = true;
      } finally {
        closeSync(descriptor);
        if (!lockWritten) {
          try {
            unlinkSync(lockPath);
          } catch {
            // Preserve the write failure; a later run will reject an ambiguous lock.
          }
        }
      }
      return {
        directory,
        version,
        release() {
          try {
            const current = JSON.parse(readFileSync(lockPath, "utf8"));
            if (current.pid === process.pid && current.token === token) unlinkSync(lockPath);
          } catch (error) {
            if (error?.code !== "ENOENT") {
              console.warn(`Warning: could not safely release PGlite lock ${lockPath}.`);
            }
          }
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let lock;
      try {
        lock = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        throw new MigrationSafetyError(
          `Ambiguous Oculis lock at ${lockPath}. Refusing to open the source; verify the app is stopped.`,
        );
      }
      if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) {
        throw new MigrationSafetyError(
          `Invalid Oculis lock at ${lockPath}. Refusing to open the source; verify the app is stopped.`,
        );
      }
      if (isLiveProcess(lock.pid)) {
        throw new MigrationSafetyError(
          `PGlite is in use by PID ${lock.pid}. Stop the local Oculis web/worker process, then retry. ` +
            "The transfer will not open a live single-process PGlite database.",
        );
      }
      unlinkSync(lockPath);
    }
  }
  throw new MigrationSafetyError(`Could not acquire exclusive PGlite lock at ${lockPath}.`);
}

export function requireDestinationUrl() {
  const value = process.env.DEST_DATABASE_URL;
  if (!value) {
    throw new MigrationSafetyError(
      "Set DEST_DATABASE_URL to the target PostgreSQL connection string. It is never printed.",
    );
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new MigrationSafetyError("DEST_DATABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new MigrationSafetyError("DEST_DATABASE_URL must use postgres:// or postgresql://.");
  }
  return value;
}

export async function bootstrapDestinationSchema(destinationUrl) {
  const preflightPool = new pg.Pool({
    connectionString: destinationUrl,
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    application_name: "oculis-pristine-bootstrap-preflight",
  });
  let preflight;
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    pgliteDir: process.env.PGLITE_DIR,
    driver: process.env.DB_DRIVER,
    poolMax: process.env.PG_POOL_MAX,
    appName: process.env.OCULIS_DB_APP_NAME,
  };
  process.env.DATABASE_URL = destinationUrl;
  delete process.env.PGLITE_DIR;
  delete process.env.DB_DRIVER;
  process.env.PG_POOL_MAX = "1";
  process.env.OCULIS_DB_APP_NAME = "oculis-migration-bootstrap";
  try {
    preflight = await preflightPool.connect();
    await preflight.query("SET lock_timeout = '15s'");
    await preflight.query("SELECT pg_advisory_lock($1, $2)", [
      MAINTENANCE_LOCK_KEY_1,
      MAINTENANCE_LOCK_KEY_2,
    ]);
    await assertPristineDestination(preflight);
    const { createDb } = await import("@oculis/db");
    const handle = createDb();
    try {
      await handle.ensureSchema();
    } finally {
      await handle.close();
    }
  } finally {
    if (preflight) {
      await preflight
        .query("SELECT pg_advisory_unlock($1, $2)", [
          MAINTENANCE_LOCK_KEY_1,
          MAINTENANCE_LOCK_KEY_2,
        ])
        .catch(() => {});
      preflight.release();
    }
    restoreEnvironment("DATABASE_URL", previous.databaseUrl);
    restoreEnvironment("PGLITE_DIR", previous.pgliteDir);
    restoreEnvironment("DB_DRIVER", previous.driver);
    restoreEnvironment("PG_POOL_MAX", previous.poolMax);
    restoreEnvironment("OCULIS_DB_APP_NAME", previous.appName);
    await preflightPool.end().catch(() => {});
  }
}

export async function assertPristineDestination(client) {
  const result = await client.query(`
    WITH user_objects AS (
      SELECT 'schema'::text AS object_kind, namespace_record.nspname AS object_name
        FROM pg_namespace namespace_record
       WHERE namespace_record.nspname NOT IN ('public', 'information_schema')
         AND namespace_record.nspname NOT LIKE 'pg_%'
      UNION ALL
      SELECT CASE relation_record.relkind
               WHEN 'r' THEN 'table'
               WHEN 'p' THEN 'partitioned table'
               WHEN 'v' THEN 'view'
               WHEN 'm' THEN 'materialized view'
               WHEN 'S' THEN 'sequence'
               WHEN 'i' THEN 'index'
               ELSE 'relation'
             END,
             relation_ns.nspname || '.' || relation_record.relname
        FROM pg_class relation_record
        JOIN pg_namespace relation_ns ON relation_ns.oid = relation_record.relnamespace
       WHERE relation_ns.nspname = 'public'
      UNION ALL
      SELECT 'function', function_ns.nspname || '.' || function_record.proname
        FROM pg_proc function_record
        JOIN pg_namespace function_ns ON function_ns.oid = function_record.pronamespace
       WHERE function_ns.nspname = 'public'
      UNION ALL
      SELECT 'type', type_ns.nspname || '.' || type_record.typname
        FROM pg_type type_record
        JOIN pg_namespace type_ns ON type_ns.oid = type_record.typnamespace
       WHERE type_ns.nspname = 'public'
      UNION ALL
      SELECT 'extension', extension_record.extname
        FROM pg_extension extension_record
       WHERE extension_record.extname <> 'plpgsql'
      UNION ALL
      SELECT 'collation', collation_ns.nspname || '.' || collation_record.collname
        FROM pg_collation collation_record
        JOIN pg_namespace collation_ns ON collation_ns.oid = collation_record.collnamespace
       WHERE collation_ns.nspname = 'public'
      UNION ALL
      SELECT 'conversion', conversion_ns.nspname || '.' || conversion_record.conname
        FROM pg_conversion conversion_record
        JOIN pg_namespace conversion_ns ON conversion_ns.oid = conversion_record.connamespace
       WHERE conversion_ns.nspname = 'public'
      UNION ALL
      SELECT 'event trigger', event_trigger_record.evtname
        FROM pg_event_trigger event_trigger_record
      UNION ALL
      SELECT 'publication', publication_record.pubname
        FROM pg_publication publication_record
      UNION ALL
      SELECT 'foreign server', foreign_server_record.srvname
        FROM pg_foreign_server foreign_server_record
      UNION ALL
      SELECT 'language', language_record.lanname
        FROM pg_language language_record
       WHERE language_record.lanname NOT IN ('internal', 'c', 'sql', 'plpgsql')
      UNION ALL
      SELECT 'large object', large_object_record.oid::text
        FROM pg_largeobject_metadata large_object_record
    )
    SELECT object_kind, object_name
      FROM user_objects
     ORDER BY object_kind, object_name
     LIMIT 25
  `);
  if (result.rows.length > 0) {
    const summary = result.rows.map((row) => `${row.object_kind}:${row.object_name}`).join(", ");
    throw new MigrationSafetyError(
      `--bootstrap-schema requires a pristine PostgreSQL database. ` +
        `User-defined objects were found (${summary}). Nothing was bootstrapped.`,
    );
  }
}

function restoreEnvironment(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

export async function openTransferConnections({ sourceDirectory, destinationUrl }) {
  const sourceDatabase = await PGlite.create(sourceDirectory);
  const pool = new pg.Pool({
    connectionString: destinationUrl,
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    application_name: "oculis-pglite-transfer",
  });
  let destinationClient;
  try {
    destinationClient = await pool.connect();
  } catch (error) {
    await sourceDatabase.close();
    await pool.end();
    throw error;
  }

  return {
    source: sourceDatabase,
    destination: destinationClient,
    async close() {
      destinationClient.release();
      await Promise.allSettled([sourceDatabase.close(), pool.end()]);
    },
  };
}

export function parseCommonArguments(argv) {
  const options = {
    source: process.env.SRC_PGLITE_DIR,
    batchSize: 50,
    maxBatchBytes: 2 * 1024 * 1024,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") {
      options.source = argv[index + 1];
      index += 1;
    } else if (argument === "--batch-size") {
      options.batchSize = Number(argv[index + 1]);
      index += 1;
    } else if (argument === "--max-batch-bytes") {
      options.maxBatchBytes = Number(argv[index + 1]);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--bootstrap-schema") {
      options.bootstrapSchema = true;
    } else {
      throw new MigrationSafetyError(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export function formatCountSummary(counts) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return `${counts.size} tables / ${total.toLocaleString("en-US")} rows`;
}

export function safeErrorMessage(error) {
  let message;
  try {
    if (error instanceof Error) message = error.message;
    else if (typeof error === "string") message = error;
    else message = JSON.stringify(error);
  } catch {
    message = "Unknown non-serializable error";
  }
  return String(message ?? "Unknown error")
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted PostgreSQL URL]")
    .replaceAll(/\bpassword\s*[:=]\s*[^\s,;"'<>}\]]+/gi, "password=[redacted]");
}
