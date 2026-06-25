import { describe, expect, it } from "vitest";
import { buildISODate, MONTHS_ES, spanishMonthToNum } from "../src/dates.js";

/**
 * The plenary order-of-the-day parser in sil-actividad.ts pulls the session date out of
 * free text like "...MIÉRCOLES 24 DE JUNIO DE 2026..." via an internal `parseSpanishDate`
 * helper. That helper is NOT exported, so we exercise the exported building blocks it is
 * composed of — `spanishMonthToNum` + `buildISODate` (from dates.ts) — which reproduce the
 * exact "24 DE JUNIO DE 2026" -> "2026-06-24" behavior end to end. We also drive the public
 * Spanish-date regex inline so the whole-string path is covered.
 */

// Mirror of the regex used by sil-actividad's parseSpanishDate (case-insensitive).
const SPANISH_DATE_RE = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i;

function parseSpanishDate(text: string): string | null {
  const m = SPANISH_DATE_RE.exec(text);
  if (!m) return null;
  const mm = spanishMonthToNum(m[2]);
  return mm ? buildISODate(m[1]!, mm, m[3]!) : null;
}

describe("dates: spanishMonthToNum", () => {
  it("resolves full month names", () => {
    expect(spanishMonthToNum("junio")).toBe("06");
    expect(spanishMonthToNum("enero")).toBe("01");
    expect(spanishMonthToNum("diciembre")).toBe("12");
  });

  it("resolves abbreviated month names by first 3 letters", () => {
    expect(spanishMonthToNum("jun")).toBe("06");
    expect(spanishMonthToNum("dic.")).toBe("12");
  });

  it("is case-insensitive (uppercase Spanish month, as seen in plenary documents)", () => {
    expect(spanishMonthToNum("JUNIO")).toBe("06");
  });

  it("handles the DR-common 'setiembre' spelling of September", () => {
    expect(spanishMonthToNum("setiembre")).toBe("09");
    expect(spanishMonthToNum("septiembre")).toBe("09");
  });

  it("returns null for unknown or nullish names", () => {
    expect(spanishMonthToNum("zzz")).toBeNull();
    expect(spanishMonthToNum(null)).toBeNull();
    expect(spanishMonthToNum(undefined)).toBeNull();
  });

  it("MONTHS_ES carries every month key", () => {
    expect(Object.keys(MONTHS_ES).length).toBeGreaterThanOrEqual(12);
  });
});

describe("dates: buildISODate", () => {
  it("zero-pads day and month", () => {
    expect(buildISODate(24, 6, 2026)).toBe("2026-06-24");
    expect(buildISODate("4", "1", "2026")).toBe("2026-01-04");
  });

  it("rejects impossible months and days", () => {
    expect(buildISODate(45, 13, 2026)).toBeNull();
    expect(buildISODate(0, 6, 2026)).toBeNull();
    expect(buildISODate(31, 0, 2026)).toBeNull();
  });

  it("rejects out-of-range years and non-integers", () => {
    expect(buildISODate(1, 1, 1800)).toBeNull();
    expect(buildISODate(1, 1, 2200)).toBeNull();
    expect(buildISODate("x", 1, 2026)).toBeNull();
  });
});

describe("sil-actividad plenary date parsing (via exported dates helpers)", () => {
  it("parses an uppercase plenary header to ISO", () => {
    expect(parseSpanishDate("MIÉRCOLES 24 DE JUNIO DE 2026")).toBe("2026-06-24");
  });

  it("parses a lowercase Spanish date out of surrounding free text", () => {
    expect(parseSpanishDate("Sesión del 24 de junio de 2026, salón principal")).toBe("2026-06-24");
  });

  it("returns null when no Spanish date is present", () => {
    expect(parseSpanishDate("ORDEN DEL DÍA - sin fecha")).toBeNull();
  });
});
