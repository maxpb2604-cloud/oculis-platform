/**
 * Persistence operations for ingestion: idempotent upsert of initiatives and
 * append-only status-event recording with change detection.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  activityEvents,
  activityInitiatives,
  commissions,
  documents,
  ingestionRuns,
  initiatives,
  scoreInputs,
  statusEvents,
} from "./schema.js";
import type { NewCommission, NewDocument, NewInitiative } from "./schema.js";

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
}

export interface InitiativeFilters {
  search?: string;
  category?: string;
  risk?: string;
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

  let id: number;
  let inserted = false;
  if (existing.length === 0) {
    const [row] = await db
      .insert(activityEvents)
      .values({
        source: a.source,
        scope: a.scope,
        chamber: a.chamber ?? null,
        eventDate: a.date,
        kind: a.kind,
        body: a.body,
        description: a.description,
        agendaUrl: a.agendaUrl ?? null,
        dedupeKey: a.dedupeKey,
        raw: a.raw as object,
      })
      .returning({ id: activityEvents.id });
    id = row!.id;
    inserted = true;
  } else {
    id = existing[0]!.id;
    // refresh enrichable fields too (chamber/agendaUrl were added later, so this
    // backfills rows first seen before those columns existed)
    await db
      .update(activityEvents)
      .set({
        scope: a.scope,
        chamber: a.chamber ?? null,
        agendaUrl: a.agendaUrl ?? null,
        kind: a.kind,
        body: a.body,
        lastSeenAt: sql`now()`,
      })
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
      .onConflictDoNothing();
  }
  return { id, inserted };
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
  initiativeCount: number;
}

/** Activity for a given ISO date (default: all), newest first, with linked-bill counts. */
export async function listActivity(
  db: Database,
  opts: { date?: string; scope?: string; chamber?: string; limit?: number } = {},
): Promise<ActivityListItem[]> {
  const { date, scope, chamber, limit = 200 } = opts;
  const conds = [];
  if (date) conds.push(eq(activityEvents.eventDate, date));
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
      initiativeCount: sql<number>`count(${activityInitiatives.id})::int`,
    })
    .from(activityEvents)
    .leftJoin(activityInitiatives, eq(activityInitiatives.activityId, activityEvents.id))
    .where(where)
    .groupBy(activityEvents.id)
    .orderBy(sql`${activityEvents.eventDate} desc nulls last`, activityEvents.body)
    .limit(limit);
}

/** Daily activity counts (for the dashboard "activity per day" view). */
export async function activityCountsByDate(
  db: Database,
  opts: { since?: string } = {},
): Promise<Array<{ date: string; committee: number; plenary: number }>> {
  const where = opts.since ? sql`where event_date >= ${opts.since}` : sql``;
  const rows = await db.execute(sql`
    select event_date as date,
           count(*) filter (where scope = 'COMMITTEE')::int as committee,
           count(*) filter (where scope = 'PLENARY')::int as plenary
    from activity_events ${where}
    group by event_date
    order by event_date desc nulls last
  `);
  return (rows as unknown as { rows: Array<{ date: string; committee: number; plenary: number }> }).rows;
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

/** Latest run per source (for the "Estado de monitoreo" health page). */
export async function latestRunsBySource(
  db: Database,
): Promise<Array<{ source: string; finishedAt: Date | null; ok: boolean | null; seen: number; error: string | null; details: unknown }>> {
  const rows = await db.execute(sql`
    select distinct on (source)
      source, finished_at as "finishedAt", ok, seen, error, details
    from ingestion_runs
    order by source, started_at desc
  `);
  return (rows as unknown as { rows: Array<{ source: string; finishedAt: Date | null; ok: boolean | null; seen: number; error: string | null; details: unknown }> }).rows;
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
    })
    .from(initiatives)
    .where(where)
    .orderBy(sql`${initiatives.filedAt} desc nulls last`)
    .limit(limit);
}
