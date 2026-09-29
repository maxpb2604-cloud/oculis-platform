#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createDb } from "@oculis/db";
import pg from "pg";
import { migrateDatabase, verifyDatabaseParity } from "./db-transfer/core.mjs";
import {
  assertPristineDestination,
  bootstrapDestinationSchema,
  safeErrorMessage,
} from "./db-transfer/cli.mjs";

/**
 * Deliberately explicit: a schema addition must make this test fail until the
 * migration test covers the new table. This prevents an accidentally reduced
 * synthetic fixture from passing while production contains a larger catalog.
 */
const EXPECTED_OCULIS_TABLES = [
  "activity_events",
  "activity_initiatives",
  "client_initiative_assignments",
  "clients",
  "commission_members",
  "commissions",
  "document_contents",
  "document_pdf_verifications",
  "documents",
  "feed_accounts",
  "feed_item_entities",
  "feed_items",
  "inference_audit",
  "ingestion_runs",
  "initiative_commission_assignments",
  "initiative_proponent_reconciliation_runs",
  "initiative_proponents",
  "initiative_title_translations",
  "initiatives",
  "legislators",
  "portal_users",
  "regulations",
  "score_inputs",
  "status_events",
];

const DOCUMENT_SNAPSHOT = JSON.stringify({
  initiativeId: 15,
  source: "native-full-schema-test",
  sourceDocId: "DOC-50",
  url: "https://example.test/DOC-50.pdf",
  docType: "INFORME DE COMISIÓN",
  uploadedAt: "2026-09-28",
  modifiedAt: null,
});

function restoreEnvironment(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function bootstrapCurrentSchemaInPglite(sourceDirectory) {
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    pgliteDir: process.env.PGLITE_DIR,
    driver: process.env.DB_DRIVER,
    oculisEnv: process.env.OCULIS_ENV,
  };
  delete process.env.DATABASE_URL;
  process.env.PGLITE_DIR = sourceDirectory;
  process.env.DB_DRIVER = "pglite";
  delete process.env.OCULIS_ENV;
  let handle;
  try {
    handle = createDb();
    await handle.ensureSchema();
  } finally {
    await handle?.close();
    restoreEnvironment("DATABASE_URL", previous.databaseUrl);
    restoreEnvironment("PGLITE_DIR", previous.pgliteDir);
    restoreEnvironment("DB_DRIVER", previous.driver);
    restoreEnvironment("OCULIS_ENV", previous.oculisEnv);
  }
}

async function listPublicTables(client) {
  const result = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function assertEveryTableSeeded(source) {
  const emptyTables = [];
  let totalRows = 0;
  for (const tableName of EXPECTED_OCULIS_TABLES) {
    // tableName comes only from the fixed catalog above, never from external input.
    const result = await source.query(`SELECT count(*)::int AS count FROM "${tableName}"`);
    if (result.rows[0].count < 1) emptyTables.push(tableName);
    totalRows += result.rows[0].count;
  }
  assert.deepEqual(
    emptyTables,
    [],
    `full-schema fixture left tables empty: ${emptyTables.join(", ")}`,
  );
  return totalRows;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function restartFixtureSequences(source) {
  const owned = await source.query(`
    SELECT sequence_record.relname AS sequence_name,
           table_record.relname AS table_name,
           attribute_record.attname AS column_name
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
     WHERE sequence_record.relkind = 'S'
       AND sequence_ns.nspname = 'public'
       AND table_ns.nspname = 'public'
     ORDER BY table_record.relname, attribute_record.attname
  `);
  for (const sequence of owned.rows) {
    const maximum = await source.query(
      `SELECT max(${quoteIdentifier(sequence.column_name)})::text AS maximum
         FROM ${quoteIdentifier(sequence.table_name)}`,
    );
    const nextValue =
      sequence.sequence_name === "portal_users_id_seq"
        ? 250
        : Number(maximum.rows[0].maximum ?? 0) + 10;
    assert.ok(Number.isSafeInteger(nextValue) && nextValue > 0);
    await source.query(
      `ALTER SEQUENCE ${quoteIdentifier(sequence.sequence_name)} RESTART WITH ${nextValue}`,
    );
  }
  return owned.rows.length;
}

async function seedFullOculisCatalog(source) {
  await source.query("BEGIN");
  try {
    await source.query("INSERT INTO clients(id, name, slug) VALUES ($1, $2, $3)", [
      4,
      "Cliente Águila",
      "cliente-aguila",
    ]);
    await source.query(
      `INSERT INTO initiatives
         (id, source, source_id, kind, code, title, status, chamber, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        15,
        "native-full-schema-test",
        "INIT-15",
        "LEGISLATIVE",
        "015-2026",
        "Iniciativa de migración con ñ",
        "Depositada",
        "DIPUTADOS",
        JSON.stringify({ exact: true, nested: { count: 2 }, labels: ["á", "β"] }),
      ],
    );
    await source.query(
      `INSERT INTO regulations
         (id, source, source_id, institution, reg_type, title, status, is_consulta, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        16,
        "native-full-schema-test",
        "REG-16",
        "INDOTEL",
        "Resolución",
        "Iniciativa regulatoria de prueba",
        "En consulta pública",
        true,
        JSON.stringify({ sourceReported: true }),
      ],
    );
    await source.query(
      `INSERT INTO portal_users
         (id, client_id, email, display_name, password_hash, role)
       VALUES ($1, NULL, $2, $3, $4, 'ADMIN'),
              ($5, $6, $7, $8, $9, 'CLIENT')`,
      [
        8,
        "admin@example.test",
        "Administración FHC",
        "scrypt:native-admin-hash-preserved",
        9,
        4,
        "client@example.test",
        "Cliente de prueba",
        "scrypt:native-client-hash-preserved",
      ],
    );
    await source.query(
      `INSERT INTO activity_events
         (id, source, source_event_id, scope, chamber, event_date, description, dedupe_key, statuses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        20,
        "native-full-schema-test",
        "EVENT-20",
        "COMMITTEE",
        "DIPUTADOS",
        "2026-09-28",
        "Agenda íntegra",
        "event-20",
        JSON.stringify(["Convocada"]),
      ],
    );
    await source.query(
      `INSERT INTO commissions(id, source, chamber, name, president, source_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [21, "native-full-schema-test", "DIPUTADOS", "Comisión de prueba", "Ana Pérez", "COM-21"],
    );
    await source.query(
      `INSERT INTO commission_members
         (id, source, chamber, commission_name, commission_source_id, legislator_name,
          legislator_source_id, cargo, party)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        22,
        "native-full-schema-test",
        "DIPUTADOS",
        "Comisión de prueba",
        "COM-21",
        "Ana Pérez",
        "LEG-23",
        "Presidenta",
        "PRM",
      ],
    );
    await source.query(
      `INSERT INTO legislators
         (id, source, source_id, chamber, full_name, province, party, party_short, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        23,
        "native-full-schema-test",
        "LEG-23",
        "DIPUTADOS",
        "Ana Pérez",
        "Distrito Nacional",
        "Partido Revolucionario Moderno",
        "PRM",
        JSON.stringify({ official: true }),
      ],
    );
    await source.query(
      `INSERT INTO documents
         (id, source, initiative_id, initiative_code, doc_type, extension, url,
          uploaded_at, source_doc_id, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        50,
        "native-full-schema-test",
        15,
        "015-2026",
        "INFORME DE COMISIÓN",
        "pdf",
        "https://example.test/DOC-50.pdf",
        "2026-09-28",
        "DOC-50",
        JSON.stringify({ verifiedSource: true }),
      ],
    );
    await source.query(
      `INSERT INTO document_contents
         (id, document_id, content_hash, source_snapshot, content_text, mime_type,
          byte_size, page_count, character_count)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
      [
        51,
        50,
        "a".repeat(64),
        DOCUMENT_SNAPSHOT,
        "Contenido íntegro del PDF",
        "application/pdf",
        2048,
        1,
        25,
      ],
    );
    await source.query(
      `INSERT INTO document_pdf_verifications
         (id, document_id, source_snapshot, reachable, http_status, mime_type, byte_size, final_url)
       VALUES ($1, $2, $3::jsonb, true, 200, 'application/pdf', $4, $5)`,
      [51, 50, DOCUMENT_SNAPSHOT, 2048, "https://example.test/DOC-50.pdf"],
    );
    await source.query(
      `INSERT INTO feed_accounts
         (id, name, handle, platform, url, kind, chamber, legislator_source_id, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        60,
        "Cuenta oficial",
        "@cuenta-oficial",
        "X",
        "https://example.test/account",
        "LEGISLATOR",
        "DIPUTADOS",
        "LEG-23",
        JSON.stringify({ verified: true }),
      ],
    );
    await source.query(
      `INSERT INTO feed_items
         (id, source, source_id, kind, title, summary, url, platform, published_at,
          initiative_id, initiative_code, legislator_source_id, chamber, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamp,
               $10, $11, $12, $13, $14::jsonb)`,
      [
        61,
        "native-full-schema-test",
        "FEED-61",
        "LEGISLATIVE_UPDATE",
        "Movimiento legislativo",
        "Resumen oficial",
        "https://example.test/feed/61",
        "WEB",
        "2026-09-28 12:34:56.123",
        15,
        "015-2026",
        "LEG-23",
        "DIPUTADOS",
        JSON.stringify({ sourceReported: true }),
      ],
    );
    await source.query(
      `INSERT INTO ingestion_runs
         (id, source, finished_at, seen, inserted, updated, status_changes, ok, details)
       VALUES ($1, $2, $3::timestamp, $4, $5, $6, $7, true, $8::jsonb)`,
      [
        70,
        "native-full-schema-test",
        "2026-09-28 12:35:00",
        4,
        2,
        2,
        1,
        JSON.stringify({ completeSnapshot: true }),
      ],
    );
    await source.query(
      `INSERT INTO inference_audit(id, entity_type, entity_id, inference_kind, value, provenance)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        71,
        "initiative",
        15,
        "native-migration-fixture",
        JSON.stringify({ legacy: "preserved" }),
        JSON.stringify({ source: "test" }),
      ],
    );
    await source.query(
      `INSERT INTO initiative_proponent_reconciliation_runs
         (id, initiative_source, person_namespace, roster_source, chamber,
          compatibility_version, resolver_version, status, source_candidate_count,
          source_max_initiative_id, source_fingerprint, processed_candidate_count,
          observed_candidate_count, replaced_candidate_count, skipped_unobserved_count,
          unresolved_proponent_count, failure_count, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'complete', $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17::timestamp)`,
      [
        72,
        "native-full-schema-test",
        "diputados",
        "native-roster-test",
        "DIPUTADOS",
        1,
        "native-v1",
        1,
        15,
        "c".repeat(32),
        1,
        1,
        0,
        0,
        0,
        0,
        "2026-09-28 12:36:00",
      ],
    );
    await source.query(
      `INSERT INTO activity_initiatives(id, activity_id, initiative_code, initiative_id)
       VALUES ($1, $2, $3, $4)`,
      [80, 20, "015-2026", 15],
    );
    await source.query(
      `INSERT INTO client_initiative_assignments
         (id, client_id, initiative_id, regulation_id, impact_on_business,
          executive_support, key_stakeholder_support, public_opinion, internal_note,
          assigned_by_user_id)
       VALUES ($1, $2, $3, NULL, 'HIGH', 'SUPPORTS', 'MIXED', 'FAVORABLE', $4, $5),
              ($6, $7, NULL, $8, 'TO_ASSESS', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', $9, $10)`,
      [
        81,
        4,
        15,
        "Asignación legislativa conservada",
        8,
        82,
        4,
        16,
        "Asignación regulatoria conservada",
        8,
      ],
    );
    await source.query(
      `INSERT INTO feed_item_entities
         (id, feed_item_id, entity_type, initiative_code, initiative_id,
          legislator_source_id, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [83, 61, "INITIATIVE", "015-2026", 15, "LEG-23", "Iniciativa 015-2026"],
    );
    await source.query(
      `INSERT INTO initiative_commission_assignments
         (id, initiative_id, source, source_assignment_id, source_type_id, name, type,
          start_date, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        84,
        15,
        "native-full-schema-test",
        "ASSIGN-84",
        "PERMANENT",
        "Comisión de prueba",
        "Comisión permanente",
        "2026-09-28",
        JSON.stringify({ official: true }),
      ],
    );
    await source.query(
      `INSERT INTO initiative_proponents
         (id, initiative_id, legislator_id, initiative_source, person_namespace,
          person_source_id, published_name, principal, ordinal, match_basis, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 0, 'official-id', $8::jsonb)`,
      [
        85,
        15,
        23,
        "native-full-schema-test",
        "diputados",
        "LEG-23",
        "Ana Pérez",
        JSON.stringify({ exactOfficialId: true }),
      ],
    );
    await source.query(
      `INSERT INTO initiative_title_translations
         (id, initiative_id, target_locale, source_title, source_title_hash,
          translated_title, model)
       VALUES ($1, $2, 'en', $3, $4, $5, $6)`,
      [
        86,
        15,
        "Iniciativa de migración con ñ",
        "b".repeat(64),
        "Migration initiative",
        "native-test-model",
      ],
    );
    await source.query(
      "INSERT INTO score_inputs(initiative_id, provenance) VALUES ($1, $2::jsonb)",
      [15, JSON.stringify({ retiredFieldsRemainNull: true })],
    );
    await source.query(
      `INSERT INTO status_events
         (id, initiative_id, status, event_date, source_event_id, note, source,
          source_url, evidence_type, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SOURCE_HISTORY', $9::jsonb)`,
      [
        87,
        15,
        "Depositada",
        "2026-09-28",
        "STATUS-87",
        "Movimiento oficial",
        "native-full-schema-test",
        "https://example.test/status/87",
        JSON.stringify({ id: "STATUS-87" }),
      ],
    );
    assert.equal(await restartFixtureSequences(source), 23);
    await source.query("COMMIT");
  } catch (error) {
    await source.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function validateTestDatabaseUrl(connectionString) {
  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error("OCULIS_TEST_POSTGRES_URL is not a valid PostgreSQL URL.");
  }
  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("OCULIS_TEST_POSTGRES_URL must use postgres:// or postgresql://.");
  }
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  if (!/^oculis_migration_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(
      "Native migration tests only run against a database named oculis_migration_test_<suffix>.",
    );
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "postgres"]);
  if (!localHosts.has(parsedUrl.hostname)) {
    throw new Error(
      "Native migration tests only run against a local/CI PostgreSQL service; remote hosts are refused.",
    );
  }
  return databaseName;
}

async function createSeededFullSchemaSource(root) {
  const sourceDirectory = join(root, "source");
  await bootstrapCurrentSchemaInPglite(sourceDirectory);
  const source = await PGlite.create(sourceDirectory);
  try {
    await seedFullOculisCatalog(source);
    assert.deepEqual(await listPublicTables(source), EXPECTED_OCULIS_TABLES);
    assert.equal(await assertEveryTableSeeded(source), 26);
    return source;
  } catch (error) {
    await source.close().catch(() => {});
    throw error;
  }
}

async function main() {
  const connectionString = process.env.OCULIS_TEST_POSTGRES_URL;
  if (!connectionString) {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "oculis-native-schema-fixture-"));
    let fixtureSource;
    try {
      fixtureSource = await createSeededFullSchemaSource(fixtureRoot);
      console.log(
        `Full current PGlite fixture passed for ${EXPECTED_OCULIS_TABLES.length} tables; ` +
          "native PostgreSQL migration skipped because OCULIS_TEST_POSTGRES_URL is not configured.",
      );
    } finally {
      await fixtureSource?.close().catch(() => {});
      await rm(fixtureRoot, { recursive: true, force: true });
    }
    return;
  }
  if (process.env.OCULIS_ALLOW_NATIVE_DB_TEST !== "1") {
    throw new Error("Set OCULIS_ALLOW_NATIVE_DB_TEST=1 to acknowledge the isolated test database.");
  }
  const databaseName = validateTestDatabaseUrl(connectionString);

  const root = await mkdtemp(join(tmpdir(), "oculis-native-pg-test-"));
  let source;
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    application_name: "oculis-native-migration-test",
  });
  let destination;
  let cleanupAuthorized = false;
  try {
    destination = await pool.connect();
    const identity = await destination.query(
      "SELECT current_database() AS database_name, current_setting('server_version_num')::int AS version_num",
    );
    assert.equal(identity.rows[0].database_name, databaseName);
    assert.ok(
      identity.rows[0].version_num >= 160000 && identity.rows[0].version_num < 170000,
      `native migration test requires PostgreSQL 16, got server_version_num=${identity.rows[0].version_num}`,
    );
    await assertPristineDestination(destination);
    cleanupAuthorized = true;
    destination.release();
    destination = undefined;

    source = await createSeededFullSchemaSource(root);

    // Exercise the same strict, pristine-database bootstrap used by the real
    // PGlite -> PostgreSQL migration command, now against PostgreSQL 16.
    await bootstrapDestinationSchema(connectionString);
    destination = await pool.connect();
    assert.deepEqual(await listPublicTables(destination), EXPECTED_OCULIS_TABLES);

    const result = await migrateDatabase({
      source,
      destination,
      batchSize: 2,
      maxBatchBytes: 64 * 1024,
    });
    assert.deepEqual(result.plan.tables, EXPECTED_OCULIS_TABLES);
    assert.equal(result.plan.extraDestinationTables.length, 0);
    assert.equal(result.copiedRows, 26);
    assert.equal(result.resetSequences, 23);
    await verifyDatabaseParity({ source, destination, tables: result.plan.tables });

    const users = await destination.query(
      "SELECT email, password_hash, role FROM portal_users ORDER BY id",
    );
    assert.deepEqual(users.rows, [
      {
        email: "admin@example.test",
        password_hash: "scrypt:native-admin-hash-preserved",
        role: "ADMIN",
      },
      {
        email: "client@example.test",
        password_hash: "scrypt:native-client-hash-preserved",
        role: "CLIENT",
      },
    ]);
    assert.equal(
      (await destination.query("SELECT count(*)::int AS count FROM client_initiative_assignments"))
        .rows[0].count,
      2,
    );
    assert.deepEqual(
      (await destination.query("SELECT raw FROM initiatives WHERE id = 15")).rows[0].raw,
      { exact: true, nested: { count: 2 }, labels: ["á", "β"] },
    );

    const sequenceBefore = (
      await destination.query(
        "SELECT last_value::text AS last_value, is_called FROM portal_users_id_seq",
      )
    ).rows[0];
    assert.deepEqual(sequenceBefore, { last_value: "250", is_called: false });
    await destination.query("BEGIN");
    await destination.query("ALTER SEQUENCE portal_users_id_seq RESTART WITH 999");
    await destination.query("ROLLBACK");
    assert.deepEqual(
      (
        await destination.query(
          "SELECT last_value::text AS last_value, is_called FROM portal_users_id_seq",
        )
      ).rows[0],
      sequenceBefore,
      "native PostgreSQL must roll back ALTER SEQUENCE RESTART",
    );
    console.log(
      `Native PostgreSQL 16 migration test passed: ${result.plan.tables.length} current Oculis ` +
        `tables, ${result.copiedRows} seeded rows, and ${result.resetSequences} sequences verified.`,
    );
  } finally {
    // Destructive cleanup is authorized only after all three independent safety
    // gates passed: explicit opt-in, a local approved test DB name, and a pristine
    // destination. Therefore every removed object was created by this test.
    if (destination && cleanupAuthorized) {
      await destination.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public").catch(() => {});
    } else if (cleanupAuthorized) {
      const cleanup = await pool.connect().catch(() => undefined);
      if (cleanup) {
        await cleanup.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public").catch(() => {});
        cleanup.release();
      }
    }
    if (destination) destination.release();
    await Promise.allSettled([source?.close(), pool.end()]);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Native PostgreSQL test failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
