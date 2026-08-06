import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDb, getInitiativeById, upsertInitiative } from "@oculis/db";
import type {
  KnownAgendaDocument,
  RawFeedItem,
  RawInitiative,
  SenadoPublishedDocument,
} from "@oculis/scrapers";
import { VERIFIED_FEED_ACCOUNTS } from "../src/feed-accounts.seed.js";
import { buildLegislativeSignals } from "../src/feed-signals.js";
import { resolveExplicitEntities } from "../src/ingest-feed.js";
import { toInitiativeRow } from "../src/ingest.js";
import { sortKnownDocuments, sortSenateDocuments } from "../src/ingest-congress-publications.js";
import { assertRequiredSourcesOk, REQUIRED_SOURCE_SETS } from "../src/reliability.js";

const item = (overrides: Partial<RawFeedItem> = {}): RawFeedItem => ({
  source: "feed-prensa",
  sourceId: "article-1",
  kind: "NEWS",
  title: "Texto sobre reforma tributaria",
  summary: null,
  imageUrl: null,
  url: "https://example.test/article-1",
  author: "Fuente",
  handle: null,
  platform: "RSS",
  category: "ECONOMIA",
  publishedAt: "2026-08-05T10:00:00.000Z",
  chamber: null,
  initiativeCodes: [],
  raw: {},
  ...overrides,
});

describe("factual feed resolution", () => {
  it("does not create a category or title-similarity initiative link", () => {
    const result = resolveExplicitEntities(item(), {
      legislators: [],
      commissions: [],
    });
    assert.equal(result.record.category, null);
    assert.equal(result.record.initiativeCode, null);
    assert.deepEqual(result.tags, []);
  });

  it("tags only an explicit official code or complete normalized name", () => {
    const result = resolveExplicitEntities(
      item({
        title: "María Pérez presentó 01234-2024-2028-CD",
        initiativeCodes: ["01234-2024-2028-CD"],
      }),
      {
        legislators: [
          {
            sourceId: "77",
            key: "maria perez",
            name: "María Pérez",
            chamber: "DIPUTADOS",
          },
        ],
        commissions: [],
      },
    );
    assert.deepEqual(
      result.tags.map((tag) => tag.entityType),
      ["INITIATIVE", "LEGISLATOR"],
    );
  });

  it("does not choose a homonym or a primary entity when several are explicit", () => {
    const result = resolveExplicitEntities(
      item({
        title: "María Pérez remitió CODE-1 y CODE-2 a Comisión de Hacienda",
        initiativeCodes: ["CODE-1", "CODE-2"],
      }),
      {
        legislators: [
          { sourceId: "a", key: "maria perez", name: "María Pérez", chamber: "DIPUTADOS" },
          { sourceId: "b", key: "maria perez", name: "María Pérez", chamber: "DIPUTADOS" },
        ],
        commissions: [
          { key: "comision de hacienda", name: "Comisión de Hacienda", chamber: "DIPUTADOS" },
        ],
      },
    );
    assert.equal(result.record.initiativeCode, null);
    assert.equal(result.record.legislatorSourceId, null);
    assert.equal(result.tags.filter((tag) => tag.entityType === "LEGISLATOR").length, 0);
    assert.deepEqual(
      result.tags.filter((tag) => tag.entityType === "INITIATIVE").map((tag) => tag.label),
      ["CODE-1", "CODE-2"],
    );
  });

  it("does not convert a date-only feed value into an invented midnight timestamp", () => {
    const result = resolveExplicitEntities(item({ publishedAt: "2026-08-05" }), {
      legislators: [],
      commissions: [],
    });
    assert.equal(result.record.publishedAt, null);
  });

  it("keeps a date-only filing date out of the publication timestamp", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const filedAt = new Date().toISOString().slice(0, 10);
      const inserted = await upsertInitiative(handle.db, {
        source: "test-factual-signal",
        sourceId: "date-only-1",
        kind: "LEGISLATIVE",
        code: "DATE-ONLY-1",
        title: "Iniciativa con fecha oficial sin hora",
        filedAt,
        chamber: "SENADO",
      });
      const old = await upsertInitiative(handle.db, {
        source: "test-factual-signal",
        sourceId: "old-date-only",
        kind: "LEGISLATIVE",
        code: "OLD-DATE-ONLY",
        title: "Iniciativa fuera de la ventana",
        filedAt: "2020-01-01",
        chamber: "DIPUTADOS",
      });
      const signals = await buildLegislativeSignals(handle.db);
      const signal = signals.find((candidate) => candidate.sourceId === `deposit:${inserted.id}`);
      assert.equal(signal?.publishedAt, null);
      assert.equal(signal?.chamber, "SENADO");
      assert.match(signal?.summary ?? "", new RegExp(`Fecha de depósito: ${filedAt}`));
      assert.equal(
        signals.some((candidate) => candidate.sourceId === `deposit:${old.id}`),
        false,
      );
    } finally {
      await handle.close();
    }
  });
});

describe("source requirements and account evidence", () => {
  it("requires every scheduled official publication source", () => {
    assert.deepEqual(REQUIRED_SOURCE_SETS.publications, [
      "dip-known-agenda",
      "sen-approved",
      "sen-expired",
      "sen-votes",
      "sen-attendance",
      "sen-reports",
    ]);
  });

  it("keeps optional feed failures visible without failing required-source checks", () => {
    assert.doesNotThrow(() =>
      assertRequiredSourcesOk(
        "daily",
        [
          { source: "feed-prensa", ok: false },
          { source: "feed-senado", ok: true },
        ],
        ["feed-senado"],
      ),
    );
    assert.throws(
      () =>
        assertRequiredSourcesOk("daily", [{ source: "feed-senado", ok: false }], ["feed-senado"]),
      /failed: feed-senado/,
    );
    assert.throws(
      () => assertRequiredSourcesOk("daily", [], ["feed-senado"]),
      /missing: feed-senado/,
    );
  });

  it("ships only cited institutional accounts and no ordering score", () => {
    assert.equal(VERIFIED_FEED_ACCOUNTS.length, 2);
    for (const account of VERIFIED_FEED_ACCOUNTS) {
      assert.match(account.evidenceUrl, /^https:\/\//);
      assert.equal("rank" in account, false);
    }
  });
});

describe("failed enrichment preservation", () => {
  it("does not erase previously observed sponsor facts or raw detail", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const priorRaw = { detail: { proponentes: ["Ana Pérez"] } };
      const inserted = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "preserve-1",
        kind: "LEGISLATIVE",
        title: "Título oficial",
        sponsor: "Ana Pérez",
        party: "ABC",
        province: "Santo Domingo",
        raw: priorRaw,
      });
      const listOnly: RawInitiative = {
        source: "sil-diputados",
        sourceId: "preserve-1",
        kind: "LEGISLATIVE",
        code: "01234-2024-2028-CD",
        title: "Título oficial actualizado",
        purpose: null,
        type: "Proyecto de Ley",
        status: "Depositada",
        chamber: "DIPUTADOS",
        sourceCategory: "Grupo oficial",
        sponsor: null,
        party: null,
        province: null,
        committee: null,
        filedAt: "2026-08-05",
        expiresAt: null,
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/preserve-1",
        history: [],
        raw: { list: true },
      };

      await upsertInitiative(handle.db, toInitiativeRow(listOnly, { preserveDetailFields: true }));
      const actual = await getInitiativeById(handle.db, inserted.id);
      assert.equal(actual?.sponsor, "Ana Pérez");
      assert.equal(actual?.party, "ABC");
      assert.equal(actual?.province, "Santo Domingo");
      assert.deepEqual(actual?.raw, priorRaw);
      assert.equal(actual?.status, "Depositada");
    } finally {
      await handle.close();
    }
  });
});

describe("publication recency", () => {
  it("prioritizes a newly uploaded or modified old-session document", () => {
    const known = (sourceId: string, dates: Partial<KnownAgendaDocument>) =>
      ({
        sourceId,
        sessionDate: null,
        uploadedDate: null,
        modifiedDate: null,
        ...dates,
      }) as KnownAgendaDocument;
    assert.deepEqual(
      sortKnownDocuments([
        known("new-session", { sessionDate: "2026-08-05", uploadedDate: "2026-08-05" }),
        known("corrected-old-session", {
          sessionDate: "2025-01-01",
          uploadedDate: "2025-01-02",
          modifiedDate: "2026-08-06",
        }),
      ]).map((document) => document.sourceId),
      ["corrected-old-session", "new-session"],
    );

    const senate = (fileId: number, dates: Partial<SenadoPublishedDocument>) =>
      ({ fileId, addedOn: null, modifiedOn: null, ...dates }) as SenadoPublishedDocument;
    assert.deepEqual(
      sortSenateDocuments([
        senate(1, { addedOn: "2026-08-05" }),
        senate(2, { addedOn: "2025-01-01", modifiedOn: "2026-08-06" }),
      ]).map((document) => document.fileId),
      [2, 1],
    );
  });
});
