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
const MAX_HTML_BYTES = 3_000_000;

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
  let url: URL;
  try {
    url = new URL(loc, `${BASE}/`);
  } catch {
    throw new Error("Senado SIL returned an invalid redirect URL");
  }
  if (
    url.origin !== ORIGIN ||
    !url.pathname.toLowerCase().startsWith("/wfilemaster/") ||
    url.username ||
    url.password
  ) {
    throw new Error(`Senado SIL refused an off-site redirect to ${url.toString()}`);
  }
  return url.toString();
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
  init: { method?: string; body?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ status: number; text: string; url: string }> {
  let current = url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; hop < 8; hop++) {
    const ctrl = new AbortController();
    const abortFromParent = () => ctrl.abort();
    if (init.signal?.aborted) ctrl.abort();
    else init.signal?.addEventListener("abort", abortFromParent, { once: true });
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
      return {
        status: res.status,
        text: await readLimitedHtml(res, MAX_HTML_BYTES),
        url: current,
      };
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abortFromParent);
    }
  }
  return { status: 0, text: "", url: current };
}

async function readLimitedHtml(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Senado SIL HTML exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Senado SIL HTML exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
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

export interface SenadoFichaValidationInput {
  idExpediente: string;
  collection: number;
  status: number;
  url: string;
  html: string;
}

export interface SenadoFichaRawField {
  /** Stable semantic key assigned only after matching the official label and control id. */
  key: string;
  /** Literal label published beside the control. */
  label: string;
  /** Stable ASP.NET control id observed in the official Ficha. */
  controlId: string;
  /** Decoded source text with source line breaks retained. */
  literal: string;
}

export interface SenadoFichaHistoryEvent {
  status: string;
  date: string;
  /** Complete sentence from the source's Historial field. */
  literal: string;
}

/** Facts explicitly labelled by the official Senate Ficha; no lifecycle inference. */
export interface SenadoFichaFacts {
  initiativeCode: string;
  type?: string | null;
  title?: string | null;
  currentStatus: string;
  historyLiteral?: string | null;
  /** Populated only when the complete Historial literal parses without residue. */
  history: SenadoFichaHistoryEvent[];
  historyParseComplete: boolean;
  subjectMatter?: string | null;
  initialChamberLiteral?: string | null;
  /** Exact allow-list normalization of Cámara Inicial; absent for unknown literals. */
  originChamber?: "SENADO" | "DIPUTADOS";
  receivedBySenateAt?: string | null;
  receivedBySenateAtLiteral?: string | null;
  proponents?: string | null;
  commissions?: string | null;
  expiresAt?: string | null;
  expiresAtLiteral?: string | null;
  /** Literal "Conteo de Legislaturas Iniciado" value; not remapped to generic initiation. */
  legislatureCountingStarted?: string | null;
  legislatureCountingStartedAt?: string | null;
  legislature?: string | null;
  quadrennium?: string | null;
  condition?: string | null;
  promulgated?: string | null;
  promulgatedAt?: string | null;
  promulgationNumber?: string | null;
  /** Exact field-level evidence retained for auditing and future remapping. */
  rawFields: SenadoFichaRawField[];
}

export interface SenadoFichaBatchInput {
  idExpediente: string | number;
  /** Optional list-page code used to reject cross-record/session corruption. */
  expectedCode?: string | null;
}

export type SenadoFichaBatchFailure =
  | {
      idExpediente: string;
      classification: "SOURCE_IDENTITY_MISMATCH";
      expectedCode: string;
      observedCode: string;
      error: string;
    }
  | {
      idExpediente: string;
      classification: "OPERATIONAL_FAILURE";
      error: string;
    };

export interface SenadoFichaBatchResult {
  records: Array<{ idExpediente: string; facts: SenadoFichaFacts }>;
  failures: SenadoFichaBatchFailure[];
}

/** Source namespace for the numeric person ids published by the Senate's MasterLex SIL. */
export const SENADO_SIL_PERSON_NAMESPACE = "senado-sil-person" as const;
export const SENADO_SIL_PROPONENT_CATALOG_VERSION = "2026-08-31" as const;
export const SENADO_SIL_PROPONENT_LIST_CODE = "128-82" as const;
export const SENADO_SIL_PROPONENT_PERSON_SELECT = "lsbLista1" as const;
export const SENADO_SIL_PROPONENT_INSTITUTION_SELECT = "lsbLista2" as const;

export interface SenadoSilProponentCatalogProvenance {
  sourceUrl: string;
  collection: number;
  listCode: typeof SENADO_SIL_PROPONENT_LIST_CODE;
  personSelectId: typeof SENADO_SIL_PROPONENT_PERSON_SELECT;
  institutionSelectId: typeof SENADO_SIL_PROPONENT_INSTITUTION_SELECT;
  observedAt: string;
}

export interface SenadoSilProponentCatalogOption {
  namespace: typeof SENADO_SIL_PERSON_NAMESPACE;
  sourceId: string;
  officialName: string;
  provenance: SenadoSilProponentCatalogProvenance & { selectId: string };
}

export interface SenadoSilProponentCatalog {
  version: typeof SENADO_SIL_PROPONENT_CATALOG_VERSION;
  people: SenadoSilProponentCatalogOption[];
  institutions: SenadoSilProponentCatalogOption[];
  provenance: SenadoSilProponentCatalogProvenance;
}

/**
 * Reviewed bridge from the Senate SIL's source-owned person id to the current official
 * Senate profile slug. `profileNameAliases` contains only exact literals explicitly
 * reviewed from the matching province profile. They preserve source-owned name history;
 * they never authorize accent folding, token rewriting or approximate matching.
 */
export interface ReviewedSenadoSilPersonBridge {
  personSourceId: string;
  officialName: string;
  rosterSourceId: string;
  rosterOfficialName: string;
  profileNameAliases?: readonly string[];
}

export const REVIEWED_SENADO_SIL_PERSON_BRIDGE: readonly ReviewedSenadoSilPersonBridge[] = [
  {
    personSourceId: "3412",
    officialName: "Alexis Victoria Yeb",
    rosterSourceId: "maria-trinidad-sanchez",
    rosterOfficialName: "Alexis Victoria Yeb",
  },
  {
    personSourceId: "3493",
    officialName: "Andrés Guillermo Lama Pérez",
    rosterSourceId: "bahoruco",
    rosterOfficialName: "Andrés Guillermo Lama Pérez",
  },
  {
    personSourceId: "3425",
    officialName: "Antonio Manuel Tavéras Guzmán",
    rosterSourceId: "santo-domingo",
    rosterOfficialName: "Antonio Manuel Taveras Guzman",
    profileNameAliases: ["Antonio Taveras Guzmán", "Antonio Manuel Taveras Guzman"],
  },
  {
    personSourceId: "3490",
    officialName: "Aracelis Villanueva Figueroa",
    rosterSourceId: "san-pedro-de-macoris",
    rosterOfficialName: "Aracelis Villanueva Figueroa",
    profileNameAliases: ["Aracelis Villanueva", "Aracelis Villanueva Figueroa"],
  },
  {
    personSourceId: "3486",
    officialName: "Bernardo Alemán Rodríguez",
    rosterSourceId: "montecristi",
    rosterOfficialName: "Bernardo Alemán Rodríguez",
  },
  {
    personSourceId: "3405",
    officialName: "Carlos Manuel Gómez Ureña",
    rosterSourceId: "espaillat",
    rosterOfficialName: "Carlos Manuel Gómez Ureña",
  },
  {
    personSourceId: "3424",
    officialName: "Casimiro Antonio Marte Familia",
    rosterSourceId: "santiago-rodriguez",
    rosterOfficialName: "Casimiro Antonio Marte Familia",
  },
  {
    personSourceId: "3406",
    officialName: "Cristóbal Venerado Antonio Castillo Liriano",
    rosterSourceId: "hato-mayor",
    rosterOfficialName: "Cristobal Venerado Antonio Castillo Liriano",
    profileNameAliases: [
      "Cristóbal Venerado Castillo",
      "Cristobal Venerado Antonio Castillo Liriano",
    ],
  },
  {
    personSourceId: "3485",
    officialName: "Dagoberto Rodríguez Adames",
    rosterSourceId: "independencia",
    rosterOfficialName: "Dagoberto Rodríguez Adames",
  },
  {
    personSourceId: "3487",
    officialName: "Daniel Enrique De Jesús Rivera Reyes",
    rosterSourceId: "santiago",
    rosterOfficialName: "Daniel Enrique De Jesús Rivera Reyes",
  },
  {
    personSourceId: "3491",
    officialName: "Eduard Alexis Espiritusanto Castillo",
    rosterSourceId: "la-romana",
    rosterOfficialName: "Eduard Alexis Espiritusanto Castillo",
  },
  {
    personSourceId: "2847",
    officialName: "Félix Ramón Bautista Rosario",
    rosterSourceId: "san-juan",
    rosterOfficialName: "Félix Ramón Bautista Rosario",
  },
  {
    personSourceId: "3403",
    officialName: "Franklin Martín Romero Morillo",
    rosterSourceId: "duarte",
    rosterOfficialName: "Franklin Martín Romero Morillo",
  },
  {
    personSourceId: "3417",
    officialName: "Ginnette Bournigal de Jiménez",
    rosterSourceId: "puerto-plata",
    rosterOfficialName: "Ginnette Altagracia Bournigal Socias De Jimenez",
    profileNameAliases: [
      "Ginnette Altagracia Bournigal",
      "Ginnette Altagracia Bournigal Socias De Jimenez",
    ],
  },
  {
    personSourceId: "3500",
    officialName: "Gustavo Lara Salazar",
    rosterSourceId: "san-cristobal",
    rosterOfficialName: "Gustavo Lara Salazar",
  },
  {
    personSourceId: "3413",
    officialName: "Héctor Elpidio Acosta Restituyo",
    rosterSourceId: "monsenor-nouel",
    rosterOfficialName: "Hector Elpidio Acosta Restituyo",
    profileNameAliases: ["Hector E. Acosta", "Hector Elpidio Acosta Restituyo"],
  },
  {
    personSourceId: "3494",
    officialName: "Jonhson Encarnación Díaz",
    rosterSourceId: "elias-pina",
    rosterOfficialName: "Jonhson Encarnación Díaz",
  },
  {
    personSourceId: "3489",
    officialName: "Julito Fulcar Encarnación",
    rosterSourceId: "peravia",
    rosterOfficialName: "Julito Fulcar Encarnación",
    profileNameAliases: ["Julito Fulcar", "Julito Fulcar Encarnación"],
  },
  {
    personSourceId: "3398",
    officialName: "Lía Ynocencia Díaz Santana",
    rosterSourceId: "azua",
    rosterOfficialName: "Lía Ynocencia Díaz De Díaz",
    profileNameAliases: ["Lía Ynocencia Díaz De Díaz"],
  },
  {
    personSourceId: "3497",
    officialName: "Manuel María Rodríguez Ortega",
    rosterSourceId: "dajabon",
    rosterOfficialName: "Manuel María Rodríguez Ortega",
  },
  {
    personSourceId: "3499",
    officialName: "María Mercedes Ortiz Diloné",
    rosterSourceId: "hermanas-mirabal",
    rosterOfficialName: "María Mercedes Ortiz Diloné",
  },
  {
    personSourceId: "3498",
    officialName: "Milcíades Aneudy Ortiz Sajiun",
    rosterSourceId: "san-jose-de-ocoa",
    rosterOfficialName: "Milciades Aneudy Ortiz Sajiun",
    profileNameAliases: ["Aneudy Ortiz Sajiun", "Milciades Aneudy Ortiz Sajiun"],
  },
  {
    personSourceId: "3496",
    officialName: "Moisés Ayala Pérez",
    rosterSourceId: "barahona",
    rosterOfficialName: "Moisés Ayala Pérez",
  },
  {
    personSourceId: "3484",
    officialName: "Odalis Rafael Rodríguez Rodríguez",
    rosterSourceId: "valverde",
    rosterOfficialName: "Odalís Rafael Rodríguez Rodríguez",
    profileNameAliases: ["Odalís Rafael Rodríguez Rodríguez"],
  },
  {
    personSourceId: "3501",
    officialName: "Omar Leonel Fernández Domínguez",
    rosterSourceId: "distrito-nacional",
    rosterOfficialName: "Omar Leonel Fernández Domínguez",
  },
  {
    personSourceId: "3488",
    officialName: "Pedro Antonio Tineo Nuñez",
    rosterSourceId: "monte-plata",
    rosterOfficialName: "Pedro Antonio Tineo Núñez",
    profileNameAliases: ["Pedro Antonio Tineo Núñez"],
  },
  {
    personSourceId: "3418",
    officialName: "Pedro Manuel Catrain Bonilla",
    rosterSourceId: "samana",
    rosterOfficialName: "Pedro Manuel Catrain Bonilla",
    profileNameAliases: ["Pedro Catrain Bonilla", "Pedro Manuel Catrain Bonilla"],
  },
  {
    personSourceId: "3492",
    officialName: "Rafael Barón Duluc Rijo",
    rosterSourceId: "la-altagracia",
    rosterOfficialName: "Rafael Barón Duluc Rijo",
  },
  {
    personSourceId: "3411",
    officialName: "Ramón Rogelio Genao Durán",
    rosterSourceId: "la-vega",
    rosterOfficialName: "Ramón Rogelio Genao Durán",
  },
  {
    personSourceId: "3422",
    officialName: "Ricardo de los Santos Polanco",
    rosterSourceId: "sanchez-ramirez",
    rosterOfficialName: "Ricardo De Los Santos Polanco",
  },
  {
    personSourceId: "3314",
    officialName: "Santiago José Zorrilla",
    rosterSourceId: "el-seibo",
    rosterOfficialName: "Santiago José Zorrilla",
  },
  {
    personSourceId: "3495",
    officialName: "Secundino Velázquez Pimentel",
    rosterSourceId: "pedernales",
    rosterOfficialName: "Secundino Velázquez Pimentel",
  },
] as const;

/** Identity-safe normalization: NFC, collapsed whitespace and case only. */
export function senateSilExactNameKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-DO");
}

function selectOptions(html: string, selectId: string): Array<{ sourceId: string; name: string }> {
  const escapedId = selectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const select = new RegExp(
    `<select\\b(?=[^>]*\\bid\\s*=\\s*(["'])${escapedId}\\1)[^>]*>([\\s\\S]*?)<\\/select\\s*>`,
    "i",
  ).exec(html)?.[2];
  if (select === undefined) throw new Error(`Senado SIL proponent catalog is missing #${selectId}`);
  const out: Array<{ sourceId: string; name: string }> = [];
  for (const option of select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)) {
    const sourceId = htmlAttribute(option[1] ?? "", "value")?.trim() ?? "";
    const name = stripTags(option[2] ?? "");
    if (!sourceId && !name) continue;
    if (!/^\d{1,10}$/.test(sourceId) || !name) {
      throw new Error(`Senado SIL proponent catalog has an invalid option in #${selectId}`);
    }
    out.push({ sourceId, name });
  }
  return out;
}

function assertUniqueCatalogOptions(
  options: readonly { sourceId: string; name: string }[],
  label: string,
): void {
  if (new Set(options.map((row) => row.sourceId)).size !== options.length) {
    throw new Error(`Senado SIL ${label} catalog contains duplicate ids`);
  }
  if (new Set(options.map((row) => senateSilExactNameKey(row.name))).size !== options.length) {
    throw new Error(`Senado SIL ${label} catalog contains duplicate names`);
  }
}

export function validateSenadoSilProponentCatalog(
  catalog: SenadoSilProponentCatalog,
): SenadoSilProponentCatalog {
  if (catalog.people.length !== 32) {
    throw new Error(
      `Senado SIL person catalog drift: expected 32, observed ${catalog.people.length}`,
    );
  }
  if (catalog.institutions.length !== 12) {
    throw new Error(
      `Senado SIL institution catalog drift: expected 12, observed ${catalog.institutions.length}`,
    );
  }
  assertUniqueCatalogOptions(
    catalog.people.map((row) => ({ sourceId: row.sourceId, name: row.officialName })),
    "person",
  );
  assertUniqueCatalogOptions(
    catalog.institutions.map((row) => ({ sourceId: row.sourceId, name: row.officialName })),
    "institution",
  );

  if (REVIEWED_SENADO_SIL_PERSON_BRIDGE.length !== 32) {
    throw new Error("Reviewed Senate person bridge must contain exactly 32 rows");
  }
  const bridgeIds = new Set(REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => row.personSourceId));
  const bridgeNames = new Set(
    REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => senateSilExactNameKey(row.officialName)),
  );
  const bridgeSlugs = new Set(REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => row.rosterSourceId));
  const bridgeRosterNames = new Set(
    REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => senateSilExactNameKey(row.rosterOfficialName)),
  );
  if (
    bridgeIds.size !== 32 ||
    bridgeNames.size !== 32 ||
    bridgeSlugs.size !== 32 ||
    bridgeRosterNames.size !== 32
  ) {
    throw new Error("Reviewed Senate person bridge is not a 32-id/name/slug bijection");
  }
  for (const reviewed of REVIEWED_SENADO_SIL_PERSON_BRIDGE) {
    const aliases = reviewed.profileNameAliases ?? [];
    const aliasKeys = aliases.map((alias) => senateSilExactNameKey(alias));
    const aliasKeySet = new Set(aliasKeys);
    const namesDiffer =
      senateSilExactNameKey(reviewed.officialName) !==
      senateSilExactNameKey(reviewed.rosterOfficialName);
    if (
      (namesDiffer && aliases.length === 0) ||
      aliases.some((alias) => !alias.trim()) ||
      aliasKeySet.size !== aliasKeys.length ||
      (aliases.length > 0 && !aliasKeySet.has(senateSilExactNameKey(reviewed.rosterOfficialName)))
    ) {
      throw new Error(
        `Reviewed Senate profile aliases are missing or unexpected for ${reviewed.personSourceId}`,
      );
    }
  }
  for (const person of catalog.people) {
    const reviewed = REVIEWED_SENADO_SIL_PERSON_BRIDGE.find(
      (row) => row.personSourceId === person.sourceId,
    );
    if (
      !reviewed ||
      senateSilExactNameKey(reviewed.officialName) !== senateSilExactNameKey(person.officialName)
    ) {
      throw new Error(
        `Senado SIL person catalog drift for ${person.sourceId}: ${person.officialName}`,
      );
    }
  }
  return catalog;
}

export function parseSenadoSilProponentCatalog(
  html: string,
  opts: { sourceUrl?: string; collection?: number; observedAt?: string } = {},
): SenadoSilProponentCatalog {
  const collection = opts.collection ?? SENADO_SIL_COLECCION_ACTUAL;
  const sourceUrl =
    opts.sourceUrl ??
    `${BASE}/AgregarListaMultiple.aspx?nombreCampo=campos_nota_644&codigoLista=${SENADO_SIL_PROPONENT_LIST_CODE}`;
  const provenance: SenadoSilProponentCatalogProvenance = {
    sourceUrl,
    collection,
    listCode: SENADO_SIL_PROPONENT_LIST_CODE,
    personSelectId: SENADO_SIL_PROPONENT_PERSON_SELECT,
    institutionSelectId: SENADO_SIL_PROPONENT_INSTITUTION_SELECT,
    observedAt: opts.observedAt ?? new Date().toISOString(),
  };
  const mapOption = (
    option: { sourceId: string; name: string },
    selectId: string,
  ): SenadoSilProponentCatalogOption => ({
    namespace: SENADO_SIL_PERSON_NAMESPACE,
    sourceId: option.sourceId,
    officialName: option.name.normalize("NFC").replace(/\s+/g, " ").trim(),
    provenance: { ...provenance, selectId },
  });
  return validateSenadoSilProponentCatalog({
    version: SENADO_SIL_PROPONENT_CATALOG_VERSION,
    people: selectOptions(html, SENADO_SIL_PROPONENT_PERSON_SELECT).map((row) =>
      mapOption(row, SENADO_SIL_PROPONENT_PERSON_SELECT),
    ),
    institutions: selectOptions(html, SENADO_SIL_PROPONENT_INSTITUTION_SELECT).map((row) =>
      mapOption(row, SENADO_SIL_PROPONENT_INSTITUTION_SELECT),
    ),
    provenance,
  });
}

export interface SenadoSilResolvedProponent {
  publishedName: string;
  person: SenadoSilProponentCatalogOption | null;
  segment: string;
  resolution: "exact" | "exact-y-pair" | "unresolved";
}

/**
 * Resolve a Ficha's literal proponent field without fuzzy matching. Semicolons are the
 * only unconditional separator. `y` is accepted only when one and only one split maps
 * both sides to complete catalog names. Commas and substrings never participate.
 */
export function resolveSenadoSilFichaProponents(
  literal: string | null,
  people: readonly SenadoSilProponentCatalogOption[],
): SenadoSilResolvedProponent[] {
  if (literal === null || !literal.trim()) return [];
  const byName = new Map(
    people.map((person) => [senateSilExactNameKey(person.officialName), person]),
  );
  const out: SenadoSilResolvedProponent[] = [];
  for (const rawSegment of literal.normalize("NFC").split(";")) {
    const segment = rawSegment.replace(/\s+/g, " ").trim();
    if (!segment) continue;
    const direct = byName.get(senateSilExactNameKey(segment));
    if (direct) {
      out.push({ publishedName: segment, person: direct, segment, resolution: "exact" });
      continue;
    }
    const candidates: Array<[SenadoSilProponentCatalogOption, SenadoSilProponentCatalogOption]> =
      [];
    for (const separator of segment.matchAll(/\s+y\s+/gi)) {
      const index = separator.index;
      if (index === undefined) continue;
      const left = segment.slice(0, index).trim();
      const right = segment.slice(index + separator[0].length).trim();
      const leftPerson = byName.get(senateSilExactNameKey(left));
      const rightPerson = byName.get(senateSilExactNameKey(right));
      if (leftPerson && rightPerson) candidates.push([leftPerson, rightPerson]);
    }
    const uniquePairs = new Map(
      candidates.map((pair) => [`${pair[0].sourceId}:${pair[1].sourceId}`, pair] as const),
    );
    if (uniquePairs.size === 1) {
      const [left, right] = [...uniquePairs.values()][0]!;
      out.push(
        { publishedName: left.officialName, person: left, segment, resolution: "exact-y-pair" },
        { publishedName: right.officialName, person: right, segment, resolution: "exact-y-pair" },
      );
    } else {
      out.push({ publishedName: segment, person: null, segment, resolution: "unresolved" });
    }
  }
  return out;
}

function htmlAttributeUrl(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&#38;/g, "&");
}

/**
 * Reject ASP.NET's common "HTTP 200 but wrong page" failures before a ficha can enter
 * the web cache. A valid record must prove the exact IdExpediente in both the final URL
 * and its own form action, and must contain the expediente table plus a non-empty
 * official initiative number.
 */
export function validateSenadoFichaResponse(input: SenadoFichaValidationInput): {
  initiativeCode: string;
} {
  const { idExpediente, collection, status, url: responseUrl, html } = input;
  if (!/^\d{1,10}$/.test(idExpediente)) {
    throw new Error("Senado SIL ficha id is invalid");
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Senado SIL ficha returned HTTP ${status}`);
  }
  let finalUrl: URL;
  try {
    finalUrl = new URL(responseUrl);
  } catch {
    throw new Error("Senado SIL ficha returned an invalid final URL");
  }
  if (
    finalUrl.origin !== ORIGIN ||
    finalUrl.pathname.toLowerCase() !== "/wfilemaster/ficha.aspx" ||
    finalUrl.searchParams.get("IdExpediente") !== idExpediente ||
    finalUrl.searchParams.get("Coleccion") !== String(collection) ||
    finalUrl.username ||
    finalUrl.password
  ) {
    throw new Error("Senado SIL ficha ended on an unexpected URL");
  }
  if (
    /<form\b[^>]*action=["'][^"']*login\.aspx|imgBtnIngresoAlternativo|Ingreso\s+Alternativo/i.test(
      html,
    )
  ) {
    throw new Error("Senado SIL ficha returned the login page");
  }
  if (
    /Servicio\s+temporalmente\s+no\s+disponible|No\s+fue\s+posible\s+completar\s+la\s+solicitud/i.test(
      html,
    )
  ) {
    throw new Error("Senado SIL ficha returned an unavailable/error page");
  }

  const actionMatch = /<form\b[^>]*action=["']([^"']*Ficha\.aspx[^"']*)["']/i.exec(html);
  if (!actionMatch) throw new Error("Senado SIL ficha is missing its record form");
  let action: URL;
  try {
    action = new URL(htmlAttributeUrl(actionMatch[1]!), `${BASE}/`);
  } catch {
    throw new Error("Senado SIL ficha contains an invalid record form URL");
  }
  if (
    action.origin !== ORIGIN ||
    action.pathname.toLowerCase() !== "/wfilemaster/ficha.aspx" ||
    action.searchParams.get("IdExpediente") !== idExpediente ||
    action.searchParams.get("Coleccion") !== String(collection)
  ) {
    throw new Error("Senado SIL ficha does not match the requested expediente");
  }
  if (!/id=["']tblEspedientes["']/i.test(html) || !/N[uú]mero\s+de\s+Iniciativa/i.test(html)) {
    throw new Error("Senado SIL ficha is missing expediente fields");
  }
  const code = stripTags(
    /<textarea\b[^>]*id=["']campos_text_628["'][^>]*>([\s\S]*?)<\/textarea>/i.exec(html)?.[1] ?? "",
  );
  if (!code) throw new Error("Senado SIL ficha has no official initiative number");
  return { initiativeCode: code };
}

/**
 * Read the official list pagination metadata. The legacy site occasionally renders a
 * stale page number while still returning the next 50 records, so `page` is diagnostic
 * only. It also currently writes `ContExpedientes=0` into every first-page Ficha link;
 * the visible `txttotalexp` counter remains the source-owned corpus cardinality. A zero
 * link total without that visible counter is therefore ambiguous and fails closed.
 */
export function parseSenadoListPageInfo(html: string): SenadoListPageInfo | null {
  const match = html.match(
    /numeropagina=(\d+)&(?:amp;)?ContExpedientes=(\d+)&(?:amp;)?Coleccion=(\d+)/i,
  );
  if (!match) return null;
  const page = Number(match[1]);
  const linkTotal = Number(match[2]);
  const collection = Number(match[3]);
  const displayedTotalMatch =
    /<span\b(?=[^>]*\bid=["']txttotalexp["'])[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  let displayedTotal: number | undefined;
  if (displayedTotalMatch) {
    const literal = stripTags(displayedTotalMatch[1] ?? "");
    if (!/^\d{1,9}$/.test(literal)) return null;
    displayedTotal = Number(literal);
  } else {
    // The legacy WebForms control is emitted as an <input> on some authenticated
    // responses. Its value remains the source-owned visible corpus counter.
    const displayedTotalInput = /<input\b(?=[^>]*\bid=["']txttotalexp["'])[^>]*>/i.exec(html)?.[0];
    if (displayedTotalInput) {
      const literal = htmlAttribute(displayedTotalInput, "value")?.trim() ?? "";
      if (!/^\d{1,9}$/.test(literal)) return null;
      displayedTotal = Number(literal);
    }
  }
  // Ficha links can retain the previous total while the visible source-owned counter
  // already includes a just-published initiative. Prefer the visible counter and then
  // require it to remain stable across every page and to reconcile with unique rows.
  const total = displayedTotal ?? (linkTotal > 0 ? linkTotal : Number.NaN);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(linkTotal) ||
    linkTotal < 0 ||
    !Number.isInteger(total) ||
    total < 1 ||
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

function decodedLiteral(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
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
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function htmlAttribute(element: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(element);
  if (quoted) return decodedLiteral(quoted[2] ?? "");
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(element);
  return bare ? decodedLiteral(bare[1] ?? "") : null;
}

function controlElement(row: string, id: string): string | null {
  const openings = /<(textarea|select|span|input)\b[^>]*>/gi;
  for (const opening of row.matchAll(openings)) {
    const tag = opening[1]?.toLowerCase();
    const start = opening.index;
    const open = opening[0];
    if (!tag || start == null || htmlAttribute(open, "id") !== id) continue;
    if (tag === "input") return open;
    const closing = new RegExp(`</${tag}\\s*>`, "gi");
    closing.lastIndex = start + open.length;
    const end = closing.exec(row);
    return end ? row.slice(start, end.index + end[0].length) : null;
  }
  return null;
}

function controlLiteral(control: string): string {
  const tag = /^<(textarea|select|span|input)\b/i.exec(control)?.[1]?.toLowerCase();
  if (tag === "input") return htmlAttribute(control, "value") ?? "";
  if (tag === "select") {
    const options = control.match(/<option\b[^>]*>[\s\S]*?<\/option\s*>/gi) ?? [];
    const selected = options.find((option) => /\bselected(?:\s*=|\s|>)/i.test(option));
    return selected
      ? decodedLiteral(selected.replace(/^<option\b[^>]*>/i, "").replace(/<\/option\s*>$/i, ""))
      : "";
  }
  return decodedLiteral(control.replace(/^<[^>]+>/, "").replace(/<\/[^>]+>\s*$/, ""));
}

function normalizedLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fichaField(
  html: string,
  key: string,
  expectedLabel: string,
  controlId: string,
): SenadoFichaRawField | undefined {
  const expected = normalizedLabel(expectedLabel);
  for (const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi) ?? []) {
    const control = controlElement(row, controlId);
    if (!control) continue;
    const firstCell = /<td\b[^>]*>([\s\S]*?)<\/td\s*>/i.exec(row)?.[1] ?? "";
    const label = stripTags(firstCell);
    if (!normalizedLabel(label).includes(expected)) return undefined;
    return { key, label, controlId, literal: controlLiteral(control) };
  }
  return undefined;
}

function nullableLiteral(field: SenadoFichaRawField | undefined): string | null | undefined {
  if (!field) return undefined;
  const value = field.literal.replace(/\s+/g, " ").trim();
  return value || null;
}

function nullableSelectLiteral(field: SenadoFichaRawField | undefined): string | null | undefined {
  const value = nullableLiteral(field);
  return value === "----------------" ? null : value;
}

function sourceDate(field: SenadoFichaRawField | undefined): string | null | undefined {
  const value = nullableLiteral(field);
  if (value === undefined) return undefined;
  if (value === null || /^N\/?A$/i.test(value)) return null;
  // An observed but malformed source value remains available in rawFields; it must not
  // be converted into an explicit null that could erase a previously valid date.
  return ddmmyyyyToISO(value) ?? undefined;
}

/**
 * Parse the source's single Historial text box only when every character belongs to a
 * `literal status + el + dd/mm/yyyy` sentence. Any unexpected prose makes the whole
 * parse incomplete, preventing invented or partial timelines while retaining the raw
 * Historial literal in {@link SenadoFichaFacts.historyLiteral}.
 */
export function parseSenadoFichaHistory(literal: string): {
  events: SenadoFichaHistoryEvent[];
  complete: boolean;
} {
  const source = literal.replace(/\r\n?/g, "\n").trim();
  if (!source) return { events: [], complete: true };
  const events: SenadoFichaHistoryEvent[] = [];
  const pattern = /([^.]+?)\s+el\s+(\d{1,2}\/\d{1,2}\/\d{4})\.\s*/gy;
  let cursor = 0;
  for (;;) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) break;
    const date = ddmmyyyyToISO(match[2] ?? "");
    const status = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (!date || !status) return { events: [], complete: false };
    events.push({
      status,
      date,
      literal: (match[0] ?? "").trim(),
    });
    cursor = pattern.lastIndex;
  }
  return cursor === source.length ? { events, complete: true } : { events: [], complete: false };
}

/**
 * Extract factual values from an authenticated official Ficha. Every mapping requires
 * both the observed ASP.NET control id and its visible Spanish label; a control-id reuse
 * or layout drift therefore results in an absent field, not a silently mislabelled fact.
 */
export function parseSenadoFicha(html: string): SenadoFichaFacts {
  const specs = [
    ["initiativeCode", "Número de Iniciativa", "campos_text_628"],
    ["type", "Tipo de Iniciativa", "campos_list_629"],
    ["title", "Descripción del Proyecto", "campos_nota_630"],
    ["history", "Historial", "campos_nota_631"],
    ["subjectMatter", "Materia", "campos_list_633"],
    ["initialChamber", "Cámara Inicial", "campos_list_634"],
    ["receivedBySenateAt", "Fecha de Recibido por El Senado", "campos_fech_635"],
    ["legislatureCountingStarted", "Conteo de Legislaturas Iniciado", "campos_bina_637"],
    ["legislatureCountingStartedAt", "Conteo de Legislaturas Iniciado", "Fecha_campos_bina_637"],
    ["legislature", "Legislatura de Inicio", "campos_list_627"],
    ["quadrennium", "Cuatrienio", "campos_list_639"],
    ["commissions", "Comisiones", "campos_nota_643"],
    ["proponents", "Proponentes", "campos_nota_644"],
    ["promulgated", "Promulgada", "campos_bina_665"],
    ["promulgatedAt", "Promulgada", "Fecha_campos_bina_665"],
    ["promulgationNumber", "Número de Promulgación", "campos_text_666"],
    ["condition", "Condición Actual", "campos_list_669"],
    ["currentStatus", "Estado actual", "lbEstadoActual"],
    ["expiresAt", "Vence el día", "lbVence"],
  ] as const;
  const fields = new Map<string, SenadoFichaRawField>();
  for (const [key, label, controlId] of specs) {
    const field = fichaField(html, key, label, controlId);
    if (field) fields.set(key, field);
  }
  const get = (key: string) => fields.get(key);
  const initiativeCode = nullableLiteral(get("initiativeCode"));
  if (!initiativeCode) throw new Error("Senado SIL ficha has no labelled initiative number");
  const currentStatus = nullableLiteral(get("currentStatus"));
  if (!currentStatus) throw new Error("Senado SIL ficha has no labelled current status");

  const historyLiteral = nullableLiteral(get("history"));
  const parsedHistory =
    historyLiteral === undefined
      ? { events: [], complete: false }
      : parseSenadoFichaHistory(historyLiteral ?? "");
  const initialChamberLiteral = nullableSelectLiteral(get("initialChamber"));
  const originChamber =
    initialChamberLiteral === "Senado de la República"
      ? "SENADO"
      : initialChamberLiteral === "Cámara de Diputados"
        ? "DIPUTADOS"
        : undefined;

  return {
    initiativeCode,
    type: nullableSelectLiteral(get("type")),
    title: nullableLiteral(get("title")),
    currentStatus,
    historyLiteral,
    history: parsedHistory.events,
    historyParseComplete: parsedHistory.complete,
    subjectMatter: nullableSelectLiteral(get("subjectMatter")),
    initialChamberLiteral,
    ...(originChamber ? { originChamber } : {}),
    receivedBySenateAt: sourceDate(get("receivedBySenateAt")),
    receivedBySenateAtLiteral: nullableLiteral(get("receivedBySenateAt")),
    proponents: nullableLiteral(get("proponents")),
    commissions: nullableLiteral(get("commissions")),
    expiresAt: sourceDate(get("expiresAt")),
    expiresAtLiteral: nullableLiteral(get("expiresAt")),
    legislatureCountingStarted: nullableSelectLiteral(get("legislatureCountingStarted")),
    legislatureCountingStartedAt: sourceDate(get("legislatureCountingStartedAt")),
    legislature: nullableSelectLiteral(get("legislature")),
    quadrennium: nullableSelectLiteral(get("quadrennium")),
    condition: nullableSelectLiteral(get("condition")),
    promulgated: nullableSelectLiteral(get("promulgated")),
    promulgatedAt: sourceDate(get("promulgatedAt")),
    promulgationNumber: nullableLiteral(get("promulgationNumber")),
    rawFields: [...fields.values()],
  };
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
  async loginPublic(timeoutMs = 35_000, signal?: AbortSignal): Promise<Jar> {
    const jar: Jar = new Map();
    const login = await req(`${this.base}/login.aspx`, jar, { timeoutMs, signal });
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
    const post = await req(`${this.base}/login.aspx`, jar, {
      method: "POST",
      body,
      timeoutMs,
      signal,
    });
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

  private async openFichaSession(
    coleccion: number,
    timeoutMs: number | undefined,
    signal: AbortSignal,
  ): Promise<Jar> {
    const jar = await this.loginPublic(timeoutMs, signal);
    const warm = await req(`${this.base}/lista_expedientes.aspx?coleccion=${coleccion}`, jar, {
      timeoutMs,
      signal,
    });
    if (warm.status < 200 || warm.status >= 300) {
      throw new Error(`Senado SIL initiative list returned HTTP ${warm.status} before ficha`);
    }
    if (/login\.aspx|imgBtnIngresoAlternativo|Ingreso\s+Alternativo/i.test(warm.text)) {
      throw new Error("Senado SIL returned the login page while warming the ficha session");
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
   * Read the official MasterLex selector that owns the current Senate person ids.
   * The catalog uses the same authenticated public-consultation session and collection
   * warm-up as a Ficha. Cardinality and the reviewed 32-person identity bridge are
   * validated before any result reaches a caller.
   */
  async fetchProponentCatalog(
    opts: {
      coleccion?: number;
      timeoutMs?: number;
      totalTimeoutMs?: number;
    } = {},
  ): Promise<SenadoSilProponentCatalog> {
    const { coleccion = SENADO_SIL_COLECCION_ACTUAL, timeoutMs, totalTimeoutMs = 60_000 } = opts;
    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), totalTimeoutMs);
    const sourceUrl = `${this.base}/AgregarListaMultiple.aspx?nombreCampo=campos_nota_644&codigoLista=${SENADO_SIL_PROPONENT_LIST_CODE}`;
    try {
      const jar = await this.openFichaSession(coleccion, timeoutMs, totalController.signal);
      const response = await req(sourceUrl, jar, {
        timeoutMs,
        signal: totalController.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Senado SIL proponent catalog returned HTTP ${response.status}`);
      }
      if (
        /<form\b[^>]*action=["'][^"']*login\.aspx|imgBtnIngresoAlternativo|Ingreso\s+Alternativo/i.test(
          response.text,
        )
      ) {
        throw new Error("Senado SIL proponent catalog returned the login page");
      }
      return parseSenadoSilProponentCatalog(response.text, {
        sourceUrl: response.url,
        collection: coleccion,
      });
    } catch (error) {
      if (totalController.signal.aborted) {
        throw new Error(`Senado SIL proponent catalog exceeded total timeout ${totalTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(totalTimer);
    }
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
    opts: { coleccion?: number; timeoutMs?: number; totalTimeoutMs?: number } = {},
  ): Promise<string> {
    const id = String(idExpediente);
    if (!/^\d{1,10}$/.test(id)) throw new Error("Senado SIL ficha id is invalid");
    const { coleccion = SENADO_SIL_COLECCION_ACTUAL, timeoutMs, totalTimeoutMs = 60_000 } = opts;
    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), totalTimeoutMs);
    try {
      const jar = await this.openFichaSession(coleccion, timeoutMs, totalController.signal);
      const res = await req(
        `${this.base}/Ficha.aspx?IdExpediente=${id}&numeropagina=1&ContExpedientes=0&Coleccion=${coleccion}`,
        jar,
        { timeoutMs, signal: totalController.signal },
      );
      validateSenadoFichaResponse({
        idExpediente: id,
        collection: coleccion,
        status: res.status,
        url: res.url,
        html: res.text,
      });
      return res.text;
    } catch (error) {
      if (totalController.signal.aborted) {
        throw new Error(`Senado SIL ficha exceeded total timeout ${totalTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(totalTimer);
    }
  }

  /**
   * Fetch factual fields for a bounded group of fichas while reusing one public session.
   * The hard batch ceiling prevents an accidental 2,655-record run from living under one
   * cookie jar or timeout. A failed record is retried once with a freshly warmed session;
   * failures remain itemized so a long explicit enrichment can checkpoint other records.
   */
  async fetchFichaFactsBatch(
    inputs: SenadoFichaBatchInput[],
    opts: {
      coleccion?: number;
      timeoutMs?: number;
      totalTimeoutMs?: number;
      delayMs?: number;
    } = {},
  ): Promise<SenadoFichaBatchResult> {
    if (inputs.length === 0) return { records: [], failures: [] };
    if (inputs.length > 100) {
      throw new Error("Senado SIL ficha batch exceeds the 100-record safety limit");
    }
    const normalized = inputs.map((input) => ({
      idExpediente: String(input.idExpediente),
      expectedCode: input.expectedCode?.trim() || null,
    }));
    if (normalized.some((input) => !/^\d{1,10}$/.test(input.idExpediente))) {
      throw new Error("Senado SIL ficha batch contains an invalid id");
    }
    if (new Set(normalized.map((input) => input.idExpediente)).size !== normalized.length) {
      throw new Error("Senado SIL ficha batch contains duplicate ids");
    }

    const {
      coleccion = SENADO_SIL_COLECCION_ACTUAL,
      timeoutMs,
      totalTimeoutMs = 10 * 60_000,
      delayMs = 100,
    } = opts;
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10_000) {
      throw new Error("Senado SIL ficha batch delay must be between 0 and 10000ms");
    }
    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), totalTimeoutMs);
    const records: SenadoFichaBatchResult["records"] = [];
    const failures: SenadoFichaBatchFailure[] = [];
    try {
      let jar = await this.openFichaSession(coleccion, timeoutMs, totalController.signal);
      for (const [index, input] of normalized.entries()) {
        let lastError: unknown;
        let identityMismatch: { expectedCode: string; observedCode: string } | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const res = await req(
              `${this.base}/Ficha.aspx?IdExpediente=${input.idExpediente}&numeropagina=1&ContExpedientes=0&Coleccion=${coleccion}`,
              jar,
              { timeoutMs, signal: totalController.signal },
            );
            const validation = validateSenadoFichaResponse({
              idExpediente: input.idExpediente,
              collection: coleccion,
              status: res.status,
              url: res.url,
              html: res.text,
            });
            const facts = parseSenadoFicha(res.text);
            if (validation.initiativeCode !== facts.initiativeCode) {
              throw new Error("Senado SIL ficha validation/parser code mismatch");
            }
            if (input.expectedCode && facts.initiativeCode !== input.expectedCode) {
              identityMismatch = {
                expectedCode: input.expectedCode,
                observedCode: facts.initiativeCode,
              };
              lastError = new Error(
                `Senado SIL ficha code ${facts.initiativeCode} does not match list code ${input.expectedCode}`,
              );
              break;
            }
            records.push({ idExpediente: input.idExpediente, facts });
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            if (totalController.signal.aborted) throw error;
            if (attempt < 2) {
              try {
                jar = await this.openFichaSession(coleccion, timeoutMs, totalController.signal);
              } catch (sessionError) {
                lastError = sessionError;
                break;
              }
            }
          }
        }
        if (lastError) {
          failures.push(
            identityMismatch
              ? {
                  idExpediente: input.idExpediente,
                  classification: "SOURCE_IDENTITY_MISMATCH",
                  expectedCode: identityMismatch.expectedCode,
                  observedCode: identityMismatch.observedCode,
                  error: (lastError as Error).message,
                }
              : {
                  idExpediente: input.idExpediente,
                  classification: "OPERATIONAL_FAILURE",
                  error: (lastError as Error)?.message ?? String(lastError),
                },
          );
        }
        if (delayMs && index < normalized.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      return { records, failures };
    } catch (error) {
      if (totalController.signal.aborted) {
        throw new Error(`Senado SIL ficha batch exceeded total timeout ${totalTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(totalTimer);
    }
  }

  /** Origin of the legacy SIL, so a proxy can rewrite relative asset/link URLs. */
  static readonly ORIGIN = ORIGIN;
  static readonly BASE = BASE;
}
