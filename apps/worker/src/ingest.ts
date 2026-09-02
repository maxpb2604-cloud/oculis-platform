/**
 * Factual SIL ingestion pipeline.
 *
 * The worker persists only fields reported by the official source. It deliberately
 * does not classify, score, predict, or convert agenda appearances into bill status.
 */
import {
  beginIngestionRun,
  countInitiatives,
  getInitiativeRawBySourceId,
  recordIngestionRun,
  recordStatusEvents,
  reconcileStatusHistorySnapshot,
  upsertInitiative,
  upsertInitiativeCommissionAssignments,
  type Database,
  type NewInitiative,
} from "@oculis/db";
import type { RawInitiative, SilDiputadosCatalogDiagnostics } from "@oculis/scrapers";
import { SilDiputadosAdapter } from "@oculis/scrapers";

export interface IngestOptions {
  limit?: number;
  maxPagesPerSlice?: number;
  /** Fetch the official sponsor and status-history endpoints for every row. */
  enrich?: boolean;
  concurrency?: number;
  delayMs?: number;
  log?: (msg: string) => void;
}

export interface IngestSummary {
  source: "sil-diputados";
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  seen: number;
  inserted: number;
  updated: number;
  statusChanges: number;
  enrichmentFailures: number;
  total: number;
  catalogTotal: number | null;
  serialHighWatermark: number | null;
  upstreamCatalogOmissions: number[];
  coverageNotes: string[];
  /** Backward-compatible alias for `catalogTotal`. */
  officialReportedCount: number | null;
  officialCountDifference: number | null;
  error?: string;
}

/** The global catalogue total and unique rows actually enumerated must agree before COMPLETE. */
export function officialCountMismatch(
  officialReportedCount: number | null,
  enumeratedUniqueRows: number,
): boolean {
  return officialReportedCount != null && officialReportedCount !== enumeratedUniqueRows;
}

/** Upstream serial gaps are transparent coverage notes, not fabricated initiatives. */
export function catalogCoverageNotes(upstreamCatalogOmissions: readonly number[]): string[] {
  if (upstreamCatalogOmissions.length === 0) return [];
  return [
    `La fuente omitió ${upstreamCatalogOmissions.length} serial(es) dentro de su rango asignado (${upstreamCatalogOmissions.join(", ")}); el catálogo global se conserva exacto y no se fabricaron iniciativas.`,
  ];
}

export async function ingestSilDiputados(
  db: Database,
  opts: IngestOptions = {},
): Promise<IngestSummary> {
  const {
    limit = Infinity,
    maxPagesPerSlice = Infinity,
    enrich = false,
    concurrency = 1,
    delayMs = 0,
    log = () => {},
  } = opts;
  const adapter = new SilDiputadosAdapter();
  log(`  factual mode · concurrency ${concurrency}`);

  let seen = 0;
  let inserted = 0;
  let updated = 0;
  let statusChanges = 0;
  let enrichmentFailures = 0;
  let officialReportedCount: number | null = null;
  let serialHighWatermark: number | null = null;
  let upstreamCatalogOmissions: number[] = [];
  let catalogDiagnostics: SilDiputadosCatalogDiagnostics | null = null;
  const enrichmentErrors: string[] = [];
  const inFlight = new Set<Promise<void>>();

  async function processOne(base: RawInitiative): Promise<void> {
    let raw = base;
    // The corpus endpoint does not report detail-only facts. A list-only run is
    // therefore not evidence that a previously observed sponsor, commission,
    // purpose, or raw detail disappeared.
    let observed = {
      detail: false,
      proponentes: false,
      historicos: false,
      comisiones: false,
      actividades: false,
      votaciones: false,
    };
    let rawObserved = false;
    if (enrich) {
      const result = await adapter.enrichObserved(base);
      raw = result.initiative;
      observed = result.observed;
      for (const failure of result.failures) {
        enrichmentFailures++;
        const message = `${base.sourceId}/${failure.collection}: ${failure.message}`;
        if (enrichmentErrors.length < 10) enrichmentErrors.push(message);
        log(`    ⚠ enrichment failed ${message}`);
      }
      const previousRaw = await getInitiativeRawBySourceId(db, base.source, base.sourceId);
      raw = { ...raw, raw: mergeObservedSourceRaw(previousRaw, raw.raw) };
      rawObserved = true;
    }

    const res = await upsertInitiative(
      db,
      toInitiativeRow(raw, {
        preserveDetailFields: !enrich,
        detailFieldsObserved: observed.detail,
        proponentsObserved: observed.proponentes,
        commissionsObserved: observed.comisiones,
        rawObserved,
      }),
    );
    const { historyInserted } = await persistInitiativeEvidence(db, res.id, raw, {
      historyObserved: observed.historicos,
      commissionsObserved: observed.comisiones,
    });
    statusChanges += historyInserted;
    if (res.inserted) inserted++;
    else {
      updated++;
      if (res.statusChanged && historyInserted === 0) statusChanges++;
    }
  }

  const runId = await beginIngestionRun(db, adapter.source, {
    mode: enrich ? "OFFICIAL_DETAIL_AND_HISTORY" : "OFFICIAL_LIST_ONLY",
  });
  try {
    try {
      officialReportedCount = await adapter.count();
    } catch (error) {
      log(`  ⚠ official counter unavailable: ${(error as Error).message}`);
    }
    for await (const base of adapter.list({ maxPagesPerSlice })) {
      if (seen >= limit) break;
      seen++;
      const task = processOne(base).finally(() => inFlight.delete(task));
      inFlight.add(task);
      if (seen % 25 === 0) log(`  …${seen} dispatched`);
      if (inFlight.size >= concurrency) await Promise.race(inFlight);
      if (delayMs) await sleep(delayMs);
    }
    await Promise.all(inFlight);

    if (!Number.isFinite(maxPagesPerSlice)) {
      catalogDiagnostics = await adapter.catalogDiagnostics();
      officialReportedCount = catalogDiagnostics.catalogTotal;
      serialHighWatermark = catalogDiagnostics.serialHighWatermark;
      upstreamCatalogOmissions = catalogDiagnostics.upstreamCatalogOmissions;
    } else {
      serialHighWatermark = await adapter.serialHighWatermark();
      if (officialReportedCount !== null && serialHighWatermark < officialReportedCount) {
        throw new Error(
          `SIL serial high-water mark ${serialHighWatermark} is below catalogue total ${officialReportedCount}`,
        );
      }
    }

    const officialCountDifference =
      officialReportedCount == null ? null : officialReportedCount - seen;
    const countMismatch = officialCountMismatch(officialReportedCount, seen);
    if (countMismatch) {
      log(
        `  ⚠ global catalogue total ${officialReportedCount}, enumerated unique rows ${seen} (difference ${officialCountDifference})`,
      );
    }
    const ok = enrichmentFailures === 0 && !countMismatch;
    const outcome = ok ? "COMPLETE" : "PARTIAL";
    const errorParts: string[] = [];
    if (enrichmentFailures > 0) {
      errorParts.push(`${enrichmentFailures} official collection request(s) failed`);
    }
    if (countMismatch) {
      errorParts.push(
        `global catalogue total ${officialReportedCount} did not match ${seen} enumerated unique row(s)`,
      );
    }
    const error = errorParts.length ? errorParts.join("; ") : undefined;
    const coverageNotes = catalogCoverageNotes(upstreamCatalogOmissions);
    coverageNotes.forEach((note) => log(`  ℹ ${note}`));
    await recordIngestionRun(db, {
      source: adapter.source,
      runId,
      seen,
      inserted,
      updated,
      statusChanges,
      ok,
      outcome,
      error,
      details: {
        mode: enrich ? "OFFICIAL_DETAIL_AND_HISTORY" : "OFFICIAL_LIST_ONLY",
        maxPagesPerSlice: Number.isFinite(maxPagesPerSlice) ? maxPagesPerSlice : null,
        enrichmentFailures,
        catalogTotal: officialReportedCount,
        serialHighWatermark,
        upstreamCatalogOmissions,
        coverageNotes,
        partitionCount: catalogDiagnostics?.partitionCount ?? null,
        globalPageCount: catalogDiagnostics?.globalPageCount ?? null,
        officialReportedCount,
        enumeratedUniqueRows: seen,
        officialCountDifference,
        failureExamples: enrichmentErrors,
      },
    });
    return {
      source: adapter.source,
      ok,
      outcome,
      seen,
      inserted,
      updated,
      statusChanges,
      enrichmentFailures,
      total: await countInitiatives(db),
      catalogTotal: officialReportedCount,
      serialHighWatermark,
      upstreamCatalogOmissions,
      coverageNotes,
      officialReportedCount,
      officialCountDifference,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    await Promise.allSettled(inFlight);
    const message = (error as Error).message;
    await recordIngestionRun(db, {
      source: adapter.source,
      runId,
      seen,
      inserted,
      updated,
      statusChanges,
      ok: false,
      error: message,
      details: {
        mode: enrich ? "OFFICIAL_DETAIL_AND_HISTORY" : "OFFICIAL_LIST_ONLY",
        enrichmentFailures,
        catalogTotal: officialReportedCount,
        serialHighWatermark,
        upstreamCatalogOmissions,
        coverageNotes: catalogCoverageNotes(upstreamCatalogOmissions),
        officialReportedCount,
        enumeratedUniqueRows: seen,
        officialCountDifference:
          officialReportedCount == null ? null : officialReportedCount - seen,
        failureExamples: enrichmentErrors,
      },
    });
    throw error;
  }
}

/** Persist source collections separately so repeated enrichment remains append-safe. */
export async function persistInitiativeEvidence(
  db: Database,
  initiativeId: number,
  raw: RawInitiative,
  opts: { historyObserved?: boolean; commissionsObserved?: boolean } = {},
): Promise<{ historyInserted: number; commissionAssignmentsInserted: number }> {
  const historyEvents = raw.history.map((event) => ({
    sourceEventId: event.sourceEventId,
    status: event.status,
    date: event.date,
    endDate: event.endDate,
    note: event.note,
    source: raw.source,
    sourceUrl: raw.sourceUrl,
    evidenceType: "SOURCE_HISTORY" as const,
    raw: event.raw,
  }));
  // Only an explicitly successful complete collection may retire an earlier source
  // version. Older callers without that proof retain append-only behavior.
  const historyInserted = historyEvents.length
    ? opts.historyObserved === true
      ? (
          await reconcileStatusHistorySnapshot(db, initiativeId, raw.source, historyEvents, {
            complete: true,
          })
        ).inserted
      : opts.historyObserved !== false
        ? await recordStatusEvents(db, initiativeId, historyEvents)
        : 0
    : 0;
  const commissionAssignmentsInserted =
    opts.commissionsObserved && raw.commissionAssignments
      ? await upsertInitiativeCommissionAssignments(
          db,
          initiativeId,
          raw.source,
          raw.commissionAssignments.map((assignment) => ({
            sourceAssignmentId: assignment.sourceId,
            sourceTypeId: assignment.sourceTypeId,
            name: assignment.name,
            type: assignment.type,
            startDate: assignment.startDate,
            endDate: assignment.endDate,
            raw: assignment.raw,
          })),
        )
      : 0;
  return { historyInserted, commissionAssignmentsInserted };
}

/** Map source fields without deriving a normalized category or prediction. */
export function toInitiativeRow(
  raw: RawInitiative,
  opts: {
    preserveDetailFields?: boolean;
    detailFieldsObserved?: boolean;
    proponentsObserved?: boolean;
    commissionsObserved?: boolean;
    rawObserved?: boolean;
  } = {},
): NewInitiative {
  const preserve = opts.preserveDetailFields === true;
  const detailObserved = opts.detailFieldsObserved ?? !preserve;
  const proponentsObserved = opts.proponentsObserved ?? !preserve;
  const commissionsObserved = opts.commissionsObserved ?? !preserve;
  const rawObserved = opts.rawObserved ?? !preserve;
  return {
    source: raw.source,
    sourceId: raw.sourceId,
    kind: raw.kind,
    code: raw.code,
    title: raw.title,
    purpose: detailObserved ? raw.purpose : undefined,
    type: raw.type,
    status: raw.status,
    chamber: raw.chamber,
    sourceChamber: raw.sourceChamber,
    originChamber: detailObserved ? raw.originChamber : undefined,
    // A successful detail observation explicitly confirms that the SIL publishes no
    // current-chamber/body field. Persist null so historical inferred values are cleared;
    // a list-only/failed-detail run remains non-destructive via undefined.
    currentChamber: detailObserved ? raw.currentChamber : undefined,
    currentBody: detailObserved ? raw.currentBody : undefined,
    condition: detailObserved ? raw.condition : undefined,
    sourceCategory: raw.sourceCategory,
    subjectMatter: detailObserved ? raw.subjectMatter : undefined,
    category: null,
    // A failed optional detail request is not evidence that previously observed
    // sponsor facts disappeared. `undefined` tells the repository to retain them.
    sponsor: proponentsObserved ? raw.sponsor : undefined,
    sponsorRole: proponentsObserved ? raw.sponsorRole : undefined,
    sponsorCount: proponentsObserved ? raw.sponsorCount : undefined,
    party: proponentsObserved ? raw.party : undefined,
    province: proponentsObserved ? raw.province : undefined,
    committee: commissionsObserved ? raw.committee : undefined,
    filedAt: raw.filedAt,
    expiresAt: detailObserved ? raw.expiresAt : undefined,
    initiated: detailObserved ? raw.initiated : undefined,
    initiatedAt: detailObserved ? raw.initiatedAt : undefined,
    legislature: detailObserved ? raw.legislature : undefined,
    registrationPeriod: detailObserved ? raw.registrationPeriod : undefined,
    officialStatusChangedAt: detailObserved ? raw.officialStatusChangedAt : undefined,
    promulgationNumber: detailObserved ? raw.promulgationNumber : undefined,
    promulgatedAt: detailObserved ? raw.promulgatedAt : undefined,
    sourceUrl: raw.sourceUrl,
    raw: rawObserved ? (raw.raw as unknown) : undefined,
  };
}

/**
 * Merge only collection payloads observed in the current run. The current provenance
 * names only successful current endpoints; older snapshots retained after a failure are
 * kept separately so they cannot be mistaken for a current observation. Collection-scoped
 * observation timestamps remain at the top level because each timestamp is self-dating and
 * consumers apply their own freshness window instead of treating retention as a new check.
 */
export function mergeObservedSourceRaw(previous: unknown, current: unknown): unknown {
  if (!current || typeof current !== "object") return previous ?? current;
  const next = current as {
    payload?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
  };
  if (!previous || typeof previous !== "object" || !next.payload) return current;
  const prior = previous as {
    payload?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
  };
  if (!prior.payload) return current;
  const currentKeys = new Set(Object.keys(next.payload));
  const retainedCollections = Object.keys(prior.payload).filter((key) => !currentKeys.has(key));
  const priorCollectionObservedAt =
    prior.provenance?.collectionObservedAt &&
    typeof prior.provenance.collectionObservedAt === "object" &&
    !Array.isArray(prior.provenance.collectionObservedAt)
      ? (prior.provenance.collectionObservedAt as Record<string, unknown>)
      : {};
  const nextCollectionObservedAt =
    next.provenance?.collectionObservedAt &&
    typeof next.provenance.collectionObservedAt === "object" &&
    !Array.isArray(next.provenance.collectionObservedAt)
      ? (next.provenance.collectionObservedAt as Record<string, unknown>)
      : {};
  const collectionObservedAt = {
    ...priorCollectionObservedAt,
    ...nextCollectionObservedAt,
  };
  return {
    ...prior,
    ...next,
    payload: { ...prior.payload, ...next.payload },
    provenance: {
      ...(next.provenance ?? {}),
      ...(Object.keys(collectionObservedAt).length ? { collectionObservedAt } : {}),
      ...(retainedCollections.length
        ? {
            retainedCollections,
            retainedProvenance: prior.provenance ?? null,
          }
        : {}),
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
