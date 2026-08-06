/** Factual deposit ingestion for both chambers. */
import {
  beginIngestionRun,
  recordIngestionRun,
  upsertDocument,
  upsertInitiative,
  type Database,
  type NewInitiative,
} from "@oculis/db";
import {
  extractLeadingISODate,
  SilDiputadosAdapter,
  SenadoSilAdapter,
  proponenteName,
  type SilDocumento,
  type SilIniciativa,
} from "@oculis/scrapers";

export const DEPOSITS_SOURCE = "sil-deposits";
export const SENADO_DEPOSITS_SOURCE = "senado-sil-deposits";
export const SENADO_CORPUS_SOURCE = "senado-sil-corpus";

export interface DepositsSummary {
  source: string;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  windowFrom: string | null;
  deposits: number;
  inserted: number;
  updated: number;
  statusChanges: number;
  documents: number;
  withDocUploaded: number;
  failures: number;
  rejected: number;
  gaps: string[];
  error?: string;
}

function shiftISO(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function recentDeposits(
  adapter: SilDiputadosAdapter,
  since: string,
  maxPagesPerSlice: number,
): Promise<{ rows: SilIniciativa[]; truncatedSlices: number }> {
  const groups = await adapter.groups();
  const seen = new Map<number, SilIniciativa>();
  let truncatedSlices = 0;
  for (const group of groups) {
    for (const type of [true, false]) {
      let exhausted = false;
      for (let page = 1; page <= maxPagesPerSlice; page++) {
        const envelope = await adapter.listPage(group.id, type, page);
        const rows = envelope.results;
        if (rows.length === 0) {
          exhausted = true;
          break;
        }
        let anyInWindow = false;
        for (const row of rows) {
          const day = extractLeadingISODate(row.fechaDeposito);
          if (day && day >= since) {
            anyInWindow = true;
            seen.set(row.id, row);
          }
        }
        const lastDay = extractLeadingISODate(rows[rows.length - 1]?.fechaDeposito);
        if (!anyInWindow || (lastDay && lastDay < since)) {
          exhausted = true;
          break;
        }
        if (page * envelope.pageSize >= envelope.total) {
          exhausted = true;
          break;
        }
      }
      if (!exhausted) truncatedSlices++;
    }
  }
  return { rows: [...seen.values()], truncatedSlices };
}

export async function ingestDeposits(
  db: Database,
  opts: {
    sinceDays?: number;
    today?: string;
    maxPagesPerSlice?: number;
    delayMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<DepositsSummary> {
  const log = opts.log ?? (() => {});
  const today = extractLeadingISODate(opts.today ?? new Date().toISOString());
  if (!today) throw new Error("today must begin with a valid ISO date");
  const since = shiftISO(today, -(opts.sinceDays ?? 21));
  const maxPagesPerSlice = opts.maxPagesPerSlice ?? 4;
  const delayMs = opts.delayMs ?? 100;
  const adapter = new SilDiputadosAdapter();

  log(`\n▶ ${DEPOSITS_SOURCE} — deposits ${since}..${today}`);
  const runId = await beginIngestionRun(db, DEPOSITS_SOURCE, {
    interval: { since, until: today },
  });
  try {
    const scan = await recentDeposits(adapter, since, maxPagesPerSlice);
    const deposits = scan.rows;
    const gaps: string[] = [];
    if (deposits.length === 0) {
      gaps.push(`La fuente devolvió 0 depósitos en el intervalo ${since}..${today}.`);
    }
    if (scan.truncatedSlices) {
      gaps.push(
        `${scan.truncatedSlices} segmento(s) alcanzaron el límite de ${maxPagesPerSlice} páginas antes de salir del intervalo.`,
      );
    }

    let inserted = 0;
    let updated = 0;
    let statusChanges = 0;
    let documents = 0;
    let withDocUploaded = 0;
    let failures = 0;
    let rejected = 0;
    const failureExamples: string[] = [];

    for (const deposit of deposits) {
      const sourceId = String(deposit.id);
      const title = deposit.descripcion?.trim() ?? "";
      if (!title) {
        rejected++;
        if (failureExamples.length < 10)
          failureExamples.push(`${sourceId}: missing official title`);
        continue;
      }

      let proponents: Awaited<ReturnType<typeof adapter.proponentes>> = [];
      let docs: SilDocumento[] = [];
      const [proponentsResult, documentsResult] = await Promise.allSettled([
        adapter.proponentes(sourceId),
        adapter.documentos(sourceId),
      ]);
      const proponentsObserved = proponentsResult.status === "fulfilled";
      if (proponentsObserved) proponents = proponentsResult.value;
      else {
        failures++;
        if (failureExamples.length < 10) {
          failureExamples.push(`${sourceId}/proponentes: ${proponentsResult.reason}`);
        }
      }
      if (documentsResult.status === "fulfilled") docs = documentsResult.value;
      else {
        failures++;
        if (failureExamples.length < 10) {
          failureExamples.push(`${sourceId}/documentos: ${documentsResult.reason}`);
        }
      }

      const principal = proponents.find((proponent) => proponent.principal === true);
      const representation = principal?.representacion;
      const sourceUrl = `https://www.diputadosrd.gob.do/sil/iniciativa/${sourceId}`;
      const record: NewInitiative = {
        source: adapter.source,
        sourceId,
        kind: "LEGISLATIVE",
        code: deposit.numero?.trim() || null,
        title,
        type: deposit.tipo?.trim() || null,
        status: deposit.estado?.trim() || null,
        chamber: "DIPUTADOS",
        sourceCategory: deposit.grupo?.trim() || deposit.materia?.trim() || null,
        category: null,
        // A rejected/failed proponent request means "not observed in this run", not
        // "the source explicitly reports no sponsor". Undefined preserves prior facts.
        sponsor: proponentsObserved ? proponenteName(principal) : undefined,
        sponsorRole: proponentsObserved ? representation?.funcion?.trim() || null : undefined,
        sponsorCount: proponentsObserved ? proponents.length || null : undefined,
        party: proponentsObserved
          ? representation?.partido?.siglas?.trim() ||
            representation?.partido?.nombre?.trim() ||
            null
          : undefined,
        province: proponentsObserved ? representation?.provincia?.trim() || null : undefined,
        filedAt: extractLeadingISODate(deposit.fechaDeposito),
        sourceUrl,
        raw: proponentsObserved
          ? {
              payload: { initiative: deposit, proponents },
              provenance: {
                sourceUrl,
                endpoints: [
                  "iniciativa/iniciativas",
                  "iniciativa/proponentes",
                  "iniciativa/documentos",
                ],
                explicitStatusField: "estado",
              },
            }
          : undefined,
      };
      const result = await upsertInitiative(db, record);
      if (result.inserted) inserted++;
      else updated++;
      if (result.statusChanged) statusChanges++;

      let anyUploaded = false;
      for (const doc of docs) {
        const uploadedAt = extractLeadingISODate(doc.cargado);
        if (uploadedAt) anyUploaded = true;
        const isNew = await upsertDocument(db, {
          source: adapter.source,
          initiativeId: result.id,
          initiativeCode: doc.documento?.trim() || deposit.numero?.trim() || null,
          docType: doc.descripcion?.trim() || null,
          extension: doc.extension?.trim() || null,
          url: adapter.documentUrl(doc.id),
          uploadedAt,
          sourceDocId: String(doc.id),
        });
        if (isNew) documents++;
      }
      if (anyUploaded) withDocUploaded++;
      if (delayMs) await sleep(delayMs);
    }

    // Request failures remain operational failures. Missing explicit fields and
    // truncated official slices remain visible as PARTIAL factual coverage.
    if (rejected > 0) {
      gaps.push(`${rejected} fila(s) sin título oficial fueron descartadas.`);
    }
    if (failures > 0) {
      gaps.push(`${failures} solicitud(es) oficiales de enriquecimiento fallaron.`);
    }
    const ok = failures === 0;
    const outcome =
      failures === 0 && rejected === 0 && scan.truncatedSlices === 0
        ? "COMPLETE"
        : "PARTIAL";
    const error = failures ? `${failures} enrichment request(s) failed` : undefined;
    await recordIngestionRun(db, {
      source: DEPOSITS_SOURCE,
      runId,
      seen: deposits.length,
      inserted,
      updated,
      statusChanges,
      ok,
      outcome,
      error,
      details: { interval: { since, until: today }, failures, rejected, gaps, failureExamples },
    });
    gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    return {
      source: DEPOSITS_SOURCE,
      ok,
      outcome,
      windowFrom: since,
      deposits: deposits.length,
      inserted,
      updated,
      statusChanges,
      documents,
      withDocUploaded,
      failures,
      rejected,
      gaps,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    const message = (error as Error).message;
    await recordIngestionRun(db, {
      runId,
      source: DEPOSITS_SOURCE,
      ok: false,
      error: message,
    });
    return failedDepositSummary(DEPOSITS_SOURCE, since, message);
  }
}

export async function ingestSenateDeposits(
  db: Database,
  opts: {
    sinceDays?: number;
    today?: string;
    /** Read the complete configured legislative collection instead of a date window. */
    fullCollection?: boolean;
    log?: (message: string) => void;
  } = {},
): Promise<DepositsSummary> {
  const log = opts.log ?? (() => {});
  const today = extractLeadingISODate(opts.today ?? new Date().toISOString());
  if (!today) throw new Error("today must begin with a valid ISO date");
  const since = opts.fullCollection ? null : shiftISO(today, -(opts.sinceDays ?? 21));
  const source = opts.fullCollection ? SENADO_CORPUS_SOURCE : SENADO_DEPOSITS_SOURCE;
  const adapter = new SenadoSilAdapter();

  log(`\n▶ ${source} — ${since ? `${since}..${today}` : "complete configured collection"}`);
  const runId = await beginIngestionRun(db, source, {
    interval: since ? { since, until: today } : null,
    collection: opts.fullCollection ? "FULL_CONFIGURED_COLLECTION" : "DATE_WINDOW",
  });
  try {
    const rows = await adapter.listDeposits(since ? { since, until: today } : {});
    const gaps: string[] = [];
    if (rows.length === 0) {
      gaps.push(
        since
          ? `La fuente devolvió 0 depósitos en el intervalo ${since}..${today}.`
          : "La fuente devolvió 0 iniciativas para la colección configurada.",
      );
    }
    const truncatedTitles = rows.filter((row) => row.title?.trim().endsWith("...")).length;
    if (truncatedTitles > 0) {
      gaps.push(
        `${truncatedTitles} título(s) terminan en "..." en el listado oficial del Senado; se conservaron literalmente y no se completaron por inferencia.`,
      );
    }

    let inserted = 0;
    let updated = 0;
    let statusChanges = 0;
    let rejected = 0;
    const rejectedCodes: string[] = [];
    for (const row of rows) {
      const title = row.title?.trim() ?? "";
      if (!title) {
        rejected++;
        if (rejectedCodes.length < 10) rejectedCodes.push(row.code);
        continue;
      }
      const record: NewInitiative = {
        source: adapter.source,
        sourceId: row.idExpediente ?? row.code,
        kind: "LEGISLATIVE",
        code: row.code,
        title,
        type: row.type?.trim() || null,
        status: row.status?.trim() || null,
        chamber: "SENADO",
        sourceCategory: null,
        category: null,
        filedAt: row.filedAt,
        sourceUrl: row.sourceUrl,
        raw: {
          payload: row,
          provenance: {
            sourceUrl: row.sourceUrl,
            endpoint: "wfilemaster/lista_expedientes.aspx",
            explicitStatusColumn: 5,
          },
        },
      };
      const result = await upsertInitiative(db, record);
      if (result.inserted) inserted++;
      else updated++;
      if (result.statusChanged) statusChanges++;
    }

    if (rejected) {
      gaps.push(
        `${rejected} fila(s) sin título oficial fueron descartadas: ${rejectedCodes.join(", ")}`,
      );
    }
    const collectionEmpty = opts.fullCollection === true && rows.length === 0;
    const ok = !collectionEmpty;
    const outcome = collectionEmpty ? "FAILED" : gaps.length ? "PARTIAL" : "COMPLETE";
    const error = collectionEmpty
      ? "complete configured collection returned zero initiatives"
      : undefined;
    await recordIngestionRun(db, {
      source,
      runId,
      seen: rows.length,
      inserted,
      updated,
      statusChanges,
      ok,
      outcome,
      error,
      details: {
        interval: since ? { since, until: today } : null,
        collection: opts.fullCollection ? "FULL_CONFIGURED_COLLECTION" : "DATE_WINDOW",
        rejected,
        truncatedTitles,
        gaps,
      },
    });
    gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    return {
      source,
      ok,
      outcome,
      windowFrom: since,
      deposits: rows.length,
      inserted,
      updated,
      statusChanges,
      documents: 0,
      withDocUploaded: 0,
      failures: 0,
      rejected,
      gaps,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    const message = (error as Error).message;
    await recordIngestionRun(db, { runId, source, ok: false, error: message });
    return failedDepositSummary(source, since, message);
  }
}

function failedDepositSummary(
  source: string,
  since: string | null,
  error: string,
): DepositsSummary {
  return {
    source,
    ok: false,
    outcome: "FAILED",
    windowFrom: since,
    deposits: 0,
    inserted: 0,
    updated: 0,
    statusChanges: 0,
    documents: 0,
    withDocUploaded: 0,
    failures: 1,
    rejected: 0,
    gaps: [],
    error,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
