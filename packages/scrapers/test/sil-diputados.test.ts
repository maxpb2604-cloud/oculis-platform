import { describe, expect, it, vi } from "vitest";
import {
  mapSilInitiative,
  silCatalogSerialOmissions,
  SilDiputadosAdapter,
} from "../src/sil-diputados.js";

const LIVE = process.env.OCULIS_LIVE === "1";
const live = LIVE ? describe : describe.skip;

describe("SilDiputadosAdapter (offline)", () => {
  it("builds the verified list URL", () => {
    const a = new SilDiputadosAdapter();
    expect(a.buildListUrl(1, true, 2)).toBe(
      "https://www.diputadosrd.gob.do/sil/api/iniciativa/iniciativas?page=2&grupo=1&tipo=true&perimidas=false&keyword=&periodoId=0",
    );
    expect(a.buildGlobalListUrl(2)).toBe(
      "https://www.diputadosrd.gob.do/sil/api/iniciativa/getIniciativas?page=2&keyword=",
    );
  });

  it("uses the exact global catalogue total while retaining serial omissions as diagnostics", async () => {
    const base = "https://official.test/api/iniciativa";
    const fetchMock = catalogFetchFixture();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const adapter = new SilDiputadosAdapter(base);
      expect(await adapter.count()).toBe(5);
      expect(await adapter.serialHighWatermark()).toBe(6);

      const snapshot = await adapter.catalogSnapshot();
      expect(snapshot).toMatchObject({
        catalogTotal: 5,
        serialHighWatermark: 6,
        upstreamCatalogOmissions: [3],
        partitionCount: 60,
        globalPageCount: 3,
      });
      expect(snapshot.rows.map((row) => row.code)).toEqual([
        "00001-2024-2028-CD",
        "00002-2024-2028-CD",
        "00004-2024-2028-CD",
        "00005-2024-2028-CD",
        "00006-2024-2028-CD",
      ]);
      expect(snapshot.rows.map((row) => row.sourceId)).not.toContain("103");
      expect(await collect(adapter.list())).toHaveLength(5);

      const partitionPageOnes = fetchMock.mock.calls.filter(([input]) => {
        const url = new URL(String(input));
        return url.pathname.endsWith("/iniciativas") && url.searchParams.get("page") === "1";
      });
      expect(partitionPageOnes).toHaveLength(60);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["changes the declared total", { unstableTotal: true }, /pagination changed/],
    ["returns an empty middle page", { emptyMiddlePage: true }, /returned 0 row/],
    ["overlaps global pages", { overlapGlobalPages: true }, /repeated initiative id/],
    ["reuses a code for another id", { duplicateGlobalCode: true }, /repeated initiative code/],
    ["omits a global row from all partitions", { omitPartitionSerial: 4 }, /catalogue mismatch/],
    [
      "reports a serial high-water mark below its own total",
      { serialHighWatermark: 4 },
      /below catalogue total/,
    ],
  ] as const)("rejects a catalogue that %s", async (_label, fixtureOptions, expected) => {
    vi.stubGlobal("fetch", catalogFetchFixture(fixtureOptions));
    try {
      await expect(
        new SilDiputadosAdapter("https://official.test/api/iniciativa").catalogSnapshot(),
      ).rejects.toThrow(expected);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never interprets a missing serial as an initiative", () => {
    expect(
      silCatalogSerialOmissions(
        [
          "00001-2024-2028-CD",
          "00002-2024-2028-CD",
          "00004-2024-2028-CD",
          "00005-2024-2028-CD",
          "00006-2024-2028-CD",
        ],
        6,
      ),
    ).toEqual([3]);
  });

  it("keeps source/origin/current chamber facts separate and maps explicit detail fields", async () => {
    const base = "https://official.test/api/iniciativa";
    const fetchMock = vi.fn(async () =>
      json({
        id: 158367,
        numero: "05905-2024-2028-CD",
        tipo: "Proyecto de Ley",
        tipoId: 1,
        descripcion: "Proyecto de ley con origen en el Senado.",
        camaraInicio: "Senado",
        grupo: "  Administración / Municipalidad  ",
        grupoId: 10,
        materia: "  ASUNTOS MUNICIPALES  ",
        estado: "Enviada a Comisión",
        condicion: "  VIGENTE  ",
        fechaDeposito: "2026-05-05T00:00:00",
        fechaUltimoCambioPrincipal: "2026-07-24T16:53:46.9759334",
        periodoRegistro: "2024-2028",
        origen: "Senado",
        iniciado: "SI",
        fechaIniciado: "2026-05-12T00:00:00",
        legislatura: "2026-PLO",
        numPromulgacion: "  18-26  ",
        fechaPromulgacion: "2026-08-01T00:00:00",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const actual = await new SilDiputadosAdapter(base).detail("158367");
      expect(actual).toMatchObject({
        chamber: "DIPUTADOS",
        sourceChamber: "DIPUTADOS",
        originChamber: "SENADO",
        currentChamber: null,
        currentBody: null,
        condition: "VIGENTE",
        sourceCategory: "Administración / Municipalidad",
        subjectMatter: "ASUNTOS MUNICIPALES",
        initiated: "SI",
        initiatedAt: "2026-05-12",
        legislature: "2026-PLO",
        registrationPeriod: "2024-2028",
        officialStatusChangedAt: "2026-07-24T16:53:46.9759334",
        promulgationNumber: "18-26",
        promulgatedAt: "2026-08-01",
        commissionAssignments: [],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retains an official row whose description is absent", async () => {
    const base = "https://official.test/api/iniciativa";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ...initiativeFixture(77), descripcion: null })),
    );
    try {
      const actual = await new SilDiputadosAdapter(base).detail("77");
      expect(actual?.sourceId).toBe("77");
      expect(actual?.title).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("enriches initiative 159665 from detail and every public collection", async () => {
    const base = "https://official.test/api/iniciativa";
    const detail = {
      ...initiativeFixture(159665),
      numero: "06211-2024-2028-CD",
      descripcion:
        "Proyecto de ley que dispone la acumulación anual de los fondos no utilizados en medicamentos.",
      grupo: "Seguridad Social",
      materia: "SALUD PÚBLICA Y ASISTENCIA SOCIAL",
      condicion: "DEPOSITADO",
      estado: "Depositado",
      periodoRegistro: "2024-2028",
      iniciado: "NO",
      fechaIniciado: null,
      legislatura: "2026-SLO",
      fechaUltimoCambioPrincipal: "2026-08-27T13:48:19.4492968",
      fechaDeposito: "2026-08-27T00:00:00",
      origen: "Cámara de Diputados",
      camaraInicio: "Cámara de Diputados",
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/iniciativa/159665")) return json(detail);
      if (url.pathname.endsWith("/proponentes")) {
        return json(
          page([
            {
              principal: true,
              nombreCompleto: "Indhira Shary de Jesús de Morla",
              representacion: {
                funcion: "Diputada",
                nivelRepresentacion: "Provincial",
                provincia: "Santo Domingo",
                ejercicio: "En Curso",
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
        return json(
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
      if (url.pathname.endsWith("/comisiones")) return json(page([]));
      if (url.pathname.endsWith("/Actividades") || url.pathname.endsWith("/votaciones")) {
        return json(page([]));
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const listRow = { ...detail, materia: null, condicion: null, iniciado: null };
      const enriched = await new SilDiputadosAdapter(base).enrich(mapSilInitiative(listRow, base));
      expect(enriched).toMatchObject({
        sourceId: "159665",
        sourceChamber: "DIPUTADOS",
        originChamber: "DIPUTADOS",
        currentChamber: null,
        currentBody: null,
        condition: "DEPOSITADO",
        sourceCategory: "Seguridad Social",
        subjectMatter: "SALUD PÚBLICA Y ASISTENCIA SOCIAL",
        initiated: "NO",
        initiatedAt: null,
        legislature: "2026-SLO",
        registrationPeriod: "2024-2028",
        officialStatusChangedAt: "2026-08-27T13:48:19.4492968",
        sponsor: "Indhira Shary de Jesús de Morla",
        sponsorRole: "Diputada",
        sponsorCount: 1,
        party: "PRM",
        province: "Santo Domingo",
      });
      expect(enriched.history).toEqual([
        expect.objectContaining({
          sourceEventId: "616962",
          status: "Depositado",
          date: "2026-08-27",
          endDate: "2026-08-27",
        }),
      ]);
      expect(enriched.raw).toMatchObject({
        payload: {
          detail,
          actividades: [],
          votaciones: [],
        },
        provenance: {
          observedCollections: [
            "list",
            "detail",
            "proponentes",
            "historicos",
            "comisiones",
            "actividades",
            "votaciones",
          ],
        },
      });
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
        expect.arrayContaining([
          `${base}/iniciativa/159665`,
          `${base}/Actividades?page=1&id=159665`,
          `${base}/votaciones?page=1&id=159665`,
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves distinct official history ids and every commission assignment", async () => {
    const base = "https://official.test/api/iniciativa";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/iniciativa/158156")) return json(initiativeFixture(158156));
      if (url.pathname.endsWith("/proponentes")) {
        return json(page([{ principal: true, nombreCompleto: "Ana Pérez" }]));
      }
      if (url.pathname.endsWith("/historicos")) {
        return json(
          page([
            {
              id: 609826,
              estado: "En Orden del Día",
              inicio: "2026-05-12T00:00:00",
              fin: "2026-05-12T00:00:00",
            },
            {
              id: 609684,
              estado: "En Orden del Día",
              inicio: "2026-05-12T00:00:00",
              fin: "2026-05-13T00:00:00",
            },
          ]),
        );
      }
      if (url.pathname.endsWith("/comisiones")) {
        const secondPage = url.searchParams.get("page") === "2";
        return json({
          page: secondPage ? 2 : 1,
          pageSize: 1,
          total: 2,
          results: secondPage
            ? [
                {
                  id: 4026,
                  tipoId: 974,
                  tipo: "Permanente",
                  comision: "Interior y Policía ",
                  inicio: "2026-05-12T00:00:00",
                  fin: "2026-06-10T00:00:00",
                },
              ]
            : [
                {
                  id: 5245,
                  tipoId: 975,
                  tipo: "Especial",
                  comision: "Comisión especial para el estudio del proyecto",
                  inicio: "2026-05-19T00:00:00",
                  fin: "2026-06-17T00:00:00",
                },
              ],
        });
      }
      if (url.pathname.endsWith("/Actividades") || url.pathname.endsWith("/votaciones")) {
        return json(page([]));
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const adapter = new SilDiputadosAdapter(base);
      const mapped = await adapter.detail("158156");
      const enriched = await adapter.enrich(mapped!);

      expect(enriched.history).toEqual([
        expect.objectContaining({
          sourceEventId: "609826",
          status: "En Orden del Día",
          date: "2026-05-12",
          endDate: "2026-05-12",
        }),
        expect.objectContaining({
          sourceEventId: "609684",
          status: "En Orden del Día",
          date: "2026-05-12",
          endDate: "2026-05-13",
        }),
      ]);
      expect(enriched.commissionAssignments).toEqual([
        expect.objectContaining({
          sourceId: "5245",
          sourceTypeId: "975",
          type: "Especial",
          name: "Comisión especial para el estudio del proyecto",
          startDate: "2026-05-19",
          endDate: "2026-06-17",
        }),
        expect.objectContaining({
          sourceId: "4026",
          sourceTypeId: "974",
          type: "Permanente",
          name: "Interior y Policía",
          startDate: "2026-05-12",
          endDate: "2026-06-10",
        }),
      ]);
      expect(enriched.committee).toBeNull();
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("comisiones?page=2&id=158156"),
        ),
      ).toBe(true);
      expect(enriched.raw).toMatchObject({
        payload: { historicos: expect.any(Array), comisiones: expect.any(Array) },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sets the legacy committee only when exactly one assignment is published", async () => {
    const base = "https://official.test/api/iniciativa";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/iniciativa/7")) return json(initiativeFixture(7));
      if (url.pathname.endsWith("/proponentes") || url.pathname.endsWith("/historicos")) {
        return json(page([]));
      }
      if (url.pathname.endsWith("/comisiones")) {
        return json(
          page([
            {
              id: 12,
              tipoId: 974,
              tipo: "Permanente",
              comision: "  Comisión de Justicia  ",
              inicio: null,
              fin: null,
            },
          ]),
        );
      }
      if (url.pathname.endsWith("/Actividades") || url.pathname.endsWith("/votaciones")) {
        return json(page([]));
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const adapter = new SilDiputadosAdapter(base);
      const mapped = await adapter.detail("7");
      const enriched = await adapter.enrich(mapped!);
      expect(enriched.committee).toBe("Comisión de Justicia");
      expect(enriched.commissionAssignments).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function initiativeFixture(id: number) {
  return {
    id,
    numero: `0000${id}-2024-2028-CD`,
    tipo: "Proyecto de Ley",
    tipoId: 1,
    descripcion: "Título oficial",
    camaraInicio: "Cámara de Diputados",
    grupo: "Justicia",
    grupoId: 1,
    materia: "JUSTICIA",
    estado: "Depositada",
    condicion: "VIGENTE",
    fechaDeposito: "2026-05-05T00:00:00",
    fechaUltimoCambioPrincipal: "2026-05-05T00:00:00",
    periodoRegistro: "2024-2028",
    origen: "Cámara de Diputados",
  };
}

function page<T>(results: T[]) {
  return { page: 1, pageSize: 10, total: results.length, results };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

interface CatalogFixtureOptions {
  unstableTotal?: boolean;
  emptyMiddlePage?: boolean;
  overlapGlobalPages?: boolean;
  duplicateGlobalCode?: boolean;
  omitPartitionSerial?: number;
  serialHighWatermark?: number;
}

function catalogFetchFixture(options: CatalogFixtureOptions = {}) {
  const serials = [1, 2, 4, 5, 6];
  const rows = serials.map((serial) => ({
    ...initiativeFixture(100 + serial),
    numero: `${String(serial).padStart(5, "0")}-2024-2028-CD`,
  }));
  if (options.duplicateGlobalCode) rows[1]!.numero = rows[0]!.numero;
  const partitionRows = rows.filter(
    (_row, index) => serials[index] !== options.omitPartitionSerial,
  );
  const groups = Array.from({ length: 15 }, (_, index) => ({
    id: index + 1,
    descripcion: `Grupo ${index + 1}`,
    icono: "",
  }));
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CountIniciativas")) {
      return json(options.serialHighWatermark ?? 6);
    }
    if (url.pathname.endsWith("/Grupos")) return json(groups);
    const requestedPage = Number(url.searchParams.get("page"));
    if (url.pathname.endsWith("/getIniciativas")) {
      const start = (requestedPage - 1) * 2;
      let results = rows.slice(start, start + 2);
      if (options.emptyMiddlePage && requestedPage === 2) results = [];
      if (options.overlapGlobalPages && requestedPage === 2) {
        results = [rows[1]!, rows[2]!];
      }
      return json({
        page: requestedPage,
        pageSize: 2,
        total: options.unstableTotal && requestedPage === 2 ? 6 : 5,
        results,
      });
    }
    if (url.pathname.endsWith("/iniciativas")) {
      const isPopulatedPartition =
        url.searchParams.get("grupo") === "1" &&
        url.searchParams.get("tipo") === "true" &&
        url.searchParams.get("perimidas") === "false";
      const results = isPopulatedPartition
        ? partitionRows.slice((requestedPage - 1) * 2, requestedPage * 2)
        : [];
      return json({
        page: requestedPage,
        pageSize: 2,
        total: isPopulatedPartition ? partitionRows.length : 0,
        results,
      });
    }
    throw new Error(`Unexpected catalogue fixture URL: ${url}`);
  });
}

/** Live tests hit the real Cámara de Diputados SIL API. Run: `npm run test:live`. */
live("SilDiputadosAdapter (live)", () => {
  const a = new SilDiputadosAdapter();

  it("count() returns a plausible total", async () => {
    expect(await a.count()).toBeGreaterThan(1000);
  }, 30_000);

  it("groups() returns the subject taxonomy", async () => {
    const groups = await a.groups();
    expect(groups.length).toBeGreaterThan(5);
    expect(groups[0]).toHaveProperty("descripcion");
  }, 30_000);

  it("listPage() returns mapped initiatives with code + title", async () => {
    const env = await a.listPage(1, true, 1);
    expect(env.total).toBeGreaterThan(0);
    expect(env.results.length).toBeGreaterThan(0);
    const r = env.results[0]!;
    expect(r).toHaveProperty("numero");
    expect(r).toHaveProperty("descripcion");
  }, 30_000);

  it("enrich() adds sponsor, history, and commission facts to a real initiative", async () => {
    const env = await a.listPage(1, true, 1);
    expect(env.results.length).toBeGreaterThan(0);
    // Exercise map -> enrich on the same bounded official page. `list()` intentionally
    // reconciles the complete catalogue, which belongs to the corpus gate rather than
    // this single-record live smoke test.
    const mapped = mapSilInitiative(env.results[0]!);
    const enriched = await a.enrich(mapped);
    expect(mapped.code).toBeTruthy();
    expect(mapped.title.length).toBeGreaterThan(3);
    // enrichment should surface a party (e.g. "PRM") and a province for most bills
    expect(enriched.party || enriched.province).toBeTruthy();
    expect(Array.isArray(enriched.history)).toBe(true);
    expect(Array.isArray(enriched.commissionAssignments)).toBe(true);
    for (const event of enriched.history) {
      expect(event).toHaveProperty("sourceEventId");
      expect(event).toHaveProperty("endDate");
    }
  }, 60_000);
});
