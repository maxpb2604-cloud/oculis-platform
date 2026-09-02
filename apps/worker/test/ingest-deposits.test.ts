import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  createDb,
  documents,
  getInitiativeById,
  latestRunsBySource,
  listInitiatives,
  upsertInitiative,
} from "@oculis/db";
import { SenadoSilAdapter, type SenadoExpediente, type SenadoFichaFacts } from "@oculis/scrapers";
import {
  ingestDeposits,
  ingestSenateDeposits,
  senateInitiativeRecord,
} from "../src/ingest-deposits.js";

const row: SenadoExpediente = {
  code: "01733-2026-PLO-SE",
  idExpediente: "39793",
  type: "Préstamo",
  title: "CONTRATO DE PRÉSTAMO...",
  filedAt: "2026-07-23",
  status: "Despachada",
  sourceUrl: "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
};

const facts: SenadoFichaFacts = {
  initiativeCode: row.code,
  type: "Préstamo",
  title: "CONTRATO DE PRÉSTAMO PARA EL PLAN DE MANEJO DE CUENCA DEL RÍO YUNA.",
  currentStatus: "Promulgada",
  historyLiteral: "Despachada el 27/7/2026. Promulgada el 30/7/2026.",
  history: [
    { status: "Despachada", date: "2026-07-27", literal: "Despachada el 27/7/2026." },
    { status: "Promulgada", date: "2026-07-30", literal: "Promulgada el 30/7/2026." },
  ],
  historyParseComplete: true,
  subjectMatter: "HACIENDA",
  initialChamberLiteral: "Cámara de Diputados",
  originChamber: "DIPUTADOS",
  receivedBySenateAt: "2026-07-23",
  receivedBySenateAtLiteral: "23/07/2026",
  proponents: "PODER EJECUTIVO",
  commissions: null,
  expiresAt: null,
  expiresAtLiteral: "N/A",
  legislatureCountingStarted: "Si",
  legislatureCountingStartedAt: "2026-07-01",
  legislature: "2026-PLO",
  quadrennium: "2024-2028",
  condition: "Aprobada",
  promulgated: "Si",
  promulgatedAt: "2026-07-30",
  promulgationNumber: "47-26",
  rawFields: [],
};

const diputados159665 = {
  id: 159665,
  tipoId: 9,
  tipo: "Proyecto de Ley",
  camaraInicio: "Cámara de Diputados",
  numero: "06211-2024-2028-CD",
  descripcion:
    "Proyecto de ley que dispone la acumulación anual de los fondos no utilizados en medicamentos por los afiliados a las Administradoras de Riesgos de Salud (ARS).",
  periodoRegistro: "2024-2028",
  iniciado: "NO",
  fechaIniciado: null,
  materia: "SALUD PÚBLICA Y ASISTENCIA SOCIAL",
  legislatura: "2026-SLO",
  numPromulgacion: null,
  fechaPromulgacion: null,
  condicion: "DEPOSITADO",
  estado: "Depositado",
  fechaDeposito: "2026-08-27T00:00:00",
  fechaUltimoCambioPrincipal: "2026-08-27T13:48:19.4492968",
  grupoId: 15,
  grupo: "Seguridad Social",
  origen: "Cámara de Diputados",
};

function installDiputadosFetch(
  opts: {
    failDetail?: boolean;
    failDocuments?: boolean;
    documents?: Array<Record<string, unknown>>;
  } = {},
): { calls: string[]; restore(): void } {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const page = (results: unknown[]) => ({ page: 1, pageSize: 10, total: results.length, results });
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    calls.push(url.toString());
    if (url.pathname.endsWith("/Grupos")) {
      return jsonResponse([{ id: 15, descripcion: "Seguridad Social", icono: "seguridad-social" }]);
    }
    if (url.pathname.endsWith("/iniciativas")) {
      return jsonResponse(page(url.searchParams.get("tipo") === "true" ? [diputados159665] : []));
    }
    if (url.pathname.endsWith("/iniciativa/159665")) {
      if (opts.failDetail)
        return new Response("Detalle temporalmente no disponible", { status: 404 });
      return jsonResponse(diputados159665);
    }
    if (url.pathname.endsWith("/proponentes")) {
      return jsonResponse(
        page([
          {
            principal: true,
            legisladorId: 3621,
            nombres: "Indhira Shary",
            apellidos: "de Jesús de Morla",
            nombreCompleto: "Indhira Shary de Jesús de Morla",
            representacion: {
              funcion: "Diputada",
              nivelRepresentacion: "Provincial",
              provincia: "Santo Domingo",
              ejercicio: "En Curso",
              inicio: "2024-08-16T00:00:00",
              fin: "2028-08-15T00:00:00",
              periodo: "2024-2028",
              partido: {
                id: 2868,
                nombre: "Partido Revolucionario Moderno",
                siglas: "PRM",
              },
            },
          },
        ]),
      );
    }
    if (url.pathname.endsWith("/historicos")) {
      return jsonResponse(
        page([
          {
            id: 616962,
            estado: "Depositado",
            inicio: "2026-08-27T00:00:00",
            fin: "2026-08-27T00:00:00",
          },
        ]),
      );
    }
    if (
      url.pathname.endsWith("/comisiones") ||
      url.pathname.endsWith("/Actividades") ||
      url.pathname.endsWith("/votaciones")
    ) {
      return jsonResponse(page([]));
    }
    if (url.pathname.endsWith("/documentos")) {
      if (opts.failDocuments)
        return new Response("Documentos temporalmente no disponibles", { status: 503 });
      return jsonResponse(page(opts.documents ?? []));
    }
    throw new Error(`Unexpected Diputados SIL request: ${url.toString()}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Diputados recent-deposit factual enrichment", () => {
  it("persists every modeled public fact and history identity for initiative 159665", async () => {
    const handle = createDb();
    const fetchHarness = installDiputadosFetch();
    const documentsObservedAt = "2026-08-27T15:04:05.000Z";
    try {
      await handle.ensureSchema();
      const result = await ingestDeposits(handle.db, {
        today: "2026-08-27",
        sinceDays: 1,
        maxPagesPerSlice: 1,
        delayMs: 0,
        now: () => new Date(documentsObservedAt),
      });
      assert.equal(result.ok, true);
      assert.equal(result.outcome, "COMPLETE");
      assert.equal(result.deposits, 1);
      assert.equal(result.failures, 0);

      const listed = await listInitiatives(handle.db, { chamber: "DIPUTADOS", pageSize: 10 });
      assert.equal(listed.total, 1);
      const detail = await getInitiativeById(handle.db, listed.rows[0]!.id);
      assert.equal(detail?.sourceId, "159665");
      assert.equal(detail?.sourceChamber, "DIPUTADOS");
      assert.equal(detail?.originChamber, "DIPUTADOS");
      assert.equal(detail?.currentChamber, null);
      assert.equal(detail?.currentBody, null);
      assert.equal(detail?.condition, "DEPOSITADO");
      assert.equal(detail?.sourceCategory, "Seguridad Social");
      assert.equal(detail?.subjectMatter, "SALUD PÚBLICA Y ASISTENCIA SOCIAL");
      assert.equal(detail?.initiated, "NO");
      assert.equal(detail?.initiatedAt, null);
      assert.equal(detail?.legislature, "2026-SLO");
      assert.equal(detail?.registrationPeriod, "2024-2028");
      assert.equal(detail?.officialStatusChangedAt, "2026-08-27T13:48:19.4492968");
      assert.equal(detail?.promulgationNumber, null);
      assert.equal(detail?.promulgatedAt, null);
      assert.equal(detail?.sponsor, "Indhira Shary de Jesús de Morla");
      assert.equal(detail?.sponsorRole, "Diputada");
      assert.equal(detail?.sponsorCount, 1);
      assert.equal(detail?.party, "PRM");
      assert.equal(detail?.province, "Santo Domingo");
      assert.deepEqual(
        detail?.events.map((event) => ({
          sourceEventId: event.sourceEventId,
          eventDate: event.eventDate,
          eventEndDate: event.eventEndDate,
        })),
        [{ sourceEventId: "616962", eventDate: "2026-08-27", eventEndDate: "2026-08-27" }],
      );
      const raw = detail?.raw as {
        payload: Record<string, unknown>;
        provenance: {
          endpoints: string[];
          observedCollections: string[];
          collectionObservedAt: { documentos: string };
        };
      };
      assert.deepEqual(raw.payload.detail, diputados159665);
      assert.deepEqual(raw.payload.actividades, []);
      assert.deepEqual(raw.payload.votaciones, []);
      assert.deepEqual(raw.payload.documentos, []);
      assert.ok(raw.provenance.endpoints.includes("iniciativa/iniciativa/159665"));
      assert.ok(raw.provenance.endpoints.includes("iniciativa/documentos"));
      assert.ok(raw.provenance.observedCollections.includes("documentos"));
      assert.equal(raw.provenance.collectionObservedAt.documentos, documentsObservedAt);
      assert.ok(fetchHarness.calls.some((url) => url.endsWith("/iniciativa/iniciativa/159665")));
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("preserves prior detail after failure while retaining successful history and documents", async () => {
    const officialDocument = {
      id: 99001,
      documento: "06211-2024-2028-CD",
      descripcion: "PROYECTO DEPOSITADO",
      extension: "pdf",
      cargado: "2026-08-27T14:00:00",
      evidenciaPublica: "fila completa",
    };
    const handle = createDb();
    const fetchHarness = installDiputadosFetch({
      failDetail: true,
      documents: [officialDocument],
    });
    const documentsObservedAt = "2026-08-27T16:05:06.000Z";
    try {
      await handle.ensureSchema();
      const priorRaw = {
        payload: { detail: { id: 159665, snapshot: "previous detail" } },
        provenance: {
          endpoints: ["iniciativa/iniciativa/159665"],
          observedCollections: ["detail"],
        },
      };
      const inserted = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "159665",
        kind: "LEGISLATIVE",
        title: "Título anterior",
        sourceChamber: "DIPUTADOS",
        originChamber: "SENADO",
        currentChamber: "SENADO",
        currentBody: "Órgano explícito previo",
        condition: "CONDICIÓN PREVIA",
        subjectMatter: "MATERIA PREVIA",
        initiated: "SI",
        initiatedAt: "2026-01-02",
        legislature: "2026-PLO",
        registrationPeriod: "PERÍODO PREVIO",
        officialStatusChangedAt: "2026-01-03T10:00:00",
        promulgationNumber: "1-26",
        promulgatedAt: "2026-01-04",
        raw: priorRaw,
      });

      const result = await ingestDeposits(handle.db, {
        today: "2026-08-27",
        sinceDays: 1,
        maxPagesPerSlice: 1,
        delayMs: 0,
        now: () => new Date(documentsObservedAt),
      });
      assert.equal(result.ok, false);
      assert.equal(result.outcome, "PARTIAL");
      assert.equal(result.failures, 1);
      const detail = await getInitiativeById(handle.db, inserted.id);
      assert.equal(detail?.title, diputados159665.descripcion);
      assert.equal(detail?.originChamber, "SENADO");
      assert.equal(detail?.currentChamber, "SENADO");
      assert.equal(detail?.currentBody, "Órgano explícito previo");
      assert.equal(detail?.condition, "CONDICIÓN PREVIA");
      assert.equal(detail?.subjectMatter, "MATERIA PREVIA");
      assert.equal(detail?.initiated, "SI");
      assert.equal(detail?.initiatedAt, "2026-01-02");
      assert.equal(detail?.legislature, "2026-PLO");
      assert.equal(detail?.registrationPeriod, "PERÍODO PREVIO");
      assert.equal(detail?.officialStatusChangedAt, "2026-01-03T10:00:00");
      assert.equal(detail?.promulgationNumber, "1-26");
      assert.equal(detail?.promulgatedAt, "2026-01-04");
      assert.equal(detail?.events[0]?.sourceEventId, "616962");

      const mergedRaw = detail?.raw as {
        payload: Record<string, unknown>;
        provenance: {
          endpoints: string[];
          observedCollections: string[];
          retainedCollections: string[];
          collectionObservedAt: { documentos: string };
        };
      };
      assert.deepEqual(mergedRaw.payload.detail, priorRaw.payload.detail);
      assert.ok(mergedRaw.provenance.retainedCollections.includes("detail"));
      assert.equal(mergedRaw.provenance.observedCollections.includes("detail"), false);
      assert.equal(mergedRaw.provenance.endpoints.includes("iniciativa/iniciativa/159665"), false);
      assert.ok(mergedRaw.provenance.observedCollections.includes("documentos"));
      assert.equal(mergedRaw.provenance.collectionObservedAt.documentos, documentsObservedAt);

      const storedDocuments = await handle.db.select().from(documents);
      assert.equal(storedDocuments.length, 1);
      assert.deepEqual(storedDocuments[0]?.raw, officialDocument);
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("retains the prior document snapshot and observation time when documentos fails", async () => {
    const priorDocument = {
      id: 98001,
      documento: "06211-2024-2028-CD",
      descripcion: "PROYECTO DEPOSITADO PREVIO",
      extension: "pdf",
      cargado: "2026-08-26T12:00:00",
    };
    const priorDocumentsObservedAt = "2026-08-26T12:05:00.000Z";
    const failedRunAt = "2026-08-27T17:06:07.000Z";
    const handle = createDb();
    const fetchHarness = installDiputadosFetch({ failDocuments: true });
    try {
      await handle.ensureSchema();
      const inserted = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "159665",
        kind: "LEGISLATIVE",
        title: "Título anterior",
        chamber: "DIPUTADOS",
        raw: {
          payload: { documentos: [priorDocument] },
          provenance: {
            endpoints: ["iniciativa/documentos"],
            observedCollections: ["documentos"],
            collectionObservedAt: { documentos: priorDocumentsObservedAt },
          },
        },
      });

      const result = await ingestDeposits(handle.db, {
        today: "2026-08-27",
        sinceDays: 1,
        maxPagesPerSlice: 1,
        delayMs: 0,
        now: () => new Date(failedRunAt),
      });

      assert.equal(result.outcome, "PARTIAL");
      assert.equal(result.failures, 1);
      const detail = await getInitiativeById(handle.db, inserted.id);
      const mergedRaw = detail?.raw as {
        payload: { documentos: Array<Record<string, unknown>> };
        provenance: {
          endpoints: string[];
          observedCollections: string[];
          retainedCollections: string[];
          collectionObservedAt?: { documentos?: string };
          retainedProvenance?: {
            collectionObservedAt?: { documentos?: string };
          };
        };
      };
      const retainedDocumentsObservedAt =
        mergedRaw.provenance.collectionObservedAt?.documentos ??
        mergedRaw.provenance.retainedProvenance?.collectionObservedAt?.documentos;

      assert.deepEqual(mergedRaw.payload.documentos, [priorDocument]);
      assert.ok(mergedRaw.provenance.retainedCollections.includes("documentos"));
      assert.equal(mergedRaw.provenance.observedCollections.includes("documentos"), false);
      assert.equal(mergedRaw.provenance.endpoints.includes("iniciativa/documentos"), false);
      assert.equal(retainedDocumentsObservedAt, priorDocumentsObservedAt);
      assert.notEqual(retainedDocumentsObservedAt, failedRunAt);
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });
});

describe("Senate Ficha persistence mapping", () => {
  it("persists the official SI legislature-counting literal and date without inventing a current chamber", () => {
    const record = senateInitiativeRecord(row, facts);
    assert.equal(record.title, facts.title);
    assert.equal(record.status, "Promulgada");
    assert.equal(record.sourceChamber, "SENADO");
    assert.equal(record.originChamber, "DIPUTADOS");
    assert.equal(record.currentChamber, undefined);
    assert.equal(record.currentBody, undefined);
    assert.equal(record.sponsor, "PODER EJECUTIVO");
    assert.equal(record.committee, null);
    assert.equal(record.subjectMatter, "HACIENDA");
    assert.equal(record.condition, "Aprobada");
    assert.equal(record.expiresAt, null);
    assert.equal(record.initiated, "Si");
    assert.equal(record.initiatedAt, "2026-07-01");
    assert.equal(record.registrationPeriod, undefined);
    assert.equal(record.promulgationNumber, "47-26");
    assert.equal(record.promulgatedAt, "2026-07-30");
    assert.deepEqual((record.raw as { payload: unknown }).payload, { list: row, ficha: facts });
  });

  it("persists the official NO legislature-counting literal with its explicit null date", () => {
    const record = senateInitiativeRecord(row, {
      ...facts,
      legislatureCountingStarted: "No",
      legislatureCountingStartedAt: null,
    });

    assert.equal(record.initiated, "No");
    assert.equal(record.initiatedAt, null);
    assert.equal(record.expiresAt, null);
  });

  it("treats a failed explicit Ficha request as unobserved and preserves prior detail raw", () => {
    const record = senateInitiativeRecord(row, undefined, { preserveRawOnMissingFicha: true });
    assert.equal(record.title, "CONTRATO DE PRÉSTAMO...");
    assert.equal(record.status, "Despachada");
    assert.equal(record.sponsor, undefined);
    assert.equal(record.committee, undefined);
    assert.equal(record.originChamber, undefined);
    assert.equal(record.initiated, undefined);
    assert.equal(record.initiatedAt, undefined);
    assert.equal(record.expiresAt, undefined);
    assert.equal(record.raw, undefined);
  });
});

describe("Senate list-only refresh preservation", () => {
  it("keeps verified Ficha titles, detail facts, and raw evidence after blank/truncated list rows", async () => {
    const listedRows: SenadoExpediente[] = [
      { ...row, title: "CONTRATO DE PRÉSTAMO...", status: "Despachada" },
      {
        ...row,
        code: "01734-2026-PLO-SE",
        idExpediente: "39794",
        title: "",
        status: "",
      },
    ];
    const fichaFacts: SenadoFichaFacts[] = [
      facts,
      {
        ...facts,
        initiativeCode: listedRows[1]!.code,
        title: "PROYECTO DE LEY CON TÍTULO COMPLETO VERIFICADO EN LA FICHA.",
        type: "Proyecto de Ley",
        currentStatus: "En Comisión",
        subjectMatter: "JUSTICIA",
        proponents: "SENADO DE LA REPÚBLICA",
        commissions: "Comisión Permanente de Justicia",
      },
    ];
    const handle = createDb();
    const fetchHarness = installSenateFetch(listedRows);
    try {
      await handle.ensureSchema();
      const seeded = await Promise.all(
        listedRows.map((item, index) =>
          upsertInitiative(handle.db, senateInitiativeRecord(item, fichaFacts[index])),
        ),
      );

      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: false,
        today: "2026-08-27",
      });

      assert.deepEqual(fetchHarness.fichaIds, [], "a daily list refresh must not fetch a Ficha");
      assert.equal(result.deposits, 2);
      assert.equal(result.updated, 2);
      assert.equal(result.inserted, 0);
      assert.equal(result.outcome, "COMPLETE");
      assert.deepEqual(result.gaps, []);
      assert.equal(result.coverageNotes.length, 2);
      assert.match(result.coverageNotes.join(" "), /sin título oficial/);
      assert.match(result.coverageNotes.join(" "), /terminan en "\.\.\."/);

      for (const [index, seededRow] of seeded.entries()) {
        const detail = await getInitiativeById(handle.db, seededRow.id);
        const expectedFacts = fichaFacts[index]!;
        const expectedList = listedRows[index]!;
        assert.equal(detail?.title, expectedFacts.title);
        assert.equal(detail?.type, expectedFacts.type);
        assert.equal(detail?.originChamber, expectedFacts.originChamber);
        assert.equal(detail?.condition, expectedFacts.condition);
        assert.equal(detail?.subjectMatter, expectedFacts.subjectMatter);
        assert.equal(detail?.sponsor, expectedFacts.proponents);
        assert.equal(detail?.committee, expectedFacts.commissions);
        assert.equal(detail?.expiresAt, expectedFacts.expiresAt);
        assert.equal(detail?.initiated, expectedFacts.legislatureCountingStarted);
        assert.equal(detail?.initiatedAt, expectedFacts.legislatureCountingStartedAt);
        assert.equal(detail?.legislature, expectedFacts.legislature);
        assert.equal(detail?.promulgationNumber, expectedFacts.promulgationNumber);
        assert.equal(detail?.promulgatedAt, expectedFacts.promulgatedAt);
        // A non-empty list status is a fresh official observation; an empty one cannot
        // erase the last verified status.
        assert.equal(
          detail?.status,
          expectedList.status?.trim() || expectedFacts.currentStatus || null,
        );

        const retained = detail?.raw as {
          payload: { list: SenadoExpediente; ficha: SenadoFichaFacts };
          provenance: {
            explicitStatus: string;
            retainedCollections: string[];
            retainedFichaProvenance: { explicitStatus: string };
          };
        };
        assert.deepEqual(retained.payload.ficha, expectedFacts);
        assert.equal(retained.payload.list.title, expectedList.title || null);
        assert.equal(retained.provenance.explicitStatus, "list column 5");
        assert.deepEqual(retained.provenance.retainedCollections, ["ficha"]);
        assert.equal(retained.provenance.retainedFichaProvenance.explicitStatus, "lbEstadoActual");
      }
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });
});

interface SenateFetchHarness {
  fichaIds: string[];
  restore(): void;
}

function listHtml(rows: SenadoExpediente[]): string {
  const grid = rows
    .map(
      (item) => `<tr>
        <td><a href="Ficha.aspx?IdExpediente=${item.idExpediente}">${item.code}</a></td>
        <td>${item.type ?? ""}</td>
        <td>${item.title ?? ""}</td>
        <td>${item.filedAt ? item.filedAt.split("-").reverse().join("/") : ""}</td>
        <td>${item.status ?? ""}</td>
      </tr>`,
    )
    .join("\n");
  return `<html><body>
    <input id="__VIEWSTATE" value="state" />
    <input id="__VIEWSTATEGENERATOR" value="generator" />
    <input id="__EVENTVALIDATION" value="validation" />
    <a href="Ficha.aspx?IdExpediente=${rows[0]?.idExpediente ?? "0"}&numeropagina=1&ContExpedientes=${rows.length}&Coleccion=53">Expediente</a>
    <table>${grid}</table>
  </body></html>`;
}

function fichaHtml(
  idExpediente: string,
  code: string,
  history = "Depositada el 1/8/2026.",
): string {
  return `<html><body>
    <form action="Ficha.aspx?IdExpediente=${idExpediente}&amp;numeropagina=1&amp;ContExpedientes=0&amp;Coleccion=53">
      <table id="tblEspedientes">
        <tr><td>Estado actual:</td><td><span id="lbEstadoActual">En Comisión</span></td></tr>
        <tr><td>Número de Iniciativa</td><td><textarea id="campos_text_628">${code}</textarea></td></tr>
        <tr><td>Descripción del Proyecto</td><td><textarea id="campos_nota_630">Título completo de ${code}</textarea></td></tr>
        <tr><td>Historial</td><td><textarea id="campos_nota_631">${history}</textarea></td></tr>
      </table>
    </form>
  </body></html>`;
}

/** Run the real adapter against deterministic in-memory Responses; no socket is opened. */
function installSenateFetch(
  rows: SenadoExpediente[],
  opts: {
    failedFichaIds?: Iterable<string>;
    mismatchedFichaCodes?: ReadonlyMap<string, string>;
    incompleteHistoryIds?: Iterable<string>;
  } = {},
): SenateFetchHarness {
  const originalFetch = globalThis.fetch;
  const failed = new Set(opts.failedFichaIds ?? []);
  const incompleteHistory = new Set(opts.incompleteHistoryIds ?? []);
  const byId = new Map(rows.map((item) => [item.idExpediente, item]));
  const html = listHtml(rows);
  const fichaIds: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.pathname.toLowerCase() === "/wfilemaster/login.aspx") {
      if (method === "POST") return new Response("<html>Colecciones</html>", { status: 200 });
      return new Response(
        `<input id="__VIEWSTATE" value="login-state" />
         <input id="__VIEWSTATEGENERATOR" value="login-generator" />
         <input id="__EVENTVALIDATION" value="login-validation" />`,
        { status: 200 },
      );
    }
    if (url.pathname.toLowerCase() === "/wfilemaster/lista_expedientes.aspx") {
      return new Response(html, { status: 200 });
    }
    if (url.pathname.toLowerCase() === "/wfilemaster/ficha.aspx") {
      const id = url.searchParams.get("IdExpediente") ?? "";
      fichaIds.push(id);
      if (failed.has(id))
        return new Response("Servicio temporalmente no disponible", { status: 503 });
      const item = byId.get(id);
      if (!item) return new Response("Expediente desconocido", { status: 404 });
      return new Response(
        fichaHtml(
          id,
          opts.mismatchedFichaCodes?.get(id) ?? item.code,
          incompleteHistory.has(id)
            ? "Depositada el 1/8/2026. Nota administrativa sin fecha."
            : undefined,
        ),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected Senate SIL request: ${method} ${url.toString()}`);
  };

  return {
    fichaIds,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function senateRows(count: number): SenadoExpediente[] {
  return Array.from({ length: count }, (_, index) => ({
    code: `TEST-${index + 1}-2026-SE`,
    idExpediente: String(41_000 + index),
    type: "Proyecto de Ley",
    title: `Título listado ${index + 1}`,
    filedAt: "2026-08-01",
    status: "Depositada",
    sourceUrl:
      "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
  }));
}

describe("explicit Senate Ficha ingestion controls", () => {
  it("resumeFichas skips verified raw.payload.ficha rows without erasing their evidence", async () => {
    const rows = senateRows(2);
    const handle = createDb();
    const fetchHarness = installSenateFetch(rows);
    try {
      await handle.ensureSchema();
      const priorRaw = {
        payload: { list: rows[0], ficha: { verified: "prior official observation" } },
        provenance: { sourceUrl: "https://official.test/ficha/41000" },
      };
      const prior = await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: rows[0]!.idExpediente!,
        kind: "LEGISLATIVE",
        code: rows[0]!.code,
        title: "Título completo previamente verificado",
        status: "Promulgada",
        chamber: "SENADO",
        sponsor: "PROPONENTE PREVIAMENTE VERIFICADO",
        raw: priorRaw,
      });

      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: true,
        resumeFichas: true,
        fichaBatchSize: 1,
        fichaDelayMs: 0,
        fichaBatchCooldownMs: 0,
        today: "2026-08-27",
      });

      assert.deepEqual(fetchHarness.fichaIds, [rows[1]!.idExpediente]);
      const preserved = await getInitiativeById(handle.db, prior.id);
      assert.equal(preserved?.title, "Título completo previamente verificado");
      assert.equal(preserved?.status, "Promulgada");
      assert.equal(preserved?.sponsor, "PROPONENTE PREVIAMENTE VERIFICADO");
      assert.deepEqual(preserved?.raw, priorRaw);
      assert.equal(result.deposits, 1);
      assert.equal(result.failures, 0);
      assert.equal(result.ok, true);
      assert.equal(result.outcome, "COMPLETE");
      assert.equal(
        result.gaps.some((gap) => gap.startsWith("Límite operativo:")),
        false,
      );
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("re-fetches a previously verified Ficha when resume is disabled", async () => {
    const rows = senateRows(1);
    const handle = createDb();
    const fetchHarness = installSenateFetch(rows);
    try {
      await handle.ensureSchema();
      const prior = await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: rows[0]!.idExpediente!,
        kind: "LEGISLATIVE",
        code: rows[0]!.code,
        title: "Título completo previamente verificado",
        status: "Promulgada",
        chamber: "SENADO",
        raw: {
          payload: { list: rows[0], ficha: { verified: "prior official observation" } },
        },
      });

      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: true,
        resumeFichas: false,
        fichaBatchSize: 1,
        fichaDelayMs: 0,
        fichaBatchCooldownMs: 0,
        today: "2026-08-27",
      });

      assert.deepEqual(fetchHarness.fichaIds, [rows[0]!.idExpediente]);
      assert.equal(result.ok, true);
      const refreshed = await getInitiativeById(handle.db, prior.id);
      assert.equal(refreshed?.status, "En Comisión");
      assert.ok(
        refreshed?.events.some(
          (event) => event.status === "Depositada" && event.eventDate === "2026-08-01",
        ),
      );
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("rejects a list-to-Ficha code mismatch without replacing prior evidence", async () => {
    const rows = senateRows(2);
    const observedMismatch = "TEST-1-2026-PLO-SE";
    const priorVerifiedCode = "PRIOR-VERIFIED-2026-SE";
    const handle = createDb();
    const fetchHarness = installSenateFetch(rows, {
      mismatchedFichaCodes: new Map([[rows[0]!.idExpediente!, observedMismatch]]),
    });
    try {
      await handle.ensureSchema();
      const priorRaw = {
        payload: { list: rows[0], ficha: { verified: "prior official observation" } },
        provenance: { sourceUrl: "https://official.test/ficha/41000" },
      };
      const prior = await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: rows[0]!.idExpediente!,
        kind: "LEGISLATIVE",
        code: priorVerifiedCode,
        title: "Título completo previamente verificado",
        status: "Promulgada",
        chamber: "SENADO",
        sponsor: "PROPONENTE PREVIAMENTE VERIFICADO",
        raw: priorRaw,
      });

      const classified = await new SenadoSilAdapter().fetchFichaFactsBatch(
        [{ idExpediente: rows[0]!.idExpediente!, expectedCode: rows[0]!.code }],
        { delayMs: 0 },
      );
      assert.deepEqual(classified.records, []);
      assert.deepEqual(classified.failures, [
        {
          idExpediente: rows[0]!.idExpediente,
          classification: "SOURCE_IDENTITY_MISMATCH",
          expectedCode: rows[0]!.code,
          observedCode: observedMismatch,
          error: `Senado SIL ficha code ${observedMismatch} does not match list code ${rows[0]!.code}`,
        },
      ]);
      fetchHarness.fichaIds.length = 0;

      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: true,
        resumeFichas: false,
        fichaBatchSize: 1,
        fichaDelayMs: 0,
        fichaBatchCooldownMs: 0,
        today: "2026-08-27",
      });

      assert.deepEqual(
        fetchHarness.fichaIds,
        rows.map((item) => item.idExpediente),
        "an identity mismatch is not retried and must not halt later Fichas",
      );
      assert.equal(result.ok, true);
      assert.equal(result.outcome, "COMPLETE");
      assert.equal(result.failures, 0);
      assert.equal(result.rejected, 1);
      assert.equal(result.inserted, 1);
      assert.equal(result.updated, 0);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.gaps, []);
      assert.ok(
        result.coverageNotes.some(
          (gap) =>
            gap.includes(rows[0]!.idExpediente!) &&
            gap.includes(rows[0]!.code) &&
            gap.includes(observedMismatch),
        ),
      );
      const preserved = await getInitiativeById(handle.db, prior.id);
      assert.equal(preserved?.code, priorVerifiedCode);
      assert.equal(preserved?.title, "Título completo previamente verificado");
      assert.equal(preserved?.status, "Promulgada");
      assert.equal(preserved?.sponsor, "PROPONENTE PREVIAMENTE VERIFICADO");
      assert.deepEqual(preserved?.raw, priorRaw);
      assert.deepEqual(preserved?.events, []);
      const persisted = await listInitiatives(handle.db, { chamber: "SENADO", pageSize: 20 });
      assert.equal(persisted.total, 2, "the unrelated verified Ficha is still ingested");
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("keeps seven unambiguous source-history omissions as COMPLETE coverage notes", async () => {
    const rows = senateRows(7);
    const handle = createDb();
    const fetchHarness = installSenateFetch(rows, {
      incompleteHistoryIds: rows.map((item) => item.idExpediente!),
    });
    try {
      await handle.ensureSchema();
      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: true,
        fichaBatchSize: 7,
        fichaDelayMs: 0,
        fichaBatchCooldownMs: 0,
        today: "2026-08-27",
      });

      assert.equal(result.deposits, 7);
      assert.equal(result.failures, 0);
      assert.equal(result.rejected, 0);
      assert.equal(result.ok, true);
      assert.equal(result.outcome, "COMPLETE");
      assert.deepEqual(result.gaps, []);
      assert.match(result.coverageNotes.join(" "), /7 Historial\(es\)/);

      const health = (await latestRunsBySource(handle.db)).find(
        (entry) => entry.source === "senado-sil-fichas",
      );
      const details = health?.details as { incompleteHistories?: number; coverageNotes?: string[] };
      assert.equal(details.incompleteHistories, 7);
      assert.match(details.coverageNotes?.join(" ") ?? "", /7 Historial\(es\)/);
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("reports an operational gap only when --limit leaves pending rows unprocessed", async () => {
    const rows = senateRows(2);
    const handle = createDb();
    const fetchHarness = installSenateFetch(rows);
    try {
      await handle.ensureSchema();
      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: true,
        limit: 1,
        fichaBatchSize: 1,
        fichaDelayMs: 0,
        fichaBatchCooldownMs: 0,
        today: "2026-08-27",
      });

      assert.equal(result.deposits, 1);
      assert.equal(result.outcome, "PARTIAL");
      assert.deepEqual(fetchHarness.fichaIds, [rows[0]!.idExpediente]);
      assert.ok(result.gaps.includes("Límite operativo: se procesaron 1 de 2 filas pendientes."));
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("halts after a 0/N Ficha batch and leaves later batches pending without requesting them", async () => {
    const rows = senateRows(4);
    const failedIds = rows.slice(0, 2).map((item) => item.idExpediente!);
    const handle = createDb();
    const fetchHarness = installSenateFetch(rows, { failedFichaIds: failedIds });
    try {
      await handle.ensureSchema();
      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: true,
        fichaBatchSize: 2,
        fichaDelayMs: 0,
        fichaBatchCooldownMs: 0,
        today: "2026-08-27",
      });

      assert.deepEqual(new Set(fetchHarness.fichaIds), new Set(failedIds));
      assert.equal(fetchHarness.fichaIds.length, 4, "each failed Ficha is retried only once");
      assert.equal(result.deposits, 2);
      assert.equal(result.failures, 2);
      assert.equal(result.rejected, 0);
      assert.equal(result.ok, false);
      assert.equal(result.outcome, "PARTIAL");
      assert.match(result.error ?? "", /2 official Ficha request\(s\) failed/);
      assert.ok(result.gaps.some((gap) => /2 Ficha\(s\) quedaron pendientes/.test(gap)));
      const persisted = await listInitiatives(handle.db, { chamber: "SENADO", pageSize: 20 });
      assert.equal(persisted.total, 2);
      assert.deepEqual(new Set(persisted.rows.map((item) => item.sourceId)), new Set(failedIds));
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("observes the configured cooldown between successful Ficha batches", async () => {
    const rows = senateRows(2);
    const handle = createDb();
    const fetchHarness = installSenateFetch(rows);
    const logs: string[] = [];
    try {
      await handle.ensureSchema();
      const startedAt = Date.now();
      const result = await ingestSenateDeposits(handle.db, {
        fullCollection: true,
        enrichFichas: true,
        fichaBatchSize: 1,
        fichaDelayMs: 0,
        fichaBatchCooldownMs: 25,
        today: "2026-08-27",
        log: (message) => logs.push(message),
      });
      const elapsedMs = Date.now() - startedAt;

      assert.equal(result.ok, true);
      assert.deepEqual(
        fetchHarness.fichaIds,
        rows.map((item) => item.idExpediente),
      );
      assert.ok(elapsedMs >= 20, `expected the 25ms batch cooldown, observed ${elapsedMs}ms`);
      assert.equal(
        logs.filter((message) => message.includes("pausa de fuente 25ms antes del lote 2")).length,
        1,
      );
    } finally {
      fetchHarness.restore();
      await handle.close();
    }
  });

  it("keeps Senate package scripts free of a hard-coded delay so --delay can override them", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };
    for (const name of ["senate:fichas", "senate:fichas:full"]) {
      const script = pkg.scripts?.[name] ?? "";
      assert.match(script, /--senate-fichas/);
      assert.doesNotMatch(script, /(?:^|\s)--delay(?:\s|=)/);
    }
  });

  it("refreshes recurring Senate movements and reserves --resume for bootstrap recovery", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/cloud-ingestion.yml", import.meta.url),
      "utf8",
    );
    const recurring = workflow.match(
      /- name: Enrich the complete Senate collection from official Fichas[\s\S]*?(?=\n {6}- name:)/,
    )?.[0];
    const bootstrap = workflow.match(
      /- name: Bootstrap complete Senate Ficha evidence[\s\S]*?(?=\n {6}- name:)/,
    )?.[0];
    assert.ok(recurring);
    assert.match(recurring, /inputs\.mode == 'movements'/);
    assert.doesNotMatch(recurring, /run:.*--resume/);
    assert.ok(bootstrap);
    assert.match(bootstrap, /run:.*--resume/);
  });
});
