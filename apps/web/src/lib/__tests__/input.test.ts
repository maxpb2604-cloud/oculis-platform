import { describe, expect, it } from "vitest";
import {
  boundedInteger,
  dateSpanDays,
  isISODate,
  isISOTimestamp,
  optionalText,
  positiveInteger,
  safeHttpUrl,
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
  });
});
