/**
 * Server-side data access for the dashboard. Reuses @oculis/db, which reads from
 * Postgres (DATABASE_URL) or a file-backed PGlite (PGLITE_DIR) — the same store the
 * worker writes to. A single shared handle is cached across requests.
 */
import "server-only";
import {
  createDb,
  countByApprovalProbability,
  countByCategory,
  countByRisk,
  countByStatus,
  dashboardKpis,
  facets,
  getInitiativeById,
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
