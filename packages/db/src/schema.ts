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
    sponsor: text("sponsor"), // principal proponente (full name)
    sponsorRole: text("sponsor_role"), // their function, e.g. "Diputado" / "Senador"
    sponsorCount: integer("sponsor_count"), // total proponentes (for "y N más")
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
    byFiledAt: index("initiatives_filed_at_idx").on(t.filedAt),
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
    source: text("source").notNull(), // "sil-actividad" | "dip-oficial" | "senado"
    scope: text("scope").notNull(), // COMMITTEE | PLENARY | ASAMBLEA
    chamber: text("chamber"), // DIPUTADOS | SENADO
    eventDate: text("event_date"), // ISO date (yyyy-mm-dd)
    kind: text("kind"), // "Reunión", "Encuentros…", "Orden del Día"
    body: text("body"), // committee name (COMMITTEE) or chamber (PLENARY)
    description: text("description").notNull(),
    agendaUrl: text("agenda_url"), // source PDF / page for this agenda item
    statuses: jsonb("statuses"), // structured reading/processing statuses (string[])
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

/** Congressional committees (both chambers), with their current president. */
export const commissions = pgTable(
  "commissions",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    chamber: text("chamber").notNull(), // DIPUTADOS | SENADO
    name: text("name").notNull(),
    president: text("president"),
    sourceId: text("source_id"), // id within the source when available
    sourceUrl: text("source_url"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("commissions_uq").on(t.source, t.chamber, t.name),
    byChamber: index("commissions_chamber_idx").on(t.chamber),
  }),
);

/**
 * Documents attached to an initiative (deposited text, committee reports, approved
 * text…). Powers the "publicado / no publicado" indicator and the per-initiative
 * document links. SEGMENTED from initiatives so we can track publication over time.
 */
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    initiativeId: integer("initiative_id").references(() => initiatives.id, {
      onDelete: "cascade",
    }),
    initiativeCode: text("initiative_code"), // code even if the bill isn't ingested yet
    docType: text("doc_type"), // "PROYECTO DEPOSITADO", "INFORME COMISIÓN", …
    extension: text("extension"), // "pdf"
    url: text("url"), // official view/download URL
    uploadedAt: text("uploaded_at"), // ISO date the source uploaded it
    sourceDocId: text("source_doc_id"), // stable id within the source
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("documents_uq").on(t.source, t.sourceDocId),
    byInitiative: index("documents_initiative_idx").on(t.initiativeId),
    byCode: index("documents_code_idx").on(t.initiativeCode),
  }),
);

/**
 * Regulatory instruments (norms/resolutions/reglamentos/NORDOM) from DR regulatory
 * institutions — the REGULATORY twin of `initiatives`. Mirrors the columns of the
 * Monitoreo Regulatorio workbook. The high-value signal is `interventionLevel`
 * (HIGH when still a draft/consulta-pública, LOW once published).
 */
export const regulations = pgTable(
  "regulations",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // adapter key, e.g. "reg-mispas"
    sourceId: text("source_id").notNull(),
    institution: text("institution").notNull(), // acronym, e.g. "MISPAS"
    regType: text("reg_type"), // Reglamento | Resolución | Norma | NORDOM | …
    title: text("title").notNull(),
    purpose: text("purpose"),
    status: text("status"), // regulatory lifecycle status (Spanish/English label)
    interventionLevel: text("intervention_level"), // HIGH | INTERMEDIATE | LOW
    category: text("category"), // our taxonomy, null until categorized
    province: text("province"),
    isConsulta: boolean("is_consulta").notNull().default(false), // public consultation / draft
    publishedAt: text("published_at"), // ISO date
    deadline: text("deadline"), // consulta comment deadline, if any
    url: text("url"), // source page / PDF
    needsReview: boolean("needs_review").notNull().default(true),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("regulations_source_uq").on(t.source, t.sourceId),
    byInstitution: index("regulations_institution_idx").on(t.institution),
    byIntervention: index("regulations_intervention_idx").on(t.interventionLevel),
    byConsulta: index("regulations_consulta_idx").on(t.isConsulta),
  }),
);

/**
 * Elected-legislator roster (both chambers) — the full membership of Congress, not just
 * the subset that has sponsored an initiative. Populated by the roster scrapers
 * (`roster-diputados` via the SIL JSON API, `roster-senado` via HTML). This is what lets
 * the map and the /congreso page list every senator and deputy by province.
 */
export const legislators = pgTable(
  "legislators",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // "roster-diputados" | "roster-senado"
    sourceId: text("source_id").notNull(), // stable id within the source (API id or province slug)
    chamber: text("chamber").notNull(), // DIPUTADOS | SENADO
    fullName: text("full_name").notNull(),
    province: text("province"), // represented province (Senate: 1 per province + DN)
    circumscription: text("circumscription"), // circunscripción (Diputados), when applicable
    party: text("party"), // full party name
    partyShort: text("party_short"), // siglas, e.g. "PRM"
    role: text("role"), // directive-board role, e.g. "Presidente del Senado", else null
    representationLevel: text("representation_level"), // Provincial | Nacional | Exterior
    period: text("period"), // e.g. "2024-2028"
    photoUrl: text("photo_url"),
    email: text("email"),
    phone: text("phone"),
    profession: text("profession"),
    sourceUrl: text("source_url"),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("legislators_source_uq").on(t.source, t.sourceId),
    byChamber: index("legislators_chamber_idx").on(t.chamber),
    byProvince: index("legislators_province_idx").on(t.province),
  }),
);

/**
 * Membership of a committee: who sits on each comisión and with what role (cargo).
 * SEGMENTED from `commissions` (which carries only the president) so we can list
 * president, vice-president, secretary and every member. One row per (commission, person).
 */
export const commissionMembers = pgTable(
  "commission_members",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    chamber: text("chamber").notNull(), // DIPUTADOS | SENADO
    commissionName: text("commission_name").notNull(),
    commissionSourceId: text("commission_source_id"), // id within the source when available
    legislatorName: text("legislator_name").notNull(),
    legislatorSourceId: text("legislator_source_id"), // links to legislators.sourceId when known
    cargo: text("cargo"), // Presidente | Vicepresidente | Secretario | Miembro
    party: text("party"),
    sourceUrl: text("source_url"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("commission_members_uq").on(t.source, t.commissionName, t.legislatorName),
    byCommission: index("commission_members_commission_idx").on(t.commissionName),
    byChamber: index("commission_members_chamber_idx").on(t.chamber),
  }),
);

/** Per-source crawl bookkeeping for incremental ingestion + health checks. */
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
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
    // flagged gaps / health notes (e.g. Senate reCAPTCHA blocked a section)
    details: jsonb("details"),
  },
  (t) => ({
    // serves latestRunsBySource's `distinct on (source) … order by source, started_at desc`
    bySourceStarted: index("ingestion_runs_source_started_idx").on(t.source, t.startedAt.desc()),
  }),
);

/**
 * Feed window: news, official posts, social posts, and our own legislative signals —
 * one chronological stream. The denormalized "primary" entity columns power the fast
 * left-panel filters; the full set of tags (a card can mention several bills/people)
 * lives in `feedItemEntities`. Mirrors the `initiatives` (source,sourceId) upsert idiom.
 */
export const feedItems = pgTable(
  "feed_items",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // adapter key, e.g. "feed-senado", "feed-diariolibre", "feed-x", "feed-legislative"
    sourceId: text("source_id").notNull(), // stable id within the source (guid, status id, "deposit:<id>")
    kind: text("kind").notNull(), // NEWS | OFFICIAL | SOCIAL | LEGISLATIVE
    title: text("title").notNull(),
    summary: text("summary"),
    imageUrl: text("image_url"),
    url: text("url"), // canonical link back to the source
    author: text("author"), // byline / account display name
    handle: text("handle"), // @handle for social
    platform: text("platform"), // X | INSTAGRAM | RSS | WEB
    category: text("category"), // our taxonomy (Category), null until tagged
    publishedAt: timestamp("published_at"), // real datetime — the feed orders by this
    // --- primary entity link (denormalized for single-column left-panel filters) ---
    initiativeId: integer("initiative_id").references(() => initiatives.id, { onDelete: "set null" }),
    initiativeCode: text("initiative_code"),
    legislatorSourceId: text("legislator_source_id"),
    commissionName: text("commission_name"),
    chamber: text("chamber"), // SENADO | DIPUTADOS | null
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("feed_items_source_uq").on(t.source, t.sourceId),
    byPublished: index("feed_items_published_idx").on(t.publishedAt.desc()),
    byKind: index("feed_items_kind_idx").on(t.kind),
    byCategory: index("feed_items_category_idx").on(t.category),
    byInitiative: index("feed_items_initiative_idx").on(t.initiativeId),
    byLegislator: index("feed_items_legislator_idx").on(t.legislatorSourceId),
  }),
);

/** Tags linking one feed item to several entities (mirrors `activityInitiatives`). */
export const feedItemEntities = pgTable(
  "feed_item_entities",
  {
    id: serial("id").primaryKey(),
    feedItemId: integer("feed_item_id")
      .notNull()
      .references(() => feedItems.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // INITIATIVE | LEGISLATOR | COMMISSION
    initiativeCode: text("initiative_code"),
    initiativeId: integer("initiative_id").references(() => initiatives.id, {
      onDelete: "set null",
    }),
    legislatorSourceId: text("legislator_source_id"),
    commissionName: text("commission_name"),
    label: text("label").notNull(), // display text for the chip
  },
  (t) => ({
    uq: uniqueIndex("feed_item_entities_uq").on(t.feedItemId, t.entityType, t.label),
    byInitiative: index("feed_item_entities_initiative_idx").on(t.initiativeId),
    byLegislator: index("feed_item_entities_legislator_idx").on(t.legislatorSourceId),
  }),
);

/**
 * Curated registry of influential DR politics/legislation accounts — the "follow"
 * directory in the feed's right rail, and the account list the (credential-gated)
 * social adapter pulls posts for. Verified, link-first; no fragile scraping required.
 */
export const feedAccounts = pgTable(
  "feed_accounts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    platform: text("platform").notNull(), // X | INSTAGRAM | YOUTUBE | WEB
    url: text("url").notNull(),
    kind: text("kind").notNull(), // SENADO_OFFICIAL | SENATOR | DEPUTY | JOURNALIST | NEWSPAPER | INSTITUTION
    chamber: text("chamber"), // SENADO | DIPUTADOS | null
    legislatorSourceId: text("legislator_source_id"), // links to legislators.sourceId when known
    influenceRank: integer("influence_rank"), // lower = more influential
    active: boolean("active").notNull().default(true),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("feed_accounts_uq").on(t.platform, t.handle),
    byKind: index("feed_accounts_kind_idx").on(t.kind),
    byActive: index("feed_accounts_active_idx").on(t.active),
    byLegislator: index("feed_accounts_legislator_idx").on(t.legislatorSourceId),
  }),
);

export type Initiative = typeof initiatives.$inferSelect;
export type NewInitiative = typeof initiatives.$inferInsert;
export type StatusEvent = typeof statusEvents.$inferSelect;
export type ScoreInputRow = typeof scoreInputs.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;
export type ActivityInitiative = typeof activityInitiatives.$inferSelect;
export type Commission = typeof commissions.$inferSelect;
export type NewCommission = typeof commissions.$inferInsert;
export type Legislator = typeof legislators.$inferSelect;
export type NewLegislator = typeof legislators.$inferInsert;
export type CommissionMember = typeof commissionMembers.$inferSelect;
export type NewCommissionMember = typeof commissionMembers.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type Regulation = typeof regulations.$inferSelect;
export type NewRegulation = typeof regulations.$inferInsert;
export type FeedItem = typeof feedItems.$inferSelect;
export type NewFeedItem = typeof feedItems.$inferInsert;
export type FeedItemEntity = typeof feedItemEntities.$inferSelect;
export type NewFeedItemEntity = typeof feedItemEntities.$inferInsert;
export type FeedAccount = typeof feedAccounts.$inferSelect;
export type NewFeedAccount = typeof feedAccounts.$inferInsert;
