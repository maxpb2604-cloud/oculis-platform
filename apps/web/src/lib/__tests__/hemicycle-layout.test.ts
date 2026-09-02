import { describe, expect, it } from "vitest";
import { createHemicycleLayout } from "@/lib/hemicycle-layout";

const countByGroup = (seats: ReturnType<typeof createHemicycleLayout>["seats"]) => {
  const counts = new Map<string, number>();
  for (const seat of seats) counts.set(seat.groupKey, (counts.get(seat.groupKey) ?? 0) + 1);
  return Object.fromEntries(counts);
};

describe("createHemicycleLayout", () => {
  it("returns a neutral empty layout when there are no seats", () => {
    expect(createHemicycleLayout([])).toEqual({
      seatCount: 0,
      rowCount: 0,
      rows: [],
      seats: [],
    });
  });

  it("preserves every Senate group count across concentric rows", () => {
    const groups = [
      { key: "PRM", count: 19 },
      { key: "FP", count: 9 },
      { key: "PLD", count: 3 },
      { key: "PRSC", count: 1 },
    ] as const;
    const layout = createHemicycleLayout(groups);

    expect(layout.seatCount).toBe(32);
    expect(layout.rowCount).toBe(4);
    expect(layout.rows.map((row) => row.seatCount)).toEqual([5, 7, 9, 11]);
    expect(layout.rows.reduce((sum, row) => sum + row.seatCount, 0)).toBe(32);
    expect(countByGroup(layout.seats)).toEqual({ PRM: 19, FP: 9, PLD: 3, PRSC: 1 });
  });

  it("supports a 190-seat chamber without count drift or duplicate positions", () => {
    const groups = [
      { key: "PRM", count: 146 },
      { key: "FP", count: 28 },
      { key: "PLD", count: 13 },
      { key: "PRD", count: 1 },
      { key: "PQDC", count: 1 },
      { key: "DXC", count: 1 },
    ] as const;
    const layout = createHemicycleLayout(groups);
    const coordinates = new Set(layout.seats.map((seat) => `${seat.x}:${seat.y}`));

    expect(layout.seatCount).toBe(190);
    expect(layout.rowCount).toBe(9);
    expect(layout.rows.reduce((sum, row) => sum + row.seatCount, 0)).toBe(190);
    expect(countByGroup(layout.seats)).toEqual({
      PRM: 146,
      FP: 28,
      PLD: 13,
      PRD: 1,
      PQDC: 1,
      DXC: 1,
    });
    expect(coordinates.size).toBe(190);
  });

  it("keeps every coordinate finite and normalized for a chart renderer", () => {
    const layout = createHemicycleLayout([
      { key: "majority", count: 124 },
      { key: "minority", count: 66 },
    ]);

    for (const seat of layout.seats) {
      expect(Number.isFinite(seat.x)).toBe(true);
      expect(Number.isFinite(seat.y)).toBe(true);
      expect(seat.x).toBeGreaterThanOrEqual(0);
      expect(seat.x).toBeLessThanOrEqual(1);
      expect(seat.y).toBeGreaterThanOrEqual(0);
      expect(seat.y).toBeLessThanOrEqual(1);
      expect(seat.angle).toBeGreaterThan(0);
      expect(seat.angle).toBeLessThan(Math.PI);
    }
  });

  it("assigns contiguous sectors in the exact group order supplied by the caller", () => {
    const layout = createHemicycleLayout([
      { key: "left", count: 3 },
      { key: "center", count: 2 },
      { key: "right", count: 4 },
    ] as const);

    expect(layout.seats.map((seat) => seat.groupKey)).toEqual([
      "left",
      "left",
      "left",
      "center",
      "center",
      "right",
      "right",
      "right",
      "right",
    ]);
    expect(layout.seats.map((seat) => seat.visualIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(layout.seats.map((seat) => seat.angle)).toEqual(
      [...layout.seats.map((seat) => seat.angle)].sort((left, right) => right - left),
    );
  });

  it("is deterministic and retains zero-count groups without inventing seats", () => {
    const groups = [
      { key: "reported", count: 7 },
      { key: "zero", count: 0 },
      { key: "missing", count: 2 },
    ] as const;

    expect(createHemicycleLayout(groups)).toEqual(createHemicycleLayout(groups));
    expect(countByGroup(createHemicycleLayout(groups).seats)).toEqual({
      reported: 7,
      missing: 2,
    });
  });

  it("fails explicitly rather than altering invalid source counts or ambiguous keys", () => {
    expect(() => createHemicycleLayout([{ key: "PRM", count: 2.5 }])).toThrow(RangeError);
    expect(() => createHemicycleLayout([{ key: "PRM", count: -1 }])).toThrow(RangeError);
    expect(() => createHemicycleLayout([{ key: "", count: 1 }])).toThrow(TypeError);
    expect(() =>
      createHemicycleLayout([
        { key: "PRM", count: 1 },
        { key: "PRM", count: 2 },
      ]),
    ).toThrow(TypeError);
  });
});
