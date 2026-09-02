/**
 * Adapter for the Cámara de Diputados "SIL Ciudadano" public JSON API.
 *
 * Discovered + verified by reverse-engineering the Angular SPA at
 * https://www.diputadosrd.gob.do/sil and capturing its live network calls.
 *
 * Base = `https://www.diputadosrd.gob.do/sil/api/iniciativa`. All endpoints GET JSON.
 *
 *   CountIniciativas?periodoId=0                      -> serial high-water mark
 *   getIniciativas?page={p}&keyword=                  -> global Page<Iniciativa>
 *   Grupos?periodoId=0                                -> Grupo[]  (subject taxonomy)
 *   Materias?grupo={g}&periodoId=0                    -> Materia[]
 *   iniciativa/{id}                                   -> Iniciativa | null
 *   iniciativas?page={p}&grupo={g}&tipo={bool}&perimidas=false&keyword=&periodoId=0
 *                                                     -> Page<Iniciativa>
 *   proponentes?page={p}&id={id}                      -> Page<Proponente>
 *   historicos?page={p}&id={id}                       -> Page<Historico>
 *   comisiones?page={p}&id={id}                       -> Page<Comision>
 *   Actividades?page={p}&id={id}                      -> Page<Actividad>
 *   votaciones?page={p}&id={id}                       -> Page<Votacion>
 *   documentos?page={p}&id={id}                       -> Page<Documento>
 *
 * `tipo` is a BOOLEAN: true = Proyectos de Ley, false = Resoluciones/other. Iterating
 * every grupo × {true,false} enumerates the full corpus.
 */
import type { Chamber } from "@oculis/core";
import type {
  RawCommissionAssignment,
  RawInitiative,
  RawStatusEvent,
  SourceAdapter,
} from "./types.js";
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

/**
 * Exact, source-reported coverage of the Cámara catalogue.
 *
 * `CountIniciativas` is not a row count: it is the highest assigned initiative serial.
 * The authoritative catalogue cardinality is the stable `total` published by the global
 * `getIniciativas` pagination. Missing serials remain upstream omissions; they are never
 * converted into invented initiatives or source ids.
 */
export interface SilDiputadosCatalogDiagnostics {
  catalogTotal: number;
  serialHighWatermark: number;
  upstreamCatalogOmissions: number[];
  partitionCount: number;
  globalPageCount: number;
}

export interface SilDiputadosCatalogSnapshot extends SilDiputadosCatalogDiagnostics {
  rows: RawInitiative[];
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
  iniciado?: string | null;
  fechaIniciado?: string | null;
  legislatura?: string | null;
  numPromulgacion?: string | number | null;
  fechaPromulgacion?: string | null;
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
    nivelRepresentacion?: string | null;
    ejercicio?: string | null;
    inicio?: string | null;
    fin?: string | null;
    periodo?: string | null;
    circunscripcion?: string | null;
    circunscripcionId?: number | null;
    partido?: { id?: number | null; nombre?: string; siglas?: string };
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
  id?: string | number | null;
  estado?: string;
  inicio?: string | null;
  fin?: string | null;
  [k: string]: unknown;
}

/** One public committee activity linked to an initiative by the SIL. */
export interface SilIniciativaActividad {
  id?: string | number | null;
  actividad?: string | null;
  fecha?: string | null;
  tipo?: string | null;
  ubicacion?: string | null;
  comisionId?: string | number | null;
  [k: string]: unknown;
}

/** One public aggregate vote linked to an initiative by the SIL. */
export interface SilIniciativaVotacion {
  id?: string | number | null;
  titulo?: string | null;
  mocion?: string | null;
  fecha?: string | null;
  numeroVotacion?: string | null;
  sesionId?: string | number | null;
  votos?: {
    cantidadTotalVotos?: number | null;
    cantidadVotosSi?: number | null;
    cantidadVotosNo?: number | null;
    cantidadVotosAbastencion?: number | null;
    [k: string]: unknown;
  } | null;
  asistencias?: Record<string, unknown> | null;
  [k: string]: unknown;
}

/** One literal initiative-to-commission assignment returned by the SIL. */
export interface SilComision {
  id?: string | number | null;
  tipoId?: string | number | null;
  tipo?: string | null;
  comision?: string | null;
  inicio?: string | null;
  fin?: string | null;
  [k: string]: unknown;
}

export type SilEnrichmentCollection =
  | "detail"
  | "proponentes"
  | "historicos"
  | "comisiones"
  | "actividades"
  | "votaciones";

/** Per-collection observation result, allowing callers to persist partial success safely. */
export interface SilEnrichmentObservation {
  initiative: RawInitiative;
  observed: Record<SilEnrichmentCollection, boolean>;
  failures: Array<{ collection: SilEnrichmentCollection; message: string }>;
}

const headers = { Referer: REFERER };

export class SilDiputadosAdapter implements SourceAdapter {
  readonly source = "sil-diputados";

  private globalFirstPagePromise: Promise<Page<SilIniciativa>> | null = null;
  private catalogSnapshotPromise: Promise<SilDiputadosCatalogSnapshot> | null = null;

  constructor(private readonly base: string = BASE) {}

  /** Exact catalogue cardinality from the global index, not the serial high-water mark. */
  async count(): Promise<number> {
    const first = await this.globalFirstPage();
    if (first.total <= 0 || first.results.length === 0) {
      throw new Error("SIL global initiative catalogue returned zero rows");
    }
    return first.total;
  }

  /** Diagnostic only: the largest initiative serial assigned by the Cámara. */
  async serialHighWatermark(): Promise<number> {
    const value = await fetchJson<number>(`${this.base}/CountIniciativas?periodoId=0`, {
      headers,
    });
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("SIL returned an invalid initiative serial high-water mark");
    }
    return value;
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

  /** Build the unfiltered, global catalogue URL used for exact cardinality. */
  buildGlobalListUrl(page: number): string {
    const qs = new URLSearchParams({ page: String(page), keyword: "" });
    return `${this.base}/getIniciativas?${qs.toString()}`;
  }

  /** One page of the global catalogue. */
  async globalListPage(page: number): Promise<Page<SilIniciativa>> {
    const url = this.buildGlobalListUrl(page);
    const envelope = await fetchJson<Page<SilIniciativa>>(url, { headers });
    assertPageEnvelope(envelope, url, page);
    return envelope;
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
    assertPageEnvelope(envelope, url, page);
    return envelope;
  }

  /**
   * Load and validate the exact global catalogue, then reconcile it to all 60 official
   * group/type/expiry partitions. This operation is cached per adapter instance because
   * workers ask for both the rows and their diagnostics in the same run.
   */
  async catalogSnapshot(): Promise<SilDiputadosCatalogSnapshot> {
    this.catalogSnapshotPromise ??= this.loadCatalogSnapshot();
    return this.catalogSnapshotPromise;
  }

  async catalogDiagnostics(): Promise<SilDiputadosCatalogDiagnostics> {
    const { rows: _rows, ...diagnostics } = await this.catalogSnapshot();
    return diagnostics;
  }

  /**
   * Iterate the full corpus: every subject group × {Proyectos de Ley, Resoluciones},
   * paging through each slice. Yields base records (no sponsor/history) — call
   * `enrich()` to add party/province/history when needed.
   */
  async *list(options: { maxPagesPerSlice?: number } = {}): AsyncIterable<RawInitiative> {
    const { maxPagesPerSlice = Infinity } = options;
    if (!Number.isFinite(maxPagesPerSlice)) {
      const snapshot = await this.catalogSnapshot();
      yield* snapshot.rows;
      return;
    }

    // A bounded list is an explicitly partial diagnostic run. Exact/full runs use the
    // globally reconciled snapshot above.
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
              yield mapSilInitiative(row, this.base, { perimidas });
            }
            if (page * env.pageSize >= env.total || env.results.length === 0) break;
            page++;
          }
        }
      }
    }
  }

  private globalFirstPage(): Promise<Page<SilIniciativa>> {
    this.globalFirstPagePromise ??= this.globalListPage(1);
    return this.globalFirstPagePromise;
  }

  private async loadCatalogSnapshot(): Promise<SilDiputadosCatalogSnapshot> {
    const first = await this.globalFirstPage();
    const catalogTotal = first.total;
    if (catalogTotal <= 0 || first.results.length === 0) {
      throw new Error("SIL global initiative catalogue returned zero rows");
    }
    const pageSize = first.pageSize;
    const globalPageCount = Math.ceil(catalogTotal / pageSize);
    const globalRows: SilIniciativa[] = [];
    const globalIds = new Set<number>();
    const globalCodes = new Set<string>();

    for (let page = 1; page <= globalPageCount; page++) {
      const envelope = page === 1 ? first : await this.globalListPage(page);
      assertStableCatalogPage(envelope, {
        page,
        pageSize,
        total: catalogTotal,
        pageCount: globalPageCount,
        label: "global",
      });
      for (const row of envelope.results) {
        const code = validatedCatalogIdentity(row, "global catalogue");
        if (globalIds.has(row.id)) {
          throw new Error(`SIL global catalogue repeated initiative id ${row.id}`);
        }
        if (globalCodes.has(code)) {
          throw new Error(`SIL global catalogue repeated initiative code ${code}`);
        }
        globalIds.add(row.id);
        globalCodes.add(code);
        globalRows.push(row);
      }
    }
    if (globalRows.length !== catalogTotal) {
      throw new Error(
        `SIL global catalogue declared ${catalogTotal} rows but enumerated ${globalRows.length}`,
      );
    }

    const groups = await this.groups();
    const groupIds = new Set(groups.map((group) => group.id));
    if (
      groupIds.size !== groups.length ||
      groups.some((group) => !Number.isSafeInteger(group.id) || group.id <= 0)
    ) {
      throw new Error("SIL returned invalid or duplicate catalogue group ids");
    }
    const partitionCount = groups.length * 2 * 2;
    if (partitionCount !== 60) {
      throw new Error(`SIL exposed ${partitionCount} catalogue partitions; expected 60`);
    }
    const partitionById = new Map<number, { row: SilIniciativa; perimidas: boolean }>();
    const partitionCodeToId = new Map<string, number>();
    for (const group of groups) {
      for (const tipo of [true, false]) {
        for (const perimidas of [false, true]) {
          let expectedTotal: number | null = null;
          let expectedPageSize: number | null = null;
          let enumerated = 0;
          for (let page = 1; page <= 10_000; page++) {
            const envelope = await this.listPage(group.id, tipo, page, perimidas);
            expectedTotal ??= envelope.total;
            expectedPageSize ??= envelope.pageSize;
            if (envelope.total !== expectedTotal || envelope.pageSize !== expectedPageSize) {
              throw new Error(
                `SIL partition ${group.id}/${tipo}/${perimidas} changed pagination metadata`,
              );
            }
            const pageCount = Math.ceil(expectedTotal / expectedPageSize);
            if (expectedTotal > 0) {
              assertStableCatalogPage(envelope, {
                page,
                pageSize: expectedPageSize,
                total: expectedTotal,
                pageCount,
                label: `partition ${group.id}/${tipo}/${perimidas}`,
              });
            } else if (page !== 1 || envelope.results.length !== 0) {
              throw new Error(
                `SIL empty partition ${group.id}/${tipo}/${perimidas} returned inconsistent rows`,
              );
            }
            for (const row of envelope.results) {
              const code = validatedCatalogIdentity(row, "partition catalogue");
              const priorCodeId = partitionCodeToId.get(code);
              if (priorCodeId !== undefined && priorCodeId !== row.id) {
                throw new Error(
                  `SIL partitions assigned initiative code ${code} to ids ${priorCodeId} and ${row.id}`,
                );
              }
              partitionCodeToId.set(code, row.id);
              const prior = partitionById.get(row.id);
              if (prior && normalizedCode(prior.row.numero) !== code) {
                throw new Error(`SIL partitions disagreed on the code for initiative id ${row.id}`);
              }
              partitionById.set(row.id, prior ?? { row, perimidas });
              enumerated++;
            }
            if (expectedTotal === 0 || page === pageCount) {
              if (enumerated !== expectedTotal) {
                throw new Error(
                  `SIL partition ${group.id}/${tipo}/${perimidas} declared ${expectedTotal} rows but enumerated ${enumerated}`,
                );
              }
              break;
            }
          }
        }
      }
    }

    const partitionOnlyIds = [...partitionById.keys()].filter((id) => !globalIds.has(id));
    const missingPartitionIds = [...globalIds].filter((id) => !partitionById.has(id));
    if (partitionOnlyIds.length || missingPartitionIds.length) {
      throw new Error(
        `SIL global/partition catalogue mismatch: ${missingPartitionIds.length} global id(s) missing from partitions; ${partitionOnlyIds.length} partition-only id(s)`,
      );
    }
    for (const row of globalRows) {
      const partition = partitionById.get(row.id)!;
      if (normalizedCode(partition.row.numero) !== normalizedCode(row.numero)) {
        throw new Error(`SIL global/partition code mismatch for initiative id ${row.id}`);
      }
    }

    const serialHighWatermark = await this.serialHighWatermark();
    if (serialHighWatermark < catalogTotal) {
      throw new Error(
        `SIL serial high-water mark ${serialHighWatermark} is below catalogue total ${catalogTotal}`,
      );
    }
    const upstreamCatalogOmissions = silCatalogSerialOmissions(
      globalRows.map((row) => row.numero),
      serialHighWatermark,
    );
    const rows = globalRows.map((row) => {
      const partition = partitionById.get(row.id)!;
      return mapSilInitiative(row, this.base, { perimidas: partition.perimidas });
    });
    return {
      rows,
      catalogTotal,
      serialHighWatermark,
      upstreamCatalogOmissions,
      partitionCount,
      globalPageCount,
    };
  }

  async detail(sourceId: string): Promise<RawInitiative | null> {
    const data = await fetchJson<SilIniciativa | null>(
      `${this.base}/iniciativa/${encodeURIComponent(sourceId)}`,
      { headers },
    );
    return data == null ? null : mapSilInitiative(data, this.base, { observation: "detail" });
  }

  /** Sponsors for an initiative (party + province live here). */
  async proponentes(id: string | number): Promise<SilProponente[]> {
    return this.allPages<SilProponente>("proponentes", id);
  }

  /** Status-change history for an initiative. */
  async historicos(id: string | number): Promise<SilHistorico[]> {
    return this.allPages<SilHistorico>("historicos", id);
  }

  /** Every commission assignment published for an initiative. */
  async commissions(id: string | number): Promise<SilComision[]> {
    return this.allPages<SilComision>("comisiones", id);
  }

  /** Public committee activities in which the initiative appears. */
  async actividades(id: string | number): Promise<SilIniciativaActividad[]> {
    return this.allPages<SilIniciativaActividad>("Actividades", id);
  }

  /** Public aggregate plenary votes linked to the initiative. */
  async votaciones(id: string | number): Promise<SilIniciativaVotacion[]> {
    return this.allPages<SilIniciativaVotacion>("votaciones", id);
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
   * Enrich a list row with the authoritative detail plus every public collection used by
   * the initiative view: proponents, history, commission assignments, activities and
   * aggregate votes. The individual-voter endpoint (`api/votacion/legisladores`) is
   * intentionally not fetched here because it requires an additional request per vote.
   */
  async enrich(raw: RawInitiative): Promise<RawInitiative> {
    const observation = await this.enrichObserved(raw);
    if (observation.failures.length) {
      throw new Error(
        `SIL enrichment failed for ${raw.sourceId}: ${observation.failures
          .map((failure) => `${failure.collection}: ${failure.message}`)
          .join("; ")}`,
      );
    }
    return observation.initiative;
  }

  /**
   * Fetch every enrichment endpoint independently. Successful collections remain usable
   * even when another endpoint fails; `observed` tells persistence code which fields may
   * be updated and provenance contains only endpoints that returned valid payloads.
   */
  async enrichObserved(raw: RawInitiative): Promise<SilEnrichmentObservation> {
    const [
      detailResult,
      propsResult,
      historyResult,
      commissionsResult,
      activitiesResult,
      votesResult,
    ] = await Promise.allSettled([
      this.detail(raw.sourceId),
      this.proponentes(raw.sourceId),
      this.historicos(raw.sourceId),
      this.commissions(raw.sourceId),
      this.actividades(raw.sourceId),
      this.votaciones(raw.sourceId),
    ]);
    const observed: Record<SilEnrichmentCollection, boolean> = {
      detail: detailResult.status === "fulfilled" && detailResult.value !== null,
      proponentes: propsResult.status === "fulfilled",
      historicos: historyResult.status === "fulfilled",
      comisiones: commissionsResult.status === "fulfilled",
      actividades: activitiesResult.status === "fulfilled",
      votaciones: votesResult.status === "fulfilled",
    };
    const failures: SilEnrichmentObservation["failures"] = [];
    const recordFailure = (
      collection: SilEnrichmentCollection,
      result: PromiseSettledResult<unknown>,
      emptyMessage?: string,
    ) => {
      if (result.status === "rejected") {
        failures.push({ collection, message: errorMessage(result.reason) });
      } else if (emptyMessage) {
        failures.push({ collection, message: emptyMessage });
      }
    };
    recordFailure(
      "detail",
      detailResult,
      detailResult.status === "fulfilled" && detailResult.value === null
        ? `SIL returned no initiative detail for ${raw.sourceId}`
        : undefined,
    );
    recordFailure("proponentes", propsResult);
    recordFailure("historicos", historyResult);
    recordFailure("comisiones", commissionsResult);
    recordFailure("actividades", activitiesResult);
    recordFailure("votaciones", votesResult);

    const detail = observed.detail
      ? (detailResult as PromiseFulfilledResult<RawInitiative>).value
      : raw;
    const props = propsResult.status === "fulfilled" ? propsResult.value : [];
    const hist = historyResult.status === "fulfilled" ? historyResult.value : [];
    const commissions = commissionsResult.status === "fulfilled" ? commissionsResult.value : [];
    const actividades = activitiesResult.status === "fulfilled" ? activitiesResult.value : [];
    const votaciones = votesResult.status === "fulfilled" ? votesResult.value : [];
    const principal = props.find((p) => p.principal === true);
    const rep = principal?.representacion;
    const history: RawStatusEvent[] = hist
      .map((h) => ({
        sourceEventId: explicitId(h.id),
        status: h.estado?.trim() ?? "",
        date: extractLeadingISODate(h.inicio),
        endDate: extractLeadingISODate(h.fin),
        note: null,
        raw: h,
      }))
      .filter((event) => event.status.length > 0);
    const commissionAssignments = commissions.map(mapCommissionAssignment);
    const encodedId = encodeURIComponent(raw.sourceId);
    const payload: Record<string, unknown> = { list: rawPayload(raw.raw) };
    const endpoints = ["iniciativa/iniciativas"];
    const observedCollections = ["list"];
    if (observed.detail) {
      payload.detail = rawPayload(detail.raw);
      endpoints.push(`iniciativa/iniciativa/${encodedId}`);
      observedCollections.push("detail");
    }
    if (observed.proponentes) {
      payload.proponentes = props;
      endpoints.push("iniciativa/proponentes");
      observedCollections.push("proponentes");
    }
    if (observed.historicos) {
      payload.historicos = hist;
      endpoints.push("iniciativa/historicos");
      observedCollections.push("historicos");
    }
    if (observed.comisiones) {
      payload.comisiones = commissions;
      endpoints.push("iniciativa/comisiones");
      observedCollections.push("comisiones");
    }
    if (observed.actividades) {
      payload.actividades = actividades;
      endpoints.push("iniciativa/Actividades");
      observedCollections.push("actividades");
    }
    if (observed.votaciones) {
      payload.votaciones = votaciones;
      endpoints.push("iniciativa/votaciones");
      observedCollections.push("votaciones");
    }
    const initiative: RawInitiative = {
      ...detail,
      ...(observed.proponentes
        ? {
            sponsor: proponenteName(principal),
            sponsorRole: cleanText(rep?.funcion),
            sponsorCount: props.length || null,
            party: cleanText(rep?.partido?.siglas) ?? cleanText(rep?.partido?.nombre),
            province: cleanText(rep?.provincia),
          }
        : {}),
      ...(observed.historicos ? { history } : {}),
      ...(observed.comisiones
        ? {
            commissionAssignments,
            // The legacy scalar is safe only when exactly one assignment was observed.
            committee: commissionAssignments.length === 1 ? commissionAssignments[0]!.name : null,
          }
        : {}),
      raw: {
        payload,
        provenance: {
          sourceUrl: detail.sourceUrl,
          endpoints,
          observedCollections,
          collectionFailures: failures,
        },
      },
    };
    return { initiative, observed, failures };
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
export function mapSilInitiative(
  d: SilIniciativa,
  base = BASE,
  query: { perimidas?: boolean; observation?: "list" | "detail" } = {},
): RawInitiative {
  const id = String(d.id);
  const title = d.descripcion?.trim() ?? "";
  const sourceUrl = `https://www.diputadosrd.gob.do/sil/iniciativa/${id}`;
  const observation = query.observation ?? "list";
  const endpoint =
    observation === "detail"
      ? `${base}/iniciativa/${encodeURIComponent(id)}`
      : `${base}/iniciativas`;
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
    sourceChamber: "DIPUTADOS",
    originChamber: explicitOriginChamber(d.camaraInicio, d.origen),
    // This SIL record has no explicit field for the current chamber/body. Status text is
    // intentionally not converted into either fact.
    currentChamber: null,
    currentBody: null,
    condition: cleanText(d.condicion),
    sourceCategory: cleanText(d.grupo) ?? cleanText(d.materia),
    subjectMatter: cleanText(d.materia),
    initiated: cleanText(d.iniciado),
    initiatedAt: extractLeadingISODate(d.fechaIniciado),
    legislature: cleanText(d.legislatura),
    registrationPeriod: cleanText(d.periodoRegistro),
    officialStatusChangedAt: cleanText(d.fechaUltimoCambioPrincipal),
    promulgationNumber: explicitId(d.numPromulgacion),
    promulgatedAt: extractLeadingISODate(d.fechaPromulgacion),
    sponsor: null,
    party: null,
    province: null,
    committee: null,
    commissionAssignments: [],
    filedAt: extractLeadingISODate(d.fechaDeposito),
    expiresAt: null,
    sourceUrl,
    history: [],
    raw: {
      payload: d,
      provenance: {
        sourceUrl,
        endpoint,
        endpoints: [endpoint],
        observedCollections: [observation],
        query: { perimidas: query.perimidas ?? null },
        explicitStatusField: "estado",
        explicitCategoryFields: ["grupo", "materia"],
      },
    },
  };
}

function rawPayload(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "payload" in raw) {
    return (raw as { payload: unknown }).payload;
  }
  return raw;
}

function mapCommissionAssignment(row: SilComision): RawCommissionAssignment {
  return {
    sourceId: explicitId(row.id),
    sourceTypeId: explicitId(row.tipoId),
    type: cleanText(row.tipo),
    name: cleanText(row.comision),
    startDate: extractLeadingISODate(row.inicio),
    endDate: extractLeadingISODate(row.fin),
    raw: row,
  };
}

function explicitId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function cleanText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function explicitOriginChamber(
  camaraInicio: string | null | undefined,
  origen: string | null | undefined,
): Chamber | null {
  const reported = [camaraInicio, origen]
    .map(explicitChamber)
    .filter((value): value is Chamber => value !== null);
  if (reported.length === 0) return null;
  // Conflicting source fields are not resolved by precedence; raw retains both values.
  return reported.every((value) => value === reported[0]) ? reported[0]! : null;
}

function explicitChamber(value: string | null | undefined): Chamber | null {
  const normalized = value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!normalized) return null;
  if (/\bSENAD(?:O|ORES|ORAS)?\b/.test(normalized)) return "SENADO";
  if (/\bDIPUTAD(?:O|A|OS|AS)\b/.test(normalized)) return "DIPUTADOS";
  return null;
}

function assertPageEnvelope<T>(value: Page<T>, url: string, requestedPage?: number): void {
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
  if (requestedPage !== undefined && Number(value.page) !== requestedPage) {
    throw new Error(
      `SIL returned page ${String(value.page)} while page ${requestedPage} was requested: ${url}`,
    );
  }
}

function assertStableCatalogPage<T>(
  envelope: Page<T>,
  expected: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
    label: string;
  },
): void {
  if (
    envelope.page !== expected.page ||
    envelope.pageSize !== expected.pageSize ||
    envelope.total !== expected.total
  ) {
    throw new Error(`SIL ${expected.label} pagination changed while reading page ${expected.page}`);
  }
  const expectedRows =
    expected.page < expected.pageCount
      ? expected.pageSize
      : expected.total - expected.pageSize * (expected.page - 1);
  if (expectedRows <= 0 || envelope.results.length !== expectedRows) {
    throw new Error(
      `SIL ${expected.label} page ${expected.page} returned ${envelope.results.length} row(s); expected ${expectedRows}`,
    );
  }
}

function normalizedCode(value: string | null | undefined): string {
  return value?.normalize("NFC").replace(/\s+/g, " ").trim() ?? "";
}

function validatedCatalogIdentity(row: SilIniciativa, label: string): string {
  if (!Number.isSafeInteger(row.id) || row.id <= 0) {
    throw new Error(`SIL ${label} returned an invalid initiative id`);
  }
  const code = normalizedCode(row.numero);
  if (!code) throw new Error(`SIL ${label} returned no initiative code for id ${row.id}`);
  return code;
}

/**
 * Report unassigned serials without fabricating catalogue rows. Codes whose leading
 * segment is not numeric remain source literals and simply do not participate in this
 * diagnostic.
 */
export function silCatalogSerialOmissions(
  codes: Iterable<string | null | undefined>,
  serialHighWatermark: number,
): number[] {
  if (!Number.isSafeInteger(serialHighWatermark) || serialHighWatermark < 0) {
    throw new Error("SIL serial high-water mark must be a non-negative safe integer");
  }
  const observed = new Set<number>();
  for (const code of codes) {
    const match = normalizedCode(code).match(/^0*(\d+)-/);
    if (!match) continue;
    const serial = Number(match[1]);
    if (Number.isSafeInteger(serial) && serial > 0 && serial <= serialHighWatermark) {
      observed.add(serial);
    }
  }
  const omissions: number[] = [];
  for (let serial = 1; serial <= serialHighWatermark; serial++) {
    if (!observed.has(serial)) omissions.push(serial);
  }
  return omissions;
}
