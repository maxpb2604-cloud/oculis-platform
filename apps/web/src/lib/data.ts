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

/** Activity for a specific day (default today), optionally filtered by chamber. */
export async function getDayActivity(opts: { date?: string; chamber?: string } = {}) {
  const d = await db();
  const date = opts.date ?? todayISO();
  const items = await listActivity(d, { date, chamber: opts.chamber, limit: 500 });
  return { date, items };
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
