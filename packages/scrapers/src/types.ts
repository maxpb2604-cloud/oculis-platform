import type { Chamber, InitiativeKind } from "@oculis/core";

/**
 * Canonical, source-agnostic representation of one initiative as produced by a
 * scraper adapter. Each adapter maps its source payload into this shape; the
 * ingestion worker then dedupes/upserts and runs categorization + scoring.
 */
export interface RawInitiative {
  /** Stable source identifier (e.g. SIL initiative id), unique within `source`. */
  sourceId: string;
  /** Which adapter produced this (e.g. "sil-diputados"). */
  source: string;
  /** Legislative vs regulatory. */
  kind: InitiativeKind;
  /** Official initiative code when available (e.g. "03227-2024-2028-CD"). */
  code: string | null;
  /** Initiative title / short description. */
  title: string;
  /** Full purpose / object text when available. */
  purpose: string | null;
  /** Source-reported type (e.g. "Proyecto de Ley", "Resolución"). */
  type: string | null;
  /** Source-reported status label (mapped to our vocabulary downstream). */
  status: string | null;
  /** Chamber of origin, if legislative. */
  chamber: Chamber | null;
  /** Source-reported subject group/category label. */
  sourceCategory: string | null;
  /** Sponsor / proponent full name(s). */
  sponsor: string | null;
  /** Sponsor political party. */
  party: string | null;
  /** Sponsor province. */
  province: string | null;
  /** Reviewing committee. */
  committee: string | null;
  /** Filing / deposit date (ISO 8601) when available. */
  filedAt: string | null;
  /** Expiration / perención date (ISO 8601) when available. */
  expiresAt: string | null;
  /** Canonical URL to the source record. */
  sourceUrl: string | null;
  /** Ordered status-history events when the source exposes them. */
  history: RawStatusEvent[];
  /** Untouched source payload, retained for re-mapping/audit. */
  raw: unknown;
}

export interface RawStatusEvent {
  status: string;
  /** ISO 8601 date of the event. */
  date: string | null;
  note: string | null;
}

/**
 * Common contract every source adapter implements. Adapters are pure data
 * acquisition — no DB writes; the worker orchestrates persistence.
 * (Nothing consumes this polymorphically; it documents the minimal shape a
 * corpus adapter must offer: identity, count, and full listing.)
 */
export interface SourceAdapter {
  /** Unique adapter key, stored on each row's `source`. */
  readonly source: string;
  /** Total count of records available at the source (for progress/health). */
  count(): Promise<number>;
  /** Async iterator over all initiatives, paginated internally. */
  list(options?: {
    sincePage?: number;
    maxPagesPerSlice?: number;
  }): AsyncIterable<RawInitiative>;
}
