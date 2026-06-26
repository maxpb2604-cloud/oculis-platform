/**
 * Server-side data access for the dashboard. Reuses @oculis/db, which reads from
 * Postgres (DATABASE_URL) or a file-backed PGlite (PGLITE_DIR) — the same store the
 * worker writes to. A single shared handle is cached across requests.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { normProvince, resolveProvince } from "./provinces";
export { normProvince, resolveProvince } from "./provinces";
import {
  createDb,
  activityCountsByDate,
  countByApprovalProbability,
  countByCategory,
  countByProvince,
  countByRisk,
  countByStatus,
  legislatorsByProvince,
  listLegislators,
  commissionsWithMembers,
  legislatorCommittees,
  type RosterMember,
  type CommissionWithMembers,
  dashboardKpis,
  facets,
  getInitiativeById,
  latestRunsBySource,
  listActivity,
  listCommissions,
  listDeposits,
  listInitiatives,
  listRecentInitiatives,
  listRegulations,
  type DepositItem,
  regulatoryKpis,
  regulationsByInstitution,
  listFeedItems,
  feedFacets,
  feedTrendingCategories,
  feedTrendingEntities,
  listFeedAccounts,
  type FeedFilters,
  type FeedCursor,
  type FeedAccount,
  type DbHandle,
  type InitiativeFilters,
} from "@oculis/db";

export type {
  FeedFilters,
  FeedCursor,
  FeedListItem,
  FeedTag,
  FeedAccount,
  TrendingEntity,
  Bucket,
} from "@oculis/db";

let handle: DbHandle | null = null;
async function db() {
  if (!handle) {
    handle = createDb();
    await handle.ensureSchema(); // safe no-op if tables already exist
  }
  return handle.db;
}

export async function getDashboardData() {
  const d = await db();
  const [kpis, byRisk, byApproval, byCategory, byStatus, recent] = await Promise.all([
    dashboardKpis(d),
    countByRisk(d),
    countByApprovalProbability(d),
    countByCategory(d),
    countByStatus(d),
    listRecentInitiatives(d, { limit: 40 }),
  ]);
  return { kpis, byRisk, byApproval, byCategory, byStatus, recent };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

/**
 * Initiatives aggregated by sponsor province, joined to province centroids → a GeoJSON
 * FeatureCollection ready for the bubble map. DB province names are normalized (accents
 * stripped) and a few aliases merged ("Nacional" → Distrito Nacional, "Bahoruco" →
 * Baoruco). Provinces with no initiatives still appear (count 0) so the map is complete.
 */
export async function getInitiativesByProvince() {
  const { PROVINCIAS } = await import("./province-data");
  const d = await db();
  const buckets = await countByProvince(d);

  const norm = normProvince;
  const resolve = resolveProvince;

  const counts = new Map<string, number>();
  for (const b of buckets) {
    if (!b.key || b.key === "N/D") continue;
    const k = resolve(b.key);
    counts.set(k, (counts.get(k) ?? 0) + b.count);
  }

  const features = PROVINCIAS.map((p) => ({
    type: "Feature" as const,
    properties: { nombre: p.properties.nombre, iniciativas: counts.get(norm(p.properties.nombre)) ?? 0 },
    geometry: p.geometry,
  }));
  return { type: "FeatureCollection" as const, features };
}

export type ProvinceFC = Awaited<ReturnType<typeof getInitiativesByProvince>>;

export interface Legislator {
  name: string;
  role: string | null;
  party: string | null;
}
export type LegislatorsByProvince = Record<string, { diputados: Legislator[]; senadores: Legislator[] }>;

/**
 * Full elected roster grouped by province → keyed by the same normalized province name
 * used by the bubble map, so a clicked province resolves every one of its deputies and
 * senators (not just bill sponsors). Falls back to the sponsor-derived list only if the
 * roster table is empty (e.g. before the first `roster` ingestion run).
 */
export async function getLegislatorsByProvince(): Promise<LegislatorsByProvince> {
  const d = await db();
  const roster = await listLegislators(d);
  if (roster.length === 0) return getSponsorLegislatorsByProvince();

  const out: LegislatorsByProvince = {};
  for (const r of roster) {
    if (!r.province) continue; // "En el Exterior" etc. — no province point on the map
    const key = resolveProvince(r.province);
    const bucket = (out[key] ??= { diputados: [], senadores: [] });
    const leg: Legislator = {
      name: r.fullName,
      role: r.role ?? r.circumscription ?? (r.chamber === "SENADO" ? "Senador/a" : "Diputado/a"),
      party: r.partyShort ?? r.party,
    };
    if (r.chamber === "SENADO") bucket.senadores.push(leg);
    else bucket.diputados.push(leg);
  }
  return out;
}

/** Legacy sponsor-derived fallback (used only when the roster table is empty). */
async function getSponsorLegislatorsByProvince(): Promise<LegislatorsByProvince> {
  const d = await db();
  const rows = await legislatorsByProvince(d);
  const out: LegislatorsByProvince = {};
  for (const r of rows) {
    const key = resolveProvince(r.province);
    const bucket = (out[key] ??= { diputados: [], senadores: [] });
    const leg: Legislator = { name: r.sponsor, role: r.role, party: r.party };
    if (r.chamber === "SENADO") bucket.senadores.push(leg);
    else bucket.diputados.push(leg);
  }
  return out;
}

export type { RosterMember, CommissionWithMembers };

/** A legislator plus the committees they sit on (with their cargo) — powers the profile modal. */
export interface LegislatorProfile extends RosterMember {
  committees: Array<{ name: string; cargo: string | null }>;
}

export interface CongresoData {
  legislators: LegislatorProfile[];
  commissions: CommissionWithMembers[];
  /** Distinct party siglas present, sorted, for the filter UI. */
  parties: string[];
  /** Distinct province names (display form), sorted; "Exterior" sentinel for ultramar. */
  provinces: string[];
}

/**
 * Everything the /congresistas page needs: the full roster (both chambers), each enriched
 * with their committee seats, plus the standalone committee composition and the facet
 * lists (parties, provinces) for client-side filtering.
 *
 * Cached for 5 min: the roster changes weekly (the `roster` ingestion), so re-querying
 * ~2.8k rows on every page view is wasteful. `revalidate` keeps it fresh enough.
 */
async function _getCongreso(): Promise<CongresoData> {
  const d = await db();
  const [roster, commissions, seats] = await Promise.all([
    listLegislators(d),
    commissionsWithMembers(d),
    legislatorCommittees(d),
  ]);

  // Index committee seats: Diputados link reliably by sourceId; Senado has no member id,
  // so fall back to a normalized-name key.
  const nameKey = (s: string) => normProvince(s);
  const bySourceId = new Map<string, Array<{ name: string; cargo: string | null }>>();
  const byName = new Map<string, Array<{ name: string; cargo: string | null }>>();
  for (const s of seats) {
    const entry = { name: s.commissionName, cargo: s.cargo };
    if (s.legislatorSourceId) {
      (bySourceId.get(s.legislatorSourceId) ?? bySourceId.set(s.legislatorSourceId, []).get(s.legislatorSourceId)!).push(entry);
    }
    const nk = nameKey(s.legislatorName);
    (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(entry);
  }

  const legislators: LegislatorProfile[] = roster.map((l) => ({
    ...l,
    committees: bySourceId.get(l.sourceId) ?? byName.get(nameKey(l.fullName)) ?? [],
  }));

  const parties = [...new Set(roster.map((l) => l.partyShort).filter((p): p is string => !!p))].sort();
  const provinces = [...new Set(roster.map((l) => l.province).filter((p): p is string => !!p))].sort(
    (a, b) => a.localeCompare(b, "es"),
  );
  return { legislators, commissions, parties, provinces };
}
export const getCongreso = unstable_cache(_getCongreso, ["congreso-roster"], { revalidate: 300 });

export async function getInitiatives(opts: {
  limit?: number;
  category?: string;
  risk?: string;
}) {
  const d = await db();
  return listRecentInitiatives(d, opts);
}

export async function browseInitiatives(f: InitiativeFilters) {
  const d = await db();
  const [page, facetVals] = await Promise.all([listInitiatives(d, f), facets(d)]);
  return { ...page, facets: facetVals };
}

export async function getInitiative(id: number) {
  const d = await db();
  return getInitiativeById(d, id);
}

// --- Phase 1: daily activity monitoring (both chambers) ---

/** ISO yyyy-mm-dd for "today" in Dominican Republic time. */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Shift an ISO date by N days (negative = earlier). */
function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Activity for "Hoy". Diputados is exact-date (its SIL/agenda dates are same-day).
 * The Senate's published session dates can lag, so it uses a short lookback window
 * ending at the selected date — the rows show their real date, so nothing is misleading.
 */
export async function getDayActivity(opts: { date?: string; senateWindowDays?: number } = {}) {
  const d = await db();
  const date = opts.date ?? todayISO();
  const since = shiftISO(date, -(opts.senateWindowDays ?? 7));
  const [dip, sen] = await Promise.all([
    listActivity(d, { date, chamber: "DIPUTADOS", limit: 500 }),
    listActivity(d, { dateFrom: since, dateTo: date, chamber: "SENADO", limit: 500 }),
  ]);
  return { date, senateSince: since, dip, sen };
}

/** Initiatives deposited on a given date (the "depositadas hoy" feed). Diputados by default. */
export async function getDeposits(date: string, chamber = "DIPUTADOS"): Promise<DepositItem[]> {
  const d = await db();
  return listDeposits(d, { dateFrom: date, dateTo: date, limit: 200, chamber });
}

export type { DepositItem };

/** Initiatives deposited within an inclusive [from, to] date range. */
export async function getDepositsRange(from: string, to: string, chamber = "DIPUTADOS"): Promise<DepositItem[]> {
  const d = await db();
  return listDeposits(d, { dateFrom: from, dateTo: to, limit: 1000, chamber });
}

/**
 * Senate deposits ending at `date`, looking back `windowDays` (default 7). The Senate's
 * SIL publishes with lag, so a single day is often empty — the short window mirrors the
 * manual playbook ("revisar ese día y los anteriores") and keeps the feed non-empty.
 */
export async function getSenateDeposits(date: string, windowDays = 7): Promise<DepositItem[]> {
  const d = await db();
  const from = shiftISO(date, -(windowDays - 1));
  return listDeposits(d, { dateFrom: from, dateTo: date, limit: 500, chamber: "SENADO" });
}

/** Committee/plenary activity (both chambers) within an inclusive [from, to] range. */
export async function getRangeActivity(from: string, to: string) {
  const d = await db();
  const [dip, sen] = await Promise.all([
    listActivity(d, { dateFrom: from, dateTo: to, chamber: "DIPUTADOS", limit: 1000 }),
    listActivity(d, { dateFrom: from, dateTo: to, chamber: "SENADO", limit: 1000 }),
  ]);
  return { dip, sen };
}

/** Recent activity (no date filter) for a chamber — its standing feed. */
export async function getChamberActivity(chamber: string, limit = 120) {
  const d = await db();
  return listActivity(d, { chamber, limit });
}

/** Per-day committee/plenary counts for the activity sparkline/calendar. */
export async function getActivityCalendar(since?: string) {
  const d = await db();
  return activityCountsByDate(d, { since });
}

/** Health of every source for the "Estado de monitoreo" page. */
export async function getMonitoringHealth() {
  const d = await db();
  return latestRunsBySource(d);
}

export async function getCommissions(chamber?: string) {
  const d = await db();
  return listCommissions(d, { chamber });
}

/** Committees with full membership (president/VP/secretary/members) for a chamber.
 *  Cached 5 min — composition changes weekly with the roster ingestion. */
export const getCommissionsWithMembers = unstable_cache(
  async (chamber?: string): Promise<CommissionWithMembers[]> => {
    const d = await db();
    return commissionsWithMembers(d, { chamber });
  },
  ["commissions-with-members"],
  { revalidate: 300 },
);

// --- Regulatory monitoring ---

export async function getRegulatoryOverview() {
  const d = await db();
  const [kpis, byInstitution, recent, consultas] = await Promise.all([
    regulatoryKpis(d),
    regulationsByInstitution(d),
    listRegulations(d, { limit: 60 }),
    listRegulations(d, { consultaOnly: true, limit: 40 }),
  ]);
  return { kpis, byInstitution, recent, consultas };
}

export async function getConsultas() {
  const d = await db();
  return listRegulations(d, { consultaOnly: true, limit: 100 });
}

export async function getRegulations(opts: { institution?: string; intervention?: string } = {}) {
  const d = await db();
  return listRegulations(d, { ...opts, limit: 200 });
}

// --- Feed (news / official / social / legislative signals) ---

/** A page of feed items (keyset paginated). Not cached — filters + cursor vary per request. */
export async function getFeed(
  filters: FeedFilters,
  opts: { limit?: number; cursor?: FeedCursor | null } = {},
) {
  const d = await db();
  return listFeedItems(d, filters, opts);
}

/** Distinct categories + kinds present in the feed (left-panel dropdowns). */
export async function getFeedFacets() {
  const d = await db();
  return feedFacets(d);
}

/** Hot topics + trending entities for the right rail. Cached 5 min. */
export const getFeedTrending = unstable_cache(
  async (windowDays: number) => {
    const d = await db();
    const [topics, entities] = await Promise.all([
      feedTrendingCategories(d, { sinceDays: windowDays }),
      feedTrendingEntities(d, { sinceDays: windowDays, limit: 8 }),
    ]);
    return { topics, entities };
  },
  ["feed-trending"],
  { revalidate: 300 },
);

/** Curated influential-accounts directory ("Cuentas a seguir"). Cached 10 min. */
export const getSuggestedAccounts = unstable_cache(
  async (): Promise<FeedAccount[]> => {
    const d = await db();
    return listFeedAccounts(d, { activeOnly: true, limit: 80 });
  },
  ["feed-accounts"],
  { revalidate: 600 },
);
