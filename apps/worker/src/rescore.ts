/**
 * Re-score every initiative already in the database (no re-scraping). Runs the real
 * scorer (Claude/heuristic) over stored rows, with bounded concurrency to stay within
 * API rate limits. Used by `worker --rescore`.
 */
import { listForScoring, type Database } from "@oculis/db";
import { createScoreEstimator } from "./score.js";
import { scoreInitiative } from "./ingest.js";

export interface RescoreOptions {
  concurrency?: number;
  /** Only score rows that have no risk_level yet — never overwrites existing scores. */
  onlyMissing?: boolean;
  log?: (msg: string) => void;
}

export async function rescoreAll(
  db: Database,
  opts: RescoreOptions = {},
): Promise<{ scored: number; failed: number; byRisk: Record<string, number> }> {
  const { concurrency = 6, onlyMissing = false, log = () => {} } = opts;
  const estimator = createScoreEstimator();
  log(`  scorer: ${estimator.kind} · concurrency ${concurrency}${onlyMissing ? " · only missing" : ""}`);

  const rows = await listForScoring(db, { onlyMissing });
  const byRisk: Record<string, number> = {};
  let scored = 0;
  let failed = 0;

  // simple fixed-size worker pool over the row list
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++]!;
      const risk = await scoreInitiative(db, estimator, row);
      if (risk) byRisk[risk] = (byRisk[risk] ?? 0) + 1;
      else failed++; // scoreInitiative is best-effort; surface the count instead of silence
      scored++;
      if (scored % 25 === 0) log(`  …${scored}/${rows.length} scored`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (failed > 0) log(`  ⚠ ${failed} fila(s) no se pudieron puntuar (quedan sin score)`);
  return { scored, failed, byRisk };
}
