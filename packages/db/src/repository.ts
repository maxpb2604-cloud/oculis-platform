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
  inferenceAudit,
  ingestionRuns,
  initiatives,
  legislators,
  regulations,
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
export async function upsertInitiative(db: Database, data: NewInitiative): Promise<UpsertResult> {
  const existing = await db
    .select({ id: initiatives.id, status: initiatives.status })
    .from(initiatives)
    .where(and(eq(initiatives.source, data.source), eq(initiatives.sourceId, data.sourceId)))
    .limit(1);
  const prev = existing[0];
  // `undefined` means this collection path did not observe the field (for example, a
  // detail endpoint failed while the list endpoint still succeeded). In that case the
  // existing fact must survive. `null` remains an explicit empty value from the source.
  const statusChanged =
    prev && data.status !== undefined ? (data.status ?? null) !== (prev.status ?? null) : false;
  const rejected = {
    category: data.category ?? null,
    categoryConfidence: data.categoryConfidence ?? null,
    riskLevel: data.riskLevel ?? null,
    approvalProbability: data.approvalProbability ?? null,
    approvalScore: data.approvalScore ?? null,
    needsReview: data.needsReview ?? null,
    published: data.published ?? null,
  };
  const hasRejected = Object.values(rejected).some((value) => value != null && value !== false);
  const safeData: NewInitiative = {
    ...data,
    category: null,
    categoryConfidence: null,
    riskLevel: null,
    approvalProbability: null,
    approvalScore: null,
    needsReview: false,
    published: false,
  };

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(initiatives)
      .values(safeData)
      .onConflictDoUpdate({
        target: [initiatives.source, initiatives.sourceId],
        set: {
          ...(data.code !== undefined ? { code: data.code } : {}),
          kind: data.kind,
          title: data.title,
          ...(data.purpose !== undefined ? { purpose: data.purpose } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.chamber !== undefined ? { chamber: data.chamber } : {}),
          ...(data.sourceCategory !== undefined ? { sourceCategory: data.sourceCategory } : {}),
          ...(data.sponsor !== undefined ? { sponsor: data.sponsor } : {}),
          ...(data.sponsorRole !== undefined ? { sponsorRole: data.sponsorRole } : {}),
          ...(data.sponsorCount !== undefined ? { sponsorCount: data.sponsorCount } : {}),
          ...(data.party !== undefined ? { party: data.party } : {}),
          ...(data.province !== undefined ? { province: data.province } : {}),
          ...(data.committee !== undefined ? { committee: data.committee } : {}),
          ...(data.filedAt !== undefined ? { filedAt: data.filedAt } : {}),
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
          ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
          ...(data.raw !== undefined ? { raw: data.raw } : {}),
          category: null,
          categoryConfidence: null,
          riskLevel: null,
          approvalProbability: null,
          approvalScore: null,
          needsReview: false,
          published: false,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: initiatives.id });
    const id = row!.id;
    if (hasRejected) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "initiative",
          entityId: id,
          inferenceKind: "blocked_inference",
          value: rejected,
          provenance: {
            source: data.source,
            sourceCategory: data.sourceCategory ?? null,
            sourceUrl: data.sourceUrl ?? null,
          },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: rejected,
            provenance: {
              source: data.source,
              sourceCategory: data.sourceCategory ?? null,
              sourceUrl: data.sourceUrl ?? null,
            },
            archivedAt: sql`now()`,
          },
        });
    }
    if (statusChanged && typeof data.status === "string" && data.status.trim()) {
      await tx
        .insert(statusEvents)
        .values({
          initiativeId: id,
          status: data.status,
          eventDate: null,
          note: null,
          source: data.source,
          sourceUrl: data.sourceUrl ?? null,
          evidenceType: "OBSERVED_CHANGE",
          raw: (data.raw ?? null) as object | null,
        })
        .onConflictDoNothing();
    }
    return { id, inserted: !prev, statusChanged };
  });
}

/**
 * Record source history or an observed change, preserving its evidence type and
 * provenance. A missing source event date stays null; observedAt records only when
 * Oculis saw the value. Returns the number of newly inserted observations.
 */
export async function recordStatusEvents(
  db: Database,
  initiativeId: number,
  events: Array<{
    status: string;
    date: string | null;
    note: string | null;
    source?: string | null;
    sourceUrl?: string | null;
    evidenceType?: "SOURCE_HISTORY" | "OBSERVED_CHANGE" | "LEGACY_UNATTRIBUTED";
    raw?: unknown;
    observedAt?: Date;
  }>,
): Promise<number> {
  if (events.length === 0) return 0;
  const [parent] = await db
    .select({ source: initiatives.source, sourceUrl: initiatives.sourceUrl })
    .from(initiatives)
    .where(eq(initiatives.id, initiativeId))
    .limit(1);
  if (!parent) throw new Error(`Initiative ${initiativeId} does not exist`);
  const rows = events.map((e) => ({
    initiativeId,
    status: e.status,
    eventDate: e.date,
    note: e.note,
    source: e.source ?? parent.source,
    sourceUrl: e.sourceUrl ?? parent.sourceUrl,
    evidenceType: e.evidenceType ?? "SOURCE_HISTORY",
    raw: (e.raw ?? null) as object | null,
    observedAt: e.observedAt,
  }));
  const inserted = await db
    .insert(statusEvents)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: statusEvents.id });
  return inserted.length;
}

export async function countInitiatives(db: Database): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(initiatives);
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
async function countBy(db: Database, column: ReturnType<typeof sql>): Promise<Bucket[]> {
  const rows = await db
    .select({
      key: sql<string>`coalesce(${column}::text, 'N/D')`,
      count: sql<number>`count(*)::int`,
    })
    .from(initiatives)
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`);
  return rows.map((r) => ({ key: r.key, count: r.count }));
}

export const countByCategory = (db: Database) => countBy(db, sql`source_category`);
export const countByStatus = (db: Database) => countBy(db, sql`status`);
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
  /** Initiatives with at least one attributable document row. */
  published: number;
}

export async function dashboardKpis(db: Database): Promise<DashboardKpis> {
  const [row] = await db
    .select({
      total: sql<number>`count(distinct ${initiatives.id})::int`,
      published: sql<number>`count(distinct ${documents.initiativeId})::int`,
    })
    .from(initiatives)
    .leftJoin(documents, eq(documents.initiativeId, initiatives.id));
  return {
    total: row?.total ?? 0,
    published: row?.published ?? 0,
  };
}

export interface InitiativeListItem {
  id: number;
  code: string | null;
  title: string;
  sourceCategory: string | null;
  status: string | null;
  chamber: string | null;
  sponsor: string | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
}

export interface InitiativeFilters {
  search?: string;
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
      sourceCategory: initiatives.sourceCategory,
      status: initiatives.status,
      chamber: initiatives.chamber,
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

/** Full factual detail for one initiative and its source-attributed status timeline. */
export async function getInitiativeById(db: Database, id: number) {
  const [row] = await db
    .select({
      id: initiatives.id,
      source: initiatives.source,
      sourceId: initiatives.sourceId,
      kind: initiatives.kind,
      code: initiatives.code,
      title: initiatives.title,
      purpose: initiatives.purpose,
      type: initiatives.type,
      status: initiatives.status,
      chamber: initiatives.chamber,
      sourceCategory: initiatives.sourceCategory,
      sponsor: initiatives.sponsor,
      sponsorRole: initiatives.sponsorRole,
      sponsorCount: initiatives.sponsorCount,
      party: initiatives.party,
      province: initiatives.province,
      committee: initiatives.committee,
      filedAt: initiatives.filedAt,
      expiresAt: initiatives.expiresAt,
      sourceUrl: initiatives.sourceUrl,
      raw: initiatives.raw,
      firstSeenAt: initiatives.firstSeenAt,
      lastSeenAt: initiatives.lastSeenAt,
      updatedAt: initiatives.updatedAt,
    })
    .from(initiatives)
    .where(eq(initiatives.id, id))
    .limit(1);
  if (!row) return null;
  const events = await db
    .select({
      id: statusEvents.id,
      initiativeId: statusEvents.initiativeId,
      status: statusEvents.status,
      eventDate: statusEvents.eventDate,
      note: statusEvents.note,
      source: statusEvents.source,
      sourceUrl: statusEvents.sourceUrl,
      evidenceType: statusEvents.evidenceType,
      raw: statusEvents.raw,
      observedAt: statusEvents.observedAt,
    })
    .from(statusEvents)
    .where(eq(statusEvents.initiativeId, id)).orderBy(sql`case
      when ${statusEvents.evidenceType} = 'SOURCE_HISTORY'
        and pg_input_is_valid(${statusEvents.eventDate}, 'date')
        then ${statusEvents.eventDate}::date::timestamp
      else ${statusEvents.observedAt}
    end asc`);
  return { ...row, events };
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
  const [parties, statuses] = await Promise.all([distinct(sql`party`), distinct(sql`status`)]);
  return { parties, statuses };
}

// ---------------------------------------------------------------------------
// Committee / plenary activity (SIL "actividad" subsystem) — segmented from bills
// ---------------------------------------------------------------------------

export interface ActivityInput {
  source: string;
  scope: "COMMITTEE" | "PLENARY" | "ASAMBLEA";
  chamber?: "DIPUTADOS" | "SENADO" | null;
  date: string | null;
  time?: string | null;
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

/** Resolve an official code only when it identifies exactly one candidate in scope. */
function uniqueInitiativeIdsByCode(
  rows: Array<{ id: number; code: string | null; chamber: string | null }>,
  chamber: string | null | undefined,
): Map<string, number> {
  const candidates = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.code || (chamber && row.chamber !== chamber)) continue;
    const ids = candidates.get(row.code) ?? [];
    ids.push(row.id);
    candidates.set(row.code, ids);
  }
  return new Map(
    [...candidates].flatMap(([code, ids]) => (ids.length === 1 ? [[code, ids[0]!] as const] : [])),
  );
}

/**
 * Idempotent upsert of one agenda/activity event keyed by (source, dedupe_key), plus
 * its referenced-initiative links. Each link is resolved to an initiatives.id when that
 * bill already exists in the corpus (so the UI can join activity ↔ source bill record).
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
  return db.transaction(async (tx) => {
    const fields = {
      scope: a.scope,
      chamber: a.chamber ?? null,
      eventDate: a.date,
      eventTime: a.time ?? null,
      kind: a.kind,
      body: a.body,
      description: a.description,
      agendaUrl: a.agendaUrl ?? null,
      statuses: (a.statuses ?? null) as object | null,
      raw: a.raw as object,
      lastSeenAt: sql`now()`,
    };
    const [row] = await tx
      .insert(activityEvents)
      .values({ source: a.source, dedupeKey: a.dedupeKey, ...fields })
      .onConflictDoUpdate({
        target: [activityEvents.source, activityEvents.dedupeKey],
        set: fields,
      })
      .returning({ id: activityEvents.id });
    const id = row!.id;

    // Treat links as a source snapshot: an edited agenda must remove stale bill codes.
    await tx.delete(activityInitiatives).where(eq(activityInitiatives.activityId, id));
    const uniqueCodes = [...new Set(a.initiativeCodes.filter(Boolean))];
    if (uniqueCodes.length) {
      const matched = await tx
        .select({ id: initiatives.id, code: initiatives.code, chamber: initiatives.chamber })
        .from(initiatives)
        .where(inArray(initiatives.code, uniqueCodes));
      const byCode = uniqueInitiativeIdsByCode(matched, a.chamber);
      await tx.insert(activityInitiatives).values(
        uniqueCodes.map((code) => ({
          activityId: id,
          initiativeCode: code,
          initiativeId: byCode.get(code) ?? null,
        })),
      );
    }
    return { id, inserted: existing.length === 0 };
  });
}

/**
 * Backfill activity↔initiative links for bills ingested after their agenda activity.
 * Run after a corpus ingest so existing NULL links resolve. Returns rows updated.
 */
export async function backfillActivityInitiativeIds(db: Database): Promise<number> {
  const res = await db.execute(sql`
    with unique_matches as (
      select ai.id as link_id, min(i.id)::int as initiative_id
      from activity_initiatives ai
      join activity_events ae on ae.id = ai.activity_id
      join initiatives i
        on i.code = ai.initiative_code
       and (ae.chamber is null or i.chamber = ae.chamber)
      where ai.initiative_id is null
      group by ai.id
      having count(*) = 1
    )
    update activity_initiatives ai
    set initiative_id = matches.initiative_id
    from unique_matches matches
    where ai.id = matches.link_id
  `);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export interface ActivityListItem {
  id: number;
  source: string;
  scope: string;
  chamber: string | null;
  eventDate: string | null;
  eventTime: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl: string | null;
  statuses: string[] | null;
  initiativeCount: number;
  initiatives: Array<{
    code: string;
    initiativeId: number | null;
    title: string | null;
    sourceUrl: string | null;
  }>;
}

/**
 * Activity rows, newest first, with linked-bill counts. Filter by exact `date`, an
 * inclusive `[dateFrom, dateTo]` window (used to widen the Senate's "today" view since
 * its session dates can lag), scope, and/or chamber.
 */
export async function listActivity(
  db: Database,
  opts: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    scope?: string;
    chamber?: string;
    limit?: number;
  } = {},
): Promise<ActivityListItem[]> {
  const { date, dateFrom, dateTo, scope, chamber, limit = 200 } = opts;
  const conds = [];
  if (date) conds.push(eq(activityEvents.eventDate, date));
  if (dateFrom) conds.push(sql`${activityEvents.eventDate} >= ${dateFrom}`);
  if (dateTo) conds.push(sql`${activityEvents.eventDate} <= ${dateTo}`);
  if (scope) conds.push(eq(activityEvents.scope, scope));
  if (chamber) conds.push(eq(activityEvents.chamber, chamber));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({
      id: activityEvents.id,
      source: activityEvents.source,
      scope: activityEvents.scope,
      chamber: activityEvents.chamber,
      eventDate: activityEvents.eventDate,
      eventTime: activityEvents.eventTime,
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
  const ids = rows.map((row) => row.id);
  const links = ids.length
    ? await db
        .select({
          activityId: activityInitiatives.activityId,
          code: activityInitiatives.initiativeCode,
          initiativeId: activityInitiatives.initiativeId,
          title: initiatives.title,
          sourceUrl: initiatives.sourceUrl,
        })
        .from(activityInitiatives)
        .leftJoin(initiatives, eq(activityInitiatives.initiativeId, initiatives.id))
        .where(inArray(activityInitiatives.activityId, ids))
        .orderBy(activityInitiatives.activityId, activityInitiatives.id)
    : [];
  const linksByActivity = new Map<number, ActivityListItem["initiatives"]>();
  for (const link of links) {
    const current = linksByActivity.get(link.activityId) ?? [];
    current.push({
      code: link.code,
      initiativeId: link.initiativeId,
      title: link.title ?? null,
      sourceUrl: link.sourceUrl ?? null,
    });
    linksByActivity.set(link.activityId, current);
  }
  return rows.map((row) => ({
    ...row,
    initiatives: linksByActivity.get(row.id) ?? [],
  }));
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
  return (rows as unknown as { rows: Array<{ date: string; committee: number; plenary: number }> })
    .rows;
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
  const rejected = {
    interventionLevel: r.interventionLevel ?? null,
    category: r.category ?? null,
    needsReview: r.needsReview ?? null,
  };
  const hasRejected = Object.values(rejected).some((value) => value != null && value !== false);
  const safeRegulation: NewRegulation = {
    ...r,
    sourceCategory: r.sourceCategory ?? null,
    isConsulta: r.isConsulta ?? null,
    interventionLevel: null,
    category: null,
    needsReview: false,
  };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(regulations)
      .values(safeRegulation)
      .onConflictDoUpdate({
        target: [regulations.source, regulations.sourceId],
        set: {
          title: r.title,
          institution: r.institution,
          regType: r.regType,
          purpose: r.purpose,
          status: r.status,
          sourceCategory: r.sourceCategory ?? null,
          interventionLevel: null,
          category: null,
          province: r.province,
          isConsulta: r.isConsulta ?? null,
          publishedAt: r.publishedAt,
          deadline: r.deadline,
          url: r.url,
          needsReview: false,
          raw: r.raw,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: regulations.id });
    const id = row!.id;
    if (hasRejected) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "regulation",
          entityId: id,
          inferenceKind: "blocked_inference",
          value: rejected,
          provenance: {
            source: r.source,
            sourceCategory: r.sourceCategory ?? null,
            sourceUrl: r.url ?? null,
          },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: rejected,
            provenance: {
              source: r.source,
              sourceCategory: r.sourceCategory ?? null,
              sourceUrl: r.url ?? null,
            },
            archivedAt: sql`now()`,
          },
        });
    }
    return { id, inserted: existing.length === 0 };
  });
}

export interface RegulationListItem {
  id: number;
  institution: string;
  regType: string | null;
  title: string;
  status: string | null;
  sourceCategory: string | null;
  isConsulta: boolean | null;
  publishedAt: string | null;
  deadline: string | null;
  url: string | null;
}

export async function listRegulations(
  db: Database,
  opts: { institution?: string; consultaOnly?: boolean; limit?: number } = {},
): Promise<RegulationListItem[]> {
  const conds = [];
  if (opts.institution) conds.push(eq(regulations.institution, opts.institution));
  if (opts.consultaOnly) conds.push(eq(regulations.isConsulta, true));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: regulations.id,
      institution: regulations.institution,
      regType: regulations.regType,
      title: regulations.title,
      status: regulations.status,
      sourceCategory: regulations.sourceCategory,
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
  institutions: number;
}

export async function regulatoryKpis(db: Database): Promise<RegulatoryKpis> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      consultas: sql<number>`count(*) filter (where ${regulations.isConsulta})::int`,
      institutions: sql<number>`count(distinct ${regulations.institution})::int`,
    })
    .from(regulations);
  return {
    total: row?.total ?? 0,
    consultas: row?.consultas ?? 0,
    institutions: row?.institutions ?? 0,
  };
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
): Promise<
  Array<{ chamber: string; name: string; president: string | null; sourceUrl: string | null }>
> {
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
    const matches = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(eq(initiatives.code, d.initiativeCode))
      .limit(2);
    initiativeId = matches.length === 1 ? matches[0]!.id : null;
  }
  const sourceDocId =
    d.sourceDocId ??
    [d.initiativeCode ?? "unknown", d.docType ?? "document", d.uploadedAt ?? "undated", d.url ?? ""]
      .join("|")
      .slice(0, 500);
  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.source, d.source), eq(documents.sourceDocId, sourceDocId)))
    .limit(1);
  await db
    .insert(documents)
    .values({ ...d, sourceDocId, initiativeId })
    .onConflictDoUpdate({
      target: [documents.source, documents.sourceDocId],
      set: {
        initiativeId,
        initiativeCode: d.initiativeCode,
        docType: d.docType,
        extension: d.extension,
        url: d.url,
        uploadedAt: d.uploadedAt,
        modifiedAt: d.modifiedAt ?? sql`${documents.modifiedAt}`,
        sourceCategory: d.sourceCategory ?? sql`${documents.sourceCategory}`,
        sourceFragment: d.sourceFragment ?? sql`${documents.sourceFragment}`,
        raw: d.raw ?? sql`${documents.raw}`,
        lastSeenAt: sql`now()`,
      },
    });
  return existing.length === 0;
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
): Promise<
  Array<{
    id: number;
    sourceDocId: string | null;
    initiativeCode: string | null;
    url: string | null;
    docType: string | null;
  }>
> {
  const q = db
    .select({
      id: documents.id,
      sourceDocId: documents.sourceDocId,
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
): Promise<
  Array<{
    id: number;
    source: string;
    sourceDocId: string | null;
    docType: string | null;
    extension: string | null;
    url: string | null;
    uploadedAt: string | null;
    modifiedAt: string | null;
    sourceCategory: string | null;
    sourceFragment: string | null;
    raw: unknown;
    firstSeenAt: string;
    lastSeenAt: string;
  }>
> {
  return db
    .select({
      id: documents.id,
      source: documents.source,
      sourceDocId: documents.sourceDocId,
      docType: documents.docType,
      extension: documents.extension,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
      modifiedAt: documents.modifiedAt,
      sourceCategory: documents.sourceCategory,
      sourceFragment: documents.sourceFragment,
      raw: documents.raw,
      firstSeenAt: sql<string>`${documents.firstSeenAt}::text`,
      lastSeenAt: sql<string>`${documents.lastSeenAt}::text`,
    })
    .from(documents)
    .where(eq(documents.initiativeId, initiativeId))
    .orderBy(sql`${documents.uploadedAt} desc nulls last`);
}

export interface SourceDocumentListItem {
  id: number;
  source: string;
  sourceDocId: string | null;
  initiativeCode: string | null;
  docType: string | null;
  extension: string | null;
  url: string | null;
  uploadedAt: string | null;
  modifiedAt: string | null;
  sourceCategory: string | null;
  sourceFragment: string | null;
  raw: unknown;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Official documents from named source collections, including unlinked documents. */
export async function listSourceDocuments(
  db: Database,
  opts: { sources: readonly string[]; limit?: number },
): Promise<SourceDocumentListItem[]> {
  if (opts.sources.length === 0) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
  return db
    .select({
      id: documents.id,
      source: documents.source,
      sourceDocId: documents.sourceDocId,
      initiativeCode: documents.initiativeCode,
      docType: documents.docType,
      extension: documents.extension,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
      modifiedAt: documents.modifiedAt,
      sourceCategory: documents.sourceCategory,
      sourceFragment: documents.sourceFragment,
      raw: documents.raw,
      firstSeenAt: sql<string>`${documents.firstSeenAt}::text`,
      lastSeenAt: sql<string>`${documents.lastSeenAt}::text`,
    })
    .from(documents)
    .where(
      and(inArray(documents.source, [...opts.sources]), sql`${documents.initiativeId} is null`),
    )
    .orderBy(
      sql`${documents.uploadedAt} desc nulls last`,
      sql`${documents.firstSeenAt} desc`,
      sql`${documents.id} desc`,
    )
    .limit(limit);
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

/** Start a visible source run before network work; a crash/timeout leaves it pending. */
export async function beginIngestionRun(
  db: Database,
  source: string,
  details: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await db
    .insert(ingestionRuns)
    .values({
      source,
      details: { ...details, outcome: "RUNNING", lifecycle: "EXPLICIT_BEGIN_FINISH" },
    })
    .returning({ id: ingestionRuns.id });
  return row!.id;
}

/** Finish a per-source ingestion run for the health panel. */
export async function recordIngestionRun(
  db: Database,
  run: {
    runId?: number;
    source: string;
    seen?: number;
    inserted?: number;
    updated?: number;
    statusChanges?: number;
    ok: boolean;
    outcome?: "COMPLETE" | "PARTIAL" | "FAILED";
    error?: string | null;
    details?: unknown;
  },
): Promise<void> {
  const outcome = run.outcome ?? (run.ok ? "COMPLETE" : "FAILED");
  const suppliedDetails =
    run.details && typeof run.details === "object" && !Array.isArray(run.details)
      ? (run.details as Record<string, unknown>)
      : run.details == null
        ? {}
        : { payload: run.details };
  const values = {
    source: run.source,
    finishedAt: sql`now()`,
    seen: run.seen ?? 0,
    inserted: run.inserted ?? 0,
    updated: run.updated ?? 0,
    statusChanges: run.statusChanges ?? 0,
    ok: run.ok,
    error: run.error ?? null,
    details: {
      ...suppliedDetails,
      outcome,
      lifecycle: run.runId === undefined ? "COMPLETION_ONLY" : "EXPLICIT_BEGIN_FINISH",
    },
  };
  if (run.runId !== undefined) {
    const updated = await db
      .update(ingestionRuns)
      .set(values)
      .where(and(eq(ingestionRuns.id, run.runId), eq(ingestionRuns.source, run.source)))
      .returning({ id: ingestionRuns.id });
    if (updated.length !== 1) {
      throw new Error(`Ingestion run ${run.runId} for ${run.source} does not exist`);
    }
    return;
  }
  await db.insert(ingestionRuns).values(values);
}

export interface SourceHealth {
  source: string;
  /** When this completed run row was recorded (legacy column name: started_at). */
  recordedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  outcome: "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";
  seen: number;
  inserted: number;
  updated: number;
  statusChanges: number;
  error: string | null;
  details: unknown;
  /** Last time this source ran ok (so a transient failure doesn't hide freshness). */
  lastSuccessAt: string | null;
  /** Last completed observation that contained one or more source records. */
  lastDataAt: string | null;
  /** Historical median of successful runs; context only, never a health verdict. */
  baselineSeen: number | null;
}

/**
 * Health of every source for the "Estado de monitoreo" page: the latest run, the last
 * successful run, factual counters from the latest run, and a historical median for
 * context. This repository does not infer a health status from that baseline.
 */
export async function latestRunsBySource(db: Database): Promise<SourceHealth[]> {
  const rows = await db.execute(sql`
    with latest as (
      select distinct on (source)
        id, source, started_at as "recordedAt", finished_at as "finishedAt",
        ok,
        case
          when finished_at is null and ok is null then 'RUNNING'
          when details->>'outcome' in ('COMPLETE','PARTIAL','FAILED') then details->>'outcome'
          when ok then 'COMPLETE'
          else 'FAILED'
        end as outcome,
        seen, inserted, updated,
        status_changes as "statusChanges", error, details
      from ingestion_runs order by source, started_at desc
    ),
    success as (
      select distinct on (source) source, finished_at as "lastSuccessAt"
      from ingestion_runs where ok order by source, started_at desc
    ),
    last_data as (
      select distinct on (source) source, finished_at as "lastDataAt"
      from ingestion_runs where seen > 0 order by source, started_at desc
    ),
    baseline as (
      select r.source,
             percentile_cont(0.5) within group (order by r.seen)::int as "baselineSeen"
      from ingestion_runs r
      join latest l on l.source = r.source and l.id <> r.id
      where r.ok and r.seen > 0 group by r.source
    )
    select l.source, l."recordedAt", l."finishedAt", l.ok, l.outcome,
           l.seen, l.inserted, l.updated,
           l."statusChanges", l.error, l.details,
           s."lastSuccessAt", d."lastDataAt", b."baselineSeen"
    from latest l
    left join success s on s.source = l.source
    left join last_data d on d.source = l.source
    left join baseline b on b.source = l.source
    order by l.source
  `);
  return (rows as unknown as { rows: SourceHealth[] }).rows;
}

/** Most recent initiatives by the factual filing date reported by the source. */
export async function listRecentInitiatives(
  db: Database,
  opts: { limit?: number; dateFrom?: string; chamber?: string } = {},
): Promise<InitiativeListItem[]> {
  const { limit = 50, dateFrom, chamber } = opts;
  const conds = [];
  if (dateFrom) conds.push(sql`${initiatives.filedAt} >= ${dateFrom}`);
  if (chamber) conds.push(eq(initiatives.chamber, chamber));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: initiatives.id,
      code: initiatives.code,
      title: initiatives.title,
      sourceCategory: initiatives.sourceCategory,
      status: initiatives.status,
      chamber: initiatives.chamber,
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
        active: true,
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
      target: [
        commissionMembers.source,
        commissionMembers.commissionName,
        commissionMembers.legislatorName,
      ],
      set: {
        chamber: m.chamber,
        commissionSourceId: m.commissionSourceId,
        legislatorSourceId: m.legislatorSourceId,
        cargo: m.cargo,
        party: m.party,
        sourceUrl: m.sourceUrl,
        active: true,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Atomically replace one source's current roster snapshot. Rows absent from a fully
 * collected and cardinality-validated snapshot remain stored for audit/history but
 * are no longer served as current members.
 */
export async function replaceRosterSnapshot(
  db: Database,
  source: string,
  roster: readonly NewLegislator[],
  memberships: readonly NewCommissionMember[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(legislators).set({ active: false }).where(eq(legislators.source, source));
    await tx
      .update(commissionMembers)
      .set({ active: false })
      .where(eq(commissionMembers.source, source));

    for (const member of roster) {
      await tx
        .insert(legislators)
        .values({ ...member, active: true })
        .onConflictDoUpdate({
          target: [legislators.source, legislators.sourceId],
          set: {
            chamber: member.chamber,
            fullName: member.fullName,
            province: member.province,
            circumscription: member.circumscription,
            party: member.party,
            partyShort: member.partyShort,
            role: member.role,
            representationLevel: member.representationLevel,
            period: member.period,
            photoUrl: member.photoUrl,
            email: member.email,
            phone: member.phone,
            profession: member.profession,
            sourceUrl: member.sourceUrl,
            active: true,
            raw: member.raw,
            lastSeenAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
    }

    for (const membership of memberships) {
      await tx
        .insert(commissionMembers)
        .values({ ...membership, active: true })
        .onConflictDoUpdate({
          target: [
            commissionMembers.source,
            commissionMembers.commissionName,
            commissionMembers.legislatorName,
          ],
          set: {
            chamber: membership.chamber,
            commissionSourceId: membership.commissionSourceId,
            legislatorSourceId: membership.legislatorSourceId,
            cargo: membership.cargo,
            party: membership.party,
            sourceUrl: membership.sourceUrl,
            active: true,
            updatedAt: sql`now()`,
          },
        });
    }
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
  conds.push(eq(legislators.active, true));
  if (opts.chamber) conds.push(eq(legislators.chamber, opts.chamber));
  if (opts.province) conds.push(eq(legislators.province, opts.province));
  if (opts.party) conds.push(eq(legislators.partyShort, opts.party));
  const where = and(...conds);
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
    .where(eq(commissionMembers.active, true))
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
  const rejectedCategory = item.category ?? null;
  const safeItem: NewFeedItem = { ...item, category: null };
  return db.transaction(async (tx) => {
    const updates = {
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      imageUrl: item.imageUrl,
      url: item.url,
      author: item.author,
      handle: item.handle,
      platform: item.platform,
      category: null,
      publishedAt: item.publishedAt,
      initiativeId: item.initiativeId,
      initiativeCode: item.initiativeCode,
      legislatorSourceId: item.legislatorSourceId,
      commissionName: item.commissionName,
      chamber: item.chamber,
      raw: item.raw,
      lastSeenAt: sql`now()`,
    };
    const [row] = await tx
      .insert(feedItems)
      .values(safeItem)
      .onConflictDoUpdate({
        target: [feedItems.source, feedItems.sourceId],
        set: updates,
      })
      .returning({ id: feedItems.id });
    const id = row!.id;

    if (rejectedCategory != null) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "feed_item",
          entityId: id,
          inferenceKind: "blocked_category",
          value: { category: rejectedCategory },
          provenance: { source: item.source, sourceUrl: item.url ?? null },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: { category: rejectedCategory },
            provenance: { source: item.source, sourceUrl: item.url ?? null },
            archivedAt: sql`now()`,
          },
        });
    }

    // Tags are a source snapshot. Clearing/reclassifying an item removes stale links.
    await tx.delete(feedItemEntities).where(eq(feedItemEntities.feedItemId, id));
    const uniqueTags = [
      ...new Map(tags.map((tag) => [`${tag.entityType}\u0000${tag.label}`, tag] as const)).values(),
    ];
    const codes = uniqueTags
      .filter((t) => t.entityType === "INITIATIVE" && t.initiativeCode)
      .map((t) => t.initiativeCode!) as string[];
    const codeToId = new Map<string, number>();
    if (codes.length) {
      const rows = await tx
        .select({ id: initiatives.id, code: initiatives.code, chamber: initiatives.chamber })
        .from(initiatives)
        .where(inArray(initiatives.code, codes));
      for (const [code, id] of uniqueInitiativeIdsByCode(rows, item.chamber)) {
        codeToId.set(code, id);
      }
    }
    for (const t of uniqueTags) {
      const initiativeId = t.initiativeCode ? (codeToId.get(t.initiativeCode) ?? null) : null;
      await tx.insert(feedItemEntities).values({
        feedItemId: id,
        entityType: t.entityType,
        initiativeCode: t.initiativeCode ?? null,
        initiativeId,
        legislatorSourceId: t.legislatorSourceId ?? null,
        commissionName: t.commissionName ?? null,
        label: t.label,
      });
    }
    return { id, inserted: existing.length === 0 };
  });
}

/** Idempotent upsert of a registry account keyed by (platform, handle). */
export async function upsertFeedAccount(db: Database, a: NewFeedAccount): Promise<void> {
  const rejectedRank = a.influenceRank ?? null;
  const safeAccount: NewFeedAccount = { ...a, influenceRank: null };
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(feedAccounts)
      .values(safeAccount)
      .onConflictDoUpdate({
        target: [feedAccounts.platform, feedAccounts.handle],
        set: {
          name: a.name,
          url: a.url,
          kind: a.kind,
          chamber: a.chamber,
          legislatorSourceId: a.legislatorSourceId,
          influenceRank: null,
          active: a.active ?? true,
          raw: a.raw,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: feedAccounts.id });
    if (rejectedRank != null) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "feed_account",
          entityId: row!.id,
          inferenceKind: "blocked_influence_rank",
          value: { influenceRank: rejectedRank },
          provenance: { platform: a.platform, handle: a.handle, url: a.url },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: { influenceRank: rejectedRank },
            provenance: { platform: a.platform, handle: a.handle, url: a.url },
            archivedAt: sql`now()`,
          },
        });
    }
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
  /** Publication time explicitly supplied by the upstream source. */
  publishedAt: string | null;
  /** First time Oculis stored the item; never presented as a source publication time. */
  observedAt: string;
  /** Internal keyset-order timestamp (`publishedAt ?? observedAt`). */
  sortAt: string;
  chamber: string | null;
  tags: FeedTag[];
}

export interface FeedFilters {
  kind?: string;
  initiativeCode?: string;
  legislatorSourceId?: string;
  commissionName?: string;
  chamber?: string;
  search?: string;
}

export interface FeedCursor {
  sortAt: string;
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
  if (f.chamber) conds.push(eq(feedItems.chamber, f.chamber));
  if (f.initiativeCode) {
    conds.push(sql`(
      ${feedItems.initiativeCode} = ${f.initiativeCode}
      or exists (
        select 1 from feed_item_entities fie
        where fie.feed_item_id = ${feedItems.id}
          and fie.entity_type = 'INITIATIVE'
          and fie.initiative_code = ${f.initiativeCode}
      )
    )`);
  }
  if (f.legislatorSourceId) {
    conds.push(sql`(
      ${feedItems.legislatorSourceId} = ${f.legislatorSourceId}
      or exists (
        select 1 from feed_item_entities fie
        where fie.feed_item_id = ${feedItems.id}
          and fie.entity_type = 'LEGISLATOR'
          and fie.legislator_source_id = ${f.legislatorSourceId}
      )
    )`);
  }
  if (f.commissionName) {
    conds.push(sql`(
      ${feedItems.commissionName} = ${f.commissionName}
      or exists (
        select 1 from feed_item_entities fie
        where fie.feed_item_id = ${feedItems.id}
          and fie.entity_type = 'COMMISSION'
          and fie.commission_name = ${f.commissionName}
      )
    )`);
  }
  if (f.search) {
    const q = `%${f.search}%`;
    conds.push(sql`(${feedItems.title} ilike ${q} or ${feedItems.summary} ilike ${q})`);
  }
  if (opts.cursor?.sortAt) {
    const cts = opts.cursor.sortAt;
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
      publishedAt: sql<string | null>`${feedItems.publishedAt}::text`,
      observedAt: sql<string>`${feedItems.firstSeenAt}::text`,
      sortAt: sql<string>`${sortTs}::text`,
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
  const nextCursor = hasMore && last ? { sortAt: last.sortAt, id: last.id } : null;
  return { items, nextCursor };
}

export type FeedAccountListItem = Omit<FeedAccount, "influenceRank">;

/** The curated account registry, alphabetically; subjective rank is not exposed. */
export async function listFeedAccounts(
  db: Database,
  opts: { platform?: string; kind?: string; activeOnly?: boolean; limit?: number } = {},
): Promise<FeedAccountListItem[]> {
  const conds = [];
  if (opts.platform) conds.push(eq(feedAccounts.platform, opts.platform));
  if (opts.kind) conds.push(eq(feedAccounts.kind, opts.kind));
  if (opts.activeOnly) conds.push(eq(feedAccounts.active, true));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: feedAccounts.id,
      name: feedAccounts.name,
      handle: feedAccounts.handle,
      platform: feedAccounts.platform,
      url: feedAccounts.url,
      kind: feedAccounts.kind,
      chamber: feedAccounts.chamber,
      legislatorSourceId: feedAccounts.legislatorSourceId,
      active: feedAccounts.active,
      raw: feedAccounts.raw,
      firstSeenAt: feedAccounts.firstSeenAt,
      lastSeenAt: feedAccounts.lastSeenAt,
      updatedAt: feedAccounts.updatedAt,
    })
    .from(feedAccounts)
    .where(where)
    .orderBy(feedAccounts.name, feedAccounts.handle)
    .limit(opts.limit ?? 1000);
}

export interface RecentStatusEvent {
  id: number;
  initiativeId: number;
  status: string;
  eventDate: string | null;
  code: string | null;
  title: string;
  chamber: string | null;
  source: string;
  sourceUrl: string | null;
  evidenceType: string;
  raw: unknown;
  observedAt: string;
  effectiveAt: string;
}

/** Recent status changes joined to their initiative — source for legislative-signal cards. */
export async function listRecentStatusEvents(
  db: Database,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<RecentStatusEvent[]> {
  const days = Math.max(1, opts.sinceDays ?? 14);
  const limit = opts.limit ?? 100;
  const effectiveTime = sql`case
    when ${statusEvents.evidenceType} = 'SOURCE_HISTORY'
      and pg_input_is_valid(${statusEvents.eventDate}, 'date')
      then ${statusEvents.eventDate}::date::timestamp
    when ${statusEvents.evidenceType} = 'OBSERVED_CHANGE'
      then ${statusEvents.observedAt}
  end`;
  return db
    .select({
      id: statusEvents.id,
      initiativeId: statusEvents.initiativeId,
      status: statusEvents.status,
      eventDate: statusEvents.eventDate,
      code: initiatives.code,
      title: initiatives.title,
      chamber: initiatives.chamber,
      source: statusEvents.source,
      sourceUrl: statusEvents.sourceUrl,
      evidenceType: statusEvents.evidenceType,
      raw: statusEvents.raw,
      observedAt: sql<string>`${statusEvents.observedAt}::text`,
      effectiveAt: sql<string>`${effectiveTime}::text`,
    })
    .from(statusEvents)
    .innerJoin(initiatives, eq(statusEvents.initiativeId, initiatives.id))
    .where(
      sql`(
      ${statusEvents.evidenceType} = 'SOURCE_HISTORY'
      and case when pg_input_is_valid(${statusEvents.eventDate}, 'date')
        then ${statusEvents.eventDate}::date >= current_date - ${days}::int
        else false
      end
    ) or (
      ${statusEvents.evidenceType} = 'OBSERVED_CHANGE'
      and ${statusEvents.observedAt} >= now() - make_interval(days => ${days})
    )`,
    )
    .orderBy(sql`${effectiveTime} desc`)
    .limit(limit);
}

export interface RelatedFeedItem {
  id: number;
  kind: string;
  title: string;
  url: string | null;
  source: string;
  publishedAt: string | null;
  observedAt: string;
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
      publishedAt: sql<string | null>`${feedItems.publishedAt}::text`,
      observedAt: sql<string>`${feedItems.firstSeenAt}::text`,
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
  const rows = await db
    .select({ id: initiatives.id, title: initiatives.title })
    .from(initiatives)
    .where(eq(initiatives.code, code))
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

/** Resolve a complete official code only when it identifies one initiative in scope. */
export async function uniqueInitiativeIdByCode(
  db: Database,
  code: string,
  chamber?: string,
): Promise<number | null> {
  const where = chamber
    ? and(eq(initiatives.code, code), eq(initiatives.chamber, chamber))
    : eq(initiatives.code, code);
  const rows = await db.select({ id: initiatives.id }).from(initiatives).where(where).limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
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
  const where = opts.chamber
    ? and(eq(commissionMembers.active, true), eq(commissionMembers.chamber, opts.chamber))
    : eq(commissionMembers.active, true);
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
