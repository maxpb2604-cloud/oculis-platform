/** Factual deposit ingestion for both chambers. */
import {
  beginIngestionRun,
  getInitiativeRawBySourceId,
  listVerifiedSenateFichaSourceIds,
  recordIngestionRun,
  reconcileStatusHistorySnapshot,
  upsertDocument,
  upsertInitiative,
  type Database,
  type NewInitiative,
} from "@oculis/db";
import {
  dominicanTodayISO,
  extractLeadingISODate,
  mapSilInitiative,
  SilDiputadosAdapter,
  SenadoSilAdapter,
  type SenadoExpediente,
  type SenadoFichaFacts,
  type RawInitiative,
  type SilDocumento,
  type SilIniciativa,
} from "@oculis/scrapers";
import { mergeObservedSourceRaw, persistInitiativeEvidence, toInitiativeRow } from "./ingest.js";

export const DEPOSITS_SOURCE = "sil-deposits";
export const SENADO_DEPOSITS_SOURCE = "senado-sil-deposits";
export const SENADO_CORPUS_SOURCE = "senado-sil-corpus";
export const SENADO_FICHAS_SOURCE = "senado-sil-fichas";

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
  coverageNotes: string[];
  error?: string;
}

function shiftISO(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ingestionToday(explicitToday?: string): string {
  const today =
    explicitToday === undefined ? dominicanTodayISO() : extractLeadingISODate(explicitToday);
  if (!today) throw new Error("today must begin with a valid ISO date");
  return today;
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

/** Add the independently observed document collection without discarding enrichment raw. */
function withObservedDocuments(
  raw: RawInitiative,
  documents: SilDocumento[],
  observedAt: string,
): RawInitiative {
  const evidence =
    raw.raw && typeof raw.raw === "object"
      ? (raw.raw as {
          payload?: Record<string, unknown>;
          provenance?: Record<string, unknown> & {
            endpoints?: unknown;
            observedCollections?: unknown;
            collectionObservedAt?: unknown;
          };
        })
      : {};
  const endpoints = Array.isArray(evidence.provenance?.endpoints)
    ? evidence.provenance.endpoints.filter((item): item is string => typeof item === "string")
    : [];
  const observedCollections = Array.isArray(evidence.provenance?.observedCollections)
    ? evidence.provenance.observedCollections.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const collectionObservedAt =
    evidence.provenance?.collectionObservedAt &&
    typeof evidence.provenance.collectionObservedAt === "object" &&
    !Array.isArray(evidence.provenance.collectionObservedAt)
      ? (evidence.provenance.collectionObservedAt as Record<string, unknown>)
      : {};
  return {
    ...raw,
    raw: {
      ...evidence,
      payload: { ...(evidence.payload ?? {}), documentos: documents },
      provenance: {
        ...(evidence.provenance ?? {}),
        endpoints: [...new Set([...endpoints, "iniciativa/documentos"])],
        observedCollections: [...new Set([...observedCollections, "documentos"])],
        collectionObservedAt: { ...collectionObservedAt, documentos: observedAt },
      },
    },
  };
}

export async function ingestDeposits(
  db: Database,
  opts: {
    sinceDays?: number;
    today?: string;
    maxPagesPerSlice?: number;
    delayMs?: number;
    log?: (message: string) => void;
    /** Clock seam; one ISO timestamp is reused by all successful collections in this run. */
    now?: () => Date;
  } = {},
): Promise<DepositsSummary> {
  const log = opts.log ?? (() => {});
  const today = ingestionToday(opts.today);
  const since = shiftISO(today, -(opts.sinceDays ?? 21));
  const maxPagesPerSlice = opts.maxPagesPerSlice ?? 4;
  const delayMs = opts.delayMs ?? 100;
  const runObservedAt = (opts.now ?? (() => new Date()))().toISOString();
  const adapter = new SilDiputadosAdapter();

  log(`\n▶ ${DEPOSITS_SOURCE} — deposits ${since}..${today}`);
  const runId = await beginIngestionRun(db, DEPOSITS_SOURCE, {
    interval: { since, until: today },
  });
  try {
    const scan = await recentDeposits(adapter, since, maxPagesPerSlice);
    const deposits = scan.rows;
    const gaps: string[] = [];
    const coverageNotes: string[] = [];
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
    const rejected = 0;
    let missingTitles = 0;
    const missingTitleIds: string[] = [];
    const failureExamples: string[] = [];

    for (const deposit of deposits) {
      const sourceId = String(deposit.id);
      const title = deposit.descripcion?.trim() ?? "";
      if (!title) {
        missingTitles++;
        if (missingTitleIds.length < 10) missingTitleIds.push(sourceId);
      }

      const base = mapSilInitiative(deposit);
      let raw = base;
      let observed = {
        detail: false,
        proponentes: false,
        historicos: false,
        comisiones: false,
        actividades: false,
        votaciones: false,
      };
      let docs: SilDocumento[] = [];
      const [enrichmentResult, documentsResult] = await Promise.allSettled([
        adapter.enrichObserved(base),
        adapter.documentos(sourceId),
      ]);
      if (enrichmentResult.status === "fulfilled") {
        raw = enrichmentResult.value.initiative;
        observed = enrichmentResult.value.observed;
        for (const failure of enrichmentResult.value.failures) {
          failures++;
          if (failureExamples.length < 10) {
            failureExamples.push(`${sourceId}/${failure.collection}: ${failure.message}`);
          }
        }
      } else {
        failures++;
        if (failureExamples.length < 10) {
          failureExamples.push(`${sourceId}/detail+collections: ${enrichmentResult.reason}`);
        }
      }
      const documentsObserved = documentsResult.status === "fulfilled";
      if (documentsObserved) {
        docs = documentsResult.value;
        raw = withObservedDocuments(raw, docs, runObservedAt);
      } else {
        failures++;
        if (failureExamples.length < 10) {
          failureExamples.push(`${sourceId}/documentos: ${documentsResult.reason}`);
        }
      }

      const previousRaw = await getInitiativeRawBySourceId(db, base.source, base.sourceId);
      raw = { ...raw, raw: mergeObservedSourceRaw(previousRaw, raw.raw) };
      const record = toInitiativeRow(raw, {
        detailFieldsObserved: observed.detail,
        proponentsObserved: observed.proponentes,
        commissionsObserved: observed.comisiones,
        rawObserved: true,
      });
      const result = await upsertInitiative(db, record);
      if (result.inserted) inserted++;
      else updated++;
      const { historyInserted } = await persistInitiativeEvidence(db, result.id, raw, {
        historyObserved: observed.historicos,
        commissionsObserved: observed.comisiones,
      });
      statusChanges += historyInserted;
      if (result.statusChanged && historyInserted === 0) statusChanges++;

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
          raw: doc,
        });
        if (isNew) documents++;
      }
      if (anyUploaded) withDocUploaded++;
      if (delayMs) await sleep(delayMs);
    }

    // Request failures and truncated pages are execution gaps. A source-owned absent
    // field remains visible without changing the outcome of a complete traversal.
    if (missingTitles > 0) {
      coverageNotes.push(
        `${missingTitles} fila(s) sin título oficial fueron conservadas como «No informado» (${missingTitleIds.join(", ")}).`,
      );
    }
    if (failures > 0) {
      gaps.push(`${failures} solicitud(es) oficiales de enriquecimiento fallaron.`);
    }
    const ok = failures === 0;
    const outcome = gaps.length ? "PARTIAL" : "COMPLETE";
    const error = failures ? `${failures} official collection request(s) failed` : undefined;
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
      details: {
        interval: { since, until: today },
        failures,
        rejected,
        missingTitles,
        gaps,
        coverageNotes,
        failureExamples,
      },
    });
    gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    coverageNotes.forEach((note) => log(`    ℹ ${note}`));
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
      coverageNotes,
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

/** Pure factual mapping used by both the regular list sync and explicit Ficha enrichment. */
export function senateInitiativeRecord(
  row: SenadoExpediente,
  facts?: SenadoFichaFacts,
  opts: { preserveRawOnMissingFicha?: boolean } = {},
): NewInitiative {
  const title =
    facts?.title !== undefined ? (facts.title?.trim() ?? "") : (row.title?.trim() ?? "");
  const sourceUrl = row.sourceUrl;
  return {
    source: "senado-sil",
    sourceId: row.idExpediente ?? row.code,
    kind: "LEGISLATIVE",
    code: row.code,
    title,
    type: facts?.type !== undefined ? facts.type : row.type?.trim() || null,
    status: facts?.currentStatus ?? (row.status?.trim() || null),
    chamber: "SENADO",
    sourceChamber: "SENADO",
    // Cámara Inicial is the only explicit chamber position on the Ficha. There is no
    // current-chamber field, so currentChamber/currentBody intentionally stay absent.
    originChamber: facts?.originChamber,
    condition: facts?.condition,
    sourceCategory: null,
    subjectMatter: facts?.subjectMatter,
    category: null,
    sponsor: facts?.proponents,
    committee: facts?.commissions,
    filedAt: row.filedAt,
    expiresAt: facts?.expiresAt,
    initiated: facts?.legislatureCountingStarted,
    initiatedAt: facts?.legislatureCountingStartedAt,
    legislature: facts?.legislature,
    promulgationNumber: facts?.promulgationNumber,
    promulgatedAt: facts?.promulgatedAt,
    sourceUrl,
    raw:
      opts.preserveRawOnMissingFicha && !facts
        ? undefined
        : {
            payload: facts ? { list: row, ficha: facts } : { list: row },
            provenance: {
              sourceUrl,
              endpoints: facts
                ? ["wfilemaster/lista_expedientes.aspx", "wfilemaster/Ficha.aspx"]
                : ["wfilemaster/lista_expedientes.aspx"],
              explicitStatus: facts ? "lbEstadoActual" : "list column 5",
              ...(facts
                ? {
                    fieldMapping:
                      "visible Spanish label + stable ASP.NET control id; rawFields retained",
                  }
                : {}),
            },
          },
  };
}

export async function ingestSenateDeposits(
  db: Database,
  opts: {
    sinceDays?: number;
    today?: string;
    /** Read the complete configured legislative collection instead of a date window. */
    fullCollection?: boolean;
    /** Explicitly fetch authenticated official Fichas after the stable list scan. */
    enrichFichas?: boolean;
    /** Optional processing cap for an operator-controlled/resumable enrichment run. */
    limit?: number;
    fichaBatchSize?: number;
    fichaDelayMs?: number;
    fichaBatchCooldownMs?: number;
    fichaBatchTimeoutMs?: number;
    /** Skip source IDs whose prior raw payload already contains a verified Ficha. */
    resumeFichas?: boolean;
    log?: (message: string) => void;
  } = {},
): Promise<DepositsSummary> {
  const log = opts.log ?? (() => {});
  const today = ingestionToday(opts.today);
  const since = opts.fullCollection ? null : shiftISO(today, -(opts.sinceDays ?? 21));
  const source = opts.enrichFichas
    ? SENADO_FICHAS_SOURCE
    : opts.fullCollection
      ? SENADO_CORPUS_SOURCE
      : SENADO_DEPOSITS_SOURCE;
  const adapter = new SenadoSilAdapter();
  const batchSize = opts.fichaBatchSize ?? 50;
  const fichaDelayMs = opts.fichaDelayMs ?? 150;
  const fichaBatchCooldownMs = opts.fichaBatchCooldownMs ?? 0;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("fichaBatchSize must be an integer between 1 and 100");
  }
  if (!Number.isInteger(fichaDelayMs) || fichaDelayMs < 0 || fichaDelayMs > 10_000) {
    throw new Error("fichaDelayMs must be an integer between 0 and 10000");
  }
  if (
    !Number.isInteger(fichaBatchCooldownMs) ||
    fichaBatchCooldownMs < 0 ||
    fichaBatchCooldownMs > 10 * 60_000
  ) {
    throw new Error("fichaBatchCooldownMs must be an integer between 0 and 600000");
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error("limit must be a positive integer");
  }

  log(
    `\n▶ ${source} — ${since ? `${since}..${today}` : "complete configured collection"}` +
      `${opts.enrichFichas ? " + official Ficha facts" : ""}`,
  );
  const runId = await beginIngestionRun(db, source, {
    interval: since ? { since, until: today } : null,
    collection: opts.fullCollection ? "FULL_CONFIGURED_COLLECTION" : "DATE_WINDOW",
    mode: opts.enrichFichas ? "EXPLICIT_FICHA_ENRICHMENT" : "LIST_ONLY",
  });
  try {
    const listedRows = await adapter.listDeposits(since ? { since, until: today } : {});
    const verifiedSourceIds = opts.resumeFichas
      ? new Set(await listVerifiedSenateFichaSourceIds(db))
      : new Set<string>();
    const resumableRows = opts.resumeFichas
      ? listedRows.filter((row) => !verifiedSourceIds.has(row.idExpediente ?? row.code))
      : listedRows;
    const skippedExisting = listedRows.length - resumableRows.length;
    const rows = opts.limit ? resumableRows.slice(0, opts.limit) : resumableRows;
    const gaps: string[] = [];
    const coverageNotes: string[] = [];
    if (listedRows.length === 0) {
      gaps.push(
        since
          ? `La fuente devolvió 0 depósitos en el intervalo ${since}..${today}.`
          : "La fuente devolvió 0 iniciativas para la colección configurada.",
      );
    }
    if (opts.limit !== undefined && rows.length < resumableRows.length) {
      gaps.push(
        `Límite operativo: se procesaron ${rows.length} de ${resumableRows.length} filas pendientes.`,
      );
    }

    let inserted = 0;
    let updated = 0;
    let statusChanges = 0;
    let rejected = 0;
    let failures = 0;
    let factsFetched = 0;
    let historyInserted = 0;
    let incompleteHistories = 0;
    let proponentsObserved = 0;
    let commissionsObserved = 0;
    let originChambersObserved = 0;
    let missingTitles = 0;
    let truncatedTitles = 0;
    let processedRows = 0;
    let haltedRemaining = 0;
    const missingTitleCodes: string[] = [];
    const failureExamples: string[] = [];
    const rejectedExamples: string[] = [];
    const rejectedFichaIds = new Set<string>();

    const batches: SenadoExpediente[][] = [];
    for (
      let offset = 0;
      offset < rows.length;
      offset += opts.enrichFichas ? batchSize : rows.length || 1
    ) {
      batches.push(rows.slice(offset, offset + (opts.enrichFichas ? batchSize : rows.length || 1)));
    }
    for (const [batchIndex, batch] of batches.entries()) {
      if (batchIndex > 0 && opts.enrichFichas && fichaBatchCooldownMs > 0) {
        log(`    pausa de fuente ${fichaBatchCooldownMs}ms antes del lote ${batchIndex + 1}`);
        await new Promise((resolve) => setTimeout(resolve, fichaBatchCooldownMs));
      }
      const factsById = new Map<string, SenadoFichaFacts>();
      let haltAfterBatch = false;
      if (opts.enrichFichas) {
        const eligible = batch.filter((row) => row.idExpediente);
        for (const row of batch) {
          if (!row.idExpediente) {
            failures++;
            if (failureExamples.length < 20) {
              failureExamples.push(`${row.code}: missing IdExpediente on official list row`);
            }
          }
        }
        try {
          const fetched = await adapter.fetchFichaFactsBatch(
            eligible.map((row) => ({
              idExpediente: row.idExpediente!,
              expectedCode: row.code,
            })),
            {
              delayMs: fichaDelayMs,
              totalTimeoutMs: opts.fichaBatchTimeoutMs ?? 10 * 60_000,
            },
          );
          for (const record of fetched.records) {
            factsById.set(record.idExpediente, record.facts);
          }
          factsFetched += fetched.records.length;
          let batchOperationalFailures = 0;
          for (const failure of fetched.failures) {
            if (failure.classification === "SOURCE_IDENTITY_MISMATCH") {
              rejected++;
              rejectedFichaIds.add(failure.idExpediente);
              if (rejectedExamples.length < 20) {
                rejectedExamples.push(
                  `${failure.idExpediente}: lista ${failure.expectedCode}; Ficha ${failure.observedCode}`,
                );
              }
            } else {
              failures++;
              batchOperationalFailures++;
              if (failureExamples.length < 20) {
                failureExamples.push(`${failure.idExpediente}: ${failure.error}`);
              }
            }
          }
          // A whole batch failing at once is an upstream/session outage, not dozens of
          // independent missing facts. Stop at this checkpoint instead of hammering all
          // remaining Fichas; `--resume` can safely continue after cooldown.
          if (eligible.length > 0 && batchOperationalFailures === eligible.length) {
            haltAfterBatch = true;
          }
        } catch (error) {
          failures += eligible.length;
          if (failureExamples.length < 20) {
            failureExamples.push(
              `batch ${batchIndex + 1}/${batches.length}: ${(error as Error).message}`,
            );
          }
          haltAfterBatch = true;
        }
        log(
          `    fichas ${Math.min((batchIndex + 1) * batchSize, rows.length)}/${rows.length} — ` +
            `${factsFetched} verificadas, ${rejected} rechazadas, ${failures} fallidas`,
        );
      }

      for (const row of batch) {
        // A list↔Ficha identity contradiction is not a trustworthy observation of
        // either initiative. Do not insert the row or replace any prior snapshot.
        if (row.idExpediente && rejectedFichaIds.has(row.idExpediente)) continue;
        const facts = row.idExpediente ? factsById.get(row.idExpediente) : undefined;
        const record = senateInitiativeRecord(row, facts, {
          // In explicit mode, a failed detail fetch is "not observed". Do not erase raw
          // Ficha evidence that a prior successful run may have persisted.
          preserveRawOnMissingFicha: opts.enrichFichas,
        });
        if (!record.title) {
          missingTitles++;
          if (missingTitleCodes.length < 10) missingTitleCodes.push(row.code);
        }
        if (record.title.endsWith("...")) truncatedTitles++;
        if (facts?.proponents !== undefined) proponentsObserved++;
        if (facts?.commissions !== undefined) commissionsObserved++;
        if (facts?.originChamber !== undefined) originChambersObserved++;
        if (facts && !facts.historyParseComplete) incompleteHistories++;

        const result = await upsertInitiative(db, record, {
          // The list is an index, not a replacement for a verified Ficha. Its title is
          // frequently abbreviated (or blank), and its raw payload has no detail fields.
          // Keep prior Ficha facts atomically while still refreshing this list snapshot.
          preserveVerifiedSenateFicha: !facts,
        });
        if (result.inserted) inserted++;
        else updated++;
        if (result.statusChanged) statusChanges++;
        if (facts?.historyParseComplete && facts.history.length) {
          const reconciled = await reconcileStatusHistorySnapshot(
            db,
            result.id,
            adapter.source,
            facts.history.map((event) => ({
              sourceEventId: null,
              status: event.status,
              date: event.date,
              endDate: null,
              note: null,
              source: adapter.source,
              sourceUrl: row.sourceUrl,
              evidenceType: "SOURCE_HISTORY",
              raw: {
                idExpediente: row.idExpediente,
                controlId: "campos_nota_631",
                label: "Historial",
                literal: event.literal,
              },
            })),
            { complete: true },
          );
          historyInserted += reconciled.inserted;
        }
      }
      processedRows += batch.length;
      if (haltAfterBatch) {
        haltedRemaining = rows.length - processedRows;
        if (haltedRemaining > 0) {
          gaps.push(
            `El enriquecimiento se detuvo tras un lote completamente fallido; ${haltedRemaining} Ficha(s) quedaron pendientes para --resume.`,
          );
        }
        break;
      }
    }

    if (missingTitles) {
      coverageNotes.push(
        `${missingTitles} fila(s) sin título oficial fueron conservadas como «No informado»: ${missingTitleCodes.join(", ")}`,
      );
    }
    if (truncatedTitles) {
      coverageNotes.push(
        `${truncatedTitles} título(s) aún terminan en "..."; se conservaron literalmente y no se completaron por inferencia.`,
      );
    }
    if (incompleteHistories) {
      coverageNotes.push(
        `${incompleteHistories} Historial(es) conservaron su literal, pero no se emitieron eventos parciales porque el formato completo no fue inequívoco.`,
      );
    }
    if (rejected) {
      coverageNotes.push(
        `${rejected} Ficha(s) contradijeron el código/identidad de su fila oficial y no se ingirieron ni reemplazaron evidencia previa: ${rejectedExamples.join(", ")}`,
      );
    }
    if (failures) gaps.push(`${failures} Ficha(s) oficiales no pudieron verificarse.`);
    const collectionEmpty = opts.fullCollection === true && listedRows.length === 0;
    const ok = !collectionEmpty && failures === 0 && haltedRemaining === 0;
    const outcome = collectionEmpty ? "FAILED" : gaps.length ? "PARTIAL" : "COMPLETE";
    const error = collectionEmpty
      ? "complete configured collection returned zero initiatives"
      : failures
        ? `${failures} official Ficha request(s) failed`
        : haltedRemaining
          ? `${haltedRemaining} official Ficha request(s) remain after upstream outage`
          : undefined;
    await recordIngestionRun(db, {
      source,
      runId,
      seen: processedRows,
      inserted,
      updated,
      statusChanges,
      ok,
      outcome,
      error,
      details: {
        interval: since ? { since, until: today } : null,
        collection: opts.fullCollection ? "FULL_CONFIGURED_COLLECTION" : "DATE_WINDOW",
        mode: opts.enrichFichas ? "EXPLICIT_FICHA_ENRICHMENT" : "LIST_ONLY",
        listed: listedRows.length,
        processed: processedRows,
        skippedExisting,
        haltedRemaining,
        rejected,
        failures,
        factsFetched,
        historyInserted,
        incompleteHistories,
        proponentsObserved,
        commissionsObserved,
        originChambersObserved,
        missingTitles,
        truncatedTitles,
        gaps,
        coverageNotes,
        failureExamples,
        rejectedExamples,
      },
    });
    gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    coverageNotes.forEach((note) => log(`    ℹ ${note}`));
    return {
      source,
      ok,
      outcome,
      windowFrom: since,
      deposits: processedRows,
      inserted,
      updated,
      statusChanges,
      documents: 0,
      withDocUploaded: 0,
      failures,
      rejected,
      gaps,
      coverageNotes,
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
    coverageNotes: [],
    error,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
