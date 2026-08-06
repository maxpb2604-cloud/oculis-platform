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
  beginIngestionRun,
  listInitiativesForDocuments,
  listDocumentsToFetch,
  recordIngestionRun,
  upsertDocument,
  type Database,
} from "@oculis/db";
import { extractLeadingISODate, SilDiputadosAdapter, fetchBytes } from "@oculis/scrapers";
import { createStorage } from "./storage.js";

export interface DocIngestSummary {
  source: "sil-documents";
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  initiatives: number;
  documents: number;
  newDocuments: number;
  failures: number;
  error?: string;
}

/** Phase 1: populate document metadata + official URLs for every initiative. */
export async function ingestDocuments(
  db: Database,
  opts: { limit?: number; delayMs?: number; log?: (m: string) => void } = {},
): Promise<DocIngestSummary> {
  const { limit, delayMs = 60, log = () => {} } = opts;
  const adapter = new SilDiputadosAdapter();
  const rows = await listInitiativesForDocuments(db, { source: "sil-diputados", limit });
  const runId = await beginIngestionRun(db, "sil-documents", { requestedLimit: limit ?? null });
  log(`  scanning documents for ${rows.length} initiatives`);

  let documents = 0;
  let newDocuments = 0;
  let failures = 0;
  const failureExamples: string[] = [];
  for (const [i, row] of rows.entries()) {
    let docs;
    try {
      docs = await adapter.documentos(row.sourceId);
    } catch (error) {
      failures++;
      if (failureExamples.length < 10) {
        failureExamples.push(`${row.sourceId}: ${(error as Error).message}`);
      }
      continue;
    }
    for (const d of docs) {
      documents++;
      const inserted = await upsertDocument(db, {
        source: "sil-diputados",
        initiativeId: row.id,
        initiativeCode: row.code ?? d.documento ?? null,
        docType: (d.descripcion ?? "").trim() || null,
        extension: d.extension?.trim() || null,
        url: adapter.documentUrl(d.id),
        uploadedAt: extractLeadingISODate(d.cargado),
        sourceDocId: String(d.id),
      });
      if (inserted) newDocuments++;
    }
    if ((i + 1) % 50 === 0) log(`  …${i + 1}/${rows.length} (${documents} docs)`);
    if (delayMs) await sleep(delayMs);
  }
  const ok = failures === 0;
  const outcome = ok ? "COMPLETE" : "PARTIAL";
  const error = ok ? undefined : `${failures} official document-list request(s) failed`;
  await recordIngestionRun(db, {
    source: "sil-documents",
    runId,
    seen: rows.length,
    inserted: newDocuments,
    ok,
    outcome,
    error,
    details: { documents, failures, failureExamples },
  });
  return {
    source: "sil-documents",
    ok,
    outcome,
    initiatives: rows.length,
    documents,
    newDocuments,
    failures,
    ...(error ? { error } : {}),
  };
}

export interface DocFetchSummary {
  attempted: number;
  stored: number;
  skipped: number;
  failed: number;
  backend: string;
}

/**
 * Phase 2: download the actual files and archive them as `{code}.pdf`. Idempotent —
 * skips files already stored. Run where the document host is reachable.
 */
export async function fetchDocumentFiles(
  db: Database,
  opts: { limit?: number; delayMs?: number; log?: (m: string) => void } = {},
): Promise<DocFetchSummary> {
  const { limit, delayMs = 150, log = () => {} } = opts;
  const storage = createStorage();
  const docs = await listDocumentsToFetch(db, { limit });
  log(`  fetching up to ${docs.length} document files → ${storage.kind}`);

  let stored = 0;
  let skipped = 0;
  let failed = 0;
  let attempted = 0;
  for (const d of docs) {
    if (!d.url || !d.initiativeCode) continue;
    attempted++;
    const storageKey = `${d.initiativeCode}__${d.sourceDocId ?? d.id}`;
    if (await storage.has(storageKey, "pdf")) {
      skipped++;
      continue;
    }
    try {
      const { bytes, contentType } = await fetchBytes(d.url);
      const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
      if (head !== "%PDF-" && !/application\/pdf/i.test(contentType)) {
        failed++;
        continue;
      }
      await storage.put(storageKey, "pdf", bytes);
      stored++;
    } catch {
      failed++;
    }
    if (delayMs) await sleep(delayMs);
  }
  return { attempted, stored, skipped, failed, backend: storage.kind };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
