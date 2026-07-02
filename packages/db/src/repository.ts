/**
 * Persistence operations for ingestion: idempotent upsert of initiatives and
 * append-only status-event recording with change detection.
 */
import { and, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  activityEvents,
  activityInitiatives,
  commissions,
  commissionMembers,
  documents,
  feedAccounts,
  feedItemEntities,
  feedItems,
  ingestionRuns,
  initiatives,
  legislators,
  regulations,
  scoreInputs,
  statusEvents,
} from "./schema.js";
import type {
  FeedAccount,
  NewCommission,
  NewCommissionMember,
  NewDocument,
  NewFeedAccount,
  NewFeedItem,
  NewInitiative,
  NewLegislator,
  NewRegulation,
} from "./schema.js";

export interface UpsertResult {
  id: number;
  inserted: boolean;
  statusChanged: boolean;
}

/**
 * Insert or update an initiative keyed by (source, source_id). Returns whether it was
 * newly inserted and whether its current status changed since last seen.
 */
export async function upsertInitiative(
  db: Database,
  data: NewInitiative,
): Promise<UpsertResult> {
  const existing = await db
    .select({ id: initiatives.id, status: initiatives.status })
    .from(initiatives)
    .where(
      and(eq(initiatives.source, data.source), eq(initiatives.sourceId, data.sourceId)),
    )
    .limit(1);

  if (existing.length === 0) {
    const [row] = await db
      .insert(initiatives)
      .values(data)
      .returning({ id: initiatives.id });
    return { id: row!.id, inserted: true, statusChanged: false };
  }

  const prev = existing[0]!;
  const statusChanged = (data.status ?? null) !== (prev.status ?? null);
  await db
    .update(initiatives)
    .set({
      // refresh mutable fields; preserve derived/analyst fields not in `data`
      title: data.title,
      status: data.status,
      type: data.type,
      sourceCategory: data.sourceCategory,
      sponsor: data.sponsor,
      // undefined (bulk crawl) leaves the column untouched; the deposits sync sets them.
      sponsorRole: data.sponsorRole,
      sponsorCount: data.sponsorCount,
      party: data.party,
      province: data.province,
      committee: data.committee,
      filedAt: data.filedAt,
      expiresAt: data.expiresAt,
      sourceUrl: data.sourceUrl,
      raw: data.raw,
      lastSeenAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(initiatives.id, prev.id));
  return { id: prev.id, inserted: false, statusChanged };
}

/**
 * Record status-history events for an initiative, skipping duplicates via the
 * (initiative_id, status, event_date) unique index. Returns count newly inserted.
 */
export async function recordStatusEvents(
  db: Database,
  initiativeId: number,
  events: Array<{ status: string; date: string | null; note: string | null }>,
): Promise<number> {
  if (events.length === 0) return 0;
  const rows = events.map((e) => ({
    initiativeId,
    status: e.status,
    eventDate: e.date,
    note: e.note,
  }));
  const inserted = await db
    .insert(statusEvents)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: statusEvents.id });
  return inserted.length;
}

// ---------------------------------------------------------------------------
// Scoring support
// ---------------------------------------------------------------------------

/** Count a sponsor's prior approved/enacted initiatives (for track-record scoring). */
export async function countApprovedBySponsor(
  db: Database,
  sponsor: string | null,
): Promise<number> {
  if (!sponsor) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(initiatives)
    .where(
      and(
        eq(initiatives.sponsor, sponsor),
        sql`(${initiatives.status} ilike '%aprob%' or ${initiatives.status} ilike '%promulg%')`,
      ),
    );
  return row?.n ?? 0;
}

export interface ScorableRow {
  id: number;
  title: string;
  purpose: string | null;
  sponsor: string | null;
  party: string | null;
  category: string | null;
}

/** All initiatives with the fields needed to (re)score them. */
export async function listForScoring(db: Database): Promise<ScorableRow[]> {
  return db
    .select({
      id: initiatives.id,
      title: initiatives.title,
      purpose: initiatives.purpose,
      sponsor: initiatives.sponsor,
      party: initiatives.party,
      category: initiatives.category,
    })
    .from(initiatives);
}

/** Persist a computed score + its inputs/provenance for one initiative. */
export async function saveScore(
  db: Database,
  initiativeId: number,
  scored: { riskLevel: string; approvalProbability: string; approvalScore: number },
  inputs: {
    party: string;
    sponsorRecord: string;
    executiveSupport: string;
    stakeholderSupport: string;
    socialPressureCount: number;
  },
  provenance: unknown,
): Promise<void> {
  await db
    .update(initiatives)
    .set({
      riskLevel: scored.riskLevel,
      approvalProbability: scored.approvalProbability,
      approvalScore: scored.approvalScore,
      updatedAt: sql`now()`,
    })
    .where(eq(initiatives.id, initiativeId));
  await db
    .insert(scoreInputs)
    .values({
      initiativeId,
      party: inputs.party,
      sponsorRecord: inputs.sponsorRecord,
      executiveSupport: inputs.executiveSupport,
      stakeholderSupport: inputs.stakeholderSupport,
      socialPressureCount: inputs.socialPressureCount,
      provenance: provenance as object,
    })
    .onConflictDoUpdate({
      target: scoreInputs.initiativeId,
      set: {
        party: inputs.party,
        sponsorRecord: inputs.sponsorRecord,
        executiveSupport: inputs.executiveSupport,
        stakeholderSupport: inputs.stakeholderSupport,
        socialPressureCount: inputs.socialPressureCount,
        provenance: provenance as object,
        updatedAt: sql`now()`,
      },
    });
}

export async function countInitiatives(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(initiatives);
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Dashboard aggregations
// ---------------------------------------------------------------------------

export interface Bucket {
  key: string;
  count: number;
}

/** Generic grouped count over a single column, newest values first by count. */
async function countBy(
  db: Database,
  column: ReturnType<typeof sql>,
): Promise<Bucket[]> {
  const rows = await db
    .select({ key: sql<string>`coalesce(${column}::text, 'N/D')`, count: sql<number>`count(*)::int` })
    .from(initiatives)
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`);
  return rows.map((r) => ({ key: r.key, count: r.count }));
}

export const countByCategory = (db: Database) => countBy(db, sql`category`);
export const countByRisk = (db: Database) => countBy(db, sql`risk_level`);
export const countByStatus = (db: Database) => countBy(db, sql`status`);
export const countByApprovalProbability = (db: Database) =>
  countBy(db, sql`approval_probability`);
export const countByChamber = (db: Database) => countBy(db, sql`chamber`);
export const countByProvince = (db: Database) => countBy(db, sql`province`);

export interface LegislatorRow {
  province: string;
  chamber: string | null;
  sponsor: string;
  role: string | null;
  party: string | null;
}

/**
 * Distinct legislators (sponsors of initiatives) grouped by province — used by the map's
 * click panel. Only people who have appeared as a proponent are known here; it is not a
 * full elected-roster source.
 */
export async function legislatorsByProvince(db: Database): Promise<LegislatorRow[]> {
  const rows = await db
    .selectDistinct({
      province: initiatives.province,
      chamber: initiatives.chamber,
      sponsor: initiatives.sponsor,
      role: initiatives.sponsorRole,
      party: initiatives.party,
    })
    .from(initiatives)
    .where(and(sql`${initiatives.sponsor} is not null`, sql`${initiatives.province} is not null`));
  return rows
    .filter((r): r is LegislatorRow => !!r.province && !!r.sponsor)
    .sort((a, b) => a.sponsor.localeCompare(b.sponsor));
}

export interface DashboardKpis {
  total: number;
  highRisk: number;
  needsReview: number;
  published: number;
}

export async function dashboardKpis(db: Database): Promise<DashboardKpis> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      highRisk: sql<number>`count(*) filter (where ${initiatives.riskLevel} = 'ALTO')::int`,
      needsReview: sql<number>`count(*) filter (where ${initiatives.needsReview})::int`,
      published: sql<number>`count(*) filter (where ${initiatives.published})::int`,
    })
    .from(initiatives);
  return row ?? { total: 0, highRisk: 0, needsReview: 0, published: 0 };
}

export interface InitiativeListItem {
  id: number;
  code: string | null;
  title: string;
  category: string | null;
  status: string | null;
  riskLevel: string | null;
  approvalProbability: string | null;
  sponsor: string | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
  needsReview: boolean;
}

export interface InitiativeFilters {
  search?: string;
  category?: string;
  risk?: string;
  approval?: string;
  party?: string;
  status?: string;
  chamber?: string;
  page?: number;
  pageSize?: number;
}

export interface InitiativePage {
  rows: InitiativeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function filterConds(f: InitiativeFilters) {
  const conds = [];
  if (f.category) conds.push(eq(initiatives.category, f.category));
  if (f.risk) conds.push(eq(initiatives.riskLevel, f.risk));
  if (f.approval) conds.push(eq(initiatives.approvalProbability, f.approval));
  if (f.party) conds.push(eq(initiatives.party, f.party));
  if (f.status) conds.push(eq(initiatives.status, f.status));
  if (f.chamber) conds.push(eq(initiatives.chamber, f.chamber));
  if (f.search?.trim()) {
    const q = `%${f.search.trim()}%`;
    conds.push(sql`(${initiatives.title} ilike ${q} or ${initiatives.code} ilike ${q})`);
  }
  return conds;
}

/** Paginated, filterable, searchable initiative list with total count. */
export async function listInitiatives(
  db: Database,
  f: InitiativeFilters = {},
): Promise<InitiativePage> {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(Math.max(1, f.pageSize ?? 50), 200);
  const conds = filterConds(f);
  const where = conds.length ? and(...conds) : undefined;

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(initiatives)
    .where(where);
  const total = totalRow?.total ?? 0;

  const rows = await db
    .select({
      id: initiatives.id,
      code: initiatives.code,
      title: initiatives.title,
      category: initiatives.category,
      status: initiatives.status,
      riskLevel: initiatives.riskLevel,
      approvalProbability: initiatives.approvalProbability,
      sponsor: initiatives.sponsor,
      party: initiatives.party,
      province: initiatives.province,
      filedAt: initiatives.filedAt,
      sourceUrl: initiatives.sourceUrl,
      needsReview: initiatives.needsReview,
    })
    .from(initiatives)
    .where(where)
    .orderBy(sql`${initiatives.filedAt} desc nulls last, ${initiatives.id} desc`)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total: total ?? 0, page, pageSize };
}

/** Full detail for one initiative: the row, its status timeline, and its score inputs. */
export async function getInitiativeById(db: Database, id: number) {
  const [row] = await db.select().from(initiatives).where(eq(initiatives.id, id)).limit(1);
  if (!row) return null;
  const events = await db
    .select()
    .from(statusEvents)
    .where(eq(statusEvents.initiativeId, id))
    .orderBy(sql`${statusEvents.eventDate} asc nulls last`);
  const [inputs] = await db
    .select()
    .from(scoreInputs)
    .where(eq(scoreInputs.initiativeId, id))
    .limit(1);
  return { ...row, events, scoreInputs: inputs ?? null };
}

/** Distinct values to populate filter dropdowns. */
export async function facets(db: Database) {
  const distinct = async (col: ReturnType<typeof sql>) => {
    const rows = await db
      .select({ v: sql<string>`${col}` })
      .from(initiatives)
      .where(sql`${col} is not null`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return rows.map((r) => r.v).filter(Boolean);
  };
  const [categories, parties, statuses] = await Promise.all([
    distinct(sql`category`),
    distinct(sql`party`),
    distinct(sql`status`),
  ]);
  return { categories, parties, statuses, risks: ["ALTO", "MEDIO", "BAJO"] };
}

// ---------------------------------------------------------------------------
// Committee / plenary activity (SIL "actividad" subsystem) — segmented from bills
// ---------------------------------------------------------------------------

export interface ActivityInput {
  source: string;
  scope: "COMMITTEE" | "PLENARY" | "ASAMBLEA";
  chamber?: "DIPUTADOS" | "SENADO" | null;
  date: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl?: string | null;
  statuses?: string[];
  initiativeCodes: string[];
  dedupeKey: string;
  raw: unknown;
}

export interface ActivityUpsertResult {
  id: number;
  inserted: boolean;
}

/**
 * Idempotent upsert of one agenda/activity event keyed by (source, dedupe_key), plus
 * its referenced-initiative links. Each link is resolved to an initiatives.id when that
 * bill already exists in the corpus (so the UI can join activity ↔ bill, risk, status).
 *
 * Because the dedupeKey is identity-based (scope|date|body|kind, not a content hash),
 * an EDITED agenda updates the same row instead of spawning a duplicate — so all
 * mutable fields (description, statuses, codes, …) are refreshed on the existing path.
 */
export async function upsertActivityEvent(
  db: Database,
  a: ActivityInput,
): Promise<ActivityUpsertResult> {
  const existing = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(and(eq(activityEvents.source, a.source), eq(activityEvents.dedupeKey, a.dedupeKey)))
    .limit(1);

  const fields = {
    scope: a.scope,
    chamber: a.chamber ?? null,
    eventDate: a.date,
    kind: a.kind,
    body: a.body,
    description: a.description,
    agendaUrl: a.agendaUrl ?? null,
    statuses: (a.statuses ?? null) as object | null,
  };

  let id: number;
  let inserted = false;
  if (existing.length === 0) {
    const [row] = await db
      .insert(activityEvents)
      .values({ source: a.source, dedupeKey: a.dedupeKey, raw: a.raw as object, ...fields })
      .returning({ id: activityEvents.id });
    id = row!.id;
    inserted = true;
  } else {
    id = existing[0]!.id;
    await db
      .update(activityEvents)
      .set({ ...fields, lastSeenAt: sql`now()` })
      .where(eq(activityEvents.id, id));
  }

  if (a.initiativeCodes.length) {
    // resolve codes to initiative ids where the bill is already ingested
    const matched = await db
      .select({ id: initiatives.id, code: initiatives.code })
      .from(initiatives)
      .where(inArray(initiatives.code, a.initiativeCodes));
    const byCode = new Map(matched.map((m) => [m.code, m.id] as const));
    await db
      .insert(activityInitiatives)
      .values(
        a.initiativeCodes.map((code) => ({
          activityId: id,
          initiativeCode: code,
          initiativeId: byCode.get(code) ?? null,
        })),
      )
      // backfill initiative_id when the bill is ingested AFTER the activity was first
      // seen (the common Phase-1 case) — onConflictDoNothing would leave it NULL forever.
      .onConflictDoUpdate({
        target: [activityInitiatives.activityId, activityInitiatives.initiativeCode],
        set: { initiativeId: sql`coalesce(${activityInitiatives.initiativeId}, excluded.initiative_id)` },
      });
  }
  return { id, inserted };
}

/**
 * Backfill activity↔initiative links for bills ingested after their agenda activity.
 * Run after a corpus ingest so existing NULL links resolve. Returns rows updated.
 */
export async function backfillActivityInitiativeIds(db: Database): Promise<number> {
  const res = await db.execute(sql`
    update activity_initiatives ai
    set initiative_id = i.id
    from initiatives i
    where ai.initiative_id is null and ai.initiative_code = i.code
  `);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export interface ActivityListItem {
  id: number;
  scope: string;
  chamber: string | null;
  eventDate: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl: string | null;
  statuses: string[] | null;
  initiativeCount: number;
}

/**
 * Activity rows, newest first, with linked-bill counts. Filter by exact `date`, an
 * inclusive `[dateFrom, dateTo]` window (used to widen the Senate's "today" view since
 * its session dates can lag), scope, and/or chamber.
 */
export async function listActivity(
  db: Database,
  opts: { date?: string; dateFrom?: string; dateTo?: string; scope?: string; chamber?: string; limit?: number } = {},
): Promise<ActivityListItem[]> {
  const { date, dateFrom, dateTo, scope, chamber, limit = 200 } = opts;
  const conds = [];
  if (date) conds.push(eq(activityEvents.eventDate, date));
  if (dateFrom) conds.push(sql`${activityEvents.eventDate} >= ${dateFrom}`);
  if (dateTo) conds.push(sql`${activityEvents.eventDate} <= ${dateTo}`);
  if (scope) conds.push(eq(activityEvents.scope, scope));
  if (chamber) conds.push(eq(activityEvents.chamber, chamber));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: activityEvents.id,
      scope: activityEvents.scope,
      chamber: activityEvents.chamber,
      eventDate: activityEvents.eventDate,
      kind: activityEvents.kind,
      body: activityEvents.body,
      description: activityEvents.description,
      agendaUrl: activityEvents.agendaUrl,
      statuses: sql<string[] | null>`${activityEvents.statuses}`,
      initiativeCount: sql<number>`count(${activityInitiatives.id})::int`,
    })
    .from(activityEvents)
    .leftJoin(activityInitiatives, eq(activityInitiatives.activityId, activityEvents.id))
    .where(where)
    .groupBy(activityEvents.id)
    .orderBy(sql`${activityEvents.eventDate} desc nulls last`, activityEvents.body)
    .limit(limit);
}

/** Daily activity counts (for the dashboard "activity per day" view). ASAMBLEA is
 *  folded into the plenary bucket so the calendar agrees with the /hoy aggregation. */
export async function activityCountsByDate(
  db: Database,
  opts: { since?: string } = {},
): Promise<Array<{ date: string; committee: number; plenary: number }>> {
  const where = opts.since ? sql`where event_date >= ${opts.since}` : sql``;
  const rows = await db.execute(sql`
    select event_date as date,
           count(*) filter (where scope = 'COMMITTEE')::int as committee,
           count(*) filter (where scope in ('PLENARY','ASAMBLEA'))::int as plenary
    from activity_events ${where}
    group by event_date
    order by event_date desc nulls last
  `);
  return (rows as unknown as { rows: Array<{ date: string; committee: number; plenary: number }> }).rows;
}

// ---------------------------------------------------------------------------
// Regulatory instruments (regulatory monitoring twin of initiatives)
// ---------------------------------------------------------------------------

export interface RegulationUpsertResult {
  id: number;
  inserted: boolean;
}

/** Idempotent upsert of a regulation keyed by (source, source_id). */
export async function upsertRegulation(
  db: Database,
  r: NewRegulation,
): Promise<RegulationUpsertResult> {
  const existing = await db
    .select({ id: regulations.id })
    .from(regulations)
    .where(and(eq(regulations.source, r.source), eq(regulations.sourceId, r.sourceId)))
    .limit(1);
  if (existing.length === 0) {
    const [row] = await db.insert(regulations).values(r).returning({ id: regulations.id });
    return { id: row!.id, inserted: true };
  }
  const id = existing[0]!.id;
  await db
    .update(regulations)
    .set({
      title: r.title,
      regType: r.regType,
      status: r.status,
      interventionLevel: r.interventionLevel,
      category: r.category,
      isConsulta: r.isConsulta ?? false,
      publishedAt: r.publishedAt,
      deadline: r.deadline,
      url: r.url,
      lastSeenAt: sql`now()`,
    })
    .where(eq(regulations.id, id));
  return { id, inserted: false };
}

export interface RegulationListItem {
  id: number;
  institution: string;
  regType: string | null;
  title: string;
  status: string | null;
  interventionLevel: string | null;
  category: string | null;
  isConsulta: boolean;
  publishedAt: string | null;
  deadline: string | null;
  url: string | null;
}

export async function listRegulations(
  db: Database,
  opts: { institution?: string; intervention?: string; consultaOnly?: boolean; limit?: number } = {},
): Promise<RegulationListItem[]> {
  const conds = [];
  if (opts.institution) conds.push(eq(regulations.institution, opts.institution));
  if (opts.intervention) conds.push(eq(regulations.interventionLevel, opts.intervention));
  if (opts.consultaOnly) conds.push(eq(regulations.isConsulta, true));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: regulations.id,
      institution: regulations.institution,
      regType: regulations.regType,
      title: regulations.title,
      status: regulations.status,
      interventionLevel: regulations.interventionLevel,
      category: regulations.category,
      isConsulta: regulations.isConsulta,
      publishedAt: regulations.publishedAt,
      deadline: regulations.deadline,
      url: regulations.url,
    })
    .from(regulations)
    .where(where)
    .orderBy(sql`${regulations.publishedAt} desc nulls last`)
    .limit(opts.limit ?? 200);
}

export interface RegulatoryKpis {
  total: number;
  consultas: number;
  highIntervention: number;
  institutions: number;
}

export async function regulatoryKpis(db: Database): Promise<RegulatoryKpis> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      consultas: sql<number>`count(*) filter (where ${regulations.isConsulta})::int`,
      highIntervention: sql<number>`count(*) filter (where ${regulations.interventionLevel} = 'HIGH')::int`,
      institutions: sql<number>`count(distinct ${regulations.institution})::int`,
    })
    .from(regulations);
  return row ?? { total: 0, consultas: 0, highIntervention: 0, institutions: 0 };
}

export async function regulationsByInstitution(db: Database): Promise<Bucket[]> {
  const rows = await db
    .select({ key: regulations.institution, count: sql<number>`count(*)::int` })
    .from(regulations)
    .groupBy(regulations.institution)
    .orderBy(sql`2 desc`);
  return rows.map((r) => ({ key: r.key ?? "N/D", count: r.count }));
}

// ---------------------------------------------------------------------------
// Commissions, documents, health — Phase 1 segmented sources
// ---------------------------------------------------------------------------

/** Upsert a committee (by source+chamber+name); refreshes president. */
export async function upsertCommission(db: Database, c: NewCommission): Promise<void> {
  await db
    .insert(commissions)
    .values(c)
    .onConflictDoUpdate({
      target: [commissions.source, commissions.chamber, commissions.name],
      set: { president: c.president, sourceUrl: c.sourceUrl, updatedAt: sql`now()` },
    });
}

export async function listCommissions(
  db: Database,
  opts: { chamber?: string } = {},
): Promise<Array<{ chamber: string; name: string; president: string | null; sourceUrl: string | null }>> {
  const where = opts.chamber ? eq(commissions.chamber, opts.chamber) : undefined;
  return db
    .select({
      chamber: commissions.chamber,
      name: commissions.name,
      president: commissions.president,
      sourceUrl: commissions.sourceUrl,
    })
    .from(commissions)
    .where(where)
    .orderBy(commissions.chamber, commissions.name);
}

/** Upsert a document (by source+source_doc_id); resolves initiativeId by code. */
export async function upsertDocument(db: Database, d: NewDocument): Promise<boolean> {
  let initiativeId = d.initiativeId ?? null;
  if (!initiativeId && d.initiativeCode) {
    const [m] = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(eq(initiatives.code, d.initiativeCode))
      .limit(1);
    initiativeId = m?.id ?? null;
  }
  const res = await db
    .insert(documents)
    .values({ ...d, initiativeId })
    .onConflictDoNothing()
    .returning({ id: documents.id });
  return res.length > 0;
}

/** Initiatives that still need a document sweep (source id + code to query/link). */
export async function listInitiativesForDocuments(
  db: Database,
  opts: { source?: string; limit?: number } = {},
): Promise<Array<{ id: number; sourceId: string; code: string | null }>> {
  const where = opts.source ? eq(initiatives.source, opts.source) : undefined;
  const q = db
    .select({ id: initiatives.id, sourceId: initiatives.sourceId, code: initiatives.code })
    .from(initiatives)
    .where(where)
    .orderBy(sql`${initiatives.id} desc`);
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Documents pending a local/remote file fetch (have a URL, no stored path yet). */
export async function listDocumentsToFetch(
  db: Database,
  opts: { limit?: number } = {},
): Promise<Array<{ id: number; initiativeCode: string | null; url: string | null; docType: string | null }>> {
  const q = db
    .select({
      id: documents.id,
      initiativeCode: documents.initiativeCode,
      url: documents.url,
      docType: documents.docType,
    })
    .from(documents)
    .where(sql`${documents.url} is not null`)
    .orderBy(sql`${documents.id} desc`);
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Documents for one initiative (by id), newest upload first. */
export async function listDocuments(
  db: Database,
  initiativeId: number,
): Promise<Array<{ docType: string | null; extension: string | null; url: string | null; uploadedAt: string | null }>> {
  return db
    .select({
      docType: documents.docType,
      extension: documents.extension,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
    })
    .from(documents)
    .where(eq(documents.initiativeId, initiativeId))
    .orderBy(sql`${documents.uploadedAt} desc nulls last`);
}

export interface DepositItem {
  id: number;
  code: string | null;
  type: string | null;
  title: string; // SIL `descripcion` — the plain-language summary of the bill
  status: string | null;
  chamber: string | null;
  sourceId: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  sponsorCount: number | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null; // SIL initiative page (where the document is published)
  docUploaded: boolean; // is the official PDF uploaded yet?
  docUrl: string | null; // official view/download link, when available
  docType: string | null;
}

/**
 * Initiatives DEPOSITED within a date range (the "deposited today" feed). Each row
 * carries its principal sponsor + whether its official document is uploaded yet, so the
 * daily card needs no extra lookups. Diputados only (the SIL corpus is Diputados).
 */
export async function listDeposits(
  db: Database,
  opts: { dateFrom: string; dateTo?: string; limit?: number; chamber?: string },
): Promise<DepositItem[]> {
  const { dateFrom, dateTo = opts.dateFrom, limit = 200, chamber = "DIPUTADOS" } = opts;
  const rows = await db
    .select({
      id: initiatives.id,
      code: initiatives.code,
      type: initiatives.type,
      title: initiatives.title,
      status: initiatives.status,
      chamber: initiatives.chamber,
      sourceId: initiatives.sourceId,
      sponsor: initiatives.sponsor,
      sponsorRole: initiatives.sponsorRole,
      sponsorCount: initiatives.sponsorCount,
      party: initiatives.party,
      province: initiatives.province,
      filedAt: initiatives.filedAt,
      sourceUrl: initiatives.sourceUrl,
    })
    .from(initiatives)
    .where(
      and(
        eq(initiatives.chamber, chamber),
        sql`${initiatives.filedAt} >= ${dateFrom}`,
        sql`${initiatives.filedAt} <= ${dateTo}`,
      ),
    )
    .orderBy(sql`${initiatives.filedAt} desc nulls last`, sql`${initiatives.id} desc`)
    .limit(limit);

  if (rows.length === 0) return [];

  // One follow-up query for the documents of all deposits, merged in memory.
  const ids = rows.map((r) => r.id);
  const docs = await db
    .select({
      initiativeId: documents.initiativeId,
      docType: documents.docType,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
    })
    .from(documents)
    .where(inArray(documents.initiativeId, ids));

  const byInitiative = new Map<number, typeof docs>();
  for (const d of docs) {
    if (d.initiativeId == null) continue;
    const list = byInitiative.get(d.initiativeId) ?? [];
    list.push(d);
    byInitiative.set(d.initiativeId, list);
  }

  return rows.map((r): DepositItem => {
    const list = byInitiative.get(r.id) ?? [];
    // Prefer an uploaded doc, then the "depositado" text, for the surfaced link.
    const best =
      list.find((d) => d.uploadedAt && /deposit/i.test(d.docType ?? "")) ??
      list.find((d) => d.uploadedAt) ??
      list.find((d) => /deposit/i.test(d.docType ?? "")) ??
      list[0] ??
      null;
    return {
      ...r,
      docUploaded: list.some((d) => d.uploadedAt != null),
      docUrl: best?.url ?? null,
      docType: best?.docType ?? null,
    };
  });
}

/** Record a per-source ingestion run for the health panel. */
export async function recordIngestionRun(
  db: Database,
  run: {
    source: string;
    seen?: number;
    inserted?: number;
    updated?: number;
    statusChanges?: number;
    ok: boolean;
    error?: string | null;
    details?: unknown;
  },
): Promise<void> {
  await db.insert(ingestionRuns).values({
    source: run.source,
    finishedAt: sql`now()`,
    seen: run.seen ?? 0,
    inserted: run.inserted ?? 0,
    updated: run.updated ?? 0,
    statusChanges: run.statusChanges ?? 0,
    ok: run.ok,
    error: run.error ?? null,
    details: (run.details ?? null) as object,
  });
}

export interface SourceHealth {
  source: string;
  finishedAt: Date | null;
  ok: boolean | null;
  seen: number;
  error: string | null;
  details: unknown;
  /** Last time this source ran ok (so a transient failure doesn't hide freshness). */
  lastSuccessAt: Date | null;
  /** Median `seen` of prior successful runs — baseline for anomaly detection. */
  baselineSeen: number | null;
}

/**
 * Health of every source for the "Estado de monitoreo" page: the latest run, the last
 * SUCCESSFUL run, and a baseline (median seen of prior ok runs) so the UI can flag a
 * run that completed but returned anomalously few rows ("ran but suspiciously empty").
 */
export async function latestRunsBySource(db: Database): Promise<SourceHealth[]> {
  const rows = await db.execute(sql`
    with latest as (
      select distinct on (source)
        source, finished_at as "finishedAt", ok, seen, error, details
      from ingestion_runs order by source, started_at desc
    ),
    success as (
      select distinct on (source) source, finished_at as "lastSuccessAt"
      from ingestion_runs where ok order by source, started_at desc
    ),
    baseline as (
      select source,
             percentile_cont(0.5) within group (order by seen)::int as "baselineSeen"
      from ingestion_runs where ok and seen > 0 group by source
    )
    select l.source, l."finishedAt", l.ok, l.seen, l.error, l.details,
           s."lastSuccessAt", b."baselineSeen"
    from latest l
    left join success s on s.source = l.source
    left join baseline b on b.source = l.source
    order by l.source
  `);
  return (rows as unknown as { rows: SourceHealth[] }).rows;
}

/** Most recent initiatives (by filing date), optionally filtered by category/risk. */
export async function listRecentInitiatives(
  db: Database,
  opts: { limit?: number; category?: string; risk?: string } = {},
): Promise<InitiativeListItem[]> {
  const { limit = 50, category, risk } = opts;
  const conds = [];
  if (category) conds.push(eq(initiatives.category, category));
  if (risk) conds.push(eq(initiatives.riskLevel, risk));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: initiatives.id,
      code: initiatives.code,
      title: initiatives.title,
      category: initiatives.category,
      status: initiatives.status,
      riskLevel: initiatives.riskLevel,
      approvalProbability: initiatives.approvalProbability,
      sponsor: initiatives.sponsor,
      party: initiatives.party,
      province: initiatives.province,
      filedAt: initiatives.filedAt,
      sourceUrl: initiatives.sourceUrl,
      needsReview: initiatives.needsReview,
    })
    .from(initiatives)
    .where(where)
    .orderBy(sql`${initiatives.filedAt} desc nulls last`)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Legislator roster + committee membership (full elected Congress)
// ---------------------------------------------------------------------------

/** Upsert a legislator (by source+source_id); refreshes the mutable roster fields. */
export async function upsertLegislator(db: Database, l: NewLegislator): Promise<void> {
  await db
    .insert(legislators)
    .values(l)
    .onConflictDoUpdate({
      target: [legislators.source, legislators.sourceId],
      set: {
        chamber: l.chamber,
        fullName: l.fullName,
        province: l.province,
        circumscription: l.circumscription,
        party: l.party,
        partyShort: l.partyShort,
        role: l.role,
        representationLevel: l.representationLevel,
        period: l.period,
        photoUrl: l.photoUrl,
        email: l.email,
        phone: l.phone,
        profession: l.profession,
        sourceUrl: l.sourceUrl,
        raw: l.raw,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

/** Upsert a committee membership row (by source+commission+person); refreshes cargo. */
export async function upsertCommissionMember(db: Database, m: NewCommissionMember): Promise<void> {
  await db
    .insert(commissionMembers)
    .values(m)
    .onConflictDoUpdate({
      target: [commissionMembers.source, commissionMembers.commissionName, commissionMembers.legislatorName],
      set: {
        chamber: m.chamber,
        commissionSourceId: m.commissionSourceId,
        legislatorSourceId: m.legislatorSourceId,
        cargo: m.cargo,
        party: m.party,
        sourceUrl: m.sourceUrl,
        updatedAt: sql`now()`,
      },
    });
}

export interface RosterMember {
  id: number;
  sourceId: string;
  chamber: string;
  fullName: string;
  province: string | null;
  circumscription: string | null;
  party: string | null;
  partyShort: string | null;
  role: string | null;
  representationLevel: string | null;
  period: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  sourceUrl: string | null;
}

/** Full roster, optionally filtered by chamber/province/party. Ordered by chamber, name. */
export async function listLegislators(
  db: Database,
  opts: { chamber?: string; province?: string; party?: string } = {},
): Promise<RosterMember[]> {
  const conds = [];
  if (opts.chamber) conds.push(eq(legislators.chamber, opts.chamber));
  if (opts.province) conds.push(eq(legislators.province, opts.province));
  if (opts.party) conds.push(eq(legislators.partyShort, opts.party));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: legislators.id,
      sourceId: legislators.sourceId,
      chamber: legislators.chamber,
      fullName: legislators.fullName,
      province: legislators.province,
      circumscription: legislators.circumscription,
      party: legislators.party,
      partyShort: legislators.partyShort,
      role: legislators.role,
      representationLevel: legislators.representationLevel,
      period: legislators.period,
      photoUrl: legislators.photoUrl,
      email: legislators.email,
      phone: legislators.phone,
      profession: legislators.profession,
      sourceUrl: legislators.sourceUrl,
    })
    .from(legislators)
    .where(where)
    .orderBy(legislators.chamber, legislators.fullName);
}

export interface LegislatorCommittee {
  legislatorSourceId: string | null;
  legislatorName: string;
  chamber: string;
  commissionName: string;
  cargo: string | null;
}

/** Every committee seat as a flat list — used to attach committees to each legislator. */
export async function legislatorCommittees(db: Database): Promise<LegislatorCommittee[]> {
  return db
    .select({
      legislatorSourceId: commissionMembers.legislatorSourceId,
      legislatorName: commissionMembers.legislatorName,
      chamber: commissionMembers.chamber,
      commissionName: commissionMembers.commissionName,
      cargo: commissionMembers.cargo,
    })
    .from(commissionMembers)
    .orderBy(commissionMembers.commissionName);
}

// ---------------------------------------------------------------------------
// Feed window (news / official / social / legislative-signal items)
// ---------------------------------------------------------------------------

/** One entity tag attached to a feed item (deep-links the card to a bill/person/committee). */
export interface FeedEntityTag {
  entityType: "INITIATIVE" | "LEGISLATOR" | "COMMISSION";
  initiativeCode?: string | null;
  legislatorSourceId?: string | null;
  commissionName?: string | null;
  label: string;
}

export interface FeedUpsertResult {
  id: number;
  inserted: boolean;
}

/**
 * Idempotent upsert of a feed item keyed by (source, source_id), then sync its entity
 * tags into feed_item_entities (resolving initiative codes → ids in one query). Mirrors
 * the upsertActivityEvent + activityInitiatives backfill idiom.
 */
export async function upsertFeedItem(
  db: Database,
  item: NewFeedItem,
  tags: FeedEntityTag[] = [],
): Promise<FeedUpsertResult> {
  const existing = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(eq(feedItems.source, item.source), eq(feedItems.sourceId, item.sourceId)))
    .limit(1);

  let id: number;
  let inserted: boolean;
  if (existing.length === 0) {
    const [row] = await db.insert(feedItems).values(item).returning({ id: feedItems.id });
    id = row!.id;
    inserted = true;
  } else {
    id = existing[0]!.id;
    inserted = false;
    await db
      .update(feedItems)
      .set({
        title: item.title,
        summary: item.summary,
        imageUrl: item.imageUrl,
        url: item.url,
        author: item.author,
        handle: item.handle,
        platform: item.platform,
        category: item.category,
        publishedAt: item.publishedAt,
        initiativeId: item.initiativeId,
        initiativeCode: item.initiativeCode,
        legislatorSourceId: item.legislatorSourceId,
        commissionName: item.commissionName,
        chamber: item.chamber,
        lastSeenAt: sql`now()`,
      })
      .where(eq(feedItems.id, id));
  }

  if (tags.length) {
    const codes = tags
      .filter((t) => t.entityType === "INITIATIVE" && t.initiativeCode)
      .map((t) => t.initiativeCode!) as string[];
    const codeToId = new Map<string, number>();
    if (codes.length) {
      const rows = await db
        .select({ id: initiatives.id, code: initiatives.code })
        .from(initiatives)
        .where(inArray(initiatives.code, codes));
      for (const r of rows) if (r.code) codeToId.set(r.code, r.id);
    }
    for (const t of tags) {
      const initiativeId = t.initiativeCode ? codeToId.get(t.initiativeCode) ?? null : null;
      await db
        .insert(feedItemEntities)
        .values({
          feedItemId: id,
          entityType: t.entityType,
          initiativeCode: t.initiativeCode ?? null,
          initiativeId,
          legislatorSourceId: t.legislatorSourceId ?? null,
          commissionName: t.commissionName ?? null,
          label: t.label,
        })
        .onConflictDoUpdate({
          target: [feedItemEntities.feedItemId, feedItemEntities.entityType, feedItemEntities.label],
          set: { initiativeId },
        });
    }
  }
  return { id, inserted };
}

/** Idempotent upsert of a registry account keyed by (platform, handle). */
export async function upsertFeedAccount(db: Database, a: NewFeedAccount): Promise<void> {
  await db
    .insert(feedAccounts)
    .values(a)
    .onConflictDoUpdate({
      target: [feedAccounts.platform, feedAccounts.handle],
      set: {
        name: a.name,
        url: a.url,
        kind: a.kind,
        chamber: a.chamber,
        legislatorSourceId: a.legislatorSourceId,
        influenceRank: a.influenceRank,
        active: a.active ?? true,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

export interface FeedTag {
  entityType: string;
  label: string;
  initiativeId: number | null;
  initiativeCode: string | null;
  initiativeTitle: string | null; // bill title (shown instead of the code on the card)
  legislatorSourceId: string | null;
  commissionName: string | null;
}

export interface FeedListItem {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  url: string | null;
  author: string | null;
  handle: string | null;
  platform: string | null;
  category: string | null;
  publishedAt: string | null;
  chamber: string | null;
  tags: FeedTag[];
}

export interface FeedFilters {
  kind?: string;
  category?: string;
  initiativeCode?: string;
  legislatorSourceId?: string;
  commissionName?: string;
  chamber?: string;
  search?: string;
}

export interface FeedCursor {
  publishedAt: string | null;
  id: number;
}

/**
 * Chronological feed with keyset pagination on (coalesce(published_at, first_seen_at) desc,
 * id desc) — feeds grow at the head, so keyset avoids the dupes/skips of offset paging.
 * Each item carries its full entity-tag set (fetched in a second query, merged in memory).
 */
export async function listFeedItems(
  db: Database,
  f: FeedFilters = {},
  opts: { limit?: number; cursor?: FeedCursor | null } = {},
): Promise<{ items: FeedListItem[]; nextCursor: FeedCursor | null }> {
  const limit = Math.min(Math.max(1, opts.limit ?? 30), 100);
  const sortTs = sql`coalesce(${feedItems.publishedAt}, ${feedItems.firstSeenAt})`;
  const conds = [];
  if (f.kind) conds.push(eq(feedItems.kind, f.kind));
  if (f.category) conds.push(eq(feedItems.category, f.category));
  if (f.chamber) conds.push(eq(feedItems.chamber, f.chamber));
  if (f.initiativeCode) conds.push(eq(feedItems.initiativeCode, f.initiativeCode));
  if (f.legislatorSourceId) conds.push(eq(feedItems.legislatorSourceId, f.legislatorSourceId));
  if (f.commissionName) conds.push(eq(feedItems.commissionName, f.commissionName));
  if (f.search) {
    const q = `%${f.search}%`;
    conds.push(sql`(${feedItems.title} ilike ${q} or ${feedItems.summary} ilike ${q})`);
  }
  if (opts.cursor?.publishedAt) {
    const cts = opts.cursor.publishedAt;
    const cid = opts.cursor.id;
    conds.push(
      sql`(${sortTs} < ${cts}::timestamp or (${sortTs} = ${cts}::timestamp and ${feedItems.id} < ${cid}))`,
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: feedItems.id,
      source: feedItems.source,
      kind: feedItems.kind,
      title: feedItems.title,
      summary: feedItems.summary,
      imageUrl: feedItems.imageUrl,
      url: feedItems.url,
      author: feedItems.author,
      handle: feedItems.handle,
      platform: feedItems.platform,
      category: feedItems.category,
      publishedAt: sql<string | null>`${sortTs}::text`,
      chamber: feedItems.chamber,
    })
    .from(feedItems)
    .where(where)
    .orderBy(sql`${sortTs} desc`, sql`${feedItems.id} desc`)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const ids = page.map((r) => r.id);
  const tagRows = ids.length
    ? await db
        .select({
          feedItemId: feedItemEntities.feedItemId,
          entityType: feedItemEntities.entityType,
          label: feedItemEntities.label,
          initiativeId: feedItemEntities.initiativeId,
          initiativeCode: feedItemEntities.initiativeCode,
          initiativeTitle: initiatives.title,
          legislatorSourceId: feedItemEntities.legislatorSourceId,
          commissionName: feedItemEntities.commissionName,
        })
        .from(feedItemEntities)
        .leftJoin(initiatives, eq(feedItemEntities.initiativeId, initiatives.id))
        .where(inArray(feedItemEntities.feedItemId, ids))
    : [];
  const tagsByItem = new Map<number, FeedTag[]>();
  for (const t of tagRows) {
    const arr = tagsByItem.get(t.feedItemId) ?? [];
    arr.push({
      entityType: t.entityType,
      label: t.label,
      initiativeId: t.initiativeId,
      initiativeCode: t.initiativeCode,
      initiativeTitle: t.initiativeTitle ?? null,
      legislatorSourceId: t.legislatorSourceId,
      commissionName: t.commissionName,
    });
    tagsByItem.set(t.feedItemId, arr);
  }

  const items: FeedListItem[] = page.map((r) => ({ ...r, tags: tagsByItem.get(r.id) ?? [] }));
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? { publishedAt: last.publishedAt, id: last.id } : null;
  return { items, nextCursor };
}

/** Hot topics: feed items grouped by category over a recent window. */
export async function feedTrendingCategories(
  db: Database,
  opts: { sinceDays?: number } = {},
): Promise<Bucket[]> {
  const days = opts.sinceDays ?? 14;
  const recentDays = Math.max(2, Math.ceil(days / 3));
  const priorDays = Math.max(1, days - recentDays);
  // Same acceleration model as the entities: rank categories by how much their
  // recent volume exceeds the prior baseline; `count` is the recent-window count.
  const rows = (await db.execute(sql`
    with c as (
      select coalesce(category::text, 'N/D') as key,
             coalesce(published_at, first_seen_at) as d
      from feed_items
      where coalesce(published_at, first_seen_at) >= now() - make_interval(days => ${days})
    ),
    agg as (
      select key,
             count(*) filter (where d >= now() - make_interval(days => ${recentDays}))::int as recent,
             count(*) filter (where d <  now() - make_interval(days => ${recentDays}))::int as prior
      from c group by key
    )
    select key, recent as count
    from agg
    where key <> 'N/D' and recent >= 1
    order by (recent::numeric - (prior::numeric / ${priorDays} * ${recentDays})) desc, recent desc
  `)) as unknown as { rows: Bucket[] };
  return rows.rows;
}

export interface TrendingEntity {
  entityType: string;
  label: string;
  initiativeId: number | null;
  title: string | null; // bill title (shown instead of the code)
  legislatorSourceId: string | null;
  count: number; // recent-window mentions (the badge shown in the rail)
  rising: boolean; // clearly accelerating vs the prior baseline (shows a ▲)
}

/**
 * "En tendencia" by ACCELERATION, not raw volume: surfaces bills / legislators /
 * commissions whose mentions are RISING now, so a topic that just spiked beats a
 * perennially-mentioned one that's flat.
 *
 * The window (`sinceDays`, 7/14/30) is split into a recent slice (~the last
 * third) and the prior baseline. Score = recent mentions minus what the prior
 * period's rate predicts for that slice; positive = accelerating. We only show
 * entities with ≥1 recent mention and rank by score (tie-break: recent count).
 * `count` returns the recent mentions.
 */
export async function feedTrendingEntities(
  db: Database,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<TrendingEntity[]> {
  const days = opts.sinceDays ?? 14;
  const limit = opts.limit ?? 10;
  const recentDays = Math.max(2, Math.ceil(days / 3));
  const priorDays = Math.max(1, days - recentDays); // baseline span (avoid /0)
  const rows = await db.execute(sql`
    with tagged as (
      select fe.entity_type, fe.label, fe.initiative_id, fe.legislator_source_id,
             i.title as initiative_title,
             coalesce(f.published_at, f.first_seen_at) as d
      from feed_item_entities fe
      join feed_items f on f.id = fe.feed_item_id
      left join initiatives i on i.id = fe.initiative_id
      where coalesce(f.published_at, f.first_seen_at) >= now() - make_interval(days => ${days})
    ),
    agg as (
      select entity_type as "entityType", label,
             max(initiative_id) as "initiativeId",
             max(initiative_title) as title,
             max(legislator_source_id) as "legislatorSourceId",
             count(*) filter (where d >= now() - make_interval(days => ${recentDays}))::int as recent,
             count(*) filter (where d <  now() - make_interval(days => ${recentDays}))::int as prior
      from tagged
      group by entity_type, label
    )
    select "entityType", label, "initiativeId", title, "legislatorSourceId",
           recent as count,
           (recent::numeric - (prior::numeric / ${priorDays} * ${recentDays})) as score,
           (recent::numeric - (prior::numeric / ${priorDays} * ${recentDays})) >= 1 as rising
    from agg
    where recent >= 1
    order by score desc, recent desc, label asc
    limit ${limit}
  `);
  return (rows as unknown as { rows: TrendingEntity[] }).rows;
}

/** The curated account registry, most-influential first. */
export async function listFeedAccounts(
  db: Database,
  opts: { platform?: string; kind?: string; activeOnly?: boolean; limit?: number } = {},
): Promise<FeedAccount[]> {
  const conds = [];
  if (opts.platform) conds.push(eq(feedAccounts.platform, opts.platform));
  if (opts.kind) conds.push(eq(feedAccounts.kind, opts.kind));
  if (opts.activeOnly) conds.push(eq(feedAccounts.active, true));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select()
    .from(feedAccounts)
    .where(where)
    .orderBy(sql`${feedAccounts.influenceRank} asc nulls last`, feedAccounts.name)
    .limit(opts.limit ?? 1000);
}

/** Distinct filter values present in the feed (for the left-panel dropdowns). */
export async function feedFacets(
  db: Database,
): Promise<{ categories: string[]; kinds: string[] }> {
  const cats = await db
    .select({ v: feedItems.category })
    .from(feedItems)
    .where(sql`${feedItems.category} is not null`)
    .groupBy(feedItems.category);
  const kinds = await db.select({ v: feedItems.kind }).from(feedItems).groupBy(feedItems.kind);
  return {
    categories: cats.map((c) => c.v!).filter(Boolean).sort(),
    kinds: kinds.map((k) => k.v).filter(Boolean).sort(),
  };
}

export interface RecentStatusEvent {
  id: number;
  initiativeId: number;
  status: string;
  eventDate: string | null;
  code: string | null;
  title: string;
  chamber: string | null;
  category: string | null;
  createdAt: string | null;
}

/** Recent status changes joined to their initiative — source for legislative-signal cards. */
export async function listRecentStatusEvents(
  db: Database,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<RecentStatusEvent[]> {
  const days = opts.sinceDays ?? 14;
  const limit = opts.limit ?? 100;
  return db
    .select({
      id: statusEvents.id,
      initiativeId: statusEvents.initiativeId,
      status: statusEvents.status,
      eventDate: statusEvents.eventDate,
      code: initiatives.code,
      title: initiatives.title,
      chamber: initiatives.chamber,
      category: initiatives.category,
      createdAt: sql<string | null>`${statusEvents.createdAt}::text`,
    })
    .from(statusEvents)
    .innerJoin(initiatives, eq(statusEvents.initiativeId, initiatives.id))
    .where(sql`${statusEvents.createdAt} >= now() - make_interval(days => ${days})`)
    .orderBy(sql`${statusEvents.createdAt} desc`)
    .limit(limit);
}

export interface RelatedFeedItem {
  id: number;
  kind: string;
  title: string;
  url: string | null;
  source: string;
  publishedAt: string | null;
}

/** Feed items linked to one initiative (primary or via a tag) — newest first.
 *  Powers the "Noticias relacionadas" section in the initiative detail. */
export async function listFeedForInitiative(
  db: Database,
  initiativeId: number,
  limit = 12,
): Promise<RelatedFeedItem[]> {
  return db
    .select({
      id: feedItems.id,
      kind: feedItems.kind,
      title: feedItems.title,
      url: feedItems.url,
      source: feedItems.source,
      publishedAt: sql<string | null>`coalesce(${feedItems.publishedAt}, ${feedItems.firstSeenAt})::text`,
    })
    .from(feedItems)
    .where(
      sql`${feedItems.initiativeId} = ${initiativeId} or ${feedItems.id} in (select feed_item_id from feed_item_entities where initiative_id = ${initiativeId})`,
    )
    .orderBy(sql`coalesce(${feedItems.publishedAt}, ${feedItems.firstSeenAt}) desc`)
    .limit(limit);
}

/** Resolve an official bill code → its title (for the feed's active-filter label). */
export async function initiativeByCode(
  db: Database,
  code: string,
): Promise<{ id: number; title: string } | null> {
  const [row] = await db
    .select({ id: initiatives.id, title: initiatives.title })
    .from(initiatives)
    .where(eq(initiatives.code, code))
    .limit(1);
  return row ?? null;
}

/**
 * Typeahead search over legislative bills (PDLs) by keyword — matches the bill
 * title or official code. Returns the lightest payload needed to render an
 * autocomplete option and then filter the feed by `code`.
 */
export async function searchInitiatives(
  db: Database,
  query: string,
  opts: { limit?: number } = {},
): Promise<
  Array<{ id: number; code: string; title: string; status: string | null; chamber: string | null }>
> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const rows = await db
    .select({
      id: initiatives.id,
      code: initiatives.code,
      title: initiatives.title,
      status: initiatives.status,
      chamber: initiatives.chamber,
    })
    .from(initiatives)
    .where(
      and(
        eq(initiatives.kind, "LEGISLATIVE"),
        isNotNull(initiatives.code),
        or(ilike(initiatives.title, like), ilike(initiatives.code, like)),
      ),
    )
    // Surface filed bills first, newest by filing date.
    .orderBy(sql`${initiatives.filedAt} desc nulls last`)
    .limit(opts.limit ?? 8);
  // `code` is non-null here thanks to the WHERE clause.
  return rows as Array<{
    id: number;
    code: string;
    title: string;
    status: string | null;
    chamber: string | null;
  }>;
}

export interface CommissionWithMembers {
  chamber: string;
  name: string;
  members: Array<{ name: string; cargo: string | null; party: string | null }>;
}

/** Every committee with its full membership (president/VP/secretary/members), grouped. */
export async function commissionsWithMembers(
  db: Database,
  opts: { chamber?: string } = {},
): Promise<CommissionWithMembers[]> {
  const where = opts.chamber ? eq(commissionMembers.chamber, opts.chamber) : undefined;
  const rows = await db
    .select({
      chamber: commissionMembers.chamber,
      name: commissionMembers.commissionName,
      memberName: commissionMembers.legislatorName,
      cargo: commissionMembers.cargo,
      party: commissionMembers.party,
    })
    .from(commissionMembers)
    .where(where)
    .orderBy(commissionMembers.chamber, commissionMembers.commissionName);

  // Officers first (Presidente, Vicepresidente, Secretario), then plain members A→Z.
  const rank = (c: string | null) =>
    c === "Presidente" ? 0 : c === "Vicepresidente" ? 1 : c === "Secretario" ? 2 : 3;
  const byCommission = new Map<string, CommissionWithMembers>();
  for (const r of rows) {
    const key = `${r.chamber}::${r.name}`;
    const entry = byCommission.get(key) ?? { chamber: r.chamber, name: r.name, members: [] };
    entry.members.push({ name: r.memberName, cargo: r.cargo, party: r.party });
    byCommission.set(key, entry);
  }
  const out = [...byCommission.values()];
  for (const c of out) {
    c.members.sort((a, b) => rank(a.cargo) - rank(b.cargo) || a.name.localeCompare(b.name));
  }
  return out;
}

/** Full roster grouped by province → { diputados, senadores }, keyed by raw province name. */
export async function rosterByProvince(
  db: Database,
): Promise<Array<{ province: string | null; member: RosterMember }>> {
  const rows = await listLegislators(db);
  return rows.map((member) => ({ province: member.province, member }));
}
