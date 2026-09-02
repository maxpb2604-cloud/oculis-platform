import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { adaptHomeChamberComposition } from "@/lib/data";

describe("HOME chamber composition adapter", () => {
  it("canonicalizes aliases, merges them per chamber, and preserves missing data", () => {
    const chambers = adaptHomeChamberComposition([
      {
        chamber: "DIPUTADOS",
        partyShort: "PRM",
        partyFullName: "Partido Revolucionario Moderno",
        count: 2,
      },
      {
        chamber: "DIPUTADOS",
        partyShort: null,
        partyFullName: "Partido Revolucionario Moderno",
        count: 3,
      },
      {
        chamber: "DIPUTADOS",
        partyShort: "fp",
        partyFullName: "Partido Fuerza del Pueblo",
        count: 1,
      },
      {
        chamber: "DIPUTADOS",
        partyShort: null,
        partyFullName: null,
        count: 4,
      },
      {
        chamber: "SENADO",
        partyShort: "PLD",
        partyFullName: null,
        count: 2,
      },
    ]);

    expect(chambers).toEqual([
      {
        chamber: "DIPUTADOS",
        groups: [
          {
            acronym: "PRM",
            fullName: "Partido Revolucionario Moderno",
            isMissing: false,
            count: 5,
          },
          {
            acronym: "FP",
            fullName: "Fuerza del Pueblo",
            isMissing: false,
            count: 1,
          },
          { acronym: null, fullName: null, isMissing: true, count: 4 },
        ],
        observedTotal: 10,
        reportedTotal: 6,
        unreportedTotal: 4,
      },
      {
        chamber: "SENADO",
        groups: [
          {
            acronym: "PLD",
            fullName: "Partido de la Liberación Dominicana",
            isMissing: false,
            count: 2,
          },
        ],
        observedTotal: 2,
        reportedTotal: 2,
        unreportedTotal: 0,
      },
    ]);
    expect(chambers[0]!.groups.reduce((sum, group) => sum + group.count, 0)).toBe(
      chambers[0]!.observedTotal,
    );
    expect(chambers[0]!.groups.find((group) => group.isMissing)?.count).toBe(
      chambers[0]!.unreportedTotal,
    );
  });

  it("always returns both chambers with zero totals when the roster aggregate is empty", () => {
    expect(adaptHomeChamberComposition([])).toEqual([
      {
        chamber: "DIPUTADOS",
        groups: [],
        observedTotal: 0,
        reportedTotal: 0,
        unreportedTotal: 0,
      },
      {
        chamber: "SENADO",
        groups: [],
        observedTotal: 0,
        reportedTotal: 0,
        unreportedTotal: 0,
      },
    ]);
  });

  it("keeps unknown published parties distinct without manufacturing full names", () => {
    expect(
      adaptHomeChamberComposition([
        {
          chamber: "SENADO",
          partyShort: "XYZ",
          partyFullName: null,
          count: 1,
        },
        {
          chamber: "SENADO",
          partyShort: null,
          partyFullName: "Partido de Fuente",
          count: 2,
        },
      ])[1],
    ).toEqual({
      chamber: "SENADO",
      groups: [
        {
          acronym: null,
          fullName: "Partido de Fuente",
          isMissing: false,
          count: 2,
        },
        { acronym: "XYZ", fullName: null, isMissing: false, count: 1 },
      ],
      observedTotal: 3,
      reportedTotal: 3,
      unreportedTotal: 0,
    });
  });
});
