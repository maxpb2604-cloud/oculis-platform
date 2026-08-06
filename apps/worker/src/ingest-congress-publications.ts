/**
 * Persist official congressional document collections without converting a document or
 * agenda appearance into a legislative conclusion. Only the Senate sections that
 * explicitly label initiatives as approved/perimidas create SOURCE_HISTORY events.
 */
import {
  beginIngestionRun,
  recordIngestionRun,
  recordStatusEvents,
  uniqueInitiativeIdByCode,
  upsertActivityEvent,
  upsertDocument,
  type Database,
} from "@oculis/db";
import {
  DipKnownAgendaAdapter,
  fetchPdfText,
  parseApprovedInitiativeMentions,
  parseExpiredInitiativeRecords,
  parseKnownAgendaPdf,
  parseSenadoAttendanceMeetingDates,
  parseSenadoReportReferences,
  SenadoPublicationsAdapter,
  SENADO_PUBLICATION_SOURCES,
  type KnownAgendaDocument,
  type SenadoPublicationKind,
  type SenadoPublishedDocument,
} from "@oculis/scrapers";

const DIP_SOURCE = "dip-known-agenda";

const SENATE_SOURCE_IDS: Record<SenadoPublicationKind, string> = {
  APPROVED_INITIATIVES: "sen-approved",
  EXPIRED_PROJECTS: "sen-expired",
  ELECTRONIC_VOTES: "sen-votes",
  COMMITTEE_ATTENDANCE: "sen-attendance",
  REPORTS_FOR_READING: "sen-reports",
};

export interface CongressPublicationSummary {
  source: string;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  seen: number;
  inserted: number;
  statusChanges: number;
  gaps: string[];
  error?: string;
}

interface PublicationIngestOptions {
  /** Parse this many recent PDFs per collection during the daily run. */
  pdfLimitPerSource?: number;
  /** Parse every approval/perención and known-agenda PDF. Metadata is always complete. */
  full?: boolean;
  log?: (message: string) => void;
}

function latestDate(...dates: Array<string | null>): string {
  return (
    dates
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1) ?? ""
  );
}

export function sortKnownDocuments(documents: KnownAgendaDocument[]): KnownAgendaDocument[] {
  return [...documents].sort((a, b) =>
    latestDate(b.modifiedDate, b.uploadedDate, b.sessionDate).localeCompare(
      latestDate(a.modifiedDate, a.uploadedDate, a.sessionDate),
    ),
  );
}

export function sortSenateDocuments(
  documents: SenadoPublishedDocument[],
): SenadoPublishedDocument[] {
  return [...documents].sort((a, b) =>
    latestDate(b.modifiedOn, b.addedOn).localeCompare(latestDate(a.modifiedOn, a.addedOn)),
  );
}

function senateDocumentUrl(document: SenadoPublishedDocument): string {
  return document.downloadUrl ?? document.viewerUrl ?? document.directDownloadUrl;
}

async function persistDocument(
  db: Database,
  data: {
    source: string;
    sourceDocId: string;
    initiativeCode?: string | null;
    initiativeId?: number | null;
    title: string;
    extension: string;
    url: string;
    uploadedAt: string | null;
    modifiedAt?: string | null;
    sourceCategory?: string | null;
    sourceFragment?: string | null;
    raw?: unknown;
  },
): Promise<boolean> {
  return upsertDocument(db, {
    source: data.source,
    sourceDocId: data.sourceDocId,
    initiativeCode: data.initiativeCode ?? null,
    initiativeId: data.initiativeId ?? null,
    docType: data.title,
    extension: data.extension,
    url: data.url,
    uploadedAt: data.uploadedAt,
    modifiedAt: data.modifiedAt ?? null,
    sourceCategory: data.sourceCategory ?? null,
    sourceFragment: data.sourceFragment ?? null,
    raw: (data.raw ?? null) as object | null,
  });
}

async function ingestKnownAgenda(
  db: Database,
  options: Required<Pick<PublicationIngestOptions, "pdfLimitPerSource" | "full">> & {
    log: (message: string) => void;
  },
): Promise<CongressPublicationSummary> {
  const runId = await beginIngestionRun(db, DIP_SOURCE, {
    pdfMode: options.full ? "ALL" : "RECENT_SLICE",
    pdfLimitPerSource: options.full ? null : options.pdfLimitPerSource,
  });
  const adapter = new DipKnownAgendaAdapter();
  const gaps: string[] = [];
  let seen = 0;
  let inserted = 0;
  let parsedPdfs = 0;
  let activityInserted = 0;
  const unmatchedCodes = new Set<string>();
  try {
    const catalog = await adapter.catalog();
    const documents: KnownAgendaDocument[] = [];
    for (const category of catalog.categories) {
      try {
        documents.push(...(await adapter.documentsInCategory(category)));
      } catch (error) {
        gaps.push(`Cámara · ${category.title}: ${(error as Error).message}`);
      }
    }
    const declaredDocuments = catalog.categories.reduce((sum, category) => sum + category.count, 0);
    if (documents.length !== declaredDocuments) {
      gaps.push(
        `Cámara · catálogo conocido: ${documents.length} de ${declaredDocuments} documento(s) reconciliados.`,
      );
    }
    seen = documents.length;
    for (const document of documents) {
      if (
        await persistDocument(db, {
          source: DIP_SOURCE,
          sourceDocId: document.sourceId,
          title: document.title,
          extension: document.extension,
          url: document.downloadUrl,
          uploadedAt: document.uploadedDate,
          modifiedAt: document.modifiedDate,
          sourceCategory: document.categoryTitle,
          raw: document.raw,
        })
      ) {
        inserted++;
      }
    }

    const ordered = sortKnownDocuments(documents);
    const targets = options.full ? ordered : ordered.slice(0, options.pdfLimitPerSource);
    for (const document of targets) {
      try {
        const { text } = await fetchPdfText(document.downloadUrl);
        const { initiativeCodes, mentions } = parseKnownAgendaPdf(text);
        parsedPdfs++;
        for (const mention of mentions) {
          const initiativeId = await uniqueInitiativeIdByCode(db, mention.code, "DIPUTADOS");
          if (!initiativeId) {
            unmatchedCodes.add(mention.code);
          }
          if (
            await persistDocument(db, {
              source: DIP_SOURCE,
              sourceDocId: `${document.sourceId}:${mention.code}`,
              initiativeCode: mention.code,
              initiativeId,
              title: document.title,
              extension: document.extension,
              url: document.downloadUrl,
              uploadedAt: document.uploadedDate,
              modifiedAt: document.modifiedDate,
              sourceCategory: document.categoryTitle,
              sourceFragment: mention.rawText,
              raw: { document: document.raw, mention },
            })
          ) {
            inserted++;
          }
        }
        const activity = await upsertActivityEvent(db, {
          source: DIP_SOURCE,
          scope: "PLENARY",
          chamber: "DIPUTADOS",
          agendaUrl: document.downloadUrl,
          date: document.sessionDate,
          time: null,
          kind: document.sectionTitle,
          body: "Pleno",
          description: document.title,
          statuses: [],
          initiativeCodes,
          dedupeKey: `document:${document.sourceId}`,
          raw: document.raw,
        });
        if (activity.inserted) activityInserted++;
      } catch (error) {
        gaps.push(`Cámara · documento ${document.sourceId}: ${(error as Error).message}`);
      }
    }

    if (unmatchedCodes.size > 0) {
      gaps.push(
        `Cámara · ${unmatchedCodes.size} código(s) exacto(s) no identificaron un PDL único del corpus de Diputados.`,
      );
    }

    const outcome = gaps.length ? "PARTIAL" : "COMPLETE";
    await recordIngestionRun(db, {
      runId,
      source: DIP_SOURCE,
      seen,
      inserted: inserted + activityInserted,
      ok: outcome === "COMPLETE",
      outcome,
      details: {
        categories: catalog.categories.length,
        documents: documents.length,
        parsedPdfs,
        activityInserted,
        unmatchedCodes: unmatchedCodes.size,
        unmatchedCodeExamples: [...unmatchedCodes].slice(0, 50),
        pdfMode: options.full ? "ALL" : "RECENT_SLICE",
        gaps,
      },
    });
    options.log(
      `  ${outcome === "COMPLETE" ? "✔" : "⚠"} ${DIP_SOURCE}: ${documents.length} documento(s), ${parsedPdfs} PDF leídos`,
    );
    return {
      source: DIP_SOURCE,
      ok: outcome === "COMPLETE",
      outcome,
      seen,
      inserted: inserted + activityInserted,
      statusChanges: 0,
      gaps,
    };
  } catch (error) {
    const message = (error as Error).message;
    await recordIngestionRun(db, {
      runId,
      source: DIP_SOURCE,
      seen,
      inserted,
      ok: false,
      error: message,
      details: { parsedPdfs, gaps },
    });
    return {
      source: DIP_SOURCE,
      ok: false,
      outcome: "FAILED",
      seen,
      inserted,
      statusChanges: 0,
      gaps,
      error: message,
    };
  }
}

async function recordSenateStatus(
  db: Database,
  data: {
    source: string;
    initiativeId: number;
    status: string;
    date: string | null;
    sourceUrl: string;
    raw: unknown;
  },
): Promise<"INSERTED" | "EXISTING"> {
  const inserted = await recordStatusEvents(db, data.initiativeId, [
    {
      status: data.status,
      date: data.date,
      note: null,
      source: data.source,
      sourceUrl: data.sourceUrl,
      evidenceType: "SOURCE_HISTORY",
      raw: data.raw,
    },
  ]);
  return inserted ? "INSERTED" : "EXISTING";
}

async function ingestSenateKind(
  db: Database,
  adapter: SenadoPublicationsAdapter,
  kind: SenadoPublicationKind,
  options: Required<Pick<PublicationIngestOptions, "pdfLimitPerSource" | "full">> & {
    log: (message: string) => void;
  },
): Promise<CongressPublicationSummary> {
  const source = SENATE_SOURCE_IDS[kind];
  const registry = SENADO_PUBLICATION_SOURCES.find((candidate) => candidate.kind === kind)!;
  const runId = await beginIngestionRun(db, source, {
    publicationKind: kind,
    pdfMode: options.full ? "FULL_DECLARED_COLLECTIONS" : "RECENT_SLICE",
  });
  const gaps: string[] = [];
  let seen = 0;
  let inserted = 0;
  let statusChanges = 0;
  let parsedPdfs = 0;
  let activityInserted = 0;
  const unmatchedCodes = new Set<string>();
  let explicitMeetingDates = 0;
  let partialReferences = 0;
  try {
    const collected = await adapter.collect({ kinds: [kind] });
    const observation = collected.observations[0] ?? null;
    seen = collected.documents.length;
    gaps.push(...collected.gaps);
    for (const document of collected.documents) {
      if (
        await persistDocument(db, {
          source,
          sourceDocId: String(document.fileId),
          title: document.title,
          extension: document.extension,
          url: senateDocumentUrl(document),
          uploadedAt: document.addedOn,
          modifiedAt: document.modifiedOn,
          sourceCategory: registry.label,
          raw: document.raw,
        })
      ) {
        inserted++;
      }
    }

    const ordered = sortSenateDocuments(collected.documents);
    const parseEntireCollection =
      options.full &&
      (kind === "APPROVED_INITIATIVES" ||
        kind === "EXPIRED_PROJECTS" ||
        kind === "COMMITTEE_ATTENDANCE");
    const targets = parseEntireCollection ? ordered : ordered.slice(0, options.pdfLimitPerSource);
    if (kind !== "ELECTRONIC_VOTES") {
      for (const document of targets) {
        try {
          const { text } = await adapter.fetchDocumentText(document);
          parsedPdfs++;
          const url = senateDocumentUrl(document);
          if (kind === "APPROVED_INITIATIVES") {
            for (const mention of parseApprovedInitiativeMentions(text)) {
              const initiativeId = await uniqueInitiativeIdByCode(db, mention.code, "SENADO");
              if (
                await persistDocument(db, {
                  source,
                  sourceDocId: `${document.fileId}:${mention.code}`,
                  initiativeCode: mention.code,
                  initiativeId,
                  title: document.title,
                  extension: document.extension,
                  url,
                  uploadedAt: document.addedOn,
                  modifiedAt: document.modifiedOn,
                  sourceCategory: registry.label,
                  sourceFragment: mention.rawText,
                  raw: { document: document.raw, mention: mention.rawText },
                })
              ) {
                inserted++;
              }
              if (!initiativeId) {
                unmatchedCodes.add(mention.code);
              } else {
                const result = await recordSenateStatus(db, {
                  source,
                  initiativeId,
                  status: registry.label,
                  date: null,
                  sourceUrl: url,
                  raw: { document: document.raw, mention: mention.rawText },
                });
                if (result === "INSERTED") statusChanges++;
              }
            }
          } else if (kind === "EXPIRED_PROJECTS") {
            for (const record of parseExpiredInitiativeRecords(text)) {
              const initiativeId = await uniqueInitiativeIdByCode(db, record.code, "SENADO");
              if (
                await persistDocument(db, {
                  source,
                  sourceDocId: `${document.fileId}:${record.code}`,
                  initiativeCode: record.code,
                  initiativeId,
                  title: document.title,
                  extension: document.extension,
                  url,
                  uploadedAt: document.addedOn,
                  modifiedAt: document.modifiedOn,
                  sourceCategory: registry.label,
                  sourceFragment: record.rawText,
                  raw: { document: document.raw, record },
                })
              ) {
                inserted++;
              }
              if (!initiativeId) {
                unmatchedCodes.add(record.code);
              } else {
                const result = await recordSenateStatus(db, {
                  source,
                  initiativeId,
                  status: record.expiredOnRaw ? "Perimida" : registry.label,
                  date: record.expiredOn,
                  sourceUrl: url,
                  raw: { document: document.raw, record },
                });
                if (result === "INSERTED") statusChanges++;
              }
            }
          } else if (kind === "COMMITTEE_ATTENDANCE") {
            const meetingDates = parseSenadoAttendanceMeetingDates(text);
            await persistDocument(db, {
              source,
              sourceDocId: String(document.fileId),
              title: document.title,
              extension: document.extension,
              url,
              uploadedAt: document.addedOn,
              modifiedAt: document.modifiedOn,
              sourceCategory: registry.label,
              sourceFragment: meetingDates.map((mention) => mention.rawText).join("\n"),
              raw: { document: document.raw, meetingDates },
            });
            for (const [index, mention] of meetingDates.entries()) {
              explicitMeetingDates++;
              const activity = await upsertActivityEvent(db, {
                source,
                scope: "COMMITTEE",
                chamber: "SENADO",
                agendaUrl: url,
                date: mention.date,
                time: null,
                kind: registry.label,
                body: registry.label,
                description: document.title,
                statuses: [],
                initiativeCodes: [],
                dedupeKey: `document:${document.fileId}:meeting-date:${index}`,
                raw: { document: document.raw, dateMention: mention.rawText },
              });
              if (activity.inserted) activityInserted++;
            }
          } else if (kind === "REPORTS_FOR_READING") {
            const references = parseSenadoReportReferences(text);
            partialReferences += references.length;
            await persistDocument(db, {
              source,
              sourceDocId: String(document.fileId),
              title: document.title,
              extension: document.extension,
              url,
              uploadedAt: document.addedOn,
              modifiedAt: document.modifiedOn,
              sourceCategory: registry.label,
              sourceFragment: references.map((reference) => reference.rawReference).join("\n"),
              raw: { document: document.raw, partialReferences: references },
            });
          }
        } catch (error) {
          gaps.push(
            `Senado · ${registry.label} · archivo ${document.fileId}: ${(error as Error).message}`,
          );
        }
      }
    }

    if (unmatchedCodes.size > 0) {
      gaps.push(
        `Senado · ${registry.label}: ${unmatchedCodes.size} código(s) exacto(s) no identificaron un PDL único del corpus del Senado.`,
      );
    }

    const outcome = gaps.length ? "PARTIAL" : "COMPLETE";
    await recordIngestionRun(db, {
      runId,
      source,
      seen,
      inserted: inserted + activityInserted,
      statusChanges,
      ok: outcome === "COMPLETE",
      outcome,
      details: {
        publicationKind: kind,
        pageUrl: registry.pageUrl,
        reportedCount: observation?.reportedCount ?? null,
        collectedCount: observation?.collectedCount ?? seen,
        complete: observation?.complete ?? false,
        emptyMessage: observation?.emptyMessage ?? null,
        parsedPdfs,
        unmatchedCodes: unmatchedCodes.size,
        unmatchedCodeExamples: [...unmatchedCodes].slice(0, 50),
        explicitMeetingDates,
        partialReferences,
        activityInserted,
        pdfMode: options.full ? "FULL_DECLARED_COLLECTIONS" : "RECENT_SLICE",
        gaps,
      },
    });
    options.log(
      `  ${outcome === "COMPLETE" ? "✔" : "⚠"} ${source}: ${seen} documento(s), ${parsedPdfs} PDF leídos`,
    );
    return {
      source,
      ok: outcome === "COMPLETE",
      outcome,
      seen,
      inserted: inserted + activityInserted,
      statusChanges,
      gaps,
    };
  } catch (error) {
    const message = (error as Error).message;
    await recordIngestionRun(db, {
      runId,
      source,
      seen,
      inserted,
      statusChanges,
      ok: false,
      error: message,
      details: { publicationKind: kind, gaps },
    });
    return {
      source,
      ok: false,
      outcome: "FAILED",
      seen,
      inserted,
      statusChanges,
      gaps,
      error: message,
    };
  }
}

export async function ingestCongressPublications(
  db: Database,
  opts: PublicationIngestOptions = {},
): Promise<CongressPublicationSummary[]> {
  const options = {
    pdfLimitPerSource: Math.max(1, Math.min(opts.pdfLimitPerSource ?? 10, 500)),
    full: opts.full ?? false,
    log: opts.log ?? (() => {}),
  };
  const summaries: CongressPublicationSummary[] = [];
  summaries.push(await ingestKnownAgenda(db, options));
  const senate = new SenadoPublicationsAdapter();
  for (const source of SENADO_PUBLICATION_SOURCES) {
    summaries.push(await ingestSenateKind(db, senate, source.kind, options));
  }
  return summaries;
}
