/**
 * Ingest the daily committee + plenary agenda (SIL "actividad" subsystem).
 *
 * Separate from `ingest.ts` (which crawls the bill corpus): this captures "what the
 * chamber worked on today" — committee meetings and plenary orders — and links each
 * agenda item to the initiatives it references. The configured workflow runs it three
 * times per day; each execution records its observed coverage and gaps.
 */
import {
  beginIngestionRun,
  recordIngestionRun,
  upsertActivityEvent,
  type Database,
} from "@oculis/db";
import { SilActividadAdapter, type RawActivityEvent } from "@oculis/scrapers";
import { classifyAgendaSourceGaps } from "./source-coverage.js";

export interface ActivityIngestSummary {
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  seen: number;
  inserted: number;
  linkedCodes: number;
  committee: number;
  plenary: number;
  gaps: string[];
  coverageNotes: string[];
}

export interface ActivityIngestAdapter {
  readonly source: string;
  list(): AsyncIterable<RawActivityEvent>;
  collect?(): Promise<{ events: RawActivityEvent[]; gaps: string[] }>;
}

interface ActivityIngestOptions {
  log?: (msg: string) => void;
  /** Test/alternate-source seam; production keeps using the official SIL adapter. */
  adapter?: ActivityIngestAdapter;
}

const INGEST_MODE = "COMMITTEE_AND_PLENARY_AGENDA";

export async function ingestActivity(
  db: Database,
  opts: ActivityIngestOptions = {},
): Promise<ActivityIngestSummary> {
  const { log = () => {}, adapter = new SilActividadAdapter() } = opts;
  log(`  source: ${adapter.source} (committee + plenary agenda)`);

  const runId = await beginIngestionRun(db, adapter.source, { mode: INGEST_MODE });

  let seen = 0;
  let inserted = 0;
  let updated = 0;
  let linkedCodes = 0;
  let committee = 0;
  let plenary = 0;

  try {
    const observation = adapter.collect ? await adapter.collect() : null;
    const assessment = classifyAgendaSourceGaps(adapter.source, observation?.gaps ?? []);
    const stream = observation ? streamEvents(observation.events) : adapter.list();
    for await (const ev of stream) {
      seen++;
      if (ev.scope === "COMMITTEE") committee++;
      else plenary++;
      linkedCodes += ev.initiativeCodes.length;
      // pass the full event (chamber/agendaUrl/statuses included) — mapping a subset
      // here previously nulled out fields the --daily path had written.
      const res = await upsertActivityEvent(db, ev);
      if (res.inserted) inserted++;
      else updated++;
    }

    const outcome = assessment.gaps.length ? "PARTIAL" : "COMPLETE";
    const summary: ActivityIngestSummary = {
      ok: true,
      outcome,
      seen,
      inserted,
      linkedCodes,
      committee,
      plenary,
      gaps: assessment.gaps,
      coverageNotes: assessment.coverageNotes,
    };
    await recordIngestionRun(db, {
      runId,
      source: adapter.source,
      seen,
      inserted,
      updated,
      ok: true,
      outcome,
      details: {
        mode: INGEST_MODE,
        committee,
        plenary,
        linkedCodes,
        gaps: assessment.gaps,
        coverageNotes: assessment.coverageNotes,
      },
    });
    assessment.gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    assessment.coverageNotes.forEach((note) => log(`    ℹ ${note}`));
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordIngestionRun(db, {
      runId,
      source: adapter.source,
      seen,
      inserted,
      updated,
      ok: false,
      outcome: "FAILED",
      error: message,
      details: { mode: INGEST_MODE, committee, plenary, linkedCodes },
    });
    log(`  ✖ FAILED: ${message}`);
    throw error;
  }
}

async function* streamEvents(events: readonly RawActivityEvent[]): AsyncIterable<RawActivityEvent> {
  yield* events;
}
