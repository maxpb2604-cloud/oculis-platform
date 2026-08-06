/** A source status that has deliberately not been assigned a semantic lifecycle. */
export interface LiteralStatus {
  stage: "DESCONOCIDO";
  label: string;
  tooltip: string;
}

/**
 * Preserve a source-reported status literally. No regex, translation, ordering, or
 * lifecycle assignment is performed; missing data remains explicitly unknown.
 */
export function normalizeStatus(raw: string | null | undefined): LiteralStatus {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      stage: "DESCONOCIDO",
      label: "Sin estado reportado",
      tooltip: "La fuente no reportó un estado.",
    };
  }
  return {
    stage: "DESCONOCIDO",
    label: text,
    tooltip: "Estado reportado literalmente por la fuente; Oculis no infiere su etapa.",
  };
}
