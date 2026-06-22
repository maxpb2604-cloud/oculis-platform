/**
 * Adapter for the Cámara de Diputados SIL **activity** subsystem — the daily
 * committee and plenary agenda, which is SEPARATE from the `iniciativa/*` corpus
 * covered by `sil-diputados.ts`.
 *
 * This is the source of "what happened today": initiatives may sit unchanged in the
 * iniciativa endpoints for days while committees actively meet on them.
 *
 *   comision/ordenes?page={p}&periodoId=0   -> Page<ComisionOrden>  (committee meetings/agenda)
 *   sesion/ordenes?page={p}&periodoId=0     -> Page<SesionOrden>    (plenary order-of-the-day)
 *
 * Neither payload carries a stable record id, so we synthesize a dedupe key from
 * (scope, fecha, comisión/cámara, kind) — NOT the full description, so an edited
 * agenda updates the same row instead of spawning a duplicate. Each agenda item
 * references initiatives by official code; we extract those to link activity ↔ bills.
 */
import { extractCodes } from "./codes.js";
import { fetchJson } from "./http.js";
import type { Page } from "./sil-diputados.js";

const ROOT = "https://www.diputadosrd.gob.do/sil/api";
const REFERER = "https://www.diputadosrd.gob.do/sil/sesiones";
const headers = { Referer: REFERER };
const MAX_PAGES = 200; // safety cap against an unbounded loop (pageSize=0/NaN, stale total)

export interface SilComisionOrden {
  fecha: string | null;
  descripcion: string | null;
  tipo: string | null;
  nombreComision: string | null;
  periodoLegislativo: number | null;
  [k: string]: unknown;
}

export interface SilSesionOrden {
  fecha: string | null;
  descripcion: string | null;
  tipo: string | null;
  camara: string | null;
  [k: string]: unknown;
}

/** Canonical, source-agnostic agenda/activity event. */
export interface RawActivityEvent {
  source: string;
  /** COMMITTEE (comisión), PLENARY (pleno), or ASAMBLEA (asamblea nacional). */
  scope: "COMMITTEE" | "PLENARY" | "ASAMBLEA";
  chamber?: "DIPUTADOS" | "SENADO" | null;
  agendaUrl?: string | null;
  date: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  /** Reading/processing statuses surfaced for this agenda item (structured). */
  statuses?: string[];
  initiativeCodes: string[];
  dedupeKey: string;
  raw: unknown;
}

export interface ActivityCollectResult {
  events: RawActivityEvent[];
  gaps: string[];
}

function isoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1]! : null;
}

export class SilActividadAdapter {
  readonly source = "sil-actividad";

  constructor(private readonly root: string = ROOT) {}

  /**
   * Fully paginate one endpoint with safety guards:
   *  - hard MAX_PAGES cap;
   *  - stop when a page returns fewer rows than pageSize (primary signal), or when
   *    page*pageSize >= total — but never trust a zero/NaN pageSize to terminate;
   *  - report a reconciliation gap when fewer rows were collected than `total`.
   */
  private async fetchAll<T>(
    path: string,
    label: string,
  ): Promise<{ rows: T[]; expected: number; gap?: string }> {
    const rows: T[] = [];
    let expected = 0;
    let page = 1;
    while (page <= MAX_PAGES) {
      const env = await fetchJson<Page<T>>(`${this.root}/${path}?page=${page}&periodoId=0`, { headers });
      if (!env?.results?.length) break;
      if (page === 1) expected = Number(env.total) || 0;
      rows.push(...env.results);
      const pageSize = Number(env.pageSize);
      const total = Number(env.total);
      // terminate on a short page (robust to bad pageSize/total)
      if (!Number.isFinite(pageSize) || pageSize <= 0) break;
      if (env.results.length < pageSize) break;
      if (Number.isFinite(total) && page * pageSize >= total) break;
      page++;
    }
    const gap =
      expected > 0 && rows.length < expected
        ? `SIL · ${label}: se recolectaron ${rows.length} de ${expected} esperados (posible recorte).`
        : page > MAX_PAGES
          ? `SIL · ${label}: se alcanzó el tope de ${MAX_PAGES} páginas.`
          : undefined;
    return { rows, expected, gap };
  }

  async committeeOrders(): Promise<{ events: RawActivityEvent[]; gap?: string }> {
    const { rows, gap } = await this.fetchAll<SilComisionOrden>("comision/ordenes", "comisiones");
    const events = rows.map((r): RawActivityEvent => {
      const description = (r.descripcion ?? "").replace(/\s+/g, " ").trim();
      const date = isoDate(r.fecha);
      const body = (r.nombreComision ?? "").trim() || null;
      return {
        source: this.source,
        scope: "COMMITTEE",
        chamber: "DIPUTADOS",
        date,
        kind: r.tipo ?? null,
        body,
        description,
        initiativeCodes: extractCodes(r.descripcion),
        dedupeKey: `sil-com|${date ?? "?"}|${body ?? "?"}|${r.tipo ?? "?"}`,
        raw: r,
      };
    });
    return { events, gap };
  }

  async plenaryOrders(): Promise<{ events: RawActivityEvent[]; gap?: string }> {
    const { rows, gap } = await this.fetchAll<SilSesionOrden>("sesion/ordenes", "pleno");
    const events = rows.map((r): RawActivityEvent => {
      const description = (r.descripcion ?? "").replace(/\s+/g, " ").trim();
      const date = isoDate(r.fecha);
      const body = (r.camara ?? "").trim() || null;
      return {
        source: this.source,
        scope: "PLENARY",
        chamber: "DIPUTADOS",
        date,
        kind: r.tipo ?? null,
        body,
        description,
        initiativeCodes: extractCodes(r.descripcion),
        dedupeKey: `sil-ple|${date ?? "?"}|${body ?? "?"}|${r.tipo ?? "?"}`,
        raw: r,
      };
    });
    return { events, gap };
  }

  /** Collect committee + plenary activity with reconciliation gaps. */
  async collect(): Promise<ActivityCollectResult> {
    const [com, ple] = await Promise.all([this.committeeOrders(), this.plenaryOrders()]);
    const gaps = [com.gap, ple.gap].filter(Boolean) as string[];
    return { events: [...com.events, ...ple.events], gaps };
  }

  /** Generator interface (kept for callers that stream). */
  async *list(): AsyncIterable<RawActivityEvent> {
    const { events } = await this.collect();
    yield* events;
  }
}
