import { resolveProvince } from "@/lib/provinces";

export type InitiativeCatalogSearchParams = Record<string, string | undefined>;

const PROVINCE_SOURCE_VALUES: Record<string, string[]> = {
  baoruco: ["Baoruco", "Bahoruco"],
  "monte cristi": ["Monte Cristi", "Montecristi"],
  "distrito nacional": ["Distrito Nacional", "Santo Domingo de Guzmán", "Santo Domingo de Guzman"],
};

/**
 * Convert the customer-facing province query into the source-literal spellings that
 * belong to the same province. National representation remains its own value and is
 * never reassigned to Distrito Nacional.
 */
export function initiativeCatalogProvinceValues(province: string | undefined): string[] {
  const value = province?.trim();
  if (!value) return [];
  return PROVINCE_SOURCE_VALUES[resolveProvince(value)] ?? [value];
}

/** Preserve every active catalog filter while changing only the result page. */
export function initiativeCatalogPageHref(sp: InitiativeCatalogSearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const key of [
    "lang",
    "search",
    "party",
    "status",
    "chamber",
    "province",
    "legislator",
  ] as const) {
    if (sp[key]) params.set(key, sp[key]!);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/initiatives${query ? `?${query}` : ""}`;
}
