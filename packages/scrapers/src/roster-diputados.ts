/**
 * Roster adapter for the Cámara de Diputados.
 *
 * The public WordPress site carries no legislative data; the real source is the "SIL
 * Ciudadano" Angular app, backed by a plain ASP.NET JSON API at
 * `https://www.diputadosrd.gob.do/sil/api/` — no auth, no headless browser. We pull:
 *   1. the full deputy roster (legislador/legisladores, paginated, keyword a–z + dedupe),
 *      enriched per-deputy for province/party/period;
 *   2. every committee (comision/comisiones) and its membership with cargos
 *      (comision/miembros) — president, vice-president, secretary and members.
 *
 * Route segments are case-sensitive and `pageSize` is fixed at 10 by the API.
 */
import { browserHeaders, fetchJson } from "./http.js";
import type { RawCommissionMembership, RawLegislator, RosterResult } from "./roster.js";

const BASE = "https://www.diputadosrd.gob.do/sil/api";
const H = browserHeaders({ Referer: "https://www.diputadosrd.gob.do/sil/" });
const PAGE_SIZE = 10;

interface ApiPage<T> {
  page: number;
  pageSize: number;
  total: number;
  results: T[];
}

interface ApiLegislador {
  legisladorId: number;
  nombreCompleto: string;
  funcion: string | null;
  provincia: string | null;
  circunscripcion: string | null;
  periodo: string | null;
  nivelRepresentacion: string | null;
  profesion: string | null;
  correoInstitucional: string | null;
  telefonoOficina: string | null;
  partido: { nombre: string | null; siglas: string | null } | null;
}

/** Per-legislator detail — the list endpoint leaves profesión/contacto/período null. */
interface ApiLegisladorDetalle {
  profesion: string | null;
  correoInstitucional: string | null;
  telefonoOficina: string | null;
  representacion: {
    nivelRepresentacion: string | null;
    periodo: string | null;
    circunscripcion: string | null;
  } | null;
}

interface ApiComision {
  id: number;
  comision: string;
  tipo: string | null;
  estado: string | null;
}

interface ApiMiembro {
  legislador: { legisladorId: number; nombreCompleto: string };
  partido: { nombre: string | null; siglas: string | null } | null;
  cargo: string | null;
  estado: string | null;
}

/** Walk every page of a keyword/id-filtered endpoint, accumulating results. */
async function fetchAllPages<T>(url: (page: number) => string): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  // Hard cap so a misbehaving total can't loop forever.
  for (let guard = 0; guard < 200; guard++) {
    const env = await fetchJson<ApiPage<T>>(url(page), { headers: H });
    if (!env || !Array.isArray(env.results) || !Number.isFinite(Number(env.total))) {
      throw new Error(`roster-diputados: invalid page envelope at page ${page}`);
    }
    out.push(...(env.results ?? []));
    if (page * PAGE_SIZE >= (env.total ?? 0) || (env.results ?? []).length === 0) break;
    page++;
  }
  return out;
}

export class DiputadosRosterAdapter {
  readonly source = "roster-diputados";

  async collect(): Promise<RosterResult> {
    const gaps: string[] = [];
    const legislators = await this.collectLegislators(gaps);
    const memberships = await this.collectMemberships(gaps);
    return { legislators, memberships, gaps };
  }

  /**
   * The list endpoint requires a non-empty keyword, so we sweep a–z and dedupe by
   * legisladorId. `funcion` is gendered ("Diputado"/"Diputada"), so we keep anything
   * starting with "Diputad" — this excludes the senators and "Institución del Estado"
   * rows that the same endpoint also returns.
   */
  private async collectLegislators(gaps: string[]): Promise<RawLegislator[]> {
    const seen = new Map<number, ApiLegislador>();
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      const rows = await fetchAllPages<ApiLegislador>(
        (p) => `${BASE}/legislador/legisladores?page=${p}&keyword=${letter}`,
      );
      for (const r of rows) {
        if (!r.funcion || !/^diputad/i.test(r.funcion)) continue;
        if (!seen.has(r.legisladorId)) seen.set(r.legisladorId, r);
      }
    }
    // Enrich each deputy with their detail record (profesión, contacto, período) — the
    // list endpoint leaves those null. One call each; failures fall back to list-only data.
    const list: RawLegislator[] = [];
    for (const r of seen.values()) {
      let detail: ApiLegisladorDetalle | null = null;
      try {
        detail = await fetchJson<ApiLegisladorDetalle>(
          `${BASE}/legislador/legislador/${r.legisladorId}`,
          { headers: H },
        );
      } catch (error) {
        gaps.push(
          `roster-diputados: ficha ${r.legisladorId} no disponible (${(error as Error).message}).`,
        );
      }
      list.push(this.toLegislator(r, detail));
    }
    // 190 elected deputies for 2024-2028; warn if we're materially short.
    if (list.length < 170) {
      gaps.push(
        `roster-diputados: ${list.length} diputados; referencia institucional esperada: 190.`,
      );
    }
    return list;
  }

  private toLegislator(r: ApiLegislador, detail: ApiLegisladorDetalle | null): RawLegislator {
    return {
      sourceId: String(r.legisladorId),
      source: this.source,
      chamber: "DIPUTADOS",
      fullName: r.nombreCompleto.trim(),
      province: r.provincia?.trim() || null,
      circumscription:
        detail?.representacion?.circunscripcion?.trim() || r.circunscripcion?.trim() || null,
      party: r.partido?.nombre?.trim() || null,
      partyShort: r.partido?.siglas?.trim() || null,
      role: r.funcion?.trim() || null,
      representationLevel:
        detail?.representacion?.nivelRepresentacion?.trim() ||
        r.nivelRepresentacion?.trim() ||
        null,
      period: detail?.representacion?.periodo?.trim() || r.periodo?.trim() || null,
      photoUrl: `${BASE}/legislador/getfoto/${r.legisladorId}`,
      email: detail?.correoInstitucional?.trim() || r.correoInstitucional?.trim() || null,
      phone: detail?.telefonoOficina?.trim() || r.telefonoOficina?.trim() || null,
      profession: detail?.profesion?.trim() || r.profesion?.trim() || null,
      // Angular route from the SIL bundle: path "legislador/:id" under base href "/sil/".
      sourceUrl: `https://www.diputadosrd.gob.do/sil/legislador/${r.legisladorId}`,
      raw: {
        payload: { list: r, detail },
        provenance: {
          sourceUrl: `https://www.diputadosrd.gob.do/sil/legislador/${r.legisladorId}`,
          endpoints: ["legislador/legisladores", `legislador/legislador/${r.legisladorId}`],
        },
      },
    };
  }

  private async collectMemberships(gaps: string[]): Promise<RawCommissionMembership[]> {
    const comisiones = await fetchAllPages<ApiComision>(
      (p) => `${BASE}/comision/comisiones?page=${p}&keyword=`,
    );
    const out: RawCommissionMembership[] = [];
    for (const c of comisiones) {
      let miembros: ApiMiembro[] = [];
      try {
        miembros = await fetchAllPages<ApiMiembro>(
          (p) => `${BASE}/comision/miembros/?page=${p}&id=${c.id}`,
        );
      } catch (e) {
        gaps.push(
          `roster-diputados: no se pudo leer miembros de "${c.comision}" (${(e as Error).message}).`,
        );
        continue;
      }
      for (const m of miembros) {
        if (m.estado && m.estado.toLowerCase() !== "activo") continue;
        out.push({
          source: this.source,
          chamber: "DIPUTADOS",
          commissionName: c.comision.trim(),
          commissionSourceId: String(c.id),
          legislatorName: m.legislador.nombreCompleto.trim(),
          legislatorSourceId: String(m.legislador.legisladorId),
          cargo: m.cargo?.trim() || null,
          party: m.partido?.siglas?.trim() || m.partido?.nombre?.trim() || null,
          sourceUrl: `https://www.diputadosrd.gob.do/sil/comision/${c.id}`,
        });
      }
    }
    return out;
  }
}
