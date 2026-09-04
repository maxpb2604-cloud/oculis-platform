import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  monthBounds,
  normalizeCommissionName,
  shiftCalendarDate,
  shiftCalendarMonth,
  shiftCalendarView,
  weekBounds,
  weekDates,
} from "@/lib/commission-calendar";

describe("commission calendar", () => {
  it("builds a Monday-first, six-week grid without leaking adjacent-month dates", () => {
    const cells = buildMonthGrid("2026-09-03");

    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ iso: null, day: null });
    expect(cells[1]).toEqual({ iso: "2026-09-01", day: 1 });
    expect(cells[30]).toEqual({ iso: "2026-09-30", day: 30 });
    expect(cells[31]).toEqual({ iso: null, day: null });
  });

  it("calculates month limits, including leap years", () => {
    expect(monthBounds("2028-02-18")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("moves across year boundaries using the first day of the destination month", () => {
    expect(shiftCalendarMonth("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftCalendarMonth("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("builds Monday-first weeks across month and year boundaries", () => {
    expect(weekDates("2027-01-01")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(weekBounds("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("moves date, week, and month views by their natural interval", () => {
    expect(shiftCalendarDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftCalendarView("2026-09-03", "day", -1)).toBe("2026-09-02");
    expect(shiftCalendarView("2026-09-03", "week", 1)).toBe("2026-09-10");
    expect(shiftCalendarView("2026-09-03", "month", -1)).toBe("2026-08-01");
  });

  it("normalizes spelling while preserving whole-name matching", () => {
    expect(normalizeCommissionName("  Comisión de Ética, Cámara  ")).toBe(
      "comision de etica camara",
    );
    expect(normalizeCommissionName("Comisión de Ética")).not.toBe(
      normalizeCommissionName("Comisión de Ética y Disciplina"),
    );
  });
});
