import type { Lang } from "@/lib/i18n";

/**
 * Locale-aware date formatting for ISO dates (`YYYY-MM-DD` or full ISO strings).
 * Replaces the manual `iso.slice(...)` formatting scattered across components so dates
 * read naturally in both Spanish (es-DO) and English (en-US).
 *
 * Returns "—" for null/empty input. Anchored at noon to avoid timezone day-shift.
 */
export function formatISODate(
  iso: string | null | undefined,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
): string {
  if (!iso) return "—";
  const day = iso.slice(0, 10);
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", opts).format(d);
}

/** Short day/month form (e.g. "24/06" / "Jun 24") for compact date stamps. */
export function formatISODayMonth(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  return formatISODate(iso, lang, { day: "2-digit", month: "2-digit" });
}

/**
 * Readable short name for a bill, shown instead of its code on the feed. Strips the
 * legalistic "Proyecto de ley/resolución … que/mediante la cual …" boilerplate to get
 * to the substance, capitalizes, and trims to a chip-friendly length. Falls back to the
 * given code when there's no title.
 */
export function shortBillName(title: string | null | undefined, code?: string | null): string {
  const fallback = code ?? "Proyecto";
  if (!title) return fallback;
  let t = title.replace(/\s+/g, " ").trim();
  t = t.replace(
    /^proyecto\s+de\s+(ley|resoluci[óo]n)(\s+org[áa]nica)?\s+(de\s+la\s+c[áa]mara\s+de\s+diputados\s+|del\s+senado\s+(de\s+la\s+rep[úu]blica\s+)?)?(mediante\s+la\s+cual|por\s+la\s+cual|mediante\s+el\s+cual|que|para|sobre)?\s*/i,
    "",
  );
  t = t.trim();
  if (t.length < 4) t = title.replace(/\s+/g, " ").trim();
  if (!t) return fallback;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 68 ? `${t.slice(0, 65).trimEnd()}…` : t;
}

/**
 * Guard for URLs that came from scraped/external sources (RSS, X, government
 * portals) before rendering them as hrefs: only http(s) survives, so a
 * compromised feed can never inject a `javascript:` (or other scheme) link.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url.trim()) ? url : undefined;
}
