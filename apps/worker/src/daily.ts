/**
 * Daily monitoring orchestrator — Phase 1.
 *
 * Runs every source for BOTH chambers in one pass and records a per-source health
 * row (with reconciliation gaps + anomaly flags) so the dashboard's "Estado de
 * monitoreo" page can show what ran, what it found, and any blind spots. Designed to
 * be run on a schedule (launchd) every morning, and safely re-runnable by hand.
 *
 *   1. SIL Diputados    — committee/plenary agenda (sil-actividad), with page reconciliation
 *   2. Diputados oficial — plenary órdenes del día PDFs (reading statuses)
 *   3. Senado           — órdenes del día (Pleno/Asamblea) + weekly committee agenda, PDFs parsed
 *
 * Each source is isolated: a failure in one is recorded and never aborts the others.
 */
import {
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
  try {
    const { events, gaps } = await fn();
    const inserted = await persist(db, events);
    // Anomaly guard: a run can "succeed" yet return suspiciously few rows (selector
    // drift, partial outage). Flag it so the health page can't show green for ~nothing.
    const base = baseline.get(source) ?? null;
    const anomalyGaps = [...gaps];
    if (events.length === 0) {
      anomalyGaps.push(`${source}: 0 eventos recolectados — posible caída de la fuente o día sin actividad.`);
    } else if (base && events.length < base * 0.5) {
      anomalyGaps.push(
        `${source}: ${events.length} eventos, muy por debajo de la mediana histórica (${base}) — revisar la fuente.`,
      );
    }
    await recordIngestionRun(db, {
      source,
      seen: events.length,
      inserted,
      ok: true,
      details: anomalyGaps.length ? { gaps: anomalyGaps } : null,
    });
    log(`  ✔ ${events.length} events (${inserted} new)` + (anomalyGaps.length ? ` · ${anomalyGaps.length} gap(s)` : ""));
    anomalyGaps.forEach((g) => log(`    ⚠ ${g}`));
    return { source, ok: true, events: events.length, inserted, gaps: anomalyGaps };
  } catch (err) {
    const error = (err as Error).message;
    // Don't pollute volume metrics with a 0 on failure — leave seen unset.
    await recordIngestionRun(db, { source, ok: false, error });
    log(`  ✖ FAILED: ${error}`);
    return { source, ok: false, events: 0, inserted: 0, gaps: [], error };
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
    await runSource(db, "dip-oficial", baseline, () => new DipOficialAdapter().collect({ limit: 30 }), log),
  );
  // parsePdfs:false — the WPFD file URL serves an HTML viewer, not raw PDF bytes, so
  // per-agenda code-linking is deferred (flagged as a gap) rather than failing 36 PDFs daily.
  summaries.push(
    await runSource(db, "senado", baseline, () => new SenadoAdapter().collect({ parsePdfs: false }), log),
  );

  return summaries;
}
