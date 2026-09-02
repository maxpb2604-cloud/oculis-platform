/**
 * Shared Spanish-date parsing for the scrapers. One month map + one validated
 * yyyy-mm-dd builder, consumed by every adapter (previously each had its own).
 */

/** Spanish month → 2-digit number, keyed by the first 3 letters (handles both
 *  "junio" and "jun"). Includes the DR-common "set/setiembre" spelling of Sept. */
export const MONTHS_ES: Record<string, string> = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  set: "09",
  oct: "10",
  nov: "11",
  dic: "12",
};

/** Calendar timezone used by the Dominican congressional sources. */
export const DOMINICAN_TIME_ZONE = "America/Santo_Domingo";

/**
 * Return the Dominican Republic calendar day for a point in time. Scheduled jobs
 * also run after 22:00 local time, when UTC is already on the following day; using
 * a UTC ISO prefix there would request and label the wrong official-source window.
 */
export function dominicanTodayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DOMINICAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) {
    throw new Error(`Could not resolve calendar date in ${DOMINICAN_TIME_ZONE}`);
  }
  return `${year}-${month}-${day}`;
}

/** Resolve a Spanish month name (full or abbreviated) to "01".."12", or null. */
export function spanishMonthToNum(name: string | null | undefined): string | null {
  if (!name) return null;
  return MONTHS_ES[name.trim().slice(0, 3).toLowerCase()] ?? null;
}

/**
 * Build a validated ISO date (yyyy-mm-dd) from day/month/year parts, rejecting
 * impossible values (month 1–12, day 1–31). Returns null when invalid so callers
 * never persist `2026-13-45`.
 */
export function buildISODate(
  day: string | number,
  month: string | number,
  year: string | number,
): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const exact = new Date(Date.UTC(y, m - 1, d));
  if (exact.getUTCFullYear() !== y || exact.getUTCMonth() !== m - 1 || exact.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Extract a validated date only when the source value starts with an ISO calendar
 * date. A timestamp separator may follow; arbitrary suffixes and impossible dates
 * are rejected instead of being truncated into apparently valid evidence.
 */
export function extractLeadingISODate(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|[T\s])/);
  return match ? buildISODate(match[3]!, match[2]!, match[1]!) : null;
}
