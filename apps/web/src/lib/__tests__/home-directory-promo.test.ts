import { describe, expect, it } from "vitest";
import {
  HOME_DIRECTORY_PORTRAIT_COUNT,
  selectDiverseDirectoryPortraits,
  selectHomeDirectoryPortraits,
} from "../home-directory-promo";

const candidates = [
  { profileId: 1, fullName: "Ana A", party: "PRM", province: "Azua" },
  { profileId: 2, fullName: "Berta B", party: "PRM", province: "Azua" },
  { profileId: 3, fullName: "Carlos C", party: "FP", province: "Duarte" },
  { profileId: 4, fullName: "Diana D", party: "PLD", province: "Santiago" },
  { profileId: 5, fullName: "Elena E", party: null, province: null },
] as const;

const variedCandidates = Array.from({ length: 18 }, (_, index) => ({
  profileId: index + 1,
  fullName: `Persona ${String(index + 1).padStart(2, "0")}`,
  party: ["PRM", "FP", "PLD", "PRSC", "PRD", "OD"][index % 6]!,
  province: ["Azua", "Duarte", "Santiago", "Samaná", "Peravia", "La Vega"][index % 6]!,
}));

const deputyCandidates = Array.from({ length: 20 }, (_, index) => ({
  profileId: index + 1,
  fullName: `Diputado ${String(index + 1).padStart(2, "0")}`,
  party: ["PRM", "FP", "PLD", "PRSC"][index % 4]!,
  province: ["Azua", "Duarte", "Santiago", "Peravia"][index % 4]!,
  chamber: "DIPUTADOS" as const,
}));

const senateCandidates = Array.from({ length: 10 }, (_, index) => ({
  profileId: index + 101,
  fullName: `Senador ${String(index + 1).padStart(2, "0")}`,
  party: ["PRM", "FP", "PRSC"][index % 3]!,
  province: ["Samaná", "La Vega", "Barahona"][index % 3]!,
  chamber: "SENADO" as const,
}));

describe("HOME directory portrait selection", () => {
  it("prefers distinct published parties and provinces without changing the source rows", () => {
    const before = structuredClone(candidates);
    const selected = selectDiverseDirectoryPortraits(candidates, 3);

    expect(selected.map((row) => row.profileId)).toEqual([1, 3, 4]);
    expect(candidates).toEqual(before);
  });

  it("deduplicates exact profile ids and is deterministic", () => {
    const withDuplicate = [...candidates, { ...candidates[0], fullName: "Replacement" }];

    expect(selectDiverseDirectoryPortraits(withDuplicate, 5)).toEqual(
      selectDiverseDirectoryPortraits(withDuplicate, 5),
    );
    expect(
      new Set(selectDiverseDirectoryPortraits(withDuplicate, 5).map((row) => row.profileId)).size,
    ).toBe(5);
  });

  it("uses a server seed to vary the preview while remaining deterministic", () => {
    const first = selectDiverseDirectoryPortraits(variedCandidates, 5, "request-alpha");
    const repeated = selectDiverseDirectoryPortraits(variedCandidates, 5, "request-alpha");
    const refreshed = selectDiverseDirectoryPortraits(variedCandidates, 5, "request-beta");

    expect(repeated).toEqual(first);
    expect(refreshed.map((row) => row.profileId)).not.toEqual(first.map((row) => row.profileId));
    expect(new Set(first.map((row) => row.profileId)).size).toBe(5);
    expect(new Set(refreshed.map((row) => row.profileId)).size).toBe(5);
  });

  it("normalizes invalid and oversized limits without inventing candidates", () => {
    expect(selectDiverseDirectoryPortraits(candidates, Number.NaN)).toEqual([]);
    expect(selectDiverseDirectoryPortraits(candidates, -2)).toEqual([]);
    expect(selectDiverseDirectoryPortraits(candidates, 99)).toHaveLength(candidates.length);
  });

  it("builds thirteen distinct portraits with a neutral seven-to-six chamber balance", () => {
    const selected = selectHomeDirectoryPortraits(
      deputyCandidates,
      senateCandidates,
      "home-request",
    );

    expect(selected).toHaveLength(HOME_DIRECTORY_PORTRAIT_COUNT);
    expect(new Set(selected.map((row) => row.profileId)).size).toBe(HOME_DIRECTORY_PORTRAIT_COUNT);
    expect(selected.filter((row) => row.chamber === "DIPUTADOS")).toHaveLength(7);
    expect(selected.filter((row) => row.chamber === "SENADO")).toHaveLength(6);
  });

  it("varies the thirteen-face preview by request seed without a hydration reshuffle", () => {
    const first = selectHomeDirectoryPortraits(deputyCandidates, senateCandidates, "request-a");
    const repeated = selectHomeDirectoryPortraits(deputyCandidates, senateCandidates, "request-a");
    const refreshed = selectHomeDirectoryPortraits(deputyCandidates, senateCandidates, "request-b");

    expect(repeated).toEqual(first);
    expect(refreshed.map((row) => row.profileId)).not.toEqual(first.map((row) => row.profileId));
  });

  it("fills a sparse chamber from unused exact profiles without duplicates", () => {
    const selected = selectHomeDirectoryPortraits(
      deputyCandidates,
      senateCandidates.slice(0, 2),
      "sparse-senate",
    );

    expect(selected).toHaveLength(HOME_DIRECTORY_PORTRAIT_COUNT);
    expect(selected.filter((row) => row.chamber === "SENADO")).toHaveLength(2);
    expect(new Set(selected.map((row) => row.profileId)).size).toBe(HOME_DIRECTORY_PORTRAIT_COUNT);
  });
});
