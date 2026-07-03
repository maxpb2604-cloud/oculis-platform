/**
 * Ingest the daily committee agenda (SIL "actividad" subsystem).
 *
 * Separate from `ingest.ts` (which crawls the bill corpus): this captures "what the
 * chamber worked on today" — committee meetings — and links each agenda item to the
 * initiatives it references. Plenary órdenes del día are deliberately NOT ingested
 * here: the adapter's collect() only emits COMMITTEE events (dip-oficial is the
 * canonical plenary source; SIL's plenary feed is parsed only as a health canary).
 * Run it frequently (hourly on session days) to detect same-day activity that the
 * slow-moving iniciativa endpoints miss.
 */
import {
  recordIngestionRun,
  upsertActivityEvent,
  type Database,
} from "@oculis/db";
import { SilActividadAdapter } from "@oculis/scrapers";

export interface ActivityIngestSummary {
  seen: number;
  inserted: number;
  linkedCodes: number;
  gaps: string[];
}

export async function ingestActivity(
  db: Database,
  opts: { log?: (msg: string) => void } = {},
): Promise<ActivityIngestSummary> {
  const { log = () => {} } = opts;
  const adapter = new SilActividadAdapter();
  log(`  source: ${adapter.source} (committee agenda; plenary comes via dip-oficial)`);

  try {
    // collect() (not list()) so the adapter's reconciliation gaps reach the health row
    // instead of being silently discarded.
    const { events, gaps } = await adapter.collect();

    let inserted = 0;
    let linkedCodes = 0;
    for (const ev of events) {
      linkedCodes += ev.initiativeCodes.length;
      // pass the full event (chamber/agendaUrl/statuses included) — mapping a subset
      // here previously nulled out fields the --daily path had written.
      const res = await upsertActivityEvent(db, ev);
      if (res.inserted) inserted++;
    }

    // Health row (same source key as the --daily pass) so an --activity run is
    // visible on "Estado de monitoreo" too.
    await recordIngestionRun(db, {
      source: adapter.source,
      seen: events.length,
      inserted,
      ok: true,
      details: gaps.length ? { gaps } : null,
    });
    gaps.forEach((g) => log(`  ⚠ ${g}`));

    return { seen: events.length, inserted, linkedCodes, gaps };
  } catch (err) {
    await recordIngestionRun(db, {
      source: adapter.source,
      ok: false,
      error: (err as Error).message,
    });
    throw err;
  }
}
