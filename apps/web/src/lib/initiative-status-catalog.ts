import type { Lang } from "@/lib/i18n";
import { legislativeMovementDefinition } from "@/lib/legislative-movement-glossary";

export type CatalogStatus = {
  value: string;
  label: string;
  description: string;
  variants: string[];
  known: boolean;
};

/** Only typography, grammatical gender and equivalent first/second-reading spellings
 * are folded. Procedural qualifiers (modifications, chamber, reading, destination)
 * remain distinct. Official source values stay untouched in the database and detail. */
export function catalogStatusKey(status: string): string {
  return status
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[.,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(aprobad|depositad|despachad|enviad|fusionad|perimid|promulgad|retirad|rechazad|tomad|remitid|dejad|descargad)[oa]\b/,
      "$1o",
    )
    .replace(/\b(1ra|1era|primera)\b/g, "primera")
    .replace(/\b(2da|segunda|seg)\b/g, "segunda");
}

/** Group the values actually observed in the database; do not hide unknown values. */
export function catalogStatuses(statuses: readonly string[], lang: Lang): CatalogStatus[] {
  const groups = new Map<string, string[]>();
  for (const value of statuses) {
    if (!value.trim()) continue;
    const key = catalogStatusKey(value);
    const variants = groups.get(key) ?? [];
    if (!variants.includes(value)) variants.push(value);
    groups.set(key, variants);
  }

  return [...groups]
    .map(([key, variants]) => {
      const representative = variants[0]!;
      const definition = legislativeMovementDefinition(representative, lang);
      return {
        value: `group:${key}`,
        label: definition?.known ? definition.label : representative.trim(),
        description: definition?.description ?? "",
        variants,
        known: definition?.known ?? false,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, lang === "es" ? "es-DO" : "en"));
}

/** Legacy links containing one literal status expand to the same complete group. */
export function statusVariantsForSelection(
  statuses: readonly string[],
  selection: string | undefined,
): string[] | undefined {
  if (!selection) return undefined;
  const key = selection.startsWith("group:") ? selection.slice(6) : catalogStatusKey(selection);
  const matched = statuses.filter((status) => catalogStatusKey(status) === key);
  return matched.length ? matched : [selection];
}

export function statusSelectionLabel(
  statuses: readonly string[],
  selection: string,
  lang: Lang,
): string {
  const key = selection.startsWith("group:") ? selection : `group:${catalogStatusKey(selection)}`;
  return catalogStatuses(statuses, lang).find((entry) => entry.value === key)?.label ?? selection;
}
