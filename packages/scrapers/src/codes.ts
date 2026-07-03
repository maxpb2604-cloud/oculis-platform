/**
 * Single source of truth for the Dominican legislative initiative-code formats:
 *  - Cámara/period format, e.g. `05956-2024-2028-CD` (5-digit number · period · chamber
 *    suffix — `CD`, `SE`, occasionally 3-letter);
 *  - the Senate SIL's own expediente format, e.g. `01693-2026-PLO-SE` (5-digit number ·
 *    year · 2–4-letter series such as `PLO` · `SE`). The `-SE` tail is required so the
 *    alternative can't false-positive on ordinary hyphenated numbers.
 *
 * Hardened vs. the original per-adapter copies:
 *  - word boundaries (`\b`) so codes aren't carved out of longer digit runs;
 *  - case-insensitive letter groups so lowercased/PDF-mangled text still matches;
 *  - one place to edit if the official format ever changes.
 */
export const INITIATIVE_CODE_RE =
  /\b\d{5}-\d{4}-(?:\d{4}-[A-Za-z]{2,3}|[A-Za-z]{2,4}-[Ss][Ee])\b/g;

/** Extract unique, upper-cased initiative codes from arbitrary text. */
export function extractCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(INITIATIVE_CODE_RE) ?? [];
  return [...new Set(matches.map((c) => c.toUpperCase()))];
}
