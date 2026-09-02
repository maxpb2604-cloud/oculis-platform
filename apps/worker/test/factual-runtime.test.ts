import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createDb, getInitiativeById, upsertInitiative } from "@oculis/db";
import {
  SOURCE_REGISTRY,
  type KnownAgendaDocument,
  type RawFeedItem,
  type RawInitiative,
  type SenadoPublishedDocument,
} from "@oculis/scrapers";
import { VERIFIED_FEED_ACCOUNTS } from "../src/feed-accounts.seed.js";
import { buildLegislativeSignals } from "../src/feed-signals.js";
import { resolveExplicitEntities } from "../src/ingest-feed.js";
import {
  officialCountMismatch,
  persistInitiativeEvidence,
  toInitiativeRow,
} from "../src/ingest.js";
import { ingestMovements } from "../src/ingest-movements.js";
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
  it("does not call a corpus complete when the official total and enumeration differ", () => {
    assert.equal(officialCountMismatch(6209, 6206), true);
    assert.equal(officialCountMismatch(6206, 6206), false);
    assert.equal(officialCountMismatch(null, 6206), false);
  });

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

  it("requires every active regulatory source, including MISPAS", () => {
    assert.ok(REQUIRED_SOURCE_SETS.regulatory.includes("reg-mispas"));
    assert.throws(
      () =>
        assertRequiredSourcesOk(
          "regulatory",
          REQUIRED_SOURCE_SETS.regulatory
            .filter((source) => source !== "reg-mispas")
            .map((source) => ({ source, ok: true })),
          REQUIRED_SOURCE_SETS.regulatory,
        ),
      /missing: reg-mispas/,
    );
  });

  it("requires independent Senate list and Ficha observations in every daily cycle", () => {
    assert.ok(REQUIRED_SOURCE_SETS.daily.includes("senado-sil-deposits"));
    assert.ok(REQUIRED_SOURCE_SETS.daily.includes("senado-sil-fichas"));
    assert.doesNotThrow(() =>
      assertRequiredSourcesOk(
        "daily",
        [
          { source: "senado-sil-deposits", ok: true },
          { source: "senado-sil-fichas", ok: true },
        ],
        ["senado-sil-deposits", "senado-sil-fichas"],
      ),
    );
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

function cloudWorkflow(): string {
  return readFileSync(
    new URL("../../../.github/workflows/cloud-ingestion.yml", import.meta.url),
    "utf8",
  );
}

function liveSourceHealthWorkflow(): string {
  return readFileSync(
    new URL("../../../.github/workflows/live-source-health.yml", import.meta.url),
    "utf8",
  );
}

function workflowStep(workflow: string, id: string): string {
  const idIndex = workflow.indexOf(`id: ${id}`);
  assert.ok(idIndex >= 0, `missing workflow step id: ${id}`);
  const start = workflow.lastIndexOf("\n      - name:", idIndex);
  const next = workflow.indexOf("\n      - name:", idIndex);
  return workflow.slice(start, next === -1 ? undefined : next);
}

describe("cloud monitoring lanes", () => {
  it("registers both movement detectors and both deposited-document processes as required", () => {
    assert.deepEqual(REQUIRED_SOURCE_SETS.incrementalMovements, [
      "sil-movements-incremental",
      "senado-sil-movements-incremental",
    ]);
    assert.deepEqual(REQUIRED_SOURCE_SETS.documentDiscovery, ["sil-documents"]);
    assert.deepEqual(REQUIRED_SOURCE_SETS.documentVerification, ["document-pdf-byte-verification"]);

    for (const id of [
      ...REQUIRED_SOURCE_SETS.incrementalMovements,
      ...REQUIRED_SOURCE_SETS.documentDiscovery,
      ...REQUIRED_SOURCE_SETS.documentVerification,
    ]) {
      const source = SOURCE_REGISTRY.find((candidate) => candidate.id === id);
      assert.ok(source, `missing source registry entry: ${id}`);
      assert.equal(source.cadence, "THREE_TIMES_DAILY");
      assert.equal(source.required, true);
      assert.equal(source.status, "ACTIVE");
    }
  });

  it("discovers late document metadata before daily data and movements, then verifies PDFs", () => {
    const workflow = cloudWorkflow();
    const discovery = workflowStep(workflow, "daily_missing_documents");
    const daily = workflowStep(workflow, "daily_monitoring");
    const movements = workflowStep(workflow, "daily_movement_histories");
    const verification = workflowStep(workflow, "verify_documents");

    assert.ok(workflow.indexOf(discovery) < workflow.indexOf(daily));
    assert.ok(workflow.indexOf(daily) < workflow.indexOf(movements));
    assert.ok(workflow.indexOf(movements) < workflow.indexOf(verification));
    assert.match(discovery, /--documents --missing-deposited/);
    assert.match(daily, /npm run daily -w @oculis\/worker/);
    assert.match(movements, /npm run movements:incremental -w @oculis\/worker/);
    assert.match(verification, /npm run verify-documents -w @oculis\/worker -- --all/);

    for (const step of [discovery, daily, movements, verification]) {
      assert.match(step, /github\.event\.schedule == '15 2,10,18 \* \* \*'/);
      assert.match(step, /!cancelled\(\)/);
      assert.match(step, /steps\.database_config\.outcome == 'success'/);
    }
  });

  it("keeps complete daily and weekly metadata safety sweeps ahead of PDF verification", () => {
    const workflow = cloudWorkflow();
    for (const [discoveryId, verificationId] of [
      ["maintenance_documents", "maintenance_verify_documents"],
      ["weekly_documents", "weekly_verify_documents"],
      ["bootstrap_documents", "bootstrap_verify_documents"],
    ] as const) {
      const discovery = workflowStep(workflow, discoveryId);
      const verification = workflowStep(workflow, verificationId);
      assert.match(discovery, /run: npm run ingest -w @oculis\/worker -- --documents\s*$/m);
      assert.doesNotMatch(discovery, /--limit/);
      assert.match(verification, /npm run verify-documents -w @oculis\/worker -- --all/);
      assert.ok(workflow.indexOf(discovery) < workflow.indexOf(verification));
      for (const step of [discovery, verification]) {
        assert.match(step, /!cancelled\(\)/);
        assert.match(step, /steps\.database_config\.outcome == 'success'/);
      }
    }
  });

  it("exposes distinct manual modes for incremental/full movement and document recovery", () => {
    const workflow = cloudWorkflow();
    for (const mode of [
      "movements-incremental",
      "movements",
      "documents-missing",
      "documents",
      "publications-full",
      "senate-fichas",
      "link-initiative-proponents",
    ]) {
      assert.match(workflow, new RegExp(`^ {10}- ${mode}$`, "m"));
    }
  });

  it("exposes a manual full publication recovery distinct from recent refresh and bootstrap", () => {
    const workflow = cloudWorkflow();
    const recent = workflowStep(workflow, "maintenance_publications");
    const full = workflowStep(workflow, "manual_full_publications");

    assert.match(recent, /inputs\.mode == 'publications'/);
    assert.match(recent, /npm run publications -w @oculis\/worker -- --limit 3/);
    assert.doesNotMatch(recent, /--full/);
    assert.match(full, /inputs\.mode == 'publications-full'/);
    assert.match(full, /npm run publications -w @oculis\/worker -- --full/);
    assert.doesNotMatch(full, /--limit|inputs\.mode == 'bootstrap'/);
    assert.match(full, /!cancelled\(\)/);
    assert.match(full, /steps\.database_config\.outcome == 'success'/);
  });
});

describe("six-hour live source health", () => {
  it("runs every live scraper check read-only in an isolated serial workflow", () => {
    const workflow = liveSourceHealthWorkflow();

    assert.match(workflow, /cron: "37 3,9,15,21 \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /group: oculis-live-source-health/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /OCULIS_LIVE: "1"/);
    assert.match(workflow, /DATABASE_URL: ""/);
    assert.match(workflow, /OCULIS_AUTO_MIGRATE: "0"/);
    assert.match(workflow, /npm run test:live -w @oculis\/scrapers/);
    assert.match(workflow, /--no-file-parallelism/);
    assert.match(workflow, /--maxWorkers=1/);
    assert.match(workflow, /--reporter=junit/);
    assert.match(workflow, /uses: actions\/upload-artifact@v4/);
    assert.match(workflow, /retention-days: 30/);
  });
});

describe("list-only and failed-enrichment preservation", () => {
  it("does not erase previously observed detail-only facts or raw detail", async () => {
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
        sponsorRole: "Senadora",
        sponsorCount: 3,
        party: "ABC",
        province: "Santo Domingo",
        committee: "Comisión Permanente de Justicia",
        purpose: "Descripción oficial observada en el detalle.",
        sourceChamber: "DIPUTADOS",
        originChamber: "SENADO",
        currentChamber: "SENADO",
        currentBody: "Comisión Bicameral",
        condition: "ANTERIOR",
        subjectMatter: "MATERIA PREVIAMENTE OBSERVADA",
        expiresAt: "2028-08-15",
        initiated: "SI",
        initiatedAt: "2026-07-01",
        legislature: "2026-PLO",
        registrationPeriod: "2024-2028",
        officialStatusChangedAt: "2026-08-01T12:30:00",
        promulgationNumber: "12-26",
        promulgatedAt: "2026-08-02",
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
        sourceChamber: "DIPUTADOS",
        originChamber: "DIPUTADOS",
        currentChamber: null,
        currentBody: null,
        condition: "VIGENTE",
        sourceCategory: "Grupo oficial",
        subjectMatter: "JUSTICIA",
        sponsor: null,
        sponsorRole: null,
        sponsorCount: null,
        party: null,
        province: null,
        committee: null,
        filedAt: "2026-08-05",
        expiresAt: null,
        initiated: null,
        initiatedAt: null,
        legislature: null,
        registrationPeriod: null,
        officialStatusChangedAt: null,
        promulgationNumber: null,
        promulgatedAt: null,
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/preserve-1",
        history: [],
        raw: { list: true },
      };

      await upsertInitiative(handle.db, toInitiativeRow(listOnly, { preserveDetailFields: true }));
      const actual = await getInitiativeById(handle.db, inserted.id);
      assert.equal(actual?.sponsor, "Ana Pérez");
      assert.equal(actual?.sponsorRole, "Senadora");
      assert.equal(actual?.sponsorCount, 3);
      assert.equal(actual?.party, "ABC");
      assert.equal(actual?.province, "Santo Domingo");
      assert.equal(actual?.committee, "Comisión Permanente de Justicia");
      assert.equal(actual?.purpose, "Descripción oficial observada en el detalle.");
      assert.equal(actual?.sourceChamber, "DIPUTADOS");
      assert.equal(actual?.originChamber, "SENADO");
      assert.equal(actual?.currentChamber, "SENADO");
      assert.equal(actual?.currentBody, "Comisión Bicameral");
      assert.equal(actual?.condition, "ANTERIOR");
      assert.equal(actual?.subjectMatter, "MATERIA PREVIAMENTE OBSERVADA");
      assert.equal(actual?.expiresAt, "2028-08-15");
      assert.equal(actual?.initiated, "SI");
      assert.equal(actual?.initiatedAt, "2026-07-01");
      assert.equal(actual?.legislature, "2026-PLO");
      assert.equal(actual?.registrationPeriod, "2024-2028");
      assert.equal(actual?.officialStatusChangedAt, "2026-08-01T12:30:00");
      assert.equal(actual?.promulgationNumber, "12-26");
      assert.equal(actual?.promulgatedAt, "2026-08-02");
      assert.deepEqual(actual?.raw, priorRaw);
      assert.equal(actual?.status, "Depositada");
    } finally {
      await handle.close();
    }
  });
});

describe("enriched initiative evidence", () => {
  it("persists distinct official history ids and every commission assignment", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const inserted = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "evidence-1",
        kind: "LEGISLATIVE",
        code: "EVIDENCE-1",
        title: "Título oficial",
      });
      const raw: RawInitiative = {
        source: "sil-diputados",
        sourceId: "evidence-1",
        kind: "LEGISLATIVE",
        code: "EVIDENCE-1",
        title: "Título oficial",
        purpose: null,
        type: "Proyecto de Ley",
        status: "En Orden del Día",
        chamber: "DIPUTADOS",
        sourceCategory: "Justicia",
        sponsor: null,
        party: null,
        province: null,
        committee: null,
        filedAt: "2026-05-05",
        expiresAt: null,
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/evidence-1",
        history: [
          {
            sourceEventId: "609826",
            status: "En Orden del Día",
            date: "2026-05-12",
            endDate: "2026-05-12",
            note: null,
            raw: { id: 609826 },
          },
          {
            sourceEventId: "609684",
            status: "En Orden del Día",
            date: "2026-05-12",
            endDate: "2026-05-13",
            note: null,
            raw: { id: 609684 },
          },
        ],
        commissionAssignments: [
          {
            sourceId: "5245",
            sourceTypeId: "975",
            type: "Especial",
            name: "Comisión especial",
            startDate: "2026-05-19",
            endDate: "2026-06-17",
            raw: { id: 5245 },
          },
          {
            sourceId: "4026",
            sourceTypeId: "974",
            type: "Permanente",
            name: "Interior y Policía",
            startDate: "2026-05-12",
            endDate: "2026-06-10",
            raw: { id: 4026 },
          },
        ],
        raw: {},
      };

      assert.deepEqual(
        await persistInitiativeEvidence(handle.db, inserted.id, raw, {
          commissionsObserved: true,
        }),
        { historyInserted: 2, commissionAssignmentsInserted: 2 },
      );
      assert.deepEqual(
        await persistInitiativeEvidence(handle.db, inserted.id, raw, {
          commissionsObserved: true,
        }),
        { historyInserted: 0, commissionAssignmentsInserted: 0 },
      );

      const detail = await getInitiativeById(handle.db, inserted.id);
      assert.deepEqual(detail?.events.map((event) => event.sourceEventId).sort(), [
        "609684",
        "609826",
      ]);
      assert.deepEqual(
        detail?.commissionAssignments.map((assignment) => assignment.sourceAssignmentId).sort(),
        ["4026", "5245"],
      );
    } finally {
      await handle.close();
    }
  });
});

describe("official movement identity", () => {
  it("persists historicos.id and the explicit end date", async () => {
    const handle = createDb();
    const originalFetch = globalThis.fetch;
    try {
      await handle.ensureSchema();
      const inserted = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "159665",
        kind: "LEGISLATIVE",
        title: "Proyecto oficial",
      });
      let history = [
        {
          id: 616962,
          estado: "Depositado",
          inicio: "2026-08-27T00:00:00",
          fin: "2026-08-27T00:00:00",
        },
      ];
      globalThis.fetch = async (input) => {
        const url = new URL(
          typeof input === "string" || input instanceof URL ? input.toString() : input.url,
        );
        assert.ok(url.pathname.endsWith("/historicos"));
        return new Response(
          JSON.stringify({
            page: 1,
            pageSize: 10,
            total: history.length,
            results: history,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const result = await ingestMovements(handle.db, {
        limit: 1,
        concurrency: 1,
        delayMs: 0,
      });
      assert.equal(result.ok, true);
      assert.equal(result.statusEventsInserted, 1);
      const detail = await getInitiativeById(handle.db, inserted.id);
      assert.deepEqual(
        detail?.events.map((event) => ({
          sourceEventId: event.sourceEventId,
          eventDate: event.eventDate,
          eventEndDate: event.eventEndDate,
        })),
        [{ sourceEventId: "616962", eventDate: "2026-08-27", eventEndDate: "2026-08-27" }],
      );

      history = [
        {
          id: 616962,
          estado: "Depositado · corrección oficial",
          inicio: "2026-08-28T00:00:00",
          fin: "2026-08-28T00:00:00",
        },
      ];
      const corrected = await ingestMovements(handle.db, {
        limit: 1,
        concurrency: 1,
        delayMs: 0,
      });
      assert.equal(corrected.statusEventsInserted, 1);
      assert.deepEqual(
        (await getInitiativeById(handle.db, inserted.id))?.events.map((event) => ({
          sourceEventId: event.sourceEventId,
          status: event.status,
          eventDate: event.eventDate,
        })),
        [
          {
            sourceEventId: "616962",
            status: "Depositado · corrección oficial",
            eventDate: "2026-08-28",
          },
        ],
      );

      history = [];
      const emptySnapshot = await ingestMovements(handle.db, {
        limit: 1,
        concurrency: 1,
        delayMs: 0,
      });
      assert.equal(emptySnapshot.outcome, "PARTIAL");
      assert.equal(emptySnapshot.failures, 1);
      assert.deepEqual(
        (await getInitiativeById(handle.db, inserted.id))?.events.map((event) => event.status),
        ["Depositado · corrección oficial"],
      );
    } finally {
      globalThis.fetch = originalFetch;
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
