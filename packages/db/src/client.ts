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
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

function acquirePgliteProcessLock(directory: string): () => void {
  const lockPath = `${directory}.oculis.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
          "utf8",
        );
      } finally {
        closeSync(fd);
      }
      return () => releasePgliteProcessLock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readPgliteLockOwner(lockPath);
      if (owner.kind === "missing") continue;
      if (owner.kind === "ambiguous") {
        throw new Error(
          `PGLITE_DIR lock ${lockPath} has no valid owner PID. Refusing to remove an ambiguous lock; verify that no web/worker process is using this PGlite directory before removing it manually.`,
        );
      }
      if (isProcessAlive(owner.pid)) {
        throw new Error(
          `PGLITE_DIR is already open by PID ${owner.pid}. Stop the local web/worker process before starting another one; PGlite file storage is single-process.`,
        );
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      }
    }
  }
  throw new Error(`Could not acquire the PGlite process lock at ${lockPath}`);
}

type PgliteLockOwner = { kind: "owned"; pid: number } | { kind: "missing" } | { kind: "ambiguous" };

function readPgliteLockOwner(lockPath: string): PgliteLockOwner {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    return Number.isSafeInteger(parsed.pid) && Number(parsed.pid) > 0
      ? { kind: "owned", pid: Number(parsed.pid) }
      : { kind: "ambiguous" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "ambiguous" };
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function releasePgliteProcessLock(lockPath: string): void {
  try {
    const owner = readPgliteLockOwner(lockPath);
    if (owner.kind === "owned" && owner.pid === process.pid) unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
  const canonicalDir = resolvedDir ? realpathSync(resolvedDir) : undefined;
  const releaseLock = canonicalDir ? acquirePgliteProcessLock(canonicalDir) : () => {};
  let client: PGlite;
  try {
    client = new PGlite(canonicalDir); // undefined => in-memory
  } catch (error) {
    releaseLock();
    throw error;
  }
  const db = makeDrizzle("pglite", client);
  return {
    db,
    ensureSchema: () => ensureSchema(db),
    close: async () => {
      try {
        await client.close();
      } finally {
        releaseLock();
      }
    },
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
      source_chamber text,
      origin_chamber text,
      current_chamber text,
      current_body text,
      condition text,
      source_category text,
      subject_matter text,
      category text,
      category_confidence real,
      sponsor text,
      party text,
      province text,
      committee text,
      filed_at text,
      expires_at text,
      initiated text,
      initiated_at text,
      legislature text,
      registration_period text,
      official_status_changed_at text,
      promulgation_number text,
      promulgated_at text,
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
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS source_chamber text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS origin_chamber text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS current_chamber text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS current_body text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS condition text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS subject_matter text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS initiated text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS initiated_at text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS legislature text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS registration_period text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS official_status_changed_at text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS promulgation_number text`,
  `ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS promulgated_at text`,
  `
    CREATE TABLE IF NOT EXISTS initiative_title_translations (
      id serial PRIMARY KEY,
      initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      target_locale text NOT NULL,
      source_title text NOT NULL,
      source_title_hash text NOT NULL,
      translated_title text NOT NULL,
      model text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      withdrawn_at timestamp,
      CONSTRAINT initiative_title_translations_nonempty_check CHECK (
        length(trim(source_title)) > 0
        AND length(trim(translated_title)) > 0
        AND length(trim(model)) > 0
      ),
      CONSTRAINT initiative_title_translations_sha256_check
        CHECK (source_title_hash ~ '^[a-f0-9]{64}$'),
      CONSTRAINT initiative_title_translations_locale_check CHECK (target_locale = 'en')
    )`,
  `ALTER TABLE initiative_title_translations ADD COLUMN IF NOT EXISTS withdrawn_at timestamp`,
  `CREATE UNIQUE INDEX IF NOT EXISTS initiative_title_translations_source_model_uq
     ON initiative_title_translations (initiative_id, target_locale, source_title_hash, model)`,
  `CREATE INDEX IF NOT EXISTS initiative_title_translations_current_idx
     ON initiative_title_translations (
       initiative_id, target_locale, source_title, created_at DESC, id DESC
     )`,
  `CREATE INDEX IF NOT EXISTS initiative_title_translations_candidate_idx
     ON initiative_title_translations (initiative_id, target_locale, model, source_title)`,
  `
    CREATE TABLE IF NOT EXISTS status_events (
      id serial PRIMARY KEY,
      initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      status text NOT NULL,
      event_date text,
      event_end_date text,
      source_event_id text,
      note text,
      source text NOT NULL,
      source_url text,
      evidence_type text NOT NULL DEFAULT 'SOURCE_HISTORY',
      raw jsonb,
      observed_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      retired_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS source text`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS source_url text`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS source_event_id text`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS event_end_date text`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'SOURCE_HISTORY'`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS raw jsonb`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS observed_at timestamp`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS last_seen_at timestamp`,
  `ALTER TABLE status_events ADD COLUMN IF NOT EXISTS retired_at timestamp`,
  `UPDATE status_events
      SET source = 'legacy-unattributed',
          source_url = NULL,
          evidence_type = 'LEGACY_UNATTRIBUTED',
          observed_at = coalesce(observed_at, created_at)
    WHERE source IS NULL`,
  `ALTER TABLE status_events ALTER COLUMN source SET NOT NULL`,
  `ALTER TABLE status_events ALTER COLUMN observed_at SET DEFAULT now()`,
  `ALTER TABLE status_events ALTER COLUMN observed_at SET NOT NULL`,
  `UPDATE status_events
      SET last_seen_at = coalesce(last_seen_at, observed_at, created_at, now())
    WHERE last_seen_at IS NULL`,
  `ALTER TABLE status_events ALTER COLUMN last_seen_at SET DEFAULT now()`,
  `ALTER TABLE status_events ALTER COLUMN last_seen_at SET NOT NULL`,
  `UPDATE status_events AS candidate
      SET source_event_id = nullif(btrim(candidate.raw ->> 'id'), '')
    WHERE candidate.source_event_id IS NULL
      AND candidate.source = 'sil-diputados'
      AND candidate.evidence_type = 'SOURCE_HISTORY'
      AND jsonb_typeof(candidate.raw) = 'object'
      AND nullif(btrim(candidate.raw ->> 'id'), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
          FROM status_events AS duplicate
         WHERE duplicate.id <> candidate.id
           AND duplicate.initiative_id = candidate.initiative_id
           AND duplicate.source = candidate.source
           AND duplicate.evidence_type = candidate.evidence_type
           AND (
             duplicate.source_event_id = nullif(btrim(candidate.raw ->> 'id'), '')
             OR nullif(btrim(duplicate.raw ->> 'id'), '') = nullif(btrim(candidate.raw ->> 'id'), '')
           )
      )`,
  `UPDATE status_events
      SET event_end_date = substring(raw ->> 'fin' from 1 for 10)
    WHERE event_end_date IS NULL
      AND source = 'sil-diputados'
      AND evidence_type = 'SOURCE_HISTORY'
      AND jsonb_typeof(raw) = 'object'
      AND (raw ->> 'fin') ~ '^\\d{4}-\\d{2}-\\d{2}(?:$|[T ])'
      AND CASE
        WHEN substring(raw ->> 'fin' from 1 for 10)
          ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          THEN to_char(
            make_date(
              substring(raw ->> 'fin' from 1 for 4)::int,
              substring(raw ->> 'fin' from 6 for 2)::int,
              1
            ) + (substring(raw ->> 'fin' from 9 for 2)::int - 1),
            'YYYY-MM-DD'
          ) = substring(raw ->> 'fin' from 1 for 10)
        ELSE false
      END`,
  `DROP INDEX IF EXISTS status_events_uq`,
  `DROP INDEX IF EXISTS status_events_null_date_uq`,
  `DROP INDEX IF EXISTS status_events_evidence_uq`,
  `DROP INDEX IF EXISTS status_events_evidence_null_date_uq`,
  `DROP INDEX IF EXISTS status_events_source_dated_uq`,
  `DROP INDEX IF EXISTS status_events_source_undated_uq`,
  `DROP INDEX IF EXISTS status_events_source_id_uq`,
  `DROP INDEX IF EXISTS status_events_source_fallback_uq`,
  `DROP INDEX IF EXISTS status_events_source_version_uq`,
  `CREATE UNIQUE INDEX IF NOT EXISTS status_events_source_version_uq
     ON status_events (
       initiative_id, evidence_type, source, coalesce(source_event_id, ''), status,
       coalesce(event_date, ''), coalesce(event_end_date, ''), coalesce(note, ''),
       coalesce(source_url, ''),
       md5(coalesce(raw::text, ''))
     )
     WHERE evidence_type = 'SOURCE_HISTORY'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS status_events_observed_uq
     ON status_events (initiative_id, status, observed_at, evidence_type)
     WHERE evidence_type = 'OBSERVED_CHANGE'`,
  `CREATE INDEX IF NOT EXISTS status_events_initiative_idx ON status_events (initiative_id)`,
  `
    CREATE TABLE IF NOT EXISTS initiative_commission_assignments (
      id serial PRIMARY KEY,
      initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      source text NOT NULL,
      source_assignment_id text,
      source_type_id text,
      name text,
      type text,
      start_date text,
      end_date text,
      raw jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS initiative_commission_assignments_source_id_uq
     ON initiative_commission_assignments (initiative_id, source, source_assignment_id)
     WHERE source_assignment_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS initiative_commission_assignments_fallback_uq
     ON initiative_commission_assignments (
       initiative_id, source, coalesce(source_type_id, ''), coalesce(name, ''),
       coalesce(type, ''), coalesce(start_date, ''), coalesce(end_date, ''),
       md5(coalesce(raw::text, ''))
     )
     WHERE source_assignment_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS initiative_commission_assignments_initiative_idx
     ON initiative_commission_assignments (initiative_id)`,
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
      source_event_id text,
      scope text NOT NULL,
      chamber text,
      event_date text,
      event_time text,
      location text,
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
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS source_event_id text`,
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS event_time text`,
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS location text`,
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS agenda_url text`,
  `ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS statuses jsonb`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_events_dedupe_uq ON activity_events (source, dedupe_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_events_source_event_uq ON activity_events (source, source_event_id) WHERE source_event_id IS NOT NULL`,
  `UPDATE activity_events
      SET agenda_url = NULL
    WHERE (source = 'sil-actividad' AND agenda_url ~ '^https://www\\.diputadosrd\\.gob\\.do/sil/comision/[0-9]+/?$')
       OR (source = 'senado' AND agenda_url ~ '^https://www\\.senadord\\.gob\\.do/wpfd_file/')`,
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
    CREATE TABLE IF NOT EXISTS initiative_proponents (
      id serial PRIMARY KEY,
      initiative_id integer NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      legislator_id integer REFERENCES legislators(id),
      initiative_source text NOT NULL,
      person_namespace text NOT NULL,
      person_source_id text,
      published_name text NOT NULL,
      principal boolean,
      ordinal integer NOT NULL,
      match_basis text NOT NULL,
      evidence jsonb,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT initiative_proponents_ordinal_check CHECK (ordinal >= 0),
      CONSTRAINT initiative_proponents_match_basis_check CHECK (
        match_basis IN ('official-id', 'official-selector-exact-name', 'unresolved')
      ),
      CONSTRAINT initiative_proponents_nonempty_check CHECK (
        length(trim(initiative_source)) > 0
        AND length(trim(person_namespace)) > 0
        AND length(trim(published_name)) > 0
        AND (person_source_id IS NULL OR length(trim(person_source_id)) > 0)
      ),
      CONSTRAINT initiative_proponents_resolution_check CHECK (
        (match_basis = 'unresolved' AND legislator_id IS NULL)
        OR (match_basis <> 'unresolved' AND legislator_id IS NOT NULL)
      )
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS initiative_proponents_snapshot_ordinal_uq
     ON initiative_proponents (initiative_id, initiative_source, ordinal)`,
  `CREATE INDEX IF NOT EXISTS initiative_proponents_legislator_idx
     ON initiative_proponents (legislator_id)`,
  `CREATE INDEX IF NOT EXISTS initiative_proponents_initiative_idx
     ON initiative_proponents (initiative_id)`,
  `
    CREATE TABLE IF NOT EXISTS initiative_proponent_reconciliation_runs (
      id serial PRIMARY KEY,
      initiative_source text NOT NULL,
      person_namespace text NOT NULL,
      roster_source text NOT NULL,
      chamber text NOT NULL,
      compatibility_version integer NOT NULL,
      resolver_version text NOT NULL,
      status text NOT NULL DEFAULT 'running',
      source_candidate_count integer NOT NULL,
      source_max_initiative_id integer,
      source_fingerprint text NOT NULL,
      processed_candidate_count integer,
      observed_candidate_count integer,
      replaced_candidate_count integer,
      skipped_unobserved_count integer,
      unresolved_proponent_count integer,
      failure_count integer,
      failure_reason text,
      started_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp,
      CONSTRAINT initiative_proponent_reconciliation_identity_check CHECK (
        length(trim(initiative_source)) > 0
        AND length(trim(person_namespace)) > 0
        AND length(trim(roster_source)) > 0
        AND length(trim(chamber)) > 0
        AND length(trim(resolver_version)) > 0
      ),
      CONSTRAINT initiative_proponent_reconciliation_status_check CHECK (
        status IN ('running', 'complete', 'failed')
      ),
      CONSTRAINT initiative_proponent_reconciliation_compat_version_check CHECK (
        compatibility_version > 0
      ),
      CONSTRAINT initiative_proponent_reconciliation_captured_counts_check CHECK (
        source_candidate_count >= 0
        AND (source_max_initiative_id IS NULL OR source_max_initiative_id > 0)
        AND source_fingerprint ~ '^[a-f0-9]{32}$'
      ),
      CONSTRAINT initiative_proponent_reconciliation_result_counts_check CHECK (
        (processed_candidate_count IS NULL OR processed_candidate_count >= 0)
        AND (observed_candidate_count IS NULL OR observed_candidate_count >= 0)
        AND (replaced_candidate_count IS NULL OR replaced_candidate_count >= 0)
        AND (skipped_unobserved_count IS NULL OR skipped_unobserved_count >= 0)
        AND (unresolved_proponent_count IS NULL OR unresolved_proponent_count >= 0)
        AND (failure_count IS NULL OR failure_count >= 0)
      ),
      CONSTRAINT initiative_proponent_reconciliation_completion_check CHECK (
        (status = 'running' AND completed_at IS NULL)
        OR (status <> 'running' AND completed_at IS NOT NULL)
      )
    )`,
  `CREATE INDEX IF NOT EXISTS initiative_proponent_reconciliation_compat_idx
     ON initiative_proponent_reconciliation_runs (
       roster_source, chamber, initiative_source, person_namespace,
       compatibility_version, completed_at DESC
     )`,
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
  `ALTER TABLE IF EXISTS document_summaries RENAME TO retired_document_summaries`,
  `
    CREATE TABLE IF NOT EXISTS document_contents (
      id serial PRIMARY KEY,
      document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      content_hash text NOT NULL,
      source_snapshot jsonb NOT NULL,
      content_text text NOT NULL,
      mime_type text NOT NULL,
      byte_size integer NOT NULL,
      page_count integer NOT NULL,
      character_count integer NOT NULL,
      extracted_at timestamp NOT NULL DEFAULT now(),
      last_verified_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT document_contents_valid_sizes_check
        CHECK (byte_size > 0 AND page_count > 0 AND character_count > 0),
      CONSTRAINT document_contents_sha256_check CHECK (content_hash ~ '^[a-f0-9]{64}$'),
      CONSTRAINT document_contents_source_snapshot_object_check CHECK (
        jsonb_typeof(source_snapshot) = 'object'
        AND source_snapshot ?& ARRAY[
          'initiativeId', 'source', 'sourceDocId', 'url', 'docType', 'uploadedAt', 'modifiedAt'
        ]
        AND jsonb_typeof(source_snapshot -> 'initiativeId') IN ('number', 'null')
        AND jsonb_typeof(source_snapshot -> 'source') = 'string'
        AND jsonb_typeof(source_snapshot -> 'sourceDocId') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'url') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'docType') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'uploadedAt') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'modifiedAt') IN ('string', 'null')
      )
    )`,
  `ALTER TABLE document_contents ADD COLUMN IF NOT EXISTS source_snapshot jsonb`,
  `ALTER TABLE document_contents ADD COLUMN IF NOT EXISTS last_verified_at timestamp`,
  `UPDATE document_contents AS dc
      SET source_snapshot = jsonb_build_object(
        'initiativeId', d.initiative_id,
        'source', d.source,
        'sourceDocId', d.source_doc_id,
        'url', d.url,
        'docType', d.doc_type,
        'uploadedAt', d.uploaded_at,
        'modifiedAt', d.modified_at
      )
     FROM documents AS d
    WHERE dc.document_id = d.id
      AND dc.source_snapshot IS NULL`,
  `UPDATE document_contents
      SET last_verified_at = extracted_at
    WHERE last_verified_at IS NULL`,
  `ALTER TABLE document_contents ALTER COLUMN last_verified_at SET DEFAULT now()`,
  `ALTER TABLE document_contents ALTER COLUMN last_verified_at SET NOT NULL`,
  `ALTER TABLE document_contents ALTER COLUMN source_snapshot SET NOT NULL`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'document_contents_source_snapshot_object_check'
          AND conrelid = 'document_contents'::regclass
     ) THEN
       ALTER TABLE document_contents
         ADD CONSTRAINT document_contents_source_snapshot_object_check CHECK (
           jsonb_typeof(source_snapshot) = 'object'
           AND source_snapshot ?& ARRAY[
             'initiativeId', 'source', 'sourceDocId', 'url', 'docType', 'uploadedAt', 'modifiedAt'
           ]
           AND jsonb_typeof(source_snapshot -> 'initiativeId') IN ('number', 'null')
           AND jsonb_typeof(source_snapshot -> 'source') = 'string'
           AND jsonb_typeof(source_snapshot -> 'sourceDocId') IN ('string', 'null')
           AND jsonb_typeof(source_snapshot -> 'url') IN ('string', 'null')
           AND jsonb_typeof(source_snapshot -> 'docType') IN ('string', 'null')
           AND jsonb_typeof(source_snapshot -> 'uploadedAt') IN ('string', 'null')
           AND jsonb_typeof(source_snapshot -> 'modifiedAt') IN ('string', 'null')
         );
     END IF;
   END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS document_contents_document_hash_snapshot_uq
     ON document_contents (document_id, content_hash, md5(source_snapshot::text))`,
  `DROP INDEX IF EXISTS document_contents_document_hash_uq`,
  `CREATE INDEX IF NOT EXISTS document_contents_hash_idx ON document_contents (content_hash)`,
  `
    CREATE TABLE IF NOT EXISTS document_pdf_verifications (
      id serial PRIMARY KEY,
      document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      source_snapshot jsonb NOT NULL,
      reachable boolean NOT NULL,
      http_status integer,
      mime_type text,
      byte_size integer,
      final_url text,
      error_code text,
      error_message text,
      verified_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT document_pdf_verifications_source_snapshot_object_check CHECK (
        jsonb_typeof(source_snapshot) = 'object'
        AND source_snapshot ?& ARRAY[
          'initiativeId', 'source', 'sourceDocId', 'url', 'docType', 'uploadedAt', 'modifiedAt'
        ]
        AND jsonb_typeof(source_snapshot -> 'initiativeId') IN ('number', 'null')
        AND jsonb_typeof(source_snapshot -> 'source') = 'string'
        AND jsonb_typeof(source_snapshot -> 'sourceDocId') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'url') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'docType') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'uploadedAt') IN ('string', 'null')
        AND jsonb_typeof(source_snapshot -> 'modifiedAt') IN ('string', 'null')
      ),
      CONSTRAINT document_pdf_verifications_outcome_check CHECK (
        (
          reachable = true
          AND http_status IN (200, 206)
          AND mime_type IN ('application/pdf', 'application/octet-stream')
          AND (byte_size IS NULL OR byte_size > 0)
          AND length(trim(final_url)) > 0
          AND error_code IS NULL
          AND error_message IS NULL
        ) OR (
          reachable = false
          AND http_status IS NULL
          AND mime_type IS NULL
          AND byte_size IS NULL
          AND final_url IS NULL
          AND length(trim(error_code)) > 0
          AND length(trim(error_message)) > 0
        )
      )
    )`,
  `ALTER TABLE document_pdf_verifications
     DROP CONSTRAINT IF EXISTS document_pdf_verifications_outcome_check`,
  `ALTER TABLE document_pdf_verifications
     ADD CONSTRAINT document_pdf_verifications_outcome_check CHECK (
       (
         reachable = true
         AND http_status IN (200, 206)
         AND mime_type IN ('application/pdf', 'application/octet-stream')
         AND (byte_size IS NULL OR byte_size > 0)
         AND length(trim(final_url)) > 0
         AND error_code IS NULL
         AND error_message IS NULL
       ) OR (
         reachable = false
         AND http_status IS NULL
         AND mime_type IS NULL
         AND byte_size IS NULL
         AND final_url IS NULL
         AND length(trim(error_code)) > 0
         AND length(trim(error_message)) > 0
       )
     )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS document_pdf_verifications_document_snapshot_uq
     ON document_pdf_verifications (document_id, md5(source_snapshot::text))`,
  `CREATE INDEX IF NOT EXISTS document_pdf_verifications_document_verified_idx
     ON document_pdf_verifications (document_id, verified_at DESC)`,
  `DELETE FROM document_pdf_verifications
    WHERE reachable = false
      AND (
        error_code = 'PDF_FETCH_FAILED'
        OR (
          error_code = 'PDF_HTTP_ERROR'
          AND error_message ~ 'HTTP (408|425|429|5[0-9][0-9])'
        )
      )`,
  `INSERT INTO document_pdf_verifications (
       document_id, source_snapshot, reachable, http_status, mime_type, byte_size,
       final_url, error_code, error_message, verified_at
     )
     SELECT DISTINCT ON (dc.document_id, md5(dc.source_snapshot::text))
       dc.document_id,
       dc.source_snapshot,
       true,
       200,
       'application/pdf',
       dc.byte_size,
       dc.source_snapshot ->> 'url',
       NULL,
       NULL,
       dc.last_verified_at
     FROM document_contents dc
     WHERE dc.byte_size > 0
       AND length(trim(dc.source_snapshot ->> 'url')) > 0
     ORDER BY dc.document_id, md5(dc.source_snapshot::text), dc.last_verified_at DESC
     ON CONFLICT DO NOTHING`,
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
