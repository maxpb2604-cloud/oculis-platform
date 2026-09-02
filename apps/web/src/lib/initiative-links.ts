import type { Lang } from "@/lib/i18n";
import { safeOfficialUrl, senateRecordId } from "@/lib/input";

export interface InitiativeLinkFacts {
  source: string | null | undefined;
  sourceId: string | null | undefined;
  sourceUrl: string | null | undefined;
}

/**
 * One canonical destination for an official initiative record.
 *
 * Senate SIL records are the only records allowed to use the authenticated read-only
 * proxy. Every other source must provide a URL on the official domain assigned to that
 * source; there is deliberately no chamber-based or landing-page fallback.
 */
export function officialInitiativeHref(
  facts: InitiativeLinkFacts,
  lang: Lang = "es",
): string | null {
  if (facts.source === "senado-sil") {
    const id = senateRecordId(facts.sourceId);
    return id ? `/api/senado/ficha/${id}${lang === "en" ? "?lang=en" : ""}` : null;
  }
  if (facts.source === "sil-diputados") {
    const id = facts.sourceId?.trim();
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    const safe = safeOfficialUrl(facts.sourceUrl, facts.source);
    if (!safe) return null;
    try {
      const url = new URL(safe);
      return url.pathname === `/sil/iniciativa/${id}` && !url.search && !url.hash ? safe : null;
    } catch {
      return null;
    }
  }
  return safeOfficialUrl(facts.sourceUrl, facts.source);
}

/** Durable Oculis detail URL; unlike the quick-view trigger, it can be copied/opened. */
export function initiativeDetailHref(id: number, lang: Lang, returnTo?: string | null): string {
  const params = new URLSearchParams();
  if (lang === "en") params.set("lang", "en");
  const safeReturnTo = sanitizeInitiativeCatalogReturnTo(returnTo, lang);
  if (safeReturnTo) params.set("returnTo", safeReturnTo);
  const query = params.toString();
  return `/initiatives/${id}${query ? `?${query}` : ""}`;
}

const INTERNAL_URL_ORIGIN = "https://oculis.internal";
const CATALOG_TEXT_LIMITS = {
  search: 160,
  party: 64,
  status: 120,
  province: 80,
} as const;

/**
 * Reduce a catalog return target to the one internal route and the filters Oculis owns.
 * Absolute URLs, protocol-relative URLs, fragments, duplicate values and unknown parameters
 * never survive into a customer-facing link.
 */
function sanitizeInitiativeCatalogReturnTo(
  value: string | null | undefined,
  lang: Lang,
): string | null {
  const raw = value?.trim();
  if (!raw || raw.length > 2_048 || /[\r\n]/.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, INTERNAL_URL_ORIGIN);
  } catch {
    return null;
  }
  if (
    parsed.origin !== INTERNAL_URL_ORIGIN ||
    parsed.pathname !== "/initiatives" ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const params = new URLSearchParams();
  for (const [key, maxLength] of Object.entries(CATALOG_TEXT_LIMITS)) {
    const values = parsed.searchParams.getAll(key);
    if (values.length !== 1) continue;
    const clean = values[0]?.trim() ?? "";
    if (clean && clean.length <= maxLength) params.set(key, clean);
  }

  const chamberValues = parsed.searchParams.getAll("chamber");
  if (
    chamberValues.length === 1 &&
    (chamberValues[0] === "DIPUTADOS" || chamberValues[0] === "SENADO")
  ) {
    params.set("chamber", chamberValues[0]);
  }

  const legislatorValues = parsed.searchParams.getAll("legislator");
  if (legislatorValues.length === 1 && /^\d+$/.test(legislatorValues[0] ?? "")) {
    const profileId = Number(legislatorValues[0]);
    if (Number.isSafeInteger(profileId) && profileId > 0) {
      params.set("legislator", String(profileId));
    }
  }

  const pageValues = parsed.searchParams.getAll("page");
  if (pageValues.length === 1 && /^\d+$/.test(pageValues[0] ?? "")) {
    const page = Number(pageValues[0]);
    if (Number.isSafeInteger(page) && page > 1 && page <= 10_000) params.set("page", String(page));
  }

  if (lang === "en") params.set("lang", "en");
  const query = params.toString();
  return `/initiatives${query ? `?${query}` : ""}`;
}

/** Safe detail-page back destination. Invalid or external input falls back locally. */
export function initiativeCatalogReturnHref(
  returnTo: string | null | undefined,
  lang: Lang,
): string {
  return (
    sanitizeInitiativeCatalogReturnTo(returnTo, lang) ??
    `/initiatives${lang === "en" ? "?lang=en" : ""}`
  );
}

/** Canonical profile id carried by a previously validated catalog return target. */
export function initiativeCatalogReturnLegislatorProfileId(
  returnTo: string | null | undefined,
  lang: Lang,
): number | null {
  const safe = sanitizeInitiativeCatalogReturnTo(returnTo, lang);
  if (!safe) return null;
  const parsed = new URL(safe, INTERNAL_URL_ORIGIN);
  const raw = parsed.searchParams.get("legislator");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const profileId = Number(raw);
  return Number.isSafeInteger(profileId) && profileId > 0 ? profileId : null;
}

/**
 * Internal catalog destination for initiatives linked to one canonical legislator
 * profile. The catalog resolves this opaque profile id server-side and never exposes
 * or guesses the source person identifier in the URL.
 */
export function legislatorFiledInitiativesHref(profileId: number, lang: Lang): string | null {
  if (!Number.isSafeInteger(profileId) || profileId <= 0) return null;
  const params = new URLSearchParams({ legislator: String(profileId) });
  if (lang === "en") params.set("lang", "en");
  return `/initiatives?${params.toString()}`;
}
