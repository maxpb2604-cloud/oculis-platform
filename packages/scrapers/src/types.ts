import type { Chamber, InitiativeKind } from "@oculis/core";

/**
 * Canonical, source-agnostic representation of one initiative as produced by a
 * scraper adapter. Each adapter maps its source payload into this shape; the
 * ingestion worker then dedupes and upserts without predictions or classifications.
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
  /** Source-reported status label, preserved without lifecycle remapping. */
  status: string | null;
  /** Legacy compatibility chamber. Prefer the explicit source/origin/current fields below. */
  chamber: Chamber | null;
  /** Chamber whose official corpus produced this record. Kept separate from origin/current. */
  sourceChamber?: Chamber | null;
  /** Chamber of origin explicitly stated by the source. */
  originChamber?: Chamber | null;
  /** Current chamber explicitly stated by the source; never derived from status or history. */
  currentChamber?: Chamber | null;
  /** Current legislative body explicitly stated by the source; never inferred. */
  currentBody?: string | null;
  /** Source-reported condition, kept distinct from the procedural status. */
  condition?: string | null;
  /** Source-reported subject group/category label. */
  sourceCategory: string | null;
  /** Source-reported subject matter, kept distinct from its broader group/category. */
  subjectMatter?: string | null;
  /** Literal source value indicating whether proceedings have started (for example, "SI"). */
  initiated?: string | null;
  /** Source-reported initiation date, normalized to ISO yyyy-mm-dd. */
  initiatedAt?: string | null;
  /** Source-reported legislature identifier. */
  legislature?: string | null;
  /** Source-reported registration period. */
  registrationPeriod?: string | null;
  /** Literal source timestamp for the last official principal-status change. */
  officialStatusChangedAt?: string | null;
  /** Source-reported promulgation number, when present. */
  promulgationNumber?: string | null;
  /** Source-reported promulgation date, normalized to ISO yyyy-mm-dd. */
  promulgatedAt?: string | null;
  /** Sponsor / proponent full name(s). */
  sponsor: string | null;
  /** Source-reported role/function of the principal sponsor. */
  sponsorRole?: string | null;
  /** Total number of proponents returned by the official source collection. */
  sponsorCount?: number | null;
  /** Sponsor political party. */
  party: string | null;
  /** Sponsor province. */
  province: string | null;
  /** Reviewing committee. */
  committee: string | null;
  /** Every explicit commission assignment; no assignment is selected as "current". */
  commissionAssignments?: RawCommissionAssignment[];
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
  /** Stable event id published by the source, when available. */
  sourceEventId: string | null;
  status: string;
  /** ISO 8601 date of the event. */
  date: string | null;
  /** ISO 8601 end date explicitly published by the source. */
  endDate: string | null;
  note: string | null;
  /** Untouched source history row used as evidence. */
  raw?: unknown;
}

/** One explicit source row assigning an initiative to a commission. */
export interface RawCommissionAssignment {
  /** Stable assignment id published by the source, when available. */
  sourceId: string | null;
  /** Source's commission-type id, retained separately from its label. */
  sourceTypeId: string | null;
  /** Literal assignment type, for example "Permanente" or "Especial". */
  type: string | null;
  /** Literal commission name/description. */
  name: string | null;
  /** Explicit assignment start date, normalized to ISO yyyy-mm-dd. */
  startDate: string | null;
  /** Explicit assignment end date, normalized to ISO yyyy-mm-dd. */
  endDate: string | null;
  /** Untouched source assignment row used as evidence. */
  raw: unknown;
}

/**
 * Common contract every source adapter implements. Adapters are pure data
 * acquisition — no DB writes; the worker orchestrates persistence.
 */
export interface SourceAdapter {
  /** Unique adapter key, stored on each row's `source`. */
  readonly source: string;
  /** Total count of records available at the source (for progress/health). */
  count(): Promise<number>;
  /** Async iterator over all initiatives, paginated internally. */
  list(options?: { sincePage?: number; maxPagesPerSlice?: number }): AsyncIterable<RawInitiative>;
  /** Fetch one initiative's full detail by source id. */
  detail(sourceId: string): Promise<RawInitiative | null>;
}
