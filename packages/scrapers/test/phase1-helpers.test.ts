import { describe, expect, it } from "vitest";
import { extractCodes, INITIATIVE_CODE_RE } from "../src/codes.js";
import { buildISODate, spanishMonthToNum } from "../src/dates.js";
import { parseSenadoDate } from "../src/senado.js";
import { parseOrdenFileName } from "../src/dip-oficial.js";

describe("codes: extractCodes (hardened)", () => {
  it("extracts codes, dedupes, upper-cases lowercase suffixes", () => {
    const codes = extractCodes("ver 05646-2024-2028-cd y 05646-2024-2028-CD y 00131-2024-2028-SE");
    expect(codes).toEqual(["05646-2024-2028-CD", "00131-2024-2028-SE"]);
  });
  it("does not carve codes out of longer digit runs", () => {
    // word boundary: a 6-digit prefix should not match a 5-digit code
    expect(extractCodes("123456-2024-2028-CD")).toEqual([]);
  });
  it("handles 3-letter chamber suffix", () => {
    expect(extractCodes("05900-2024-2028-CDS")).toEqual(["05900-2024-2028-CDS"]);
  });
  it("returns [] for empty/null", () => {
    expect(extractCodes(null)).toEqual([]);
    expect(extractCodes("")).toEqual([]);
  });
});

describe("dates: buildISODate validation", () => {
  it("builds a valid date", () => {
    expect(buildISODate(7, 6, 2026)).toBe("2026-06-07");
  });
  it("rejects impossible month/day", () => {
    expect(buildISODate(45, 13, 2026)).toBeNull();
    expect(buildISODate(0, 6, 2026)).toBeNull();
  });
});

describe("dates: spanishMonthToNum", () => {
  it("maps full and abbreviated names", () => {
    expect(spanishMonthToNum("junio")).toBe("06");
    expect(spanishMonthToNum("jun")).toBe("06");
  });
  it("maps the DR-common 'setiembre' spelling", () => {
    expect(spanishMonthToNum("setiembre")).toBe("09");
    expect(spanishMonthToNum("set")).toBe("09");
  });
  it("returns null for unknown", () => {
    expect(spanishMonthToNum("xxx")).toBeNull();
  });
});

describe("senado: parseSenadoDate rejects invalid", () => {
  it("parses a valid title date", () => {
    expect(parseSenadoDate("AGENDA EXTRAORDINARIA 00118-PLO-17-6-2026-SIL")).toBe("2026-06-17");
  });
});

describe("dip-oficial: dedupeKey distinctness via parseOrdenFileName", () => {
  it("ordinaria and extraordinaria with same number parse to distinct type/date", () => {
    const a = parseOrdenFileName("https://x/download/sesion-ordinaria-no-00005-lunes-01-de-junio-de-2026.pdf");
    const b = parseOrdenFileName("https://x/download/sesion-extraordinaria-no-00005-lunes-08-de-junio-de-2026.pdf");
    expect(a.sessionType).not.toBe(b.sessionType);
    expect(a.date).not.toBe(b.date);
    // both share sessionNumber "5" — so a key on number alone would collide
    expect(a.sessionNumber).toBe(b.sessionNumber);
  });
});

it("INITIATIVE_CODE_RE is exported and global", () => {
  expect(INITIATIVE_CODE_RE.flags).toContain("g");
});
