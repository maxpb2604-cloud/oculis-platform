/** Participation-window state. It applies only to an Initiative in Public Consultation. */
export type PublicConsultationState = "OPEN" | "UPCOMING" | "CLOSED" | "UNKNOWN";

/** General regulatory-process state. It never describes a public-consultation window. */
export type RegulatoryProcessState = "IN_PROCESS" | "CONCLUDED" | "UNKNOWN";

/** Source-reported stage for an ordinary regulatory initiative that is still in process. */
export type RegulatoryProcessStage =
  | "DRAFT"
  | "AGENDA"
  | "INITIATIVE"
  | "TO_START"
  | "IN_PROCESS"
  | "IN_DEVELOPMENT";

export const REGULATORY_PROCESS_STAGE_ORDER: readonly RegulatoryProcessStage[] = [
  "DRAFT",
  "AGENDA",
  "IN_DEVELOPMENT",
  "TO_START",
  "IN_PROCESS",
  "INITIATIVE",
];

export interface RegulatoryActivityInput {
  status: string | null;
  isConsulta?: boolean | null;
  publishedAt?: string | null;
  deadline?: string | null;
}

export interface PublicConsultationActivity {
  isConsulta?: boolean | null;
  consultationState: PublicConsultationState | null;
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

const REGULATORY_PROCESS_STAGE_BY_STATUS: Readonly<Record<string, RegulatoryProcessStage>> = {
  agenda: "AGENDA",
  borrador: "DRAFT",
  draft: "DRAFT",
  iniciativa: "INITIATIVE",
  "por iniciar": "TO_START",
  "en proceso": "IN_PROCESS",
  "en elaboracion": "IN_DEVELOPMENT",
};

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
export function classifyPublicConsultation(
  item: RegulatoryActivityInput,
  today: string,
): PublicConsultationState | null {
  if (item.isConsulta !== true) return null;

  const normalized = item.status ? normalizeRegulatoryStatus(item.status) : "";

  if (EXPLICIT_CLOSED_STATUSES.has(normalized)) return "CLOSED";

  if (validISODate(item.deadline)) {
    if (validISODate(item.publishedAt) && item.publishedAt > today) return "UPCOMING";
    return item.deadline >= today ? "OPEN" : "CLOSED";
  }

  if (validISODate(item.publishedAt) && item.publishedAt > today) return "UPCOMING";
  if (EXPLICIT_OPEN_CONSULTATION_STATUSES.has(normalized)) return "OPEN";
  return "UNKNOWN";
}

/**
 * Classifies the general regulatory process only when the record is not an
 * Initiative in Public Consultation. Keeping this as a separate function and
 * field prevents participation-window labels from being reused as regulatory
 * validity or lifecycle labels.
 */
export function classifyRegulatoryProcess(
  item: Pick<RegulatoryActivityInput, "status" | "isConsulta">,
): RegulatoryProcessState | null {
  if (item.isConsulta === true) return null;
  const normalized = item.status ? normalizeRegulatoryStatus(item.status) : "";
  if (EXPLICIT_CLOSED_STATUSES.has(normalized)) return "CONCLUDED";
  if (REGULATORY_PROCESS_STAGE_BY_STATUS[normalized]) return "IN_PROCESS";
  return "UNKNOWN";
}

/**
 * Returns the exact process-stage bucket used in the regulatory KPI breakdown.
 * Public consultations are excluded so their participation state can never be
 * mixed with the ordinary regulatory-process stages shown here.
 */
export function classifyRegulatoryProcessStage(
  item: Pick<RegulatoryActivityInput, "status" | "isConsulta">,
): RegulatoryProcessStage | null {
  if (item.isConsulta === true) return null;
  const normalized = item.status ? normalizeRegulatoryStatus(item.status) : "";
  return REGULATORY_PROCESS_STAGE_BY_STATUS[normalized] ?? null;
}

/** Explicit public-participation status predicate; dates are intentionally ignored. */
export function isExplicitlyOpenConsultationStatus(status: string | null): boolean {
  return status
    ? EXPLICIT_OPEN_CONSULTATION_STATUSES.has(normalizeRegulatoryStatus(status))
    : false;
}

/** True only for a formally identified public consultation whose participation window is open. */
export function isOpenPublicConsultation(item: PublicConsultationActivity): boolean {
  return item.isConsulta === true && item.consultationState === "OPEN";
}
