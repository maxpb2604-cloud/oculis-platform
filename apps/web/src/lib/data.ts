/**
 * Server-side data access for the dashboard. Reuses @oculis/db, which reads from
 * Postgres (DATABASE_URL) or a file-backed PGlite (PGLITE_DIR) — the same store the
 * worker writes to. A single shared handle is cached across requests.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { normalizeStatus } from "@oculis/core";
import { normProvince, resolveProvince } from "./provinces";
export { normProvince, resolveProvince } from "./provinces";
import {
  createDb,
  countByApprovalProbability,
  countByCategory,
  countByProvince,
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
  listDeposits,
  listInitiatives,
  listRecentInitiatives,
  listRegulations,
  type DepositItem,
  regulatoryKpis,
  regulationsByInstitution,
  listFeedItems,
  listFeedForInitiative,
  initiativeByCode,
  searchInitiatives,
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
let schemaReady: Promise<void> | null = null;
async function db() {
  // Assign synchronously so concurrent first requests share ONE handle and all
  // await the same ensureSchema run (instead of racing the ~70 DDL statements).
  if (!handle) {
    handle = createDb();
    schemaReady = handle.ensureSchema(); // safe no-op if tables already exist
  }
  await schemaReady;
  return handle.db;
}

/**
 * Dashboard aggregates change only when the worker ingests (6×/day schedule),
 * so serving them from a 2-minute cache removes ~5 aggregate queries per
 * request without any visible staleness.
 */
export const getDashboardData = unstable_cache(_getDashboardData, ["dashboard-data"], {
  revalidate: 120,
});

async function _getDashboardData() {
  const d = await db();
  const [kpis, byApproval, byCategory, byStatusRaw, recent] = await Promise.all([
    dashboardKpis(d),
    countByApprovalProbability(d),
    countByCategory(d),
    countByStatus(d),
    listRecentInitiatives(d, { limit: 40 }),
  ]);
  // The chambers word statuses differently ("Enviado/Enviada a Comisión",
  // "Depositado/Depositada"...). Fold raw values through the canonical taxonomy
  // so the donut/legend show one bucket per real stage instead of split pairs.
  const folded = new Map<string, number>();
  for (const b of byStatusRaw) {
    const label = normalizeStatus(b.key).label;
    folded.set(label, (folded.get(label) ?? 0) + b.count);
  }
  const byStatus = [...folded]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
  return { kpis, byApproval, byCategory, byStatus, recent };
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
  const [ini, relatedNews] = await Promise.all([
    getInitiativeById(d, id),
    listFeedForInitiative(d, id, 10),
  ]);
  if (!ini) return null;
  // Neither the detail page nor the modal renders the raw scrape payload —
  // shipping it doubled the /api/initiatives/:id response for nothing.
  const { raw: _raw, ...rest } = ini as typeof ini & { raw?: unknown };
  return { ...rest, relatedNews };
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
export function shiftISO(iso: string, days: number): string {
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

/**
 * Freshness of the feed sources for the "última actualización" indicator: the
 * most-recent successful run time overall, plus a per-source breakdown (name,
 * ok, when, item count). Reads `ingestion_runs` (the same data the monitoring
 * page uses), filtered to `feed-*` sources.
 *
 * Cached 60s — the underlying runs land 6×/day; the percentile CTE it triggers
 * was running on every /feed render.
 */
export const getFeedFreshness = unstable_cache(_getFeedFreshness, ["feed-freshness"], {
  revalidate: 60,
});

async function _getFeedFreshness() {
  const d = await db();
  const all = await latestRunsBySource(d);
  const LABELS: Record<string, string> = {
    "feed-senado": "Senado (oficial)",
    "feed-diputados": "Diputados (oficial)",
    "feed-diariolibre": "Diario Libre",
    "feed-prensa": "Prensa (Google News)",
    "feed-x": "Redes (X)",
    "feed-legislative": "Señales legislativas",
  };
  const sources = all
    .filter((r) => r.source.startsWith("feed-"))
    .map((r) => ({
      source: r.source,
      label: LABELS[r.source] ?? r.source,
      ok: r.ok,
      seen: r.seen,
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
      lastSuccessAt: r.lastSuccessAt ? new Date(r.lastSuccessAt).toISOString() : null,
    }));
  // Newest successful finish across feed sources = "last updated".
  const times = sources
    .map((s) => s.lastSuccessAt)
    .filter((t): t is string => !!t)
    .sort();
  const updatedAt = times.length ? times[times.length - 1]! : null;
  return { updatedAt, sources };
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

// --- Feed (news / official / social / legislative signals) ---

/** A page of feed items (keyset paginated). Not cached — filters + cursor vary per request. */
export async function getFeed(
  filters: FeedFilters,
  opts: { limit?: number; cursor?: FeedCursor | null } = {},
) {
  const d = await db();
  return listFeedItems(d, filters, opts);
}

/** Distinct categories present in the feed (left-panel dropdowns). Cached 5 min —
 *  two full-table group-bys that only change when the worker ingests. */
export const getFeedFacets = unstable_cache(
  async () => {
    const d = await db();
    return feedFacets(d);
  },
  ["feed-facets"],
  { revalidate: 300 },
);

/** Resolve a bill code → title for the feed's active-filter chip. */
export async function getInitiativeByCode(code: string) {
  const d = await db();
  return initiativeByCode(d, code);
}

/** Typeahead: bills (PDLs) whose title or code matches a keyword. */
export async function searchBills(query: string) {
  const d = await db();
  return searchInitiatives(d, query, { limit: 8 });
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
    return listFeedAccounts(d, { activeOnly: true, limit: 300 });
  },
  ["feed-accounts-v2"],
  { revalidate: 600 },
);
