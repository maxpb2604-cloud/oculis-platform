import type { Lang } from "@/lib/i18n";

/**
 * Locale-aware date formatting for ISO dates (`YYYY-MM-DD` or full ISO strings).
 * Replaces the manual `iso.slice(...)` formatting scattered across components so dates
 * read naturally in both Spanish (es-DO) and English (en-US).
 *
 * Returns an explicit "No informado"/"Not reported" label for missing input.
 * Anchored at noon to avoid timezone day-shift.
 */
export function formatISODate(
  iso: string | null | undefined,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
): string {
  const missing = lang === "es" ? "No informado" : "Not reported";
  if (!iso) return missing;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) return missing;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, date));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== date
  ) {
    return missing;
  }
  const d = new Date(year, month - 1, date, 12, 0, 0);
  return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", opts).format(d);
}

/** Short day/month form (e.g. "24/06" / "Jun 24") for compact date stamps. */
export function formatISODayMonth(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  return formatISODate(iso, lang, { day: "2-digit", month: "2-digit" });
}
