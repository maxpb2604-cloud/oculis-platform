/**
 * Drizzle schema (Postgres) for Oculis Auribus.
 *
 * Modeled on the canonical `RawInitiative` produced by scraper adapters plus the
 * derived categorization + scoring fields. Enum-like columns are stored as text and
 * validated in the app layer against `@oculis/core` types (keeps migrations simple and
 * portable to PGlite for local/dev).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** One initiative (legislative or regulatory), canonical across sources. */
export const initiatives = pgTable(
  "initiatives",
  {
    id: serial("id").primaryKey(),

    // --- identity ---
    source: text("source").notNull(), // adapter key, e.g. "sil-diputados"
    sourceId: text("source_id").notNull(), // stable id within the source
    kind: text("kind").notNull(), // LEGISLATIVE | REGULATORY
    code: text("code"), // official code, e.g. "05956-2024-2028-CD"

    // --- content ---
    title: text("title").notNull(),
    purpose: text("purpose"),
    type: text("type"), // source-reported type label
    status: text("status"), // source-reported current status
    chamber: text("chamber"), // SENADO | DIPUTADOS | null

    // --- categorization ---
    sourceCategory: text("source_category"), // source's own subject/group label
    category: text("category"), // our taxonomy (Category), null until categorized
    categoryConfidence: real("category_confidence"),

    // --- sponsor / provenance ---
    sponsor: text("sponsor"),
    party: text("party"),
    province: text("province"),
    committee: text("committee"),
    filedAt: text("filed_at"), // ISO date string (yyyy-mm-dd)
    expiresAt: text("expires_at"),
    sourceUrl: text("source_url"),

    // --- scoring (null until scored) ---
    riskLevel: text("risk_level"), // ALTO | MEDIO | BAJO
    approvalProbability: text("approval_probability"), // ALTA | MEDIA | BAJA
    approvalScore: integer("approval_score"),

    // --- workflow ---
    needsReview: boolean("needs_review").notNull().default(true),
    published: boolean("published").notNull().default(false),

    // --- audit ---
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bySource: uniqueIndex("initiatives_source_source_id_uq").on(t.source, t.sourceId),
    byCategory: index("initiatives_category_idx").on(t.category),
    byRisk: index("initiatives_risk_idx").on(t.riskLevel),
    byChamber: index("initiatives_chamber_idx").on(t.chamber),
  }),
);

/** Status-change timeline per initiative (powers history / calendar views). */
export const statusEvents = pgTable(
  "status_events",
  {
    id: serial("id").primaryKey(),
    initiativeId: integer("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    eventDate: text("event_date"), // ISO date
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // dedupe identical (initiative, status, date) events across re-scrapes
    uq: uniqueIndex("status_events_uq").on(t.initiativeId, t.status, t.eventDate),
    byInitiative: index("status_events_initiative_idx").on(t.initiativeId),
  }),
);

/**
 * The five scoring inputs per initiative (one row each), with provenance so the
 * analyst-review (hybrid scoring) workflow can track auto vs human values.
 */
export const scoreInputs = pgTable("score_inputs", {
  initiativeId: integer("initiative_id")
    .primaryKey()
    .references(() => initiatives.id, { onDelete: "cascade" }),
  party: text("party"), // PartyStrength
  sponsorRecord: text("sponsor_record"), // SponsorTrackRecord
  executiveSupport: text("executive_support"), // YesNo
  stakeholderSupport: text("stakeholder_support"), // YesNo
  socialPressureCount: integer("social_pressure_count"),
  // which fields were auto-derived vs estimated vs analyst-set
  provenance: jsonb("provenance"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Daily committee / plenary agenda activity (SIL "actividad" subsystem).
 *
 * SEGMENTED from `initiatives`: this is meeting/agenda activity ("what the chamber
 * worked on today"), not the bills themselves. One row per agenda item; the
 * many-to-many link to the initiatives discussed lives in `activityInitiatives`.
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // "sil-actividad"
    scope: text("scope").notNull(), // COMMITTEE | PLENARY
    eventDate: text("event_date"), // ISO date (yyyy-mm-dd)
    kind: text("kind"), // "Reunión", "Encuentros…", "Orden del Día"
    body: text("body"), // committee name (COMMITTEE) or chamber (PLENARY)
    description: text("description").notNull(),
    // synthesized from content (the source carries no stable id) → dedupe re-scrapes
    dedupeKey: text("dedupe_key").notNull(),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("activity_events_dedupe_uq").on(t.source, t.dedupeKey),
    byDate: index("activity_events_date_idx").on(t.eventDate),
    byScope: index("activity_events_scope_idx").on(t.scope),
  }),
);

/** Link table: which initiatives (by official code) each agenda item references. */
export const activityInitiatives = pgTable(
  "activity_initiatives",
  {
    id: serial("id").primaryKey(),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activityEvents.id, { onDelete: "cascade" }),
    // referenced by official code; resolved to initiatives.id when/if that bill is ingested
    initiativeCode: text("initiative_code").notNull(),
    initiativeId: integer("initiative_id").references(() => initiatives.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    uq: uniqueIndex("activity_initiatives_uq").on(t.activityId, t.initiativeCode),
    byCode: index("activity_initiatives_code_idx").on(t.initiativeCode),
  }),
);

/** Per-source crawl bookkeeping for incremental ingestion + health checks. */
export const ingestionRuns = pgTable("ingestion_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  seen: integer("seen").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  statusChanges: integer("status_changes").notNull().default(0),
  ok: boolean("ok"),
  error: text("error"),
});

export type Initiative = typeof initiatives.$inferSelect;
export type NewInitiative = typeof initiatives.$inferInsert;
export type StatusEvent = typeof statusEvents.$inferSelect;
export type ScoreInputRow = typeof scoreInputs.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;
export type ActivityInitiative = typeof activityInitiatives.$inferSelect;
