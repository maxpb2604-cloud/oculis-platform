import { describe, expect, it } from "vitest";
import {
  boundedInteger,
  dateSpanDays,
  isISODate,
  isISOTimestamp,
  optionalText,
  parseLegislatorProfileId,
  positiveInteger,
  safeHttpUrl,
  safeOfficialUrl,
  senateRecordId,
} from "@/lib/input";

describe("input parsing", () => {
  it("bounds integer query parameters", () => {
    expect(boundedInteger("25", { fallback: 10, min: 1, max: 100 })).toBe(25);
    expect(boundedInteger("-4", { fallback: 10, min: 1, max: 100 })).toBe(10);
    expect(boundedInteger("Infinity", { fallback: 10, min: 1, max: 100 })).toBe(10);
    expect(boundedInteger("999", { fallback: 10, min: 1, max: 100 })).toBe(100);
  });

  it("accepts only safe positive identifiers", () => {
    expect(positiveInteger("42")).toBe(42);
    expect(positiveInteger("0")).toBeNull();
    expect(positiveInteger("1.2")).toBeNull();
    expect(positiveInteger("not-a-number")).toBeNull();
  });

  it("accepts only canonical legislator profile identifiers", () => {
    expect(parseLegislatorProfileId("42")).toBe(42);
    expect(parseLegislatorProfileId("0")).toBeNull();
    expect(parseLegislatorProfileId("042")).toBeNull();
    expect(parseLegislatorProfileId("42 ")).toBeNull();
    expect(parseLegislatorProfileId("")).toBeNull();
    expect(parseLegislatorProfileId("2147483648")).toBeNull();
  });

  it("accepts only numeric Senate IdExpediente values", () => {
    expect(senateRecordId("1234567890")).toBe("1234567890");
    expect(senateRecordId("12345678901")).toBeNull();
    expect(senateRecordId("05001-2026")).toBeNull();
    expect(senateRecordId(" 123 ")).toBeNull();
    expect(senateRecordId(null)).toBeNull();
  });

  it("validates real calendar dates and bounded timestamps", () => {
    expect(isISODate("2024-02-29")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-99-99")).toBe(false);
    expect(isISOTimestamp("2026-08-05T12:30:00Z")).toBe(true);
    expect(isISOTimestamp("yesterday")).toBe(false);
    expect(dateSpanDays("2026-08-01", "2026-08-05")).toBe(4);
  });

  it("trims and caps free-text parameters", () => {
    expect(optionalText("  presupuesto  ")).toBe("presupuesto");
    expect(optionalText("abcdef", 3)).toBe("abc");
    expect(optionalText("   ")).toBeUndefined();
  });

  it("allows HTTP(S) links and rejects executable or malformed schemes", () => {
    expect(safeHttpUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hello")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl("https://user:password@example.com/private")).toBeNull();
    expect(safeHttpUrl("http://localhost:3000/private")).toBeNull();
    expect(safeHttpUrl("http://127.0.0.1/private")).toBeNull();
  });

  it("allows official links only on the domains assigned to their source", () => {
    expect(
      safeOfficialUrl("https://www.diputadosrd.gob.do/sil/iniciativa/123", "sil-diputados"),
    ).toBe("https://www.diputadosrd.gob.do/sil/iniciativa/123");
    expect(
      safeOfficialUrl(
        "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?id=1",
        "sil-documents",
      ),
    ).not.toBeNull();
    expect(
      safeOfficialUrl("https://camaradediputados.gob.do.evil.test/file.pdf", "dip-oficial"),
    ).toBeNull();
    expect(safeOfficialUrl("https://example.com/file.pdf", "senado")).toBeNull();
    expect(safeOfficialUrl("https://www.senadord.gob.do/file.pdf", "unknown-source")).toBeNull();
  });
});
