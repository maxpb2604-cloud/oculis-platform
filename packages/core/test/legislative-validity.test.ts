import { describe, expect, it } from "vitest";
import {
  classifyLegislativeValidity,
  ordinaryLegislatureForDate,
  secondLegislatureClosingDate,
} from "../src/legislative-validity.js";

describe("classifyLegislativeValidity", () => {
  const asOf = "2026-09-07";

  it("keeps filings from the current and immediately preceding legislature vigente", () => {
    expect(
      classifyLegislativeValidity(
        { filedAt: "2026-03-10", legislature: "2026-PLO", status: "Depositado" },
        asOf,
      ),
    ).toMatchObject({
      state: "VIGENTE",
      basis: "CALCULATED",
      expiresAt: "2027-01-12",
      startLegislature: "2026-PLO",
      endLegislature: "2026-SLO",
    });
    expect(
      classifyLegislativeValidity({ filedAt: "2026-08-20", legislature: "2026-SLO" }, asOf).state,
    ).toBe("VIGENTE");
  });

  it("marks an older filing no vigente after the second legislature closes", () => {
    expect(
      classifyLegislativeValidity(
        { filedAt: "2025-09-01", legislature: "2025-SLO", condition: "VIGENTE" },
        asOf,
      ),
    ).toMatchObject({
      state: "NO_VIGENTE",
      basis: "CALCULATED",
      expiresAt: "2026-07-26",
    });
  });

  it("lets an official peremption or terminal status take precedence", () => {
    expect(
      classifyLegislativeValidity({ filedAt: "2026-08-20", condition: "Perimida" }, asOf).state,
    ).toBe("NO_VIGENTE");
    expect(
      classifyLegislativeValidity({ filedAt: "2026-08-20", status: "Promulgada" }, asOf).state,
    ).toBe("CONCLUIDA");
    expect(
      classifyLegislativeValidity(
        { filedAt: "2026-08-20", status: "Promulgada mediante la Ley núm. 1-26" },
        asOf,
      ).state,
    ).toBe("CONCLUIDA");
  });

  it("uses the reintroduced filing as a new two-legislature lifecycle", () => {
    const former = classifyLegislativeValidity(
      { filedAt: "2025-03-10", condition: "Perimida" },
      asOf,
    );
    const reintroduced = classifyLegislativeValidity(
      { filedAt: "2026-08-20", status: "Reintroducida" },
      asOf,
    );
    expect(former.state).toBe("NO_VIGENTE");
    expect(reintroduced.state).toBe("VIGENTE");
  });

  it("fails closed when filing date and official filing legislature conflict", () => {
    expect(
      classifyLegislativeValidity({ filedAt: "2026-09-01", legislature: "2026-PLO" }, asOf),
    ).toMatchObject({ state: "POR_CONFIRMAR", reason: "CONFLICTING_FILING_EVIDENCE" });
  });

  it("does not treat the source word VIGENTE as a substitute for filing evidence", () => {
    expect(classifyLegislativeValidity({ condition: "VIGENTE" }, asOf)).toMatchObject({
      state: "POR_CONFIRMAR",
      reason: "MISSING_FILING_LEGISLATURE",
    });
  });
});

describe("ordinary legislature calendar", () => {
  it("keeps recess dates unresolved and handles the second closing date", () => {
    expect(ordinaryLegislatureForDate("2026-08-01")).toBeNull();
    expect(secondLegislatureClosingDate({ year: 2026, term: "SLO" })).toEqual({
      date: "2027-07-26",
      endLegislature: "2027-PLO",
    });
  });
});
