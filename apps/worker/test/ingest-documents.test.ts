import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createDb,
  documents,
  latestRunsBySource,
  listDocuments,
  listInitiativesForDocuments,
  upsertDocument,
  upsertInitiative,
  type Database,
} from "@oculis/db";
import type { SilDocumento } from "@oculis/scrapers";
import {
  DOCUMENT_DISCOVERY_SOURCE,
  ingestDocuments,
  type DocumentDiscoveryAdapter,
} from "../src/ingest-documents.js";

const OBSERVED_AT = new Date("2026-09-02T12:34:56.000Z");

function officialDocument(over: Partial<SilDocumento> = {}): SilDocumento {
  return {
    id: 9_001,
    documento: "CODE-SOURCE-SAYS",
    descripcion: "PROYECTO DEPOSITADO",
    extension: "pdf",
    cargado: "2026-09-02T08:00:00",
    ...over,
  };
}

function adapter(
  observations: Record<string, SilDocumento[] | Error>,
  calls: string[] = [],
): DocumentDiscoveryAdapter {
  return {
    async documentos(sourceId) {
      const key = String(sourceId);
      calls.push(key);
      const result = observations[key] ?? [];
      if (result instanceof Error) throw result;
      return result;
    },
    documentUrl(documentId) {
      return `https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=${documentId}`;
    },
  };
}

async function seedInitiative(
  db: Database,
  sourceId: string,
  code: string,
  filedAt = "2024-01-03",
) {
  return upsertInitiative(db, {
    source: "sil-diputados",
    sourceId,
    kind: "LEGISLATIVE",
    code,
    title: `Proyecto ${sourceId}`,
    filedAt,
  });
}

describe("late Cámara document discovery", () => {
  it("finds a late PDF for an old filing, links by exact parent id, and stays idempotent", async () => {
    const h = createDb();
    try {
      await h.ensureSchema();
      const old = await seedInitiative(h.db, "old-filing", "CODE-OLD", "2024-01-03");
      const decoy = await seedInitiative(h.db, "decoy", "CODE-DECOY", "2026-09-01");
      const calls: string[] = [];
      // The source document deliberately states the decoy's code. Association must
      // still use the queried old initiative's exact internal id.
      const late = officialDocument({ documento: "CODE-DECOY" });
      const fake = adapter({ "old-filing": [late], decoy: [] }, calls);

      const first = await ingestDocuments(h.db, {
        missingDepositedOnly: true,
        adapter: fake,
        delayMs: 0,
        concurrency: 2,
        now: () => OBSERVED_AT,
      });
      assert.equal(first.outcome, "COMPLETE");
      assert.equal(first.candidates, 2);
      assert.equal(first.missingDepositedCandidates, 2);
      assert.equal(first.newDocuments, 1);
      assert.equal(first.emptyObservations, 1);
      assert.deepEqual(new Set(calls), new Set(["old-filing", "decoy"]));

      const [stored] = await h.db
        .select({ initiativeId: documents.initiativeId, initiativeCode: documents.initiativeCode })
        .from(documents)
        .where(eq(documents.sourceDocId, "9001"));
      assert.deepEqual(stored, { initiativeId: old.id, initiativeCode: "CODE-DECOY" });
      assert.equal((await listDocuments(h.db, old.id)).length, 1);
      assert.equal((await listDocuments(h.db, decoy.id)).length, 0);

      const remaining = await listInitiativesForDocuments(h.db, {
        source: "sil-diputados",
        missingDepositedOnly: true,
      });
      assert.deepEqual(
        remaining.map((row) => row.id),
        [decoy.id],
      );

      const second = await ingestDocuments(h.db, {
        adapter: fake,
        delayMs: 0,
        now: () => OBSERVED_AT,
      });
      assert.equal(second.newDocuments, 0);
      assert.equal((await listDocuments(h.db, old.id)).length, 1);

      const health = (await latestRunsBySource(h.db)).find(
        (row) => row.source === DOCUMENT_DISCOVERY_SOURCE,
      );
      assert.ok(health?.finishedAt);
      assert.equal(health.outcome, "COMPLETE");
    } finally {
      await h.close();
    }
  });

  it("rejects an entire snapshot before writing when any id is invalid or duplicated", async () => {
    const h = createDb();
    try {
      await h.ensureSchema();
      const invalid = await seedInitiative(h.db, "invalid-ids", "CODE-INVALID");
      const duplicate = await seedInitiative(h.db, "duplicate-ids", "CODE-DUPLICATE");
      const fake = adapter({
        "invalid-ids": [officialDocument({ id: 1 }), officialDocument({ id: -2 })],
        "duplicate-ids": [officialDocument({ id: 3 }), officialDocument({ id: 3 })],
      });

      const result = await ingestDocuments(h.db, {
        missingDepositedOnly: true,
        adapter: fake,
        delayMs: 0,
        now: () => OBSERVED_AT,
      });
      assert.equal(result.outcome, "PARTIAL");
      assert.equal(result.failures, 2);
      assert.equal(result.newDocuments, 0);
      assert.equal((await listDocuments(h.db, invalid.id)).length, 0);
      assert.equal((await listDocuments(h.db, duplicate.id)).length, 0);
    } finally {
      await h.close();
    }
  });

  it("rolls back the whole initiative snapshot when a later database write fails", async () => {
    const h = createDb();
    try {
      await h.ensureSchema();
      const row = await seedInitiative(h.db, "atomic-write", "CODE-ATOMIC");
      const first = officialDocument({ id: 41 });
      const second = officialDocument({ id: 42 });
      // This is structurally valid source metadata through id validation, but cannot be
      // serialized as JSONB. The first insert must be rolled back with the second.
      (second as SilDocumento & { self?: unknown }).self = second;

      const result = await ingestDocuments(h.db, {
        missingDepositedOnly: true,
        adapter: adapter({ "atomic-write": [first, second] }),
        delayMs: 0,
        now: () => OBSERVED_AT,
      });
      assert.equal(result.outcome, "PARTIAL");
      assert.equal(result.failures, 1);
      assert.equal(result.newDocuments, 0);
      assert.equal((await listDocuments(h.db, row.id)).length, 0);
    } finally {
      await h.close();
    }
  });

  it("isolates an endpoint failure, preserves prior documents, and finalizes the run", async () => {
    const h = createDb();
    try {
      await h.ensureSchema();
      const row = await seedInitiative(h.db, "temporary-failure", "CODE-FAILURE");
      await upsertDocument(h.db, {
        source: "sil-diputados",
        sourceDocId: "prior-context-document",
        initiativeId: row.id,
        initiativeCode: "CODE-FAILURE",
        docType: "INFORME DE COMISIÓN",
        extension: "pdf",
        url: "https://www.diputadosrd.gob.do/documentos/prior.pdf",
      });

      const result = await ingestDocuments(h.db, {
        adapter: adapter({ "temporary-failure": new Error("temporary source outage") }),
        delayMs: 0,
        now: () => OBSERVED_AT,
      });
      assert.equal(result.outcome, "PARTIAL");
      assert.equal((await listDocuments(h.db, row.id)).length, 1);

      const health = (await latestRunsBySource(h.db)).find(
        (candidate) => candidate.source === DOCUMENT_DISCOVERY_SOURCE,
      );
      assert.ok(health?.finishedAt);
      assert.equal(health.outcome, "PARTIAL");
      assert.match(health.error ?? "", /1 official document-list request/);
    } finally {
      await h.close();
    }
  });

  it("records a terminal FAILED run when an unexpected orchestration error occurs", async () => {
    const h = createDb();
    try {
      await h.ensureSchema();
      await seedInitiative(h.db, "global-failure", "CODE-GLOBAL");

      const result = await ingestDocuments(h.db, {
        adapter: adapter({}),
        delayMs: 0,
        now: () => {
          throw new Error("clock unavailable");
        },
      });
      assert.equal(result.outcome, "FAILED");
      assert.equal(result.ok, false);

      const health = (await latestRunsBySource(h.db)).find(
        (candidate) => candidate.source === DOCUMENT_DISCOVERY_SOURCE,
      );
      assert.ok(health?.finishedAt);
      assert.equal(health.outcome, "FAILED");
      assert.match(health.error ?? "", /clock unavailable/);
    } finally {
      await h.close();
    }
  });
});
