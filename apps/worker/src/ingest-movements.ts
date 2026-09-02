/**
 * Refresh the official SIL status-history endpoint for every stored Diputados bill.
 *
 * This deliberately records only `historicos[].estado`; agenda appearances and text
 * similarity never become initiative status events.
 */
import {
  beginIngestionRun,
  listInitiativesForDocuments,
  recordIngestionRun,
  reconcileStatusHistorySnapshot,
  type Database,
} from "@oculis/db";
import { extractLeadingISODate, SilDiputadosAdapter } from "@oculis/scrapers";

export const MOVEMENTS_SOURCE = "sil-movements";

export interface MovementSummary {
  source: typeof MOVEMENTS_SOURCE;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  initiatives: number;
  checked: number;
  statusEventsSeen: number;
  statusEventsInserted: number;
  statusEventsReactivated: number;
  statusEventsRetired: number;
  failures: number;
  error?: string;
}

export async function ingestMovements(
  db: Database,
  opts: {
    limit?: number;
    concurrency?: number;
    delayMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<MovementSummary> {
  const { limit, concurrency = 4, delayMs = 75, log = () => {} } = opts;
  const adapter = new SilDiputadosAdapter();
  // This DB reader provides exactly the ids needed here despite its historical name.
  const rows = await listInitiativesForDocuments(db, {
    source: adapter.source,
    limit,
  });
  const runId = await beginIngestionRun(db, MOVEMENTS_SOURCE, {
    initiativeSource: adapter.source,
    requestedLimit: limit ?? null,
  });
  let cursor = 0;
  let checked = 0;
  let statusEventsSeen = 0;
  let statusEventsInserted = 0;
  let statusEventsReactivated = 0;
  let statusEventsRetired = 0;
  let failures = 0;
  const failureExamples: string[] = [];

  async function worker(): Promise<void> {
    for (;;) {
      const row = rows[cursor++];
      if (!row) return;
      try {
        const history = await adapter.historicos(row.sourceId);
        if (history.length === 0) {
          throw new Error("official history returned an empty snapshot");
        }
        const events = history.map((item) => {
          const status = item.estado?.trim();
          if (!status) throw new Error("official history row has no literal status");
          return {
            sourceEventId:
              item.id == null || String(item.id).trim() === "" ? null : String(item.id).trim(),
            status,
            date: extractLeadingISODate(item.inicio),
            endDate: extractLeadingISODate(item.fin),
            note: null,
            source: adapter.source,
            sourceUrl: `https://www.diputadosrd.gob.do/sil/iniciativa/${row.sourceId}`,
            evidenceType: "SOURCE_HISTORY" as const,
            raw: item,
          };
        });
        statusEventsSeen += events.length;
        const reconciled = await reconcileStatusHistorySnapshot(
          db,
          row.id,
          adapter.source,
          events,
          { complete: true },
        );
        statusEventsInserted += reconciled.inserted;
        statusEventsReactivated += reconciled.reactivated;
        statusEventsRetired += reconciled.retired;
      } catch (error) {
        failures++;
        if (failureExamples.length < 10) {
          failureExamples.push(`${row.sourceId}: ${(error as Error).message}`);
        }
      } finally {
        checked++;
        if (checked % 100 === 0) log(`  …${checked}/${rows.length} initiatives checked`);
        if (delayMs) await sleep(delayMs);
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, rows.length || 1)) }, () => worker()),
    );
    const ok = failures === 0;
    const outcome = ok ? "COMPLETE" : "PARTIAL";
    const error = ok ? undefined : `${failures} official history request(s) failed`;
    await recordIngestionRun(db, {
      source: MOVEMENTS_SOURCE,
      runId,
      seen: checked,
      statusChanges: statusEventsInserted,
      ok,
      outcome,
      error,
      details: {
        initiativeSource: adapter.source,
        officialEndpoint: "iniciativa/historicos",
        statusEventsSeen,
        statusEventsReactivated,
        statusEventsRetired,
        failures,
        failureExamples,
      },
    });
    return {
      source: MOVEMENTS_SOURCE,
      ok,
      outcome,
      initiatives: rows.length,
      checked,
      statusEventsSeen,
      statusEventsInserted,
      statusEventsReactivated,
      statusEventsRetired,
      failures,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    const message = (error as Error).message;
    await recordIngestionRun(db, {
      source: MOVEMENTS_SOURCE,
      runId,
      seen: checked,
      statusChanges: statusEventsInserted,
      ok: false,
      error: message,
      details: {
        statusEventsSeen,
        statusEventsReactivated,
        statusEventsRetired,
        failures,
        failureExamples,
      },
    });
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
