import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dbMocks = vi.hoisted(() => ({
  ensureSchema: vi.fn(async () => undefined),
  readCongressMovementDay: vi.fn(),
}));

vi.mock("@oculis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oculis/db")>();
  return {
    ...actual,
    createDb: () => ({ db: { test: true }, ensureSchema: dbMocks.ensureSchema }),
    readCongressMovementDay: dbMocks.readCongressMovementDay,
  };
});

import {
  adaptCongressMovementDay,
  getCongressMovementDay,
  todayISO,
  type CongressMovementDay,
} from "@/lib/data";

function movementDay(): CongressMovementDay {
  return {
    chamber: "DIPUTADOS",
    selectedDate: "2026-08-31",
    previousAvailableDate: "2026-08-30",
    nextAvailableDate: null,
    latestAvailableDate: "2026-08-31",
    totalMovementCount: 2,
    uniqueInitiativeCount: 2,
    movements: [
      {
        kind: "FILED",
        initiativeId: 41,
        code: "06100-2024-2028-CD",
        title: "Título oficial exacto",
        titleEn: "Exact Official Title",
        status: "Depositado",
        eventDate: "2026-08-31",
        chamber: "DIPUTADOS",
        source: "sil-diputados",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/41",
        evidenceType: "OFFICIAL_FILED_AT",
        sourceRowCount: 1,
        sourceEventIds: [],
        sourceEventId: null,
        note: null,
        observedAt: "2026-08-31 13:00:00",
        documentPublication: {
          status: "PUBLISHED_VERIFIED",
          checkedAt: null,
          available: true,
          documentId: 501,
        },
      },
      {
        kind: "STATUS",
        initiativeId: 42,
        code: "06101-2024-2028-CD",
        title: "Otra iniciativa",
        titleEn: null,
        status: "Enviada a comisión",
        eventDate: "2026-08-31",
        chamber: "DIPUTADOS",
        source: "sil-diputados",
        sourceUrl: "javascript:alert(1)",
        evidenceType: "SOURCE_HISTORY",
        sourceRowCount: 1,
        sourceEventIds: ["history-42"],
        sourceEventId: "history-42",
        note: "Comisión Permanente de Justicia",
        observedAt: "2026-08-31 14:00:00",
        documentPublication: {
          status: "UNCONFIRMED",
          checkedAt: null,
          available: false,
          documentId: null,
        },
      },
    ],
    depositedPdfs: {
      supported: true,
      eligibleFiledInitiativeCount: 1,
      withOfficialMetadata: 1,
      withFreshVerifiedPdf: 0,
      unavailableOrUnverified: 1,
      contractNote: "Metadata is not proof of availability.",
    },
    publications: {
      sources: ["dip-known-agenda"],
      publishedOnDate: 3,
      modifiedOnDate: 1,
      undatedStoredCatalog: 2,
      storedCatalogTotal: 30,
      expectedDailyTotal: null,
      contractNote: "Zero is not proof of source absence.",
    },
  };
}

describe("Congress movement-day web adapter", () => {
  it("sanitizes each source URL without changing exact official copy or monitoring facts", () => {
    const source = movementDay();
    const result = adaptCongressMovementDay(source);

    expect(result.movements[0]).toEqual(source.movements[0]);
    expect(result.movements[1]).toEqual({ ...source.movements[1], sourceUrl: null });
    expect(result.movements[1]).toMatchObject({
      title: "Otra iniciativa",
      status: "Enviada a comisión",
      sourceEventId: "history-42",
      note: "Comisión Permanente de Justicia",
    });
    expect(result.depositedPdfs).toEqual(source.depositedPdfs);
    expect(result.publications).toEqual(source.publications);
    expect(result.totalMovementCount).toBe(2);
    expect(result.uniqueInitiativeCount).toBe(2);
  });

  it("fails closed for an ordinary HTTPS URL on a domain not owned by its source", () => {
    const source = movementDay();
    source.movements[0]!.sourceUrl = "https://example.com/not-an-official-source";
    expect(adaptCongressMovementDay(source).movements[0]!.sourceUrl).toBeNull();
  });

  it("rejects an invalid requested calendar day before opening the database", async () => {
    await expect(
      getCongressMovementDay({ date: "2026-02-31", chamber: "DIPUTADOS" }),
    ).rejects.toThrow("exact ISO calendar date");
  });

  it("defaults to today's Dominican-Republic calendar date", async () => {
    const today = todayISO();
    const source = { ...movementDay(), selectedDate: today };
    dbMocks.readCongressMovementDay.mockResolvedValueOnce(source);

    await expect(getCongressMovementDay({ chamber: "DIPUTADOS" })).resolves.toEqual(
      adaptCongressMovementDay(source),
    );
    expect(dbMocks.readCongressMovementDay).toHaveBeenCalledWith(expect.anything(), {
      date: today,
      chamber: "DIPUTADOS",
    });
  });

  it("honors an explicitly selected historical date", async () => {
    const selectedDate = "2026-08-29";
    const source = { ...movementDay(), selectedDate };
    dbMocks.readCongressMovementDay.mockResolvedValueOnce(source);

    await getCongressMovementDay({ date: selectedDate, chamber: "SENADO" });
    expect(dbMocks.readCongressMovementDay).toHaveBeenLastCalledWith(expect.anything(), {
      date: selectedDate,
      chamber: "SENADO",
    });
  });
});
