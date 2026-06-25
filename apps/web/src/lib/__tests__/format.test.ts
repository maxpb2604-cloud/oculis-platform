import { describe, expect, it } from "vitest";
import { formatISODate, formatISODayMonth } from "@/lib/format";

describe("formatISODate", () => {
  it("returns the em-dash sentinel for nullish/empty input", () => {
    expect(formatISODate(null, "es")).toBe("—");
    expect(formatISODate(undefined, "es")).toBe("—");
    expect(formatISODate("", "en")).toBe("—");
  });

  it("formats an ISO date with the default dd/mm/yyyy numeric options", () => {
    // Default opts: { day: "2-digit", month: "2-digit", year: "numeric" }.
    // es-DO and en-US both render numeric dates as mm/dd/yyyy or dd/mm/yyyy; assert on
    // the digit content rather than separator ordering to stay locale-data robust.
    const es = formatISODate("2026-06-24", "es");
    expect(es).toMatch(/24/);
    expect(es).toMatch(/06/);
    expect(es).toMatch(/2026/);
  });

  it("accepts a full ISO timestamp and uses only the date portion", () => {
    const out = formatISODate("2026-06-24T18:30:00.000Z", "en");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/24/);
  });

  it("is anchored at noon so the day does not shift across timezones", () => {
    // A bare date is read as local noon, so the rendered day is always the input day.
    expect(formatISODate("2026-01-01", "en")).toMatch(/01/);
    expect(formatISODate("2026-12-31", "en")).toMatch(/31/);
  });

  it("returns the raw input when it is not a parseable date", () => {
    expect(formatISODate("not-a-date", "es")).toBe("not-a-date");
  });

  it("honors custom Intl options", () => {
    const out = formatISODate("2026-06-24", "en", { year: "numeric", month: "long" });
    expect(out).toMatch(/June/);
    expect(out).toMatch(/2026/);
  });
});

describe("formatISODayMonth", () => {
  it("returns an empty string for nullish input", () => {
    expect(formatISODayMonth(null, "es")).toBe("");
    expect(formatISODayMonth(undefined, "en")).toBe("");
  });

  it("renders a compact day/month stamp without the year", () => {
    // The day/month separator and month zero-padding vary by locale/ICU build, so assert
    // the contract: the day is present, the month number appears, and the year is absent.
    const out = formatISODayMonth("2026-06-24", "es");
    expect(out).toMatch(/24/);
    expect(out).toMatch(/6/); // month 06 (may render as "6" in some locale data)
    expect(out).not.toMatch(/2026/);
  });
});
