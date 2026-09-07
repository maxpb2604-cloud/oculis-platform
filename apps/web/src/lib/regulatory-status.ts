/**
 * Conservative regulatory status classification.
 *
 * A record is counted as active only when the official source supplies an
 * explicit status whose normalized value matches this allow-list. Missing,
 * ambiguous, or merely "published" records are never promoted to active.
 */
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

export function normalizeRegulatoryStatus(status: string): string {
  return status
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isExplicitlyActiveRegulation(status: string | null): boolean {
  return status ? EXPLICIT_ACTIVE_STATUSES.has(normalizeRegulatoryStatus(status)) : false;
}
