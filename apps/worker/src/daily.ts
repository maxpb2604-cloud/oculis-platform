/**
 * Daily monitoring orchestrator — Phase 1.
 *
 * Runs every source for BOTH chambers in one pass and records a per-source health
 * row so the dashboard's "Estado de monitoreo" page can show what ran, what it found,
 * and any flagged gaps (e.g. the Senate Expedientes portal). Designed to be run on a
 * schedule (launchd) every morning, and safely re-runnable by hand.
 *
 *   1. SIL Diputados   — committee/plenary agenda (sil-actividad)
 *   2. Diputados oficial — plenary órdenes del día PDFs (reading statuses)
 *   3. Senado          — órdenes del día (Pleno/Asamblea) + weekly committee agenda
 *
 * Each source is isolated: a failure in one is recorded and does not abort the others.
 */
import {
  recordIngestionRun,
  upsertActivityEvent,
  type Database,
} from "@oculis/db";
import {
  DipOficialAdapter,
  SenadoAdapter,
  SilActividadAdapter,
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

async function runSource(
  db: Database,
  source: string,
  fn: () => Promise<{ events: number; inserted: number; gaps: string[] }>,
  log: Log,
): Promise<DailySummary> {
  log(`\n▶ ${source}`);
  try {
    const r = await fn();
    await recordIngestionRun(db, {
      source,
      seen: r.events,
      inserted: r.inserted,
      ok: true,
      details: r.gaps.length ? { gaps: r.gaps } : null,
    });
    log(`  ✔ ${r.events} events (${r.inserted} new)` + (r.gaps.length ? ` · ${r.gaps.length} gap(s)` : ""));
    r.gaps.forEach((g) => log(`    ⚠ ${g}`));
    return { source, ok: true, events: r.events, inserted: r.inserted, gaps: r.gaps };
  } catch (err) {
    const error = (err as Error).message;
    await recordIngestionRun(db, { source, ok: false, error });
    log(`  ✖ FAILED: ${error}`);
    return { source, ok: false, events: 0, inserted: 0, gaps: [], error };
  }
}

export async function runDaily(db: Database, opts: { log?: Log } = {}): Promise<DailySummary[]> {
  const log = opts.log ?? (() => {});
  const summaries: DailySummary[] = [];

  // 1. SIL Diputados — committee + plenary agenda
  summaries.push(
    await runSource(db, "sil-actividad", async () => {
      const adapter = new SilActividadAdapter();
      let events = 0;
      let inserted = 0;
      for await (const ev of adapter.list()) {
        events++;
        const r = await upsertActivityEvent(db, ev);
        if (r.inserted) inserted++;
      }
      return { events, inserted, gaps: [] };
    }, log),
  );

  // 2. Diputados oficial — plenary órdenes del día (PDF, reading statuses)
  summaries.push(
    await runSource(db, "dip-oficial", async () => {
      const adapter = new DipOficialAdapter();
      let events = 0;
      let inserted = 0;
      for await (const ev of adapter.list({ limit: 6 })) {
        events++;
        const r = await upsertActivityEvent(db, ev);
        if (r.inserted) inserted++;
      }
      return { events, inserted, gaps: [] };
    }, log),
  );

  // 3. Senado — órdenes del día (Pleno/Asamblea) + weekly committee agenda
  summaries.push(
    await runSource(db, "senado", async () => {
      const adapter = new SenadoAdapter();
      const { events: evs, gaps } = await adapter.collect({ parsePdfs: false });
      let inserted = 0;
      for (const ev of evs) {
        const r = await upsertActivityEvent(db, ev);
        if (r.inserted) inserted++;
      }
      return { events: evs.length, inserted, gaps };
    }, log),
  );

  return summaries;
}
