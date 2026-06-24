/**
 * Adapter for the Senate's deposited-initiatives list — the source the manual
 * monitoring playbook calls "Actividad legislativa → Iniciativas Legislativas".
 *
 * Unlike the WordPress document portal handled by {@link SenadoAdapter}, the actual
 * deposited-initiatives registry lives in a legacy MasterLex "SIL" system (ASP.NET
 * WebForms) at senado.gov.do/wfilemaster. It is reachable over plain HTTP with NO
 * reCAPTCHA: the login page ships a built-in public-consultation user reachable via the
 * "Ingreso Alternativo" button, which establishes an ASP.NET session we then reuse to
 * read `lista_expedientes.aspx`. Each row is one deposited initiative with its code,
 * type, title, deposit date, and status.
 */
import { buildISODate } from "./dates.js";
import { DEFAULT_UA } from "./http.js";

const ORIGIN = "http://www.senado.gov.do";
const BASE = `${ORIGIN}/wfilemaster`;

/**
 * Current legislative period (cuatrienio) → its `coleccion` id in the SIL. 53 is the
 * 2024-2028 period (the live one). Older periods exist (54+/lower ids) but the daily
 * deposits feed only needs the current collection.
 */
export const SENADO_SIL_COLECCION_ACTUAL = 53;

export interface SenadoExpediente {
  /** Expediente code, e.g. "01677-2026-PLO-SE". */
  code: string;
  /** Internal record id used to build the Ficha (detail) URL. */
  idExpediente: string | null;
  /** Initiative type, e.g. "Proyecto de Ley", "Resolución". */
  type: string | null;
  /** Plain-language title (occasionally blank in the list for brand-new filings). */
  title: string | null;
  /** Deposit date as ISO yyyy-mm-dd. */
  filedAt: string | null;
  /** Procedural status, e.g. "Depositada", "Enviada a Comisión". */
  status: string | null;
  /** Official detail page (Ficha) for the expediente, when its id is known. */
  sourceUrl: string | null;
}

export interface SenadoSilOptions {
  /** Inclusive lower bound (ISO yyyy-mm-dd). Rows filed before this are dropped. */
  since?: string;
  /** Inclusive upper bound (ISO yyyy-mm-dd). Rows filed after this are dropped. */
  until?: string;
  /** Collection id to read (defaults to the current period). */
  coleccion?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
}

// --- tiny cookie jar (Node fetch does not persist cookies across calls) ---
type Jar = Map<string, string>;

function absorbCookies(jar: Jar, res: Response): void {
  // getSetCookie() returns each Set-Cookie header separately (undici/Node 18.14+).
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const raw of cookies) {
    const pair = raw.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Jar): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Resolve a Location header against the legacy app's origin. */
function absoluteUrl(loc: string): string {
  if (loc.startsWith("http")) return loc;
  return ORIGIN + (loc.startsWith("/") ? loc : `/wfilemaster/${loc}`);
}

/**
 * Fetch that manually follows redirects while persisting cookies across every hop.
 * This matters because the post-login flow bounces through several ASP.NET pages
 * (login → Consultante → ConsultanteOriginal → colecciones) and the active-period
 * database is only bound to the session once that whole chain is walked.
 */
async function req(
  url: string,
  jar: Jar,
  init: { method?: string; body?: string; timeoutMs?: number } = {},
): Promise<{ status: number; text: string; url: string }> {
  let current = url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; hop < 8; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 35_000);
    try {
      const res = await fetch(current, {
        method,
        body,
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "text/html,application/xhtml+xml,*/*",
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
        },
      });
      absorbCookies(jar, res);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = absoluteUrl(location);
        method = "GET"; // redirects are followed as GET (303-style, matches browsers here)
        body = undefined;
        continue;
      }
      return { status: res.status, text: await res.text(), url: current };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0, text: "", url: current };
}

function hiddenField(html: string, id: string): string {
  const m = html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`, "i"));
  return m?.[1] ?? "";
}

/** dd/mm/yyyy → ISO yyyy-mm-dd (null if unparseable). */
function ddmmyyyyToISO(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? buildISODate(m[1]!, m[2]!, m[3]!) : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse the `lista_expedientes.aspx` HTML into one row per deposited initiative. */
export function parseExpedientesList(html: string, coleccion: number): SenadoExpediente[] {
  const out: SenadoExpediente[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    if (!/\d{1,2}\/\d{1,2}\/\d{4}/.test(row)) continue; // data rows carry a date
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1] ?? "");
    if (cells.length < 5) continue;
    const code = stripTags(cells[0]!);
    if (!code) continue;
    const idMatch = row.match(/IdExpediente=(\d+)/i);
    const idExpediente = idMatch?.[1] ?? null;
    out.push({
      code,
      idExpediente,
      type: stripTags(cells[1]!) || null,
      title: stripTags(cells[2]!) || null,
      filedAt: ddmmyyyyToISO(stripTags(cells[3]!)),
      status: stripTags(cells[4]!) || null,
      sourceUrl: idExpediente
        ? `${BASE}/Ficha.aspx?IdExpediente=${idExpediente}&Coleccion=${coleccion}`
        : null,
    });
  }
  return out;
}

export class SenadoSilAdapter {
  readonly source = "senado-sil";
  private readonly base: string;

  constructor(base: string = BASE) {
    this.base = base;
  }

  /**
   * Establish an authenticated public-consultation session via the "Ingreso
   * Alternativo" button and return the cookie jar to reuse for data requests.
   */
  async loginPublic(timeoutMs = 35_000): Promise<Jar> {
    const jar: Jar = new Map();
    const login = await req(`${this.base}/login.aspx`, jar, { timeoutMs });
    const body = new URLSearchParams({
      __VIEWSTATE: hiddenField(login.text, "__VIEWSTATE"),
      __VIEWSTATEGENERATOR: hiddenField(login.text, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: hiddenField(login.text, "__EVENTVALIDATION"),
      "imgBtnIngresoAlternativo.x": "10",
      "imgBtnIngresoAlternativo.y": "10",
    }).toString();
    const post = await req(`${this.base}/login.aspx`, jar, { method: "POST", body, timeoutMs });
    // Walking the redirect chain lands on colecciones.aspx and binds the active period to
    // the session; if we still see the login form, the public login failed.
    const ok = /colecciones\.aspx/i.test(post.url) || /lista_expedientes|Colecci/i.test(post.text);
    if (!ok && !jar.has("ASP.NET_SessionId")) {
      throw new Error("Senado SIL public login failed (no session established)");
    }
    return jar;
  }

  /** Fetch + parse the deposited-initiatives list, optionally filtered to a date window. */
  async listDeposits(opts: SenadoSilOptions = {}): Promise<SenadoExpediente[]> {
    const { since, until, coleccion = SENADO_SIL_COLECCION_ACTUAL, timeoutMs } = opts;
    const jar = await this.loginPublic(timeoutMs);
    const res = await req(`${this.base}/lista_expedientes.aspx?coleccion=${coleccion}`, jar, { timeoutMs });
    let rows = parseExpedientesList(res.text, coleccion);
    if (since) rows = rows.filter((r) => !r.filedAt || r.filedAt >= since);
    if (until) rows = rows.filter((r) => !r.filedAt || r.filedAt <= until);
    return rows;
  }
}
