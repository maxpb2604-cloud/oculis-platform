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
 * Public landing for Senate initiatives. The per-expediente Ficha lives in the legacy SIL
 * behind a login, so it is NOT publicly linkable; this portal page is where a person looks
 * up an initiative and its document. We surface this as each row's public source URL.
 */
export const SENADO_PORTAL_INICIATIVAS =
  "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/";

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

export interface SenadoListPageInfo {
  page: number;
  total: number;
  collection: number;
}

/**
 * Read the pagination metadata repeated in every official Ficha link. The legacy site
 * occasionally renders a stale page number while still returning the next 50 records,
 * so `page` is diagnostic only; `total` and the exact unique-record reconciliation are
 * the completeness controls.
 */
export function parseSenadoListPageInfo(html: string): SenadoListPageInfo | null {
  const match = html.match(
    /numeropagina=(\d+)&(?:amp;)?ContExpedientes=(\d+)&(?:amp;)?Coleccion=(\d+)/i,
  );
  if (!match) return null;
  const page = Number(match[1]);
  const total = Number(match[2]);
  const collection = Number(match[3]);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(total) ||
    total < 0 ||
    !Number.isInteger(collection) ||
    collection < 1
  ) {
    return null;
  }
  return { page, total, collection };
}

/** Submit the official WebForms "siguiente" image button with its postback state. */
export function buildSenadoNextPageBody(
  html: string,
  button: "btSumaPaginacion" | "btSumaPaginacion1",
): string {
  const viewState = hiddenField(html, "__VIEWSTATE");
  const eventValidation = hiddenField(html, "__EVENTVALIDATION");
  if (!viewState || !eventValidation) {
    throw new Error("Senado SIL pagination state is missing");
  }
  // Do not resubmit search/sort selects here. The legacy page treats their presence as
  // a fresh filter operation and ignores the image-button pagination event. The closed
  // checkbox must be present so the reported 2,559-row collection does not shrink.
  const fields: Record<string, string> = {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: hiddenField(html, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: eventValidation,
    CBExpCerrados: "on",
  };
  fields[`${button}.x`] = "10";
  fields[`${button}.y`] = "10";
  return new URLSearchParams(fields).toString();
}

/**
 * Reapply the list's explicit full-corpus sort/filter before pagination. The public
 * consultant account can expose stale global paging controls on the first GET; invoking
 * the official Ordenar action resets the grid to page 1 in this session.
 */
export function buildSenadoListResetBody(html: string): string {
  const viewState = hiddenField(html, "__VIEWSTATE");
  const eventValidation = hiddenField(html, "__EVENTVALIDATION");
  if (!viewState || !eventValidation) {
    throw new Error("Senado SIL list-reset state is missing");
  }
  return new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: hiddenField(html, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: eventValidation,
    Orden: "RBOrdenDes",
    cmbEstado: "-1",
    cmbOrden: "fc",
    txtBuscar: "",
    CBExpCerrados: "on",
    "IBOrdenar.x": "10",
    "IBOrdenar.y": "10",
  }).toString();
}

/** dd/mm/yyyy → ISO yyyy-mm-dd (null if unparseable). */
function ddmmyyyyToISO(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? buildISODate(m[1]!, m[2]!, m[3]!) : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x?[0-9a-f]+);/gi, (match, code: string) => {
      const hexadecimal = code[0]?.toLowerCase() === "x";
      const point = Number.parseInt(code.slice(hexadecimal ? 1 : 0), hexadecimal ? 16 : 10);
      try {
        return Number.isInteger(point) ? String.fromCodePoint(point) : match;
      } catch {
        return match;
      }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the `lista_expedientes.aspx` HTML into one row per deposited initiative. */
export function parseExpedientesList(html: string, _coleccion: number): SenadoExpediente[] {
  const out: SenadoExpediente[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1] ?? "");
    if (cells.length < 5) continue;
    const idMatch = row.match(/IdExpediente=(\d+)/i);
    if (!idMatch) continue;
    const code = stripTags(cells[0]!);
    if (!code) continue;
    const idExpediente = idMatch[1]!;
    out.push({
      code,
      idExpediente,
      type: stripTags(cells[1]!) || null,
      title: stripTags(cells[2]!) || null,
      filedAt: ddmmyyyyToISO(stripTags(cells[3]!)),
      status: stripTags(cells[4]!) || null,
      // The legacy Ficha needs a login, so we publish the public portal as the lookup link.
      sourceUrl: SENADO_PORTAL_INICIATIVAS,
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
    if (login.status < 200 || login.status >= 300) {
      throw new Error(`Senado SIL login page returned HTTP ${login.status}`);
    }
    const body = new URLSearchParams({
      __VIEWSTATE: hiddenField(login.text, "__VIEWSTATE"),
      __VIEWSTATEGENERATOR: hiddenField(login.text, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: hiddenField(login.text, "__EVENTVALIDATION"),
      "imgBtnIngresoAlternativo.x": "10",
      "imgBtnIngresoAlternativo.y": "10",
    }).toString();
    const post = await req(`${this.base}/login.aspx`, jar, { method: "POST", body, timeoutMs });
    if (post.status < 200 || post.status >= 300) {
      throw new Error(`Senado SIL public login returned HTTP ${post.status}`);
    }
    // Walking the redirect chain lands on colecciones.aspx and binds the active period to
    // the session; if we still see the login form, the public login failed.
    const ok = /colecciones\.aspx/i.test(post.url) || /lista_expedientes|Colecci/i.test(post.text);
    if (!ok && !jar.has("ASP.NET_SessionId")) {
      throw new Error("Senado SIL public login failed (no session established)");
    }
    return jar;
  }

  /**
   * Fetch + parse the deposited-initiatives list, optionally filtered to a date window.
   * A failed WebForms postback may still mutate server-side session state. Consequently,
   * retries must restart with a fresh public session; replaying stale VIEWSTATE can skip
   * pages and would make a seemingly successful result incomplete.
   */
  async listDeposits(opts: SenadoSilOptions = {}): Promise<SenadoExpediente[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.listDepositsSession(opts);
      } catch (error) {
        lastError = error;
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
    throw new Error(
      `Senado SIL pagination failed after 3 fresh sessions: ${(lastError as Error)?.message ?? "unknown error"}`,
    );
  }

  private async listDepositsSession(opts: SenadoSilOptions): Promise<SenadoExpediente[]> {
    const { since, until, coleccion = SENADO_SIL_COLECCION_ACTUAL, timeoutMs } = opts;
    const jar = await this.loginPublic(timeoutMs);
    const listUrl = `${this.base}/lista_expedientes.aspx?coleccion=${coleccion}`;
    const initial = await req(listUrl, jar, {
      timeoutMs,
    });
    if (initial.status < 200 || initial.status >= 300) {
      throw new Error(`Senado SIL initiative list returned HTTP ${initial.status}`);
    }
    let res = await req(listUrl, jar, {
      method: "POST",
      body: buildSenadoListResetBody(initial.text),
      timeoutMs,
    });
    const seen = new Map<string, SenadoExpediente>();
    let expectedTotal: number | null = null;
    let page = 1;
    for (; page <= 200; page++) {
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Senado SIL initiative list returned HTTP ${res.status} on page ${page}`);
      }
      if (
        !/lista[_-]?expedientes|IdExpediente|Expediente|Fecha\s+(?:de\s+)?Dep[oó]sito/i.test(
          res.text,
        )
      ) {
        throw new Error(
          `Senado SIL returned an unexpected initiative-list payload on page ${page}`,
        );
      }
      const info = parseSenadoListPageInfo(res.text);
      if (!info || info.collection !== coleccion) {
        throw new Error(
          `Senado SIL returned invalid pagination metadata on logical page ${page}: ${JSON.stringify(info)}`,
        );
      }
      if (expectedTotal == null) expectedTotal = info.total;
      else if (info.total !== expectedTotal) {
        throw new Error(
          `Senado SIL total changed during pagination: ${expectedTotal} → ${info.total}`,
        );
      }

      const pageRows = parseExpedientesList(res.text, coleccion);
      if (pageRows.length === 0 && info.total > seen.size) {
        throw new Error(`Senado SIL page ${page} returned 0 rows before the reported total`);
      }
      const seenBefore = seen.size;
      for (const row of pageRows) seen.set(row.idExpediente ?? row.code, row);
      const added = seen.size - seenBefore;
      if (added !== pageRows.length && seen.size < info.total) {
        throw new Error(
          `Senado SIL logical page ${page} overlapped a prior page (${added} of ${pageRows.length} new records)`,
        );
      }

      // The official list is ordered newest-first. For a recent window, stop only
      // after a complete page consists exclusively of dated rows older than `since`.
      if (
        since &&
        pageRows.length > 0 &&
        pageRows.every((row) => row.filedAt && row.filedAt < since)
      ) {
        break;
      }
      if (seen.size >= info.total) break;
      let postbackHtml = res.text;
      let next: Awaited<ReturnType<typeof req>> | null = null;
      for (let postbackAttempt = 1; postbackAttempt <= 8; postbackAttempt++) {
        const candidate = await req(listUrl, jar, {
          method: "POST",
          body: buildSenadoNextPageBody(postbackHtml, "btSumaPaginacion"),
          timeoutMs,
        });
        const candidateInfo = parseSenadoListPageInfo(candidate.text);
        if (
          candidate.status < 200 ||
          candidate.status >= 300 ||
          !candidateInfo ||
          candidateInfo.collection !== coleccion
        ) {
          throw new Error(
            `Senado SIL could not read the batch after logical page ${page}: response ${candidate.status}, metadata ${JSON.stringify(candidateInfo)}`,
          );
        }
        const candidateRows = parseExpedientesList(candidate.text, coleccion);
        const newRows = candidateRows.filter(
          (row) => !seen.has(row.idExpediente ?? row.code),
        ).length;
        if (candidateRows.length > 0 && newRows === candidateRows.length) {
          next = candidate;
          break;
        }
        if (candidateRows.length > 0 && newRows === 0) {
          // The public WebForms session sometimes acknowledges the click but repeats
          // the same grid. Retry from the response's NEW viewstate; replaying the old
          // viewstate can advance hidden server state more than once and skip a batch.
          postbackHtml = candidate.text;
          continue;
        }
        throw new Error(
          `Senado SIL batch after logical page ${page} partially overlapped prior records (${newRows} of ${candidateRows.length} new)`,
        );
      }
      if (!next) {
        throw new Error(`Senado SIL repeated logical page ${page} after 8 state-aware postbacks`);
      }
      res = next;
    }
    if (page > 200) throw new Error("Senado SIL exceeded the 200-page safety limit");
    if (!since && expectedTotal != null && seen.size !== expectedTotal) {
      throw new Error(`Senado SIL collected ${seen.size} of ${expectedTotal} reported initiatives`);
    }

    let rows = [...seen.values()];
    // An undated row cannot be proven to belong to a requested date window.
    if (since) rows = rows.filter((r) => r.filedAt !== null && r.filedAt >= since);
    if (until) rows = rows.filter((r) => r.filedAt !== null && r.filedAt <= until);
    return rows;
  }

  /**
   * Fetch the full Ficha (detail/"Sistema de Gestión de Expedientes Digitales" record)
   * for one expediente, as authenticated HTML. The session must be warmed by visiting the
   * list first (it binds the active-period DB), so we do that before requesting the Ficha.
   * Returns the raw HTML; callers (e.g. a proxy route) can serve it with a <base> tag so a
   * browser without the login session can still view the page.
   */
  async fetchFicha(
    idExpediente: string | number,
    opts: { coleccion?: number; timeoutMs?: number } = {},
  ): Promise<string> {
    const { coleccion = SENADO_SIL_COLECCION_ACTUAL, timeoutMs } = opts;
    const jar = await this.loginPublic(timeoutMs);
    await req(`${this.base}/lista_expedientes.aspx?coleccion=${coleccion}`, jar, { timeoutMs }); // warm session
    const res = await req(
      `${this.base}/Ficha.aspx?IdExpediente=${idExpediente}&numeropagina=1&ContExpedientes=0&Coleccion=${coleccion}`,
      jar,
      { timeoutMs },
    );
    return res.text;
  }

  /** Origin of the legacy SIL, so a proxy can rewrite relative asset/link URLs. */
  static readonly ORIGIN = ORIGIN;
  static readonly BASE = BASE;
}
