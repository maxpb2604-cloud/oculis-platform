/**
 * Drizzle schema (Postgres) for Oculis Auribus.
 *
 * Modeled on the canonical `RawInitiative` produced by scraper adapters. Legacy
 * inference columns remain nullable for wire/schema compatibility, but database
 * checks keep them neutral. Only source-reported facts belong in active records.
 */
import {
  boolean,
  check,
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
import { sql } from "drizzle-orm";

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
    sourceChamber: text("source_chamber"), // chamber whose corpus supplied this record
    originChamber: text("origin_chamber"), // chamber of origin explicitly reported
    currentChamber: text("current_chamber"), // current chamber only when explicitly reported
    currentBody: text("current_body"), // current body/organ only when explicitly reported
    condition: text("condition"), // source condition, distinct from procedural status

    // --- categorization ---
    sourceCategory: text("source_category"), // explicit subject/group label from source
    subjectMatter: text("subject_matter"), // explicit materia, separate from broader group
    category: text("category"), // legacy inferred field; must remain null
    categoryConfidence: real("category_confidence"), // legacy inferred field; must remain null

    // --- sponsor / provenance ---
    sponsor: text("sponsor"), // principal proponente (full name)
    sponsorRole: text("sponsor_role"), // their function, e.g. "Diputado" / "Senador"
    sponsorCount: integer("sponsor_count"), // total proponentes (for "y N más")
    party: text("party"),
    province: text("province"),
    committee: text("committee"),
    filedAt: text("filed_at"), // ISO date string (yyyy-mm-dd)
    expiresAt: text("expires_at"),
    initiated: text("initiated"), // literal source value, e.g. SI / NO
    initiatedAt: text("initiated_at"), // ISO date when the source reports proceedings began
    legislature: text("legislature"),
    registrationPeriod: text("registration_period"),
    officialStatusChangedAt: text("official_status_changed_at"), // literal source timestamp
    promulgationNumber: text("promulgation_number"),
    promulgatedAt: text("promulgated_at"), // ISO date
    sourceUrl: text("source_url"),

    // --- retired inference fields (kept only for schema compatibility) ---
    riskLevel: text("risk_level"),
    approvalProbability: text("approval_probability"),
    approvalScore: integer("approval_score"),

    // --- retired inferred workflow flags ---
    needsReview: boolean("needs_review").notNull().default(false),
    published: boolean("published").notNull().default(false),

    // --- audit ---
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bySource: uniqueIndex("initiatives_source_source_id_uq").on(t.source, t.sourceId),
    bySourceCategory: index("initiatives_source_category_idx").on(t.sourceCategory),
    byChamber: index("initiatives_chamber_idx").on(t.chamber),
    byFiledAt: index("initiatives_filed_at_idx").on(t.filedAt),
    noInferredValues: check(
      "initiatives_no_inferred_values_check",
      sql`${t.category} is null
          and ${t.categoryConfidence} is null
          and ${t.riskLevel} is null
          and ${t.approvalProbability} is null
          and ${t.approvalScore} is null
          and ${t.needsReview} = false
          and ${t.published} = false`,
    ),
  }),
);

/**
 * AI-authored display translations for an initiative's exact official title.
 *
 * The source title remains canonical on `initiatives`. Keeping its exact text and
 * digest on every translation makes a source refresh invalidate old output without
 * deleting the audit row or accidentally presenting it for the revised title.
 */
export const initiativeTitleTranslations = pgTable(
  "initiative_title_translations",
  {
    id: serial("id").primaryKey(),
    initiativeId: integer("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    targetLocale: text("target_locale").notNull(),
    sourceTitle: text("source_title").notNull(),
    sourceTitleHash: text("source_title_hash").notNull(),
    translatedTitle: text("translated_title").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at"),
  },
  (t) => ({
    sourceModelUq: uniqueIndex("initiative_title_translations_source_model_uq").on(
      t.initiativeId,
      t.targetLocale,
      t.sourceTitleHash,
      t.model,
    ),
    currentLookup: index("initiative_title_translations_current_idx").on(
      t.initiativeId,
      t.targetLocale,
      t.sourceTitle,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    candidateLookup: index("initiative_title_translations_candidate_idx").on(
      t.initiativeId,
      t.targetLocale,
      t.model,
      t.sourceTitle,
    ),
    nonEmpty: check(
      "initiative_title_translations_nonempty_check",
      sql`length(trim(${t.sourceTitle})) > 0
          and length(trim(${t.translatedTitle})) > 0
          and length(trim(${t.model})) > 0`,
    ),
    sha256Hash: check(
      "initiative_title_translations_sha256_check",
      sql`${t.sourceTitleHash} ~ '^[a-f0-9]{64}$'`,
    ),
    supportedLocale: check(
      "initiative_title_translations_locale_check",
      sql`${t.targetLocale} = 'en'`,
    ),
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
    eventEndDate: text("event_end_date"), // explicit source end date, ISO yyyy-mm-dd
    sourceEventId: text("source_event_id"), // stable official history-row id
    note: text("note"),
    source: text("source").notNull(), // adapter/source that supplied or observed the status
    sourceUrl: text("source_url"),
    evidenceType: text("evidence_type").notNull().default("SOURCE_HISTORY"),
    raw: jsonb("raw"),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
    /** Most recent complete source snapshot in which this exact version appeared. */
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    /** Set only when a later complete snapshot from the same source omits this version. */
    retiredAt: timestamp("retired_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // One official id can be corrected by its publisher. The complete literal
    // version is therefore the immutable identity; lastSeenAt/retiredAt decide which
    // version is current without erasing the source's earlier publication.
    sourceVersionUq: uniqueIndex("status_events_source_version_uq")
      .on(
        t.initiativeId,
        t.evidenceType,
        t.source,
        sql`coalesce(${t.sourceEventId}, '')`,
        t.status,
        sql`coalesce(${t.eventDate}, '')`,
        sql`coalesce(${t.eventEndDate}, '')`,
        sql`coalesce(${t.note}, '')`,
        sql`coalesce(${t.sourceUrl}, '')`,
        sql`md5(coalesce(${t.raw}::text, ''))`,
      )
      .where(sql`${t.evidenceType} = 'SOURCE_HISTORY'`),
    observedUq: uniqueIndex("status_events_observed_uq")
      .on(t.initiativeId, t.status, t.observedAt, t.evidenceType)
      .where(sql`${t.evidenceType} = 'OBSERVED_CHANGE'`),
    byInitiative: index("status_events_initiative_idx").on(t.initiativeId),
  }),
);

/** Every explicit source assignment of an initiative to a commission. */
export const initiativeCommissionAssignments = pgTable(
  "initiative_commission_assignments",
  {
    id: serial("id").primaryKey(),
    initiativeId: integer("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceAssignmentId: text("source_assignment_id"),
    sourceTypeId: text("source_type_id"),
    name: text("name"),
    type: text("type"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceIdUq: uniqueIndex("initiative_commission_assignments_source_id_uq")
      .on(t.initiativeId, t.source, t.sourceAssignmentId)
      .where(sql`${t.sourceAssignmentId} is not null`),
    fallbackUq: uniqueIndex("initiative_commission_assignments_fallback_uq")
      .on(
        t.initiativeId,
        t.source,
        sql`coalesce(${t.sourceTypeId}, '')`,
        sql`coalesce(${t.name}, '')`,
        sql`coalesce(${t.type}, '')`,
        sql`coalesce(${t.startDate}, '')`,
        sql`coalesce(${t.endDate}, '')`,
        sql`md5(coalesce(${t.raw}::text, ''))`,
      )
      .where(sql`${t.sourceAssignmentId} is null`),
    byInitiative: index("initiative_commission_assignments_initiative_idx").on(t.initiativeId),
  }),
);

/**
 * Retired scoring-input shape retained for compatibility. New values are rejected;
 * historical provenance is copied to `inferenceAudit` before rows are cleared.
 */
export const scoreInputs = pgTable(
  "score_inputs",
  {
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
  },
  (t) => ({
    nonNegativePressure: check(
      "score_inputs_social_pressure_count_check",
      sql`${t.socialPressureCount} is null or ${t.socialPressureCount} >= 0`,
    ),
    noInferredValues: check(
      "score_inputs_no_inferred_values_check",
      sql`${t.party} is null
          and ${t.sponsorRecord} is null
          and ${t.executiveSupport} is null
          and ${t.stakeholderSupport} is null
          and ${t.socialPressureCount} is null`,
    ),
  }),
);

/**
 * Append/update-safe archive for inference values rejected from active records.
 * It preserves what was supplied, when it was blocked, and any available provenance
 * without allowing those values to appear as platform facts.
 */
export const inferenceAudit = pgTable(
  "inference_audit",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    inferenceKind: text("inference_kind").notNull(),
    value: jsonb("value").notNull(),
    provenance: jsonb("provenance"),
    archivedAt: timestamp("archived_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("inference_audit_entity_kind_uq").on(t.entityType, t.entityId, t.inferenceKind),
    byEntity: index("inference_audit_entity_idx").on(t.entityType, t.entityId),
  }),
);

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
    sourceEventId: text("source_event_id"), // exact stable activity id when the source publishes one
    scope: text("scope").notNull(), // COMMITTEE | PLENARY | ASAMBLEA
    chamber: text("chamber"), // DIPUTADOS | SENADO
    eventDate: text("event_date"), // ISO date (yyyy-mm-dd)
    eventTime: text("event_time"), // literal time/range reported by the agenda
    location: text("location"), // literal meeting location reported by the source
    kind: text("kind"), // "Reunión", "Encuentros…", "Orden del Día"
    body: text("body"), // committee name (COMMITTEE) or chamber (PLENARY)
    description: text("description").notNull(),
    agendaUrl: text("agenda_url"), // source PDF / page for this agenda item
    statuses: jsonb("statuses"), // structured reading/processing statuses (string[])
    // Exact source ids are preferred when available; this fingerprint remains the
    // backward-compatible identity for source rows that do not publish one.
    dedupeKey: text("dedupe_key").notNull(),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("activity_events_dedupe_uq").on(t.source, t.dedupeKey),
    sourceEventUq: uniqueIndex("activity_events_source_event_uq")
      .on(t.source, t.sourceEventId)
      .where(sql`${t.sourceEventId} is not null`),
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
 * text…). Powers the factual "con documento oficial" count and per-initiative links.
 * SEGMENTED from initiatives so document availability is never presented as a
 * legislative lifecycle status.
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
    modifiedAt: text("modified_at"), // ISO date the source last modified it, when stated
    sourceCategory: text("source_category"), // literal official collection/section label
    sourceFragment: text("source_fragment"), // literal PDF slice that supplied an exact code
    sourceDocId: text("source_doc_id"), // stable id within the source
    raw: jsonb("raw"), // source metadata and parser evidence retained for audit
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("documents_uq").on(t.source, t.sourceDocId),
    byInitiative: index("documents_initiative_idx").on(t.initiativeId),
    byCode: index("documents_code_idx").on(t.initiativeCode),
  }),
);

/** Immutable source metadata captured when a document byte version is extracted. */
export interface DocumentSourceSnapshot {
  initiativeId: number | null;
  source: string;
  sourceDocId: string | null;
  url: string | null;
  docType: string | null;
  uploadedAt: string | null;
  modifiedAt: string | null;
}

/**
 * Full text extracted from a validated official PDF.
 *
 * This table is deliberately separate from `documents`: the latter is official-source
 * metadata, while this is derived technical evidence for the fail-closed PDF availability
 * check. A document can retain several immutable byte/content versions over time; each
 * version also freezes the source association and official URL used at extraction.
 */
export const documentContents = pgTable(
  "document_contents",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(), // lowercase SHA-256 of the complete PDF bytes
    sourceSnapshot: jsonb("source_snapshot").$type<DocumentSourceSnapshot>().notNull(),
    contentText: text("content_text").notNull(), // complete extracted text; never truncated
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    pageCount: integer("page_count").notNull(),
    characterCount: integer("character_count").notNull(),
    extractedAt: timestamp("extracted_at").notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("document_contents_document_hash_snapshot_uq").on(
      t.documentId,
      t.contentHash,
      sql`md5(${t.sourceSnapshot}::text)`,
    ),
    byHash: index("document_contents_hash_idx").on(t.contentHash),
    validSizes: check(
      "document_contents_valid_sizes_check",
      sql`${t.byteSize} > 0 and ${t.pageCount} > 0 and ${t.characterCount} > 0`,
    ),
    sha256Hash: check("document_contents_sha256_check", sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`),
    sourceSnapshotObject: check(
      "document_contents_source_snapshot_object_check",
      sql`jsonb_typeof(${t.sourceSnapshot}) = 'object'
          and ${t.sourceSnapshot} ?& array[
            'initiativeId', 'source', 'sourceDocId', 'url', 'docType', 'uploadedAt', 'modifiedAt'
          ]
          and jsonb_typeof(${t.sourceSnapshot} -> 'initiativeId') in ('number', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'source') = 'string'
          and jsonb_typeof(${t.sourceSnapshot} -> 'sourceDocId') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'url') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'docType') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'uploadedAt') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'modifiedAt') in ('string', 'null')`,
    ),
  }),
);

/**
 * Durable reachability evidence for one exact official-document metadata snapshot.
 *
 * This is intentionally independent from `documentContents`: a large, scanned, or
 * otherwise non-extractable PDF is still publicly available when its official HTTPS
 * endpoint returns authenticated PDF bytes. Failed probes are retained as negative
 * evidence and replace a prior success for the same immutable source snapshot.
 */
export const documentPdfVerifications = pgTable(
  "document_pdf_verifications",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sourceSnapshot: jsonb("source_snapshot").$type<DocumentSourceSnapshot>().notNull(),
    reachable: boolean("reachable").notNull(),
    httpStatus: integer("http_status"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    finalUrl: text("final_url"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    verifiedAt: timestamp("verified_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("document_pdf_verifications_document_snapshot_uq").on(
      t.documentId,
      sql`md5(${t.sourceSnapshot}::text)`,
    ),
    byDocumentVerified: index("document_pdf_verifications_document_verified_idx").on(
      t.documentId,
      t.verifiedAt.desc(),
    ),
    validSnapshot: check(
      "document_pdf_verifications_source_snapshot_object_check",
      sql`jsonb_typeof(${t.sourceSnapshot}) = 'object'
          and ${t.sourceSnapshot} ?& array[
            'initiativeId', 'source', 'sourceDocId', 'url', 'docType', 'uploadedAt', 'modifiedAt'
          ]
          and jsonb_typeof(${t.sourceSnapshot} -> 'initiativeId') in ('number', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'source') = 'string'
          and jsonb_typeof(${t.sourceSnapshot} -> 'sourceDocId') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'url') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'docType') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'uploadedAt') in ('string', 'null')
          and jsonb_typeof(${t.sourceSnapshot} -> 'modifiedAt') in ('string', 'null')`,
    ),
    validOutcome: check(
      "document_pdf_verifications_outcome_check",
      sql`(
            ${t.reachable} = true
            and ${t.httpStatus} in (200, 206)
            and ${t.mimeType} in ('application/pdf', 'application/octet-stream')
            and (${t.byteSize} is null or ${t.byteSize} > 0)
            and length(trim(${t.finalUrl})) > 0
            and ${t.errorCode} is null
            and ${t.errorMessage} is null
          ) or (
            ${t.reachable} = false
            and ${t.httpStatus} is null
            and ${t.mimeType} is null
            and ${t.byteSize} is null
            and ${t.finalUrl} is null
            and length(trim(${t.errorCode})) > 0
            and length(trim(${t.errorMessage})) > 0
          )`,
    ),
  }),
);

/**
 * Regulatory instruments (norms/resolutions/reglamentos/NORDOM) from DR regulatory
 * institutions — the REGULATORY twin of `initiatives`. Mirrors the columns of the
 * Monitoreo Regulatorio workbook. Source-reported status remains literal; retired
 * category/intervention judgments are held null.
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
    sourceCategory: text("source_category"), // explicit category reported by the institution
    interventionLevel: text("intervention_level"), // legacy inferred field; must remain null
    category: text("category"), // legacy inferred field; must remain null
    province: text("province"),
    // Explicit source/adaptor assertion. null means the source did not establish it.
    isConsulta: boolean("is_consulta"),
    publishedAt: text("published_at"), // ISO date
    deadline: text("deadline"), // consulta comment deadline, if any
    url: text("url"), // source page / PDF
    needsReview: boolean("needs_review").notNull().default(false),
    raw: jsonb("raw"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("regulations_source_uq").on(t.source, t.sourceId),
    byInstitution: index("regulations_institution_idx").on(t.institution),
    bySourceCategory: index("regulations_source_category_idx").on(t.sourceCategory),
    byConsulta: index("regulations_consulta_idx").on(t.isConsulta),
    noInferredValues: check(
      "regulations_no_inferred_values_check",
      sql`${t.interventionLevel} is null and ${t.category} is null and ${t.needsReview} = false`,
    ),
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
    // Snapshot visibility. Missing from a successfully validated current roster does
    // not delete history; it makes the old row inactive until the source reports it.
    active: boolean("active").notNull().default(true),
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
 * One source-published proponent occurrence on an initiative.
 *
 * `legislatorId` is the canonical Oculis profile only when an exact, auditable source
 * identity resolved it. Unresolved published names remain first-class rows instead of
 * being dropped or guessed. The source ordinal preserves principal/co-proponent order
 * and is the stable replacement key for one observed initiative snapshot.
 */
export const initiativeProponents = pgTable(
  "initiative_proponents",
  {
    id: serial("id").primaryKey(),
    initiativeId: integer("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    legislatorId: integer("legislator_id").references(() => legislators.id),
    initiativeSource: text("initiative_source").notNull(),
    personNamespace: text("person_namespace").notNull(),
    personSourceId: text("person_source_id"),
    publishedName: text("published_name").notNull(),
    principal: boolean("principal"),
    ordinal: integer("ordinal").notNull(),
    matchBasis: text("match_basis").notNull(),
    evidence: jsonb("evidence"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    snapshotOrdinalUq: uniqueIndex("initiative_proponents_snapshot_ordinal_uq").on(
      t.initiativeId,
      t.initiativeSource,
      t.ordinal,
    ),
    byLegislator: index("initiative_proponents_legislator_idx").on(t.legislatorId),
    byInitiative: index("initiative_proponents_initiative_idx").on(t.initiativeId),
    validOrdinal: check("initiative_proponents_ordinal_check", sql`${t.ordinal} >= 0`),
    validMatchBasis: check(
      "initiative_proponents_match_basis_check",
      sql`${t.matchBasis} in ('official-id', 'official-selector-exact-name', 'unresolved')`,
    ),
    nonEmptyIdentity: check(
      "initiative_proponents_nonempty_check",
      sql`length(trim(${t.initiativeSource})) > 0
          and length(trim(${t.personNamespace})) > 0
          and length(trim(${t.publishedName})) > 0
          and (${t.personSourceId} is null or length(trim(${t.personSourceId})) > 0)`,
    ),
    resolutionConsistency: check(
      "initiative_proponents_resolution_check",
      sql`(${t.matchBasis} = 'unresolved' and ${t.legislatorId} is null)
          or (${t.matchBasis} <> 'unresolved' and ${t.legislatorId} is not null)`,
    ),
  }),
);

/**
 * Durable audit record for one full-source normalized-proponent reconciliation.
 *
 * A run starts from a captured source-corpus fingerprint and becomes `complete` only
 * when the worker processes that entire unchanged corpus without a failure. Public
 * statistics use a compatible, still-current completed run only to prove a true zero;
 * an absent run must never be interpreted as "this legislator deposited nothing".
 */
export const initiativeProponentReconciliationRuns = pgTable(
  "initiative_proponent_reconciliation_runs",
  {
    id: serial("id").primaryKey(),
    initiativeSource: text("initiative_source").notNull(),
    personNamespace: text("person_namespace").notNull(),
    rosterSource: text("roster_source").notNull(),
    chamber: text("chamber").notNull(),
    compatibilityVersion: integer("compatibility_version").notNull(),
    resolverVersion: text("resolver_version").notNull(),
    status: text("status").notNull().default("running"),
    sourceCandidateCount: integer("source_candidate_count").notNull(),
    sourceMaxInitiativeId: integer("source_max_initiative_id"),
    sourceFingerprint: text("source_fingerprint").notNull(),
    processedCandidateCount: integer("processed_candidate_count"),
    observedCandidateCount: integer("observed_candidate_count"),
    replacedCandidateCount: integer("replaced_candidate_count"),
    skippedUnobservedCount: integer("skipped_unobserved_count"),
    unresolvedProponentCount: integer("unresolved_proponent_count"),
    failureCount: integer("failure_count"),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    byCompatibility: index("initiative_proponent_reconciliation_compat_idx").on(
      t.rosterSource,
      t.chamber,
      t.initiativeSource,
      t.personNamespace,
      t.compatibilityVersion,
      t.completedAt.desc(),
    ),
    validIdentity: check(
      "initiative_proponent_reconciliation_identity_check",
      sql`length(trim(${t.initiativeSource})) > 0
          and length(trim(${t.personNamespace})) > 0
          and length(trim(${t.rosterSource})) > 0
          and length(trim(${t.chamber})) > 0
          and length(trim(${t.resolverVersion})) > 0`,
    ),
    validStatus: check(
      "initiative_proponent_reconciliation_status_check",
      sql`${t.status} in ('running', 'complete', 'failed')`,
    ),
    validCompatibilityVersion: check(
      "initiative_proponent_reconciliation_compat_version_check",
      sql`${t.compatibilityVersion} > 0`,
    ),
    validCapturedCounts: check(
      "initiative_proponent_reconciliation_captured_counts_check",
      sql`${t.sourceCandidateCount} >= 0
          and (${t.sourceMaxInitiativeId} is null or ${t.sourceMaxInitiativeId} > 0)
          and ${t.sourceFingerprint} ~ '^[a-f0-9]{32}$'`,
    ),
    validResultCounts: check(
      "initiative_proponent_reconciliation_result_counts_check",
      sql`(${t.processedCandidateCount} is null or ${t.processedCandidateCount} >= 0)
          and (${t.observedCandidateCount} is null or ${t.observedCandidateCount} >= 0)
          and (${t.replacedCandidateCount} is null or ${t.replacedCandidateCount} >= 0)
          and (${t.skippedUnobservedCount} is null or ${t.skippedUnobservedCount} >= 0)
          and (${t.unresolvedProponentCount} is null or ${t.unresolvedProponentCount} >= 0)
          and (${t.failureCount} is null or ${t.failureCount} >= 0)`,
    ),
    completionConsistency: check(
      "initiative_proponent_reconciliation_completion_check",
      sql`(${t.status} = 'running' and ${t.completedAt} is null)
          or (${t.status} <> 'running' and ${t.completedAt} is not null)`,
    ),
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
    active: boolean("active").notNull().default(true),
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
    category: text("category"), // legacy inferred field; must remain null
    publishedAt: timestamp("published_at"), // real datetime — the feed orders by this
    // --- primary entity link (denormalized for single-column left-panel filters) ---
    initiativeId: integer("initiative_id").references(() => initiatives.id, {
      onDelete: "set null",
    }),
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
    byChronology: index("feed_items_chronology_idx").on(
      sql`coalesce(${t.publishedAt}, ${t.firstSeenAt}) desc`,
      t.id.desc(),
    ),
    byKind: index("feed_items_kind_idx").on(t.kind),
    byInitiative: index("feed_items_initiative_idx").on(t.initiativeId),
    byLegislator: index("feed_items_legislator_idx").on(t.legislatorSourceId),
    noInferredCategory: check("feed_items_no_inferred_category_check", sql`${t.category} is null`),
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
    influenceRank: integer("influence_rank"), // legacy subjective field; must remain null
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
    noInfluenceRank: check(
      "feed_accounts_no_influence_rank_check",
      sql`${t.influenceRank} is null`,
    ),
  }),
);

export type Initiative = typeof initiatives.$inferSelect;
export type NewInitiative = typeof initiatives.$inferInsert;
export type InitiativeTitleTranslation = typeof initiativeTitleTranslations.$inferSelect;
export type NewInitiativeTitleTranslation = typeof initiativeTitleTranslations.$inferInsert;
export type StatusEvent = typeof statusEvents.$inferSelect;
export type InitiativeCommissionAssignment = typeof initiativeCommissionAssignments.$inferSelect;
export type NewInitiativeCommissionAssignment = typeof initiativeCommissionAssignments.$inferInsert;
export type InferenceAudit = typeof inferenceAudit.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;
export type ActivityInitiative = typeof activityInitiatives.$inferSelect;
export type Commission = typeof commissions.$inferSelect;
export type NewCommission = typeof commissions.$inferInsert;
export type Legislator = typeof legislators.$inferSelect;
export type NewLegislator = typeof legislators.$inferInsert;
export type InitiativeProponent = typeof initiativeProponents.$inferSelect;
export type NewInitiativeProponent = typeof initiativeProponents.$inferInsert;
export type InitiativeProponentReconciliationRun =
  typeof initiativeProponentReconciliationRuns.$inferSelect;
export type CommissionMember = typeof commissionMembers.$inferSelect;
export type NewCommissionMember = typeof commissionMembers.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentContent = typeof documentContents.$inferSelect;
export type NewDocumentContent = typeof documentContents.$inferInsert;
export type DocumentPdfVerification = typeof documentPdfVerifications.$inferSelect;
export type NewDocumentPdfVerification = typeof documentPdfVerifications.$inferInsert;
export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type Regulation = typeof regulations.$inferSelect;
export type NewRegulation = typeof regulations.$inferInsert;
export type FeedItem = typeof feedItems.$inferSelect;
export type NewFeedItem = typeof feedItems.$inferInsert;
export type FeedItemEntity = typeof feedItemEntities.$inferSelect;
export type NewFeedItemEntity = typeof feedItemEntities.$inferInsert;
export type FeedAccount = typeof feedAccounts.$inferSelect;
export type NewFeedAccount = typeof feedAccounts.$inferInsert;
