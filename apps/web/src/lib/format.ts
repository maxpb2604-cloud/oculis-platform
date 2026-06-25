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
