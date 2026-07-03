/**
 * Document pipeline — two phases, kept separate so each can run where it's reachable.
 *
 *  1. ingestDocuments(): sweep each initiative's `documentos` (SIL JSON, reachable over
 *     normal HTTP) → upsert document metadata + the official VerDocumento URL into the
 *     `documents` table. This is what the dashboard links to per initiative.
 *
 *  2. fetchDocumentFiles(): download the actual PDF bytes and store them as `{code}.pdf`
 *     via the pluggable storage backend (local now, SharePoint later). The Cámara file
 *     host (:8095) may only be reachable from certain networks, so this phase is split
 *     out and can run on the DR-side machine without blocking metadata ingestion.
 */
import {
  listInitiativesForDocuments,
  listDocumentsToFetch,
  upsertDocument,
  type Database,
} from "@oculis/db";
import { SilDiputadosAdapter, fetchBytes, type SilDocumento } from "@oculis/scrapers";
import { createStorage } from "./storage.js";

/** Keep only a valid yyyy-mm-dd prefix ("2026-06-18T00:00:00" → "2026-06-18"). */
export function isoDay(v: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v ?? "");
  return m ? m[1]! : null;
}

/**
 * Single mapping from a SIL `documento` to a `documents` row — shared by the corpus
 * document sweep and the deposits sync so the two paths can't drift apart again.
 * Semantics (the stricter of the two former copies):
 *  - initiativeCode: the initiative's own code wins (it names the archived
 *    `{code}.pdf` and resolves the FK by code); the doc's label is only a fallback;
 *  - uploadedAt: regex-validated yyyy-mm-dd, never a blind `.slice()`;
 *  - docType/extension: trimmed, empty → null — no fabricated "pdf" default.
 */
export function toDocumentRow(
  adapter: SilDiputadosAdapter,
  d: SilDocumento,
  initiative: { id: number; code: string | null },
) {
  return {
    source: "sil-diputados",
    initiativeId: initiative.id,
    initiativeCode: initiative.code ?? d.documento ?? null,
    docType: (d.descripcion ?? "").trim() || null,
    extension: (d.extension ?? "").trim() || null,
    url: adapter.documentUrl(d.id),
    uploadedAt: isoDay(d.cargado),
    sourceDocId: String(d.id),
  };
}

export interface DocIngestSummary {
  initiatives: number;
  documents: number;
  newDocuments: number;
}

/** Phase 1: populate document metadata + official URLs for every initiative. */
export async function ingestDocuments(
  db: Database,
  opts: { limit?: number; delayMs?: number; log?: (m: string) => void } = {},
): Promise<DocIngestSummary> {
  const { limit, delayMs = 60, log = () => {} } = opts;
  const adapter = new SilDiputadosAdapter();
  const rows = await listInitiativesForDocuments(db, { source: "sil-diputados", limit });
  log(`  scanning documents for ${rows.length} initiatives`);

  let documents = 0;
  let newDocuments = 0;
  for (const [i, row] of rows.entries()) {
    let docs;
    try {
      docs = await adapter.documentos(row.sourceId);
    } catch {
      continue; // best-effort; a single initiative's doc failure shouldn't stop the sweep
    }
    for (const d of docs) {
      documents++;
      const inserted = await upsertDocument(db, toDocumentRow(adapter, d, row));
      if (inserted) newDocuments++;
    }
    if ((i + 1) % 50 === 0) log(`  …${i + 1}/${rows.length} (${documents} docs)`);
    if (delayMs) await sleep(delayMs);
  }
  return { initiatives: rows.length, documents, newDocuments };
}

export interface DocFetchSummary {
  attempted: number;
  stored: number;
  skipped: number;
  failed: number;
  backend: string;
}

/**
 * Rank a document by how likely it is to BE the bill text (vs procedural paperwork),
 * from its SIL `descripcion` label. Higher wins the canonical `{code}.pdf` slot.
 */
function billTextScore(docType: string | null): number {
  const t = (docType ?? "").toLowerCase();
  if (/proyecto\s+depositado/.test(t)) return 3; // the deposited bill text itself
  if (/proyecto|iniciativa|texto/.test(t)) return 2; // some version of the text
  if (/acuse|informe|oficio|remisi|comunicaci/.test(t)) return 0; // paperwork
  return 1; // unknown label — better than paperwork, worse than an explicit text
}

/**
 * Phase 2: download the actual files. Per initiative, the document that best matches
 * the bill text (by its SIL label) is archived under the canonical `{code}.pdf` name;
 * every other document is archived as `{code}-{docId}.pdf` instead of being skipped
 * forever (the old behavior stored an arbitrary first-fetchable doc as `{code}.pdf`
 * and permanently dropped the rest). Idempotent — skips files already stored. Run
 * where the document host is reachable.
 */
export async function fetchDocumentFiles(
  db: Database,
  opts: { limit?: number; delayMs?: number; log?: (m: string) => void } = {},
): Promise<DocFetchSummary> {
  const { limit, delayMs = 150, log = () => {} } = opts;
  const storage = createStorage();
  const docs = await listDocumentsToFetch(db, { limit });
  log(`  fetching up to ${docs.length} document files → ${storage.kind}`);

  // Group per initiative so the best-labelled doc claims the `{code}.pdf` slot.
  const byCode = new Map<string, typeof docs>();
  for (const d of docs) {
    if (!d.url || !d.initiativeCode) continue;
    const list = byCode.get(d.initiativeCode) ?? [];
    list.push(d);
    byCode.set(d.initiativeCode, list);
  }

  let stored = 0;
  let skipped = 0;
  let failed = 0;
  let attempted = 0;
  for (const [code, list] of byCode) {
    list.sort((a, b) => billTextScore(b.docType) - billTextScore(a.docType) || b.id - a.id);
    for (const [idx, d] of list.entries()) {
      const name = idx === 0 ? code : `${code}-${d.id}`;
      attempted++;
      if (await storage.has(name, "pdf")) {
        skipped++;
        continue;
      }
      try {
        const { bytes, contentType } = await fetchBytes(d.url!);
        const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
        if (head !== "%PDF-" && !/application\/pdf/i.test(contentType)) {
          failed++;
          continue;
        }
        await storage.put(name, "pdf", bytes);
        stored++;
      } catch {
        failed++;
      }
      if (delayMs) await sleep(delayMs);
    }
  }
  return { attempted, stored, skipped, failed, backend: storage.kind };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
