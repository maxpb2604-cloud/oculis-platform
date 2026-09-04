/**
 * Server-side data access for the dashboard. Reuses @oculis/db, which reads from
 * Postgres (DATABASE_URL) or a file-backed PGlite (PGLITE_DIR) — the same store the
 * worker writes to. A single shared handle is cached across requests.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
export { SOURCE_REGISTRY, type SourceRegistryEntry } from "@oculis/scrapers";
import { SOURCE_REGISTRY as SCRAPER_SOURCE_REGISTRY } from "@oculis/scrapers";
import {
  explicitLegislatureCountingFacts,
  explicitInitiativeActivities,
  explicitInitiativeVotes,
  explicitProponents,
  initiativeSourceCoverage,
} from "./initiative-facts";
import { resolveProvince } from "./provinces";
import { isISODate, safeHttpUrl, safeOfficialUrl } from "./input";
export { normProvince, resolveProvince } from "./provinces";
import {
  createDb,
  activityCountsByDate,
  countActiveRosterByChamberParty,
  countDepositedInitiativesByProvince,
  countInitiativesByProvinceWithActive,
  countByStatus,
  listLegislatorPortraitCandidates,
  listLegislatorSummaries,
  commissionsWithMembers,
  getLegislatorProfileById as getDbLegislatorProfileById,
  getLegislatorInitiativeStats,
  legislatorCommittees,
  type LegislatorInitiativeStats,
  type LegislatorProfile as DbLegislatorProfile,
  type RosterMember,
  type LegislatorSummary as DbLegislatorSummary,
  type CommissionWithMembers,
  dashboardKpis,
  facets,
  getActivityById,
  getInitiativeById,
  getOfficialDepositedDocumentById,
  latestRunsBySource,
  listActivity,
  listCommissions,
  listDeposits,
  listDocuments,
  listInitiatives,
  listInitiativeProponents,
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
  listRecentDepositedInitiativesByProvince,
  listRecentStatusEvents,
  readCongressMovementDay,
  resolveActiveLegislatorProfileIds,
  type FeedFilters as DbFeedFilters,
  type FeedCursor as DbFeedCursor,
  type FeedListItem as DbFeedListItem,
  type FeedTag as DbFeedTag,
  type ActiveRosterPartyBucket,
  type InitiativeListItem as DbInitiativeListItem,
  type CongressMovementChamber as DbCongressMovementChamber,
  type CongressMovementDay as DbCongressMovementDay,
  type CongressMovement as DbCongressMovement,
  type DbHandle,
} from "@oculis/db";
import { initiativeDetailHref } from "./initiative-links";
import { initiativeProceduralFacts } from "./initiative-procedural-facts";
import { selectHomeDirectoryPortraits } from "./home-directory-promo";
import type { Lang } from "./i18n";
import { resolvePartyPresentation } from "./party-presentation";

export type FeedFilters = Omit<DbFeedFilters, "category">;
export type FeedCursor = DbFeedCursor;
export type FeedTag = DbFeedTag;
export type FeedListItem = Omit<DbFeedListItem, "category">;

/**
 * Initiative-only legislative movement for HOME. This deliberately reads the
 * status-event timeline rather than the mixed public feed, so agendas and other
 * activity records cannot appear in the "Últimos movimientos" module.
 */
export interface RecentInitiativeMovement {
  initiativeId: number;
  code: string | null;
  title: string;
  /** Reviewed English translation for the exact current official title, if available. */
  titleEn: string | null;
  status: string;
  eventDate: string | null;
  chamber: string | null;
  evidenceType: string;
  /** When Oculis observed this status event. */
  observedAt: string;
  /** Source event date when verified; otherwise the observed timestamp. */
  effectiveAt: string;
}

/**
 * Latest initiative-status events for HOME, newest effective event first.
 *
 * This is intentionally separate from `getFeed`: HOME needs legislative
 * movements only, while the feed may combine source news, agenda and other activity.
 */
export async function getRecentInitiativeMovements(limit = 6): Promise<RecentInitiativeMovement[]> {
  const d = await db();
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 24);
  const rows = await listRecentStatusEvents(d, { limit: bounded });
  return rows.map((row) => ({
    initiativeId: row.initiativeId,
    code: row.code,
    title: row.title,
    titleEn: row.titleEn,
    status: row.status,
    eventDate: row.eventDate,
    chamber: row.chamber,
    evidenceType: row.evidenceType,
    observedAt: row.observedAt,
    effectiveAt: row.effectiveAt,
  }));
}

export type CongressMovementChamber = DbCongressMovementChamber;
export type CongressMovementDay = DbCongressMovementDay;
export type CongressMovement = DbCongressMovement;

/**
 * Apply the web trust boundary to every source-controlled movement URL while retaining
 * the repository's exact official text, dates, evidence and monitoring denominators.
 */
export function adaptCongressMovementDay(row: DbCongressMovementDay): CongressMovementDay {
  return {
    ...row,
    movements: row.movements.map((movement) => ({
      ...movement,
      sourceUrl: safeOfficialUrl(movement.sourceUrl, movement.source),
    })),
  };
}

/**
 * Narrow data adapter for “Movimientos del Congreso”. When no date is requested, the
 * page always opens on today's Dominican-Republic calendar date. A historical date is
 * selected only when the user requests it explicitly.
 */
export async function getCongressMovementDay(opts: {
  date?: string;
  chamber: CongressMovementChamber;
}): Promise<CongressMovementDay> {
  if (opts.date !== undefined && !isISODate(opts.date)) {
    throw new Error("date must be an exact ISO calendar date (YYYY-MM-DD)");
  }
  const d = await db();
  const selectedDate = opts.date ?? todayISO();
  return adaptCongressMovementDay(
    await readCongressMovementDay(d, { date: selectedDate, chamber: opts.chamber }),
  );
}

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
  legislatorProfileId: number | null;
}

/** Initiative fields backed directly by the source record. */
export interface InitiativeListItem {
  id: number;
  source: string;
  sourceId: string;
  code: string | null;
  title: string;
  /** Reviewed English translation for this exact current official title, if available. */
  titleEn: string | null;
  status: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  sponsorLegislatorSourceId: string | null;
  sponsorProfileId: number | null;
  /** Exact relationship that caused the active profile filter to include this row. */
  filteredProponentRelationship: "principal" | "coproponent" | "published" | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
  preferredDocumentUrl: string | null;
  preferredDocumentId: number | null;
  preferredDocumentAvailable: boolean;
}

function toInitiativeListItem(row: DbInitiativeListItem): InitiativeListItem {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    code: row.code,
    title: row.title,
    titleEn: row.titleEn,
    status: row.status,
    sponsor: row.sponsor,
    sponsorRole: row.sponsorRole,
    sponsorLegislatorSourceId: row.sponsorLegislatorSourceId,
    sponsorProfileId: row.sponsorProfileId,
    filteredProponentRelationship: row.filteredProponentRelationship,
    party: row.party,
    province: row.province,
    filedAt: row.filedAt,
    sourceUrl: safeOfficialUrl(row.sourceUrl, row.source),
    preferredDocumentId: row.preferredDocumentId,
    preferredDocumentUrl: safeOfficialUrl(row.preferredDocumentUrl, row.source),
    preferredDocumentAvailable: row.preferredDocumentAvailable,
  };
}

const globalDb = globalThis as typeof globalThis & {
  __oculisDbHandlePromise?: Promise<DbHandle>;
};

async function db() {
  // Keep one handle across Next.js development HMR module re-evaluations. Opening the
  // same file-backed PGlite directory twice—even inside one PID—is unsafe.
  if (!globalDb.__oculisDbHandlePromise) {
    globalDb.__oculisDbHandlePromise = (async () => {
      const next = createDb();
      // Production schema changes belong in the worker/deploy step. Local development
      // can still bootstrap itself, and an explicit opt-in keeps one-off deployments easy.
      if (process.env.NODE_ENV !== "production" || process.env.OCULIS_AUTO_MIGRATE === "1") {
        await next.ensureSchema();
      }
      return next;
    })().catch((error) => {
      delete globalDb.__oculisDbHandlePromise;
      throw error;
    });
  }
  return (await globalDb.__oculisDbHandlePromise).db;
}

/** Server-owned lookup used by the guarded document opener; never accepts a URL. */
export async function getOfficialDocumentForOpen(documentId: number, initiativeId: number) {
  const d = await db();
  return getOfficialDepositedDocumentById(d, documentId, initiativeId);
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
 * stripped) and spelling aliases are merged (for example, "Bahoruco" → "Baoruco").
 * National representation remains outside this territorial map. Provinces with no
 * initiatives still appear (count 0) so the map is complete.
 */
export async function getInitiativesByProvince() {
  const { PROVINCIAS } = await import("./province-data");
  const d = await db();
  const buckets = await countInitiativesByProvinceWithActive(d);

  const resolve = resolveProvince;

  const counts = new Map<string, { total: number; active: number }>();
  for (const b of buckets) {
    const k = resolve(b.province);
    const current = counts.get(k) ?? { total: 0, active: 0 };
    counts.set(k, {
      total: current.total + b.total,
      active: current.active + b.active,
    });
  }

  const features = PROVINCIAS.map((p) => ({
    type: "Feature" as const,
    properties: {
      nombre: p.properties.nombre,
      iniciativas: counts.get(resolve(p.properties.nombre))?.total ?? 0,
      vigentes: counts.get(resolve(p.properties.nombre))?.active ?? 0,
    },
    geometry: p.geometry,
  }));
  return { type: "FeatureCollection" as const, features };
}

export type ProvinceFC = Awaited<ReturnType<typeof getInitiativesByProvince>>;

/** Full exact-id profile returned only to the on-demand profile endpoint. */
export interface LegislatorProfile extends DbLegislatorProfile {
  committees: Array<{ name: string; cargo: string | null }>;
  initiativeStats: LegislatorInitiativeStats;
}

/** Minimal list payload. Full profile facts are fetched only after an exact-id click. */
export type LegislatorSummary = DbLegislatorSummary;
export type Legislator = LegislatorSummary;
export type LegislatorsByProvince = Record<
  string,
  { diputados: Legislator[]; senadores: Legislator[] }
>;

export interface HomeDirectoryPortrait {
  profileId: number;
  fullName: string;
  chamber: string;
  role: string | null;
  party: string | null;
  province: string | null;
  photoUrl: string;
}

export interface HomeChamberPartyGroup {
  acronym: string | null;
  fullName: string | null;
  isMissing: boolean;
  count: number;
}

export interface HomeChamberComposition {
  chamber: "DIPUTADOS" | "SENADO";
  groups: HomeChamberPartyGroup[];
  /** Every active member observed in the exact official roster snapshot. */
  observedTotal: number;
  /** Observed members whose source snapshot published at least one party field. */
  reportedTotal: number;
  /** Observed members whose source snapshot published neither party field. */
  unreportedTotal: number;
}

export interface HomeDirectoryPromoData {
  portraits: HomeDirectoryPortrait[];
  composition: {
    basis: "active-official-roster-snapshot";
    chambers: HomeChamberComposition[];
  };
}

const HOME_COMPOSITION_CHAMBERS = ["DIPUTADOS", "SENADO"] as const;

/**
 * Adapt raw official-roster buckets into the canonical party vocabulary used by HOME.
 * Known aliases merge only through the shared presentation registry. Counts stay as
 * observed integers; percentages belong to the rendering layer and are not persisted.
 */
export function adaptHomeChamberComposition(
  buckets: readonly ActiveRosterPartyBucket[],
): HomeChamberComposition[] {
  return HOME_COMPOSITION_CHAMBERS.map((chamber) => {
    const canonical = new Map<string, HomeChamberPartyGroup>();

    for (const bucket of buckets) {
      if (bucket.chamber !== chamber) continue;
      const presentation = resolvePartyPresentation(bucket.partyShort, bucket.partyFullName, "es");
      const key = presentation.isMissing
        ? "\u0000missing"
        : `${presentation.acronym ?? ""}\u0000${presentation.fullName ?? ""}`;
      const existing = canonical.get(key);
      if (existing) {
        existing.count += bucket.count;
      } else {
        canonical.set(key, {
          acronym: presentation.acronym,
          fullName: presentation.fullName,
          isMissing: presentation.isMissing,
          count: bucket.count,
        });
      }
    }

    const groups = [...canonical.values()].sort((left, right) => {
      if (left.isMissing !== right.isMissing) return left.isMissing ? 1 : -1;
      return (
        right.count - left.count ||
        (left.acronym ?? left.fullName ?? "").localeCompare(
          right.acronym ?? right.fullName ?? "",
          "es",
        )
      );
    });
    const observedTotal = groups.reduce((sum, group) => sum + group.count, 0);
    const unreportedTotal = groups.reduce(
      (sum, group) => sum + (group.isMissing ? group.count : 0),
      0,
    );

    return {
      chamber,
      groups,
      observedTotal,
      reportedTotal: observedTotal - unreportedTotal,
      unreportedTotal,
    };
  });
}

async function _getHomeDirectoryPromoData(seed: string): Promise<HomeDirectoryPromoData> {
  const d = await db();
  const [deputyRows, senateRows, partyBuckets] = await Promise.all([
    listLegislatorPortraitCandidates(d, { chamber: "DIPUTADOS", limit: 64 }),
    listLegislatorPortraitCandidates(d, { chamber: "SENADO", limit: 64 }),
    countActiveRosterByChamberParty(d),
  ]);
  const trusted = (rows: typeof deputyRows): HomeDirectoryPortrait[] =>
    rows.flatMap((row) => {
      const photoUrl = safeOfficialUrl(row.photoUrl, row.source);
      return photoUrl
        ? [
            {
              profileId: row.profileId,
              fullName: row.fullName,
              chamber: row.chamber,
              role: row.role,
              party: row.party,
              province: row.province,
              photoUrl,
            },
          ]
        : [];
    });

  const portraits = selectHomeDirectoryPortraits(trusted(deputyRows), trusted(senateRows), seed);
  return {
    portraits,
    composition: {
      basis: "active-official-roster-snapshot",
      chambers: adaptHomeChamberComposition(partyBuckets),
    },
  };
}

/** A fresh server selection per full page request; no client-side reshuffle or hydration jump. */
export async function getHomeDirectoryPromoData(): Promise<HomeDirectoryPromoData> {
  return _getHomeDirectoryPromoData(randomUUID());
}

function enrichLegislators<T extends RosterMember>(
  roster: T[],
  seats: Awaited<ReturnType<typeof legislatorCommittees>>,
): Array<T & { committees: Array<{ name: string; cargo: string | null }> }> {
  const bySourceId = new Map<string, Array<{ name: string; cargo: string | null }>>();
  for (const seat of seats) {
    if (!seat.legislatorSourceId) continue;
    const key = `${seat.source}\u0000${seat.chamber}\u0000${seat.legislatorSourceId}`;
    const entry = { name: seat.commissionName, cargo: seat.cargo };
    (bySourceId.get(key) ?? bySourceId.set(key, []).get(key)!).push(entry);
  }

  return roster.map((legislator) => ({
    ...legislator,
    committees:
      bySourceId.get(
        `${legislator.source}\u0000${legislator.chamber}\u0000${legislator.sourceId}`,
      ) ?? [],
  }));
}

/** Canonical profile lookup used by every legislator trigger in the web application. */
export async function getLegislatorProfileById(
  profileId: number,
): Promise<LegislatorProfile | null> {
  const d = await db();
  const legislator = await getDbLegislatorProfileById(d, profileId);
  if (!legislator) return null;
  const [seats, initiativeStats] = await Promise.all([
    legislatorCommittees(d),
    getLegislatorInitiativeStats(d, legislator),
  ]);
  const profile = enrichLegislators([legislator], seats)[0];
  return profile ? { ...profile, initiativeStats } : null;
}

/**
 * Full elected roster grouped by province → keyed by the same normalized province name
 * used by the bubble map, so a clicked province resolves every one of its deputies and
 * senators (not just bill sponsors). An empty roster remains visibly empty; initiative
 * proponents are not reclassified as elected members.
 */
export async function getLegislatorsByProvince(): Promise<LegislatorsByProvince> {
  const d = await db();
  const roster = await listLegislatorSummaries(d);
  if (roster.length === 0) return {};

  const out: LegislatorsByProvince = {};
  for (const legislator of roster) {
    if (!legislator.province) continue; // "En el Exterior" etc. — no province point on the map
    const key = resolveProvince(legislator.province);
    const bucket = (out[key] ??= { diputados: [], senadores: [] });
    if (legislator.chamber === "SENADO") bucket.senadores.push(legislator);
    else if (legislator.chamber === "DIPUTADOS") bucket.diputados.push(legislator);
  }
  return out;
}

export interface ProvinceDashboardInitiative {
  id: number;
  code: string | null;
  title: string;
  titleEn: string | null;
  status: string | null;
  chamber: string | null;
  filedAt: string | null;
  href: string;
}

export interface ProvinceDashboardProvince {
  id: string;
  featureIds: string[];
  label: string;
  initiativeCount: number;
  activeInitiativeCount: number;
  depositedInitiativeCount: number;
  allDepositedInitiativesHref: string;
  initiatives: ProvinceDashboardInitiative[];
  deputies: Legislator[];
  senators: Legislator[];
}

/**
 * Source-backed HOME map data. Initiative geography means only the represented
 * province explicitly published for the principal proponent; missing provinces remain
 * missing and are never inferred from a person's name or party.
 */
export async function getProvinceDashboardData(
  lang: Lang,
  perProvince = 5,
): Promise<ProvinceDashboardProvince[]> {
  const { PROVINCIAS, PROVINCE_FEATURE_ID_BY_NAME } = await import("./province-data");
  const d = await db();
  const [provinceFC, legislators, depositedCounts, recent] = await Promise.all([
    getInitiativesByProvince(),
    getLegislatorsByProvince(),
    countDepositedInitiativesByProvince(d),
    listRecentDepositedInitiativesByProvince(d, perProvince),
  ]);

  const counts = new Map(
    provinceFC.features.map((feature) => [
      resolveProvince(feature.properties.nombre),
      {
        total: feature.properties.iniciativas,
        active: feature.properties.vigentes,
      },
    ]),
  );
  const depositedByProvince = new Map<string, number>();
  for (const row of depositedCounts) {
    const key = resolveProvince(row.province);
    depositedByProvince.set(key, (depositedByProvince.get(key) ?? 0) + row.total);
  }
  const recentByProvince = new Map<string, ProvinceDashboardInitiative[]>();
  for (const row of recent) {
    const key = resolveProvince(row.province);
    const bucket = recentByProvince.get(key) ?? [];
    if (bucket.some((item) => item.id === row.id)) continue;
    bucket.push({
      id: row.id,
      code: row.code,
      title: row.title,
      titleEn: row.titleEn,
      status: row.status,
      chamber: row.chamber,
      filedAt: row.filedAt,
      href: initiativeDetailHref(row.id, lang),
    });
    bucket.sort((a, b) => (b.filedAt ?? "").localeCompare(a.filedAt ?? "") || b.id - a.id);
    if (bucket.length > perProvince) bucket.length = perProvince;
    recentByProvince.set(key, bucket);
  }

  return PROVINCIAS.map((province) => {
    const label = province.properties.nombre;
    const key = resolveProvince(label);
    const roster = legislators[key] ?? { diputados: [], senadores: [] };
    const catalogParams = new URLSearchParams({ province: label, status: "Depositado" });
    if (lang === "en") catalogParams.set("lang", "en");
    return {
      id: key.replace(/\s+/g, "-"),
      featureIds: [PROVINCE_FEATURE_ID_BY_NAME[label]!],
      label,
      initiativeCount: counts.get(key)?.total ?? 0,
      activeInitiativeCount: counts.get(key)?.active ?? 0,
      depositedInitiativeCount: depositedByProvince.get(key) ?? 0,
      allDepositedInitiativesHref: `/initiatives?${catalogParams.toString()}`,
      initiatives: recentByProvince.get(key) ?? [],
      deputies: roster.diputados,
      senators: roster.senadores,
    };
  }).sort((a, b) => a.label.localeCompare(b.label, lang === "es" ? "es" : "en"));
}

export type { RosterMember, CommissionWithMembers };

export interface CongresoData {
  legislators: LegislatorSummary[];
  commissions: CongressCommission[];
  /** Distinct party siglas present, sorted, for the filter UI. */
  parties: string[];
  /** Distinct province names (display form), sorted; "Exterior" sentinel for ultramar. */
  provinces: string[];
}

export type CongressCommissionMember = Omit<LegislatorSummary, "profileId"> & {
  profileId: number | null;
};

export interface CongressCommission {
  chamber: string;
  name: string;
  members: CongressCommissionMember[];
  agendas: CommissionWithMembers["agendas"];
}

/**
 * Everything the /congresistas page needs: minimal active-roster summaries, lightweight
 * committee-member references, and the facet lists used for client-side filtering. Full
 * profile/contact/committee facts are intentionally deferred to the exact-id endpoint.
 *
 * Cached for 5 min: the roster changes weekly (the `roster` ingestion), so re-querying
 * ~2.8k rows on every page view is wasteful. `revalidate` keeps it fresh enough.
 */
async function _getCongreso(): Promise<CongresoData> {
  const d = await db();
  const [legislators, rawCommissions] = await Promise.all([
    listLegislatorSummaries(d),
    commissionsWithMembers(d),
  ]);
  const profileById = new Map(legislators.map((legislator) => [legislator.profileId, legislator]));
  const commissions: CongressCommission[] = rawCommissions.map((commission) => ({
    chamber: commission.chamber,
    name: commission.name,
    agendas: commission.agendas,
    members: commission.members.map((member) => {
      const profile = member.profileId == null ? null : (profileById.get(member.profileId) ?? null);
      return {
        profileId: member.profileId,
        fullName: member.name,
        chamber: commission.chamber,
        role: member.cargo,
        party: member.party ?? profile?.party ?? null,
        province: profile?.province ?? null,
      };
    }),
  }));

  const parties = [
    ...new Set(
      legislators.map((legislator) => legislator.party).filter((party): party is string => !!party),
    ),
  ].sort();
  const provinces = [
    ...new Set(
      legislators
        .map((legislator) => legislator.province)
        .filter((province): province is string => !!province),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
  return { legislators, commissions, parties, provinces };
}
export const getCongreso = unstable_cache(_getCongreso, ["congreso-lightweight-roster-v4"], {
  revalidate: 300,
});

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
  /** Source-literal spellings accepted for one customer-facing province. */
  provinceValues?: string[];
  /** Server-resolved canonical profile id; never inferred or accepted unchecked. */
  proponentLegislatorProfileId?: number;
  page?: number;
  pageSize?: number;
}

export interface InitiativeCatalogLegislatorFilter {
  profileId: number;
  fullName: string;
  chamber: "DIPUTADOS" | "SENADO";
}

/**
 * Resolve an opaque Oculis profile id to an exact current or historical profile. Initiative rows
 * are filtered later through persisted, provenance-bearing proponent relationships;
 * this function never accepts a source-specific identity from the public URL.
 */
export async function getInitiativeCatalogLegislatorFilter(
  profileId: number,
): Promise<InitiativeCatalogLegislatorFilter | null> {
  if (!Number.isSafeInteger(profileId) || profileId <= 0) return null;
  const d = await db();
  const profile = await getDbLegislatorProfileById(d, profileId);
  if (!profile || (profile.chamber !== "DIPUTADOS" && profile.chamber !== "SENADO")) return null;
  return { profileId: profile.id, fullName: profile.fullName, chamber: profile.chamber };
}

export async function browseInitiatives(f: InitiativeBrowseFilters) {
  const d = await db();
  const [{ PROVINCIAS }, page, facetVals] = await Promise.all([
    import("./province-data"),
    listInitiatives(d, f),
    facets(d),
  ]);
  return {
    ...page,
    rows: page.rows.map(toInitiativeListItem),
    facets: {
      parties: facetVals.parties,
      statuses: facetVals.statuses,
      provinces: PROVINCIAS.map((province) => province.properties.nombre).sort((a, b) =>
        a.localeCompare(b, "es-DO"),
      ),
    },
  };
}

export async function getInitiative(id: number) {
  const d = await db();
  const ini = await getInitiativeById(d, id);
  if (!ini) return null;
  const publishedProponents = explicitProponents(ini.raw);
  const [relatedNews, officialDocuments, linkedProponents] = await Promise.all([
    listFeedForInitiative(d, id, 10),
    listDocuments(d, id),
    listInitiativeProponents(d, id),
  ]);
  const proponents =
    linkedProponents.length > 0
      ? linkedProponents.map((link) => {
          const direct = publishedProponents[link.ordinal];
          return {
            name: link.publishedName,
            firstNames: direct?.firstNames ?? null,
            lastNames: direct?.lastNames ?? null,
            legislatorId: direct?.legislatorId ?? null,
            principal: link.principal,
            role: direct?.role ?? link.profile?.role ?? null,
            representationLevel: direct?.representationLevel ?? null,
            representationStatus: direct?.representationStatus ?? null,
            representationStart: direct?.representationStart ?? null,
            representationEnd: direct?.representationEnd ?? null,
            representationPeriod: direct?.representationPeriod ?? null,
            party: direct?.party ?? link.profile?.party ?? null,
            partyName: direct?.partyName ?? null,
            partyId: direct?.partyId ?? null,
            province: direct?.province ?? link.profile?.province ?? null,
            constituency: direct?.constituency ?? null,
            profileId: link.profile?.profileId ?? null,
            chamber: link.profile?.chamber ?? ini.chamber,
          };
        })
      : await (async () => {
          const profileIds = await resolveActiveLegislatorProfileIds(
            d,
            publishedProponents.map((proponent) => ({
              source: "roster-diputados",
              sourceId: proponent.legislatorId == null ? null : String(proponent.legislatorId),
            })),
          );
          return publishedProponents.map((proponent, index) => ({
            ...proponent,
            profileId: profileIds[index] ?? null,
            chamber: ini.chamber,
          }));
        })();
  const principalProponent =
    proponents.find((proponent) => proponent.principal === true) ?? proponents[0] ?? null;
  const events = ini.events.map((event) => ({
    id: event.id,
    sourceEventId: event.sourceEventId,
    status: event.status,
    eventDate: event.eventDate,
    eventEndDate: event.eventEndDate,
    note: event.note,
    source: event.source,
    sourceUrl: safeOfficialUrl(event.sourceUrl, event.source),
    evidenceType: event.evidenceType,
    observedAt: event.observedAt ? new Date(event.observedAt).toISOString() : null,
  }));
  const archivedProceduralFacts = explicitLegislatureCountingFacts(ini.raw, ini.source);
  const expiresAt = ini.expiresAt ?? archivedProceduralFacts.expiresAt;
  const initiated = ini.initiated ?? archivedProceduralFacts.initiated;
  const initiatedAt = ini.initiatedAt ?? archivedProceduralFacts.initiatedAt;
  const legislature = ini.legislature ?? archivedProceduralFacts.legislature;
  const proceduralFacts = initiativeProceduralFacts({
    type: ini.type,
    status: ini.status,
    expiresAt,
    initiated,
    initiatedAt,
    legislature,
    currentChamber: ini.currentChamber,
    currentBody: ini.currentBody,
    sourceChamber: ini.sourceChamber,
    originChamber: ini.originChamber,
    events: events.map((event) => ({
      source: event.source,
      status: event.status,
      eventDate: event.eventDate,
      observedAt: event.observedAt,
      evidenceType: event.evidenceType,
      sourceEventId: event.sourceEventId,
    })),
  });
  return {
    id: ini.id,
    source: ini.source,
    sourceId: ini.sourceId,
    code: ini.code,
    title: ini.title,
    /** Kept separate so the source-published Spanish title remains canonical. */
    titleEn: ini.titleEn,
    purpose: ini.purpose,
    type: ini.type,
    status: ini.status,
    chamber: ini.chamber,
    sourceChamber: ini.sourceChamber,
    originChamber: ini.originChamber,
    currentChamber: ini.currentChamber,
    currentBody: ini.currentBody,
    condition: ini.condition,
    sourceCategory: ini.sourceCategory,
    subjectMatter: ini.subjectMatter,
    sponsor: ini.sponsor,
    sponsorRole: ini.sponsorRole,
    sponsorCount: ini.sponsorCount,
    sponsorLegislatorSourceId:
      principalProponent?.legislatorId == null ? null : String(principalProponent.legislatorId),
    sponsorProfileId: principalProponent?.profileId ?? null,
    proponents,
    activities: explicitInitiativeActivities(ini.raw),
    votes: explicitInitiativeVotes(ini.raw),
    sourceCoverage: initiativeSourceCoverage(ini.raw, ini.source),
    party: ini.party,
    province: ini.province,
    committee: ini.committee,
    filedAt: ini.filedAt,
    expiresAt,
    proceduralFacts,
    initiated,
    initiatedAt,
    legislature,
    registrationPeriod: ini.registrationPeriod,
    officialStatusChangedAt: ini.officialStatusChangedAt,
    promulgationNumber: ini.promulgationNumber,
    promulgatedAt: ini.promulgatedAt,
    sourceUrl: safeOfficialUrl(ini.sourceUrl, ini.source),
    events,
    commissionAssignments: ini.commissionAssignments.map((assignment) => ({
      id: assignment.id,
      source: assignment.source,
      sourceAssignmentId: assignment.sourceAssignmentId,
      sourceTypeId: assignment.sourceTypeId,
      name: assignment.name,
      type: assignment.type,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      firstSeenAt: new Date(assignment.firstSeenAt).toISOString(),
      lastSeenAt: new Date(assignment.lastSeenAt).toISOString(),
    })),
    documents: officialDocuments.map((document) => ({
      id: document.id,
      source: document.source,
      sourceDocId: document.sourceDocId,
      docType: document.docType,
      extension: document.extension,
      url: safeOfficialUrl(document.url, document.source),
      uploadedAt: document.uploadedAt,
      modifiedAt: document.modifiedAt,
      sourceCategory: document.sourceCategory,
      sourceFragment: document.sourceFragment,
      firstSeenAt: document.firstSeenAt,
      lastSeenAt: document.lastSeenAt,
      pdfAvailable: document.pdfAvailable,
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

/** One exact, shareable agenda/activity record. */
export async function getActivity(id: number) {
  const d = await db();
  return getActivityById(d, id);
}

/** Per-day committee/plenary counts for the activity sparkline/calendar. */
export async function getActivityCalendar(since?: string) {
  const d = await db();
  return activityCountsByDate(d, { since });
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
  const registered = SCRAPER_SOURCE_REGISTRY.filter(
    (entry) => entry.status === "ACTIVE" && entry.id.startsWith("feed-"),
  );
  const sources = registered.map((entry) => {
    const row = latestBySource.get(entry.id);
    return {
      source: entry.id,
      label: entry.label,
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

export async function getCommissions(chamber?: string) {
  const d = await db();
  return listCommissions(d, { chamber });
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
    url: safeOfficialUrl(row.url, row.source),
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
  ["commissions-with-members-profile-identity-v2"],
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

export interface RegulationFact {
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
        sourceId: item.sourceId,
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
    const profileIds = await resolveActiveLegislatorProfileIds(
      d,
      rows.map((row) => ({
        sourceId: row.legislatorSourceId,
        chamber: row.chamber,
      })),
    );
    return rows
      .flatMap((row, index): FeedAccount[] => {
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
                legislatorProfileId: profileIds[index] ?? null,
              },
            ]
          : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
  ["feed-account-directory-v2-profile-identity"],
  { revalidate: 600 },
);
