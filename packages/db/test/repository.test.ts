import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbHandle } from "../src/client.js";
import {
  beginIngestionRun,
  beginInitiativeProponentReconciliationRun,
  countDepositedInitiativesByProvince,
  countInitiativesByProvinceWithActive,
  countInitiatives,
  commissionsWithMembers,
  dashboardKpis,
  DIPUTADOS_PROPONENT_RESOLVER_VERSION,
  getActivityById,
  getActiveLegislatorProfileById,
  getLegislatorProfileById,
  getLegislatorInitiativeStats,
  getInitiativeById,
  getInitiativeRawBySourceId,
  getOfficialDepositedDocumentById,
  latestRunsBySource,
  listActivity,
  countActiveRosterByChamberParty,
  listDeposits,
  listDocuments,
  listOfficialDepositedDocumentsForVerification,
  listRecentDepositedInitiativesByProvince,
  listRecentInitiativesByProvince,
  listFeedItems,
  listInitiatives,
  listInitiativeProponentBackfillCandidates,
  listInitiativeProponents,
  listInitiativeTitleTranslationCandidates,
  listLegislatorPortraitCandidates,
  listLegislatorSummaries,
  listLegislators,
  listRecentStatusEvents,
  listRegulations,
  listSourceDocuments,
  legislatorCommittees,
  recordIngestionRun,
  recordStatusEvents,
  readCongressMovementDay,
  REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX,
  replaceRosterSnapshot,
  replaceInitiativeProponents,
  resolveActiveLegislatorProfileIds,
  resolveLegislatorProfileIds,
  regulatoryKpis,
  reconcileStatusHistorySnapshot,
  storeDocumentContent,
  storeDocumentPdfVerification,
  storeInitiativeTitleTranslation,
  finishInitiativeProponentReconciliationRun,
  upsertActivityEvent,
  upsertDocument,
  upsertFeedAccount,
  upsertFeedItem,
  upsertInitiative,
  upsertInitiativeCommissionAssignments,
  upsertRegulation,
  uniqueInitiativeIdByCode,
  withdrawInitiativeTitleTranslationsByModel,
} from "../src/repository.js";
import {
  activityEvents,
  activityInitiatives,
  documentPdfVerifications,
  documents,
  feedAccounts,
  feedItemEntities,
  feedItems,
  inferenceAudit,
  initiativeProponents,
  initiativeTitleTranslations,
  initiatives,
  regulations,
  statusEvents,
} from "../src/schema.js";
import type { DocumentSourceSnapshot, NewInitiative } from "../src/schema.js";

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

function documentSourceSnapshot(
  over: Partial<DocumentSourceSnapshot> = {},
): DocumentSourceSnapshot {
  return {
    initiativeId: null,
    source: "sil-diputados",
    sourceDocId: null,
    url: null,
    docType: null,
    uploadedAt: null,
    modifiedAt: null,
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

  it("reads the retained raw snapshot only by the exact source identity", async () => {
    const sourceId = "158418";
    const raw = { payload: { detail: { id: 159665 } } };
    await upsertInitiative(h.db, fixture({ sourceId, raw }));
    expect(await getInitiativeRawBySourceId(h.db, "sil-diputados", sourceId)).toEqual(raw);
    expect(await getInitiativeRawBySourceId(h.db, "senado-sil", sourceId)).toBeUndefined();
    expect(await getInitiativeRawBySourceId(h.db, "sil-diputados", "missing")).toBeUndefined();
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
        sourceChamber: "DIPUTADOS",
        originChamber: "SENADO",
        currentChamber: "SENADO",
        currentBody: "Comisión Permanente de Justicia",
        condition: "VIGENTE",
        subjectMatter: "JUSTICIA",
        initiated: "SI",
        initiatedAt: "2026-05-12",
        legislature: "2026-PLO",
        registrationPeriod: "2024-2028",
        officialStatusChangedAt: "2026-07-24T16:53:46.9759334",
        promulgationNumber: "18-26",
        promulgatedAt: "2026-08-01",
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
      sourceChamber: "DIPUTADOS",
      originChamber: "SENADO",
      currentChamber: "SENADO",
      currentBody: "Comisión Permanente de Justicia",
      condition: "VIGENTE",
      subjectMatter: "JUSTICIA",
      initiated: "SI",
      initiatedAt: "2026-05-12",
      legislature: "2026-PLO",
      registrationPeriod: "2024-2028",
      officialStatusChangedAt: "2026-07-24T16:53:46.9759334",
      promulgationNumber: "18-26",
      promulgatedAt: "2026-08-01",
      raw: { proponents: [{ name: "Ana Pérez" }] },
    });
  });
});

describe("HOME province initiative sample", () => {
  it("counts active initiatives only from the literal normalized source condition", async () => {
    const province = "Provincia conteo vigente";
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-count-active-spaces",
        province,
        condition: "  vigente  ",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-count-active-casing",
        province,
        condition: "ViGeNtE",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-count-not-active",
        province,
        condition: "NO VIGENTE",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-count-status-is-not-condition",
        province,
        condition: "ARCHIVADA",
        status: "VIGENTE",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-count-null-province",
        province: null,
        condition: "VIGENTE",
      }),
    );

    const rows = await countInitiativesByProvinceWithActive(h.db);
    expect(rows.find((row) => row.province === province)).toEqual({
      province,
      total: 4,
      active: 2,
    });
    expect(rows.every((row) => typeof row.province === "string")).toBe(true);
  });

  it("returns only the newest bounded rows for each explicitly reported province", async () => {
    const province = "Provincia ventana de prueba";
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-window-old",
        title: "Mapa provincial: antigua",
        province,
        filedAt: "2026-01-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-window-middle",
        title: "Mapa provincial: intermedia",
        province,
        filedAt: "2026-02-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-window-new",
        title: "Mapa provincial: reciente",
        province,
        filedAt: "2026-03-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-window-unknown",
        title: "Mapa provincial: sin provincia",
        province: null,
        filedAt: "2026-04-01",
      }),
    );

    const rows = (await listRecentInitiativesByProvince(h.db, 2)).filter(
      (row) => row.province === province,
    );
    expect(rows.map((row) => row.title)).toEqual([
      "Mapa provincial: reciente",
      "Mapa provincial: intermedia",
    ]);
    expect(rows.every((row) => row.province === province)).toBe(true);
  });

  it("counts only exact source-reported deposited statuses for non-null provinces", async () => {
    const province = "Provincia conteo depositado literal";
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-count-standard",
        province,
        status: "Depositado",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-count-normalized",
        province,
        status: "  dEpOsItAdO  ",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-count-procedural",
        province,
        status: "En comisión",
        condition: "DEPOSITADO",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-count-partial-label",
        province,
        status: "Depositado en revisión",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-count-null-province",
        province: null,
        status: "Depositado",
      }),
    );
    const provinceWithoutDeposits = "Provincia sin estado depositado";
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-count-no-match",
        province: provinceWithoutDeposits,
        status: "Aprobado",
      }),
    );

    const rows = await countDepositedInitiativesByProvince(h.db);
    expect(rows.find((row) => row.province === province)).toEqual({ province, total: 2 });
    expect(rows.some((row) => row.province === provinceWithoutDeposits)).toBe(false);
    expect(rows.every((row) => typeof row.province === "string")).toBe(true);
  });

  it("returns the newest exact deposited rows per province with deterministic ordering", async () => {
    const province = "Provincia ventana depositada";
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-window-old",
        title: "Depositada: antigua",
        province,
        status: "Depositado",
        filedAt: "2026-01-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-window-tie-first",
        title: "Depositada: empate primero",
        province,
        status: "Depositado",
        filedAt: "2026-03-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-window-tie-second",
        title: "Depositada: empate segundo",
        province,
        status: "Depositado",
        filedAt: "2026-03-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-window-new",
        title: "Depositada: reciente",
        province,
        status: "  DEPOSITADO ",
        filedAt: "2026-04-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-window-undated",
        title: "Depositada: sin fecha",
        province,
        status: "Depositado",
        filedAt: null,
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-window-nonmatch",
        title: "No depositada aunque sea más reciente",
        province,
        status: "En comisión",
        filedAt: "2026-12-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "province-deposited-window-null-province",
        title: "Depositada sin provincia",
        province: null,
        status: "Depositado",
        filedAt: "2027-01-01",
      }),
    );

    const bounded = (await listRecentDepositedInitiativesByProvince(h.db, 3)).filter(
      (row) => row.province === province,
    );
    expect(bounded.map((row) => row.title)).toEqual([
      "Depositada: reciente",
      "Depositada: empate segundo",
      "Depositada: empate primero",
    ]);
    expect(bounded.every((row) => row.status?.trim().toUpperCase() === "DEPOSITADO")).toBe(true);

    const all = (await listRecentDepositedInitiativesByProvince(h.db, 12)).filter(
      (row) => row.province === province,
    );
    expect(all.map((row) => row.title)).toEqual([
      "Depositada: reciente",
      "Depositada: empate segundo",
      "Depositada: empate primero",
      "Depositada: antigua",
      "Depositada: sin fecha",
    ]);
    expect(all.every((row) => row.province === province)).toBe(true);
  });
});

describe("initiative title translations", () => {
  it("lists only missing exact-title/model candidates and stores retries idempotently", async () => {
    const initiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-idempotent",
        title: "Proyecto de ley sobre archivos públicos",
        province: "Provincia traducción idempotente",
      }),
    );
    const [candidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: " translation-model-a ",
      initiativeIds: [initiative.id],
    });
    expect(candidate).toMatchObject({
      initiativeId: initiative.id,
      targetLocale: "en",
      sourceTitle: "Proyecto de ley sobre archivos públicos",
      model: "translation-model-a",
    });
    expect(candidate?.sourceTitleHash).toMatch(/^[a-f0-9]{64}$/);

    const first = await storeInitiativeTitleTranslation(h.db, {
      ...candidate!,
      translatedTitle: "Public Records Bill",
    });
    const retry = await storeInitiativeTitleTranslation(h.db, {
      ...candidate!,
      translatedTitle: "A retry must not overwrite the first result",
    });
    expect(first?.inserted).toBe(true);
    expect(retry).toMatchObject({
      inserted: false,
      row: { id: first?.row.id, translatedTitle: "Public Records Bill" },
    });

    expect(
      await listInitiativeTitleTranslationCandidates(h.db, {
        model: candidate!.model,
        initiativeIds: [initiative.id],
      }),
    ).toEqual([]);
    expect(
      await listInitiativeTitleTranslationCandidates(h.db, {
        model: "translation-model-b",
        initiativeIds: [initiative.id],
      }),
    ).toHaveLength(1);
  });

  it("supports explicit-id keyset selection without leaking other initiatives", async () => {
    const older = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-page-older",
        title: "Título de paginación anterior",
      }),
    );
    const newer = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-page-newer",
        title: "Título de paginación posterior",
      }),
    );
    const rows = await listInitiativeTitleTranslationCandidates(h.db, {
      model: "translation-pagination-model",
      initiativeIds: [older.id, newer.id],
      beforeId: newer.id,
      limit: 100,
    });
    expect(rows.map((row) => row.initiativeId)).toEqual([older.id]);
  });

  it("skips visibly truncated list-only source titles until a complete title arrives", async () => {
    const ascii = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-truncated-ascii",
        title: "Proyecto de ley todavía incompleto...   ",
      }),
    );
    const unicode = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-truncated-unicode",
        title: "Proyecto de ley todavía incompleto…",
      }),
    );
    const complete = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-complete-after-list",
        title: "Proyecto de ley con título completo.",
      }),
    );

    const candidates = await listInitiativeTitleTranslationCandidates(h.db, {
      model: "translation-truncation-model",
      initiativeIds: [ascii.id, unicode.id, complete.id],
      limit: 100,
    });
    expect(candidates.map((candidate) => candidate.initiativeId)).toEqual([complete.id]);
  });

  it("joins the latest translation only for the exact current official title", async () => {
    const province = "Provincia traducción vigente";
    const initiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-current-join",
        title: "Proyecto de ley con título oficial vigente",
        province,
        status: "Depositado",
        filedAt: "2026-08-28",
      }),
    );
    const [firstCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: "automatic-unreviewed-model",
      initiativeIds: [initiative.id],
    });
    const first = await storeInitiativeTitleTranslation(h.db, {
      ...firstCandidate!,
      translatedTitle: "Automatic Output Must Remain Invisible",
    });
    expect(
      (await listRecentDepositedInitiativesByProvince(h.db, 12)).find(
        (row) => row.id === initiative.id,
      )?.titleEn,
    ).toBeNull();
    expect((await getInitiativeById(h.db, initiative.id))?.titleEn).toBeNull();
    const [secondCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: `${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}join-model-b`,
      initiativeIds: [initiative.id],
    });
    const latest = await storeInitiativeTitleTranslation(h.db, {
      ...secondCandidate!,
      translatedTitle: "Latest Current Official Title Translation",
    });

    const deposited = (await listRecentDepositedInitiativesByProvince(h.db, 12)).find(
      (row) => row.id === initiative.id,
    );
    expect(deposited).toMatchObject({
      title: "Proyecto de ley con título oficial vigente",
      titleEn: "Latest Current Official Title Translation",
    });
    expect(await getInitiativeById(h.db, initiative.id)).toMatchObject({
      title: "Proyecto de ley con título oficial vigente",
      titleEn: "Latest Current Official Title Translation",
    });
    expect(
      (await listInitiatives(h.db, { search: "título oficial vigente" })).rows[0],
    ).toMatchObject({
      id: initiative.id,
      title: "Proyecto de ley con título oficial vigente",
      titleEn: "Latest Current Official Title Translation",
    });
    expect(
      (await listInitiatives(h.db, { search: "Current Official Title Translation" })).rows.map(
        (row) => row.id,
      ),
    ).toContain(initiative.id);
    expect(latest!.row.id).toBeGreaterThan(first!.row.id);
    expect(
      (await listRecentInitiativesByProvince(h.db, 12)).find((row) => row.id === initiative.id)
        ?.titleEn,
    ).toBe("Latest Current Official Title Translation");
  });

  it("adds a current exact English title to feed tags while preserving the official title", async () => {
    const sourceId = "title-translation-feed-tag";
    const code = "FEED-TRANSLATION-1";
    const initiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId,
        code,
        title: "Título oficial para la señal legislativa",
        chamber: "DIPUTADOS",
      }),
    );
    const [candidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: `${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}feed-model`,
      initiativeIds: [initiative.id],
    });
    await storeInitiativeTitleTranslation(h.db, {
      ...candidate!,
      translatedTitle: "Official Title for the Legislative Signal",
    });
    await upsertFeedItem(
      h.db,
      {
        source: "translation-feed-test",
        sourceId: "translation-feed-test-item",
        kind: "LEGISLATIVE",
        title: "Señal legislativa",
        chamber: "DIPUTADOS",
      },
      [{ entityType: "INITIATIVE", initiativeCode: code, label: code }],
    );

    const current = (await listFeedItems(h.db, {}, { limit: 100 })).items.find(
      (item) => item.sourceId === "translation-feed-test-item",
    );
    expect(current?.tags[0]).toMatchObject({
      initiativeTitle: "Título oficial para la señal legislativa",
      initiativeTitleEn: "Official Title for the Legislative Signal",
    });

    await upsertInitiative(
      h.db,
      fixture({
        sourceId,
        code,
        title: "Título oficial revisado para la señal legislativa",
        chamber: "DIPUTADOS",
      }),
    );
    const revised = (await listFeedItems(h.db, {}, { limit: 100 })).items.find(
      (item) => item.sourceId === "translation-feed-test-item",
    );
    expect(revised?.tags[0]).toMatchObject({
      initiativeTitle: "Título oficial revisado para la señal legislativa",
      initiativeTitleEn: null,
    });
  });

  it("withdraws bounded exact-model batches, hides them, and reactivates a corrected retry", async () => {
    const model = `${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}withdrawal-model`;
    const province = "Provincia traducción retirada";
    const code = "WITHDRAW-TRANSLATION-1";
    const target = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-withdraw-target",
        code,
        title: "Título oficial con traducción a retirar",
        province,
        status: "Depositado",
        filedAt: "2026-08-29",
      }),
    );
    const [targetCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model,
      initiativeIds: [target.id],
    });
    const original = await storeInitiativeTitleTranslation(h.db, {
      ...targetCandidate!,
      translatedTitle: "Bad Translation to Withdraw",
    });
    await upsertFeedItem(
      h.db,
      {
        source: "translation-withdrawal-feed-test",
        sourceId: "translation-withdrawal-feed-item",
        kind: "LEGISLATIVE",
        title: "Señal con traducción retirable",
        chamber: "DIPUTADOS",
      },
      [{ entityType: "INITIATIVE", initiativeCode: code, label: code }],
    );

    const second = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-withdraw-second",
        title: "Segundo título del mismo modelo",
      }),
    );
    const [secondCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model,
      initiativeIds: [second.id],
    });
    await storeInitiativeTitleTranslation(h.db, {
      ...secondCandidate!,
      translatedTitle: "Second Title from the Same Model",
    });

    const otherModel = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-withdraw-other-model",
        title: "Título de otro modelo",
      }),
    );
    const [otherModelCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: `${model}-other`,
      initiativeIds: [otherModel.id],
    });
    const unaffected = await storeInitiativeTitleTranslation(h.db, {
      ...otherModelCandidate!,
      translatedTitle: "Title from Another Model",
    });

    expect(await withdrawInitiativeTitleTranslationsByModel(h.db, { model, limit: 1 })).toBe(1);
    expect(
      (await listRecentDepositedInitiativesByProvince(h.db, 12)).find((row) => row.id === target.id)
        ?.titleEn,
    ).toBeNull();
    const withdrawnFeed = (await listFeedItems(h.db, {}, { limit: 100 })).items.find(
      (item) => item.sourceId === "translation-withdrawal-feed-item",
    );
    expect(withdrawnFeed?.tags[0]?.initiativeTitleEn).toBeNull();

    const [retryCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model,
      initiativeIds: [target.id],
    });
    expect(retryCandidate?.sourceTitleHash).toBe(targetCandidate?.sourceTitleHash);
    expect(await withdrawInitiativeTitleTranslationsByModel(h.db, { model, limit: 1 })).toBe(1);
    expect(await withdrawInitiativeTitleTranslationsByModel(h.db, { model })).toBe(0);

    const corrected = await storeInitiativeTitleTranslation(h.db, {
      ...retryCandidate!,
      translatedTitle: "Corrected Translation after Withdrawal",
    });
    expect(corrected).toMatchObject({
      inserted: false,
      row: {
        id: original?.row.id,
        translatedTitle: "Corrected Translation after Withdrawal",
        withdrawnAt: null,
      },
    });
    expect(
      await listInitiativeTitleTranslationCandidates(h.db, {
        model,
        initiativeIds: [target.id],
      }),
    ).toEqual([]);
    expect(
      (await listRecentDepositedInitiativesByProvince(h.db, 12)).find((row) => row.id === target.id)
        ?.titleEn,
    ).toBe("Corrected Translation after Withdrawal");
    const correctedFeed = (await listFeedItems(h.db, {}, { limit: 100 })).items.find(
      (item) => item.sourceId === "translation-withdrawal-feed-item",
    );
    expect(correctedFeed?.tags[0]?.initiativeTitleEn).toBe(
      "Corrected Translation after Withdrawal",
    );

    const [unaffectedRow] = await h.db
      .select({ withdrawnAt: initiativeTitleTranslations.withdrawnAt })
      .from(initiativeTitleTranslations)
      .where(eq(initiativeTitleTranslations.id, unaffected!.row.id));
    expect(unaffectedRow?.withdrawnAt).toBeNull();
  });

  it("invalidates old output after a title change and refuses an in-flight stale insert", async () => {
    const province = "Provincia traducción invalidada";
    const sourceId = "title-translation-source-refresh";
    const initiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId,
        title: "Título oficial antes de la corrección",
        province,
        status: "Depositado",
        filedAt: "2026-08-27",
      }),
    );
    const [oldCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: "translation-refresh-model",
      initiativeIds: [initiative.id],
    });
    await storeInitiativeTitleTranslation(h.db, {
      ...oldCandidate!,
      translatedTitle: "Official Title Before the Correction",
    });

    await upsertInitiative(
      h.db,
      fixture({
        sourceId,
        title: "Título oficial después de la corrección",
        province,
        status: "Depositado",
        filedAt: "2026-08-27",
      }),
    );
    expect(
      (await listRecentDepositedInitiativesByProvince(h.db, 12)).find(
        (row) => row.id === initiative.id,
      )?.titleEn,
    ).toBeNull();
    expect((await getInitiativeById(h.db, initiative.id))?.titleEn).toBeNull();

    const [currentCandidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: "translation-refresh-model",
      initiativeIds: [initiative.id],
    });
    expect(currentCandidate?.sourceTitle).toBe("Título oficial después de la corrección");

    await upsertInitiative(
      h.db,
      fixture({
        sourceId,
        title: "Título oficial corregido nuevamente",
        province,
        status: "Depositado",
        filedAt: "2026-08-27",
      }),
    );
    expect(
      await storeInitiativeTitleTranslation(h.db, {
        ...currentCandidate!,
        translatedTitle: "This Result Arrived Too Late",
      }),
    ).toBeNull();

    const persisted = await h.db
      .select()
      .from(initiativeTitleTranslations)
      .where(eq(initiativeTitleTranslations.initiativeId, initiative.id));
    expect(persisted.map((row) => row.sourceTitle)).toEqual([
      "Título oficial antes de la corrección",
    ]);
  });

  it("rejects unsupported locales and invalid or mismatched source-title hashes", async () => {
    const initiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "title-translation-validation",
        title: "Título para validar traducciones",
      }),
    );
    const [candidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: "translation-validation-model",
      initiativeIds: [initiative.id],
    });

    await expect(
      storeInitiativeTitleTranslation(h.db, {
        ...candidate!,
        targetLocale: "es",
        translatedTitle: "No debe persistirse",
      }),
    ).rejects.toThrow("targetLocale must be en");
    await expect(
      storeInitiativeTitleTranslation(h.db, {
        ...candidate!,
        sourceTitleHash: "a".repeat(64),
        translatedTitle: "Must Not Persist",
      }),
    ).rejects.toThrow("sourceTitleHash does not match sourceTitle");
    await expect(
      h.db.insert(initiativeTitleTranslations).values({
        initiativeId: initiative.id,
        targetLocale: "en",
        sourceTitle: candidate!.sourceTitle,
        sourceTitleHash: "not-a-sha256",
        translatedTitle: "Invalid Hash",
        model: "direct-invalid-hash",
      }),
    ).rejects.toThrow();
    await expect(
      h.db.insert(initiativeTitleTranslations).values({
        initiativeId: initiative.id,
        targetLocale: "fr",
        sourceTitle: candidate!.sourceTitle,
        sourceTitleHash: candidate!.sourceTitleHash,
        translatedTitle: "Invalid Locale",
        model: "direct-invalid-locale",
      }),
    ).rejects.toThrow();
  });
});

describe("initiative catalog source-literal filters", () => {
  it("normalizes exact status and explicit province values without mapping aliases", async () => {
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-filter-national-deposited",
        title: "Catálogo Nacional depositado",
        province: "  Nacional  ",
        status: " dEpOsItAdO ",
        filedAt: "2026-08-01",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-filter-national-partial-status",
        title: "Catálogo Nacional etiqueta parcial",
        province: "Nacional",
        status: "Depositado en revisión",
        filedAt: "2026-08-02",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-filter-distrito-deposited",
        title: "Catálogo Distrito Nacional depositado",
        province: "Distrito Nacional",
        status: "Depositado",
        filedAt: "2026-08-03",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-filter-monte-cristi",
        title: "Catálogo Monte Cristi",
        province: "Monte Cristi",
        status: "Depositado",
        filedAt: "2026-08-04",
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-filter-montecristi",
        title: "Catálogo Montecristi",
        province: "Montecristi",
        status: "Depositado",
        filedAt: "2026-08-05",
      }),
    );

    const nacional = await listInitiatives(h.db, {
      status: "  depositado ",
      provinceValues: [" nacional "],
      pageSize: 20,
    });
    expect(nacional.rows.map((row) => row.sourceId)).toEqual(["catalog-filter-national-deposited"]);
    expect(nacional.total).toBe(1);
    expect(nacional.rows.some((row) => row.sourceId === "catalog-filter-distrito-deposited")).toBe(
      false,
    );

    const monteCristiAliases = await listInitiatives(h.db, {
      status: "Depositado",
      provinceValues: [" monte cristi ", "MONTECRISTI", "Monte Cristi"],
      pageSize: 20,
    });
    expect(monteCristiAliases.rows.map((row) => row.sourceId)).toEqual([
      "catalog-filter-montecristi",
      "catalog-filter-monte-cristi",
    ]);
    expect(monteCristiAliases.total).toBe(2);
  });

  it("filters deposited initiatives by every exact official proponent id without using names", async () => {
    const legislatorSourceId = "9912345";
    const sharedName = "Persona con nombre compartido";
    const party = "PARTIDO-FILTRO-PROPONENTE";

    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-proponent-principal",
        code: "PROPONENTE-PRINCIPAL",
        title: "Iniciativa atribuida como proponente principal",
        status: "En comisión",
        party,
        filedAt: "2097-09-10",
        raw: {
          payload: {
            proponentes: [
              {
                principal: true,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-proponent-coproponent",
        code: "PROPONENTE-COPROPONENTE",
        title: "Iniciativa atribuida como coproponente",
        status: "Aprobado",
        party,
        filedAt: "2097-09-09",
        raw: {
          payload: {
            proponentes: [
              { principal: true, legisladorId: 8877001, nombreCompleto: "Otra persona" },
              {
                principal: false,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
              {
                principal: false,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
    );
    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "catalog-proponent-legacy",
        code: "PROPONENTE-LEGACY",
        title: "Iniciativa con colección legacy de proponentes",
        status: "Depositado",
        party: "PARTIDO-LEGACY-PROPONENTE",
        filedAt: "2097-09-08",
        raw: {
          payload: {
            proponents: [
              {
                principal: true,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
    );

    const excluded = [
      fixture({
        sourceId: "catalog-proponent-name-only",
        code: "PROPONENTE-NOMBRE-SIN-ID",
        title: "Mismo nombre sin identificador oficial",
        filedAt: "2097-09-07",
        raw: {
          payload: { proponentes: [{ principal: true, nombreCompleto: sharedName }] },
        },
      }),
      fixture({
        sourceId: "catalog-proponent-other-id",
        code: "PROPONENTE-OTRO-ID",
        title: "Otro identificador oficial",
        filedAt: "2097-09-06",
        raw: {
          payload: {
            proponentes: [{ principal: true, legisladorId: 9912346, nombreCompleto: sharedName }],
          },
        },
      }),
      fixture({
        sourceId: "catalog-proponent-authoritative-empty",
        code: "PROPONENTE-COLECCION-AUTORITATIVA-VACIA",
        title: "La colección observada vacía prevalece sobre el legado",
        filedAt: "2097-09-06",
        raw: {
          payload: {
            proponentes: [],
            proponents: [
              {
                principal: true,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
      fixture({
        sourceId: "catalog-proponent-missing-date",
        code: "PROPONENTE-SIN-FECHA",
        title: "Identificador exacto sin fecha publicada",
        filedAt: null,
        raw: {
          payload: {
            proponentes: [
              {
                principal: true,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
      fixture({
        sourceId: "catalog-proponent-blank-date",
        code: "PROPONENTE-FECHA-VACIA",
        title: "Identificador exacto con fecha vacía",
        filedAt: "   ",
        raw: {
          payload: {
            proponentes: [
              {
                principal: true,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
      fixture({
        source: "senado-sil",
        sourceId: "catalog-proponent-senate-source",
        code: "PROPONENTE-FUENTE-SENADO",
        title: "Identificador coincidente en otra fuente",
        chamber: "SENADO",
        filedAt: "2097-09-11",
        raw: {
          payload: {
            proponentes: [
              {
                principal: true,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
      fixture({
        sourceId: "catalog-proponent-regulatory-kind",
        code: "PROPONENTE-TIPO-REGULATORIO",
        title: "Identificador coincidente en registro no legislativo",
        kind: "REGULATORY",
        filedAt: "2097-09-12",
        raw: {
          payload: {
            proponentes: [
              {
                principal: true,
                legisladorId: Number(legislatorSourceId),
                nombreCompleto: sharedName,
              },
            ],
          },
        },
      }),
    ];
    for (const row of excluded) await upsertInitiative(h.db, row);

    const firstPage = await listInitiatives(h.db, {
      proponentLegislatorSourceId: `  ${legislatorSourceId}  `,
      page: 1,
      pageSize: 2,
    });
    expect(firstPage).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(firstPage.rows.map((row) => row.sourceId)).toEqual([
      "catalog-proponent-principal",
      "catalog-proponent-coproponent",
    ]);

    const secondPage = await listInitiatives(h.db, {
      proponentLegislatorSourceId: legislatorSourceId,
      page: 2,
      pageSize: 2,
    });
    expect(secondPage).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(secondPage.rows.map((row) => row.sourceId)).toEqual(["catalog-proponent-legacy"]);

    const combined = await listInitiatives(h.db, {
      proponentLegislatorSourceId: legislatorSourceId,
      party,
      search: "atribuida",
      pageSize: 20,
    });
    expect(combined.total).toBe(2);
    expect(combined.rows.map((row) => row.sourceId)).toEqual([
      "catalog-proponent-principal",
      "catalog-proponent-coproponent",
    ]);

    expect(
      await listInitiatives(h.db, { proponentLegislatorSourceId: "   ", pageSize: 20 }),
    ).toMatchObject({ total: 0, rows: [] });
  });
});

describe("recordStatusEvents", () => {
  it("reconciles complete source snapshots without erasing corrections or independent evidence", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "reconciled-history", code: "RECONCILED-HISTORY" }),
    );
    const day = new Date().toISOString().slice(0, 10);
    await recordStatusEvents(h.db, id, [
      {
        status: "Cambio observado",
        date: null,
        note: null,
        source: "sil-diputados",
        evidenceType: "OBSERVED_CHANGE",
      },
      {
        sourceEventId: "independent-1",
        status: "Fuente independiente",
        date: day,
        note: null,
        source: "otra-fuente-oficial",
        evidenceType: "SOURCE_HISTORY",
        raw: { id: "independent-1" },
      },
    ]);
    const firstSnapshot = [
      {
        sourceEventId: "official-1",
        status: "Versión original",
        date: day,
        endDate: day,
        note: null,
        raw: { id: "official-1", literal: "original" },
      },
      {
        sourceEventId: "official-2",
        status: "Movimiento retirado después",
        date: day,
        endDate: null,
        note: null,
        raw: { id: "official-2" },
      },
    ];
    const observedAt = new Date("2026-09-02T12:00:00.000Z");
    expect(
      await reconcileStatusHistorySnapshot(h.db, id, "sil-diputados", firstSnapshot, {
        complete: true,
        observedAt,
      }),
    ).toMatchObject({ inserted: 2, reactivated: 0, retired: 0, unchanged: 0, active: 2 });

    expect(
      await reconcileStatusHistorySnapshot(h.db, id, "sil-diputados", firstSnapshot, {
        complete: true,
        observedAt,
      }),
    ).toMatchObject({ inserted: 0, reactivated: 0, retired: 0, unchanged: 2, active: 2 });

    const correction = [
      {
        ...firstSnapshot[0]!,
        status: "Versión oficial corregida",
        raw: { id: "official-1", literal: "corregida" },
      },
    ];
    expect(
      await reconcileStatusHistorySnapshot(h.db, id, "sil-diputados", correction, {
        complete: true,
        observedAt: new Date("2026-09-02T13:00:00.000Z"),
      }),
    ).toMatchObject({ inserted: 1, reactivated: 0, retired: 2, unchanged: 0, active: 1 });

    const publicDetail = await getInitiativeById(h.db, id);
    expect(publicDetail?.events.map((event) => event.status).sort()).toEqual(
      ["Cambio observado", "Fuente independiente", "Versión oficial corregida"].sort(),
    );
    const recent = (await listRecentStatusEvents(h.db, { sinceDays: 2, limit: 1_000 })).filter(
      (event) => event.initiativeId === id,
    );
    expect(recent.map((event) => event.status)).toEqual(
      expect.arrayContaining([
        "Cambio observado",
        "Fuente independiente",
        "Versión oficial corregida",
      ]),
    );
    expect(recent.map((event) => event.status)).not.toEqual(
      expect.arrayContaining(["Versión original", "Movimiento retirado después"]),
    );
    const movementDay = await readCongressMovementDay(h.db, {
      date: day,
      chamber: "DIPUTADOS",
    });
    expect(movementDay.movements.map((movement) => movement.status)).toEqual(
      expect.arrayContaining(["Fuente independiente", "Versión oficial corregida"]),
    );
    expect(movementDay.movements.map((movement) => movement.status)).not.toEqual(
      expect.arrayContaining(["Versión original", "Movimiento retirado después"]),
    );
    const archived = await h.db
      .select({
        status: statusEvents.status,
        source: statusEvents.source,
        evidenceType: statusEvents.evidenceType,
        lastSeenAt: statusEvents.lastSeenAt,
        retiredAt: statusEvents.retiredAt,
      })
      .from(statusEvents)
      .where(eq(statusEvents.initiativeId, id));
    expect(archived.filter((event) => event.retiredAt)).toHaveLength(2);
    expect(
      archived.filter(
        (event) => event.source !== "sil-diputados" || event.evidenceType === "OBSERVED_CHANGE",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "Cambio observado", retiredAt: null }),
        expect.objectContaining({ status: "Fuente independiente", retiredAt: null }),
      ]),
    );

    // A complete later snapshot may reactivate the exact versions the source restores.
    expect(
      await reconcileStatusHistorySnapshot(h.db, id, "sil-diputados", firstSnapshot, {
        complete: true,
        observedAt: new Date("2026-09-02T14:00:00.000Z"),
      }),
    ).toMatchObject({ inserted: 0, reactivated: 2, retired: 1, unchanged: 0, active: 2 });
    expect((await getInitiativeById(h.db, id))?.events.map((event) => event.status)).not.toContain(
      "Versión oficial corregida",
    );

    // Invalid/partial observations fail before mutation; current versions stay visible.
    await expect(
      reconcileStatusHistorySnapshot(
        h.db,
        id,
        "sil-diputados",
        [{ ...firstSnapshot[0]!, status: "   " }],
        { complete: true },
      ),
    ).rejects.toThrow(/blank status/);
    await expect(
      reconcileStatusHistorySnapshot(h.db, id, "sil-diputados", [], {
        complete: false as true,
      }),
    ).rejects.toThrow(/partial/);
    expect(
      (await getInitiativeById(h.db, id))?.events
        .filter((event) => event.source === "sil-diputados")
        .map((event) => event.status),
    ).toEqual(
      expect.arrayContaining([
        "Cambio observado",
        "Versión original",
        "Movimiento retirado después",
      ]),
    );
  });

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

  it("keeps same-status/same-date official rows distinct by source event id", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "duplicate-official-history", code: "DUP-HISTORY" }),
    );
    const events = [
      {
        sourceEventId: "609826",
        status: "En Orden del Día",
        date: "2026-05-12",
        endDate: "2026-05-12",
        note: null,
        raw: { id: 609826, fin: "2026-05-12T00:00:00" },
      },
      {
        sourceEventId: "609684",
        status: "En Orden del Día",
        date: "2026-05-12",
        endDate: "2026-05-13",
        note: null,
        raw: { id: 609684, fin: "2026-05-13T00:00:00" },
      },
    ];
    expect(await recordStatusEvents(h.db, id, events)).toBe(2);
    expect(await recordStatusEvents(h.db, id, events)).toBe(0);

    const detail = await getInitiativeById(h.db, id);
    expect(
      detail?.events.map((event) => ({
        sourceEventId: event.sourceEventId,
        eventEndDate: event.eventEndDate,
      })),
    ).toEqual(
      expect.arrayContaining([
        { sourceEventId: "609826", eventEndDate: "2026-05-12" },
        { sourceEventId: "609684", eventEndDate: "2026-05-13" },
      ]),
    );
  });

  it("uses exact raw evidence as fallback only when an official event id is absent", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "fallback-history", code: "FALLBACK-HISTORY" }),
    );
    const base = {
      status: "En estudio",
      date: "2026-06-01",
      endDate: null,
      note: null,
      sourceEventId: null,
    };
    expect(
      await recordStatusEvents(h.db, id, [
        { ...base, raw: { literalSequence: 1 } },
        { ...base, raw: { literalSequence: 2 } },
      ]),
    ).toBe(2);
    expect(await recordStatusEvents(h.db, id, [{ ...base, raw: { literalSequence: 1 } }])).toBe(0);
  });

  it("backfills a safe SIL event id and end date from existing raw evidence", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "legacy-raw-history", code: "LEGACY-RAW-HISTORY" }),
    );
    await h.db.insert(statusEvents).values({
      initiativeId: id,
      status: "En Orden del Día",
      eventDate: "2026-05-12",
      source: "sil-diputados",
      evidenceType: "SOURCE_HISTORY",
      raw: { id: 700001, fin: "2026-05-14T00:00:00" },
    });

    await h.ensureSchema();
    const detail = await getInitiativeById(h.db, id);
    expect(detail?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceEventId: "700001",
          eventEndDate: "2026-05-14",
        }),
      ]),
    );
  });

  it("accepts real ISO calendar dates and ignores impossible ones without crashing", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "strict-iso-history", code: "STRICT-ISO-HISTORY" }),
    );
    const validDate = new Date().toISOString().slice(0, 10);
    await h.db.insert(statusEvents).values([
      {
        initiativeId: id,
        status: "Fecha oficial válida",
        eventDate: validDate,
        source: "sil-diputados",
        evidenceType: "SOURCE_HISTORY",
        raw: { id: 700002, fin: `${validDate}T00:00:00` },
      },
      {
        initiativeId: id,
        status: "Fecha oficial imposible",
        eventDate: "2026-02-31",
        source: "sil-diputados",
        evidenceType: "SOURCE_HISTORY",
        raw: { id: 700003, fin: "2026-02-31T00:00:00" },
      },
    ]);

    await h.ensureSchema();

    const stored = await h.db
      .select({ status: statusEvents.status, eventEndDate: statusEvents.eventEndDate })
      .from(statusEvents)
      .where(eq(statusEvents.initiativeId, id));
    expect(stored).toEqual(
      expect.arrayContaining([
        { status: "Fecha oficial válida", eventEndDate: validDate },
        { status: "Fecha oficial imposible", eventEndDate: null },
      ]),
    );

    const detail = await getInitiativeById(h.db, id);
    expect(detail?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "Fecha oficial válida", eventDate: validDate }),
        expect.objectContaining({
          status: "Fecha oficial imposible",
          eventDate: "2026-02-31",
        }),
      ]),
    );

    const recent = await listRecentStatusEvents(h.db, { sinceDays: 30 });
    expect(
      recent.some((event) => event.initiativeId === id && event.status === "Fecha oficial válida"),
    ).toBe(true);
    expect(
      recent.some(
        (event) => event.initiativeId === id && event.status === "Fecha oficial imposible",
      ),
    ).toBe(false);
  });

  it("orders recent initiative movements by effective event time and joins only the current reviewed English title", async () => {
    const isoDay = (daysAgo: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - daysAgo);
      return date.toISOString().slice(0, 10);
    };
    const older = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "home-movement-effective-old",
        code: "HOME-MOVEMENT-OLD",
        title: "Título oficial del movimiento anterior",
      }),
    );
    const newer = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "home-movement-effective-new",
        code: "HOME-MOVEMENT-NEW",
        title: "Título oficial del movimiento más reciente",
      }),
    );
    const [candidate] = await listInitiativeTitleTranslationCandidates(h.db, {
      model: `${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}home-movement-test`,
      initiativeIds: [newer.id],
    });
    await storeInitiativeTitleTranslation(h.db, {
      ...candidate!,
      translatedTitle: "Current reviewed title for the latest movement",
    });
    await recordStatusEvents(h.db, older.id, [
      {
        sourceEventId: "home-movement-old-event",
        status: "Movimiento anterior",
        date: isoDay(2),
        note: null,
      },
    ]);
    await recordStatusEvents(h.db, newer.id, [
      {
        sourceEventId: "home-movement-new-event",
        status: "Movimiento más reciente",
        date: isoDay(1),
        note: null,
      },
    ]);

    const movements = await listRecentStatusEvents(h.db, { sinceDays: 14, limit: 100 });
    const selected = movements.filter(
      (movement) => movement.initiativeId === older.id || movement.initiativeId === newer.id,
    );

    expect(selected.map((movement) => movement.initiativeId)).toEqual([newer.id, older.id]);
    expect(selected[0]).toMatchObject({
      code: "HOME-MOVEMENT-NEW",
      title: "Título oficial del movimiento más reciente",
      titleEn: "Current reviewed title for the latest movement",
      status: "Movimiento más reciente",
      eventDate: isoDay(1),
      evidenceType: "SOURCE_HISTORY",
    });
    expect(selected[0]!.effectiveAt).toContain(isoDay(1));
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

  it("keeps source-history and observed changes distinct across repeated schema bootstrap", async () => {
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

    await h.ensureSchema();
    await h.ensureSchema();

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

describe("initiative commission assignments", () => {
  it("keeps every assignment and upserts by official assignment id without deleting others", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "multiple-commissions", code: "MULTI-COM" }),
    );
    const assignments = [
      {
        sourceAssignmentId: "5245",
        sourceTypeId: "975",
        name: "Comisión especial para el estudio del proyecto",
        type: "Especial",
        startDate: "2026-05-19",
        endDate: "2026-06-17",
        raw: { id: 5245, tipoId: 975 },
      },
      {
        sourceAssignmentId: "4026",
        sourceTypeId: "974",
        name: "Interior y Policía",
        type: "Permanente",
        startDate: "2026-05-12",
        endDate: "2026-06-10",
        raw: { id: 4026, tipoId: 974 },
      },
    ];
    expect(
      await upsertInitiativeCommissionAssignments(h.db, id, "sil-diputados", assignments),
    ).toBe(2);
    expect(
      await upsertInitiativeCommissionAssignments(h.db, id, "sil-diputados", assignments),
    ).toBe(0);
    expect(
      await upsertInitiativeCommissionAssignments(h.db, id, "sil-diputados", [
        { ...assignments[1]!, endDate: "2026-06-11", raw: { id: 4026, tipoId: 974, rev: 2 } },
      ]),
    ).toBe(0);

    const detail = await getInitiativeById(h.db, id);
    expect(detail?.commissionAssignments).toHaveLength(2);
    expect(detail?.commissionAssignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceAssignmentId: "5245", type: "Especial" }),
        expect.objectContaining({
          sourceAssignmentId: "4026",
          name: "Interior y Policía",
          endDate: "2026-06-11",
          raw: { id: 4026, tipoId: 974, rev: 2 },
        }),
      ]),
    );
  });

  it("uses an exact append-safe fallback when the source publishes no assignment id", async () => {
    const { id } = await upsertInitiative(
      h.db,
      fixture({ sourceId: "commission-without-id", code: "COM-NO-ID" }),
    );
    const assignment = {
      sourceAssignmentId: null,
      sourceTypeId: "974",
      name: "Comisión de Justicia",
      type: "Permanente",
      startDate: "2026-05-12",
      endDate: null,
      raw: { tipoId: 974, literal: "Comisión de Justicia" },
    };
    expect(
      await upsertInitiativeCommissionAssignments(h.db, id, "sil-diputados", [assignment]),
    ).toBe(1);
    expect(
      await upsertInitiativeCommissionAssignments(h.db, id, "sil-diputados", [assignment]),
    ).toBe(0);
    expect((await getInitiativeById(h.db, id))?.commissionAssignments).toHaveLength(1);
  });
});

describe("official deposited-bill document selection", () => {
  async function deposit(sourceId: string, code: string, filedAt: string) {
    return upsertInitiative(
      h.db,
      fixture({
        sourceId,
        code,
        title: `Proyecto ${code}`,
        filedAt,
        chamber: "DIPUTADOS",
      }),
    );
  }

  async function billDocument(input: {
    initiativeId: number;
    initiativeCode: string;
    sourceDocId: string;
    url: string;
    uploadedAt: string;
    source?: string;
    docType?: string;
  }) {
    await upsertDocument(h.db, {
      source: input.source ?? "sil-diputados",
      sourceDocId: input.sourceDocId,
      initiativeId: input.initiativeId,
      initiativeCode: input.initiativeCode,
      docType: input.docType ?? "PROYECTO DEPOSITADO",
      extension: "pdf",
      url: input.url,
      uploadedAt: input.uploadedAt,
    });
  }

  it("chooses the newest upload regardless of insertion order, then the largest id", async () => {
    const filedAt = "2097-01-01";
    const oldFirst = await deposit("deposit-doc-old-first", "DOC-ORDER-A", filedAt);
    const newFirst = await deposit("deposit-doc-new-first", "DOC-ORDER-B", filedAt);
    const tied = await deposit("deposit-doc-tied", "DOC-ORDER-C", filedAt);
    const oldA = "https://www.diputadosrd.gob.do/documentos/doc-order-a-old.pdf";
    const newA = "https://www.diputadosrd.gob.do/documentos/doc-order-a-new.pdf";
    const oldB = "https://www.diputadosrd.gob.do/documentos/doc-order-b-old.pdf";
    const newB = "https://www.diputadosrd.gob.do/documentos/doc-order-b-new.pdf";
    const tiedFirst = "https://www.diputadosrd.gob.do/documentos/doc-order-c-first.pdf";
    const tiedLast = "https://www.diputadosrd.gob.do/documentos/doc-order-c-last.pdf";

    await billDocument({
      initiativeId: oldFirst.id,
      initiativeCode: "DOC-ORDER-A",
      sourceDocId: "doc-order-a-old",
      url: oldA,
      uploadedAt: "2096-01-01",
    });
    await billDocument({
      initiativeId: oldFirst.id,
      initiativeCode: "DOC-ORDER-A",
      sourceDocId: "doc-order-a-new",
      url: newA,
      uploadedAt: "2096-02-01",
    });
    await billDocument({
      initiativeId: newFirst.id,
      initiativeCode: "DOC-ORDER-B",
      sourceDocId: "doc-order-b-new",
      url: newB,
      uploadedAt: "2096-02-01",
    });
    await billDocument({
      initiativeId: newFirst.id,
      initiativeCode: "DOC-ORDER-B",
      sourceDocId: "doc-order-b-old",
      url: oldB,
      uploadedAt: "2096-01-01",
    });
    await billDocument({
      initiativeId: tied.id,
      initiativeCode: "DOC-ORDER-C",
      sourceDocId: "doc-order-c-first",
      url: tiedFirst,
      uploadedAt: "2096-03-01",
    });
    await billDocument({
      initiativeId: tied.id,
      initiativeCode: "DOC-ORDER-C",
      sourceDocId: "doc-order-c-last",
      url: tiedLast,
      uploadedAt: "2096-03-01",
    });

    const rows = await listDeposits(h.db, { dateFrom: filedAt });
    const byCode = new Map(rows.map((item) => [item.code, item]));
    expect(byCode.get("DOC-ORDER-A")).toMatchObject({
      docUrl: newA,
      docSource: "sil-diputados",
      docUploaded: true,
    });
    expect(byCode.get("DOC-ORDER-B")).toMatchObject({
      docUrl: newB,
      docSource: "sil-diputados",
      docUploaded: true,
    });
    expect(byCode.get("DOC-ORDER-C")?.docUrl).toBe(tiedLast);
  });

  it("skips a newer hostile or contextual URL in deposits and initiative lists", async () => {
    const filedAt = "2097-01-02";
    const initiative = await deposit("deposit-doc-hostile", "DOC-HOSTILE", filedAt);
    const eligible = "https://www.diputadosrd.gob.do/documentos/doc-hostile-safe.pdf";
    await billDocument({
      initiativeId: initiative.id,
      initiativeCode: "DOC-HOSTILE",
      sourceDocId: "doc-hostile-safe",
      url: eligible,
      uploadedAt: "2096-01-01",
    });
    await billDocument({
      initiativeId: initiative.id,
      initiativeCode: "DOC-HOSTILE",
      sourceDocId: "doc-hostile-newer",
      url: "https://diputadosrd.gob.do.evil.example/doc-hostile-newer.pdf",
      uploadedAt: "2096-03-01",
    });
    await billDocument({
      initiativeId: initiative.id,
      initiativeCode: "DOC-HOSTILE",
      sourceDocId: "doc-contextual-newest",
      url: "https://www.diputadosrd.gob.do/documentos/doc-contextual-newest.pdf",
      uploadedAt: "2096-04-01",
      docType: "ORDEN DEL DÍA DE COMISIÓN",
    });
    await billDocument({
      initiativeId: initiative.id,
      initiativeCode: "DOC-HOSTILE",
      sourceDocId: "doc-wrong-source-newest",
      url: "https://www.diputadosrd.gob.do/documentos/doc-wrong-source-newest.pdf",
      uploadedAt: "2096-05-01",
      source: "dip-oficial",
    });

    const [row] = await listDeposits(h.db, { dateFrom: filedAt });
    const storedDocuments = await listDocuments(h.db, initiative.id);
    const safeDocument = storedDocuments.find((document) => document.url === eligible)!;
    const contextualDocument = storedDocuments.find(
      (document) => document.sourceDocId === "doc-contextual-newest",
    )!;
    expect(row).toMatchObject({
      code: "DOC-HOSTILE",
      docId: safeDocument.id,
      docUrl: eligible,
      docSource: "sil-diputados",
      docType: "PROYECTO DEPOSITADO",
      docUploaded: true,
      docAvailable: false,
    });
    const initiativeRow = (await listInitiatives(h.db, { search: "DOC-HOSTILE" })).rows[0];
    expect(initiativeRow?.preferredDocumentUrl).toBe(eligible);
    expect(initiativeRow?.preferredDocumentId).toBe(safeDocument.id);
    expect(initiativeRow?.preferredDocumentAvailable).toBe(false);
    expect(safeDocument.pdfAvailable).toBe(false);
    expect(
      await getOfficialDepositedDocumentById(h.db, safeDocument.id, initiative.id),
    ).toMatchObject({ id: safeDocument.id, pdfAvailable: false });

    const verifiedText = "Texto oficial completo usado para verificar disponibilidad.";
    const safeSnapshot = documentSourceSnapshot({
      initiativeId: initiative.id,
      source: "sil-diputados",
      sourceDocId: "doc-hostile-safe",
      url: eligible,
      docType: "PROYECTO DEPOSITADO",
      uploadedAt: "2096-01-01",
      modifiedAt: null,
    });
    await storeDocumentContent(h.db, {
      documentId: safeDocument.id,
      contentHash: "9".repeat(64),
      contentText: verifiedText,
      mimeType: "application/pdf",
      byteSize: 4_096,
      pageCount: 2,
      characterCount: verifiedText.length,
      sourceSnapshot: safeSnapshot,
    });
    await storeDocumentPdfVerification(h.db, {
      documentId: safeDocument.id,
      sourceSnapshot: safeSnapshot,
      reachable: true,
      httpStatus: 200,
      mimeType: "application/pdf",
      byteSize: 4_096,
      finalUrl: eligible,
      errorCode: null,
      errorMessage: null,
    });
    expect(
      (await listDocuments(h.db, initiative.id)).find((document) => document.id === safeDocument.id)
        ?.pdfAvailable,
    ).toBe(true);
    expect(
      (await listInitiatives(h.db, { search: "DOC-HOSTILE" })).rows[0]?.preferredDocumentAvailable,
    ).toBe(true);
    expect((await listDeposits(h.db, { dateFrom: filedAt }))[0]?.docAvailable).toBe(true);
    expect(
      await getOfficialDepositedDocumentById(h.db, safeDocument.id, initiative.id),
    ).toMatchObject({
      id: safeDocument.id,
      initiativeId: initiative.id,
      initiativeSourceId: "deposit-doc-hostile",
      initiativeCode: "DOC-HOSTILE",
      source: "sil-diputados",
      docType: "PROYECTO DEPOSITADO",
      url: eligible,
      pdfAvailable: true,
    });
    expect(
      await getOfficialDepositedDocumentById(h.db, safeDocument.id, initiative.id + 1),
    ).toBeNull();
    expect(
      await getOfficialDepositedDocumentById(h.db, contextualDocument.id, initiative.id),
    ).toBeNull();
    expect(await getOfficialDepositedDocumentById(h.db, 0, initiative.id)).toBeNull();

    expect(
      await listOfficialDepositedDocumentsForVerification(h.db, {
        documentId: safeDocument.id,
        verificationDueOnly: true,
      }),
    ).toHaveLength(0);
    await h.db
      .update(documentPdfVerifications)
      .set({ verifiedAt: sql`now() - interval '13 hours'` })
      .where(eq(documentPdfVerifications.documentId, safeDocument.id));
    expect(
      (await listDocuments(h.db, initiative.id)).find((document) => document.id === safeDocument.id)
        ?.pdfAvailable,
    ).toBe(true);
    expect(
      await listOfficialDepositedDocumentsForVerification(h.db, {
        documentId: safeDocument.id,
        verificationDueOnly: true,
      }),
    ).toHaveLength(1);

    await h.db
      .update(documentPdfVerifications)
      .set({ verifiedAt: sql`now() - interval '25 hours'` })
      .where(eq(documentPdfVerifications.documentId, safeDocument.id));
    expect(
      (await listDocuments(h.db, initiative.id)).find((document) => document.id === safeDocument.id)
        ?.pdfAvailable,
    ).toBe(false);
    expect(
      await getOfficialDepositedDocumentById(h.db, safeDocument.id, initiative.id),
    ).toMatchObject({ id: safeDocument.id, pdfAvailable: false });
  });

  it("invalidates persisted availability when any source snapshot field changes", async () => {
    const filedAt = "2097-01-04";
    const initiative = await deposit("deposit-doc-revised", "DOC-REVISED", filedAt);
    const oldUrl = "https://www.diputadosrd.gob.do/documentos/doc-revised-v1.pdf";
    const newUrl = "https://www.diputadosrd.gob.do/documentos/doc-revised-v2.pdf";
    await billDocument({
      initiativeId: initiative.id,
      initiativeCode: "DOC-REVISED",
      sourceDocId: "doc-revised",
      url: oldUrl,
      uploadedAt: "2096-07-01",
    });
    const document = (await listDocuments(h.db, initiative.id))[0]!;
    const contentText = "Texto oficial de la primera versión del documento.";
    const originalSnapshot = documentSourceSnapshot({
      initiativeId: initiative.id,
      sourceDocId: "doc-revised",
      url: oldUrl,
      docType: "PROYECTO DEPOSITADO",
      uploadedAt: "2096-07-01",
    });
    await storeDocumentContent(h.db, {
      documentId: document.id,
      contentHash: "8".repeat(64),
      contentText,
      mimeType: "application/pdf",
      byteSize: 2_048,
      pageCount: 1,
      characterCount: contentText.length,
      sourceSnapshot: originalSnapshot,
    });
    await storeDocumentPdfVerification(h.db, {
      documentId: document.id,
      sourceSnapshot: originalSnapshot,
      reachable: true,
      httpStatus: 200,
      mimeType: "application/pdf",
      byteSize: 2_048,
      finalUrl: oldUrl,
      errorCode: null,
      errorMessage: null,
    });
    expect((await listDocuments(h.db, initiative.id))[0]?.pdfAvailable).toBe(true);

    expect(
      await upsertDocument(h.db, {
        source: "sil-diputados",
        sourceDocId: "doc-revised",
        initiativeId: initiative.id,
        initiativeCode: "DOC-REVISED",
        docType: "PROYECTO DEPOSITADO",
        extension: "pdf",
        url: newUrl,
        uploadedAt: "2096-07-01",
      }),
    ).toBe(false);
    const revised = (await listDocuments(h.db, initiative.id))[0]!;
    expect(revised.url).toBe(newUrl);
    expect(revised.pdfAvailable).toBe(false);
    expect(await getOfficialDepositedDocumentById(h.db, revised.id, initiative.id)).toMatchObject({
      id: revised.id,
      pdfAvailable: false,
    });
  });

  it("accepts direct PDFs on both official domains and the exact official viewer", async () => {
    const filedAt = "2097-01-03";
    const cases = [
      {
        sourceId: "deposit-doc-domain-diputados",
        code: "DOC-OFFICIAL-DIP",
        url: "https://www.diputadosrd.gob.do/documentos/doc-official-dip.pdf",
      },
      {
        sourceId: "deposit-doc-domain-camara",
        code: "DOC-OFFICIAL-CAM",
        url: "https://s-sil.camaradediputados.gob.do:8095/documentos/doc-official-cam.pdf?descarga=1",
      },
      {
        sourceId: "deposit-doc-viewer-camara",
        code: "DOC-OFFICIAL-VIEWER",
        url: "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=987",
      },
      {
        sourceId: "deposit-doc-viewer-casing",
        code: "DOC-OFFICIAL-VIEWER-CASE",
        url: "https://s-sil.camaradediputados.gob.do:8095/reportesgenerales/verdocumento?documentoId=988",
      },
    ] as const;
    for (const candidate of cases) {
      const initiative = await deposit(candidate.sourceId, candidate.code, filedAt);
      await billDocument({
        initiativeId: initiative.id,
        initiativeCode: candidate.code,
        sourceDocId: `${candidate.sourceId}-text`,
        url: candidate.url,
        uploadedAt: "2096-06-01",
      });
    }

    const rows = await listDeposits(h.db, { dateFrom: filedAt });
    const byCode = new Map(rows.map((item) => [item.code, item]));
    for (const candidate of cases) {
      expect(byCode.get(candidate.code)).toMatchObject({
        docUrl: candidate.url,
        docSource: "sil-diputados",
        docUploaded: true,
      });
    }
  });
});

describe("file-backed PGlite process safety", () => {
  it("rejects a second opener and releases the lock after close", { timeout: 15_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "oculis-process-lock-"));
    const previousUrl = process.env.DATABASE_URL;
    const previousDirectory = process.env.PGLITE_DIR;
    let first: DbHandle | null = null;
    let reopened: DbHandle | null = null;
    try {
      delete process.env.DATABASE_URL;
      process.env.PGLITE_DIR = directory;
      first = createDb();
      await first.ensureSchema();
      expect(() => createDb()).toThrow(/already open by PID/);
      await first.close();
      first = null;

      reopened = createDb();
      await reopened.ensureSchema();
    } finally {
      if (first) await first.close();
      if (reopened) await reopened.close();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousDirectory === undefined) delete process.env.PGLITE_DIR;
      else process.env.PGLITE_DIR = previousDirectory;
      rmSync(directory, { recursive: true, force: true });
      rmSync(`${directory}.oculis.lock`, { force: true });
    }
  });

  it("fails closed without changing empty or malformed lock metadata", async () => {
    for (const lockContents of ["", "not-json", JSON.stringify({ pid: "unknown" })]) {
      const directory = mkdtempSync(join(tmpdir(), "oculis-ambiguous-lock-"));
      const lockPath = `${directory}.oculis.lock`;
      const previousUrl = process.env.DATABASE_URL;
      const previousDirectory = process.env.PGLITE_DIR;
      try {
        writeFileSync(lockPath, lockContents, "utf8");
        delete process.env.DATABASE_URL;
        process.env.PGLITE_DIR = directory;

        expect(() => createDb()).toThrow(/has no valid owner PID/);
        expect(readFileSync(lockPath, "utf8")).toBe(lockContents);
      } finally {
        if (previousUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousUrl;
        if (previousDirectory === undefined) delete process.env.PGLITE_DIR;
        else process.env.PGLITE_DIR = previousDirectory;
        rmSync(directory, { recursive: true, force: true });
        rmSync(lockPath, { force: true });
      }
    }
  });

  it("uses one lock identity for real and symlinked directory paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "oculis-canonical-lock-"));
    const directory = join(root, "database");
    const alias = join(root, "database-alias");
    const previousUrl = process.env.DATABASE_URL;
    const previousDirectory = process.env.PGLITE_DIR;
    let first: DbHandle | null = null;
    let reopened: DbHandle | null = null;
    try {
      mkdirSync(directory);
      symlinkSync(directory, alias, "dir");
      delete process.env.DATABASE_URL;
      process.env.PGLITE_DIR = directory;
      first = createDb();
      await first.ensureSchema();

      process.env.PGLITE_DIR = alias;
      expect(() => createDb()).toThrow(/already open by PID/);
      await first.close();
      first = null;

      reopened = createDb();
      await reopened.ensureSchema();
    } finally {
      if (first) await first.close();
      if (reopened) await reopened.close();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousDirectory === undefined) delete process.env.PGLITE_DIR;
      else process.env.PGLITE_DIR = previousDirectory;
      rmSync(root, { recursive: true, force: true });
    }
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

  it("upgrades a legacy committee row to an exact source event and keeps its local URL stable", async () => {
    const base = {
      source: "sil-actividad",
      scope: "COMMITTEE" as const,
      chamber: "DIPUTADOS" as const,
      date: "2026-08-27",
      kind: "Reunión",
      body: "Comisión especial sobre discapacidad",
      description: "Presentar la iniciativa 05368-2024-2028-CD.",
      dedupeKey: "legacy-commission-fingerprint",
      initiativeCodes: [] as string[],
      raw: { endpoint: "comision/ordenes" },
    };
    const legacy = await upsertActivityEvent(h.db, {
      ...base,
      agendaUrl: "https://www.diputadosrd.gob.do/sil/comision/5243",
    });
    const enriched = await upsertActivityEvent(h.db, {
      ...base,
      sourceEventId: "161253",
      time: "09:30",
      location: "Salón Rafaela Alburquerque",
      agendaUrl: "https://www.diputadosrd.gob.do/sil/api/actividad/actividad/161253",
    });

    expect(enriched.id).toBe(legacy.id);
    expect(enriched.inserted).toBe(false);

    const edited = await upsertActivityEvent(h.db, {
      ...base,
      sourceEventId: "161253",
      dedupeKey: "edited-content-fingerprint",
      description: "Agenda oficial corregida.",
      time: "09:30",
      location: "Salón Rafaela Alburquerque",
      agendaUrl: "https://www.diputadosrd.gob.do/sil/api/actividad/actividad/161253",
    });
    expect(edited.id).toBe(legacy.id);

    const detail = await getActivityById(h.db, legacy.id);
    expect(detail).toMatchObject({
      id: legacy.id,
      sourceEventId: "161253",
      eventTime: "09:30",
      location: "Salón Rafaela Alburquerque",
      description: "Agenda oficial corregida.",
      agendaUrl: "https://www.diputadosrd.gob.do/sil/api/actividad/actividad/161253",
    });
    expect(
      (await listActivity(h.db, { date: "2026-08-27" })).filter((row) => row.id === legacy.id),
    ).toHaveLength(1);
  });

  it("retains previously verified activity identity, time, and location when a later calendar snapshot omits them", async () => {
    const base = {
      source: "sil-actividad",
      scope: "COMMITTEE" as const,
      chamber: "DIPUTADOS" as const,
      date: "2026-08-27",
      kind: "Reunión",
      body: "Comisión especial sobre discapacidad",
      description: "Presentar la iniciativa 05368-2024-2028-CD.",
      dedupeKey: "retained-calendar-observation",
      initiativeCodes: [] as string[],
      raw: { endpoint: "comision/ordenes" },
    };
    const first = await upsertActivityEvent(h.db, {
      ...base,
      sourceEventId: "99161253",
      time: "09:30:00",
      location: "Salón Rafaela Alburquerque",
      agendaUrl:
        "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?action=wpfd&task=file.download&wpfd_category_id=2245&wpfd_file_id=28988&preview=1",
    });

    const later = await upsertActivityEvent(h.db, {
      ...base,
      sourceEventId: null,
      time: null,
      location: null,
      agendaUrl:
        "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?action=wpfd&task=file.download&wpfd_category_id=2245&wpfd_file_id=28988&preview=1",
    });

    expect(later).toEqual({ id: first.id, inserted: false });
    expect(await getActivityById(h.db, first.id)).toMatchObject({
      sourceEventId: "99161253",
      eventTime: "09:30:00",
      location: "Salón Rafaela Alburquerque",
    });
  });

  it("preserves a verified agenda only during a catalog outage and clears an observed negative", async () => {
    const verifiedUrl =
      "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?action=wpfd&task=file.download&wpfd_category_id=2245&wpfd_file_id=28988&preview=1";
    const base = {
      source: "sil-actividad",
      scope: "COMMITTEE" as const,
      chamber: "DIPUTADOS" as const,
      date: "2026-08-27",
      kind: "Reunión",
      body: "Comisión de prueba",
      description: "Agenda de prueba.",
      dedupeKey: "agenda-catalog-outage",
      initiativeCodes: [] as string[],
      raw: {},
    };
    const first = await upsertActivityEvent(h.db, { ...base, agendaUrl: verifiedUrl });
    await upsertActivityEvent(h.db, {
      ...base,
      agendaUrl: null,
      preserveAgendaUrlOnNull: true,
    });
    expect((await getActivityById(h.db, first.id))?.agendaUrl).toBe(verifiedUrl);

    await upsertActivityEvent(h.db, {
      ...base,
      agendaUrl: null,
      preserveAgendaUrlOnNull: false,
    });
    expect((await getActivityById(h.db, first.id))?.agendaUrl).toBeNull();
  });

  it("removes legacy agenda links that only identify a commission or redirect to a homepage", async () => {
    const diputados = await upsertActivityEvent(h.db, {
      source: "sil-actividad",
      scope: "COMMITTEE",
      chamber: "DIPUTADOS",
      date: "2026-08-28",
      kind: "Reunión",
      body: "Comisión sin actividad exacta",
      description: "Agenda no cotejada.",
      agendaUrl: "https://www.diputadosrd.gob.do/sil/comision/5243",
      initiativeCodes: [],
      dedupeKey: "legacy-generic-diputados-agenda",
      raw: {},
    });
    const senado = await upsertActivityEvent(h.db, {
      source: "senado",
      scope: "COMMITTEE",
      chamber: "SENADO",
      date: "2026-08-28",
      kind: "Reunión",
      body: "Comisión con permalink obsoleto",
      description: "Agenda semanal.",
      agendaUrl: "https://www.senadord.gob.do/wpfd_file/agenda-semanal/",
      initiativeCodes: [],
      dedupeKey: "legacy-generic-senado-agenda",
      raw: {},
    });

    await h.ensureSchema();

    const rows = await h.db
      .select({ id: activityEvents.id, agendaUrl: activityEvents.agendaUrl })
      .from(activityEvents)
      .where(sql`${activityEvents.id} in (${diputados.id}, ${senado.id})`);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.agendaUrl === null)).toBe(true);
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
      ok: true,
      outcome: "PARTIAL",
      details: { gaps: ["the source explicitly reported no activity"] },
    });
    const row = (await latestRunsBySource(h.db)).find((run) => run.source === "health-partial");
    expect(row?.outcome).toBe("PARTIAL");
    expect(row?.lastSuccessAt).toEqual(expect.any(String));
    expect(row?.lastDataAt).toEqual(expect.any(String));
  });
});

describe("canonical legislator profile identity", () => {
  it("resolves only one active exact roster identity and joins commission members without names", async () => {
    const sharedSourceId = "identity-shared-88001";
    const diputadosSource = "identity-roster-diputados";
    const senadoSource = "identity-roster-senado";
    const commissionName = "Comisión de Identidad Canónica";
    await replaceRosterSnapshot(
      h.db,
      diputadosSource,
      [
        {
          source: diputadosSource,
          sourceId: sharedSourceId,
          chamber: "DIPUTADOS",
          fullName: "Persona Diputada Exacta",
          photoUrl: "https://www.diputadosrd.gob.do/fotos/persona-diputada-exacta.jpg",
        },
      ],
      [
        {
          source: diputadosSource,
          chamber: "DIPUTADOS",
          commissionName,
          legislatorName: "Persona Diputada Exacta",
          legislatorSourceId: sharedSourceId,
          cargo: "Presidente",
        },
        {
          source: diputadosSource,
          chamber: "DIPUTADOS",
          commissionName,
          legislatorName: "Persona con nombre pero identidad desconocida",
          legislatorSourceId: "identity-missing-source-id",
          cargo: "Miembro",
        },
      ],
    );
    await replaceRosterSnapshot(
      h.db,
      senadoSource,
      [
        {
          source: senadoSource,
          sourceId: sharedSourceId,
          chamber: "SENADO",
          fullName: "Persona Senadora Exacta",
        },
      ],
      [],
    );

    const roster = await listLegislators(h.db);
    const deputy = roster.find(
      (row) => row.source === diputadosSource && row.sourceId === sharedSourceId,
    )!;
    const senator = roster.find(
      (row) => row.source === senadoSource && row.sourceId === sharedSourceId,
    )!;
    const summary = (await listLegislatorSummaries(h.db)).find(
      (row) => row.profileId === deputy.id,
    )!;
    expect(Object.keys(summary).sort()).toEqual(
      ["profileId", "fullName", "chamber", "role", "party", "province"].sort(),
    );
    expect(summary).toMatchObject({
      profileId: deputy.id,
      fullName: "Persona Diputada Exacta",
      chamber: "DIPUTADOS",
    });
    const portrait = (
      await listLegislatorPortraitCandidates(h.db, { chamber: "DIPUTADOS", limit: 64 })
    ).find((row) => row.profileId === deputy.id)!;
    expect(Object.keys(portrait).sort()).toEqual(
      [
        "profileId",
        "source",
        "fullName",
        "chamber",
        "role",
        "party",
        "province",
        "photoUrl",
      ].sort(),
    );
    expect(portrait).toMatchObject({
      profileId: deputy.id,
      source: diputadosSource,
      photoUrl: "https://www.diputadosrd.gob.do/fotos/persona-diputada-exacta.jpg",
    });
    expect(
      await resolveActiveLegislatorProfileIds(h.db, [
        { sourceId: sharedSourceId },
        { sourceId: sharedSourceId, chamber: "DIPUTADOS" },
        { sourceId: sharedSourceId, chamber: "SENADO" },
        { source: diputadosSource, sourceId: sharedSourceId },
        { source: "wrong-source", sourceId: sharedSourceId },
      ]),
    ).toEqual([null, deputy.id, senator.id, deputy.id, null]);
    expect(await getActiveLegislatorProfileById(h.db, deputy.id)).toMatchObject({
      id: deputy.id,
      fullName: "Persona Diputada Exacta",
    });

    const commission = (await commissionsWithMembers(h.db, { chamber: "DIPUTADOS" })).find(
      (row) => row.name === commissionName,
    );
    expect(commission?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Persona Diputada Exacta",
          profileId: deputy.id,
          source: diputadosSource,
          sourceId: sharedSourceId,
        }),
        expect.objectContaining({
          name: "Persona con nombre pero identidad desconocida",
          profileId: null,
          source: null,
          sourceId: null,
        }),
      ]),
    );

    await replaceRosterSnapshot(h.db, diputadosSource, [], []);
    expect(await getActiveLegislatorProfileById(h.db, deputy.id)).toBeNull();
    expect(await getLegislatorProfileById(h.db, deputy.id)).toMatchObject({
      id: deputy.id,
      source: diputadosSource,
      sourceId: sharedSourceId,
      fullName: "Persona Diputada Exacta",
      active: false,
    });
    expect((await listLegislators(h.db)).some((row) => row.id === deputy.id)).toBe(false);
    expect(
      await resolveActiveLegislatorProfileIds(h.db, [
        { source: diputadosSource, sourceId: sharedSourceId, chamber: "DIPUTADOS" },
      ]),
    ).toEqual([null]);
    expect(
      await resolveLegislatorProfileIds(h.db, [
        { source: diputadosSource, sourceId: sharedSourceId, chamber: "DIPUTADOS" },
      ]),
    ).toEqual([deputy.id]);
  });

  it("resolves feed tags by source id plus published chamber and leaves ambiguity unresolved", async () => {
    const sourceId = "identity-feed-88100";
    const dipSource = "identity-feed-dip-source";
    const senSource = "identity-feed-sen-source";
    await replaceRosterSnapshot(
      h.db,
      dipSource,
      [{ source: dipSource, sourceId, chamber: "DIPUTADOS", fullName: "Diputada Feed" }],
      [],
    );
    await replaceRosterSnapshot(
      h.db,
      senSource,
      [{ source: senSource, sourceId, chamber: "SENADO", fullName: "Senador Feed" }],
      [],
    );
    const deputy = (await listLegislators(h.db)).find(
      (row) => row.source === dipSource && row.sourceId === sourceId,
    )!;

    await upsertFeedItem(
      h.db,
      {
        source: "identity-feed-test",
        sourceId: "identity-feed-with-chamber",
        kind: "NEWS",
        title: "Mención con cámara publicada",
        chamber: "DIPUTADOS",
      },
      [{ entityType: "LEGISLATOR", legislatorSourceId: sourceId, label: "Diputada Feed" }],
    );
    await upsertFeedItem(
      h.db,
      {
        source: "identity-feed-test",
        sourceId: "identity-feed-without-chamber",
        kind: "NEWS",
        title: "Mención sin cámara publicada",
        chamber: null,
      },
      [{ entityType: "LEGISLATOR", legislatorSourceId: sourceId, label: "Persona Feed" }],
    );

    const items = (await listFeedItems(h.db, {}, { limit: 100 })).items;
    expect(
      items.find((item) => item.sourceId === "identity-feed-with-chamber")?.tags[0],
    ).toMatchObject({ legislatorSourceId: sourceId, legislatorProfileId: deputy.id });
    expect(
      items.find((item) => item.sourceId === "identity-feed-without-chamber")?.tags[0],
    ).toMatchObject({ legislatorSourceId: sourceId, legislatorProfileId: null });
  });

  it("keeps the official sponsor id for history and resolves an active Diputados profile exactly", async () => {
    const legislatorId = 9_900_123;
    const sourceId = String(legislatorId);
    await replaceRosterSnapshot(
      h.db,
      "roster-diputados",
      [
        {
          source: "roster-diputados",
          sourceId,
          chamber: "DIPUTADOS",
          fullName: "Persona Patrocinadora Exacta",
        },
      ],
      [],
    );
    const profile = (await listLegislators(h.db)).find(
      (row) => row.source === "roster-diputados" && row.sourceId === sourceId,
    )!;
    const filedAt = "2098-08-28";
    const principalInitiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "identity-sponsor-initiative",
        code: "IDENTITY-SPONSOR-1",
        sponsor: "Persona Patrocinadora Exacta",
        sponsorRole: "Diputada",
        filedAt,
        condition: " VIGENTE ",
        raw: {
          payload: {
            proponentes: [
              {
                principal: true,
                legisladorId: legislatorId,
                nombreCompleto: "Persona Patrocinadora Exacta",
              },
            ],
          },
        },
      }),
    );
    const coproponentInitiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "identity-cosponsor-initiative",
        code: "IDENTITY-COSPONSOR-1",
        sponsor: "Otra Persona Principal",
        sponsorRole: "Diputado",
        filedAt,
        condition: null,
        raw: {
          payload: {
            proponentes: [
              { principal: true, legisladorId: 8_800_999, nombreCompleto: "Otra Persona" },
              {
                principal: false,
                legisladorId: legislatorId,
                nombreCompleto: "Persona Patrocinadora Exacta",
              },
            ],
          },
        },
      }),
    );
    const nameOnlyInitiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "identity-sponsor-name-only",
        code: "IDENTITY-SPONSOR-NAME-ONLY",
        sponsor: "Persona Patrocinadora Exacta",
        sponsorRole: "Diputada",
        filedAt,
        raw: {
          payload: {
            proponentes: [{ principal: true, nombreCompleto: "Persona Patrocinadora Exacta" }],
          },
        },
      }),
    );
    await replaceInitiativeProponents(h.db, principalInitiative.id, "sil-diputados", [
      {
        legislatorId: profile.id,
        personNamespace: "sil-diputados-legislator",
        personSourceId: sourceId,
        publishedName: "Persona Patrocinadora Exacta",
        principal: true,
        ordinal: 0,
        matchBasis: "official-id",
      },
    ]);
    await replaceInitiativeProponents(h.db, coproponentInitiative.id, "sil-diputados", [
      {
        personNamespace: "sil-diputados-legislator",
        personSourceId: "8800999",
        publishedName: "Otra Persona",
        principal: true,
        ordinal: 0,
        matchBasis: "unresolved",
      },
      {
        legislatorId: profile.id,
        personNamespace: "sil-diputados-legislator",
        personSourceId: sourceId,
        publishedName: "Persona Patrocinadora Exacta",
        principal: false,
        ordinal: 1,
        matchBasis: "official-id",
      },
    ]);
    await replaceInitiativeProponents(h.db, nameOnlyInitiative.id, "sil-diputados", [
      {
        personNamespace: "sil-diputados-legislator",
        publishedName: "Persona Patrocinadora Exacta",
        principal: true,
        ordinal: 0,
        matchBasis: "unresolved",
      },
    ]);

    const activeList = await listInitiatives(h.db, { search: "IDENTITY-SPONSOR-1" });
    expect(activeList.rows[0]).toMatchObject({
      sponsorRole: "Diputada",
      sponsorLegislatorSourceId: sourceId,
      sponsorProfileId: profile.id,
    });
    expect(
      (await listInitiatives(h.db, { search: "IDENTITY-SPONSOR-NAME-ONLY" })).rows[0],
    ).toMatchObject({
      sponsorLegislatorSourceId: null,
      sponsorProfileId: null,
    });
    expect(
      (await listDeposits(h.db, { dateFrom: filedAt })).find(
        (row) => row.code === "IDENTITY-SPONSOR-1",
      ),
    ).toMatchObject({
      sponsorLegislatorSourceId: sourceId,
      sponsorProfileId: profile.id,
    });
    expect(await getLegislatorInitiativeStats(h.db, profile)).toEqual({
      availability: "observed",
      basis: "official-proponent-id",
      coverage: "partial",
      deposited: 2,
      active: 1,
      otherConditionOrUnpublished: 1,
    });
    expect(await getLegislatorInitiativeStats(h.db, Number.MAX_SAFE_INTEGER)).toEqual({
      availability: "unavailable",
      reason: "no-compatible-official-identifier",
      deposited: null,
      active: null,
      otherConditionOrUnpublished: null,
    });

    await replaceRosterSnapshot(h.db, "roster-diputados", [], []);
    expect((await listInitiatives(h.db, { search: "IDENTITY-SPONSOR-1" })).rows[0]).toMatchObject({
      sponsorLegislatorSourceId: sourceId,
      sponsorProfileId: profile.id,
    });
    expect(await getLegislatorProfileById(h.db, profile.id)).toMatchObject({
      id: profile.id,
      active: false,
    });
  });
});

describe("normalized initiative proponents", () => {
  it("filters principal, coproponent and published relationships with stats/list parity", async () => {
    const rosterSource = "relation-role-roster";
    await replaceRosterSnapshot(
      h.db,
      rosterSource,
      [
        {
          source: rosterSource,
          sourceId: "relation-role-person",
          chamber: "DIPUTADOS",
          fullName: "Legisladora Relación Exacta",
          role: "Diputada",
          partyShort: "PRUEBA",
          province: "Azua",
        },
      ],
      [],
    );
    const profile = (await listLegislators(h.db)).find(
      (row) => row.source === rosterSource && row.sourceId === "relation-role-person",
    )!;
    const filedAt = "2099-01-15";
    const principal = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "relation-role-principal",
        code: "RELATION-ROLE-PRINCIPAL",
        filedAt,
        condition: "VIGENTE",
      }),
    );
    const coproponent = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "relation-role-coproponent",
        code: "RELATION-ROLE-COPROPONENT",
        filedAt,
        condition: null,
      }),
    );
    const published = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "relation-role-published",
        code: "RELATION-ROLE-PUBLISHED",
        filedAt,
        condition: "NO VIGENTE",
      }),
    );
    const unresolved = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "relation-role-unresolved",
        code: "RELATION-ROLE-UNRESOLVED",
        filedAt,
      }),
    );
    const undated = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "relation-role-undated",
        code: "RELATION-ROLE-UNDATED",
        filedAt: null,
      }),
    );

    await replaceInitiativeProponents(h.db, principal.id, "sil-diputados", [
      {
        legislatorId: profile.id,
        personNamespace: "diputados-sil:legisladorId",
        personSourceId: "role-101",
        publishedName: "Legisladora Relación Exacta",
        principal: true,
        ordinal: 0,
        matchBasis: "official-id",
        evidence: { privateOfficialPayload: true },
      },
    ]);
    await replaceInitiativeProponents(h.db, coproponent.id, "sil-diputados", [
      {
        personNamespace: "diputados-sil:legisladorId",
        personSourceId: "role-other",
        publishedName: "Persona Principal No Resuelta",
        principal: true,
        ordinal: 0,
        matchBasis: "unresolved",
      },
      {
        legislatorId: profile.id,
        personNamespace: "diputados-sil:legisladorId",
        personSourceId: "role-101",
        publishedName: "Legisladora Relación Exacta",
        principal: false,
        ordinal: 1,
        matchBasis: "official-id",
      },
    ]);
    await replaceInitiativeProponents(h.db, published.id, "sil-diputados", [
      {
        legislatorId: profile.id,
        personNamespace: "diputados-sil:legisladorId",
        personSourceId: "role-101",
        publishedName: "Legisladora Relación Exacta",
        principal: null,
        ordinal: 0,
        matchBasis: "official-id",
      },
    ]);
    await replaceInitiativeProponents(h.db, unresolved.id, "sil-diputados", [
      {
        personNamespace: "diputados-sil:legisladorId",
        publishedName: "Legisladora Relación Exacta",
        principal: true,
        ordinal: 0,
        matchBasis: "unresolved",
      },
    ]);
    await replaceInitiativeProponents(h.db, undated.id, "sil-diputados", [
      {
        legislatorId: profile.id,
        personNamespace: "diputados-sil:legisladorId",
        personSourceId: "role-101",
        publishedName: "Legisladora Relación Exacta",
        principal: true,
        ordinal: 0,
        matchBasis: "official-id",
      },
    ]);

    const page = await listInitiatives(h.db, {
      proponentLegislatorProfileId: profile.id,
      search: "RELATION-ROLE-",
      pageSize: 20,
    });
    expect(page.total).toBe(3);
    expect(
      Object.fromEntries(page.rows.map((row) => [row.code, row.filteredProponentRelationship])),
    ).toEqual({
      "RELATION-ROLE-PUBLISHED": "published",
      "RELATION-ROLE-COPROPONENT": "coproponent",
      "RELATION-ROLE-PRINCIPAL": "principal",
    });
    expect(await getLegislatorInitiativeStats(h.db, profile)).toEqual({
      availability: "observed",
      basis: "official-proponent-id",
      coverage: "partial",
      deposited: page.total,
      active: 1,
      otherConditionOrUnpublished: 2,
    });

    const publicRows = await listInitiativeProponents(h.db, coproponent.id);
    expect(publicRows).toHaveLength(2);
    expect(Object.keys(publicRows[1]!).sort()).toEqual(
      ["publishedName", "principal", "ordinal", "legislatorId", "profile"].sort(),
    );
    expect(Object.keys(publicRows[1]!.profile!).sort()).toEqual(
      ["profileId", "fullName", "chamber", "role", "party", "province"].sort(),
    );
    expect(publicRows[1]).toEqual({
      publishedName: "Legisladora Relación Exacta",
      principal: false,
      ordinal: 1,
      legislatorId: profile.id,
      profile: {
        profileId: profile.id,
        fullName: "Legisladora Relación Exacta",
        chamber: "DIPUTADOS",
        role: "Diputada",
        party: "PRUEBA",
        province: "Azua",
      },
    });
    expect(publicRows[0]!.legislatorId).toBeNull();
    expect(publicRows[0]!.profile).toBeNull();
    expect(
      await listInitiatives(h.db, {
        proponentLegislatorProfileId: 0,
        search: "RELATION-ROLE-",
      }),
    ).toMatchObject({ total: 0, rows: [] });
  });

  it("keeps person-id namespaces separate and links exact Senate selector identities", async () => {
    const dipRosterSource = "relation-namespace-dip-roster";
    const senRosterSource = "relation-namespace-sen-roster";
    await replaceRosterSnapshot(
      h.db,
      dipRosterSource,
      [
        {
          source: dipRosterSource,
          sourceId: "shared-person-42",
          chamber: "DIPUTADOS",
          fullName: "Perfil Diputados Namespace",
        },
      ],
      [],
    );
    await replaceRosterSnapshot(
      h.db,
      senRosterSource,
      [
        {
          source: senRosterSource,
          sourceId: "shared-person-42",
          chamber: "SENADO",
          fullName: "Perfil Senado Namespace",
          role: "Senador",
          partyShort: "FP",
          province: "Santo Domingo",
        },
      ],
      [],
    );
    const profiles = await listLegislators(h.db);
    const deputy = profiles.find((row) => row.source === dipRosterSource)!;
    const senator = profiles.find((row) => row.source === senRosterSource)!;
    const filedAt = "2099-02-10";
    const dipInitiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "relation-namespace-dip-initiative",
        code: "RELATION-NAMESPACE-DIP",
        filedAt,
      }),
    );
    const senateInitiative = await upsertInitiative(
      h.db,
      fixture({
        source: "senado-sil",
        sourceId: "relation-namespace-sen-initiative",
        code: "RELATION-NAMESPACE-SEN",
        chamber: "SENADO",
        sponsor: "Perfil Senado Namespace; Otra Persona Publicada",
        filedAt,
        condition: "VIGENTE",
      }),
    );
    const unresolvedSenateInitiative = await upsertInitiative(
      h.db,
      fixture({
        source: "senado-sil",
        sourceId: "relation-namespace-sen-unresolved",
        code: "RELATION-NAMESPACE-SEN-UNRESOLVED",
        chamber: "SENADO",
        filedAt,
      }),
    );
    await replaceInitiativeProponents(h.db, dipInitiative.id, "sil-diputados", [
      {
        legislatorId: deputy.id,
        personNamespace: "diputados-sil:legisladorId",
        personSourceId: "42",
        publishedName: "Perfil Diputados Namespace",
        principal: true,
        ordinal: 0,
        matchBasis: "official-id",
      },
    ]);
    await replaceInitiativeProponents(h.db, senateInitiative.id, "senado-sil", [
      {
        legislatorId: senator.id,
        personNamespace: "senado-masterlex:selector-128-82",
        personSourceId: "42",
        publishedName: "Perfil Senado Namespace",
        principal: null,
        ordinal: 0,
        matchBasis: "official-selector-exact-name",
      },
    ]);
    await replaceInitiativeProponents(h.db, unresolvedSenateInitiative.id, "senado-sil", [
      {
        personNamespace: "senado-masterlex:selector-128-82",
        publishedName: "Perfil Senado Namespace",
        principal: null,
        ordinal: 0,
        matchBasis: "unresolved",
      },
    ]);

    const dipPage = await listInitiatives(h.db, {
      proponentLegislatorProfileId: deputy.id,
      search: "RELATION-NAMESPACE-",
    });
    const senPage = await listInitiatives(h.db, {
      proponentLegislatorProfileId: senator.id,
      search: "RELATION-NAMESPACE-",
    });
    expect(dipPage.rows.map((row) => row.code)).toEqual(["RELATION-NAMESPACE-DIP"]);
    expect(senPage.rows.map((row) => row.code)).toEqual(["RELATION-NAMESPACE-SEN"]);
    expect(senPage.rows[0]!.filteredProponentRelationship).toBe("published");
    expect(senPage.rows[0]).toMatchObject({
      sponsor: "Perfil Senado Namespace",
      sponsorLegislatorSourceId: "42",
      sponsorProfileId: senator.id,
    });
    expect(await getLegislatorInitiativeStats(h.db, deputy)).toMatchObject({
      availability: "observed",
      deposited: 1,
    });
    expect(await getLegislatorInitiativeStats(h.db, senator)).toMatchObject({
      availability: "observed",
      deposited: 1,
      active: 1,
    });
    expect((await listInitiativeProponents(h.db, senateInitiative.id))[0]).toMatchObject({
      legislatorId: senator.id,
      profile: {
        profileId: senator.id,
        fullName: "Perfil Senado Namespace",
        chamber: "SENADO",
      },
    });
  });

  it("replaces idempotently and rolls back the whole snapshot when an insert fails", async () => {
    const rosterSource = "relation-transaction-roster";
    await replaceRosterSnapshot(
      h.db,
      rosterSource,
      [
        {
          source: rosterSource,
          sourceId: "relation-transaction-profile",
          chamber: "DIPUTADOS",
          fullName: "Perfil Transacción",
        },
      ],
      [],
    );
    const profile = (await listLegislators(h.db)).find((row) => row.source === rosterSource)!;
    const initiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "relation-transaction-initiative",
        code: "RELATION-TRANSACTION",
        filedAt: "2099-03-01",
        raw: { payload: { retainedForBackfill: true } },
      }),
    );
    const snapshot = [
      {
        legislatorId: profile.id,
        personNamespace: "diputados-sil:legisladorId",
        personSourceId: "transaction-1",
        publishedName: "Perfil Transacción",
        principal: true,
        ordinal: 0,
        matchBasis: "official-id" as const,
        evidence: { version: 1 },
      },
      {
        personNamespace: "diputados-sil:legisladorId",
        publishedName: "Persona No Resuelta",
        principal: false,
        ordinal: 1,
        matchBasis: "unresolved" as const,
      },
    ];
    await replaceInitiativeProponents(h.db, initiative.id, "sil-diputados", snapshot);
    const firstRows = await h.db
      .select()
      .from(initiativeProponents)
      .where(eq(initiativeProponents.initiativeId, initiative.id))
      .orderBy(initiativeProponents.ordinal);
    await replaceInitiativeProponents(h.db, initiative.id, "sil-diputados", snapshot);
    const secondRows = await h.db
      .select()
      .from(initiativeProponents)
      .where(eq(initiativeProponents.initiativeId, initiative.id))
      .orderBy(initiativeProponents.ordinal);
    expect(secondRows.map((row) => row.id)).toEqual(firstRows.map((row) => row.id));
    expect(secondRows).toHaveLength(2);

    await expect(
      replaceInitiativeProponents(h.db, initiative.id, "sil-diputados", [
        {
          ...snapshot[0]!,
          publishedName: "Cambio Que Debe Revertirse",
        },
        {
          legislatorId: 2_147_483_000,
          personNamespace: "diputados-sil:legisladorId",
          personSourceId: "missing-fk",
          publishedName: "Perfil Inexistente",
          principal: false,
          ordinal: 2,
          matchBasis: "official-id",
        },
      ]),
    ).rejects.toThrow();
    expect(
      await h.db
        .select({
          id: initiativeProponents.id,
          publishedName: initiativeProponents.publishedName,
          ordinal: initiativeProponents.ordinal,
        })
        .from(initiativeProponents)
        .where(eq(initiativeProponents.initiativeId, initiative.id))
        .orderBy(initiativeProponents.ordinal),
    ).toEqual(
      firstRows.map((row) => ({
        id: row.id,
        publishedName: row.publishedName,
        ordinal: row.ordinal,
      })),
    );

    await replaceInitiativeProponents(h.db, initiative.id, "sil-diputados", [snapshot[0]!]);
    expect(await listInitiativeProponents(h.db, initiative.id)).toHaveLength(1);
    await replaceInitiativeProponents(h.db, initiative.id, "sil-diputados", []);
    expect(await listInitiativeProponents(h.db, initiative.id)).toEqual([]);

    const candidates = await listInitiativeProponentBackfillCandidates(h.db, {
      source: "sil-diputados",
      afterId: initiative.id - 1,
      limit: 1,
    });
    expect(candidates).toEqual([
      expect.objectContaining({
        id: initiative.id,
        source: "sil-diputados",
        sourceId: "relation-transaction-initiative",
        code: "RELATION-TRANSACTION",
        raw: { payload: { retainedForBackfill: true } },
      }),
    ]);
  });
});

describe("initiative-proponent reconciliation coverage", () => {
  it("never presents an unbackfilled zero and accepts only a current compatible full run", async () => {
    const sourceId = "coverage-zero-profile";
    await replaceRosterSnapshot(
      h.db,
      "roster-diputados",
      [
        {
          source: "roster-diputados",
          sourceId,
          chamber: "DIPUTADOS",
          fullName: "Perfil Sin Relaciones Observadas",
        },
      ],
      [],
    );
    const profile = (await listLegislators(h.db)).find(
      (row) => row.source === "roster-diputados" && row.sourceId === sourceId,
    )!;
    const evidenceInitiative = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "coverage-proponent-evidence",
        code: "COVERAGE-PROPONENT-EVIDENCE",
        title: "Título antes del cambio de metadatos",
        raw: { payload: { proponentes: [], unrelatedMetadata: "before" } },
      }),
    );
    expect(await getLegislatorInitiativeStats(h.db, profile)).toEqual({
      availability: "unavailable",
      reason: "reconciliation-incomplete",
      deposited: null,
      active: null,
      otherConditionOrUnpublished: null,
    });

    const incompatible = await beginInitiativeProponentReconciliationRun(h.db, {
      initiativeSource: "sil-diputados",
      personNamespace: "wrong-person-namespace",
      rosterSource: "roster-diputados",
      chamber: "DIPUTADOS",
      resolverVersion: "test-wrong-namespace-v1",
    });
    expect(
      await finishInitiativeProponentReconciliationRun(h.db, incompatible.runId, {
        candidates: incompatible.candidateCount,
        observed: incompatible.candidateCount,
        replaced: incompatible.candidateCount,
        skippedUnobserved: 0,
        unresolved: 0,
        failures: 0,
      }),
    ).toEqual({ status: "complete", reason: null });
    expect(await getLegislatorInitiativeStats(h.db, profile)).toMatchObject({
      availability: "unavailable",
      reason: "reconciliation-incomplete",
    });

    const staleResolver = await beginInitiativeProponentReconciliationRun(h.db, {
      initiativeSource: "sil-diputados",
      personNamespace: "sil-diputados-legislator",
      rosterSource: "roster-diputados",
      chamber: "DIPUTADOS",
      resolverVersion: "stale-official-id-resolver-v0",
    });
    expect(
      await finishInitiativeProponentReconciliationRun(h.db, staleResolver.runId, {
        candidates: staleResolver.candidateCount,
        observed: staleResolver.candidateCount,
        replaced: staleResolver.candidateCount,
        skippedUnobserved: 0,
        unresolved: 0,
        failures: 0,
      }),
    ).toEqual({ status: "complete", reason: null });
    expect(await getLegislatorInitiativeStats(h.db, profile)).toMatchObject({
      availability: "unavailable",
      reason: "reconciliation-incomplete",
    });

    const incomplete = await beginInitiativeProponentReconciliationRun(h.db, {
      initiativeSource: "sil-diputados",
      personNamespace: "sil-diputados-legislator",
      rosterSource: "roster-diputados",
      chamber: "DIPUTADOS",
      resolverVersion: DIPUTADOS_PROPONENT_RESOLVER_VERSION,
    });
    expect(incomplete.candidateCount).toBeGreaterThan(0);
    expect(
      await finishInitiativeProponentReconciliationRun(h.db, incomplete.runId, {
        candidates: incomplete.candidateCount,
        observed: incomplete.candidateCount - 1,
        replaced: incomplete.candidateCount - 1,
        skippedUnobserved: 1,
        unresolved: 1,
        failures: 0,
      }),
    ).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("published proponents remain unresolved"),
    });
    expect(await getLegislatorInitiativeStats(h.db, profile)).toMatchObject({
      availability: "unavailable",
      reason: "reconciliation-incomplete",
    });

    const complete = await beginInitiativeProponentReconciliationRun(h.db, {
      initiativeSource: "sil-diputados",
      personNamespace: "sil-diputados-legislator",
      rosterSource: "roster-diputados",
      chamber: "DIPUTADOS",
      resolverVersion: DIPUTADOS_PROPONENT_RESOLVER_VERSION,
    });
    expect(
      await finishInitiativeProponentReconciliationRun(h.db, complete.runId, {
        candidates: complete.candidateCount,
        observed: complete.candidateCount,
        replaced: complete.candidateCount,
        skippedUnobserved: 0,
        unresolved: 0,
        failures: 0,
      }),
    ).toEqual({ status: "complete", reason: null });
    expect(await getLegislatorInitiativeStats(h.db, profile)).toEqual({
      availability: "observed",
      basis: "official-proponent-id",
      coverage: "complete",
      deposited: 0,
      active: 0,
      otherConditionOrUnpublished: 0,
    });

    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "coverage-proponent-evidence",
        code: "COVERAGE-PROPONENT-EVIDENCE",
        title: "Título después del cambio de metadatos",
        status: "Estado no relacionado con proponentes",
        raw: { payload: { proponentes: [], unrelatedMetadata: "after" } },
      }),
    );
    await h.db
      .update(initiatives)
      .set({ updatedAt: sql`${initiatives.updatedAt} + interval '1 day'` })
      .where(eq(initiatives.id, evidenceInitiative.id));
    expect(await getLegislatorInitiativeStats(h.db, profile)).toMatchObject({
      availability: "observed",
      coverage: "complete",
      deposited: 0,
    });

    await upsertInitiative(
      h.db,
      fixture({
        sourceId: "coverage-proponent-evidence",
        code: "COVERAGE-PROPONENT-EVIDENCE",
        title: "Título después del cambio de evidencia",
        raw: {
          payload: {
            proponentes: [
              {
                legisladorId: 991_337,
                nombreCompleto: "Persona Nueva en la Evidencia",
                principal: true,
              },
            ],
            unrelatedMetadata: "after",
          },
        },
      }),
    );
    expect(await getLegislatorInitiativeStats(h.db, profile)).toMatchObject({
      availability: "unavailable",
      reason: "reconciliation-incomplete",
    });
  });
});

describe("Senate roster person-identity safety", () => {
  it("accepts an exact source-published prior-name alias and preserves the profile id", async () => {
    const sourceId = "identity-alias-seat";
    await replaceRosterSnapshot(
      h.db,
      "roster-senado",
      [
        {
          source: "roster-senado",
          sourceId,
          chamber: "SENADO",
          fullName: "Julito Fulcar",
          province: "Peravia",
        },
      ],
      [],
    );
    const before = (await listLegislators(h.db)).find(
      (row) => row.source === "roster-senado" && row.sourceId === sourceId,
    )!;

    await replaceRosterSnapshot(
      h.db,
      "roster-senado",
      [
        {
          source: "roster-senado",
          sourceId,
          chamber: "SENADO",
          fullName: "Julito Fulcar Encarnación",
          province: "Peravia",
          raw: {
            explicit: {
              identityAliases: ["Julito Fulcar Encarnación", "  JULITO   FULCAR  "],
            },
          },
        },
      ],
      [],
    );

    expect(
      (await listLegislators(h.db)).find(
        (row) => row.source === "roster-senado" && row.sourceId === sourceId,
      ),
    ).toMatchObject({ id: before.id, fullName: "Julito Fulcar Encarnación", province: "Peravia" });
  });

  it("fails closed when a province seat changes occupant and preserves historical links", async () => {
    const sourceId = "identity-drift-seat";
    await replaceRosterSnapshot(
      h.db,
      "roster-senado",
      [
        {
          source: "roster-senado",
          sourceId,
          chamber: "SENADO",
          fullName: "Persona Senadora Histórica",
          province: "Provincia de Prueba",
        },
      ],
      [],
    );
    const profile = (await listLegislators(h.db)).find(
      (row) => row.source === "roster-senado" && row.sourceId === sourceId,
    )!;
    const initiative = await upsertInitiative(
      h.db,
      fixture({
        source: "senado-sil",
        sourceId: "identity-drift-initiative",
        code: "IDENTITY-DRIFT-SENATE",
        chamber: "SENADO",
        filedAt: "2099-06-01",
      }),
    );
    await replaceInitiativeProponents(h.db, initiative.id, "senado-sil", [
      {
        legislatorId: profile.id,
        personNamespace: "senado-sil-person",
        personSourceId: "masterlex-historical-person",
        publishedName: "Persona Senadora Histórica",
        principal: null,
        ordinal: 0,
        matchBasis: "official-selector-exact-name",
      },
    ]);

    await expect(
      replaceRosterSnapshot(
        h.db,
        "roster-senado",
        [
          {
            source: "roster-senado",
            sourceId,
            chamber: "SENADO",
            fullName: "Persona Senadora Sustituta",
            province: "Provincia de Prueba",
            raw: {
              explicit: { identityAliases: ["Persona Senadora Sustituta"] },
            },
          },
        ],
        [],
      ),
    ).rejects.toThrow(/occupant drift/);

    expect(
      (await listLegislators(h.db)).find(
        (row) => row.source === "roster-senado" && row.sourceId === sourceId,
      ),
    ).toMatchObject({ id: profile.id, fullName: "Persona Senadora Histórica" });
    expect((await listInitiativeProponents(h.db, initiative.id))[0]).toMatchObject({
      legislatorId: profile.id,
      profile: { profileId: profile.id, fullName: "Persona Senadora Histórica" },
    });
  });
});

describe("official chamber party composition", () => {
  it("groups the two exact active roster pairs by their separate published party fields", async () => {
    await replaceRosterSnapshot(
      h.db,
      "roster-diputados",
      [
        {
          source: "roster-diputados",
          sourceId: "composition-dip-prm-1",
          chamber: "DIPUTADOS",
          fullName: "Diputada PRM Uno",
          partyShort: "PRM",
          party: "Partido Revolucionario Moderno",
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-prm-2",
          chamber: "DIPUTADOS",
          fullName: "Diputado PRM Dos",
          partyShort: "PRM",
          party: "Partido Revolucionario Moderno",
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-full-only",
          chamber: "DIPUTADOS",
          fullName: "Diputada con nombre partidario solamente",
          partyShort: null,
          party: "Partido Revolucionario Moderno",
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-short-only",
          chamber: "DIPUTADOS",
          fullName: "Diputado con sigla solamente",
          partyShort: "PRM",
          party: null,
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-null-party",
          chamber: "DIPUTADOS",
          fullName: "Diputada sin partido publicado",
          partyShort: null,
          party: null,
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-wrong-chamber",
          chamber: "SENADO",
          fullName: "Fila Diputados con cámara incorrecta",
          partyShort: "EXCLUDE",
          party: "Partido Excluido",
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-becomes-inactive",
          chamber: "DIPUTADOS",
          fullName: "Fila que quedará inactiva",
          partyShort: "INACTIVE",
          party: "Partido Inactivo",
        },
      ],
      [],
    );
    await replaceRosterSnapshot(
      h.db,
      "roster-diputados",
      [
        {
          source: "roster-diputados",
          sourceId: "composition-dip-prm-1",
          chamber: "DIPUTADOS",
          fullName: "Diputada PRM Uno",
          partyShort: "PRM",
          party: "Partido Revolucionario Moderno",
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-prm-2",
          chamber: "DIPUTADOS",
          fullName: "Diputado PRM Dos",
          partyShort: "PRM",
          party: "Partido Revolucionario Moderno",
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-full-only",
          chamber: "DIPUTADOS",
          fullName: "Diputada con nombre partidario solamente",
          partyShort: null,
          party: "Partido Revolucionario Moderno",
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-short-only",
          chamber: "DIPUTADOS",
          fullName: "Diputado con sigla solamente",
          partyShort: "PRM",
          party: null,
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-null-party",
          chamber: "DIPUTADOS",
          fullName: "Diputada sin partido publicado",
          partyShort: null,
          party: null,
        },
        {
          source: "roster-diputados",
          sourceId: "composition-dip-wrong-chamber",
          chamber: "SENADO",
          fullName: "Fila Diputados con cámara incorrecta",
          partyShort: "EXCLUDE",
          party: "Partido Excluido",
        },
      ],
      [],
    );

    await replaceRosterSnapshot(
      h.db,
      "roster-senado",
      [
        {
          source: "roster-senado",
          sourceId: "composition-sen-fp-1",
          chamber: "SENADO",
          fullName: "Senadora FP Uno",
          partyShort: "FP",
          party: "Fuerza del Pueblo",
        },
        {
          source: "roster-senado",
          sourceId: "composition-sen-fp-2",
          chamber: "SENADO",
          fullName: "Senador FP Dos",
          partyShort: "FP",
          party: "Fuerza del Pueblo",
        },
        {
          source: "roster-senado",
          sourceId: "composition-sen-prm",
          chamber: "SENADO",
          fullName: "Senadora PRM",
          partyShort: "PRM",
          party: "Partido Revolucionario Moderno",
        },
        {
          source: "roster-senado",
          sourceId: "composition-sen-null-party",
          chamber: "SENADO",
          fullName: "Senador sin partido publicado",
          partyShort: null,
          party: null,
        },
        {
          source: "roster-senado",
          sourceId: "composition-sen-wrong-chamber",
          chamber: "DIPUTADOS",
          fullName: "Fila Senado con cámara incorrecta",
          partyShort: "EXCLUDE",
          party: "Partido Excluido",
        },
      ],
      [],
    );
    await replaceRosterSnapshot(
      h.db,
      "composition-unofficial-roster",
      [
        {
          source: "composition-unofficial-roster",
          sourceId: "composition-unofficial-dip",
          chamber: "DIPUTADOS",
          fullName: "Diputado de fuente no oficial",
          partyShort: "EXCLUDE",
          party: "Partido Excluido",
        },
        {
          source: "composition-unofficial-roster",
          sourceId: "composition-unofficial-sen",
          chamber: "SENADO",
          fullName: "Senadora de fuente no oficial",
          partyShort: "EXCLUDE",
          party: "Partido Excluido",
        },
      ],
      [],
    );

    const rows = await countActiveRosterByChamberParty(h.db);

    expect(rows).toEqual(
      expect.arrayContaining([
        {
          chamber: "DIPUTADOS",
          partyShort: "PRM",
          partyFullName: "Partido Revolucionario Moderno",
          count: 2,
        },
        {
          chamber: "DIPUTADOS",
          partyShort: null,
          partyFullName: "Partido Revolucionario Moderno",
          count: 1,
        },
        {
          chamber: "DIPUTADOS",
          partyShort: "PRM",
          partyFullName: null,
          count: 1,
        },
        {
          chamber: "DIPUTADOS",
          partyShort: null,
          partyFullName: null,
          count: 1,
        },
        {
          chamber: "SENADO",
          partyShort: "FP",
          partyFullName: "Fuerza del Pueblo",
          count: 2,
        },
        {
          chamber: "SENADO",
          partyShort: "PRM",
          partyFullName: "Partido Revolucionario Moderno",
          count: 1,
        },
        {
          chamber: "SENADO",
          partyShort: null,
          partyFullName: null,
          count: 1,
        },
      ]),
    );
    expect(rows).toHaveLength(7);
    expect(rows.some((row) => row.partyShort === "EXCLUDE")).toBe(false);
    expect(rows.some((row) => row.partyShort === "INACTIVE")).toBe(false);
    expect(
      rows.filter((row) => row.chamber === "DIPUTADOS").reduce((sum, row) => sum + row.count, 0),
    ).toBe(5);
    expect(
      rows.filter((row) => row.chamber === "SENADO").reduce((sum, row) => sum + row.count, 0),
    ).toBe(4);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(9);
  });
});
