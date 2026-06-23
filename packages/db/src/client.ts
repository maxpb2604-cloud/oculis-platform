/**
 * Database client factory.
 *
 * - If `DATABASE_URL` is set -> real Postgres via node-postgres (local or AWS RDS).
 * - Otherwise -> embedded PGlite (WASM Postgres), in-memory by default, or file-backed
 *   when `PGLITE_DIR` is set. Lets the worker + tests run with zero install.
 *
 * Either way you get the same Drizzle API and the same schema.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import pg from "pg";
import * as schema from "./schema.js";

/**
 * Canonical DB type. PGlite and node-postgres expose the same `PgDatabase`
 * query-builder API, so we pin one concrete type to avoid union-overload errors.
 */
export type Database = NodePgDatabase<typeof schema>;

function makeDrizzle(driver: "pg" | "pglite", handle: unknown): Database {
  const db =
    driver === "pg"
      ? drizzlePg(handle as pg.Pool, { schema })
      : drizzlePglite(handle as PGlite, { schema });
  return db as unknown as Database;
}

export interface DbHandle {
  db: Database;
  /** Apply the schema (idempotent DDL). Use migrations in prod; this is for dev/test. */
  ensureSchema(): Promise<void>;
  close(): Promise<void>;
}

export function createDb(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const db = makeDrizzle("pg", pool);
    return {
      db,
      ensureSchema: () => ensureSchema(db),
      close: () => pool.end(),
    };
  }
  const dir = process.env.PGLITE_DIR;
  if (dir) mkdirSync(dir, { recursive: true }); // PGlite's own mkdir isn't recursive
  const client = new PGlite(dir); // undefined => in-memory
  const db = makeDrizzle("pglite", client);
  return {
    db,
    ensureSchema: () => ensureSchema(db),
    close: () => client.close(),
  };
}

/**
 * Create tables if absent. Kept in sync with schema.ts. For production prefer
 * `drizzle-kit` migrations; this guarantees the worker can bootstrap a fresh dev DB.
 */
async function ensureSchema(db: Database): Promise<void> {
  for (const stmt of DDL) await db.execute(sql.raw(stmt));
}

const DDL: string[] = [
  `
    CREATE TABLE IF NOT EXISTS initiatives (
      id serial PRIMARY KEY,
      source text NOT NULL,
      source_id text NOT NULL,
      kind text NOT NULL,
      code text,
      title text NOT NULL,
      purpose text,
      type text,
      status text,
      chamber text,
      source_category text,
      category text,
      category_confidence real,
      sponsor text,
      party text,
      province text,
      committee text,
      filed_at text,
      expires_at text,
      source_url text,
      risk_level text,
      approval_probability text,
      approval_score integer,
      needs_review boolean NOT NULL DEFAULT true,
      published boolean NOT NULL DEFAULT false,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS initiatives_source_source_id_uq ON initiatives (source, source_id)`,
  `CREATE INDEX IF NOT EXISTS initiatives_category_idx ON initiatives (category)`,
  `CREATE INDEX IF NOT EXISTS initiatives_risk_idx ON initiatives (risk_level)`,
  `CREATE INDEX IF NOT EXISTS initiatives_chamber_idx ON initiatives (chamber)`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS sponsor_role text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS sponsor_count integer`,
  `
    CREATE TABLE IF NOT EXISTS status_events (
      id serial PRIMARY KEY,
      initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      status text NOT NULL,
      event_date text,
      note text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS status_events_uq ON status_events (initiative_id, status, event_date)`,
  `CREATE INDEX IF NOT EXISTS status_events_initiative_idx ON status_events (initiative_id)`,
  `
    CREATE TABLE IF NOT EXISTS score_inputs (
      initiative_id integer PRIMARY KEY REFERENCES initiatives(id) ON DELETE CASCADE,
      party text,
      sponsor_record text,
      executive_support text,
      stakeholder_support text,
      social_pressure_count integer,
      provenance jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `
    CREATE TABLE IF NOT EXISTS activity_events (
      id serial PRIMARY KEY,
      source text NOT NULL,
      scope text NOT NULL,
      chamber text,
      event_date text,
      kind text,
      body text,
      description text NOT NULL,
      agenda_url text,
      statuses jsonb,
      dedupe_key text NOT NULL,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now()
    )`,
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS chamber text`,
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS agenda_url text`,
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS statuses jsonb`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_events_dedupe_uq ON activity_events (source, dedupe_key)`,
  `CREATE INDEX IF NOT EXISTS activity_events_date_idx ON activity_events (event_date)`,
  `CREATE INDEX IF NOT EXISTS activity_events_scope_idx ON activity_events (scope)`,
  `
    CREATE TABLE IF NOT EXISTS activity_initiatives (
      id serial PRIMARY KEY,
      activity_id integer NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
      initiative_code text NOT NULL,
      initiative_id integer REFERENCES initiatives(id) ON DELETE SET NULL
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_initiatives_uq ON activity_initiatives (activity_id, initiative_code)`,
  `CREATE INDEX IF NOT EXISTS activity_initiatives_code_idx ON activity_initiatives (initiative_code)`,
  `
    CREATE TABLE IF NOT EXISTS commissions (
      id serial PRIMARY KEY,
      source text NOT NULL,
      chamber text NOT NULL,
      name text NOT NULL,
      president text,
      source_id text,
      source_url text,
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commissions_uq ON commissions (source, chamber, name)`,
  `CREATE INDEX IF NOT EXISTS commissions_chamber_idx ON commissions (chamber)`,
  `
    CREATE TABLE IF NOT EXISTS documents (
      id serial PRIMARY KEY,
      source text NOT NULL,
      initiative_id integer REFERENCES initiatives(id) ON DELETE CASCADE,
      initiative_code text,
      doc_type text,
      extension text,
      url text,
      uploaded_at text,
      source_doc_id text,
      first_seen_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS documents_uq ON documents (source, source_doc_id)`,
  `CREATE INDEX IF NOT EXISTS documents_initiative_idx ON documents (initiative_id)`,
  `CREATE INDEX IF NOT EXISTS documents_code_idx ON documents (initiative_code)`,
  `
    CREATE TABLE IF NOT EXISTS regulations (
      id serial PRIMARY KEY,
      source text NOT NULL,
      source_id text NOT NULL,
      institution text NOT NULL,
      reg_type text,
      title text NOT NULL,
      purpose text,
      status text,
      intervention_level text,
      category text,
      province text,
      is_consulta boolean NOT NULL DEFAULT false,
      published_at text,
      deadline text,
      url text,
      needs_review boolean NOT NULL DEFAULT true,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS regulations_source_uq ON regulations (source, source_id)`,
  `CREATE INDEX IF NOT EXISTS regulations_institution_idx ON regulations (institution)`,
  `CREATE INDEX IF NOT EXISTS regulations_intervention_idx ON regulations (intervention_level)`,
  `CREATE INDEX IF NOT EXISTS regulations_consulta_idx ON regulations (is_consulta)`,
  `
    CREATE TABLE IF NOT EXISTS ingestion_runs (
      id serial PRIMARY KEY,
      source text NOT NULL,
      started_at timestamp NOT NULL DEFAULT now(),
      finished_at timestamp,
      seen integer NOT NULL DEFAULT 0,
      inserted integer NOT NULL DEFAULT 0,
      updated integer NOT NULL DEFAULT 0,
      status_changes integer NOT NULL DEFAULT 0,
      ok boolean,
      error text,
      details jsonb
    )`,
  `ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS details jsonb`,
];
