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

/**
 * Format the date and wall-clock time exactly as supplied by an official source.
 * Legislative systems often omit a timezone, so this intentionally does not convert
 * the timestamp through UTC. Fractional seconds are accepted but omitted from the
 * human-facing value; the complete source value remains available in the API.
 */
export function formatISODateTime(iso: string | null | undefined, lang: Lang): string {
  const date = formatISODate(iso, lang);
  if (!iso || date === (lang === "es" ? "No informado" : "Not reported")) return date;
  const match = iso.match(
    /^\d{4}-\d{2}-\d{2}[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!match) return date;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] == null ? null : Number(match[3]);
  if (hour > 23 || minute > 59 || (second != null && second > 59)) {
    return lang === "es" ? "No informado" : "Not reported";
  }
  const time = `${match[1]}:${match[2]}${match[3] == null ? "" : `:${match[3]}`}`;
  return `${date}, ${time}`;
}

/** Short day/month form (e.g. "24/06" / "Jun 24") for compact date stamps. */
export function formatISODayMonth(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  return formatISODate(iso, lang, { day: "2-digit", month: "2-digit" });
}

/**
 * Format an official wall-clock value without inventing a timezone or displaying
 * implementation-level seconds. Accepted input is HH:mm or HH:mm:ss.
 */
export function formatOfficialTime(value: string | null | undefined, lang: Lang): string {
  const missing = lang === "es" ? "No informado" : "Not reported";
  if (!value) return missing;
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return missing;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] == null ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return missing;

  const twelveHour = hour % 12 || 12;
  const meridiem = lang === "es" ? (hour < 12 ? "a. m." : "p. m.") : hour < 12 ? "AM" : "PM";
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}
