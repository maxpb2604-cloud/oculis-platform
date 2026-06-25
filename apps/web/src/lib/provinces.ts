/**
 * Pure province-name helpers shared by the server data layer and client components
 * (the bubble map). Kept dependency-free (no "server-only") so it can be imported from
 * both. Province names differ slightly across the chambers' sources and the map dataset,
 * so everything is keyed on a normalized, alias-resolved form.
 */

/** Lowercase, accent-stripped, whitespace-collapsed — the cross-source key. */
export const normProvince = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Aliases that differ between the chambers' sources and the map dataset. */
export const PROVINCE_ALIASES: Record<string, string> = {
  nacional: "distrito nacional",
  "santo domingo de guzman": "distrito nacional",
  bahoruco: "baoruco",
};

/** Canonical normalized province key (alias-resolved). */
export const resolveProvince = (s: string) => PROVINCE_ALIASES[normProvince(s)] ?? normProvince(s);
