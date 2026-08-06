import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DbHandle } from "../src/client.js";
import {
  beginIngestionRun,
  countInitiatives,
  dashboardKpis,
  getInitiativeById,
  latestRunsBySource,
  listActivity,
  listDocuments,
  listFeedItems,
  listInitiatives,
  listLegislators,
  listRecentStatusEvents,
  listRegulations,
  listSourceDocuments,
  legislatorCommittees,
  recordIngestionRun,
  recordStatusEvents,
  replaceRosterSnapshot,
  regulatoryKpis,
  upsertActivityEvent,
  upsertDocument,
  upsertFeedAccount,
  upsertFeedItem,
  upsertInitiative,
  upsertRegulation,
  uniqueInitiativeIdByCode,
} from "../src/repository.js";
import {
  activityInitiatives,
  documents,
  feedAccounts,
  feedItemEntities,
  feedItems,
  inferenceAudit,
  regulations,
} from "../src/schema.js";
import type { NewInitiative } from "../src/schema.js";

let h: DbHandle;

beforeAll(async () => {
  h = createDb(); // in-memory PGlite (no DATABASE_URL)
  await h.ensureSchema();
});
afterAll(async () => {
  await h.close();
});

function fixture(over: Partial<NewInitiative> = {}): NewInitiative {
  return {
    source: "sil-diputados",
    sourceId: "158418",
    kind: "LEGISLATIVE",
    code: "05956-2024-2028-CD",
    title: "Proyecto de ley de prueba",
    status: "Depositado",
    chamber: "DIPUTADOS",
    ...over,
  };
}

describe("upsertInitiative", () => {
  it("inserts once, then updates the same row (idempotent on source+sourceId)", async () => {
    const a = await upsertInitiative(h.db, fixture());
    expect(a.inserted).toBe(true);

    const b = await upsertInitiative(h.db, fixture({ status: "Depositado" }));
    expect(b.inserted).toBe(false);
    expect(b.statusChanged).toBe(false);
    expect(b.id).toBe(a.id);

    expect(await countInitiatives(h.db)).toBe(1);
  });

  it("detects a status change on re-ingest", async () => {
    const c = await upsertInitiative(h.db, fixture({ status: "En Comisión" }));
    expect(c.inserted).toBe(false);
    expect(c.statusChanged).toBe(true);
    expect(await countInitiatives(h.db)).toBe(1);
  });

  it("preserves previously observed facts when a partial run leaves them undefined", async () => {
    const first = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "partial-enrichment",
        code: "PARTIAL-1",
        sponsor: "Ana Pérez",
        party: "PRUEBA",
        province: "Azua",
        raw: { proponents: [{ name: "Ana Pérez" }] },
      }),
    );
    await upsertInitiative(h.db, {
      ...fixture({ sourceId: "partial-enrichment", code: "PARTIAL-1" }),
      sponsor: undefined,
      party: undefined,
      province: undefined,
      raw: undefined,
    });

    const detail = await getInitiativeById(h.db, first.id);
    expect(detail).toMatchObject({
      sponsor: "Ana Pérez",
      party: "PRUEBA",
      province: "Azua",
      raw: { proponents: [{ name: "Ana Pérez" }] },
    });
  });
});

describe("recordStatusEvents", () => {
  it("dedupes identical (status, date) events across re-scrapes", async () => {
    const { id } = await upsertInitiative(h.db, fixture());
    const events = [
      { status: "Depositado", date: "2026-06-18", note: null },
      { status: "En Comisión", date: "2026-06-20", note: null },
    ];
    const first = await recordStatusEvents(h.db, id, events);
    expect(first).toBe(2);
    const second = await recordStatusEvents(h.db, id, events);
    expect(second).toBe(0); // all duplicates skipped
    const third = await recordStatusEvents(h.db, id, [
      { status: "En Pleno", date: "2026-06-25", note: null },
    ]);
    expect(third).toBe(1);
  });

  it("dedupes status events whose source did not provide a date", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "undated-status", code: "UNDATED-1" }),
    );
    const event = [{ status: "Pendiente de fecha", date: null, note: null }];
    expect(await recordStatusEvents(h.db, id, event)).toBe(1);
    expect(await recordStatusEvents(h.db, id, event)).toBe(0);
  });

  it("preserves matching status evidence from independent official sources", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "multi-source-status", code: "MULTI-SOURCE-1" }),
    );
    const base = { status: "Perimida", date: null, note: null };
    expect(
      await recordStatusEvents(h.db, id, [
        { ...base, source: "senado-sil", sourceUrl: "https://example.com/sil" },
      ]),
    ).toBe(1);
    expect(
      await recordStatusEvents(h.db, id, [
        { ...base, source: "sen-expired", sourceUrl: "https://example.com/perimidos" },
      ]),
    ).toBe(1);
    expect(
      await recordStatusEvents(h.db, id, [
        { ...base, source: "sen-expired", sourceUrl: "https://example.com/perimidos-2" },
      ]),
    ).toBe(1);
    expect(
      await recordStatusEvents(h.db, id, [
        { ...base, source: "sen-expired", sourceUrl: "https://example.com/perimidos" },
      ]),
    ).toBe(0);

    const detail = await getInitiativeById(h.db, id);
    expect(
      detail?.events
        .filter((event) => event.status === "Perimida")
        .map((event) => `${event.source}:${event.sourceUrl}`)
        .sort(),
    ).toEqual([
      "sen-expired:https://example.com/perimidos",
      "sen-expired:https://example.com/perimidos-2",
      "senado-sil:https://example.com/sil",
    ]);
  });

  it("keeps source-history and observed changes distinct without inventing a date", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "status-provenance",
        code: "STATUS-PROV",
        sourceUrl: "https://example.com/bill",
      }),
    );
    const base = { status: "Texto literal", date: null, note: null };
    expect(await recordStatusEvents(h.db, id, [{ ...base, evidenceType: "SOURCE_HISTORY" }])).toBe(
      1,
    );
    expect(await recordStatusEvents(h.db, id, [{ ...base, evidenceType: "OBSERVED_CHANGE" }])).toBe(
      1,
    );

    const detail = await getInitiativeById(h.db, id);
    expect(detail?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventDate: null,
          source: "sil-diputados",
          sourceUrl: "https://example.com/bill",
          evidenceType: "SOURCE_HISTORY",
        }),
        expect.objectContaining({ eventDate: null, evidenceType: "OBSERVED_CHANGE" }),
      ]),
    );
  });

  it("retains repeated observed states in an A → B → A cycle", async () => {
    const base = fixture({ sourceId: "status-cycle", code: "STATUS-CYCLE", status: "A" });
    const { id } = await upsertInitiative(h.db, base);
    await upsertInitiative(h.db, { ...base, status: "B" });
    await upsertInitiative(h.db, { ...base, status: "A" });
    const detail = await getInitiativeById(h.db, id);
    const observed =
      detail?.events
        .filter((event) => event.evidenceType === "OBSERVED_CHANGE")
        .map((event) => event.status) ?? [];
    expect(observed).toHaveLength(2);
    expect(observed).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("does not present newly ingested old/undated history as a recent event", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "old-history", code: "OLD-HISTORY" }),
    );
    await recordStatusEvents(h.db, id, [
      { status: "Antiguo", date: "2020-01-01", note: null },
      { status: "Sin fecha", date: null, note: null },
    ]);
    const recent = await listRecentStatusEvents(h.db, { sinceDays: 30 });
    expect(recent.some((event) => event.initiativeId === id)).toBe(false);
  });
});

describe("source snapshot upserts", () => {
  it("keeps old roster rows for history but serves only the latest validated snapshot", async () => {
    const source = "roster-test";
    const member = (sourceId: string, fullName: string) => ({
      source,
      sourceId,
      chamber: "DIPUTADOS",
      fullName,
    });
    const seat = (sourceId: string, fullName: string) => ({
      source,
      chamber: "DIPUTADOS",
      commissionName: "Comisión de Prueba",
      legislatorName: fullName,
      legislatorSourceId: sourceId,
    });
    await replaceRosterSnapshot(
      h.db,
      source,
      [member("1", "Persona Uno"), member("2", "Persona Dos")],
      [seat("1", "Persona Uno"), seat("2", "Persona Dos")],
    );
    await replaceRosterSnapshot(
      h.db,
      source,
      [member("2", "Persona Dos")],
      [seat("2", "Persona Dos")],
    );

    const currentRoster = await listLegislators(h.db);
    const currentSeats = await legislatorCommittees(h.db);
    expect(currentRoster.some((row) => row.fullName === "Persona Uno")).toBe(false);
    expect(currentRoster.some((row) => row.fullName === "Persona Dos")).toBe(true);
    expect(currentSeats.some((row) => row.legislatorName === "Persona Uno")).toBe(false);
    expect(currentSeats.some((row) => row.legislatorName === "Persona Dos")).toBe(true);
  });

  it("serves only explicit source category and archives rejected initiative inference", async () => {
    const created = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "blocked-inference",
        code: "BLOCKED-1",
        sourceCategory: "Tema oficial",
        category: "SALUD",
        categoryConfidence: 0.9,
        riskLevel: "ALTO",
        approvalProbability: "ALTA",
        approvalScore: 14,
        needsReview: true,
        published: true,
      }),
    );
    const detail = await getInitiativeById(h.db, created.id);
    expect(detail).toMatchObject({
      sourceCategory: "Tema oficial",
    });
    expect(detail).not.toHaveProperty("riskLevel");
    expect(detail).not.toHaveProperty("approvalProbability");
    expect(detail).not.toHaveProperty("needsReview");
    const page = await listInitiatives(h.db);
    expect(page.rows.find((row) => row.id === created.id)).toMatchObject({
      sourceCategory: "Tema oficial",
    });
    const audit = await h.db
      .select()
      .from(inferenceAudit)
      .where(eq(inferenceAudit.entityId, created.id));
    expect(audit.some((row) => row.inferenceKind === "blocked_inference")).toBe(true);
  });

  it("updates document metadata without creating duplicates", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "document-parent", code: "DOC-1" }),
    );
    expect(
      await upsertDocument(h.db, {
        source: "test-docs",
        sourceDocId: "document-1",
        initiativeId: id,
        initiativeCode: "DOC-1",
        docType: "PROYECTO",
        extension: "pdf",
        url: "https://example.com/old.pdf",
      }),
    ).toBe(true);
    expect(
      await upsertDocument(h.db, {
        source: "test-docs",
        sourceDocId: "document-1",
        initiativeId: id,
        initiativeCode: "DOC-1",
        docType: "TEXTO ACTUALIZADO",
        extension: "pdf",
        url: "https://example.com/new.pdf",
      }),
    ).toBe(false);

    const rows = await listDocuments(h.db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      docType: "TEXTO ACTUALIZADO",
      url: "https://example.com/new.pdf",
    });
    expect((await dashboardKpis(h.db)).published).toBeGreaterThanOrEqual(1);
  });

  it("lists unlinked official documents and resolves codes only when unique in chamber", async () => {
    const senate = await upsertInitiative(
      h.db,
      fixture({
        source: "senate-doc-parent",
        sourceId: "senate-doc-parent",
        code: "00999-2026-PLO-SE",
        chamber: "SENADO",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        source: "dip-doc-parent",
        sourceId: "dip-doc-parent",
        code: "00999-2026-PLO-SE",
        chamber: "DIPUTADOS",
      }),
    );
    await upsertDocument(h.db, {
      source: "sen-reports",
      sourceDocId: "report-1",
      docType: "Informe oficial",
      extension: "pdf",
      url: "https://www.senadord.gob.do/report-1.pdf",
      uploadedAt: "2026-08-05",
      modifiedAt: "2026-08-05",
      sourceCategory: "Informes para Lectura",
      raw: { fileId: 1 },
    });
    await upsertDocument(h.db, {
      source: "sen-reports",
      sourceDocId: "report-1:00999-2026-PLO-SE",
      initiativeCode: "00999-2026-PLO-SE",
      docType: "Referencia exacta sin enlace único",
      extension: "pdf",
      url: "https://www.senadord.gob.do/report-1.pdf",
      uploadedAt: "2026-08-05",
      sourceFragment: "EXP.: 00999-2026-PLO-SE",
      raw: { mention: "00999-2026-PLO-SE" },
    });
    await upsertDocument(h.db, {
      source: "sen-reports",
      sourceDocId: "report-1:linked-senate",
      initiativeId: senate.id,
      initiativeCode: "00999-2026-PLO-SE",
      docType: "Referencia exacta enlazada",
      extension: "pdf",
      url: "https://www.senadord.gob.do/report-1.pdf",
      uploadedAt: "2026-08-05",
    });

    expect(await uniqueInitiativeIdByCode(h.db, "00999-2026-PLO-SE")).toBeNull();
    expect(await uniqueInitiativeIdByCode(h.db, "00999-2026-PLO-SE", "SENADO")).toBe(senate.id);
    const unlinked = await listSourceDocuments(h.db, { sources: ["sen-reports"] });
    expect(unlinked).toHaveLength(2);
    expect(unlinked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDocId: "report-1",
          initiativeCode: null,
          sourceCategory: "Informes para Lectura",
          raw: { fileId: 1 },
        }),
        expect.objectContaining({
          sourceDocId: "report-1:00999-2026-PLO-SE",
          initiativeCode: "00999-2026-PLO-SE",
          sourceFragment: "EXP.: 00999-2026-PLO-SE",
        }),
      ]),
    );
  });

  it("replaces stale activity links when an agenda is edited", async () => {
    await upsertInitiative(h.db, fixture({ sourceId: "activity-a", code: "ACT-1" }));
    await upsertInitiative(h.db, fixture({ sourceId: "activity-b", code: "ACT-2" }));
    const base = {
      source: "test-activity",
      scope: "PLENARY" as const,
      chamber: "DIPUTADOS" as const,
      date: "2026-08-05",
      kind: "Orden del día",
      body: "Pleno",
      description: "Agenda",
      dedupeKey: "pleno-2026-08-05",
      raw: {},
    };
    await upsertActivityEvent(h.db, { ...base, initiativeCodes: ["ACT-1", "ACT-2"] });
    await upsertActivityEvent(h.db, { ...base, initiativeCodes: ["ACT-2"] });

    const [row] = await listActivity(h.db, { date: "2026-08-05" });
    expect(row?.initiativeCount).toBe(1);
  });

  it("refreshes feed fields and clears tags that disappear from the source", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "feed-parent", code: "FEED-1" }),
    );
    const item = {
      source: "test-feed",
      sourceId: "feed-item-1",
      kind: "NEWS",
      title: "Versión original",
      initiativeId: id,
      initiativeCode: "FEED-1",
    };
    await upsertFeedItem(h.db, item, [
      { entityType: "INITIATIVE", initiativeCode: "FEED-1", label: "FEED-1" },
    ]);
    await upsertFeedItem(h.db, { ...item, title: "Versión actualizada" }, []);

    const { items } = await listFeedItems(h.db, {}, { limit: 100 });
    const row = items.find((candidate) => candidate.source === "test-feed");
    expect(row?.title).toBe("Versión actualizada");
    expect(row?.tags).toEqual([]);
    expect(row?.publishedAt).toBeNull();
    expect(row?.observedAt).toEqual(expect.any(String));
    expect(row?.sortAt).toBe(row?.observedAt);
  });

  it("leaves code links unresolved when the exact code is not unique in scope", async () => {
    const first = await upsertInitiative(
      h.db,
      fixture({
        source: "duplicate-a",
        sourceId: "duplicate-a",
        code: "DUPLICATE-1",
        chamber: null,
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        source: "duplicate-b",
        sourceId: "duplicate-b",
        code: "DUPLICATE-1",
        chamber: null,
      }),
    );

    const activity = await upsertActivityEvent(h.db, {
      source: "test-ambiguous-activity",
      scope: "PLENARY",
      chamber: null,
      date: "2026-08-05",
      kind: "Orden del día",
      body: "Pleno",
      description: "DUPLICATE-1",
      dedupeKey: "ambiguous-code",
      initiativeCodes: ["DUPLICATE-1"],
      raw: {},
    });
    const [activityLink] = await h.db
      .select()
      .from(activityInitiatives)
      .where(eq(activityInitiatives.activityId, activity.id));
    expect(activityLink?.initiativeCode).toBe("DUPLICATE-1");
    expect(activityLink?.initiativeId).toBeNull();

    await upsertDocument(h.db, {
      source: "test-ambiguous-document",
      sourceDocId: "ambiguous-document",
      initiativeCode: "DUPLICATE-1",
    });
    const [document] = await h.db
      .select()
      .from(documents)
      .where(eq(documents.sourceDocId, "ambiguous-document"));
    expect(document?.initiativeId).toBeNull();

    const feed = await upsertFeedItem(
      h.db,
      {
        source: "test-ambiguous-feed",
        sourceId: "ambiguous-feed",
        kind: "OFFICIAL",
        title: "DUPLICATE-1",
        chamber: null,
      },
      [{ entityType: "INITIATIVE", initiativeCode: "DUPLICATE-1", label: "DUPLICATE-1" }],
    );
    const [feedLink] = await h.db
      .select()
      .from(feedItemEntities)
      .where(eq(feedItemEntities.feedItemId, feed.id));
    expect(feedLink?.initiativeId).toBeNull();
    expect(first.id).toBeGreaterThan(0);
  });

  it("neutralizes regulation/feed category, intervention, and influence rank", async () => {
    const regulation = await upsertRegulation(h.db, {
      source: "test-reg",
      sourceId: "reg-1",
      institution: "MISPAS",
      title: "Norma de prueba",
      status: "Texto oficial",
      interventionLevel: "HIGH",
      category: "SALUD",
      needsReview: true,
    });
    expect((await listRegulations(h.db)).find((row) => row.id === regulation.id)).toMatchObject({
      status: "Texto oficial",
      sourceCategory: null,
    });
    const explicitRegulation = await upsertRegulation(h.db, {
      source: "test-reg",
      sourceId: "reg-explicit-1",
      institution: "MISPAS",
      title: "Norma con categoría publicada",
      sourceCategory: "Categoría literal",
    });
    expect(
      (await listRegulations(h.db)).find((row) => row.id === explicitRegulation.id),
    ).toMatchObject({ sourceCategory: "Categoría literal" });
    await upsertFeedItem(h.db, {
      source: "test-feed-category",
      sourceId: "feed-category-1",
      kind: "NEWS",
      title: "Noticia",
      category: "SALUD",
    });
    await upsertFeedAccount(h.db, {
      name: "Cuenta Zeta",
      handle: "zeta",
      platform: "X",
      url: "https://example.com/zeta",
      kind: "INSTITUTION",
      influenceRank: 1,
    });
    expect(
      (await h.db.select().from(regulations).where(eq(regulations.id, regulation.id)))[0],
    ).toMatchObject({
      interventionLevel: null,
      category: null,
      needsReview: false,
    });
    expect(
      (await h.db.select().from(feedItems).where(eq(feedItems.sourceId, "feed-category-1")))[0]
        ?.category,
    ).toBeNull();
    expect(
      (await h.db.select().from(feedAccounts).where(eq(feedAccounts.handle, "zeta")))[0]
        ?.influenceRank,
    ).toBeNull();
  });

  it("preserves the factual consulta tri-state", async () => {
    const before = (await regulatoryKpis(h.db)).consultas;
    const unknown = await upsertRegulation(h.db, {
      source: "test-reg-tristate",
      sourceId: "unknown",
      institution: "INST",
      title: "Consulta no establecida",
    });
    const explicitFalse = await upsertRegulation(h.db, {
      source: "test-reg-tristate",
      sourceId: "false",
      institution: "INST",
      title: "No es consulta",
      isConsulta: false,
    });
    const explicitTrue = await upsertRegulation(h.db, {
      source: "test-reg-tristate",
      sourceId: "true",
      institution: "INST",
      title: "Es consulta",
      isConsulta: true,
    });

    const rows = await listRegulations(h.db, { institution: "INST" });
    expect(rows.find((row) => row.id === unknown.id)?.isConsulta).toBeNull();
    expect(rows.find((row) => row.id === explicitFalse.id)?.isConsulta).toBe(false);
    expect(rows.find((row) => row.id === explicitTrue.id)?.isConsulta).toBe(true);

    const consultas = await listRegulations(h.db, { consultaOnly: true });
    expect(consultas.some((row) => row.id === explicitTrue.id)).toBe(true);
    expect(consultas.some((row) => row.id === explicitFalse.id)).toBe(false);
    expect(consultas.some((row) => row.id === unknown.id)).toBe(false);
    expect((await regulatoryKpis(h.db)).consultas).toBe(before + 1);
  });
});

describe("ingestion health", () => {
  it("shows a run that started but never finished", async () => {
    await beginIngestionRun(h.db, "health-running", { mode: "test" });
    const row = (await latestRunsBySource(h.db)).find((run) => run.source === "health-running");
    expect(row).toMatchObject({ outcome: "RUNNING", finishedAt: null, ok: null });
    expect(row?.details).toMatchObject({ lifecycle: "EXPLICIT_BEGIN_FINISH" });
  });

  it("distinguishes an explicit begin timestamp from a completion-only record", async () => {
    const runId = await beginIngestionRun(h.db, "health-explicit-start");
    await recordIngestionRun(h.db, {
      runId,
      source: "health-explicit-start",
      seen: 1,
      ok: true,
    });
    await recordIngestionRun(h.db, {
      source: "health-completion-only",
      seen: 1,
      ok: true,
    });

    const rows = await latestRunsBySource(h.db);
    expect(rows.find((run) => run.source === "health-explicit-start")?.details).toMatchObject({
      lifecycle: "EXPLICIT_BEGIN_FINISH",
    });
    expect(rows.find((run) => run.source === "health-completion-only")?.details).toMatchObject({
      lifecycle: "COMPLETION_ONLY",
    });
  });

  it("returns factual counters from the latest run", async () => {
    await recordIngestionRun(h.db, {
      source: "health-factual",
      seen: 13,
      inserted: 5,
      updated: 7,
      statusChanges: 2,
      ok: true,
    });
    const row = (await latestRunsBySource(h.db)).find((run) => run.source === "health-factual");
    expect(row).toMatchObject({
      seen: 13,
      inserted: 5,
      updated: 7,
      statusChanges: 2,
      outcome: "COMPLETE",
    });
    expect(row?.recordedAt).toEqual(expect.any(String));
    expect(row?.lastDataAt).toEqual(expect.any(String));
  });

  it("keeps partial coverage distinct from a complete run", async () => {
    await recordIngestionRun(h.db, {
      source: "health-partial",
      seen: 4,
      ok: false,
      outcome: "PARTIAL",
      details: { gaps: ["one required section failed"] },
    });
    const row = (await latestRunsBySource(h.db)).find((run) => run.source === "health-partial");
    expect(row?.outcome).toBe("PARTIAL");
    expect(row?.lastSuccessAt).toBeNull();
    expect(row?.lastDataAt).toEqual(expect.any(String));
  });
});
