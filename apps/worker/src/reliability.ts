import { SOURCE_REGISTRY } from "@oculis/scrapers";

export interface SourceResult {
  source: string;
  ok: boolean;
}

export const REQUIRED_SOURCE_SETS = {
  daily: [
    "sil-actividad",
    "dip-oficial",
    "senado",
    "sil-deposits",
    "senado-sil-deposits",
    "activity-link-backfill",
    "feed-senado",
    "feed-diputados",
    "feed-legislative",
  ],
  regulatory: ["reg-proconsumidor", "reg-indotel", "reg-indocal", "reg-micm", "reg-intrant"],
  publications: [
    "dip-known-agenda",
    "sen-approved",
    "sen-expired",
    "sen-votes",
    "sen-attendance",
    "sen-reports",
  ],
  feed: ["feed-senado", "feed-diputados", "feed-legislative"],
} as const;

/**
 * Fail when a mode omits a required source as well as when that source reports a
 * failure/partial result. Looking only at returned rows would let a skipped adapter
 * silently pass automation.
 */
export function assertRequiredSourcesOk(
  context: string,
  results: readonly SourceResult[],
  expectedIds: readonly string[],
): void {
  const registeredRequired = new Set(
    SOURCE_REGISTRY.filter((entry) => entry.status === "ACTIVE" && entry.required).map(
      (entry) => entry.id,
    ),
  );
  const expected = [...new Set(expectedIds)].filter((id) => registeredRequired.has(id));
  const resultBySource = new Map(results.map((result) => [result.source, result] as const));
  const missing = expected.filter((id) => !resultBySource.has(id));
  const failed = expected.filter((id) => resultBySource.get(id)?.ok === false);
  if (missing.length || failed.length) {
    const problems = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      failed.length ? `failed/partial: ${failed.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(`${context}: required source coverage incomplete (${problems.join("; ")})`);
  }
}

/** Preserve per-source isolation while still making automation fail on real source errors. */
export function assertSourcesOk(context: string, results: readonly SourceResult[]): void {
  const failed = results.filter((result) => !result.ok).map((result) => result.source);
  if (failed.length) {
    throw new Error(`${context}: ${failed.length} source(s) failed: ${failed.join(", ")}`);
  }
}
