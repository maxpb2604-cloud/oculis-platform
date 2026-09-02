import { describe, expect, it } from "vitest";
import {
  groupCongressMembersByParty,
  normalizeInitiativeComposition,
} from "@/lib/province-composition";

describe("normalizeInitiativeComposition", () => {
  it("splits a normal total into active and remaining initiatives", () => {
    expect(normalizeInitiativeComposition({ total: 502, active: 208 })).toEqual({
      total: 502,
      active: 208,
      remaining: 294,
      isConsistent: true,
    });
  });

  it("returns a neutral zero composition when there are no initiatives", () => {
    expect(normalizeInitiativeComposition({ total: 0, active: 0 })).toEqual({
      total: 0,
      active: 0,
      remaining: 0,
      isConsistent: true,
    });
  });

  it("normalizes defensive inputs and fails closed when active exceeds total", () => {
    expect(normalizeInitiativeComposition({ total: 12.9, active: 40 })).toEqual({
      total: 12,
      active: 40,
      remaining: 0,
      isConsistent: false,
    });
    expect(normalizeInitiativeComposition({ total: -8, active: 4 })).toEqual({
      total: 0,
      active: 4,
      remaining: 0,
      isConsistent: false,
    });
    expect(
      normalizeInitiativeComposition({ total: Number.NaN, active: Number.POSITIVE_INFINITY }),
    ).toEqual({ total: 0, active: 0, remaining: 0, isConsistent: true });
  });
});

describe("groupCongressMembersByParty", () => {
  it("trims exact duplicate labels and counts every member", () => {
    expect(groupCongressMembersByParty(["PRM", " PRM ", "FP", "PRM"])).toEqual({
      groups: [
        { label: "PRM", count: 3, isMissing: false },
        { label: "FP", count: 1, isMissing: false },
      ],
      total: 4,
    });
  });

  it("groups blank and nullish values as missing information", () => {
    expect(groupCongressMembersByParty(["", "   ", null, undefined, "PRM"])).toEqual({
      groups: [
        { label: "PRM", count: 1, isMissing: false },
        { label: "No informado", count: 4, isMissing: true },
      ],
      total: 5,
    });
  });

  it("uses the localized missing-party label supplied by the presentation layer", () => {
    expect(groupCongressMembersByParty([null, "PRM"], "Party not reported")).toEqual({
      groups: [
        { label: "PRM", count: 1, isMissing: false },
        { label: "Party not reported", count: 1, isMissing: true },
      ],
      total: 2,
    });
  });

  it("merges casing, official names, and source aliases into the canonical acronym", () => {
    expect(
      groupCongressMembersByParty([
        "PRM",
        "prm",
        "Partido Revolucionario Moderno",
        "FP",
        "Partido Fuerza del Pueblo",
      ]),
    ).toEqual({
      groups: [
        { label: "PRM", count: 3, isMissing: false },
        { label: "FP", count: 2, isMissing: false },
      ],
      total: 5,
    });
  });

  it("sorts by count then label while keeping the missing bucket last", () => {
    expect(
      groupCongressMembersByParty(["Zeta", "Beta", "Alpha", "Beta", "Zeta", null, "", undefined]),
    ).toEqual({
      groups: [
        { label: "BETA", count: 2, isMissing: false },
        { label: "ZETA", count: 2, isMissing: false },
        { label: "ALPHA", count: 1, isMissing: false },
        { label: "No informado", count: 3, isMissing: true },
      ],
      total: 8,
    });
  });

  it("returns an empty composition for an empty readonly collection", () => {
    const parties = [] as const;

    expect(groupCongressMembersByParty(parties)).toEqual({ groups: [], total: 0 });
  });
});
