import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginOrResumeDocumentPdfVerificationCycle,
  createDb,
  finishDocumentPdfVerificationCycle,
  latestRunsBySource,
  listDocuments,
  listOfficialDepositedDocumentsForVerification,
  upsertDocument,
  upsertInitiative,
  type Database,
} from "@oculis/db";
import {
  DOCUMENT_PDF_VERIFICATION_MAX_CYCLE_AGE_MS,
  documentPdfVerificationExitCode,
  runDocumentPdfVerificationCycle,
  runVerifyDocumentsBatch,
} from "../src/verify-documents.js";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\ncomplete-mocked-official-document");
const DOCUMENT_TEXT =
  "Texto oficial íntegro y suficientemente largo para verificar el documento depositado sin invocar ningún modelo ni generar un resumen automático.";

function responseAt(
  url: string,
  body: ConstructorParameters<typeof Response>[0] = PDF_BYTES,
  init: ResponseInit = { status: 200, headers: { "content-type": "application/pdf" } },
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { configurable: true, value: url });
  return response;
}

async function seedDocument(
  db: Database,
  key: string,
): Promise<{ documentId: number; initiativeId: number; url: string }> {
  const initiative = await upsertInitiative(db, {
    source: "sil-diputados",
    sourceId: `verify-document-${key}`,
    kind: "LEGISLATIVE",
    code: `VERIFY-${key.toUpperCase()}`,
    title: `Proyecto para verificar ${key}`,
  });
  const url = `https://www.diputadosrd.gob.do/documentos/verify-${key}.pdf`;
  await upsertDocument(db, {
    source: "sil-diputados",
    sourceDocId: `verify-document-file-${key}`,
    initiativeId: initiative.id,
    initiativeCode: `VERIFY-${key.toUpperCase()}`,
    docType: "PROYECTO DEPOSITADO",
    extension: "pdf",
    url,
  });
  const [candidate] = await listOfficialDepositedDocumentsForVerification(db, {
    initiativeId: initiative.id,
    limit: 1,
  });
  assert.ok(candidate);
  return { documentId: candidate.documentId, initiativeId: initiative.id, url };
}

describe("byte-only deposited-document verification", () => {
  it("persists exact PDF availability without a model and skips it on the next sweep", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const fixture = await seedDocument(handle.db, "success");
      let fetches = 0;
      const fetchImpl = (async (input: string | URL | Request) => {
        fetches++;
        return responseAt(String(input));
      }) as typeof fetch;
      const extractor = async () => ({ text: DOCUMENT_TEXT, pages: 2 });

      const first = await runVerifyDocumentsBatch(handle.db, {
        documentId: fixture.documentId,
        fetchImpl,
        extractor,
      });
      assert.deepEqual(
        {
          candidates: first.candidates,
          verified: first.verified,
          newVersions: first.newVersions,
          refreshed: first.refreshed,
          failed: first.failed,
        },
        { candidates: 1, verified: 1, newVersions: 1, refreshed: 0, failed: 0 },
      );
      assert.equal((await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable, true);

      const sweep = await runVerifyDocumentsBatch(handle.db, { fetchImpl, extractor });
      assert.equal(sweep.candidates, 0);
      assert.equal(fetches, 1);

      const failedProbe = await runVerifyDocumentsBatch(handle.db, {
        documentId: fixture.documentId,
        fetchImpl: (async (input: string | URL | Request) =>
          responseAt(String(input), "Este archivo no existe.", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          })) as typeof fetch,
        extractor,
      });
      assert.equal(failedProbe.failed, 1);
      assert.equal((await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable, false);

      const explicitRefresh = await runVerifyDocumentsBatch(handle.db, {
        documentId: fixture.documentId,
        fetchImpl,
        extractor,
      });
      assert.equal(explicitRefresh.refreshed, 1);
      assert.equal(fetches, 2);
      assert.equal((await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable, true);
    } finally {
      await handle.close();
    }
  });

  it("keeps failures unavailable and advances an exclusive bounded cursor", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const seeded = [];
      for (const key of ["failure-a", "failure-b", "failure-c"]) {
        seeded.push(await seedDocument(handle.db, key));
      }
      const fetchImpl = (async (input: string | URL | Request) =>
        responseAt(String(input), "Este archivo no existe.", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })) as typeof fetch;

      const first = await runVerifyDocumentsBatch(handle.db, { limit: 2, fetchImpl });
      assert.equal(first.candidates, 2);
      assert.equal(first.verified, 0);
      assert.equal(first.failed, 2);
      assert.equal(first.failures.length, 2);
      assert.ok(first.nextBeforeDocumentId);

      const second = await runVerifyDocumentsBatch(handle.db, {
        limit: 2,
        beforeDocumentId: first.nextBeforeDocumentId!,
        fetchImpl,
      });
      assert.equal(second.candidates, 1);
      assert.equal(second.failed, 1);
      assert.equal(second.nextBeforeDocumentId, null);
      assert.equal(
        new Set([...first.failures, ...second.failures].map((failure) => failure.documentId)).size,
        seeded.length,
      );
    } finally {
      await handle.close();
    }
  });

  it("keeps scanned and formerly-over-20-MB PDFs available when extraction cannot produce text", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const scanned = await seedDocument(handle.db, "scanned");
      const scannedResult = await runVerifyDocumentsBatch(handle.db, {
        documentId: scanned.documentId,
        extractText: true,
        fetchImpl: (async (input: string | URL | Request) =>
          responseAt(String(input))) as typeof fetch,
        extractor: async () => ({ text: "imagen escaneada", pages: 3 }),
      });
      assert.equal(scannedResult.verified, 1);
      assert.equal(scannedResult.extractionFailed, 1);
      assert.equal(scannedResult.failed, 0);
      assert.equal((await listDocuments(handle.db, scanned.initiativeId))[0]?.pdfAvailable, true);

      const large = await seedDocument(handle.db, "large-over-20mb");
      const largeBytes = new Uint8Array(20_000_100);
      largeBytes.set(new TextEncoder().encode("%PDF-1.7\n"));
      const largeResult = await runVerifyDocumentsBatch(handle.db, {
        documentId: large.documentId,
        fetchImpl: (async (input: string | URL | Request) =>
          responseAt(String(input), largeBytes, {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-length": String(largeBytes.byteLength),
            },
          })) as typeof fetch,
      });
      assert.equal(largeResult.verified, 1);
      assert.equal(largeResult.failed, 0);
      assert.equal((await listDocuments(handle.db, large.initiativeId))[0]?.pdfAvailable, true);
    } finally {
      await handle.close();
    }
  });

  it("does not invoke or wait for optional extraction during the default binary cycle", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const fixture = await seedDocument(handle.db, "binary-only");
      let extractionCalls = 0;
      const result = await Promise.race([
        runVerifyDocumentsBatch(handle.db, {
          documentId: fixture.documentId,
          fetchImpl: (async (input: string | URL | Request) =>
            responseAt(String(input))) as typeof fetch,
          extractor: async () => {
            extractionCalls++;
            return new Promise<never>(() => {});
          },
        }),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("binary verification waited for extraction")), 200),
        ),
      ]);
      assert.equal(result.verified, 1);
      assert.equal(extractionCalls, 0);
      assert.equal((await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable, true);
    } finally {
      await handle.close();
    }
  });

  it("persists HTML, empty-body, and zero-byte probes as unavailable reachability failures", async () => {
    const invalidBodies: Array<{
      key: string;
      body: ConstructorParameters<typeof Response>[0];
      contentType: string;
    }> = [
      { key: "html", body: "<html>no existe</html>", contentType: "text/html" },
      { key: "empty", body: null, contentType: "application/pdf" },
      { key: "zeros", body: new Uint8Array(32), contentType: "application/pdf" },
    ];
    for (const invalid of invalidBodies) {
      const handle = createDb();
      try {
        await handle.ensureSchema();
        const fixture = await seedDocument(handle.db, invalid.key);
        const result = await runVerifyDocumentsBatch(handle.db, {
          documentId: fixture.documentId,
          fetchImpl: (async (input: string | URL | Request) =>
            responseAt(String(input), invalid.body, {
              status: 200,
              headers: { "content-type": invalid.contentType },
            })) as typeof fetch,
        });
        assert.equal(result.verified, 0);
        assert.equal(result.failed, 1);
        assert.equal(
          (await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable,
          false,
        );
      } finally {
        await handle.close();
      }
    }
  });

  it("does not replace a fresh positive with three exhausted transient network attempts", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const fixture = await seedDocument(handle.db, "transient-preserves-positive");
      const healthy = await runVerifyDocumentsBatch(handle.db, {
        documentId: fixture.documentId,
        fetchImpl: (async (input: string | URL | Request) =>
          responseAt(String(input))) as typeof fetch,
      });
      assert.equal(healthy.verified, 1);
      let attempts = 0;
      const transient = await runVerifyDocumentsBatch(handle.db, {
        documentId: fixture.documentId,
        fetchImpl: (async () => {
          attempts++;
          throw new TypeError("terminated");
        }) as typeof fetch,
      });
      assert.equal(attempts, 3);
      assert.equal(transient.operationalFailed, 1);
      assert.equal(transient.definitiveUnavailable, 0);
      assert.equal((await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable, true);
    } finally {
      await handle.close();
    }
  });

  it("resumes a durable high-water cycle and checkpoints permanent failures without starvation", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const initial = [];
      for (const key of ["cycle-a", "cycle-b", "cycle-c", "cycle-d", "cycle-e"]) {
        initial.push(await seedDocument(handle.db, key));
      }
      const expectedCycle = initial
        .map((item) => item.documentId)
        .sort((left, right) => right - left);

      const starts = await Promise.all([
        beginOrResumeDocumentPdfVerificationCycle(handle.db),
        beginOrResumeDocumentPdfVerificationCycle(handle.db),
      ]);
      assert.equal(starts[0]!.runId, starts[1]!.runId);
      assert.deepEqual(starts.map((cycle) => cycle.resumed).sort(), [false, true]);

      const firstSeen: number[] = [];
      const first = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: 4,
        maxItems: 2,
        verifyItem: async (_db, item) => {
          firstSeen.push(item.documentId);
          if (firstSeen.length === 2) throw new Error("fallo permanente simulado");
          return "new-version";
        },
      });
      assert.equal(first.completed, false);
      assert.equal(first.resumed, true);
      assert.deepEqual(firstSeen, expectedCycle.slice(0, 2));
      assert.equal(first.cycle.beforeDocumentId, firstSeen.at(-1));
      assert.deepEqual(
        {
          inspected: first.cycle.inspected,
          verified: first.cycle.verified,
          newVersions: first.cycle.newVersions,
          refreshed: first.cycle.refreshed,
          failed: first.cycle.failed,
        },
        { inspected: 2, verified: 1, newVersions: 1, refreshed: 0, failed: 1 },
      );
      await assert.rejects(
        finishDocumentPdfVerificationCycle(handle.db, first.cycle.runId),
        /aún tiene el documento .* pendiente/,
      );

      const newer = await seedDocument(handle.db, "cycle-newer");
      assert.ok(newer.documentId > first.cycle.cycleMaxDocumentId!);

      const resumedSeen: number[] = [];
      const resumed = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: 2,
        verifyItem: async (_db, item) => {
          resumedSeen.push(item.documentId);
          return "refreshed";
        },
      });
      assert.equal(resumed.completed, true);
      assert.equal(resumed.resumed, true);
      assert.equal(resumed.cycle.runId, first.cycle.runId);
      assert.deepEqual(resumedSeen, expectedCycle.slice(2));
      assert.equal(resumedSeen.includes(newer.documentId), false);
      assert.deepEqual([...firstSeen, ...resumedSeen], expectedCycle);
      assert.deepEqual(
        {
          inspected: resumed.cycle.inspected,
          verified: resumed.cycle.verified,
          newVersions: resumed.cycle.newVersions,
          refreshed: resumed.cycle.refreshed,
          failed: resumed.cycle.failed,
        },
        { inspected: 5, verified: 4, newVersions: 1, refreshed: 3, failed: 1 },
      );

      const nextSeen: number[] = [];
      const next = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: 3,
        now: () => Date.now() + DOCUMENT_PDF_VERIFICATION_MAX_CYCLE_AGE_MS + 1,
        verifyItem: async (_db, item) => {
          nextSeen.push(item.documentId);
          return "refreshed";
        },
      });
      assert.equal(next.completed, true);
      assert.equal(next.resumed, false);
      assert.equal(next.overdue, true);
      assert.notEqual(next.cycle.runId, first.cycle.runId);
      assert.deepEqual(nextSeen, [newer.documentId, ...expectedCycle]);
    } finally {
      await handle.close();
    }
  });

  it("checkpoints extraction failures as reachable instead of reachability failures", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      await seedDocument(handle.db, "cycle-scanned");
      const outcomes: string[] = [];
      const result = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: 10,
        verifyItem: async () => ({
          outcome: "extraction-failed",
          extractionError: "PDF escaneado sin capa de texto",
        }),
        onResult(_item, outcome, error) {
          outcomes.push(`${outcome}:${error}`);
        },
      });
      assert.equal(result.completed, true);
      assert.deepEqual(
        {
          inspected: result.cycle.inspected,
          verified: result.cycle.verified,
          extractionFailed: result.cycle.extractionFailed,
          failed: result.cycle.failed,
        },
        { inspected: 1, verified: 1, extractionFailed: 1, failed: 0 },
      );
      assert.deepEqual(outcomes, ["extraction-failed:PDF escaneado sin capa de texto"]);
    } finally {
      await handle.close();
    }
  });

  it("records an exhaustive cycle with definitive unavailability as COMPLETE coverage", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const fixture = await seedDocument(handle.db, "cycle-definitive-unavailable");
      const result = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: 10,
        concurrency: 1,
        fetchImpl: (async (input: string | URL | Request) =>
          responseAt(String(input), "<html>archivo retirado</html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          })) as typeof fetch,
      });

      assert.equal(result.completed, true);
      assert.equal(result.cycle.operationalFailures, 0);
      assert.equal(result.cycle.definitiveUnavailable, 1);
      assert.equal(result.cycle.failed, 1);
      assert.deepEqual(
        {
          ok: result.health.ok,
          outcome: result.health.outcome,
          exitCode: documentPdfVerificationExitCode(result.health),
        },
        { ok: true, outcome: "COMPLETE", exitCode: 0 },
      );
      assert.match(result.health.coverageNotes.join(" "), /1 PDF oficial/);
      assert.equal((await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable, false);

      const health = (await latestRunsBySource(handle.db)).find(
        (row) => row.source === "document-pdf-byte-verification",
      );
      assert.equal(health?.ok, true);
      assert.equal(health?.outcome, "COMPLETE");
      const details = health?.details as Record<string, unknown>;
      assert.equal(details.definitiveUnavailable, 1);
      assert.ok(Array.isArray(details.coverageNotes));
      assert.match((details.coverageNotes as string[]).join(" "), /no disponibles/);
    } finally {
      await handle.close();
    }
  });

  it("keeps exhausted operational failures separate and leaves the cycle partial", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const fixture = await seedDocument(handle.db, "cycle-operational");
      const result = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: 10,
        concurrency: 1,
        fetchImpl: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
      });
      assert.equal(result.completed, true);
      assert.equal(result.cycle.failed, 1);
      assert.equal(result.cycle.operationalFailures, 1);
      assert.equal(result.cycle.definitiveUnavailable, 0);
      assert.equal(result.health.ok, false);
      assert.equal(result.health.outcome, "PARTIAL");
      assert.equal(documentPdfVerificationExitCode(result.health), 1);
      assert.match(result.health.error ?? "", /fallo\(s\) operacional/);
      assert.equal((await listDocuments(handle.db, fixture.initiativeId))[0]?.pdfAvailable, false);

      const health = (await latestRunsBySource(handle.db)).find(
        (row) => row.source === "document-pdf-byte-verification",
      );
      assert.equal(health?.ok, false);
      assert.equal(health?.outcome, "PARTIAL");
    } finally {
      await handle.close();
    }
  });

  it("limits the effective prefix-probe concurrency to the configured conservative cap", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      for (let index = 0; index < 8; index++) {
        await seedDocument(handle.db, `concurrency-${index}`);
      }
      let active = 0;
      let maxActive = 0;
      const result = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: 8,
        concurrency: 4,
        verifyItem: async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 15));
          active--;
          return "refreshed";
        },
      });
      assert.equal(result.completed, true);
      assert.equal(maxActive, 4);
      await assert.rejects(
        runDocumentPdfVerificationCycle(handle.db, { concurrency: 5 }),
        /between 1 and 4/,
      );
    } finally {
      await handle.close();
    }
  });
});
