/**
 * (Re)categorize initiatives already in the database — no re-scraping. Runs the
 * real categorizer (Claude when opted in, heuristic otherwise) over stored rows.
 * Used by `worker --recategorize [--only-missing]`.
 *
 * `--only-missing` is the backlog-clearing mode: it touches ONLY rows whose
 * category is NULL, so already-classified rows keep their (possibly higher
 * quality) category. Rows the categorizer can't place stay NULL and are counted.
 */
import { listForCategorizing, saveCategory, type Database } from "@oculis/db";
import { createCategorizer } from "./categorize.js";

export interface RecategorizeOptions {
  concurrency?: number;
  /** Only categorize rows that have no category yet — never overwrites. */
  onlyMissing?: boolean;
  log?: (msg: string) => void;
}

export async function recategorizeAll(
  db: Database,
  opts: RecategorizeOptions = {},
): Promise<{ processed: number; categorized: number; unresolved: number; byCategory: Record<string, number> }> {
  const { concurrency = 6, onlyMissing = false, log = () => {} } = opts;
  const categorizer = createCategorizer();
  log(`  categorizer: ${categorizer.kind} · concurrency ${concurrency}${onlyMissing ? " · only missing" : ""}`);

  const rows = await listForCategorizing(db, { onlyMissing });
  const byCategory: Record<string, number> = {};
  let processed = 0;
  let categorized = 0;

  // simple fixed-size worker pool over the row list (mirrors rescore.ts)
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++]!;
      try {
        const res = await categorizer.categorize({
          title: row.title,
          sourceCategory: row.sourceCategory,
          purpose: row.purpose,
        });
        if (res.category) {
          await saveCategory(db, row.id, res.category, res.confidence);
          byCategory[res.category] = (byCategory[res.category] ?? 0) + 1;
          categorized++;
        }
      } catch {
        // best-effort per row; unresolved rows stay NULL and are counted below
      }
      processed++;
      if (processed % 25 === 0) log(`  …${processed}/${rows.length} processed`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const unresolved = processed - categorized;
  if (unresolved > 0) log(`  ⚠ ${unresolved} fila(s) siguen sin categoría (el clasificador no las pudo ubicar)`);
  return { processed, categorized, unresolved, byCategory };
}
