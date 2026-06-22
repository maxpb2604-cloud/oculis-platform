/**
 * Adapter for the Cámara de Diputados SIL **activity** subsystem — the daily
 * committee and plenary agenda, which is SEPARATE from the `iniciativa/*` corpus
 * covered by `sil-diputados.ts`.
 *
 * This is the source of "what happened today": initiatives may sit unchanged in the
 * iniciativa endpoints for days while committees actively meet on them. Discovered by
 * inspecting the live SPA's "Sesiones" page network calls.
 *
 *   comision/ordenes?page={p}&periodoId=0   -> Page<ComisionOrden>  (committee meetings/agenda)
 *   sesion/ordenes?page={p}&periodoId=0     -> Page<SesionOrden>    (plenary order-of-the-day)
 *
 * Neither payload carries a stable record id, so we synthesize a dedupe key from
 * (fecha, comisión/cámara, descripción). Each agenda item references one or more
 * initiatives by official code (e.g. "05646-2024-2028-CD"); we extract those so the
 * worker can link activity ↔ initiatives.
 */
import { fetchJson } from "./http.js";
import type { Page } from "./sil-diputados.js";

const ROOT = "https://www.diputadosrd.gob.do/sil/api";
const REFERER = "https://www.diputadosrd.gob.do/sil/sesiones";
const headers = { Referer: REFERER };

/** Official initiative code pattern, e.g. 05646-2024-2028-CD. */
const CODE_RE = /\d{5}-\d{4}-\d{4}-[A-Z]{2}/g;

export interface SilComisionOrden {
  fecha: string | null; // ISO datetime of the meeting
  descripcion: string | null; // agenda text (lists referenced initiatives)
  tipo: string | null; // "Reunión", "Encuentros con Funcionarios de Otros Poderes", …
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
  source: string; // adapter key
  /** COMMITTEE (comisión), PLENARY (pleno), or ASAMBLEA (asamblea nacional). */
  scope: "COMMITTEE" | "PLENARY" | "ASAMBLEA";
  /** Chamber the activity belongs to. */
  chamber?: "DIPUTADOS" | "SENADO" | null;
  /** Source page/PDF for this agenda item. */
  agendaUrl?: string | null;
  /** ISO date (yyyy-mm-dd) of the activity. */
  date: string | null;
  /** Activity kind reported by the source ("Reunión", "Encuentro…", "Orden del Día"). */
  kind: string | null;
  /** Committee name (COMMITTEE scope) or chamber (PLENARY scope). */
  body: string | null;
  /** Full agenda / purpose text. */
  description: string;
  /** Official codes of initiatives referenced by this agenda item. */
  initiativeCodes: string[];
  /** Stable-ish dedupe key synthesized from the content. */
  dedupeKey: string;
  /** Untouched source payload. */
  raw: unknown;
}

function isoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1]! : null;
}

function extractCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set((text.match(CODE_RE) ?? []))];
}

/** djb2 hash → short hex; used to dedupe agenda rows that carry no id. */
function keyOf(...parts: Array<string | null | undefined>): string {
  const s = parts.map((p) => p ?? "").join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export class SilActividadAdapter {
  readonly source = "sil-actividad";

  constructor(private readonly root: string = ROOT) {}

  private async *pages<T>(path: string): AsyncIterable<T> {
    let page = 1;
    while (true) {
      const env = await fetchJson<Page<T>>(
        `${this.root}/${path}?page=${page}&periodoId=0`,
        { headers },
      );
      if (!env?.results?.length) break;
      for (const row of env.results) yield row;
      if (page * env.pageSize >= env.total) break;
      page++;
    }
  }

  /** All committee agenda/meeting items, mapped to canonical activity events. */
  async *committeeOrders(): AsyncIterable<RawActivityEvent> {
    for await (const r of this.pages<SilComisionOrden>("comision/ordenes/")) {
      const description = (r.descripcion ?? "").replace(/\s+/g, " ").trim();
      yield {
        source: this.source,
        scope: "COMMITTEE",
        chamber: "DIPUTADOS",
        date: isoDate(r.fecha),
        kind: r.tipo ?? null,
        body: (r.nombreComision ?? "").trim() || null,
        description,
        initiativeCodes: extractCodes(r.descripcion),
        dedupeKey: keyOf("C", isoDate(r.fecha), r.nombreComision, description),
        raw: r,
      };
    }
  }

  /** Plenary order-of-the-day items, mapped to canonical activity events. */
  async *plenaryOrders(): AsyncIterable<RawActivityEvent> {
    for await (const r of this.pages<SilSesionOrden>("sesion/ordenes")) {
      const description = (r.descripcion ?? "").replace(/\s+/g, " ").trim();
      yield {
        source: this.source,
        scope: "PLENARY",
        chamber: "DIPUTADOS",
        date: isoDate(r.fecha),
        kind: r.tipo ?? null,
        body: (r.camara ?? "").trim() || null,
        description,
        initiativeCodes: extractCodes(r.descripcion),
        dedupeKey: keyOf("P", isoDate(r.fecha), r.camara, description),
        raw: r,
      };
    }
  }

  /** Both streams concatenated (committee first, then plenary). */
  async *list(): AsyncIterable<RawActivityEvent> {
    yield* this.committeeOrders();
    yield* this.plenaryOrders();
  }
}
