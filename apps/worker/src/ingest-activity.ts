/**
 * Ingest the daily committee + plenary agenda (SIL "actividad" subsystem).
 *
 * Separate from `ingest.ts` (which crawls the bill corpus): this captures "what the
 * chamber worked on today" — committee meetings and plenary orders — and links each
 * agenda item to the initiatives it references. The configured workflow runs it three
 * times per day; each execution records its observed coverage and gaps.
 */
import { upsertActivityEvent, type Database } from "@oculis/db";
import { SilActividadAdapter } from "@oculis/scrapers";

export interface ActivityIngestSummary {
  seen: number;
  inserted: number;
  linkedCodes: number;
  committee: number;
  plenary: number;
}

export async function ingestActivity(
  db: Database,
  opts: { log?: (msg: string) => void } = {},
): Promise<ActivityIngestSummary> {
  const { log = () => {} } = opts;
  const adapter = new SilActividadAdapter();
  log(`  source: ${adapter.source} (committee + plenary agenda)`);

  let seen = 0;
  let inserted = 0;
  let linkedCodes = 0;
  let committee = 0;
  let plenary = 0;

  for await (const ev of adapter.list()) {
    seen++;
    if (ev.scope === "COMMITTEE") committee++;
    else plenary++;
    linkedCodes += ev.initiativeCodes.length;
    // pass the full event (chamber/agendaUrl/statuses included) — mapping a subset
    // here previously nulled out fields the --daily path had written.
    const res = await upsertActivityEvent(db, ev);
    if (res.inserted) inserted++;
  }

  return { seen, inserted, linkedCodes, committee, plenary };
}
