import { describe, expect, it } from "vitest";
import {
  approvalProbability,
  approvalScore,
  riskLevel,
  score,
} from "../src/scoring.js";
import type {
  ApprovalProbability,
  PartyStrength,
  RiskLevel,
  SponsorTrackRecord,
} from "../src/types.js";

/**
 * Ground-truth matrix transcribed directly from
 * `Fórmulas Nivel de Riesgo y Probabilidad de Aprobación.xlsx`, rows 2–28.
 * Columns: Axis1 (party), Axis2 (sponsor), Axis3 (probability) -> Nivel de Riesgo.
 */
const EXPECTED: Array<[string, string, string, RiskLevel]> = [
  ["1A", "2A", "3A", "ALTO"],
  ["1A", "2B", "3A", "ALTO"],
  ["1A", "2C", "3A", "MEDIO"],
  ["1A", "2A", "3B", "ALTO"],
  ["1A", "2A", "3C", "MEDIO"],
  ["1A", "2B", "3B", "MEDIO"],
  ["1A", "2B", "3C", "MEDIO"],
  ["1A", "2C", "3B", "MEDIO"],
  ["1A", "2C", "3C", "BAJO"],
  ["1B", "2A", "3A", "ALTO"],
  ["1B", "2A", "3B", "ALTO"],
  ["1B", "2A", "3C", "MEDIO"],
  ["1B", "2B", "3A", "ALTO"],
  ["1B", "2B", "3B", "MEDIO"],
  ["1B", "2B", "3C", "MEDIO"],
  ["1B", "2C", "3A", "MEDIO"],
  ["1B", "2C", "3B", "MEDIO"],
  ["1B", "2C", "3C", "BAJO"],
  ["1C", "2A", "3A", "MEDIO"],
  ["1C", "2A", "3B", "MEDIO"],
  ["1C", "2A", "3C", "BAJO"],
  ["1C", "2B", "3A", "MEDIO"],
  ["1C", "2B", "3B", "BAJO"],
  ["1C", "2B", "3C", "BAJO"],
  ["1C", "2C", "3A", "MEDIO"],
  ["1C", "2C", "3B", "BAJO"],
  ["1C", "2C", "3C", "BAJO"],
];

const PARTY: Record<string, PartyStrength> = {
  "1A": "GOBIERNO",
  "1B": "OPOSICION_TERCIO",
  "1C": "OPOSICION_MENOR",
};
const SPONSOR: Record<string, SponsorTrackRecord> = {
  "2A": "MAS_DE_2",
  "2B": "UNO",
  "2C": "MENOS_DE_1",
};
const PROB: Record<string, ApprovalProbability> = {
  "3A": "ALTA",
  "3B": "MEDIA",
  "3C": "BAJA",
};

describe("riskLevel — parity with rubric workbook", () => {
  it("covers all 27 scenarios", () => {
    expect(EXPECTED).toHaveLength(27);
  });

  for (const [a1, a2, a3, expected] of EXPECTED) {
    it(`${a1} ${a2} ${a3} -> ${expected}`, () => {
      expect(riskLevel(PARTY[a1]!, SPONSOR[a2]!, PROB[a3]!)).toBe(expected);
    });
  }
});

describe("approvalProbability buckets", () => {
  it("< 6 -> BAJA", () => {
    expect(approvalProbability(5)).toBe("BAJA");
  });
  it("6 and 10 -> MEDIA (inclusive)", () => {
    expect(approvalProbability(6)).toBe("MEDIA");
    expect(approvalProbability(10)).toBe("MEDIA");
  });
  it("> 10 -> ALTA", () => {
    expect(approvalProbability(11)).toBe("ALTA");
  });
});

describe("approvalScore — weighted sum of five inputs", () => {
  it("minimum (all lowest) = 5", () => {
    expect(
      approvalScore({
        party: "OPOSICION_MENOR",
        sponsorRecord: "MENOS_DE_1",
        executiveSupport: "NO",
        stakeholderSupport: "NO",
        socialPressureCount: 0,
      }),
    ).toBe(5);
  });

  it("maximum (all highest) = 14", () => {
    expect(
      approvalScore({
        party: "GOBIERNO",
        sponsorRecord: "MAS_DE_2",
        executiveSupport: "SI",
        stakeholderSupport: "SI",
        socialPressureCount: 20,
      }),
    ).toBe(14);
  });
});

describe("score — end to end", () => {
  it("ruling-party, strong sponsor, high support -> ALTA prob, ALTO risk", () => {
    const r = score({
      party: "GOBIERNO",
      sponsorRecord: "MAS_DE_2",
      executiveSupport: "SI",
      stakeholderSupport: "SI",
      socialPressureCount: 12,
    });
    expect(r.approvalScore).toBe(14);
    expect(r.approvalProbability).toBe("ALTA");
    expect(r.riskLevel).toBe("ALTO"); // 1A-2A-3A
  });

  it("weak opposition, no track record, no support -> BAJA prob, BAJO risk", () => {
    const r = score({
      party: "OPOSICION_MENOR",
      sponsorRecord: "MENOS_DE_1",
      executiveSupport: "NO",
      stakeholderSupport: "NO",
      socialPressureCount: 1,
    });
    expect(r.approvalProbability).toBe("BAJA");
    expect(r.riskLevel).toBe("BAJO"); // 1C-2C-3C
  });
});
