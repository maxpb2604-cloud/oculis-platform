/**
 * Pure geometry for a parliamentary hemicycle.
 *
 * Coordinates are normalized to a 2:1 chart viewport: callers can multiply
 * `x` by the rendered width and `y` by the rendered height. Party order is
 * deliberately supplied by the caller so this helper never invents a
 * left/right political ordering.
 */

export interface HemicycleGroupInput<GroupKey extends string = string> {
  key: GroupKey;
  count: number;
}

export interface HemicycleRow {
  /** Zero-based, from the innermost row to the outermost row. */
  index: number;
  seatCount: number;
  /** Normalized distance from the center relative to the outer row. */
  radialFraction: number;
}

export interface HemicycleSeat<GroupKey extends string = string> {
  groupKey: GroupKey;
  /** Zero-based group position in the caller-supplied order. */
  groupIndex: number;
  /** Zero-based position within this party/group. */
  groupSeatIndex: number;
  /** Zero-based left-to-right order across the complete hemicycle. */
  visualIndex: number;
  /** Zero-based, from the innermost row to the outermost row. */
  rowIndex: number;
  /** Zero-based position within its row, from left to right. */
  rowSeatIndex: number;
  rowSeatCount: number;
  /** Normalized horizontal coordinate in the inclusive 0–1 range. */
  x: number;
  /** Normalized vertical coordinate in the inclusive 0–1 range. */
  y: number;
  /** Polar angle in radians, useful for deterministic ordering and motion. */
  angle: number;
  radialFraction: number;
}

export interface HemicycleLayout<GroupKey extends string = string> {
  seatCount: number;
  rowCount: number;
  rows: HemicycleRow[];
  seats: HemicycleSeat<GroupKey>[];
}

interface SeatSlot {
  rowIndex: number;
  rowSeatIndex: number;
  rowSeatCount: number;
  x: number;
  y: number;
  angle: number;
  radialFraction: number;
}

const MAX_ROW_COUNT = 12;
const INNER_RADIAL_FRACTION = 0.34;
const OUTER_X_RADIUS = 0.47;
const OUTER_Y_RADIUS = 0.88;
const CENTER_X = 0.5;
const CENTER_Y = 0.96;

const roundCoordinate = (value: number) => Number(value.toFixed(6));

function validateGroups<GroupKey extends string>(
  groups: readonly HemicycleGroupInput<GroupKey>[],
): number {
  const seenKeys = new Set<string>();
  let total = 0;

  for (const group of groups) {
    if (typeof group.key !== "string" || group.key.trim().length === 0) {
      throw new TypeError("Hemicycle group keys must be non-empty strings.");
    }
    if (seenKeys.has(group.key)) {
      throw new TypeError(`Duplicate hemicycle group key: ${group.key}`);
    }
    if (!Number.isSafeInteger(group.count) || group.count < 0) {
      throw new RangeError(`Hemicycle count for ${group.key} must be a non-negative integer.`);
    }

    seenKeys.add(group.key);
    total += group.count;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("Hemicycle seat total must be a safe integer.");
    }
  }

  return total;
}

function chooseRowCount(seatCount: number): number {
  if (seatCount === 0) return 0;
  return Math.min(seatCount, MAX_ROW_COUNT, Math.max(1, Math.round(Math.sqrt(seatCount) / 1.6)));
}

function createRadialFractions(rowCount: number): number[] {
  if (rowCount === 0) return [];
  if (rowCount === 1) return [0.7];

  return Array.from({ length: rowCount }, (_, rowIndex) =>
    roundCoordinate(
      INNER_RADIAL_FRACTION + ((1 - INNER_RADIAL_FRACTION) * rowIndex) / (rowCount - 1),
    ),
  );
}

/**
 * Allocates every seat exactly once. Row capacity grows with arc length, so
 * outer rows receive more seats while every selected row remains occupied.
 */
function allocateRowCounts(seatCount: number, radialFractions: readonly number[]): number[] {
  if (seatCount === 0) return [];

  const rowCounts = radialFractions.map(() => 1);
  const unallocated = seatCount - rowCounts.length;
  if (unallocated === 0) return rowCounts;

  const weightTotal = radialFractions.reduce((sum, radius) => sum + radius, 0);
  const allocations = radialFractions.map((radius, index) => {
    const exact = (unallocated * radius) / weightTotal;
    const whole = Math.floor(exact);
    rowCounts[index] += whole;
    return { index, remainder: exact - whole };
  });

  const remaining = seatCount - rowCounts.reduce((sum, count) => sum + count, 0);
  allocations.sort((left, right) => right.remainder - left.remainder || right.index - left.index);

  for (let index = 0; index < remaining; index += 1) {
    rowCounts[allocations[index]!.index] += 1;
  }

  return rowCounts;
}

function createSeatSlots(rows: readonly HemicycleRow[]): SeatSlot[] {
  const slots: SeatSlot[] = [];

  for (const row of rows) {
    for (let rowSeatIndex = 0; rowSeatIndex < row.seatCount; rowSeatIndex += 1) {
      // A half-seat inset keeps circles away from the clipped baseline edges.
      const angle = Math.PI - (Math.PI * (rowSeatIndex + 0.5)) / row.seatCount;
      const x = CENTER_X + OUTER_X_RADIUS * row.radialFraction * Math.cos(angle);
      const y = CENTER_Y - OUTER_Y_RADIUS * row.radialFraction * Math.sin(angle);

      slots.push({
        rowIndex: row.index,
        rowSeatIndex,
        rowSeatCount: row.seatCount,
        x: roundCoordinate(x),
        y: roundCoordinate(y),
        angle: roundCoordinate(angle),
        radialFraction: row.radialFraction,
      });
    }
  }

  // Assigning groups along a single angular sweep makes each group a compact,
  // contiguous sector instead of scattering its seats row by row.
  return slots.sort(
    (left, right) =>
      right.angle - left.angle ||
      left.radialFraction - right.radialFraction ||
      left.rowSeatIndex - right.rowSeatIndex,
  );
}

/**
 * Creates deterministic, normalized seat positions for a parliamentary
 * hemicycle. The returned `seats` array follows visual left-to-right order;
 * group counts and caller-supplied group order are preserved exactly.
 */
export function createHemicycleLayout<GroupKey extends string>(
  groups: readonly HemicycleGroupInput<GroupKey>[],
): HemicycleLayout<GroupKey> {
  const seatCount = validateGroups(groups);
  const rowCount = chooseRowCount(seatCount);
  const radialFractions = createRadialFractions(rowCount);
  const rowSeatCounts = allocateRowCounts(seatCount, radialFractions);
  const rows = radialFractions.map<HemicycleRow>((radialFraction, index) => ({
    index,
    seatCount: rowSeatCounts[index]!,
    radialFraction,
  }));
  const slots = createSeatSlots(rows);
  const seats: HemicycleSeat<GroupKey>[] = [];
  let visualIndex = 0;

  groups.forEach((group, groupIndex) => {
    for (let groupSeatIndex = 0; groupSeatIndex < group.count; groupSeatIndex += 1) {
      const slot = slots[visualIndex]!;
      seats.push({
        groupKey: group.key,
        groupIndex,
        groupSeatIndex,
        visualIndex,
        rowIndex: slot.rowIndex,
        rowSeatIndex: slot.rowSeatIndex,
        rowSeatCount: slot.rowSeatCount,
        x: slot.x,
        y: slot.y,
        angle: slot.angle,
        radialFraction: slot.radialFraction,
      });
      visualIndex += 1;
    }
  });

  return { seatCount, rowCount, rows, seats };
}
