import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getInitiative } = vi.hoisted(() => ({ getInitiative: vi.fn() }));

vi.mock("@/lib/data", () => ({ getInitiative }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/primitives", () => ({
  NewTabNotice: () => <span>new tab</span>,
}));
vi.mock("@/components/legislator-profile-provider", () => ({
  LegislatorProfileTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import InitiativePage, { generateMetadata } from "./page";

const officialTitle = "Proyecto de ley sobre archivos públicos";
const translatedTitle = "Public Records Bill";

function initiative(titleEn: string | null) {
  return {
    id: 27047,
    source: "sil-diputados",
    sourceId: "27047",
    code: "00001-2024-2028-CD",
    title: officialTitle,
    titleEn,
    purpose: officialTitle,
    type: null,
    status: "Depositado",
    chamber: "DIPUTADOS",
    sourceChamber: "DIPUTADOS",
    originChamber: null,
    currentChamber: null,
    currentBody: null,
    proceduralFacts: {
      currentLocation: {
        state: "CHAMBER",
        basis: "OBSERVED",
        chamber: "DIPUTADOS",
        reason: "SOURCE_CORPUS",
        evidenceStatus: "Depositado",
        evidenceDate: null,
        evidenceSource: null,
      },
      expiration: {
        state: "RULE_NOT_APPLICABLE",
        basis: "DERIVED",
        reason: "TYPE_NOT_COVERED_BY_TWO_LEGISLATURE_RULE",
      },
    },
    condition: null,
    sourceCategory: null,
    subjectMatter: null,
    sponsor: null,
    sponsorRole: null,
    sponsorCount: null,
    sponsorLegislatorSourceId: null,
    sponsorProfileId: null,
    proponents: [],
    activities: [],
    votes: [],
    sourceCoverage: {
      proponents: true,
      history: true,
      commissions: true,
      documents: true,
      activities: true,
      votes: true,
    },
    party: null,
    province: null,
    committee: null,
    filedAt: "2026-08-28",
    expiresAt: null,
    initiated: null,
    initiatedAt: null,
    legislature: null,
    registrationPeriod: null,
    officialStatusChangedAt: null,
    promulgationNumber: null,
    promulgatedAt: null,
    sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/27047",
    events: [],
    commissionAssignments: [],
    documents: [],
    relatedNews: [],
  };
}

const props = (lang: "es" | "en") => ({
  params: Promise.resolve({ id: "27047" }),
  searchParams: Promise.resolve({ lang }),
});

describe("localized initiative detail title", () => {
  beforeEach(() => getInitiative.mockReset());

  it("uses the reviewed exact-current English title in metadata and the accessible h1", async () => {
    getInitiative.mockResolvedValue(initiative(translatedTitle));

    const metadata = await generateMetadata(props("en"));
    const html = renderToStaticMarkup(await InitiativePage(props("en")));

    expect(metadata.title).toContain(translatedTitle);
    expect(metadata.title).not.toContain(officialTitle);
    expect(html).toContain(
      'lang="en" aria-describedby="initiative-title-provenance">Public Records Bill</h1>',
    );
    expect(html).toContain("Oculis translation");
    expect(html).toContain("Official title in Spanish");
    expect(html).toContain(`<p class="mt-2 border-l-2 px-3 py-2 leading-relaxed" lang="es"`);
    expect(html).toContain(officialTitle);
  });

  it("falls back explicitly to the official Spanish title when English is pending", async () => {
    getInitiative.mockResolvedValue(initiative(null));

    const metadata = await generateMetadata(props("en"));
    const html = renderToStaticMarkup(await InitiativePage(props("en")));

    expect(metadata.title).toContain(officialTitle);
    expect(html).toContain(
      'lang="es" aria-describedby="initiative-title-translation-pending">Proyecto de ley sobre archivos públicos</h1>',
    );
    expect(html).toContain("English translation pending. Showing the official title in Spanish.");
    expect(html).not.toContain("Oculis translation</span>");
  });

  it("keeps the exact official title and omits translation messaging in Spanish", async () => {
    getInitiative.mockResolvedValue(initiative(translatedTitle));

    const html = renderToStaticMarkup(await InitiativePage(props("es")));

    expect(html).toContain(`lang="es">${officialTitle}</h1>`);
    expect(html).not.toContain("Oculis translation");
    expect(html).not.toContain("translation pending");
  });

  it("offers a live-guarded official PDF opener when metadata exists but background extraction is pending", async () => {
    getInitiative.mockResolvedValue({
      ...initiative(translatedTitle),
      documents: [
        {
          id: 19_788,
          source: "sil-diputados",
          sourceDocId: "260674",
          docType: "PROYECTO DEPOSITADO",
          extension: "pdf",
          url: "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=260674",
          uploadedAt: "2026-08-31",
          modifiedAt: null,
          sourceCategory: null,
          sourceFragment: null,
          firstSeenAt: "2026-08-31T15:43:47.991Z",
          lastSeenAt: "2026-09-01T10:24:59.770Z",
          pdfAvailable: false,
        },
      ],
    });

    const html = renderToStaticMarkup(await InitiativePage(props("es")));

    expect(html).toContain('href="/api/document/open?documentId=19788&amp;initiativeId=27047"');
    expect(html).toContain("Abrir PDF oficial");
    expect(html).not.toContain(
      "Oculis está verificando que la fuente entregue el archivo correcto",
    );
    expect(html).not.toContain("PDF verificado");
  });

  it("always shows the observed chamber and the source-published count state", async () => {
    getInitiative.mockResolvedValue({
      ...initiative(translatedTitle),
      type: "Proyecto de Ley",
      initiated: "NO",
      legislature: "2026-SLO",
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
    });

    const html = renderToStaticMarkup(await InitiativePage(props("es")));

    expect(html).toContain("Cámara actual");
    expect(html).toContain("Cámara de Diputados");
    expect(html).toContain("Última cámara oficial observada");
    expect(html).toContain("Movimiento oficial · Depositado · 31 ago de 2026");
    expect(html).toContain("Vencimiento normativo");
    expect(html).toContain("Cómputo aún no iniciado");
    expect(html).toContain("El plazo comienza con la toma en consideración, no con el depósito.");
    expect(html.match(/Cámara actual/g)).toHaveLength(2);
  });

  it("marks a constitutional expiry as an Oculis calculation in English", async () => {
    getInitiative.mockResolvedValue({
      ...initiative(translatedTitle),
      type: "Proyecto de Ley",
      initiated: "SI",
      initiatedAt: "2027-09-01",
      legislature: "2027-SLO",
      proceduralFacts: {
        currentLocation: {
          state: "CHAMBER",
          basis: "OFFICIAL",
          chamber: "SENADO",
          reason: "SOURCE_PUBLISHED_CURRENT_CHAMBER",
          evidenceStatus: null,
          evidenceDate: null,
          evidenceSource: null,
        },
        expiration: {
          state: "PROJECTED",
          basis: "DERIVED",
          date: "2028-07-25",
          reason: "TWO_ORDINARY_LEGISLATURES",
          startLegislature: "2027-SLO",
          endLegislature: "2028-PLO",
          startEvidenceDate: "2027-09-01",
          legalBasis: ["CRD-89", "CRD-100", "CRD-104"],
          methodVersion: "oculis-constitutional-expiry-v1",
        },
      },
    });

    const html = renderToStaticMarkup(await InitiativePage(props("en")));

    expect(html).toContain("Current chamber");
    expect(html).toContain("Senate of the Republic");
    expect(html).toContain("Normative expiry");
    expect(html).toContain("At the close of Jul 25, 2028");
    expect(html).toContain("Oculis calculation");
    expect(html).toContain('dateTime="2028-07-25"');
  });

  it("returns to the filtered catalog and promotes a selected distant co-sponsor", async () => {
    const proponents = Array.from({ length: 6 }, (_, index) => ({
      name: index === 5 ? "Francisca Trinidad Jaque Aponte" : `Proponente visible ${index + 1}`,
      firstNames: null,
      lastNames: null,
      legislatorId: index + 1,
      principal: index === 0,
      role: "Diputada",
      representationLevel: null,
      representationStatus: null,
      representationStart: null,
      representationEnd: null,
      representationPeriod: null,
      party: "PRM",
      partyName: "Partido Revolucionario Moderno",
      partyId: null,
      province: "Santo Domingo",
      constituency: null,
      profileId: index === 5 ? 150 : index + 1,
      chamber: "DIPUTADOS",
    }));
    getInitiative.mockResolvedValue({ ...initiative(null), proponents });

    const html = renderToStaticMarkup(
      await InitiativePage({
        params: Promise.resolve({ id: "27047" }),
        searchParams: Promise.resolve({
          lang: "es",
          returnTo: "/initiatives?legislator=150&chamber=DIPUTADOS&status=Depositado&page=2",
        }),
      }),
    );

    expect(html).toContain(
      'href="/initiatives?status=Depositado&amp;chamber=DIPUTADOS&amp;legislator=150&amp;page=2"',
    );
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Vínculo seleccionado");
    expect(html).toContain("Coproponente");
    expect(html.indexOf("Francisca Trinidad Jaque Aponte")).toBeLessThan(
      html.indexOf("Proponente visible 1"),
    );
  });
});
