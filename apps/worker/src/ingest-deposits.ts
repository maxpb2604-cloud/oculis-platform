/**
 * Daily "deposits" sync — the heart of Phase 1's Hoy feed.
 *
 * Pulls the initiatives DEPOSITED in a recent window from the Cámara's SIL API,
 * enriches each with its principal sponsor (name + role + party + province + how many
 * co-proponents) and its official documents (so the dashboard can show whether the PDF
 * is uploaded yet), and upserts them into `initiatives` + `documents`.
 *
 * The SIL list is sorted newest-first by deposit date, so we read each
 * (grupo × tipo) slice page-by-page and stop as soon as it drops out of the window —
 * cheap enough to run every morning.
 */
import {
  recordIngestionRun,
  upsertDocument,
  upsertInitiative,
  type Database,
  type NewInitiative,
} from "@oculis/db";
import {
  SilDiputadosAdapter,
  SenadoSilAdapter,
  proponenteName,
  type SilDocumento,
  type SilIniciativa,
} from "@oculis/scrapers";

export const DEPOSITS_SOURCE = "sil-deposits";
export const SENADO_DEPOSITS_SOURCE = "senado-sil-deposits";

export interface DepositsSummary {
  source: string;
  ok: boolean;
  windowFrom: string;
  deposits: number;
  inserted: number;
  documents: number;
  withDocUploaded: number;
  error?: string;
}

const isoDay = (v: string | null | undefined): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v ?? "");
  return m ? m[1]! : null;
};

function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Scan every (grupo × tipo) slice, collecting deposits with fechaDeposito >= since. */
async function recentDeposits(
  adapter: SilDiputadosAdapter,
  since: string,
  maxPagesPerSlice: number,
): Promise<SilIniciativa[]> {
  const groups = await adapter.groups();
  const seen = new Map<number, SilIniciativa>();
  for (const g of groups) {
    for (const tipo of [true, false]) {
      let page = 1;
      while (page <= maxPagesPerSlice) {
        const env = await adapter.listPage(g.id, tipo, page);
        const rows = env.results ?? [];
        if (rows.length === 0) break;
        let anyInWindow = false;
        for (const r of rows) {
          const day = isoDay(r.fechaDeposito);
          if (day && day >= since) {
            anyInWindow = true;
            seen.set(r.id, r);
          }
        }
        // List is newest-first: once a full page falls before the window, stop the slice.
        const lastDay = isoDay(rows[rows.length - 1]?.fechaDeposito);
        if (!anyInWindow || (lastDay && lastDay < since)) break;
        if (page * env.pageSize >= env.total) break;
        page++;
      }
    }
  }
  return [...seen.values()];
}

export async function ingestDeposits(
  db: Database,
  opts: { sinceDays?: number; today?: string; maxPagesPerSlice?: number; delayMs?: number; log?: (m: string) => void } = {},
): Promise<DepositsSummary> {
  const log = opts.log ?? (() => {});
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const since = shiftISO(today, -(opts.sinceDays ?? 21));
  const maxPagesPerSlice = opts.maxPagesPerSlice ?? 4;
  const delayMs = opts.delayMs ?? 100;
  const adapter = new SilDiputadosAdapter();

  log(`\n▶ ${DEPOSITS_SOURCE} — deposits since ${since}`);
  try {
    const deposits = await recentDeposits(adapter, since, maxPagesPerSlice);
    log(`  ${deposits.length} initiatives deposited in window`);

    let inserted = 0;
    let documents = 0;
    let withDocUploaded = 0;

    for (const d of deposits) {
      const id = String(d.id);
      let props: Awaited<ReturnType<typeof adapter.proponentes>> = [];
      let docs: SilDocumento[] = [];
      try {
        [props, docs] = await Promise.all([adapter.proponentes(id), adapter.documentos(id)]);
      } catch (err) {
        log(`    ⚠ enrich ${d.numero ?? id} falló: ${(err as Error).message}`);
      }
      const principal = props.find((p) => p.principal) ?? props[0];
      const rep = principal?.representacion;

      const record: NewInitiative = {
        source: "sil-diputados",
        sourceId: id,
        kind: "LEGISLATIVE",
        code: d.numero ?? null,
        title: String(d.descripcion ?? ""),
        type: d.tipo ?? null,
        status: d.estado ?? d.condicion ?? null,
        chamber: "DIPUTADOS",
        sourceCategory: d.grupo ?? d.materia ?? null,
        sponsor: proponenteName(principal),
        sponsorRole: rep?.funcion ?? null,
        sponsorCount: props.length || null,
        party: rep?.partido?.siglas ?? rep?.partido?.nombre ?? null,
        province: rep?.provincia ?? null,
        filedAt: isoDay(d.fechaDeposito),
        sourceUrl: `https://www.diputadosrd.gob.do/sil/iniciativa/${id}`,
        raw: d as object,
      };
      const res = await upsertInitiative(db, record);
      if (res.inserted) inserted++;

      let anyUploaded = false;
      for (const doc of docs) {
        const uploadedAt = isoDay(doc.cargado);
        if (uploadedAt) anyUploaded = true;
        const isNew = await upsertDocument(db, {
          source: "sil-diputados",
          initiativeId: res.id,
          initiativeCode: doc.documento ?? d.numero ?? null,
          docType: doc.descripcion ?? null,
          extension: doc.extension ?? null,
          url: adapter.documentUrl(doc.id),
          uploadedAt,
          sourceDocId: String(doc.id),
        });
        if (isNew) documents++;
      }
      if (anyUploaded) withDocUploaded++;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }

    await recordIngestionRun(db, {
      source: DEPOSITS_SOURCE,
      seen: deposits.length,
      inserted,
      ok: true,
      details: deposits.length === 0 ? { gaps: [`Sin depósitos desde ${since} (¿receso o día sin actividad?).`] } : null,
    });
    log(`  ✔ ${deposits.length} deposits (${inserted} new), ${documents} new docs, ${withDocUploaded} con PDF cargado`);
    return { source: DEPOSITS_SOURCE, ok: true, windowFrom: since, deposits: deposits.length, inserted, documents, withDocUploaded };
  } catch (err) {
    const error = (err as Error).message;
    await recordIngestionRun(db, { source: DEPOSITS_SOURCE, ok: false, error });
    log(`  ✖ FAILED: ${error}`);
    return { source: DEPOSITS_SOURCE, ok: false, windowFrom: since, deposits: 0, inserted: 0, documents: 0, withDocUploaded: 0, error };
  }
}

/**
 * Senate deposits sync. The Senate publishes deposited initiatives in the legacy
 * MasterLex SIL (no documents/sponsor metadata in the list), so we upsert the lighter
 * record (code, type, title, status, filing date) with chamber = "SENADO". Isolated
 * from the Diputados sync so a legacy-site blip can't take down the main feed.
 */
export async function ingestSenateDeposits(
  db: Database,
  opts: { sinceDays?: number; today?: string; log?: (m: string) => void } = {},
): Promise<DepositsSummary> {
  const log = opts.log ?? (() => {});
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const since = shiftISO(today, -(opts.sinceDays ?? 21));
  const adapter = new SenadoSilAdapter();

  log(`\n▶ ${SENADO_DEPOSITS_SOURCE} — Senate deposits since ${since}`);
  try {
    const rows = await adapter.listDeposits({ since, until: today });
    log(`  ${rows.length} Senate initiatives deposited in window`);

    let inserted = 0;
    for (const r of rows) {
      const record: NewInitiative = {
        source: "senado-sil",
        sourceId: r.idExpediente ?? r.code,
        kind: "LEGISLATIVE",
        code: r.code,
        title: r.title ?? `${r.type ?? "Iniciativa"} ${r.code}`,
        type: r.type,
        status: r.status,
        chamber: "SENADO",
        sourceCategory: null,
        filedAt: r.filedAt,
        sourceUrl: r.sourceUrl,
        raw: r as object,
      };
      const res = await upsertInitiative(db, record);
      if (res.inserted) inserted++;
    }

    await recordIngestionRun(db, {
      source: SENADO_DEPOSITS_SOURCE,
      seen: rows.length,
      inserted,
      ok: true,
      details: rows.length === 0 ? { gaps: [`Sin depósitos del Senado desde ${since}.`] } : null,
    });
    log(`  ✔ ${rows.length} Senate deposits (${inserted} new)`);
    return { source: SENADO_DEPOSITS_SOURCE, ok: true, windowFrom: since, deposits: rows.length, inserted, documents: 0, withDocUploaded: 0 };
  } catch (err) {
    const error = (err as Error).message;
    await recordIngestionRun(db, { source: SENADO_DEPOSITS_SOURCE, ok: false, error });
    log(`  ✖ FAILED: ${error}`);
    return { source: SENADO_DEPOSITS_SOURCE, ok: false, windowFrom: since, deposits: 0, inserted: 0, documents: 0, withDocUploaded: 0, error };
  }
}
