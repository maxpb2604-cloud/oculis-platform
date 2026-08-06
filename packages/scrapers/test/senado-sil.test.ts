import { describe, expect, it } from "vitest";
import {
  buildSenadoListResetBody,
  buildSenadoNextPageBody,
  parseExpedientesList,
  parseSenadoListPageInfo,
  SENADO_PORTAL_INICIATIVAS,
} from "../src/senado-sil.js";

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
