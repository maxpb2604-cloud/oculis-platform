/**
 * Offline keyword-search backfill: recompute `search_text` = keywordBlob(row) for every
 * initiative so the intensive synonym/typo-tolerant search (searchInitiatives) has data.
 *
 * Fully offline — NO API, NO network. Uses the curated @oculis/core thesaurus only. The
 * generated `search_tsv` tsvector column updates itself from search_text, so writing the
 * blob is all that's needed. Run via `npm run reindex-search -w @oculis/worker`.
 */
import { keywordBlob } from "@oculis/core";
import { listForSearchIndex, saveSearchText, type Database } from "@oculis/db";

export interface ReindexResult {
  processed: number;
  updated: number;
}

export async function reindexSearch(
  db: Database,
  opts: { log?: (msg: string) => void } = {},
): Promise<ReindexResult> {
  const { log = () => {} } = opts;
  const rows = await listForSearchIndex(db);
  log(`  recomputing search_text for ${rows.length} initiatives (offline thesaurus)…`);

  let updated = 0;
  for (const row of rows) {
    const blob = keywordBlob(row);
    await saveSearchText(db, row.id, blob);
    updated++;
    if (updated % 250 === 0) log(`  …${updated}/${rows.length} reindexed`);
  }
  return { processed: rows.length, updated };
}
