import { describe, expect, it } from "vitest";
import { extractCodes, INITIATIVE_CODE_RE } from "../src/codes.js";
import { buildISODate, extractLeadingISODate, spanishMonthToNum } from "../src/dates.js";
import { parseSenadoDate, parseSenateCommitteeAgenda, SenadoAdapter } from "../src/senado.js";
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
  it("extracts complete Senate codes", () => {
    expect(extractCodes("Expediente 01677-2026-plo-se y 01677-2026-PLO-SE")).toEqual([
      "01677-2026-PLO-SE",
    ]);
  });
  it("does not treat a bare Senate expediente number as a complete initiative code", () => {
    expect(extractCodes("Expediente No. 12345")).toEqual([]);
  });
  it("returns [] for empty/null", () => {
    expect(extractCodes(null)).toEqual([]);
    expect(extractCodes("")).toEqual([]);
  });
});

describe("senado: committee references", () => {
  it("preserves bare expediente numbers only as provenance and links complete codes", () => {
    const [entry] = parseSenateCommitteeAgenda(
      `● Lunes 3 de agosto:
       ➢ COMISIÓN PERMANENTE DE JUSTICIA:
       HORA: 10:00 A.M.
       ASUNTO: Estudio del Expediente No. 12345 y la iniciativa 01677-2026-PLO-SE.
       LUGAR: Salón de comisiones`,
      "2026",
    );
    expect(entry?.expedientes).toEqual(["12345"]);
    expect(entry?.initiativeCodes).toEqual(["01677-2026-PLO-SE"]);
  });

  it("reports the exact PDF coverage gap when PDF parsing is disabled", async () => {
    class EmptySenadoAdapter extends SenadoAdapter {
      override async filesInCategory(): Promise<[]> {
        return [];
      }
    }
    const result = await new EmptySenadoAdapter().collect({ parsePdfs: false });
    expect(result.gaps).toContain(
      "Senado · parsePdfs=false: los PDF de Pleno/Asamblea no se leyeron; initiativeCodes y statuses quedan vacíos para esos documentos.",
    );
  });
});

describe("dates: buildISODate validation", () => {
  it("builds a valid date", () => {
    expect(buildISODate(7, 6, 2026)).toBe("2026-06-07");
  });
  it("rejects impossible month/day", () => {
    expect(buildISODate(45, 13, 2026)).toBeNull();
    expect(buildISODate(0, 6, 2026)).toBeNull();
    expect(buildISODate(31, 2, 2026)).toBeNull();
  });
});

describe("dates: extractLeadingISODate", () => {
  it("accepts an exact date or timestamp prefix", () => {
    expect(extractLeadingISODate("2026-08-05")).toBe("2026-08-05");
    expect(extractLeadingISODate("2026-08-05T12:30:00Z")).toBe("2026-08-05");
  });

  it("rejects non-ISO text, arbitrary suffixes and impossible dates", () => {
    expect(extractLeadingISODate("05/08/2026")).toBeNull();
    expect(extractLeadingISODate("2026-08-05garbage")).toBeNull();
    expect(extractLeadingISODate("2026-02-31T00:00:00Z")).toBeNull();
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
    const a = parseOrdenFileName(
      "https://x/download/sesion-ordinaria-no-00005-lunes-01-de-junio-de-2026.pdf",
    );
    const b = parseOrdenFileName(
      "https://x/download/sesion-extraordinaria-no-00005-lunes-08-de-junio-de-2026.pdf",
    );
    expect(a.sessionType).not.toBe(b.sessionType);
    expect(a.date).not.toBe(b.date);
    // both share sessionNumber "5" — so a key on number alone would collide
    expect(a.sessionNumber).toBe(b.sessionNumber);
  });
});

it("INITIATIVE_CODE_RE is exported and global", () => {
  expect(INITIATIVE_CODE_RE.flags).toContain("g");
});
