import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InitiativeCatalogRow } from "@/app/initiatives/catalog-row";

vi.mock("@/components/legislator-profile-provider", () => ({
  LegislatorProfileTrigger: ({
    children,
    profileId,
  }: {
    children: React.ReactNode;
    profileId: number | null;
  }) => (
    <button type="button" data-entity="legislator" data-profile-id={profileId ?? undefined}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/primitives", () => ({
  NewTabNotice: ({ lang }: { lang: "es" | "en" }) => (
    <span className="sr-only">
      {lang === "es" ? " (abre en una pestaña nueva)" : " (opens in a new tab)"}
    </span>
  ),
}));

import { InitiativesTable } from "./initiatives-table";

const baseRow: InitiativeCatalogRow = {
  id: 2971,
  chamber: "DIPUTADOS",
  code: "06128-2024-2028-CD",
  title: "Proyecto de ley de ejemplo",
  titleEn: "Example bill",
  status: "Depositado",
  sponsor: "Elías Wessin Chávez",
  sponsorRole: "Diputado",
  sponsorProfileId: 99,
  sponsorIsLegislator: true,
  filteredProponentRelationship: null,
  party: "PQDC",
  province: "Santo Domingo",
  filedAt: "2026-08-28",
  officialRecordHref: "https://www.diputadosrd.gob.do/sil/iniciativa/2971",
  officialDocumentOpenHref: null,
  officialDocumentRegistered: false,
};

const deputy = {
  profileId: 150,
  fullName: "Francisca Trinidad Jaque Aponte",
  chamber: "DIPUTADOS" as const,
};

describe("filtered legislator relationship in the initiatives table", () => {
  it("shows an exact Spanish principal relationship without replacing the published sponsor", () => {
    const html = renderToStaticMarkup(
      <InitiativesTable
        rows={[{ ...baseRow, filteredProponentRelationship: "principal" }]}
        lang="es"
        legislatorFilter={deputy}
        detailReturnTo="/initiatives?legislator=150&chamber=DIPUTADOS"
      />,
    );

    expect(html).toContain("Vinculada a");
    expect(html).toContain("Francisca Trinidad Jaque Aponte");
    expect(html).toContain('data-entity="legislator"');
    expect(html).toContain('data-profile-id="150"');
    expect(html).toContain("Proponente principal");
    expect(html).toContain("Elías Wessin Chávez");
    expect(html).toContain("returnTo=%2Finitiatives%3Fchamber%3DDIPUTADOS%26legislator%3D150");
  });

  for (const [lang, href, label, newTabNotice] of [
    [
      "es",
      "/api/document/open?documentId=19788&initiativeId=2971",
      "PDF oficial",
      "abre en una pestaña nueva",
    ],
    [
      "en",
      "/api/document/open?documentId=19788&initiativeId=2971&lang=en",
      "Official PDF",
      "opens in a new tab",
    ],
  ] as const) {
    it(`renders only the guarded local PDF opener with new-tab semantics (${lang})`, () => {
      const html = renderToStaticMarkup(
        <InitiativesTable
          rows={[{ ...baseRow, officialDocumentOpenHref: href, officialDocumentRegistered: true }]}
          lang={lang}
        />,
      );

      expect(html).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain(label);
      expect(html).toContain(newTabNotice);
      expect(html).not.toContain("s-sil.camaradediputados.gob.do");
      expect(html).not.toContain("preferredDocumentUrl");
    });
  }

  it("fails closed when a document is registered without a guarded local opener", () => {
    const html = renderToStaticMarkup(
      <InitiativesTable
        rows={[{ ...baseRow, officialDocumentOpenHref: null, officialDocumentRegistered: true }]}
        lang="es"
      />,
    );

    expect(html).toContain("PDF no disponible");
    expect(html).not.toContain("/api/document/open");
    expect(html).not.toContain("PDF oficial");
  });

  it("localizes an exact co-sponsor relationship in English", () => {
    const html = renderToStaticMarkup(
      <InitiativesTable
        rows={[{ ...baseRow, filteredProponentRelationship: "coproponent" }]}
        lang="en"
        legislatorFilter={deputy}
      />,
    );

    expect(html).toContain("Linked to");
    expect(html).toContain("Francisca Trinidad Jaque Aponte");
    expect(html).toContain("Co-sponsor");
    expect(html).not.toContain("Principal sponsor");
    expect(html).toContain('lang="en"');
    expect(html).toContain("Example bill");
    expect(html).toContain("Oculis translation");
    expect(html).not.toContain(">Proyecto de ley de ejemplo</a>");
  });

  it("keeps an untranslated official title in Spanish instead of inventing English", () => {
    const html = renderToStaticMarkup(
      <InitiativesTable rows={[{ ...baseRow, titleEn: null }]} lang="en" />,
    );

    expect(html).toContain('lang="es"');
    expect(html).toContain("Proyecto de ley de ejemplo");
    expect(html).toContain("Official Spanish title · translation pending");
  });

  it("labels source-published Senate sponsorship without inferring hierarchy", () => {
    const html = renderToStaticMarkup(
      <InitiativesTable
        rows={[
          {
            ...baseRow,
            chamber: "SENADO",
            filteredProponentRelationship: "published",
          },
        ]}
        lang="es"
        legislatorFilter={{
          profileId: 194,
          fullName: "Omar Leonel Fernández Domínguez",
          chamber: "SENADO",
        }}
      />,
    );

    expect(html).toContain("Proponente publicado");
    expect(html).not.toContain("Coproponente");
  });

  it("does not render relationship copy outside a legislator-filtered view", () => {
    const html = renderToStaticMarkup(
      <InitiativesTable
        rows={[{ ...baseRow, filteredProponentRelationship: "coproponent" }]}
        lang="es"
      />,
    );

    expect(html).not.toContain("Vinculada a");
    expect(html).not.toContain("Coproponente");
    expect(html).toContain("Elías Wessin Chávez");
  });

  it("offers a contextual zero state that preserves the selected legislator", () => {
    const html = renderToStaticMarkup(
      <InitiativesTable
        rows={[]}
        lang="es"
        legislatorFilter={deputy}
        clearAdditionalFiltersHref="/initiatives?chamber=DIPUTADOS&legislator=150"
      />,
    );

    expect(html).toContain("No hay iniciativas vinculadas con estos filtros");
    expect(html).toContain("Francisca Trinidad Jaque Aponte");
    expect(html).toContain("Quitar filtros adicionales");
    expect(html).toContain('href="/initiatives?chamber=DIPUTADOS&amp;legislator=150"');
  });
});
