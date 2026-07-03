import { afterEach, describe, expect, it, vi } from "vitest";
import { parseExpedientesList, SenadoSilAdapter, SENADO_PORTAL_INICIATIVAS } from "../src/senado-sil.js";

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

// --- HTTP-level guards (mocked fetch): login verification + error-page detection ---

const LOGIN_FORM = `<html><body><form action="login.aspx">
  <input type="hidden" id="__VIEWSTATE" value="vs" />
  <input type="hidden" id="__VIEWSTATEGENERATOR" value="gen" />
  <input type="hidden" id="__EVENTVALIDATION" value="ev" />
  <input type="image" name="imgBtnIngresoAlternativo" id="imgBtnIngresoAlternativo" />
</form></body></html>`;

const COLECCIONES_PAGE = `<html><body><h1>Colecciones</h1>
  <a href="lista_expedientes.aspx?coleccion=53">Colección 2024-2028</a></body></html>`;

const ASPNET_ERROR_PAGE = `<html><body><h1>Error de servidor en la aplicación '/wfilemaster'.</h1>
  <h2>Referencia a objeto no establecida como instancia de un objeto.</h2></body></html>`;

type Route = (url: string, method: string) => Response | undefined;

/** Route-based fetch stub; unmatched requests fail the test loudly. */
function stubFetch(route: Route): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const res = route(String(url), init?.method ?? "GET");
      if (!res) throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
      return res;
    }),
  );
}

const page = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html", ...headers } });

/** Happy-path login: GET form → POST → 302 → colecciones.aspx (with session cookie). */
const loginRoutes: Route = (url, method) => {
  if (url.endsWith("/login.aspx") && method === "GET") {
    return page(LOGIN_FORM, 200, { "set-cookie": "ASP.NET_SessionId=abc; path=/" });
  }
  if (url.endsWith("/login.aspx") && method === "POST") {
    return page("", 302, { location: "colecciones.aspx" });
  }
  if (url.includes("colecciones.aspx")) return page(COLECCIONES_PAGE);
  return undefined;
};

afterEach(() => vi.unstubAllGlobals());

describe("senado-sil: loginPublic guard", () => {
  it("returns the session jar when the redirect chain lands on colecciones.aspx", async () => {
    stubFetch(loginRoutes);
    const jar = await new SenadoSilAdapter().loginPublic();
    expect(jar.get("ASP.NET_SessionId")).toBe("abc");
  });

  it("throws when the POST is answered with the login form again — even with a session cookie", async () => {
    // ASP.NET issues ASP.NET_SessionId on ANY request, so the cookie is not proof of login.
    stubFetch((url, _method) => {
      if (url.endsWith("/login.aspx")) {
        return page(LOGIN_FORM, 200, { "set-cookie": "ASP.NET_SessionId=anon; path=/" });
      }
      return undefined;
    });
    await expect(new SenadoSilAdapter().loginPublic()).rejects.toThrow(/login público/i);
  });

  it("throws on a non-2xx login page instead of parsing it", async () => {
    stubFetch(() => page(ASPNET_ERROR_PAGE, 500));
    await expect(new SenadoSilAdapter().loginPublic()).rejects.toThrow(/HTTP 500/);
  });
});

describe("senado-sil: listDeposits HTTP guards", () => {
  it("throws (instead of recording 0 deposits) when lista_expedientes returns a server error", async () => {
    stubFetch((url, method) => {
      if (url.includes("lista_expedientes.aspx")) return page(ASPNET_ERROR_PAGE, 500);
      return loginRoutes(url, method);
    });
    await expect(new SenadoSilAdapter().listDeposits()).rejects.toThrow(/HTTP 500/);
  });

  it("throws when an ASP.NET error page is served with HTTP 200", async () => {
    stubFetch((url, method) => {
      if (url.includes("lista_expedientes.aspx")) return page(ASPNET_ERROR_PAGE, 200);
      return loginRoutes(url, method);
    });
    await expect(new SenadoSilAdapter().listDeposits()).rejects.toThrow(/página de error/i);
  });
});

describe("senado-sil: fetchFicha error-page detection", () => {
  it("throws so the web proxy 502s instead of serving upstream error HTML as a ficha", async () => {
    stubFetch((url, method) => {
      if (url.includes("lista_expedientes.aspx")) return page(SAMPLE_HTML);
      if (url.includes("Ficha.aspx")) return page(ASPNET_ERROR_PAGE, 200);
      return loginRoutes(url, method);
    });
    await expect(new SenadoSilAdapter().fetchFicha(39660)).rejects.toThrow(/página de error/i);
  });

  it("returns the ficha HTML when the upstream responds normally", async () => {
    const FICHA = "<html><body><h1>Ficha del Expediente 01677-2026-PLO-SE</h1></body></html>";
    stubFetch((url, method) => {
      if (url.includes("lista_expedientes.aspx")) return page(SAMPLE_HTML);
      if (url.includes("Ficha.aspx")) return page(FICHA);
      return loginRoutes(url, method);
    });
    await expect(new SenadoSilAdapter().fetchFicha(39660)).resolves.toBe(FICHA);
  });
});
