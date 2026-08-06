/**
 * Factual SIL ingestion pipeline.
 *
 * The worker persists only fields reported by the official source. It deliberately
 * does not classify, score, predict, or convert agenda appearances into bill status.
 */
import {
  beginIngestionRun,
  countInitiatives,
  recordIngestionRun,
  recordStatusEvents,
  upsertInitiative,
  type Database,
  type NewInitiative,
} from "@oculis/db";
import type { RawInitiative } from "@oculis/scrapers";
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
  error?: string;
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
  const enrichmentErrors: string[] = [];
  const inFlight = new Set<Promise<void>>();

  async function processOne(base: RawInitiative): Promise<void> {
    let raw = base;
    let detailObserved = !enrich;
    if (enrich) {
      try {
        raw = await adapter.enrich(base);
        detailObserved = true;
      } catch (error) {
        enrichmentFailures++;
        const message = `${base.sourceId}: ${(error as Error).message}`;
        if (enrichmentErrors.length < 10) enrichmentErrors.push(message);
        log(`    ⚠ enrichment failed ${message}`);
      }
    }

    const res = await upsertInitiative(
      db,
      toInitiativeRow(raw, { preserveDetailFields: enrich && !detailObserved }),
    );
    let historyInserted = 0;
    if (raw.history.length) {
      historyInserted = await recordStatusEvents(
        db,
        res.id,
        raw.history.map((event) => ({
          status: event.status,
          date: event.date,
          note: event.note,
          source: raw.source,
          sourceUrl: raw.sourceUrl,
          evidenceType: "SOURCE_HISTORY",
          raw: event.raw,
        })),
      );
      statusChanges += historyInserted;
    }
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

    const ok = enrichmentFailures === 0;
    const outcome = ok ? "COMPLETE" : "PARTIAL";
    const error = ok ? undefined : `${enrichmentFailures} initiative enrichment request(s) failed`;
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
        failureExamples: enrichmentErrors,
      },
    });
    throw error;
  }
}

/** Map source fields without deriving a normalized category or prediction. */
export function toInitiativeRow(
  raw: RawInitiative,
  opts: { preserveDetailFields?: boolean } = {},
): NewInitiative {
  const preserve = opts.preserveDetailFields === true;
  return {
    source: raw.source,
    sourceId: raw.sourceId,
    kind: raw.kind,
    code: raw.code,
    title: raw.title,
    purpose: raw.purpose,
    type: raw.type,
    status: raw.status,
    chamber: raw.chamber,
    sourceCategory: raw.sourceCategory,
    category: null,
    // A failed optional detail request is not evidence that previously observed
    // sponsor facts disappeared. `undefined` tells the repository to retain them.
    sponsor: preserve ? undefined : raw.sponsor,
    party: preserve ? undefined : raw.party,
    province: preserve ? undefined : raw.province,
    committee: raw.committee,
    filedAt: raw.filedAt,
    expiresAt: raw.expiresAt,
    sourceUrl: raw.sourceUrl,
    raw: preserve ? undefined : (raw.raw as unknown),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
