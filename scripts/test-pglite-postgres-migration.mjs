#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  MigrationSafetyError,
  migrateDatabase,
  orderTablesForCopy,
  verifyDatabaseParity,
} from "./db-transfer/core.mjs";
import {
  acquireOfflinePgliteSource,
  assertPristineDestination,
  safeErrorMessage,
} from "./db-transfer/cli.mjs";

const SCHEMA = `
  CREATE TABLE clients (
    id serial PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true
  );
  CREATE TABLE initiatives (
    id serial PRIMARY KEY,
    source text NOT NULL,
    source_id text NOT NULL,
    title text NOT NULL,
    metadata jsonb,
    UNIQUE (source, source_id)
  );
  CREATE TABLE regulations (
    id serial PRIMARY KEY,
    institution text NOT NULL,
    title text NOT NULL
  );
  CREATE TABLE portal_users (
    id serial PRIMARY KEY,
    client_id integer REFERENCES clients(id) ON DELETE CASCADE,
    email text NOT NULL UNIQUE,
    password_hash text,
    role text NOT NULL
  );
  CREATE TABLE client_initiative_assignments (
    id serial PRIMARY KEY,
    client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    initiative_id integer REFERENCES initiatives(id) ON DELETE CASCADE,
    regulation_id integer REFERENCES regulations(id) ON DELETE CASCADE,
    assigned_by_user_id integer REFERENCES portal_users(id) ON DELETE SET NULL,
    note text
  );
  CREATE TABLE documents (
    id serial PRIMARY KEY,
    initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    body text,
    payload bytea
  );
`;

async function seed(source) {
  await source.query("INSERT INTO clients(id, name, slug) VALUES ($1, $2, $3)", [
    2,
    "Cliente Águila",
    "cliente-aguila",
  ]);
  await source.query(
    "INSERT INTO initiatives(id, source, source_id, title, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [10, "TEST", "A-10", "Iniciativa con ñ", JSON.stringify({ status: "VIGENTE" })],
  );
  await source.query("INSERT INTO regulations(id, institution, title) VALUES ($1, $2, $3)", [
    3,
    "INDOTEL",
    "Consulta pública",
  ]);
  await source.query(
    "INSERT INTO portal_users(id, client_id, email, password_hash, role) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
    [
      5,
      null,
      "admin@example.test",
      "scrypt:admin-hash-preserved",
      "ADMIN",
      6,
      2,
      "client@example.test",
      "scrypt:client-hash-preserved",
      "CLIENT",
    ],
  );
  await source.query(
    `INSERT INTO client_initiative_assignments
       (id, client_id, initiative_id, regulation_id, assigned_by_user_id, note)
     VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)`,
    [21, 2, 10, null, 5, "Prioridad alta", 22, 2, null, 3, 5, "Revisar plazo"],
  );
  await source.query(
    "INSERT INTO documents(id, initiative_id, body, payload) VALUES ($1, $2, $3, $4)",
    [40, 10, "Documento íntegro", new Uint8Array([0, 1, 2, 254, 255])],
  );
  await source.query("ALTER SEQUENCE portal_users_id_seq RESTART WITH 100");
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "oculis-db-transfer-test-"));
  const source = await PGlite.create(join(root, "source"));
  const destination = await PGlite.create(join(root, "destination"));
  const dryRunDestination = await PGlite.create(join(root, "dry-run-destination"));
  const pristineDestination = await PGlite.create(join(root, "pristine-destination"));
  try {
    await source.exec(SCHEMA);
    await destination.exec(SCHEMA);
    await dryRunDestination.exec(SCHEMA);
    await seed(source);

    await assertPristineDestination(pristineDestination);
    await pristineDestination.exec("CREATE TABLE should_block_bootstrap (id integer)");
    await assert.rejects(
      () => assertPristineDestination(pristineDestination),
      /requires a pristine PostgreSQL database/,
    );

    const lockProbeDirectory = join(root, "lock-probe");
    const lockProbeDatabase = await PGlite.create(lockProbeDirectory);
    await lockProbeDatabase.close();
    const lease = acquireOfflinePgliteSource(lockProbeDirectory);
    assert.equal(lease.directory, realpathSync(lockProbeDirectory));
    assert.equal(existsSync(`${lease.directory}.oculis.lock`), true);
    assert.throws(() => acquireOfflinePgliteSource(lockProbeDirectory), /is in use by PID/);
    lease.release();
    assert.equal(existsSync(`${lease.directory}.oculis.lock`), false);

    assert.equal(
      safeErrorMessage({ detail: "postgresql://user:secret@example.test/db password=hunter2" }),
      '{"detail":"[redacted PostgreSQL URL] password=[redacted]"}',
    );

    const dryRun = await migrateDatabase({
      source,
      destination: dryRunDestination,
      dryRun: true,
      batchSize: 2,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(
      (await dryRunDestination.query("SELECT count(*)::int AS count FROM portal_users")).rows[0]
        .count,
      0,
      "dry run must not insert rows",
    );

    const result = await migrateDatabase({
      source,
      destination,
      batchSize: 2,
    });
    assert.equal(result.plan.tables.length, 6);
    assert.equal(result.copiedRows, 8);

    const users = await destination.query(
      "SELECT email, password_hash, role FROM portal_users ORDER BY id",
    );
    assert.deepEqual(users.rows, [
      {
        email: "admin@example.test",
        password_hash: "scrypt:admin-hash-preserved",
        role: "ADMIN",
      },
      {
        email: "client@example.test",
        password_hash: "scrypt:client-hash-preserved",
        role: "CLIENT",
      },
    ]);
    assert.equal(
      (await destination.query("SELECT count(*)::int AS count FROM client_initiative_assignments"))
        .rows[0].count,
      2,
      "client assignments must be preserved",
    );
    assert.deepEqual(
      Array.from((await destination.query("SELECT payload FROM documents")).rows[0].payload),
      [0, 1, 2, 254, 255],
      "binary values must survive the JSON record transfer",
    );

    await verifyDatabaseParity({
      source,
      destination,
      tables: result.plan.tables,
    });
    const sequenceBeforeRollbackProbe = (
      await destination.query(
        "SELECT last_value::text AS last_value, is_called FROM portal_users_id_seq",
      )
    ).rows[0];
    assert.deepEqual(sequenceBeforeRollbackProbe, { last_value: "100", is_called: false });
    await destination.query("BEGIN");
    await destination.query("ALTER SEQUENCE portal_users_id_seq RESTART WITH 999");
    await destination.query("ROLLBACK");
    assert.deepEqual(
      (
        await destination.query(
          "SELECT last_value::text AS last_value, is_called FROM portal_users_id_seq",
        )
      ).rows[0],
      sequenceBeforeRollbackProbe,
      "ALTER SEQUENCE RESTART must roll back with the surrounding transaction",
    );
    assert.equal(
      (await destination.query("SELECT nextval('portal_users_id_seq')::int AS next_id")).rows[0]
        .next_id,
      100,
      "a collision-safe source next value must be preserved",
    );

    assert.throws(
      () => orderTablesForCopy(["tree"], [{ child_table: "tree", parent_table: "tree" }]),
      /Self-referential foreign key/,
      "self-referential foreign keys must be rejected",
    );

    await assert.rejects(
      () => migrateDatabase({ source, destination, batchSize: 2 }),
      (error) =>
        error instanceof MigrationSafetyError && /Destination is not empty/.test(error.message),
      "a second run must refuse to merge into the populated destination",
    );
    console.log(
      "Migration self-test passed: full table discovery, FK ordering, admin/client users, " +
        "assignments, JSON/binary data, fingerprints, dry-run safety, and sequence reset.",
    );
  } finally {
    await Promise.allSettled([
      source.close(),
      destination.close(),
      dryRunDestination.close(),
      pristineDestination.close(),
    ]);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
