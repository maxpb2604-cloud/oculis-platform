import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client.js";
import {
  listInitiativesForDocuments,
  upsertDocument,
  upsertInitiative,
} from "../src/repository.js";
import { documents } from "../src/schema.js";

let h: DbHandle;

beforeAll(async () => {
  h = createDb();
  await h.ensureSchema();
});

afterAll(async () => {
  await h.close();
});

async function initiative(
  sourceId: string,
  opts: { source?: string; kind?: "LEGISLATIVE" | "REGULATORY" } = {},
) {
  return upsertInitiative(h.db, {
    source: opts.source ?? "sil-diputados",
    sourceId,
    kind: opts.kind ?? "LEGISLATIVE",
    code: `CODE-${sourceId}`,
    title: `Initiative ${sourceId}`,
  });
}

describe("listInitiativesForDocuments", () => {
  it("returns only legislative rows and finds both exact deposited-document aliases", async () => {
    const missing = await initiative("candidate-missing");
    const currentAlias = await initiative("candidate-current-alias");
    const historicalAlias = await initiative("candidate-historical-alias");
    const normalizedAlias = await initiative("candidate-normalized-alias");
    const contextualOnly = await initiative("candidate-contextual-only");
    const missingUrl = await initiative("candidate-missing-url");
    const missingSourceDocId = await initiative("candidate-missing-source-doc-id");
    await initiative("candidate-regulatory", { kind: "REGULATORY" });
    await initiative("candidate-other-source", { source: "senado-sil" });

    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "candidate-current-doc",
      initiativeId: currentAlias.id,
      docType: "PROYECTO DEPOSITADO",
      url: "https://example.test/current.pdf",
    });
    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "candidate-historical-doc",
      initiativeId: historicalAlias.id,
      docType: "P DEPOSITADO",
      url: "https://example.test/historical.pdf",
    });
    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "candidate-normalized-doc",
      initiativeId: normalizedAlias.id,
      docType: "  proyecto depositado  ",
      url: "https://example.test/normalized.pdf",
    });
    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "candidate-contextual-doc",
      initiativeId: contextualOnly.id,
      docType: "PROYECTO DEPOSITADO PREVIO",
      url: "https://example.test/contextual.pdf",
    });
    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "candidate-missing-url-doc",
      initiativeId: missingUrl.id,
      docType: "PROYECTO DEPOSITADO",
      url: null,
    });
    await h.db.insert(documents).values({
      source: "sil-diputados",
      sourceDocId: null,
      initiativeId: missingSourceDocId.id,
      docType: "P DEPOSITADO",
      url: "https://example.test/no-source-doc-id.pdf",
    });

    const all = await listInitiativesForDocuments(h.db, { source: "sil-diputados" });
    expect(new Set(all.map((row) => row.id))).toEqual(
      new Set([
        missing.id,
        currentAlias.id,
        historicalAlias.id,
        normalizedAlias.id,
        contextualOnly.id,
        missingUrl.id,
        missingSourceDocId.id,
      ]),
    );

    const candidates = await listInitiativesForDocuments(h.db, {
      source: "sil-diputados",
      missingDepositedOnly: true,
    });
    expect(new Set(candidates.map((row) => row.id))).toEqual(
      new Set([missing.id, contextualOnly.id, missingUrl.id, missingSourceDocId.id]),
    );
  });

  it("does not let a deposited document from another source satisfy the Cámara backlog", async () => {
    const row = await initiative("candidate-cross-source");
    await upsertDocument(h.db, {
      source: "other-catalog",
      sourceDocId: "candidate-cross-source-doc",
      initiativeId: row.id,
      docType: "PROYECTO DEPOSITADO",
      url: "https://example.test/cross-source.pdf",
    });

    const candidates = await listInitiativesForDocuments(h.db, {
      source: "sil-diputados",
      missingDepositedOnly: true,
    });
    expect(candidates.some((candidate) => candidate.id === row.id)).toBe(true);
  });
});
