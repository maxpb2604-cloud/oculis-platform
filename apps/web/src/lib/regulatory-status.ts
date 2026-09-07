/** Factual lifecycle used by the regulatory workspace. */
export type RegulatoryActivityState = "OPEN" | "UPCOMING" | "IN_PROCESS" | "CLOSED" | "UNKNOWN";

export interface RegulatoryActivityInput {
  status: string | null;
  isConsulta?: boolean | null;
  publishedAt?: string | null;
  deadline?: string | null;
}

const EXPLICIT_ACTIVE_STATUSES = new Set([
  "active",
  "activo",
  "activa",
  "abierto",
  "abierta",
  "in force",
  "vigente",
  "consulta abierta",
  "consulta publica abierta",
  "en consulta",
  "en consulta publica",
]);

const EXPLICIT_CLOSED_STATUSES = new Set([
  "closed",
  "cerrado",
  "cerrada",
  "vencido",
  "vencida",
  "finalizado",
  "finalizada",
  "concluido",
  "concluida",
  "archivado",
  "archivada",
  "retirado",
  "retirada",
]);

const IN_PROCESS_STATUSES = new Set([
  "agenda",
  "borrador",
  "draft",
  "iniciativa",
  "por iniciar",
  "en proceso",
  "en elaboracion",
]);

export function normalizeRegulatoryStatus(status: string): string {
  return status
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function validISODate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

/**
 * A consultation is "vigente hoy" only with direct evidence: an explicit open
 * status or a source-published date window containing the requested day.
 */
export function classifyRegulatoryActivity(
  item: RegulatoryActivityInput,
  today: string,
): RegulatoryActivityState {
  const normalized = item.status ? normalizeRegulatoryStatus(item.status) : "";

  if (EXPLICIT_CLOSED_STATUSES.has(normalized)) return "CLOSED";

  if (item.isConsulta && validISODate(item.deadline)) {
    if (validISODate(item.publishedAt) && item.publishedAt > today) return "UPCOMING";
    return item.deadline >= today ? "OPEN" : "CLOSED";
  }

  if (EXPLICIT_ACTIVE_STATUSES.has(normalized)) return "OPEN";
  if (IN_PROCESS_STATUSES.has(normalized)) return "IN_PROCESS";
  return "UNKNOWN";
}

/** Backwards-compatible explicit-status predicate; dates are intentionally ignored. */
export function isExplicitlyActiveRegulation(status: string | null): boolean {
  return status ? EXPLICIT_ACTIVE_STATUSES.has(normalizeRegulatoryStatus(status)) : false;
}
