import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getInitiative } = vi.hoisted(() => ({ getInitiative: vi.fn() }));

vi.mock("@/lib/data", () => ({ getInitiative }));

import { GET } from "./route";

const officialTitle = "Proyecto de ley sobre archivos públicos";
const translatedTitle = "Public Records Bill";

function request(lang: "es" | "en" = "en") {
  return GET(new NextRequest(`http://localhost/api/initiatives/27047?lang=${lang}`), {
    params: Promise.resolve({ id: "27047" }),
  });
}

describe("initiative detail API title provenance", () => {
  beforeEach(() => getInitiative.mockReset());

  it("keeps the official source title separate from its reviewed English display title", async () => {
    getInitiative.mockResolvedValue({
      id: 27047,
      source: "sil-diputados",
      sourceId: "27047",
      code: "00001-2024-2028-CD",
      title: officialTitle,
      titleEn: translatedTitle,
      events: [],
      commissionAssignments: [],
      documents: [],
      relatedNews: [],
    });

    const response = await request();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ title: officialTitle, titleEn: translatedTitle });
    expect(payload.title).not.toBe(payload.titleEn);
  });

  it("exposes resolved procedural facts separately without replacing canonical source fields", async () => {
    getInitiative.mockResolvedValue({
      id: 27047,
      source: "sil-diputados",
      sourceId: "27047",
      code: "06229-2024-2028-CD",
      title: "Crea el centro nacional de capacitación para motoristas.",
      currentChamber: null,
      expiresAt: null,
      proceduralFacts: {
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
      },
      events: [],
      commissionAssignments: [],
      documents: [],
      relatedNews: [],
    });

    const response = await request();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.currentChamber).toBeNull();
    expect(payload.expiresAt).toBeNull();
    expect(payload.proceduralFacts).toMatchObject({
      currentLocation: {
        state: "CHAMBER",
        basis: "OBSERVED",
        chamber: "DIPUTADOS",
      },
      expiration: {
        state: "COUNT_NOT_STARTED",
        basis: "OFFICIAL",
      },
    });
  });

  for (const [lang, suffix] of [
    ["es", ""],
    ["en", "&lang=en"],
  ] as const) {
    it(`keeps deposited-bill document metadata behind the local opener (${lang})`, async () => {
      const upstreamPdf =
        "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=260674";
      getInitiative.mockResolvedValue({
        id: 27047,
        source: "sil-diputados",
        sourceId: "27047",
        code: "06218-2024-2028-CD",
        title: officialTitle,
        events: [],
        commissionAssignments: [],
        documents: [
          {
            id: 19788,
            source: "sil-diputados",
            sourceDocId: "260674",
            docType: "PROYECTO DEPOSITADO",
            extension: "PDF",
            url: upstreamPdf,
            uploadedAt: "2026-08-31",
            modifiedAt: null,
            sourceCategory: "SIL",
            sourceFragment: "official metadata",
            firstSeenAt: "2026-08-31T12:00:00.000Z",
            lastSeenAt: "2026-09-01T12:00:00.000Z",
            pdfAvailable: false,
          },
        ],
        relatedNews: [],
      });

      const response = await request(lang);
      const payload = await response.json();
      const document = payload.documents[0];
      const serialized = JSON.stringify(payload);

      expect(response.status).toBe(200);
      expect(document).toMatchObject({
        id: 19788,
        kind: "official-deposited-bill-pdf",
        openHref: `/api/document/open?documentId=19788&initiativeId=27047${suffix}`,
      });
      expect(document).not.toHaveProperty("url");
      expect(document).not.toHaveProperty("source");
      expect(document).not.toHaveProperty("sourceDocId");
      expect(document).not.toHaveProperty("docType");
      expect(document).not.toHaveProperty("sourceCategory");
      expect(document).not.toHaveProperty("sourceFragment");
      expect(serialized).not.toContain(upstreamPdf);
      expect(serialized).not.toContain("s-sil.camaradediputados.gob.do");
    });
  }
});
