import { describe, expect, it, vi } from "vitest";
import { buildISODate, MONTHS_ES, spanishMonthToNum } from "../src/dates.js";
import { parseSpanishDate, SilActividadAdapter } from "../src/sil-actividad.js";

/**
 * The plenary order-of-the-day parser in sil-actividad.ts pulls the session date out of
 * free text like "...MIÉRCOLES 24 DE JUNIO DE 2026...". These tests exercise that public
 * parser directly as well as the shared validated date helpers it uses.
 */

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

  it("does not substitute an upload timestamp for an absent session date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          page: 1,
          pageSize: 10,
          total: 1,
          results: [
            {
              id: 99,
              documento: "ORDEN DEL DÍA SIN FECHA DE SESIÓN",
              descripcion: "Agenda publicada",
              cargado: "2026-08-05T18:30:00",
              tipoAgenda: 1,
            },
          ],
        }),
      ),
    );
    try {
      const result = await new SilActividadAdapter("https://official.test/api").plenaryOrders();
      expect(result.events[0]?.date).toBeNull();
      expect(
        (result.events[0]?.raw as { provenance?: { dateEvidence?: unknown } }).provenance,
      ).toHaveProperty("dateEvidence", null);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
