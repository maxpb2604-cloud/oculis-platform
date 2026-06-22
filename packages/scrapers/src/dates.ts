/**
 * Shared Spanish-date parsing for the scrapers. One month map + one validated
 * yyyy-mm-dd builder, consumed by every adapter (previously each had its own).
 */

/** Spanish month → 2-digit number, keyed by the first 3 letters (handles both
 *  "junio" and "jun"). Includes the DR-common "set/setiembre" spelling of Sept. */
export const MONTHS_ES: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", set: "09", oct: "10", nov: "11", dic: "12",
};

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
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
