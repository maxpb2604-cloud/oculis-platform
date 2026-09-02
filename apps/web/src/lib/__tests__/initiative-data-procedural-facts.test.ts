import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dbMocks = vi.hoisted(() => ({
  ensureSchema: vi.fn(async () => undefined),
  getInitiativeById: vi.fn(),
  listFeedForInitiative: vi.fn(async () => []),
  listDocuments: vi.fn(async () => []),
  listInitiativeProponents: vi.fn(async () => []),
  resolveActiveLegislatorProfileIds: vi.fn(async () => []),
}));

vi.mock("@oculis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oculis/db")>();
  return {
    ...actual,
    createDb: () => ({ db: { test: true }, ensureSchema: dbMocks.ensureSchema }),
    getInitiativeById: dbMocks.getInitiativeById,
    listFeedForInitiative: dbMocks.listFeedForInitiative,
    listDocuments: dbMocks.listDocuments,
    listInitiativeProponents: dbMocks.listInitiativeProponents,
    resolveActiveLegislatorProfileIds: dbMocks.resolveActiveLegislatorProfileIds,
  };
});

import { getInitiative } from "@/lib/data";

describe("initiative detail procedural facts adapter", () => {
  beforeEach(() => {
    dbMocks.getInitiativeById.mockReset();
  });

  it("resolves the captured Diputados filing from sanitized event evidence", async () => {
    dbMocks.getInitiativeById.mockResolvedValue({
      id: 27047,
      source: "sil-diputados",
      sourceId: "159683",
      code: "06229-2024-2028-CD",
      title: "Crea el centro nacional de capacitación para motoristas.",
      titleEn: null,
      purpose: null,
      type: "Proyecto de Ley",
      status: "Depositado",
      chamber: "DIPUTADOS",
      sourceChamber: "DIPUTADOS",
      originChamber: "DIPUTADOS",
      currentChamber: null,
      currentBody: null,
      condition: "DEPOSITADO",
      sourceCategory: null,
      subjectMatter: null,
      sponsor: null,
      sponsorRole: null,
      sponsorCount: null,
      party: null,
      province: null,
      committee: null,
      filedAt: "2026-08-31",
      expiresAt: null,
      initiated: "NO",
      initiatedAt: null,
      legislature: "2026-SLO",
      registrationPeriod: "2024-2028",
      officialStatusChangedAt: "2026-08-31T18:52:47.000Z",
      promulgationNumber: null,
      promulgatedAt: null,
      sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/159683",
      raw: null,
      events: [
        {
          id: 616980,
          sourceEventId: "616980",
          status: "Depositado",
          eventDate: "2026-08-31",
          eventEndDate: null,
          note: null,
          source: "sil-diputados",
          sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/159683",
          evidenceType: "SOURCE_HISTORY",
          observedAt: new Date("2026-08-31T18:52:47.000Z"),
        },
      ],
      commissionAssignments: [],
    });

    const initiative = await getInitiative(27047);

    expect(initiative?.currentChamber).toBeNull();
    expect(initiative?.expiresAt).toBeNull();
    expect(initiative?.proceduralFacts).toMatchObject({
      currentLocation: {
        state: "CHAMBER",
        basis: "OBSERVED",
        chamber: "DIPUTADOS",
        reason: "LATEST_OFFICIAL_CHAMBER_MOVEMENT",
        evidenceStatus: "Depositado",
        evidenceDate: "2026-08-31",
        evidenceSource: "sil-diputados",
      },
      expiration: {
        state: "COUNT_NOT_STARTED",
        basis: "OFFICIAL",
        reason: "SOURCE_REPORTS_NOT_INITIATED",
      },
    });
    expect(initiative?.events[0]).toMatchObject({
      source: "sil-diputados",
      status: "Depositado",
      eventDate: "2026-08-31",
      observedAt: "2026-08-31T18:52:47.000Z",
      evidenceType: "SOURCE_HISTORY",
      sourceEventId: "616980",
    });
  });

  it("uses exact archived Senate Ficha fields until the next enrichment persists them", async () => {
    dbMocks.getInitiativeById.mockResolvedValue({
      id: 27037,
      source: "senado-sil",
      sourceId: "39981",
      code: "01886-2026-SLO-SE",
      title: "LEY GENERAL DE ALIANZAS PÚBLICO-PRIVADA",
      titleEn: null,
      purpose: null,
      type: "Proyecto de Ley",
      status: "Depositada",
      chamber: "SENADO",
      sourceChamber: "SENADO",
      originChamber: null,
      currentChamber: null,
      currentBody: null,
      condition: null,
      sourceCategory: null,
      subjectMatter: null,
      sponsor: null,
      sponsorRole: null,
      sponsorCount: null,
      party: null,
      province: null,
      committee: null,
      filedAt: "2026-08-28",
      expiresAt: null,
      initiated: null,
      initiatedAt: null,
      legislature: "2026-SLO",
      registrationPeriod: null,
      officialStatusChangedAt: null,
      promulgationNumber: null,
      promulgatedAt: null,
      sourceUrl:
        "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
      raw: {
        payload: {
          ficha: {
            legislatureCountingStarted: "No",
            legislatureCountingStartedAt: null,
            legislature: "2026-SLO",
            expiresAt: null,
          },
        },
      },
      events: [
        {
          id: 1,
          sourceEventId: "39981:depositada",
          status: "Depositada",
          eventDate: "2026-08-28",
          eventEndDate: null,
          note: null,
          source: "senado-sil",
          sourceUrl: null,
          evidenceType: "SOURCE_HISTORY",
          observedAt: new Date("2026-08-28T12:00:00.000Z"),
        },
      ],
      commissionAssignments: [],
    });

    const initiative = await getInitiative(27037);

    expect(initiative).toMatchObject({
      initiated: "No",
      initiatedAt: null,
      legislature: "2026-SLO",
      proceduralFacts: {
        currentLocation: {
          state: "CHAMBER",
          basis: "OBSERVED",
          chamber: "SENADO",
        },
        expiration: {
          state: "COUNT_NOT_STARTED",
          basis: "OFFICIAL",
          reason: "SOURCE_REPORTS_NOT_INITIATED",
        },
      },
    });
  });
});
