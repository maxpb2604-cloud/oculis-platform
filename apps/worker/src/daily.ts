/**
 * Daily monitoring orchestrator — Phase 1.
 *
 * Runs every source for BOTH chambers in one pass and records a per-source health
 * row (with reconciliation gaps + anomaly flags) so the dashboard's "Estado de
 * monitoreo" page can show what ran, what it found, and any blind spots. Designed to
 * be run several times per day and safely re-runnable by hand.
 *
 *   1. SIL Diputados    — committee/plenary agenda (sil-actividad), with page reconciliation
 *   2. Diputados oficial — plenary órdenes del día PDFs (reading statuses)
 *   3. Senado           — órdenes del día (Pleno/Asamblea) + weekly committee agenda, PDFs parsed
 *
 * Each source is isolated: a failure in one is recorded and never aborts the others.
 */
import {
  backfillActivityInitiativeIds,
  beginIngestionRun,
  latestRunsBySource,
  recordIngestionRun,
  upsertActivityEvent,
  type Database,
} from "@oculis/db";
import {
  DipOficialAdapter,
  SenadoAdapter,
  SilActividadAdapter,
  type RawActivityEvent,
} from "@oculis/scrapers";

export interface DailySummary {
  source: string;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  events: number;
  inserted: number;
  gaps: string[];
  error?: string;
}

type Log = (msg: string) => void;

/** Persist a batch of activity events; returns how many were newly inserted. */
async function persist(db: Database, events: RawActivityEvent[]): Promise<number> {
  let inserted = 0;
  for (const ev of events) {
    const r = await upsertActivityEvent(db, ev);
    if (r.inserted) inserted++;
  }
  return inserted;
}

async function runSource(
  db: Database,
  source: string,
  baseline: Map<string, number | null>,
  fn: () => Promise<{ events: RawActivityEvent[]; gaps: string[] }>,
  log: Log,
): Promise<DailySummary> {
  log(`\n▶ ${source}`);
  const runId = await beginIngestionRun(db, source);
  try {
    const { events, gaps } = await fn();
    const inserted = await persist(db, events);
    // Anomaly guard: a run can "succeed" yet return suspiciously few rows (selector
    // drift, partial outage). Flag it so the health page can't show green for ~nothing.
    const base = baseline.get(source) ?? null;
    const anomalyGaps = [...gaps];
    if (events.length === 0) {
      anomalyGaps.push(`${source}: la fuente devolvió 0 eventos.`);
    } else if (base && events.length < base * 0.5) {
      anomalyGaps.push(
        `${source}: ${events.length} eventos; menos del 50% de la mediana histórica (${base}).`,
      );
    }
    const outcome = anomalyGaps.length ? "PARTIAL" : "COMPLETE";
    // Reaching the source and persisting its explicit response is operational success,
    // even when the source reports no activity or a reconciliation gap.
    const ok = true;
    await recordIngestionRun(db, {
      source,
      runId,
      seen: events.length,
      inserted,
      ok,
      outcome,
      details: anomalyGaps.length ? { gaps: anomalyGaps } : null,
    });
    log(
      `  ${outcome === "COMPLETE" ? "✔" : "⚠"} ${events.length} events (${inserted} new)` +
        (anomalyGaps.length ? ` · ${anomalyGaps.length} gap(s)` : ""),
    );
    anomalyGaps.forEach((g) => log(`    ⚠ ${g}`));
    return { source, ok, outcome, events: events.length, inserted, gaps: anomalyGaps };
  } catch (err) {
    const error = (err as Error).message;
    // Don't pollute volume metrics with a 0 on failure — leave seen unset.
    await recordIngestionRun(db, { runId, source, ok: false, error });
    log(`  ✖ FAILED: ${error}`);
    return { source, ok: false, outcome: "FAILED", events: 0, inserted: 0, gaps: [], error };
  }
}

export async function runDaily(db: Database, opts: { log?: Log } = {}): Promise<DailySummary[]> {
  const log = opts.log ?? (() => {});
  // Pull each source's historical baseline (median seen of prior ok runs) up front.
  const health = await latestRunsBySource(db);
  const baseline = new Map(health.map((h) => [h.source, h.baselineSeen] as const));
  const summaries: DailySummary[] = [];

  summaries.push(
    await runSource(db, "sil-actividad", baseline, () => new SilActividadAdapter().collect(), log),
  );
  summaries.push(
    await runSource(
      db,
      "dip-oficial",
      baseline,
      () => new DipOficialAdapter().collect({ limit: 30 }),
      log,
    ),
  );
  // The adapter uses WPFD's official download action for PDF bytes. Parsing keeps exact
  // initiative codes and procedural mentions available for Senate plenary agendas.
  summaries.push(
    await runSource(
      db,
      "senado",
      baseline,
      () => new SenadoAdapter().collect({ parsePdfs: true }),
      log,
    ),
  );

  // After today's agenda activity is persisted, resolve any activity↔initiative links that
  // were stored with a NULL initiative_id because the referenced bill hadn't been ingested
  // yet. The caller syncs deposits before runDaily, and corpus ingestion may have added older
  // bills, so this pass closes both current-run and historical exact-code links.
  // This operation only repairs internal foreign-key links; it never creates status events.
  const backfillRunId = await beginIngestionRun(db, "activity-link-backfill", {
    rule: "EXACT_OFFICIAL_INITIATIVE_CODE",
  });
  try {
    const backfilled = await backfillActivityInitiativeIds(db);
    await recordIngestionRun(db, {
      runId: backfillRunId,
      source: "activity-link-backfill",
      seen: backfilled,
      updated: backfilled,
      ok: true,
      details: { rule: "EXACT_OFFICIAL_INITIATIVE_CODE" },
    });
    log(`\n▶ backfill activity↔initiative links\n  ✔ ${backfilled} link(s) resolved`);
    summaries.push({
      source: "activity-link-backfill",
      ok: true,
      outcome: "COMPLETE",
      events: 0,
      inserted: 0,
      gaps: [],
    });
  } catch (err) {
    const error = (err as Error).message;
    await recordIngestionRun(db, {
      runId: backfillRunId,
      source: "activity-link-backfill",
      ok: false,
      error,
    });
    log(`\n▶ backfill activity↔initiative links\n  ✖ FAILED: ${error}`);
    summaries.push({
      source: "activity-link-backfill",
      ok: false,
      outcome: "FAILED",
      events: 0,
      inserted: 0,
      gaps: [],
      error,
    });
  }

  return summaries;
}
