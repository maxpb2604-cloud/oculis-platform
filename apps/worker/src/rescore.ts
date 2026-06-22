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
  log?: (msg: string) => void;
}

export async function rescoreAll(
  db: Database,
  opts: RescoreOptions = {},
): Promise<{ scored: number; byRisk: Record<string, number> }> {
  const { concurrency = 6, log = () => {} } = opts;
  const estimator = createScoreEstimator();
  log(`  scorer: ${estimator.kind} · concurrency ${concurrency}`);

  const rows = await listForScoring(db);
  const byRisk: Record<string, number> = {};
  let scored = 0;

  // simple fixed-size worker pool over the row list
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++]!;
      const risk = await scoreInitiative(db, estimator, row);
      if (risk) byRisk[risk] = (byRisk[risk] ?? 0) + 1;
      scored++;
      if (scored % 25 === 0) log(`  …${scored}/${rows.length} scored`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return { scored, byRisk };
}
