import { describe, expect, it } from "vitest";
import {
  formatCommissionDayNumber,
  formatCommissionLongDate,
  formatCommissionMonth,
  formatCommissionWeek,
  formatCommissionWeekday,
} from "@/lib/commission-calendar-labels";

describe("commission calendar labels", () => {
  it("formats Spanish calendar labels without runtime locale data", () => {
    expect(formatCommissionLongDate("2026-09-04", "es")).toBe("Viernes, 4 de septiembre de 2026");
    expect(formatCommissionMonth("2026-09-04", "es")).toBe("Septiembre de 2026");
    expect(formatCommissionWeekday("2026-09-04", "es")).toBe("Viernes");
    expect(formatCommissionDayNumber("2026-09-04", "es")).toBe("4 sept");
    expect(
      formatCommissionWeek(
        [
          "2026-08-31",
          "2026-09-01",
          "2026-09-02",
          "2026-09-03",
          "2026-09-04",
          "2026-09-05",
          "2026-09-06",
        ],
        "es",
      ),
    ).toBe("Semana del 31 ago – 6 sept de 2026");
  });

  it("formats English calendar labels deterministically", () => {
    expect(formatCommissionLongDate("2026-09-04", "en")).toBe("Friday, September 4, 2026");
    expect(formatCommissionMonth("2026-09-04", "en")).toBe("September 2026");
    expect(formatCommissionWeekday("2026-09-04", "en")).toBe("Friday");
    expect(formatCommissionDayNumber("2026-09-04", "en")).toBe("Sep 4");
  });
});
