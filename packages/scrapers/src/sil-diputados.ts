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
  nombre?: string;
  legislador?: string;
  representacion?: {
    provincia?: string;
    funcion?: string;
    partido?: { nombre?: string; siglas?: string };
  };
  [k: string]: unknown;
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
    return fetchJson<number>(`${this.base}/CountIniciativas?periodoId=0`, { headers });
  }

  async groups(): Promise<Grupo[]> {
    return fetchJson<Grupo[]>(`${this.base}/Grupos?periodoId=0`, { headers });
  }

  async materias(grupo: number): Promise<Materia[]> {
    return fetchJson<Materia[]>(`${this.base}/Materias?grupo=${grupo}&periodoId=0`, {
      headers,
    });
  }

  /** Build the (verified) paginated list URL. */
  buildListUrl(grupo: number, tipo: boolean, page: number): string {
    const qs = new URLSearchParams({
      page: String(page),
      grupo: String(grupo),
      tipo: String(tipo),
      perimidas: "false",
      keyword: "",
      periodoId: "0",
    });
    return `${this.base}/iniciativas?${qs.toString()}`;
  }

  /** One page of a (grupo, tipo) slice. */
  listPage(grupo: number, tipo: boolean, page: number): Promise<Page<SilIniciativa>> {
    return fetchJson<Page<SilIniciativa>>(this.buildListUrl(grupo, tipo, page), {
      headers,
    });
  }

  /**
   * Iterate the full corpus: every subject group × {Proyectos de Ley, Resoluciones},
   * paging through each slice. Yields base records (no sponsor/history) — call
   * `enrich()` to add party/province/history when needed.
   */
  async *list(
    options: { maxPagesPerSlice?: number } = {},
  ): AsyncIterable<RawInitiative> {
    const { maxPagesPerSlice = Infinity } = options;
    const groups = await this.groups();
    for (const g of groups) {
      for (const tipo of [true, false]) {
        let page = 1;
        while (page <= maxPagesPerSlice) {
          const env = await this.listPage(g.id, tipo, page);
          for (const row of env.results) yield mapInitiative(row);
          if (page * env.pageSize >= env.total || env.results.length === 0) break;
          page++;
        }
      }
    }
  }

  async detail(sourceId: string): Promise<RawInitiative | null> {
    const data = await fetchJson<SilIniciativa | null>(
      `${this.base}/iniciativa/${encodeURIComponent(sourceId)}`,
      { headers },
    );
    return data == null ? null : mapInitiative(data);
  }

  /** Sponsors for an initiative (party + province live here). */
  async proponentes(id: string | number): Promise<SilProponente[]> {
    const env = await fetchJson<Page<SilProponente>>(
      `${this.base}/proponentes?page=1&id=${id}`,
      { headers },
    );
    return env.results ?? [];
  }

  /** Status-change history for an initiative. */
  async historicos(id: string | number): Promise<SilHistorico[]> {
    const env = await fetchJson<Page<SilHistorico>>(
      `${this.base}/historicos?page=1&id=${id}`,
      { headers },
    );
    return env.results ?? [];
  }

  /**
   * Official documents attached to an initiative (deposited text, committee acuse/
   * informe, approved text…). The `documentos` JSON is reachable over normal HTTP; the
   * actual file is served from the Cámara's document host (`s-sil...:8095`), which may
   * be reachable only from certain networks. `documentUrl()` builds the official link.
   */
  async documentos(id: string | number): Promise<SilDocumento[]> {
    const env = await fetchJson<Page<SilDocumento>>(
      `${this.base}/documentos?page=1&id=${id}`,
      { headers },
    );
    return env.results ?? [];
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
    const principal = props.find((p) => p.principal) ?? props[0];
    const rep = principal?.representacion;
    const history: RawStatusEvent[] = hist.map((h) => ({
      status: String(h.estado ?? ""),
      date: h.inicio ?? null,
      note: null,
    }));
    return {
      ...raw,
      sponsor: principal?.nombre ?? principal?.legislador ?? raw.sponsor,
      party: rep?.partido?.siglas ?? rep?.partido?.nombre ?? raw.party,
      province: rep?.provincia ?? raw.province,
      history: history.length ? history : raw.history,
      raw: { base: raw.raw, proponentes: props, historicos: hist },
    };
  }
}

/** Map a SIL record into our canonical RawInitiative. */
function mapInitiative(d: SilIniciativa): RawInitiative {
  const id = String(d.id);
  return {
    sourceId: id,
    source: "sil-diputados",
    kind: "LEGISLATIVE",
    code: d.numero ?? null,
    title: String(d.descripcion ?? ""),
    purpose: null,
    type: d.tipo ?? null,
    status: d.estado ?? d.condicion ?? null,
    chamber: "DIPUTADOS",
    sourceCategory: d.grupo ?? d.materia ?? null,
    sponsor: null,
    party: null,
    province: null,
    committee: null,
    filedAt: normalizeDate(d.fechaDeposito),
    expiresAt: null,
    sourceUrl: `https://www.diputadosrd.gob.do/sil/iniciativa/${id}`,
    history: [],
    raw: d,
  };
}

/** SIL dates are like "2026-06-18T00:00:00" (no TZ). Keep date portion as ISO. */
function normalizeDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1]! : null;
}
