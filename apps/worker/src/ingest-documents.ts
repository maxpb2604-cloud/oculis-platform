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
import {
  extractLeadingISODate,
  SilDiputadosAdapter,
  fetchBytes,
  type SilDocumento,
} from "@oculis/scrapers";
import { createHash } from "node:crypto";
import { createStorage } from "./storage.js";

export const DOCUMENT_DISCOVERY_SOURCE = "sil-documents" as const;

export interface DocumentDiscoveryAdapter {
  documentos(id: string | number): Promise<SilDocumento[]>;
  documentUrl(documentoId: string | number): string;
}

export interface DocIngestSummary {
  source: typeof DOCUMENT_DISCOVERY_SOURCE;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  selection: "all" | "missing-deposited";
  /** Rows selected for this run after applying the optional limit. */
  candidates: number;
  /** Complete current backlog, before applying the run limit. */
  missingDepositedCandidates: number;
  initiatives: number;
  documents: number;
  newDocuments: number;
  emptyObservations: number;
  failures: number;
  error?: string;
}

interface PreparedDocument {
  sourceDocId: string;
  initiativeCode: string | null;
  docType: string | null;
  extension: string | null;
  url: string;
  uploadedAt: string | null;
  raw: SilDocumento;
}

/** Validate the complete official snapshot before the first write for this initiative. */
function prepareDocumentSnapshot(
  docs: unknown,
  adapter: DocumentDiscoveryAdapter,
  fallbackCode: string | null,
): PreparedDocument[] {
  if (!Array.isArray(docs)) throw new Error("official documentos response is not an array");
  const ids = new Set<number>();
  for (const value of docs) {
    if (!value || typeof value !== "object") {
      throw new Error("official documentos response contains a non-object row");
    }
    const id = (value as { id?: unknown }).id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
      throw new Error(`official documentos response contains invalid id ${String(id)}`);
    }
    if (ids.has(id)) {
      throw new Error(`official documentos response contains duplicate id ${id}`);
    }
    ids.add(id);
  }

  // Build every URL and normalized field before returning. A malformed row therefore
  // cannot leave a partially written snapshot even when an injected adapter rejects it.
  return (docs as SilDocumento[]).map((d) => ({
    sourceDocId: String(d.id),
    initiativeCode: d.documento?.trim() || fallbackCode || null,
    docType: (d.descripcion ?? "").trim() || null,
    extension: d.extension?.trim() || null,
    url: adapter.documentUrl(d.id),
    uploadedAt: extractLeadingISODate(d.cargado),
    raw: d,
  }));
}

function emptyObservationEvidence(sourceIds: string[], observedAt: string) {
  const sorted = [...sourceIds].sort();
  const digest = createHash("sha256").update(sorted.join("\n")).digest("hex");
  return {
    observedAt,
    count: sorted.length,
    sourceIdsSha256: digest,
    // Missing-only sweeps are normally small. Retain the exact set when reasonable;
    // for unexpectedly large full sweeps retain a bounded diagnostic sample + digest.
    ...(sorted.length <= 500
      ? { sourceIds: sorted }
      : { sourceIdExamples: sorted.slice(0, 50), sourceIdsTruncated: true }),
  };
}

/** Phase 1: populate document metadata + official URLs for every initiative. */
export async function ingestDocuments(
  db: Database,
  opts: {
    limit?: number;
    delayMs?: number;
    concurrency?: number;
    missingDepositedOnly?: boolean;
    adapter?: DocumentDiscoveryAdapter;
    now?: () => Date;
    log?: (m: string) => void;
  } = {},
): Promise<DocIngestSummary> {
  const {
    limit,
    delayMs = 60,
    concurrency = 6,
    missingDepositedOnly = false,
    adapter = new SilDiputadosAdapter(),
    now = () => new Date(),
    log = () => {},
  } = opts;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new Error("document concurrency must be an integer from 1 to 12");
  }
  const selection = missingDepositedOnly ? "missing-deposited" : "all";
  const runId = await beginIngestionRun(db, DOCUMENT_DISCOVERY_SOURCE, {
    requestedLimit: limit ?? null,
    selection,
  });
  let candidates = 0;
  let missingDepositedCandidates = 0;
  let documents = 0;
  let newDocuments = 0;
  let emptyObservations = 0;
  let failures = 0;
  let completed = 0;
  const failureExamples: string[] = [];
  const emptySourceIds: string[] = [];
  let observedAt: string | null = null;

  const summary = (outcome: DocIngestSummary["outcome"], error?: string): DocIngestSummary => ({
    source: DOCUMENT_DISCOVERY_SOURCE,
    ok: outcome === "COMPLETE",
    outcome,
    selection,
    candidates,
    missingDepositedCandidates,
    initiatives: candidates,
    documents,
    newDocuments,
    emptyObservations,
    failures,
    ...(error ? { error } : {}),
  });

  const finish = async (result: DocIngestSummary) => {
    await recordIngestionRun(db, {
      source: DOCUMENT_DISCOVERY_SOURCE,
      runId,
      seen: candidates,
      inserted: newDocuments,
      ok: result.ok,
      outcome: result.outcome,
      error: result.error,
      details: {
        selection,
        candidates,
        missingDepositedCandidates,
        documents,
        failures,
        failureExamples,
        emptyObservation: emptyObservationEvidence(emptySourceIds, observedAt ?? "unavailable"),
      },
    });
    return result;
  };

  try {
    observedAt = now().toISOString();
    const missingRows = await listInitiativesForDocuments(db, {
      source: "sil-diputados",
      missingDepositedOnly: true,
    });
    missingDepositedCandidates = missingRows.length;
    const rows = missingDepositedOnly
      ? limit
        ? missingRows.slice(0, limit)
        : missingRows
      : await listInitiativesForDocuments(db, { source: "sil-diputados", limit });
    candidates = rows.length;
    log(
      `  scanning ${candidates} candidate initiative(s); ` +
        `${missingDepositedCandidates} currently lack an exact deposited document`,
    );

    const inFlight = new Set<Promise<void>>();
    async function processRow(row: (typeof rows)[number]): Promise<void> {
      try {
        const prepared = prepareDocumentSnapshot(
          await adapter.documentos(row.sourceId),
          adapter,
          row.code,
        );
        if (prepared.length === 0) {
          emptyObservations++;
          emptySourceIds.push(row.sourceId);
        }
        documents += prepared.length;
        const insertedForInitiative = await db.transaction(async (tx) => {
          let insertedCount = 0;
          for (const d of prepared) {
            const inserted = await upsertDocument(tx as Database, {
              source: "sil-diputados",
              // Exact parent identity from the queried DB row. The source's code/title is
              // never used to guess or redirect the association.
              initiativeId: row.id,
              initiativeCode: d.initiativeCode,
              docType: d.docType,
              extension: d.extension,
              url: d.url,
              uploadedAt: d.uploadedAt,
              sourceDocId: d.sourceDocId,
              raw: d.raw,
            });
            if (inserted) insertedCount++;
          }
          return insertedCount;
        });
        // Publish counters only after commit; a rejected second document rolls back the
        // whole authoritative snapshot and cannot inflate the new-document count.
        newDocuments += insertedForInitiative;
      } catch (error) {
        failures++;
        if (failureExamples.length < 10) {
          failureExamples.push(`${row.sourceId}: ${(error as Error).message}`);
        }
      }
    }

    for (const row of rows) {
      const task = processRow(row).finally(() => {
        completed++;
        if (completed % 50 === 0 || completed === rows.length) {
          log(`  …${completed}/${rows.length} (${documents} docs)`);
        }
        inFlight.delete(task);
      });
      inFlight.add(task);
      if (inFlight.size >= concurrency) await Promise.race(inFlight);
      if (delayMs) await sleep(delayMs);
    }
    await Promise.all(inFlight);
    const error = failures ? `${failures} official document-list request(s) failed` : undefined;
    return finish(summary(failures ? "PARTIAL" : "COMPLETE", error));
  } catch (error) {
    failures++;
    const message = `document discovery failed: ${(error as Error).message}`;
    if (failureExamples.length < 10) failureExamples.push(message);
    return finish(summary("FAILED", message));
  }
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
