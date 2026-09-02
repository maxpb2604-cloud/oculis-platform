import { describe, expect, it } from "vitest";
import { SOURCE_FRESHNESS_MAX_AGE_MS, sourceCompletionIsOverdue } from "../source-freshness";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-09-02T16:00:00.000Z");

function isoBefore(ageMs: number): string {
  return new Date(NOW - ageMs).toISOString();
}

describe("source completion freshness", () => {
  it("uses explicit cadence thresholds with operational slack", () => {
    expect(SOURCE_FRESHNESS_MAX_AGE_MS).toEqual({
      THREE_TIMES_DAILY: 12 * HOUR_MS,
      DAILY: 36 * HOUR_MS,
      WEEKLY: 9 * DAY_MS,
    });
  });

  it.each([
    ["THREE_TIMES_DAILY" as const, 12 * HOUR_MS],
    ["DAILY" as const, 36 * HOUR_MS],
    ["WEEKLY" as const, 9 * DAY_MS],
  ])("marks %s overdue only after its threshold", (cadence, threshold) => {
    expect(sourceCompletionIsOverdue(cadence, isoBefore(threshold), NOW)).toBe(false);
    expect(sourceCompletionIsOverdue(cadence, isoBefore(threshold + 1), NOW)).toBe(true);
  });

  it.each(["BOOTSTRAP", "MANUAL", "NOT_SCHEDULED"] as const)(
    "does not age %s into an overdue state",
    (cadence) => {
      expect(sourceCompletionIsOverdue(cadence, isoBefore(400 * DAY_MS), NOW)).toBe(false);
      expect(sourceCompletionIsOverdue(cadence, null, NOW)).toBe(false);
    },
  );

  it("fails closed for a scheduled completion with a missing or invalid timestamp", () => {
    expect(sourceCompletionIsOverdue("DAILY", null, NOW)).toBe(true);
    expect(sourceCompletionIsOverdue("WEEKLY", "not-a-date", NOW)).toBe(true);
  });
});
