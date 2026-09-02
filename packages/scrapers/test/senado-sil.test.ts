import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSenadoListResetBody,
  buildSenadoNextPageBody,
  parseExpedientesList,
  parseSenadoFicha,
  parseSenadoFichaHistory,
  parseSenadoListPageInfo,
  parseSenadoSilProponentCatalog,
  resolveSenadoSilFichaProponents,
  REVIEWED_SENADO_SIL_PERSON_BRIDGE,
  SenadoSilAdapter,
  SENADO_SIL_PERSON_NAMESPACE,
  SENADO_PORTAL_INICIATIVAS,
  senateSilExactNameKey,
  validateSenadoFichaResponse,
} from "../src/senado-sil.js";
import type { SenadoSilProponentCatalogOption } from "../src/senado-sil.js";

const FICHA_39793 = readFileSync(
  fileURLToPath(new URL("./fixtures/senado-ficha-39793.html", import.meta.url)),
  "utf8",
);

// Real row shapes from lista_expedientes.aspx?coleccion=53 (trimmed).
const SAMPLE_HTML = `
<table>
  <tr><th>Iniciativa</th><th>Tipo</th><th>Título</th><th>Fecha</th><th>Estado</th></tr>
  <tr>
    <td><a href='Ficha.aspx?IdExpediente=39660&numeropagina=1&ContExpedientes=2451&Coleccion=53'>01677-2026-PLO-SE</a></td>
    <td><a href='Ficha.aspx?IdExpediente=39660&Coleccion=53'>Proyecto de Ley </a></td>
    <td><a href='Ficha.aspx?IdExpediente=39660&Coleccion=53'></a></td>
    <td>23/06/2026</td><td>Depositada</td>
  </tr>
  <tr>
    <td><a href='Ficha.aspx?IdExpediente=39545&Coleccion=53'>01628-2026-PLO-SE</a></td>
    <td><a href='Ficha.aspx?IdExpediente=39545&Coleccion=53'>Resolución</a></td>
    <td><a href='Ficha.aspx?IdExpediente=39545&Coleccion=53'>RESOLUCIÓN QUE SOLICITA AL PRESIDENTE</a></td>
    <td>29/05/2026</td><td>Enviada a Comisión</td>
  </tr>
  <tr><td>footer with no date</td><td></td><td></td><td></td><td></td></tr>
</table>`;

function senateListPageFixture(input: {
  firstId: number;
  rows: number;
  linkTotal: number;
  displayedTotal?: number;
}): string {
  const rows = Array.from({ length: input.rows }, (_, index) => {
    const id = input.firstId - index;
    return `<tr>
      <td><a href='Ficha.aspx?IdExpediente=${id}&numeropagina=1&ContExpedientes=${input.linkTotal}&Coleccion=53'>${String(id).padStart(5, "0")}-2026-SLO-SE</a></td>
      <td>Proyecto de Ley</td><td>Iniciativa oficial ${id}</td><td>02/09/2026</td><td>Depositada</td>
    </tr>`;
  }).join("");
  return `<form action="lista_expedientes.aspx?coleccion=53">
    <input id="__VIEWSTATE" value="state-${input.firstId}" />
    <input id="__VIEWSTATEGENERATOR" value="generator" />
    <input id="__EVENTVALIDATION" value="validation" />
    <span id="txtpaginas">1 - ${input.rows} de </span>
    ${input.displayedTotal === undefined ? "" : `<span id="txttotalexp">${input.displayedTotal}</span>`}
    <table id="DtgExpedientes">${rows}</table>
    <input type="image" name="btSumaPaginacion" id="btSumaPaginacion" />
  </form>`;
}

describe("senado-sil: parseExpedientesList", () => {
  it("parses one deposited initiative per source row, skipping non-record rows", () => {
    const rows = parseExpedientesList(SAMPLE_HTML, 53);
    expect(rows).toHaveLength(2);
  });

  it("retains an official record with no parseable date for full-corpus mode", () => {
    const rows = parseExpedientesList(
      `<tr>
        <td><a href='Ficha.aspx?IdExpediente=40000&numeropagina=2&ContExpedientes=2559&Coleccion=53'>01800-2026-PLO-SE</a></td>
        <td>Proyecto de Ley</td><td>Título oficial</td><td></td><td>Depositada</td>
      </tr>`,
      53,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filedAt).toBeNull();
  });

  it("reads page, total and collection from exact official link metadata", () => {
    expect(parseSenadoListPageInfo(SAMPLE_HTML)).toEqual({
      page: 1,
      total: 2451,
      collection: 53,
    });
  });

  it("uses the official visible total when 50 real rows carry zero link metadata", () => {
    const html = senateListPageFixture({
      firstId: 40_011,
      rows: 50,
      linkTotal: 0,
      displayedTotal: 2_676,
    });
    expect(parseExpedientesList(html, 53)).toHaveLength(50);
    expect(parseSenadoListPageInfo(html)).toEqual({
      page: 1,
      total: 2_676,
      collection: 53,
    });
  });

  it("uses the same official total when WebForms emits txttotalexp as an input", () => {
    const html = senateListPageFixture({
      firstId: 40_011,
      rows: 50,
      linkTotal: 0,
    }).replace(
      '<span id="txtpaginas">1 - 50 de </span>',
      '<span id="txtpaginas">1 - 50 de </span><input id="txttotalexp" value="2676" />',
    );
    expect(parseSenadoListPageInfo(html)).toEqual({
      page: 1,
      total: 2_676,
      collection: 53,
    });
  });

  it("fails closed when a zero link total has no visible cardinality", () => {
    const html = senateListPageFixture({ firstId: 40_011, rows: 50, linkTotal: 0 });
    expect(parseSenadoListPageInfo(html)).toBeNull();
  });

  it("fails closed when a non-empty page also displays a zero total", () => {
    const html = senateListPageFixture({
      firstId: 40_011,
      rows: 50,
      linkTotal: 0,
      displayedTotal: 0,
    });
    expect(parseSenadoListPageInfo(html)).toBeNull();
  });

  it("prefers the visible total when newly published rows leave link metadata behind", () => {
    const html = senateListPageFixture({
      firstId: 40_011,
      rows: 50,
      linkTotal: 2_675,
      displayedTotal: 2_676,
    });
    expect(parseSenadoListPageInfo(html)).toEqual({
      page: 1,
      total: 2_676,
      collection: 53,
    });
  });

  it("continues after a 50-row zero-metadata page and reconciles the visible total", async () => {
    const originalFetch = globalThis.fetch;
    const listPages = [
      senateListPageFixture({ firstId: 5_000, rows: 50, linkTotal: 0, displayedTotal: 75 }),
      senateListPageFixture({ firstId: 4_950, rows: 25, linkTotal: 75, displayedTotal: 75 }),
    ];
    let listRequests = 0;
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      if (target.endsWith("/login.aspx") && (init?.method ?? "GET") === "GET") {
        return new Response(
          '<input id="__VIEWSTATE" value="login" /><input id="__VIEWSTATEGENERATOR" value="generator" /><input id="__EVENTVALIDATION" value="validation" />',
        );
      }
      if (target.endsWith("/login.aspx")) return new Response("Colecciones");
      if (target.includes("lista_expedientes.aspx")) {
        const page = listRequests < 2 ? listPages[0]! : listPages[1]!;
        listRequests++;
        return new Response(page);
      }
      throw new Error(`Unexpected Senado SIL fixture request: ${target}`);
    };
    try {
      const rows = await new SenadoSilAdapter().listDeposits();
      expect(rows).toHaveLength(75);
      expect(new Set(rows.map((row) => row.idExpediente)).size).toBe(75);
      expect(listRequests).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("submits only postback state and the full-corpus checkbox when requesting the next page", () => {
    const body = buildSenadoNextPageBody(
      `<form>
        <input id="__VIEWSTATE" value="state+value" />
        <input id="__VIEWSTATEGENERATOR" value="generator" />
        <input id="__EVENTVALIDATION" value="validation" />
        <input type="radio" name="Orden" value="RBOrdenAsc" />
        <input checked="checked" type="radio" name="Orden" value="RBOrdenDes" />
        <select name="cmbEstado"><option value="0">Abiertos</option><option selected value="-1">Todos</option></select>
        <select name="cmbOrden"><option value="fc">Fecha</option><option value="co">Código</option></select>
        <input name="txtBuscar" value="" />
        <input type="checkbox" name="CBExpCerrados" checked />
      </form>`,
      "btSumaPaginacion",
    );
    expect(Object.fromEntries(new URLSearchParams(body))).toMatchObject({
      __VIEWSTATE: "state+value",
      __VIEWSTATEGENERATOR: "generator",
      __EVENTVALIDATION: "validation",
      CBExpCerrados: "on",
      "btSumaPaginacion.x": "10",
      "btSumaPaginacion.y": "10",
    });
    expect(body).not.toContain("Orden=");
    expect(body).not.toContain("cmbEstado=");
    expect(body).not.toContain("cmbOrden=");
    expect(body).not.toContain("txtBuscar=");
  });

  it("resets the public grid to an explicit newest-first full collection before paging", () => {
    const body = buildSenadoListResetBody(
      `<input id="__VIEWSTATE" value="state" />
       <input id="__VIEWSTATEGENERATOR" value="generator" />
       <input id="__EVENTVALIDATION" value="validation" />`,
    );
    expect(Object.fromEntries(new URLSearchParams(body))).toMatchObject({
      Orden: "RBOrdenDes",
      cmbEstado: "-1",
      cmbOrden: "fc",
      txtBuscar: "",
      CBExpCerrados: "on",
      "IBOrdenar.x": "10",
      "IBOrdenar.y": "10",
    });
  });

  it("extracts code, type, title, ISO date, status, and source URL", () => {
    const [first, second] = parseExpedientesList(SAMPLE_HTML, 53);
    expect(first).toMatchObject({
      code: "01677-2026-PLO-SE",
      idExpediente: "39660",
      type: "Proyecto de Ley",
      title: null, // blank title cell → null
      filedAt: "2026-06-23",
      status: "Depositada",
      // Per-expediente Ficha.aspx URLs are auth-gated (served via the /api/senado/ficha
      // proxy), so the public sourceUrl is the iniciativas landing page by design.
      sourceUrl: SENADO_PORTAL_INICIATIVAS,
    });
    expect(second).toMatchObject({
      code: "01628-2026-PLO-SE",
      type: "Resolución",
      title: "RESOLUCIÓN QUE SOLICITA AL PRESIDENTE",
      filedAt: "2026-05-29",
      status: "Enviada a Comisión",
    });
  });
});

describe("senado-sil: ficha validation", () => {
  const url =
    "http://www.senado.gov.do/wfilemaster/Ficha.aspx?IdExpediente=39660&numeropagina=1&ContExpedientes=0&Coleccion=53";
  const html = `
    <html><body>
      <form action="Ficha.aspx?IdExpediente=39660&amp;numeropagina=1&amp;ContExpedientes=0&amp;Coleccion=53">
        <table id="tblEspedientes">
          <tr><td>Número de Iniciativa</td><td><textarea id="campos_text_628">01677-2026-PLO-SE</textarea></td></tr>
        </table>
      </form>
    </body></html>`;

  it("accepts a ficha that proves the requested expediente and collection", () => {
    expect(
      validateSenadoFichaResponse({
        idExpediente: "39660",
        collection: 53,
        status: 200,
        url,
        html,
      }),
    ).toEqual({ initiativeCode: "01677-2026-PLO-SE" });
  });

  it("rejects HTTP failures and login/error payloads even when they are HTML", () => {
    expect(() =>
      validateSenadoFichaResponse({
        idExpediente: "39660",
        collection: 53,
        status: 503,
        url,
        html,
      }),
    ).toThrow(/HTTP 503/);
    expect(() =>
      validateSenadoFichaResponse({
        idExpediente: "39660",
        collection: 53,
        status: 200,
        url,
        html: `<form action="login.aspx"><input id="imgBtnIngresoAlternativo"></form>`,
      }),
    ).toThrow(/login page/);
    expect(() =>
      validateSenadoFichaResponse({
        idExpediente: "39660",
        collection: 53,
        status: 200,
        url,
        html: "<h1>Servicio temporalmente no disponible</h1>",
      }),
    ).toThrow(/error page/);
  });

  it("rejects wrong destinations and an expediente mismatch before caching", () => {
    expect(() =>
      validateSenadoFichaResponse({
        idExpediente: "39660",
        collection: 53,
        status: 200,
        url: "http://www.senado.gov.do/wfilemaster/login.aspx",
        html,
      }),
    ).toThrow(/unexpected URL/);
    expect(() =>
      validateSenadoFichaResponse({
        idExpediente: "99999",
        collection: 53,
        status: 200,
        url: url.replace("39660", "99999"),
        html,
      }),
    ).toThrow(/does not match/);
  });
});

describe("senado-sil: factual ficha fields", () => {
  it("maps only fields proven by their official label and stable control id", () => {
    const facts = parseSenadoFicha(FICHA_39793);
    expect(facts).toMatchObject({
      initiativeCode: "01733-2026-PLO-SE",
      type: "Préstamo",
      title: "CONTRATO DE PRÉSTAMO PARA EL PLAN DE MANEJO DE CUENCA DEL RÍO YUNA.",
      currentStatus: "Promulgada",
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
      historyParseComplete: true,
    });
    expect(facts.history).toEqual([
      {
        status: "Depositada",
        date: "2026-07-23",
        literal: "Depositada el 23/7/2026.",
      },
      { status: "En Agenda", date: "2026-07-24", literal: "En Agenda el 24/7/2026." },
      { status: "Promulgada", date: "2026-07-30", literal: "Promulgada el 30/7/2026." },
    ]);
    // The legacy Ficha states an initial chamber, but has no "current chamber" field.
    expect(facts).not.toHaveProperty("currentChamber");
    expect(facts.rawFields).toContainEqual({
      key: "proponents",
      label: "Proponentes",
      controlId: "campos_nota_644",
      literal: "PODER EJECUTIVO",
    });
  });

  it("does not trust a reused control id when its visible label no longer matches", () => {
    const drifted = FICHA_39793.replace(
      "<td>Proponentes</td>",
      "<td>Operador que digitó el expediente</td>",
    );
    expect(parseSenadoFicha(drifted).proponents).toBeUndefined();
  });

  it("keeps an unrecognized history literal but emits no partial timeline", () => {
    const literal =
      "Depositada el 23/7/2026. Nota administrativa sin fecha. Promulgada el 30/7/2026.";
    expect(parseSenadoFichaHistory(literal)).toEqual({ events: [], complete: false });
    const drifted = FICHA_39793.replace(
      "Depositada el 23/7/2026. En Agenda el 24/7/2026. Promulgada el 30/7/2026.",
      literal,
    );
    const facts = parseSenadoFicha(drifted);
    expect(facts.historyLiteral).toBe(literal);
    expect(facts.history).toEqual([]);
    expect(facts.historyParseComplete).toBe(false);
  });

  it("enforces a bounded batch before opening any network session", async () => {
    const inputs = Array.from({ length: 101 }, (_, idExpediente) => ({ idExpediente }));
    await expect(new SenadoSilAdapter().fetchFichaFactsBatch(inputs)).rejects.toThrow(
      /100-record safety limit/,
    );
  });
});

function catalogHtml(personCount = 32): string {
  const people = REVIEWED_SENADO_SIL_PERSON_BRIDGE.slice(0, personCount)
    .map((row) => `<option value="${row.personSourceId}">${row.officialName}</option>`)
    .join("");
  const institutions = Array.from(
    { length: 12 },
    (_, index) => `<option value="${8000 + index}">INSTITUCIÓN ${index + 1}</option>`,
  ).join("");
  return `<select id="lsbLista1">${people}</select><select id="lsbLista2">${institutions}</select>`;
}

describe("senado-sil: official proponent identity catalog", () => {
  it("requires a reviewed 32-person bijection and separates the 12 institutional options", () => {
    const catalog = parseSenadoSilProponentCatalog(catalogHtml(), {
      observedAt: "2026-08-31T12:00:00.000Z",
      sourceUrl:
        "http://www.senado.gov.do/wfilemaster/AgregarListaMultiple.aspx?nombreCampo=campos_nota_644&codigoLista=128-82",
    });
    expect(catalog.people).toHaveLength(32);
    expect(catalog.institutions).toHaveLength(12);
    expect(catalog.people[0]).toMatchObject({
      namespace: SENADO_SIL_PERSON_NAMESPACE,
      sourceId: "3412",
      officialName: "Alexis Victoria Yeb",
      provenance: { selectId: "lsbLista1", listCode: "128-82" },
    });
    expect(catalog.institutions[0]?.provenance.selectId).toBe("lsbLista2");
    expect(new Set(REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => row.personSourceId)).size).toBe(
      32,
    );
    expect(new Set(REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => row.rosterSourceId)).size).toBe(
      32,
    );
  });

  it("fails closed when the official person cardinality drifts", () => {
    expect(() => parseSenadoSilProponentCatalog(catalogHtml(31))).toThrow(
      /expected 32, observed 31/,
    );
  });

  it("documents every material profile-name difference as an explicit reviewed alias", () => {
    const materialDifferences = REVIEWED_SENADO_SIL_PERSON_BRIDGE.filter(
      (row) =>
        senateSilExactNameKey(row.officialName) !== senateSilExactNameKey(row.rosterOfficialName),
    );
    expect(materialDifferences).toHaveLength(8);
    expect(
      materialDifferences.every((row) => row.profileNameAliases?.includes(row.rosterOfficialName)),
    ).toBe(true);
    const rowsWithReviewedAliases = REVIEWED_SENADO_SIL_PERSON_BRIDGE.filter(
      (row) => (row.profileNameAliases?.length ?? 0) > 0,
    );
    expect(rowsWithReviewedAliases).toHaveLength(11);
    expect(
      rowsWithReviewedAliases.every((row) =>
        row.profileNameAliases?.includes(row.rosterOfficialName),
      ),
    ).toBe(true);
  });
});

function syntheticPerson(sourceId: string, officialName: string): SenadoSilProponentCatalogOption {
  return {
    namespace: SENADO_SIL_PERSON_NAMESPACE,
    sourceId,
    officialName,
    provenance: {
      sourceUrl: "http://www.senado.gov.do/wfilemaster/AgregarListaMultiple.aspx",
      collection: 53,
      listCode: "128-82",
      personSelectId: "lsbLista1",
      institutionSelectId: "lsbLista2",
      observedAt: "2026-08-31T12:00:00.000Z",
      selectId: "lsbLista1",
    },
  };
}

describe("senado-sil: exact Ficha proponent reconciliation", () => {
  const people = REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) =>
    syntheticPerson(row.personSourceId, row.officialName),
  );

  it("resolves exact case/whitespace-normalized names and semicolon co-proponents", () => {
    const rows = resolveSenadoSilFichaProponents(
      "  alexis   victoria yeb ; FÉLIX RAMÓN BAUTISTA ROSARIO ",
      people,
    );
    expect(rows.map((row) => row.person?.sourceId)).toEqual(["3412", "2847"]);
    expect(rows.every((row) => row.resolution === "exact")).toBe(true);
  });

  it("accepts `y` only when exactly one split resolves both complete catalog names", () => {
    const rows = resolveSenadoSilFichaProponents(
      "Alexis Victoria Yeb y Santiago José Zorrilla",
      people,
    );
    expect(rows.map((row) => row.person?.sourceId)).toEqual(["3412", "3314"]);
    expect(rows.every((row) => row.resolution === "exact-y-pair")).toBe(true);
  });

  it("retains ambiguous `y` and comma-delimited literals as unresolved evidence", () => {
    const ambiguousPeople = [
      syntheticPerson("1", "A"),
      syntheticPerson("2", "B y C"),
      syntheticPerson("3", "A y B"),
      syntheticPerson("4", "C"),
    ];
    expect(resolveSenadoSilFichaProponents("A y B y C", ambiguousPeople)).toMatchObject([
      { publishedName: "A y B y C", person: null, resolution: "unresolved" },
    ]);
    expect(
      resolveSenadoSilFichaProponents("Alexis Victoria Yeb, Félix Ramón Bautista Rosario", people),
    ).toMatchObject([
      {
        publishedName: "Alexis Victoria Yeb, Félix Ramón Bautista Rosario",
        person: null,
        resolution: "unresolved",
      },
    ]);
  });
});
