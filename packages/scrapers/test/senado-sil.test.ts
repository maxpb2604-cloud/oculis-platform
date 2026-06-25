import { describe, expect, it } from "vitest";
import { parseExpedientesList, SENADO_PORTAL_INICIATIVAS } from "../src/senado-sil.js";

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
  it("parses one deposited initiative per data row, skipping non-date rows", () => {
    const rows = parseExpedientesList(SAMPLE_HTML, 53);
    expect(rows).toHaveLength(2);
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
