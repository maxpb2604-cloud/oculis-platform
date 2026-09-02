import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, type DbHandle } from "../src/client.js";
import {
  latestCongressMovementDate,
  listInitiativeTitleTranslationCandidates,
  readCongressMovementDay,
  recordStatusEvents,
  REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX,
  storeDocumentContent,
  storeDocumentPdfVerification,
  storeInitiativeTitleTranslation,
  upsertDocument,
  upsertInitiative,
} from "../src/repository.js";
import { documentPdfVerifications } from "../src/schema.js";
import type { DocumentSourceSnapshot, NewInitiative } from "../src/schema.js";

let h: DbHandle;

beforeAll(async () => {
  h = createDb();
  await h.ensureSchema();
});

afterAll(async () => {
  await h.close();
});

function initiative(sourceId: string, over: Partial<NewInitiative> = {}): NewInitiative {
  return {
    source: "sil-diputados",
    sourceId,
    kind: "LEGISLATIVE",
    code: `MOV-${sourceId}`,
    title: `Iniciativa oficial ${sourceId}`,
    status: "Depositado",
    chamber: "DIPUTADOS",
    sourceChamber: "DIPUTADOS",
    sourceUrl: `https://www.diputadosrd.gob.do/sil/iniciativa/${sourceId}`,
    ...over,
  };
}

function snapshot(
  initiativeId: number,
  sourceDocId: string,
  url: string,
  uploadedAt: string | null,
): DocumentSourceSnapshot {
  return {
    initiativeId,
    source: "sil-diputados",
    sourceDocId,
    url,
    docType: "PROYECTO DEPOSITADO",
    uploadedAt,
    modifiedAt: null,
  };
}

describe("readCongressMovementDay", () => {
  it("returns only exact official movements, stable navigation, distinct PDF evidence and base publications", async () => {
    const previousDate = "2096-05-10";
    const selectedDate = "2096-05-11";
    const nextDate = "2096-05-12";
    const freshDocumentObservation = new Date().toISOString();
    const staleDocumentObservation = new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString();

    const filedWithFreshPdf = await upsertInitiative(
      h.db,
      initiative("filed-fresh", {
        title: "Proyecto de archivos públicos",
        filedAt: selectedDate,
        // sourceChamber is authoritative even when the legacy chamber differs.
        chamber: "SENADO",
        sourceChamber: "DIPUTADOS",
      }),
    );
    const filedWithStalePdf = await upsertInitiative(
      h.db,
      initiative("filed-stale", { filedAt: selectedDate }),
    );
    const filedWithoutPdf = await upsertInitiative(
      h.db,
      initiative("filed-none", {
        filedAt: selectedDate,
        status: "En comisión",
        raw: {
          payload: { documentos: [] },
          provenance: {
            observedCollections: ["documentos"],
            collectionObservedAt: { documentos: freshDocumentObservation },
          },
        },
      }),
    );
    const statusOnly = await upsertInitiative(
      h.db,
      initiative("status-only", {
        filedAt: null,
        status: "En comisión",
        raw: {
          payload: { documentos: [] },
          provenance: {
            observedCollections: ["documentos"],
            collectionObservedAt: { documentos: staleDocumentObservation },
          },
        },
      }),
    );
    const previous = await upsertInitiative(
      h.db,
      initiative("previous", { filedAt: previousDate }),
    );
    const next = await upsertInitiative(h.db, initiative("next", { filedAt: nextDate }));
    const wrongDate = await upsertInitiative(
      h.db,
      initiative("wrong-date", { filedAt: "2096-05-09" }),
    );
    const wrongChamber = await upsertInitiative(
      h.db,
      initiative("wrong-chamber", {
        filedAt: "2998-01-01",
        chamber: "DIPUTADOS",
        sourceChamber: "SENADO",
      }),
    );
    const fallbackChamber = await upsertInitiative(
      h.db,
      initiative("fallback-chamber", {
        filedAt: selectedDate,
        sourceChamber: null,
        chamber: "DIPUTADOS",
        raw: {
          payload: { documentos: [] },
          provenance: {
            observedCollections: [],
            retainedCollections: ["documentos"],
            collectionObservedAt: { documentos: freshDocumentObservation },
          },
        },
      }),
    );
    await upsertInitiative(
      h.db,
      initiative("regulatory-in-congress-field", {
        kind: "REGULATORY",
        filedAt: selectedDate,
      }),
    );

    const [translationCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      initiativeIds: [filedWithFreshPdf.id],
      model: `${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}movement-day-test`,
    });
    await storeInitiativeTitleTranslation(h.db, {
      ...translationCandidate!,
      translatedTitle: "Public Archives Bill",
    });
    const [staleTranslationCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      initiativeIds: [statusOnly.id],
      model: `${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}movement-day-stale-test`,
    });
    await storeInitiativeTitleTranslation(h.db, {
      ...staleTranslationCandidate!,
      translatedTitle: "Stale Translation Must Not Appear",
    });
    await upsertInitiative(
      h.db,
      initiative("status-only", {
        title: "Título oficial corregido por la fuente",
        filedAt: null,
        status: "En comisión",
      }),
    );

    await recordStatusEvents(h.db, filedWithFreshPdf.id, [
      {
        sourceEventId: "deposit-duplicate",
        status: "  Depositada  ",
        date: selectedDate,
        note: "Fila exacta de depósito",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/historial/deposit-duplicate",
        evidenceType: "SOURCE_HISTORY",
      },
      {
        sourceEventId: "committee-event",
        status: "Enviada a comisión",
        date: selectedDate,
        note: "Comisión Permanente de Justicia",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/historial/committee-event",
        evidenceType: "SOURCE_HISTORY",
      },
    ]);
    await recordStatusEvents(h.db, statusOnly.id, [
      {
        sourceEventId: "status-only-exact",
        status: "Tomada en consideración",
        date: selectedDate,
        note: "Movimiento oficial",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/historial/status-only-exact",
        evidenceType: "SOURCE_HISTORY",
      },
      {
        sourceEventId: "status-invalid-date",
        status: "Fecha imposible",
        date: "2999-02-31",
        note: null,
        source: "sil-diputados",
        evidenceType: "SOURCE_HISTORY",
      },
      {
        status: "Cambio solamente observado",
        date: selectedDate,
        note: null,
        source: "sil-diputados",
        evidenceType: "OBSERVED_CHANGE",
        observedAt: new Date(`${selectedDate}T15:00:00Z`),
      },
    ]);
    await recordStatusEvents(h.db, wrongDate.id, [
      {
        sourceEventId: "wrong-date-status",
        status: "Evento de otro día",
        date: "2096-05-09",
        note: null,
        source: "sil-diputados",
        evidenceType: "SOURCE_HISTORY",
      },
    ]);
    await recordStatusEvents(h.db, wrongChamber.id, [
      {
        sourceEventId: "wrong-chamber-status",
        status: "Evento del Senado",
        date: selectedDate,
        note: null,
        source: "senado-sil",
        evidenceType: "SOURCE_HISTORY",
      },
    ]);

    const freshUrl =
      "https://www.diputadosrd.gob.do/ReportesGenerales/VerDocumento?documentoId=91001";
    const staleUrl =
      "https://www.diputadosrd.gob.do/ReportesGenerales/VerDocumento?documentoId=91002";
    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "movement-pdf-fresh",
      initiativeId: filedWithFreshPdf.id,
      initiativeCode: "MOV-filed-fresh",
      docType: "PROYECTO DEPOSITADO",
      extension: "pdf",
      url: freshUrl,
      uploadedAt: selectedDate,
    });
    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "movement-pdf-stale",
      initiativeId: filedWithStalePdf.id,
      initiativeCode: "MOV-filed-stale",
      docType: "PROYECTO DEPOSITADO",
      extension: "pdf",
      url: staleUrl,
      uploadedAt: selectedDate,
    });
    await upsertDocument(h.db, {
      source: "sil-diputados",
      sourceDocId: "movement-pdf-fresh-second-metadata-row",
      initiativeId: filedWithFreshPdf.id,
      initiativeCode: "MOV-filed-fresh",
      docType: "PROYECTO DEPOSITADO",
      extension: "pdf",
      url: "https://www.diputadosrd.gob.do/ReportesGenerales/VerDocumento?documentoId=91003",
      uploadedAt: selectedDate,
    });
    const currentFreshDocument = (await h.db.execute(
      sql`select id from documents where source_doc_id = 'movement-pdf-fresh-second-metadata-row' limit 1`,
    )) as unknown as { rows: Array<{ id: number }> };
    const staleDocument = (await h.db.execute(
      sql`select id from documents where source_doc_id = 'movement-pdf-stale' limit 1`,
    )) as unknown as { rows: Array<{ id: number }> };
    const currentFreshDocumentId = currentFreshDocument.rows[0]!.id;
    const staleDocumentId = staleDocument.rows[0]!.id;
    const freshText = "Texto oficial completo y verificado del proyecto fresco.";
    const staleText = "Texto oficial completo cuya verificación ya caducó.";
    const freshSnapshot = snapshot(
      filedWithFreshPdf.id,
      "movement-pdf-fresh-second-metadata-row",
      "https://www.diputadosrd.gob.do/ReportesGenerales/VerDocumento?documentoId=91003",
      selectedDate,
    );
    await storeDocumentContent(h.db, {
      documentId: currentFreshDocumentId,
      contentHash: "a".repeat(64),
      contentText: freshText,
      mimeType: "application/pdf",
      byteSize: 4_096,
      pageCount: 2,
      characterCount: freshText.length,
      sourceSnapshot: freshSnapshot,
    });
    await storeDocumentPdfVerification(h.db, {
      documentId: currentFreshDocumentId,
      sourceSnapshot: freshSnapshot,
      reachable: true,
      httpStatus: 200,
      mimeType: "application/pdf",
      byteSize: 4_096,
      finalUrl: freshSnapshot.url!,
      errorCode: null,
      errorMessage: null,
    });
    const staleSnapshot = snapshot(
      filedWithStalePdf.id,
      "movement-pdf-stale",
      staleUrl,
      selectedDate,
    );
    await storeDocumentContent(h.db, {
      documentId: staleDocumentId,
      contentHash: "b".repeat(64),
      contentText: staleText,
      mimeType: "application/pdf",
      byteSize: 3_500,
      pageCount: 1,
      characterCount: staleText.length,
      sourceSnapshot: staleSnapshot,
    });
    await storeDocumentPdfVerification(h.db, {
      documentId: staleDocumentId,
      sourceSnapshot: staleSnapshot,
      reachable: true,
      httpStatus: 200,
      mimeType: "application/pdf",
      byteSize: 3_500,
      finalUrl: staleUrl,
      errorCode: null,
      errorMessage: null,
    });
    await h.db
      .update(documentPdfVerifications)
      .set({ verifiedAt: sql`now() - interval '25 hours'` })
      .where(eq(documentPdfVerifications.documentId, staleDocumentId));

    // Base catalog identity is initiative_code IS NULL. A non-null initiativeId is
    // intentionally retained here to ensure it does not accidentally exclude the row.
    await upsertDocument(h.db, {
      source: "dip-known-agenda",
      sourceDocId: "publication-uploaded",
      initiativeId: filedWithFreshPdf.id,
      initiativeCode: null,
      docType: "Agenda",
      url: "https://camaradediputados.gob.do/publicaciones/agenda-uploaded.pdf",
      uploadedAt: selectedDate,
      modifiedAt: selectedDate,
    });
    await upsertDocument(h.db, {
      source: "dip-known-agenda",
      sourceDocId: "publication-modified",
      initiativeCode: null,
      docType: "Agenda",
      url: "https://camaradediputados.gob.do/publicaciones/agenda-modified.pdf",
      uploadedAt: previousDate,
      modifiedAt: selectedDate,
    });
    await upsertDocument(h.db, {
      source: "dip-known-agenda",
      sourceDocId: "publication-undated",
      initiativeCode: null,
      docType: "Agenda",
      url: "https://camaradediputados.gob.do/publicaciones/agenda-undated.pdf",
      uploadedAt: null,
      modifiedAt: null,
    });
    await upsertDocument(h.db, {
      source: "dip-known-agenda",
      sourceDocId: "publication-undated-but-modified",
      initiativeCode: null,
      docType: "Agenda",
      url: "https://camaradediputados.gob.do/publicaciones/agenda-undated-modified.pdf",
      uploadedAt: null,
      modifiedAt: selectedDate,
    });
    // Derived mention: initiative_code is populated, so it is not a base publication.
    await upsertDocument(h.db, {
      source: "dip-known-agenda",
      sourceDocId: "publication-derived-mention",
      initiativeId: null,
      initiativeCode: "MOV-filed-fresh",
      docType: "Agenda — mención derivada",
      url: "https://camaradediputados.gob.do/publicaciones/derived.pdf",
      uploadedAt: selectedDate,
    });
    await upsertDocument(h.db, {
      source: "sen-reports",
      sourceDocId: "publication-other-chamber",
      initiativeCode: null,
      docType: "Informe",
      url: "https://www.senadord.gob.do/publicaciones/report.pdf",
      uploadedAt: selectedDate,
    });

    const result = await readCongressMovementDay(h.db, {
      date: selectedDate,
      chamber: "DIPUTADOS",
    });

    expect(result).toMatchObject({
      chamber: "DIPUTADOS",
      selectedDate,
      previousAvailableDate: previousDate,
      nextAvailableDate: nextDate,
      latestAvailableDate: nextDate,
      totalMovementCount: 6,
      uniqueInitiativeCount: 5,
      depositedPdfs: {
        supported: true,
        eligibleFiledInitiativeCount: 4,
        withOfficialMetadata: 2,
        withFreshVerifiedPdf: 1,
        unavailableOrUnverified: 3,
      },
      publications: {
        sources: ["dip-known-agenda"],
        publishedOnDate: 1,
        modifiedOnDate: 2,
        undatedStoredCatalog: 2,
        storedCatalogTotal: 4,
        expectedDailyTotal: null,
      },
    });
    expect(result.movements.map((movement) => movement.kind)).toEqual([
      "FILED",
      "FILED",
      "FILED",
      "FILED",
      "STATUS",
      "STATUS",
    ]);
    expect(result.movements.some((movement) => movement.status?.trim() === "Depositada")).toBe(
      false,
    );
    expect(
      result.movements.some((movement) => movement.status === "Cambio solamente observado"),
    ).toBe(false);
    expect(result.movements.some((movement) => movement.title.includes("wrong-date"))).toBe(false);
    expect(result.movements.some((movement) => movement.title.includes("wrong-chamber"))).toBe(
      false,
    );
    expect(
      result.movements.some((movement) => movement.title.includes("regulatory-in-congress-field")),
    ).toBe(false);
    expect(
      result.movements.find((movement) => movement.initiativeId === filedWithFreshPdf.id),
    ).toMatchObject({
      title: "Proyecto de archivos públicos",
      titleEn: "Public Archives Bill",
      chamber: "DIPUTADOS",
      source: "sil-diputados",
      evidenceType: "OFFICIAL_FILED_AT",
      documentPublication: {
        status: "PUBLISHED_VERIFIED",
        checkedAt: null,
        available: true,
        documentId: currentFreshDocumentId,
      },
    });
    expect(
      result.movements.find((movement) => movement.initiativeId === filedWithStalePdf.id),
    ).toMatchObject({
      documentPublication: {
        status: "REGISTERED_UNVERIFIED",
        available: false,
        documentId: staleDocumentId,
      },
    });
    expect(
      result.movements.find((movement) => movement.initiativeId === filedWithoutPdf.id),
    ).toMatchObject({
      documentPublication: {
        status: "NOT_PUBLISHED_LATEST_CHECK",
        checkedAt: freshDocumentObservation,
        available: false,
        documentId: null,
      },
    });
    expect(
      result.movements.find((movement) => movement.initiativeId === fallbackChamber.id),
    ).toMatchObject({
      documentPublication: {
        status: "UNCONFIRMED",
        checkedAt: null,
        available: false,
        documentId: null,
      },
    });
    expect(
      result.movements.find((movement) => movement.sourceEventId === "committee-event"),
    ).toMatchObject({
      kind: "STATUS",
      status: "Enviada a comisión",
      note: "Comisión Permanente de Justicia",
      evidenceType: "SOURCE_HISTORY",
    });
    expect(
      result.movements.find((movement) => movement.sourceEventId === "status-only-exact"),
    ).toMatchObject({
      title: "Título oficial corregido por la fuente",
      titleEn: null,
      documentPublication: {
        status: "UNCONFIRMED",
        checkedAt: null,
        available: false,
        documentId: null,
      },
    });
    expect(result.movements.every((movement) => movement.eventDate === selectedDate)).toBe(true);
    expect(result.depositedPdfs.contractNote).toContain("zero stored metadata is not proof");
    expect(await latestCongressMovementDate(h.db, "DIPUTADOS")).toBe(nextDate);
    expect(previous.id).toBeGreaterThan(0);
    expect(next.id).toBeGreaterThan(0);
    expect(filedWithoutPdf.id).toBeGreaterThan(0);
    expect(fallbackChamber.id).toBeGreaterThan(0);
  });

  it("marks Senate initiative documents unsupported and never presents monitoring as 0/0", async () => {
    const selectedDate = "2097-01-20";
    const senateInitiative = await upsertInitiative(
      h.db,
      initiative("senate-document-unsupported", {
        source: "senado-sil",
        sourceChamber: "SENADO",
        chamber: "SENADO",
        filedAt: selectedDate,
      }),
    );
    const result = await readCongressMovementDay(h.db, {
      date: selectedDate,
      chamber: "SENADO",
    });
    expect(result.selectedDate).toBe(selectedDate);
    expect(result.totalMovementCount).toBe(1);
    expect(result.uniqueInitiativeCount).toBe(1);
    expect(result.movements[0]).toMatchObject({
      initiativeId: senateInitiative.id,
      documentPublication: {
        status: "UNSUPPORTED",
        checkedAt: null,
        available: false,
        documentId: null,
      },
    });
    expect(result.depositedPdfs).toEqual(
      expect.objectContaining({
        supported: false,
        eligibleFiledInitiativeCount: null,
        withOfficialMetadata: null,
        withFreshVerifiedPdf: null,
        unavailableOrUnverified: null,
      }),
    );
    expect(result.publications.expectedDailyTotal).toBeNull();
    expect(result.publications.contractNote).toContain("not proof");
  });

  it("consolidates equivalent status presentation while retaining source evidence", async () => {
    const selectedDate = "2098-08-26";
    const row = await upsertInitiative(
      h.db,
      initiative("semantic-status-duplicates", {
        filedAt: selectedDate,
        status: "En Agenda",
      }),
    );

    await recordStatusEvents(h.db, row.id, [
      {
        sourceEventId: "official-row-1",
        status: "  En Agenda ",
        date: selectedDate,
        note: "Movimiento oficial",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/semantic-status-duplicates",
        evidenceType: "SOURCE_HISTORY",
        raw: { fecha: "26/08/2098" },
      },
      {
        sourceEventId: "official-row-2",
        status: "en   agenda",
        date: selectedDate,
        note: "Movimiento oficial",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/semantic-status-duplicates",
        evidenceType: "SOURCE_HISTORY",
        raw: { fecha: "26/8/2098" },
      },
      {
        status: "En Agenda",
        date: selectedDate,
        note: "Movimiento oficial",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/semantic-status-duplicates",
        evidenceType: "SOURCE_HISTORY",
        raw: { fecha: "26/08/2098", variante: 1 },
      },
      {
        status: "EN AGENDA",
        date: selectedDate,
        note: "Movimiento oficial",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/semantic-status-duplicates",
        evidenceType: "SOURCE_HISTORY",
        raw: { fecha: "26/8/2098", variante: 2 },
      },
      {
        sourceEventId: "independent-source-row",
        status: "En Agenda",
        date: selectedDate,
        note: "La misma situación observada por otra fuente",
        source: "sil-movements",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/semantic-status-duplicates",
        evidenceType: "SOURCE_HISTORY",
      },
      {
        sourceEventId: "different-status-row",
        status: "En comisión",
        date: selectedDate,
        note: "Estado distinto",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/semantic-status-duplicates",
        evidenceType: "SOURCE_HISTORY",
      },
    ]);

    const result = await readCongressMovementDay(h.db, {
      date: selectedDate,
      chamber: "DIPUTADOS",
    });
    const statusMovements = result.movements.filter((movement) => movement.kind === "STATUS");
    const consolidated = statusMovements.find(
      (movement) =>
        movement.source === "sil-diputados" &&
        movement.status?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() ===
          "en agenda",
    );

    expect(result).toMatchObject({
      totalMovementCount: 4,
      uniqueInitiativeCount: 1,
    });
    expect(result.movements.filter((movement) => movement.kind === "FILED")).toHaveLength(1);
    expect(consolidated).toMatchObject({
      sourceRowCount: 4,
      sourceEventIds: ["official-row-1", "official-row-2"],
      sourceEventId: "official-row-1",
    });
    expect(
      statusMovements.filter(
        (movement) =>
          movement.status?.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() ===
          "en agenda",
      ),
    ).toHaveLength(2);
    expect(statusMovements.some((movement) => movement.source === "sil-movements")).toBe(true);
    expect(statusMovements.some((movement) => movement.status === "En comisión")).toBe(true);

    const storedEvidence = (await h.db.execute(sql`
      select count(*)::int as count
        from status_events
       where initiative_id = ${row.id}
         and event_date = ${selectedDate}
         and evidence_type = 'SOURCE_HISTORY'
    `)) as unknown as { rows: Array<{ count: number }> };
    expect(storedEvidence.rows[0]?.count).toBe(6);
  });

  it("rejects invalid selected dates instead of shifting or inferring a day", async () => {
    await expect(
      readCongressMovementDay(h.db, { date: "2096-02-31", chamber: "DIPUTADOS" }),
    ).rejects.toThrow("exact ISO calendar date");
  });

  it("reports null availability, not an invented date, when a chamber has no activity", async () => {
    const empty = createDb();
    await empty.ensureSchema();
    try {
      expect(await latestCongressMovementDate(empty.db, "SENADO")).toBeNull();
      const result = await readCongressMovementDay(empty.db, {
        date: "2097-02-01",
        chamber: "SENADO",
      });
      expect(result).toMatchObject({
        selectedDate: "2097-02-01",
        previousAvailableDate: null,
        nextAvailableDate: null,
        latestAvailableDate: null,
        totalMovementCount: 0,
        uniqueInitiativeCount: 0,
        movements: [],
      });
    } finally {
      await empty.close();
    }
  });
});
