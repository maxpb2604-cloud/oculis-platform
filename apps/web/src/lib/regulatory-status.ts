/** Factual lifecycle used by the regulatory workspace. */
export type RegulatoryActivityState = "OPEN" | "UPCOMING" | "IN_PROCESS" | "CLOSED" | "UNKNOWN";

export interface RegulatoryActivityInput {
  status: string | null;
  isConsulta?: boolean | null;
  publishedAt?: string | null;
  deadline?: string | null;
}

export interface PublicConsultationActivity {
  isConsulta?: boolean | null;
  activityState: RegulatoryActivityState;
}

const EXPLICIT_OPEN_CONSULTATION_STATUSES = new Set([
  "abierto",
  "abierta",
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
 * An Initiative in Public Consultation is "open today" only with both kinds of
 * context required for that claim: the record is identified as a public
 * consultation and direct evidence shows an explicit open status or a
 * source-published date window containing the requested day. A regulatory
 * instrument described as active/in force is never converted into an open
 * consultation.
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

  if (item.isConsulta && EXPLICIT_OPEN_CONSULTATION_STATUSES.has(normalized)) return "OPEN";
  if (IN_PROCESS_STATUSES.has(normalized)) return "IN_PROCESS";
  return "UNKNOWN";
}

/** Explicit public-participation status predicate; dates are intentionally ignored. */
export function isExplicitlyOpenConsultationStatus(status: string | null): boolean {
  return status
    ? EXPLICIT_OPEN_CONSULTATION_STATUSES.has(normalizeRegulatoryStatus(status))
    : false;
}

/** True only for a formally identified public consultation whose participation window is open. */
export function isOpenPublicConsultation(item: PublicConsultationActivity): boolean {
  return item.isConsulta === true && item.activityState === "OPEN";
}
