/**
 * Adapter for the Cámara de Diputados "SIL Ciudadano" public JSON API.
 *
 * Discovered + verified by reverse-engineering the Angular SPA at
 * https://www.diputadosrd.gob.do/sil and capturing its live network calls.
 *
 * Base = `https://www.diputadosrd.gob.do/sil/api/iniciativa`. All endpoints GET JSON.
 *
 *   CountIniciativas?periodoId=0                      -> number (verified 5965)
 *   Grupos?periodoId=0                                -> Grupo[]  (subject taxonomy)
 *   Materias?grupo={g}&periodoId=0                    -> Materia[]
 *   iniciativa/{id}                                   -> Iniciativa | null
 *   iniciativas?page={p}&grupo={g}&tipo={bool}&perimidas=false&keyword=&periodoId=0
 *                                                     -> Page<Iniciativa>
 *   proponentes?page={p}&id={id}                      -> Page<Proponente>
 *   historicos?page={p}&id={id}                       -> Page<Historico>
 *   comisiones?page={p}&id={id}                       -> Page<Comision>
 *
 * `tipo` is a BOOLEAN: true = Proyectos de Ley, false = Resoluciones/other. Iterating
 * every grupo × {true,false} enumerates the full corpus.
 */
import type { RawInitiative, RawStatusEvent, SourceAdapter } from "./types.js";
import { extractLeadingISODate } from "./dates.js";
import { fetchJson } from "./http.js";

const BASE = "https://www.diputadosrd.gob.do/sil/api/iniciativa";
const REFERER = "https://www.diputadosrd.gob.do/sil/iniciativa";
/** Cámara document host that serves the actual PDF bytes (port 8095). */
const DOC_HOST = "https://s-sil.camaradediputados.gob.do:8095";

/** Document attached to a SIL initiative. */
export interface SilDocumento {
  id: number; // document id (used in documentUrl)
  documento: string | null; // the initiative code, e.g. "05950-2024-2028-CD"
  descripcion: string | null; // doc type, e.g. "PROYECTO DEPOSITADO"
  extension: string | null; // "pdf"
  cargado: string | null; // upload datetime
  [k: string]: unknown;
}

export interface Grupo {
  id: number;
  descripcion: string;
  icono: string;
}
export interface Materia {
  id: number;
  descripcion: string;
}
export interface Page<T> {
  page: number;
  pageSize: number;
  total: number;
  results: T[];
}

/** Raw SIL list/detail record (subset of fields we consume). */
export interface SilIniciativa {
  id: number;
  numero: string | null;
  tipo: string | null;
  tipoId: number | null;
  descripcion: string | null;
  camaraInicio: string | null;
  grupo: string | null;
  grupoId: number | null;
  materia: string | null;
  estado: string | null;
  condicion: string | null;
  fechaDeposito: string | null;
  fechaUltimoCambioPrincipal: string | null;
  periodoRegistro: string | null;
  origen: string | null;
  [k: string]: unknown;
}

export interface SilProponente {
  principal?: boolean;
  // The legislator's name lives in `nombreCompleto` (and nombres/apellidos) — NOT in
  // a `nombre`/`legislador` field (those are absent in the live API).
  nombreCompleto?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
  legisladorId?: number | null;
  cargo?: string | null;
  representacion?: {
    provincia?: string;
    funcion?: string; // "Diputado" | "Diputada" | "Senador" | …
    partido?: { nombre?: string; siglas?: string };
  };
  [k: string]: unknown;
}

/** Display name of a proponente (full name, falling back to nombres+apellidos). */
export function proponenteName(p: SilProponente | undefined | null): string | null {
  if (!p) return null;
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const full = p.nombreCompleto ? collapse(p.nombreCompleto) : "";
  if (full) return full;
  const joined = collapse([p.nombres, p.apellidos].filter(Boolean).join(" "));
  return joined || null;
}

export interface SilHistorico {
  estado?: string;
  inicio?: string | null;
  fin?: string | null;
  [k: string]: unknown;
}

const headers = { Referer: REFERER };

export class SilDiputadosAdapter implements SourceAdapter {
  readonly source = "sil-diputados";

  constructor(private readonly base: string = BASE) {}

  async count(): Promise<number> {
    const count = await fetchJson<number>(`${this.base}/CountIniciativas?periodoId=0`, { headers });
    if (!Number.isFinite(count) || count < 0)
      throw new Error("SIL returned an invalid initiative count");
    return count;
  }

  async groups(): Promise<Grupo[]> {
    const groups = await fetchJson<Grupo[]>(`${this.base}/Grupos?periodoId=0`, { headers });
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error("SIL returned 0 initiative groups");
    }
    return groups;
  }

  async materias(grupo: number): Promise<Materia[]> {
    return fetchJson<Materia[]>(`${this.base}/Materias?grupo=${grupo}&periodoId=0`, {
      headers,
    });
  }

  /** Build the (verified) paginated list URL. */
  buildListUrl(grupo: number, tipo: boolean, page: number, perimidas = false): string {
    const qs = new URLSearchParams({
      page: String(page),
      grupo: String(grupo),
      tipo: String(tipo),
      perimidas: String(perimidas),
      keyword: "",
      periodoId: "0",
    });
    return `${this.base}/iniciativas?${qs.toString()}`;
  }

  /** One page of a (grupo, tipo) slice. */
  async listPage(
    grupo: number,
    tipo: boolean,
    page: number,
    perimidas = false,
  ): Promise<Page<SilIniciativa>> {
    const url = this.buildListUrl(grupo, tipo, page, perimidas);
    const envelope = await fetchJson<Page<SilIniciativa>>(url, {
      headers,
    });
    assertPageEnvelope(envelope, url);
    return envelope;
  }

  /**
   * Iterate the full corpus: every subject group × {Proyectos de Ley, Resoluciones},
   * paging through each slice. Yields base records (no sponsor/history) — call
   * `enrich()` to add party/province/history when needed.
   */
  async *list(options: { maxPagesPerSlice?: number } = {}): AsyncIterable<RawInitiative> {
    const { maxPagesPerSlice = Infinity } = options;
    const groups = await this.groups();
    const yielded = new Set<number>();
    for (const g of groups) {
      for (const tipo of [true, false]) {
        for (const perimidas of [false, true]) {
          let page = 1;
          while (page <= maxPagesPerSlice) {
            const env = await this.listPage(g.id, tipo, page, perimidas);
            for (const row of env.results) {
              if (yielded.has(row.id)) continue;
              yielded.add(row.id);
              yield mapInitiative(row, this.base, { perimidas });
            }
            if (page * env.pageSize >= env.total || env.results.length === 0) break;
            page++;
          }
        }
      }
    }
  }

  async detail(sourceId: string): Promise<RawInitiative | null> {
    const data = await fetchJson<SilIniciativa | null>(
      `${this.base}/iniciativa/${encodeURIComponent(sourceId)}`,
      { headers },
    );
    return data == null ? null : mapInitiative(data, this.base);
  }

  /** Sponsors for an initiative (party + province live here). */
  async proponentes(id: string | number): Promise<SilProponente[]> {
    return this.allPages<SilProponente>("proponentes", id);
  }

  /** Status-change history for an initiative. */
  async historicos(id: string | number): Promise<SilHistorico[]> {
    return this.allPages<SilHistorico>("historicos", id);
  }

  /**
   * Official documents attached to an initiative (deposited text, committee acuse/
   * informe, approved text…). The `documentos` JSON is reachable over normal HTTP; the
   * actual file is served from the Cámara's document host (`s-sil...:8095`), which may
   * be reachable only from certain networks. `documentUrl()` builds the official link.
   */
  async documentos(id: string | number): Promise<SilDocumento[]> {
    return this.allPages<SilDocumento>("documentos", id);
  }

  /** Official view/download URL for a SIL document id. */
  documentUrl(documentoId: string | number): string {
    return `${DOC_HOST}/ReportesGenerales/VerDocumento?documentoId=${documentoId}`;
  }

  /**
   * Enrich a base initiative with sponsor (name/party/province) and status history.
   * Two extra requests per initiative — the worker should throttle when bulk-loading.
   */
  async enrich(raw: RawInitiative): Promise<RawInitiative> {
    const [props, hist] = await Promise.all([
      this.proponentes(raw.sourceId),
      this.historicos(raw.sourceId),
    ]);
    const principal = props.find((p) => p.principal === true);
    const rep = principal?.representacion;
    const history: RawStatusEvent[] = hist
      .map((h) => ({
        status: h.estado?.trim() ?? "",
        date: extractLeadingISODate(h.inicio),
        note: null,
        raw: h,
      }))
      .filter((event) => event.status.length > 0);
    return {
      ...raw,
      sponsor: proponenteName(principal) ?? raw.sponsor,
      party: rep?.partido?.siglas ?? rep?.partido?.nombre ?? raw.party,
      province: rep?.provincia ?? raw.province,
      history: history.length ? history : raw.history,
      raw: {
        payload: { base: raw.raw, proponentes: props, historicos: hist },
        provenance: {
          sourceUrl: raw.sourceUrl,
          endpoints: ["iniciativa/iniciativas", "iniciativa/proponentes", "iniciativa/historicos"],
        },
      },
    };
  }

  private async allPages<T>(path: string, id: string | number): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= 200; page++) {
      const url = `${this.base}/${path}?page=${page}&id=${encodeURIComponent(String(id))}`;
      const envelope = await fetchJson<Page<T>>(url, { headers });
      assertPageEnvelope(envelope, url);
      rows.push(...envelope.results);
      if (envelope.results.length === 0 || page * envelope.pageSize >= envelope.total) {
        return rows;
      }
    }
    throw new Error(`SIL ${path} exceeded the 200-page safety limit for initiative ${id}`);
  }
}

/** Map a SIL record into our canonical RawInitiative. */
function mapInitiative(
  d: SilIniciativa,
  base = BASE,
  query: { perimidas?: boolean } = {},
): RawInitiative {
  const id = String(d.id);
  const title = d.descripcion?.trim() ?? "";
  if (!title) throw new Error(`SIL initiative ${id} has no explicit description/title`);
  const sourceUrl = `https://www.diputadosrd.gob.do/sil/iniciativa/${id}`;
  return {
    sourceId: id,
    source: "sil-diputados",
    kind: "LEGISLATIVE",
    code: d.numero ?? null,
    title,
    purpose: null,
    type: d.tipo ?? null,
    status: d.estado?.trim() || null,
    chamber: "DIPUTADOS",
    sourceCategory: d.grupo ?? d.materia ?? null,
    sponsor: null,
    party: null,
    province: null,
    committee: null,
    filedAt: extractLeadingISODate(d.fechaDeposito),
    expiresAt: null,
    sourceUrl,
    history: [],
    raw: {
      payload: d,
      provenance: {
        sourceUrl,
        endpoint: `${base}/iniciativas`,
        query: { perimidas: query.perimidas ?? null },
        explicitStatusField: "estado",
        explicitCategoryFields: ["grupo", "materia"],
      },
    },
  };
}

function assertPageEnvelope<T>(value: Page<T>, url: string): void {
  if (
    !value ||
    !Array.isArray(value.results) ||
    !Number.isFinite(Number(value.page)) ||
    !Number.isFinite(Number(value.pageSize)) ||
    Number(value.pageSize) <= 0 ||
    !Number.isFinite(Number(value.total)) ||
    Number(value.total) < 0
  ) {
    throw new Error(`SIL returned an invalid page envelope: ${url}`);
  }
}
