import { SOURCE_REGISTRY } from "@oculis/scrapers";

export interface SourceResult {
  source: string;
  /** False only when the source execution failed operationally. */
  ok: boolean;
  /** Completeness is independent from operational health. */
  outcome?: "COMPLETE" | "PARTIAL" | "FAILED";
}

export const REQUIRED_SOURCE_SETS = {
  daily: [
    "sil-actividad",
    "dip-oficial",
    "senado",
    "sil-deposits",
    "senado-sil-deposits",
    "senado-sil-fichas",
    "activity-link-backfill",
    "feed-senado",
    "feed-diputados",
    "feed-legislative",
  ],
  regulatory: [
    "reg-proconsumidor",
    "reg-indotel",
    "reg-indocal",
    "reg-micm",
    "reg-intrant",
    "reg-mispas",
  ],
  publications: [
    "dip-known-agenda",
    "sen-approved",
    "sen-expired",
    "sen-votes",
    "sen-attendance",
    "sen-reports",
  ],
  incrementalMovements: ["sil-movements-incremental", "senado-sil-movements-incremental"],
  documentDiscovery: ["sil-documents"],
  documentVerification: ["document-pdf-byte-verification"],
  feed: ["feed-senado", "feed-diputados", "feed-legislative"],
} as const;

/**
 * Fail when a mode omits a required source or that source fails operationally.
 * A successful PARTIAL run remains visible through its outcome and recorded gaps.
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
      failed.length ? `failed: ${failed.join(", ")}` : "",
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
