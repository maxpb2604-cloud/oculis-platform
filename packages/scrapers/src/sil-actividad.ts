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
 * Committee rows carry no stable record id, so their identity is an exact fingerprint
 * of every consumed source field plus a literal-duplicate occurrence number. Plenary
 * rows use the official `id` when present. Each agenda item references initiatives by
 * official code; those links resolve only when the code identifies one unique PDL.
 */
import { extractCodes } from "./codes.js";
import { buildISODate, extractLeadingISODate, spanishMonthToNum } from "./dates.js";
import { fetchJson } from "./http.js";
import type { Page } from "./sil-diputados.js";
import { createHash } from "node:crypto";

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

/**
 * Plenary order-of-the-day record. NOTE: this endpoint carries NO `fecha`/`camara`/`tipo`
 * fields — the session date lives inside `documento` ("...MIÉRCOLES 24 DE JUNIO DE 2026...")
 * and the stable identity is `id`. (An earlier version assumed `fecha`, which the API
 * always returns as undefined → every plenary order was stored with a null date and was
 * invisible on the date-filtered "Hoy" view.)
 */
export interface SilSesionOrden {
  id: number | null;
  documento: string | null;
  descripcion: string | null;
  cargado: string | null; // ISO upload timestamp
  tipoAgenda: number | null;
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
  /** Literal time/range reported by the agenda, when present. */
  time?: string | null;
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

function exactFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Pull a Spanish date ("24 de junio de 2026") out of free text → ISO yyyy-mm-dd. */
export function parseSpanishDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const mm = spanishMonthToNum(m[2]);
  return mm ? buildISODate(m[1]!, mm, m[3]!) : null;
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
      const env = await fetchJson<Page<T>>(`${this.root}/${path}?page=${page}&periodoId=0`, {
        headers,
      });
      const pageSize = Number(env.pageSize);
      const total = Number(env.total);
      if (
        !env ||
        !Array.isArray(env.results) ||
        !Number.isFinite(pageSize) ||
        pageSize <= 0 ||
        !Number.isFinite(total) ||
        total < 0
      ) {
        throw new Error(
          `SIL actividad devolvió una página inválida para ${label} (página ${page}).`,
        );
      }
      if (page === 1) expected = total;
      if (env.results.length === 0) break;
      rows.push(...env.results);
      if (env.results.length < pageSize) break;
      if (page * pageSize >= total) break;
      page++;
    }
    const gap =
      expected > 0 && rows.length < expected
        ? `SIL · ${label}: se recolectaron ${rows.length} de ${expected} informados por la fuente.`
        : page > MAX_PAGES
          ? `SIL · ${label}: se alcanzó el tope de ${MAX_PAGES} páginas.`
          : undefined;
    return { rows, expected, gap };
  }

  async committeeOrders(): Promise<{ events: RawActivityEvent[]; gap?: string }> {
    const { rows, gap } = await this.fetchAll<SilComisionOrden>("comision/ordenes", "comisiones");
    // This endpoint has no stable id. Fingerprint the complete source row and retain an
    // occurrence number only for literally identical duplicate rows. No date/name/text
    // similarity is used to merge distinct published records.
    const occurrences = new Map<string, number>();
    const events = rows.map((r): RawActivityEvent => {
      const description = (r.descripcion ?? "").replace(/\s+/g, " ").trim();
      const date = extractLeadingISODate(r.fecha);
      const body = (r.nombreComision ?? "").trim() || null;
      const fingerprint = exactFingerprint({
        fecha: r.fecha ?? null,
        descripcion: r.descripcion ?? null,
        tipo: r.tipo ?? null,
        nombreComision: r.nombreComision ?? null,
        periodoLegislativo: r.periodoLegislativo ?? null,
      });
      const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
      occurrences.set(fingerprint, occurrence);
      return {
        source: this.source,
        scope: "COMMITTEE",
        chamber: "DIPUTADOS",
        date,
        kind: r.tipo ?? null,
        body,
        description,
        initiativeCodes: extractCodes(r.descripcion),
        dedupeKey: `sil-com|${fingerprint}|${occurrence}`,
        raw: {
          payload: r,
          provenance: {
            endpoint: `${this.root}/comision/ordenes`,
            explicitDateField: "fecha",
            explicitKindField: "tipo",
          },
        },
      };
    });
    return { events, gap };
  }

  async plenaryOrders(): Promise<{ events: RawActivityEvent[]; gap?: string }> {
    const { rows, gap } = await this.fetchAll<SilSesionOrden>("sesion/ordenes", "pleno");
    const fallbackOccurrences = new Map<string, number>();
    const events = rows.map((r): RawActivityEvent => {
      const description = (r.descripcion ?? r.documento ?? "").replace(/\s+/g, " ").trim();
      // No `fecha` field exists here. Use only the session date explicitly named in
      // `documento`; `cargado` is an upload timestamp, not evidence of session date.
      const date = parseSpanishDate(r.documento);
      const fallbackFingerprint = exactFingerprint({
        documento: r.documento ?? null,
        descripcion: r.descripcion ?? null,
        cargado: r.cargado ?? null,
        tipoAgenda: r.tipoAgenda ?? null,
      });
      const fallbackOccurrence = (fallbackOccurrences.get(fallbackFingerprint) ?? 0) + 1;
      fallbackOccurrences.set(fallbackFingerprint, fallbackOccurrence);
      return {
        source: this.source,
        scope: "PLENARY",
        chamber: "DIPUTADOS",
        date,
        kind: "Orden del día",
        body: "Pleno",
        description,
        initiativeCodes: extractCodes(r.descripcion ?? r.documento),
        // `id` is stable + unique per order — kills the old constant `sil-ple|?|?|?`
        // key that made every plenary order overwrite the previous one.
        dedupeKey:
          r.id != null ? `sil-ple|${r.id}` : `sil-ple|${fallbackFingerprint}|${fallbackOccurrence}`,
        raw: {
          payload: r,
          provenance: {
            endpoint: `${this.root}/sesion/ordenes`,
            dateEvidence: date ? "documento" : null,
          },
        },
      };
    });
    return { events, gap };
  }

  /**
   * Collect Diputados COMMITTEE activity. Diputados PLENARY órdenes del día are deliberately
   * NOT emitted here — `dip-oficial` is the canonical, richer source for them (reading
   * statuses, initiative codes, full history). Emitting them from both feeds double-counts
   * the same session on "Hoy". We still PARSE the SIL plenary feed as a health canary: if it
   * goes silent while committees are active, that's surfaced as a gap (it does not affect
   * what's shown, since the pleno is sourced from dip-oficial).
   */
  async collect(): Promise<ActivityCollectResult> {
    const [com, ple] = await Promise.all([this.committeeOrders(), this.plenaryOrders()]);
    const gaps = [com.gap].filter(Boolean) as string[];
    if (ple.events.length === 0 && com.events.length > 0) {
      gaps.push(
        "sil-actividad: el feed SIL de órdenes de pleno está vacío mientras hay actividad de comisión — verificar la fuente (el pleno se publica vía dip-oficial).",
      );
    }
    return { events: com.events, gaps };
  }

  /** Generator interface (kept for callers that stream). */
  async *list(): AsyncIterable<RawActivityEvent> {
    const { events } = await this.collect();
    yield* events;
  }
}
