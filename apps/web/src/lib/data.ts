/**
 * Server-side data access for the dashboard. Reuses @oculis/db, which reads from
 * Postgres (DATABASE_URL) or a file-backed PGlite (PGLITE_DIR) — the same store the
 * worker writes to. A single shared handle is cached across requests.
 */
import "server-only";
import {
  createDb,
  activityCountsByDate,
  countByApprovalProbability,
  countByCategory,
  countByRisk,
  countByStatus,
  dashboardKpis,
  facets,
  getInitiativeById,
  latestRunsBySource,
  listActivity,
  listCommissions,
  listInitiatives,
  listRecentInitiatives,
  type DbHandle,
  type InitiativeFilters,
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
  const since = shiftISO(date, -(opts.senateWindowDays ?? 6));
  const [dip, sen] = await Promise.all([
    listActivity(d, { date, chamber: "DIPUTADOS", limit: 500 }),
    listActivity(d, { dateFrom: since, dateTo: date, chamber: "SENADO", limit: 500 }),
  ]);
  return { date, senateSince: since, dip, sen };
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
