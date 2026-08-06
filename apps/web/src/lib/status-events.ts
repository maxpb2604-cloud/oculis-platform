import type { Lang } from "@/lib/i18n";

/** Human-readable labels that preserve how a status event was evidenced. */
export function statusEvidenceLabel(evidenceType: string | null | undefined, lang: Lang): string {
  if (evidenceType === "SOURCE_HISTORY") {
    return lang === "es" ? "Historial reportado por la fuente" : "Source-reported history";
  }
  if (evidenceType === "OBSERVED_CHANGE") {
    return lang === "es" ? "Cambio observado por Oculis" : "Change observed by Oculis";
  }
  if (evidenceType === "LEGACY_UNATTRIBUTED") {
    return lang === "es"
      ? "Registro heredado sin fuente atribuible"
      : "Legacy record without attributable source";
  }
  return evidenceType ?? (lang === "es" ? "No informado" : "Not reported");
}
