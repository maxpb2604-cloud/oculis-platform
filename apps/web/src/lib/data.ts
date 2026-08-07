/**
 * Server-side data access for the dashboard. Reuses @oculis/db, which reads from
 * Postgres (DATABASE_URL) or a file-backed PGlite (PGLITE_DIR) — the same store the
 * worker writes to. A single shared handle is cached across requests.
 */
import "server-only";
import { unstable_cache } from "next/cache";
export { SOURCE_REGISTRY, type SourceRegistryEntry } from "@oculis/scrapers";
import {
  SOURCE_REGISTRY as SCRAPER_SOURCE_REGISTRY,
  proponenteName,
  type SilProponente,
} from "@oculis/scrapers";
import { normProvince, resolveProvince } from "./provinces";
import { safeHttpUrl } from "./input";
import {
  createDb,
  countByProvince,
  countByStatus,
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
  listDocuments,
  listInitiatives,
  listRecentInitiatives,
  listRegulations,
  listSourceDocuments,
  type DepositItem,
  regulatoryKpis,
  regulationsByInstitution,
  listFeedItems,
  listFeedForInitiative,
  initiativeByCode,
  searchInitiatives,
  listFeedAccounts,
  type FeedFilters as DbFeedFilters,
  type FeedCursor as DbFeedCursor,
  type FeedListItem as DbFeedListItem,
  type FeedTag as DbFeedTag,
  type InitiativeListItem as DbInitiativeListItem,
  type DbHandle,
} from "@oculis/db";

export type FeedFilters = Omit<DbFeedFilters, "category">;
export type FeedCursor = DbFeedCursor;
export type FeedTag = DbFeedTag;
export type FeedListItem = Omit<DbFeedListItem, "category">;

/** Public account-directory fields. Internal influence ranking never reaches the UI. */
export interface FeedAccount {
  id: number;
  name: string;
  handle: string;
  platform: string;
  url: string;
  kind: string;
  chamber: string | null;
  legislatorSourceId: string | null;
}

/** Initiative fields backed directly by the source record. */
export interface InitiativeListItem {
  id: number;
  code: string | null;
  title: string;
  status: string | null;
  sponsor: string | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
}

function toInitiativeListItem(row: DbInitiativeListItem): InitiativeListItem {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    sponsor: row.sponsor,
    party: row.party,
    province: row.province,
    filedAt: row.filedAt,
    sourceUrl: safeHttpUrl(row.sourceUrl),
  };
}

let handlePromise: Promise<DbHandle> | null = null;
async function db() {
  if (!handlePromise) {
    handlePromise = (async () => {
      const next = createDb();
      // Production schema changes belong in the worker/deploy step. Local development
      // can still bootstrap itself, and an explicit opt-in keeps one-off deployments easy.
      if (process.env.NODE_ENV !== "production" || process.env.OCULIS_AUTO_MIGRATE === "1") {
        await next.ensureSchema();
      }
      return next;
    })().catch((error) => {
      handlePromise = null;
      throw error;
    });
  }
  return (await handlePromise).db;
}

async function _getDashboardData() {
  const d = await db();
  const [rawKpis, byStatus, recent] = await Promise.all([
    dashboardKpis(d),
    countByStatus(d),
    listRecentInitiatives(d, { limit: 40 }),
  ]);
  const reportedStatuses = byStatus.map((bucket) => ({
    key: bucket.key === "N/D" ? null : bucket.key,
    count: bucket.count,
  }));
  const withStatus = reportedStatuses
    .filter((bucket) => bucket.key != null)
    .reduce((total, bucket) => total + bucket.count, 0);
  return {
    kpis: {
      total: rawKpis.total,
      withOfficialDocument: rawKpis.published,
      withStatus,
    },
    byStatus: reportedStatuses,
    recent: recent.map(toInitiativeListItem),
  };
}

export const getDashboardData = unstable_cache(_getDashboardData, ["dashboard-summary"], {
  revalidate: 60,
});

export type DashboardData = Awaited<ReturnType<typeof _getDashboardData>>;

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
    properties: {
      nombre: p.properties.nombre,
      iniciativas: counts.get(norm(p.properties.nombre)) ?? 0,
    },
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
export type LegislatorsByProvince = Record<
  string,
  { diputados: Legislator[]; senadores: Legislator[] }
>;

/**
 * Full elected roster grouped by province → keyed by the same normalized province name
 * used by the bubble map, so a clicked province resolves every one of its deputies and
 * senators (not just bill sponsors). An empty roster remains visibly empty; initiative
 * proponents are not reclassified as elected members.
 */
export async function getLegislatorsByProvince(): Promise<LegislatorsByProvince> {
  const d = await db();
  const roster = await listLegislators(d);
  if (roster.length === 0) return {};

  const out: LegislatorsByProvince = {};
  for (const r of roster) {
    if (!r.province) continue; // "En el Exterior" etc. — no province point on the map
    const key = resolveProvince(r.province);
    const bucket = (out[key] ??= { diputados: [], senadores: [] });
    const leg: Legislator = {
      name: r.fullName,
      role: r.role,
      party: r.partyShort ?? r.party,
    };
    if (r.chamber === "SENADO") bucket.senadores.push(leg);
    else if (r.chamber === "DIPUTADOS") bucket.diputados.push(leg);
  }
  return out;
}

export type { CommissionWithMembers };

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

  // Memberships attach only through the exact source id within the same chamber. A null
  // id from a scraper stays unresolved; the web must not re-decide it from a name.
  const bySourceId = new Map<string, Array<{ name: string; cargo: string | null }>>();
  for (const s of seats) {
    const entry = { name: s.commissionName, cargo: s.cargo };
    if (s.legislatorSourceId) {
      const key = `${s.chamber}\u0000${s.legislatorSourceId}`;
      (bySourceId.get(key) ?? bySourceId.set(key, []).get(key)!).push(entry);
    }
  }

  const legislators: LegislatorProfile[] = roster.map((l) => ({
    ...l,
    committees: bySourceId.get(`${l.chamber}\u0000${l.sourceId}`) ?? [],
  }));

  const parties = [
    ...new Set(roster.map((l) => l.partyShort).filter((p): p is string => !!p)),
  ].sort();
  const provinces = [
    ...new Set(roster.map((l) => l.province).filter((p): p is string => !!p)),
  ].sort((a, b) => a.localeCompare(b, "es"));
  return { legislators, commissions, parties, provinces };
}
export const getCongreso = unstable_cache(_getCongreso, ["congreso-roster"], { revalidate: 300 });

export async function getInitiatives(opts: { limit?: number }) {
  const d = await db();
  const rows = await listRecentInitiatives(d, opts);
  return rows.map(toInitiativeListItem);
}

export interface InitiativeBrowseFilters {
  search?: string;
  party?: string;
  status?: string;
  chamber?: string;
  page?: number;
  pageSize?: number;
}

export async function browseInitiatives(f: InitiativeBrowseFilters) {
  const d = await db();
  const [page, facetVals] = await Promise.all([listInitiatives(d, f), facets(d)]);
  return {
    ...page,
    rows: page.rows.map(toInitiativeListItem),
    facets: { parties: facetVals.parties, statuses: facetVals.statuses },
  };
}

export async function getInitiative(id: number) {
  const d = await db();
  const ini = await getInitiativeById(d, id);
  if (!ini) return null;
  const [relatedNews, officialDocuments] = await Promise.all([
    listFeedForInitiative(d, id, 10),
    listDocuments(d, id),
  ]);
  return {
    id: ini.id,
    source: ini.source,
    sourceId: ini.sourceId,
    code: ini.code,
    title: ini.title,
    purpose: ini.purpose,
    type: ini.type,
    status: ini.status,
    chamber: ini.chamber,
    sourceCategory: ini.sourceCategory,
    sponsor: ini.sponsor,
    sponsorRole: ini.sponsorRole,
    sponsorCount: ini.sponsorCount,
    proponents: explicitProponents(ini.raw),
    party: ini.party,
    province: ini.province,
    committee: ini.committee,
    filedAt: ini.filedAt,
    expiresAt: ini.expiresAt,
    sourceUrl: safeHttpUrl(ini.sourceUrl),
    events: ini.events.map((event) => ({
      id: event.id,
      status: event.status,
      eventDate: event.eventDate,
      note: event.note,
      source: event.source,
      sourceUrl: safeHttpUrl(event.sourceUrl),
      evidenceType: event.evidenceType,
      observedAt: event.observedAt ? new Date(event.observedAt).toISOString() : null,
    })),
    documents: officialDocuments.map((document) => ({
      id: document.id,
      source: document.source,
      sourceDocId: document.sourceDocId,
      docType: document.docType,
      extension: document.extension,
      url: safeHttpUrl(document.url),
      uploadedAt: document.uploadedAt,
      modifiedAt: document.modifiedAt,
      sourceCategory: document.sourceCategory,
      sourceFragment: document.sourceFragment,
      firstSeenAt: document.firstSeenAt,
      lastSeenAt: document.lastSeenAt,
    })),
    relatedNews: relatedNews.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      url: safeHttpUrl(item.url),
      source: item.source,
      publishedAt: item.publishedAt,
      observedAt: item.observedAt,
    })),
  };
}

export interface InitiativeProponentFact {
  name: string;
  principal: boolean | null;
  role: string | null;
  party: string | null;
  province: string | null;
}

/** Read the complete literal SIL proponent array already archived with the initiative. */
function explicitProponents(raw: unknown): InitiativeProponentFact[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = (raw as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return [];
  const candidate = payload as { proponents?: unknown; proponentes?: unknown };
  const rows = Array.isArray(candidate.proponents)
    ? candidate.proponents
    : Array.isArray(candidate.proponentes)
      ? candidate.proponentes
      : [];
  return rows.flatMap((value): InitiativeProponentFact[] => {
    if (!value || typeof value !== "object") return [];
    const proponent = value as SilProponente;
    const name = proponenteName(proponent);
    if (!name) return [];
    const representation = proponent.representacion;
    return [
      {
        name,
        principal: typeof proponent.principal === "boolean" ? proponent.principal : null,
        role: representation?.funcion?.trim() || proponent.cargo?.trim() || null,
        party:
          representation?.partido?.siglas?.trim() ||
          representation?.partido?.nombre?.trim() ||
          null,
        province: representation?.provincia?.trim() || null,
      },
    ];
  });
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
export async function getDepositsRange(
  from: string,
  to: string,
  chamber = "DIPUTADOS",
): Promise<DepositItem[]> {
  const d = await db();
  return listDeposits(d, { dateFrom: from, dateTo: to, limit: 1000, chamber });
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

export interface SourceHealthFact {
  source: string;
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
  lastSuccessAt: string | null;
  lastDataAt: string | null;
}

/** Raw execution facts for every source with a recorded ingestion run. */
export async function getMonitoringHealth() {
  const d = await db();
  const health = await latestRunsBySource(d);
  return health.map((row): SourceHealthFact => {
    return {
      source: row.source,
      recordedAt: new Date(row.recordedAt).toISOString(),
      finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
      ok: row.ok,
      outcome: row.outcome,
      seen: Number(row.seen ?? 0),
      inserted: Number(row.inserted ?? 0),
      updated: Number(row.updated ?? 0),
      statusChanges: Number(row.statusChanges ?? 0),
      error: row.error,
      details: row.details,
      lastSuccessAt: row.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null,
      lastDataAt: row.lastDataAt ? new Date(row.lastDataAt).toISOString() : null,
    };
  });
}

/** Stored execution facts for every registered feed source, plus the newest successful
 * finish among them. The aggregate timestamp is not a whole-feed health judgment. */
export async function getFeedFreshness() {
  const d = await db();
  const all = await latestRunsBySource(d);
  const latestBySource = new Map(all.map((row) => [row.source, row] as const));
  const LABELS: Record<string, string> = {
    "feed-senado": "Senado (oficial)",
    "feed-diputados": "Diputados (oficial)",
    "feed-diariolibre": "Diario Libre",
    "feed-prensa": "Prensa (Google News)",
    "feed-x": "Redes (X)",
    "feed-legislative": "Señales legislativas",
  };
  const registered = SCRAPER_SOURCE_REGISTRY.filter(
    (entry) => entry.status === "ACTIVE" && entry.id.startsWith("feed-"),
  );
  const sources = registered.map((entry) => {
    const row = latestBySource.get(entry.id);
    return {
      source: entry.id,
      label: LABELS[entry.id] ?? entry.label,
      outcome: row?.outcome ?? null,
      seen: Number(row?.seen ?? 0),
      finishedAt: row?.finishedAt ? new Date(row.finishedAt).toISOString() : null,
      lastSuccessAt: row?.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null,
    };
  });
  // This is only the newest successful finish among the registered feed sources. It
  // does not describe the freshness or health of the feed as a whole.
  const times = sources
    .map((s) => s.lastSuccessAt)
    .filter((t): t is string => !!t)
    .sort();
  const newestSuccessAt = times.length ? times[times.length - 1]! : null;
  return { newestSuccessAt, sources };
}

export interface OfficialPublicationDocument {
  id: number;
  source: string;
  sourceDocId: string | null;
  initiativeCode: string | null;
  title: string | null;
  extension: string | null;
  url: string | null;
  catalogDate: string | null;
  modifiedDate: string | null;
  sourceCategory: string | null;
  lastObservedAt: string;
}

/** Official documentary collections shown independently from PDL lifecycle status. */
export async function getOfficialPublicationDocuments(
  chamber: "DIPUTADOS" | "SENADO",
  perSourceLimit = 20,
): Promise<OfficialPublicationDocument[]> {
  const d = await db();
  const sources =
    chamber === "DIPUTADOS"
      ? ["dip-known-agenda"]
      : ["sen-approved", "sen-expired", "sen-attendance", "sen-reports"];
  const rows = (
    await Promise.all(
      sources.map((source) => listSourceDocuments(d, { sources: [source], limit: perSourceLimit })),
    )
  ).flat();
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    sourceDocId: row.sourceDocId,
    initiativeCode: row.initiativeCode,
    title: row.docType,
    extension: row.extension,
    url: safeHttpUrl(row.url),
    catalogDate: row.uploadedAt,
    modifiedDate: row.modifiedAt,
    sourceCategory: row.sourceCategory,
    lastObservedAt: row.lastSeenAt,
  }));
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
  const [rawKpis, byInstitution, recent, consultas] = await Promise.all([
    regulatoryKpis(d),
    regulationsByInstitution(d),
    listRegulations(d, { limit: 60 }),
    listRegulations(d, { consultaOnly: true, limit: 40 }),
  ]);
  return {
    kpis: {
      total: rawKpis.total,
      consultas: rawKpis.consultas,
      institutions: rawKpis.institutions,
    },
    byInstitution,
    recent: recent.map(toRegulationFact),
    consultas: consultas.map(toRegulationFact),
  };
}

export async function getConsultas() {
  const d = await db();
  const rows = await listRegulations(d, { consultaOnly: true, limit: 100 });
  return rows.map(toRegulationFact);
}

interface RegulationFact {
  id: number;
  institution: string;
  regType: string | null;
  title: string;
  status: string | null;
  isConsulta: boolean | null;
  publishedAt: string | null;
  deadline: string | null;
  url: string | null;
}

function toRegulationFact(
  row: Awaited<ReturnType<typeof listRegulations>>[number],
): RegulationFact {
  return {
    id: row.id,
    institution: row.institution,
    regType: row.regType,
    title: row.title,
    status: row.status,
    isConsulta: row.isConsulta,
    publishedAt: row.publishedAt,
    deadline: row.deadline,
    url: safeHttpUrl(row.url),
  };
}

// --- Feed (news / official / social / legislative signals) ---

/** A page of feed items (keyset paginated). Not cached — filters + cursor vary per request. */
export async function getFeed(
  filters: FeedFilters,
  opts: { limit?: number; cursor?: FeedCursor | null } = {},
) {
  const d = await db();
  const page = await listFeedItems(d, filters as DbFeedFilters, opts);
  return {
    nextCursor: page.nextCursor,
    items: page.items.map(
      (item): FeedListItem => ({
        id: item.id,
        source: item.source,
        kind: item.kind,
        title: item.title,
        summary: item.summary,
        imageUrl: safeHttpUrl(item.imageUrl),
        url: safeHttpUrl(item.url),
        author: item.author,
        handle: item.handle,
        platform: item.platform,
        publishedAt: item.publishedAt,
        observedAt: item.observedAt,
        sortAt: item.sortAt,
        chamber: item.chamber,
        tags: item.tags,
      }),
    ),
  };
}

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

/** Source/account directory. Internal ranking fields are discarded and names sorted. */
export const getAccountDirectory = unstable_cache(
  async (): Promise<FeedAccount[]> => {
    const d = await db();
    const rows = await listFeedAccounts(d, { activeOnly: true, limit: 300 });
    return rows
      .flatMap((row): FeedAccount[] => {
        const url = safeHttpUrl(row.url);
        return url
          ? [
              {
                id: row.id,
                name: row.name,
                handle: row.handle,
                platform: row.platform,
                url,
                kind: row.kind,
                chamber: row.chamber,
                legislatorSourceId: row.legislatorSourceId,
              },
            ]
          : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
  ["feed-account-directory-v1"],
  { revalidate: 600 },
);
