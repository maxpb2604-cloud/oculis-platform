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
import { isAbsolute, resolve } from "node:path";
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
    const configuredMax = Number(process.env.PG_POOL_MAX ?? 5);
    const pool = new pg.Pool({
      connectionString: url,
      max: Number.isSafeInteger(configuredMax) && configuredMax > 0 ? configuredMax : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      application_name: process.env.OCULIS_DB_APP_NAME ?? "oculis",
    });
    const db = makeDrizzle("pg", pool);
    return {
      db,
      ensureSchema: () => ensureSchema(db),
      close: () => pool.end(),
    };
  }
  const production =
    process.env.NODE_ENV === "production" || process.env.OCULIS_ENV === "production";
  if (production && process.env.DB_DRIVER !== "pglite") {
    throw new Error(
      "DATABASE_URL is required in production. Set DB_DRIVER=pglite only for an intentional embedded deployment.",
    );
  }
  const dir = process.env.PGLITE_DIR;
  const resolvedDir = dir ? (isAbsolute(dir) ? dir : resolve(process.cwd(), dir)) : undefined;
  if (resolvedDir) mkdirSync(resolvedDir, { recursive: true }); // PGlite's own mkdir isn't recursive
  const client = new PGlite(resolvedDir); // undefined => in-memory
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
      needs_review boolean NOT NULL DEFAULT false,
      published boolean NOT NULL DEFAULT false,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS initiatives_source_source_id_uq ON initiatives (source, source_id)`,
  `CREATE INDEX IF NOT EXISTS initiatives_source_category_idx ON initiatives (source_category)`,
  `CREATE INDEX IF NOT EXISTS initiatives_chamber_idx ON initiatives (chamber)`,
  `CREATE INDEX IF NOT EXISTS initiatives_filed_at_idx ON initiatives (filed_at)`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS sponsor_role text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS sponsor_count integer`,
  `
    CREATE TABLE IF NOT EXISTS status_events (
      id serial PRIMARY KEY,
      initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      status text NOT NULL,
      event_date text,
      note text,
      source text NOT NULL,
      source_url text,
      evidence_type text NOT NULL DEFAULT 'SOURCE_HISTORY',
      raw jsonb,
      observed_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS source text`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS source_url text`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'SOURCE_HISTORY'`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS raw jsonb`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS observed_at timestamp`,
  `UPDATE status_events
      SET source = 'legacy-unattributed',
          source_url = NULL,
          evidence_type = 'LEGACY_UNATTRIBUTED',
          observed_at = coalesce(observed_at, created_at)
    WHERE source IS NULL`,
  `UPDATE status_events
      SET source = 'legacy-unattributed', source_url = NULL,
          evidence_type = 'LEGACY_UNATTRIBUTED'
    WHERE evidence_type = 'SOURCE_HISTORY' AND raw IS NULL`,
  `ALTER TABLE status_events ALTER COLUMN source SET NOT NULL`,
  `ALTER TABLE status_events ALTER COLUMN observed_at SET DEFAULT now()`,
  `ALTER TABLE status_events ALTER COLUMN observed_at SET NOT NULL`,
  `DROP INDEX IF EXISTS status_events_uq`,
  `DROP INDEX IF EXISTS status_events_null_date_uq`,
  `DROP INDEX IF EXISTS status_events_evidence_uq`,
  `DROP INDEX IF EXISTS status_events_evidence_null_date_uq`,
  `DROP INDEX IF EXISTS status_events_source_dated_uq`,
  `DROP INDEX IF EXISTS status_events_source_undated_uq`,
  `CREATE UNIQUE INDEX IF NOT EXISTS status_events_source_dated_uq
     ON status_events (initiative_id, status, event_date, evidence_type, source, coalesce(source_url, ''))
     WHERE evidence_type = 'SOURCE_HISTORY' AND event_date IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS status_events_source_undated_uq
     ON status_events (initiative_id, status, evidence_type, source, coalesce(source_url, ''))
     WHERE evidence_type = 'SOURCE_HISTORY' AND event_date IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS status_events_observed_uq
     ON status_events (initiative_id, status, observed_at, evidence_type)
     WHERE evidence_type = 'OBSERVED_CHANGE'`,
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
    CREATE TABLE IF NOT EXISTS inference_audit (
      id serial PRIMARY KEY,
      entity_type text NOT NULL,
      entity_id integer NOT NULL,
      inference_kind text NOT NULL,
      value jsonb NOT NULL,
      provenance jsonb,
      archived_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inference_audit_entity_kind_uq ON inference_audit (entity_type, entity_id, inference_kind)`,
  `CREATE INDEX IF NOT EXISTS inference_audit_entity_idx ON inference_audit (entity_type, entity_id)`,
  `
    CREATE TABLE IF NOT EXISTS activity_events (
      id serial PRIMARY KEY,
      source text NOT NULL,
      scope text NOT NULL,
      chamber text,
      event_date text,
      event_time text,
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
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS event_time text`,
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
      active boolean NOT NULL DEFAULT true,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS legislators_source_uq ON legislators (source, source_id)`,
  `CREATE INDEX IF NOT EXISTS legislators_chamber_idx ON legislators (chamber)`,
  `CREATE INDEX IF NOT EXISTS legislators_province_idx ON legislators (province)`,
  `ALTER TABLE legislators ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
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
      active boolean NOT NULL DEFAULT true,
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commission_members_uq ON commission_members (source, commission_name, legislator_name)`,
  `CREATE INDEX IF NOT EXISTS commission_members_commission_idx ON commission_members (commission_name)`,
  `CREATE INDEX IF NOT EXISTS commission_members_chamber_idx ON commission_members (chamber)`,
  `ALTER TABLE commission_members ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
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
      modified_at text,
      source_category text,
      source_fragment text,
      source_doc_id text,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now()
    )`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS modified_at text`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_category text`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_fragment text`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS raw jsonb`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_seen_at timestamp NOT NULL DEFAULT now()`,
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
      source_category text,
      intervention_level text,
      category text,
      province text,
      is_consulta boolean,
      published_at text,
      deadline text,
      url text,
      needs_review boolean NOT NULL DEFAULT false,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`,
  `ALTER TABLE regulations ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now()`,
  `ALTER TABLE regulations ADD COLUMN IF NOT EXISTS source_category text`,
  `ALTER TABLE regulations ALTER COLUMN is_consulta DROP DEFAULT`,
  `ALTER TABLE regulations ALTER COLUMN is_consulta DROP NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS regulations_source_uq ON regulations (source, source_id)`,
  `CREATE INDEX IF NOT EXISTS regulations_institution_idx ON regulations (institution)`,
  `CREATE INDEX IF NOT EXISTS regulations_source_category_idx ON regulations (source_category)`,
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
  `CREATE INDEX IF NOT EXISTS feed_items_chronology_idx ON feed_items (coalesce(published_at, first_seen_at) DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS feed_items_kind_idx ON feed_items (kind)`,
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
  `INSERT INTO inference_audit (entity_type, entity_id, inference_kind, value, provenance)
   SELECT 'initiative', id, 'legacy_inference',
          jsonb_build_object(
            'category', category,
            'categoryConfidence', category_confidence,
            'riskLevel', risk_level,
            'approvalProbability', approval_probability,
            'approvalScore', approval_score,
            'needsReview', needs_review,
            'published', published
          ),
          jsonb_build_object('source', source, 'sourceCategory', source_category, 'sourceUrl', source_url)
     FROM initiatives
    WHERE category IS NOT NULL OR category_confidence IS NOT NULL OR risk_level IS NOT NULL
       OR approval_probability IS NOT NULL OR approval_score IS NOT NULL
       OR needs_review = true OR published = true
   ON CONFLICT (entity_type, entity_id, inference_kind) DO UPDATE
     SET value = excluded.value, provenance = excluded.provenance, archived_at = now()`,
  `INSERT INTO inference_audit (entity_type, entity_id, inference_kind, value, provenance)
   SELECT 'initiative', initiative_id, 'legacy_score_inputs',
          jsonb_build_object(
            'party', party,
            'sponsorRecord', sponsor_record,
            'executiveSupport', executive_support,
            'stakeholderSupport', stakeholder_support,
            'socialPressureCount', social_pressure_count
          ), provenance
     FROM score_inputs
   ON CONFLICT (entity_type, entity_id, inference_kind) DO UPDATE
     SET value = excluded.value, provenance = excluded.provenance, archived_at = now()`,
  `INSERT INTO inference_audit (entity_type, entity_id, inference_kind, value, provenance)
   SELECT 'regulation', id, 'legacy_inference',
          jsonb_build_object('interventionLevel', intervention_level, 'category', category, 'needsReview', needs_review),
          jsonb_build_object('source', source, 'sourceUrl', url)
     FROM regulations
    WHERE intervention_level IS NOT NULL OR category IS NOT NULL OR needs_review = true
   ON CONFLICT (entity_type, entity_id, inference_kind) DO UPDATE
     SET value = excluded.value, provenance = excluded.provenance, archived_at = now()`,
  `INSERT INTO inference_audit (entity_type, entity_id, inference_kind, value, provenance)
   SELECT 'feed_item', id, 'legacy_category', jsonb_build_object('category', category),
          jsonb_build_object('source', source, 'sourceUrl', url)
     FROM feed_items WHERE category IS NOT NULL
   ON CONFLICT (entity_type, entity_id, inference_kind) DO UPDATE
     SET value = excluded.value, provenance = excluded.provenance, archived_at = now()`,
  `INSERT INTO inference_audit (entity_type, entity_id, inference_kind, value, provenance)
   SELECT 'feed_account', id, 'legacy_influence_rank', jsonb_build_object('influenceRank', influence_rank),
          jsonb_build_object('platform', platform, 'handle', handle, 'url', url)
     FROM feed_accounts WHERE influence_rank IS NOT NULL
   ON CONFLICT (entity_type, entity_id, inference_kind) DO UPDATE
     SET value = excluded.value, provenance = excluded.provenance, archived_at = now()`,
  `UPDATE initiatives
      SET category = NULL, category_confidence = NULL, risk_level = NULL,
          approval_probability = NULL, approval_score = NULL,
          needs_review = false, published = false
    WHERE category IS NOT NULL OR category_confidence IS NOT NULL OR risk_level IS NOT NULL
       OR approval_probability IS NOT NULL OR approval_score IS NOT NULL
       OR needs_review = true OR published = true`,
  `DELETE FROM score_inputs`,
  `UPDATE regulations SET intervention_level = NULL, category = NULL, needs_review = false
    WHERE intervention_level IS NOT NULL OR category IS NOT NULL OR needs_review = true`,
  `UPDATE feed_items SET category = NULL WHERE category IS NOT NULL`,
  `UPDATE feed_accounts SET influence_rank = NULL WHERE influence_rank IS NOT NULL`,
  `ALTER TABLE initiatives ALTER COLUMN needs_review SET DEFAULT false`,
  `ALTER TABLE regulations ALTER COLUMN needs_review SET DEFAULT false`,
  `DROP INDEX IF EXISTS initiatives_category_idx`,
  `DROP INDEX IF EXISTS initiatives_risk_idx`,
  `DROP INDEX IF EXISTS regulations_intervention_idx`,
  `DROP INDEX IF EXISTS feed_items_category_idx`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'initiatives_no_inferred_values_check') THEN
       ALTER TABLE initiatives ADD CONSTRAINT initiatives_no_inferred_values_check
         CHECK (category IS NULL AND category_confidence IS NULL AND risk_level IS NULL
                AND approval_probability IS NULL AND approval_score IS NULL
                AND needs_review = false AND published = false);
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulations_no_inferred_values_check') THEN
       ALTER TABLE regulations ADD CONSTRAINT regulations_no_inferred_values_check
         CHECK (intervention_level IS NULL AND category IS NULL AND needs_review = false);
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_items_no_inferred_category_check') THEN
       ALTER TABLE feed_items ADD CONSTRAINT feed_items_no_inferred_category_check CHECK (category IS NULL);
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_accounts_no_influence_rank_check') THEN
       ALTER TABLE feed_accounts ADD CONSTRAINT feed_accounts_no_influence_rank_check CHECK (influence_rank IS NULL);
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'score_inputs_no_inferred_values_check') THEN
       ALTER TABLE score_inputs ADD CONSTRAINT score_inputs_no_inferred_values_check
         CHECK (party IS NULL AND sponsor_record IS NULL AND executive_support IS NULL
                AND stakeholder_support IS NULL AND social_pressure_count IS NULL);
     END IF;
   END $$`,
];
