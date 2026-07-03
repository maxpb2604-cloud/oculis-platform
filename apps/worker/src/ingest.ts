/**
 * Ingestion pipeline: pull initiatives from a source adapter, enrich, categorize,
 * compute a real risk/approval score, and persist (upsert + status-event diff).
 */
import { score } from "@oculis/core";
import {
  countApprovedBySponsor,
  countInitiatives,
  recordIngestionRun,
  recordStatusEvents,
  saveScore,
  upsertInitiative,
  type Database,
  type NewInitiative,
} from "@oculis/db";
import type { RawInitiative } from "@oculis/scrapers";
import { SilDiputadosAdapter } from "@oculis/scrapers";
import {
  composeScoreInputs,
  derivePartyStrength,
  deriveSponsorRecord,
} from "./scoring-inputs.js";
import { createScoreEstimator, type ScoreEstimator } from "./score.js";
import { createCategorizer, type CategoryResult } from "./categorize.js";

export interface IngestOptions {
  limit?: number; // cap total records (dev runs)
  maxPagesPerSlice?: number; // cap pages per (grupo × tipo) — sweep all categories cheaply
  enrich?: boolean; // fetch sponsor/party/province/history per record
  concurrency?: number; // records processed in parallel (enrich+categorize+score)
  delayMs?: number; // politeness delay between record starts
  log?: (msg: string) => void;
}

export interface IngestSummary {
  seen: number;
  inserted: number;
  updated: number;
  statusChanges: number;
  categorized: number;
  /** Records whose upsert/status persistence failed (logged, crawl continued). */
  failed: number;
  total: number;
}

/** Health-row key for the full corpus crawl (distinct from the daily "sil-deposits"). */
export const CORPUS_SOURCE = "sil-corpus";

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
  const categorizer = createCategorizer();
  const estimator = createScoreEstimator();
  log(
    `  categorizer: ${categorizer.kind} · scorer: ${estimator.kind} · concurrency ${concurrency}`,
  );

  let seen = 0;
  let inserted = 0;
  let updated = 0;
  let statusChanges = 0;
  let categorized = 0;
  let failed = 0;

  async function processOne(base: RawInitiative): Promise<void> {
    // Per-record isolation: one bad record (upsert/status failure) must never reject
    // into the concurrency pool and abort the whole corpus crawl.
    try {
      const raw = enrich ? await safeEnrich(adapter, base) : base;
      const cat = await safeCategorize(categorizer, raw);
      if (cat?.category) categorized++;

      const res = await upsertInitiative(db, toRow(raw, cat));
      await scoreInitiative(db, estimator, {
        id: res.id,
        title: raw.title,
        purpose: raw.purpose,
        sponsor: raw.sponsor,
        party: raw.party,
        category: cat?.category ?? raw.sourceCategory,
      });

      // Status-event dates arrive as "2024-08-27T00:00:00"; the column is yyyy-mm-dd.
      let newEvents = 0;
      if (raw.history.length) {
        newEvents = await recordStatusEvents(
          db,
          res.id,
          raw.history.map((h) => ({ status: h.status, date: isoDay(h.date), note: h.note })),
        );
      }
      if (res.inserted) inserted++;
      else {
        updated++;
        // Count each real change once: the history diff already contains the
        // transition rows; `statusChanged` is only the fallback signal when the
        // history wasn't fetched (enrich off) or came back empty.
        statusChanges += newEvents > 0 ? newEvents : res.statusChanged ? 1 : 0;
      }
    } catch (err) {
      failed++;
      log(
        `  ⚠ registro ${base.code ?? base.sourceId} («${base.title.slice(0, 80)}») falló: ` +
          `${(err as Error).message}`,
      );
    }
  }

  // bounded-concurrency pool over the streamed records (processOne never rejects,
  // so the pool can only die if the record stream itself does)
  const inFlight = new Set<Promise<void>>();
  try {
    for await (const base of adapter.list({ maxPagesPerSlice })) {
      if (seen >= limit) break;
      seen++;
      const p = processOne(base).finally(() => inFlight.delete(p));
      inFlight.add(p);
      if (seen % 25 === 0) log(`  …${seen} dispatched`);
      if (inFlight.size >= concurrency) await Promise.race(inFlight);
      if (delayMs) await sleep(delayMs);
    }
    await Promise.all(inFlight);
  } catch (err) {
    // The stream died (page fetch, etc.) — drain the in-flight records, then leave a
    // health row before failing so the outage is visible on "Estado de monitoreo".
    await Promise.all(inFlight);
    await recordIngestionRun(db, {
      source: CORPUS_SOURCE,
      seen,
      inserted,
      updated,
      statusChanges,
      ok: false,
      error: (err as Error).message,
    });
    throw err;
  }

  // Health row so the corpus crawl shows up on "Estado de monitoreo".
  await recordIngestionRun(db, {
    source: CORPUS_SOURCE,
    seen,
    inserted,
    updated,
    statusChanges,
    ok: true,
    details: failed
      ? { failed, gaps: [`${failed} registro(s) fallaron durante el crawl (ver log del worker).`] }
      : null,
  });

  return {
    seen,
    inserted,
    updated,
    statusChanges,
    categorized,
    failed,
    total: await countInitiatives(db),
  };
}

export interface ScorableInput {
  id: number;
  title: string;
  purpose: string | null;
  sponsor: string | null;
  party: string | null;
  category: string | null;
}

/**
 * Compute and persist a real risk/approval score for one initiative:
 * derive party strength + sponsor track record, estimate the judgment inputs
 * (Claude/heuristic), run the ported Excel formulas, and save score + provenance.
 * Shared by ingestion and the `--rescore` command. Returns the resulting risk level.
 */
export async function scoreInitiative(
  db: Database,
  estimator: ScoreEstimator,
  row: ScorableInput,
): Promise<string | null> {
  try {
    const partyStrength = derivePartyStrength(row.party);
    // excludeId: an already-approved bill must not count ITSELF in its sponsor's record.
    const approved = await countApprovedBySponsor(db, row.sponsor, { excludeId: row.id });
    const sponsorRecord = deriveSponsorRecord(approved);
    const estimate = await estimator.estimate({
      title: row.title,
      purpose: row.purpose,
      sponsor: row.sponsor,
      party: row.party,
      category: row.category,
      partyStrength,
    });
    const inputs = composeScoreInputs(partyStrength, sponsorRecord, estimate);
    const scored = score(inputs);
    await saveScore(db, row.id, scored, inputs, {
      ...inputs,
      sponsorApprovedCount: approved,
      estimatedBy: estimate.by,
      rationale: estimate.rationale,
      confidence: estimate.confidence,
    });
    return scored.riskLevel;
  } catch {
    return null; // scoring is best-effort; a row simply stays unscored
  }
}

async function safeEnrich(
  adapter: SilDiputadosAdapter,
  base: RawInitiative,
): Promise<RawInitiative> {
  try {
    return await adapter.enrich(base);
  } catch {
    return base; // enrichment is best-effort; never block ingestion on it
  }
}

async function safeCategorize(
  categorizer: ReturnType<typeof createCategorizer>,
  raw: RawInitiative,
): Promise<CategoryResult | null> {
  try {
    return await categorizer.categorize({
      title: raw.title,
      sourceCategory: raw.sourceCategory,
      purpose: raw.purpose,
    });
  } catch {
    return null; // categorization is best-effort; leave uncategorized for review
  }
}

function toRow(raw: RawInitiative, cat: CategoryResult | null): NewInitiative {
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
    category: cat?.category ?? null,
    categoryConfidence: cat?.confidence ?? null,
    // Enrichment fields: when the crawl has nothing (--enrich off, or the enrich
    // sub-fetch failed/came back empty) pass `undefined`, NOT null — undefined leaves
    // the column untouched on update, so a plain crawl can never wipe previously
    // enriched sponsor/party/province/committee values.
    sponsor: raw.sponsor ?? undefined,
    party: raw.party ?? undefined,
    province: raw.province ?? undefined,
    committee: raw.committee ?? undefined,
    filedAt: raw.filedAt,
    expiresAt: raw.expiresAt,
    sourceUrl: raw.sourceUrl,
    // Score is computed + saved separately (scoreInitiative). Rows stay flagged for
    // analyst review until the AI-estimated judgment inputs are confirmed.
    needsReview: true,
    raw: raw.raw as unknown,
  };
}

/** SIL dates look like "2024-08-27T00:00:00" — keep only the yyyy-mm-dd portion. */
function isoDay(v: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v ?? "");
  return m ? m[1]! : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
