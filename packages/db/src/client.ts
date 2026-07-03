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
  `CREATE INDEX IF NOT EXISTS initiatives_filed_at_idx ON initiatives (filed_at)`,
  // serves countApprovedBySponsor's exact sponsor = ? match (one query per scored row)
  `CREATE INDEX IF NOT EXISTS initiatives_sponsor_idx ON initiatives (sponsor)`,
  // pg_trgm GIN indexes for searchInitiatives' leading-wildcard ILIKE typeahead.
  // Wrapped in a failure-tolerant DO block: if the cluster can't provide pg_trgm
  // (e.g. PGlite without the extension bundled), the app must still boot — the
  // search then simply seq-scans as before.
  `DO $$ BEGIN
     CREATE EXTENSION IF NOT EXISTS pg_trgm;
     CREATE INDEX IF NOT EXISTS initiatives_title_trgm_idx ON initiatives USING gin (title gin_trgm_ops);
     CREATE INDEX IF NOT EXISTS initiatives_code_trgm_idx ON initiatives USING gin (code gin_trgm_ops);
   EXCEPTION WHEN others THEN NULL;
   END $$`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS sponsor_role text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS sponsor_count integer`,
  // --- Intensive keyword search: normalized blob + generated Spanish tsvector ---
  // `search_text` (a plain text column, portable to PGlite) holds the accent-folded
  // keyword blob (title/purpose/category/sponsor/party/province/committee + curated
  // domain concept tags — see @oculis/core keywordBlob). It's a normal column so the
  // worker's --reindex-search backfill and the ingest path can write it everywhere.
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS search_text text`,
  // The generated tsvector + its GIN index are wrapped in a failure-tolerant DO block:
  // PGlite may lack the 'spanish' text-search config OR generated-column support, and
  // startup must NEVER brick there — searchInitiatives simply falls back to expanded
  // ILIKE when `search_tsv` is absent. On real Postgres this materializes a STORED
  // tsvector that auto-updates whenever search_text changes (no trigger needed), plus a
  // GIN index for fast `@@` full-text matching and a pg_trgm GIN for word_similarity
  // typo tolerance over the blob.
  `DO $$ BEGIN
     ALTER TABLE initiatives
       ADD COLUMN IF NOT EXISTS search_tsv tsvector
       GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(search_text, ''))) STORED;
   EXCEPTION WHEN others THEN NULL;
   END $$`,
  `DO $$ BEGIN
     CREATE INDEX IF NOT EXISTS initiatives_search_tsv_idx ON initiatives USING gin (search_tsv);
   EXCEPTION WHEN others THEN NULL;
   END $$`,
  `DO $$ BEGIN
     CREATE INDEX IF NOT EXISTS initiatives_search_text_trgm_idx ON initiatives USING gin (search_text gin_trgm_ops);
   EXCEPTION WHEN others THEN NULL;
   END $$`,
  `
    CREATE TABLE IF NOT EXISTS status_events (
      id serial PRIMARY KEY,
      initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      status text NOT NULL,
      event_date text,
      note text,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  // NULLS NOT DISTINCT (PG15+): date-less events must dedupe too — a plain UNIQUE
  // index treats each NULL event_date as distinct, so such rows re-insert on every
  // re-scrape.
  `CREATE UNIQUE INDEX IF NOT EXISTS status_events_uq ON status_events (initiative_id, status, event_date) NULLS NOT DISTINCT`,
  // Upgrade path for DBs that already have the old (nulls-distinct) index: dedupe the
  // null-date duplicates it allowed (keep the lowest id), then swap the index. Guarded
  // by pg_index.indnullsnotdistinct so it runs once; failure-tolerant so a weird
  // cluster can never brick app startup (the old index just stays in place).
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = 'status_events_uq' AND NOT i.indnullsnotdistinct
     ) THEN
       DELETE FROM status_events a
         USING status_events b
         WHERE a.initiative_id = b.initiative_id
           AND a.status = b.status
           AND a.event_date IS NULL AND b.event_date IS NULL
           AND a.id > b.id;
       DROP INDEX status_events_uq;
       CREATE UNIQUE INDEX status_events_uq ON status_events (initiative_id, status, event_date) NULLS NOT DISTINCT;
     END IF;
   EXCEPTION WHEN others THEN NULL;
   END $$`,
  `CREATE INDEX IF NOT EXISTS status_events_initiative_idx ON status_events (initiative_id)`,
  `
    CREATE TABLE IF NOT EXISTS score_inputs (
      initiative_id integer PRIMARY KEY REFERENCES initiatives(id) ON DELETE CASCADE,
      party text,
      sponsor_record text,
      executive_support text,
      stakeholder_support text,
      social_pressure_count integer CHECK (social_pressure_count >= 0),
      provenance jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  // Idempotently enforce the non-negative guard on already-created tables too (the
  // CREATE above only applies it to a fresh DB). Verified safe against current data
  // (min social_pressure_count = 1). Postgres has no ADD CONSTRAINT IF NOT EXISTS, so
  // guard on pg_constraint name.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'score_inputs_social_pressure_count_check') THEN
       ALTER TABLE score_inputs ADD CONSTRAINT score_inputs_social_pressure_count_check CHECK (social_pressure_count >= 0);
     END IF;
   END $$`,
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
    CREATE TABLE IF NOT EXISTS legislators (
      id serial PRIMARY KEY,
      source text NOT NULL,
      source_id text NOT NULL,
      chamber text NOT NULL,
      full_name text NOT NULL,
      province text,
      circumscription text,
      party text,
      party_short text,
      role text,
      representation_level text,
      period text,
      photo_url text,
      email text,
      phone text,
      profession text,
      source_url text,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS legislators_source_uq ON legislators (source, source_id)`,
  `CREATE INDEX IF NOT EXISTS legislators_chamber_idx ON legislators (chamber)`,
  `CREATE INDEX IF NOT EXISTS legislators_province_idx ON legislators (province)`,
  `
    CREATE TABLE IF NOT EXISTS commission_members (
      id serial PRIMARY KEY,
      source text NOT NULL,
      chamber text NOT NULL,
      commission_name text NOT NULL,
      commission_source_id text,
      legislator_name text NOT NULL,
      legislator_source_id text,
      cargo text,
      party text,
      source_url text,
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commission_members_uq ON commission_members (source, commission_name, legislator_name)`,
  `CREATE INDEX IF NOT EXISTS commission_members_commission_idx ON commission_members (commission_name)`,
  `CREATE INDEX IF NOT EXISTS commission_members_chamber_idx ON commission_members (chamber)`,
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
  `CREATE INDEX IF NOT EXISTS ingestion_runs_source_started_idx ON ingestion_runs (source, started_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS feed_items (
      id serial PRIMARY KEY,
      source text NOT NULL,
      source_id text NOT NULL,
      kind text NOT NULL,
      title text NOT NULL,
      summary text,
      image_url text,
      url text,
      author text,
      handle text,
      platform text,
      category text,
      published_at timestamp,
      initiative_id integer REFERENCES initiatives(id) ON DELETE SET NULL,
      initiative_code text,
      legislator_source_id text,
      commission_name text,
      chamber text,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS feed_items_source_uq ON feed_items (source, source_id)`,
  `CREATE INDEX IF NOT EXISTS feed_items_published_idx ON feed_items (published_at DESC)`,
  // expression index serving listFeedItems' keyset ordering
  // (coalesce(published_at, first_seen_at) desc, id desc)
  `CREATE INDEX IF NOT EXISTS feed_items_sort_idx ON feed_items ((coalesce(published_at, first_seen_at)) DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS feed_items_kind_idx ON feed_items (kind)`,
  `CREATE INDEX IF NOT EXISTS feed_items_category_idx ON feed_items (category)`,
  `CREATE INDEX IF NOT EXISTS feed_items_initiative_idx ON feed_items (initiative_id)`,
  `CREATE INDEX IF NOT EXISTS feed_items_legislator_idx ON feed_items (legislator_source_id)`,
  `
    CREATE TABLE IF NOT EXISTS feed_item_entities (
      id serial PRIMARY KEY,
      feed_item_id integer NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
      entity_type text NOT NULL,
      initiative_code text,
      initiative_id integer REFERENCES initiatives(id) ON DELETE SET NULL,
      legislator_source_id text,
      commission_name text,
      label text NOT NULL
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS feed_item_entities_uq ON feed_item_entities (feed_item_id, entity_type, label)`,
  `CREATE INDEX IF NOT EXISTS feed_item_entities_initiative_idx ON feed_item_entities (initiative_id)`,
  `CREATE INDEX IF NOT EXISTS feed_item_entities_legislator_idx ON feed_item_entities (legislator_source_id)`,
  `
    CREATE TABLE IF NOT EXISTS feed_accounts (
      id serial PRIMARY KEY,
      name text NOT NULL,
      handle text NOT NULL,
      platform text NOT NULL,
      url text NOT NULL,
      kind text NOT NULL,
      chamber text,
      legislator_source_id text,
      influence_rank integer,
      active boolean NOT NULL DEFAULT true,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS feed_accounts_uq ON feed_accounts (platform, handle)`,
  `CREATE INDEX IF NOT EXISTS feed_accounts_kind_idx ON feed_accounts (kind)`,
  `CREATE INDEX IF NOT EXISTS feed_accounts_active_idx ON feed_accounts (active)`,
  `CREATE INDEX IF NOT EXISTS feed_accounts_legislator_idx ON feed_accounts (legislator_source_id)`,
];
