import type { SourceCadence } from "@oculis/scrapers";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Maximum age of a completed scheduled run before its public health state is overdue.
 *
 * Each boundary deliberately includes operational slack beyond the nominal cadence:
 * three daily runs get 12 hours, daily runs get 36 hours, and weekly runs get 9 days.
 * Operator-driven/bootstrap processes have no automatic time-based degradation.
 */
export const SOURCE_FRESHNESS_MAX_AGE_MS: Readonly<Partial<Record<SourceCadence, number>>> = {
  THREE_TIMES_DAILY: 12 * HOUR_MS,
  DAILY: 36 * HOUR_MS,
  WEEKLY: 9 * DAY_MS,
};

/** Compare absolute timestamps in UTC; timezone conversion is presentation-only. */
export function sourceCompletionIsOverdue(
  cadence: SourceCadence,
  completedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const maxAgeMs = SOURCE_FRESHNESS_MAX_AGE_MS[cadence];
  if (maxAgeMs === undefined) return false;

  const completedAtMs = completedAt ? Date.parse(completedAt) : Number.NaN;
  if (!Number.isFinite(completedAtMs)) return true;
  if (!Number.isFinite(nowMs)) throw new Error("nowMs must be a finite UTC epoch timestamp");

  return nowMs - completedAtMs > maxAgeMs;
}
