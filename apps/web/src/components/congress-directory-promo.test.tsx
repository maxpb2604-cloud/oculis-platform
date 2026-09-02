import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HomeDirectoryPromoData } from "@/lib/data";
import { CongressDirectoryPromo } from "./congress-directory-promo";
import { LegislatorProfileProvider } from "./legislator-profile-provider";

const portraits = Array.from({ length: 13 }, (_, index) => ({
  profileId: index + 1,
  fullName: `Persona ${index + 1}`,
  chamber: index % 2 === 0 ? "DIPUTADOS" : "SENADO",
  role: null,
  party: index % 2 === 0 ? "PRM" : "FP",
  province: "Santo Domingo",
  photoUrl: `https://www.diputadosrd.gob.do/fotos/${index + 1}.jpg`,
}));

const composition = {
  basis: "active-official-roster-snapshot",
  chambers: [
    {
      chamber: "SENADO",
      groups: [
        {
          acronym: "PRM",
          fullName: "Partido Revolucionario Moderno",
          isMissing: false,
          count: 27,
        },
        { acronym: "FP", fullName: "Fuerza del Pueblo", isMissing: false, count: 3 },
      ],
      observedTotal: 30,
      reportedTotal: 30,
      unreportedTotal: 0,
    },
    {
      chamber: "DIPUTADOS",
      groups: [
        {
          acronym: "PRM",
          fullName: "Partido Revolucionario Moderno",
          isMissing: false,
          count: 140,
        },
        { acronym: "FP", fullName: "Fuerza del Pueblo", isMissing: false, count: 28 },
        {
          acronym: "PLD",
          fullName: "Partido de la Liberación Dominicana",
          isMissing: false,
          count: 12,
        },
      ],
      observedTotal: 180,
      reportedTotal: 180,
      unreportedTotal: 0,
    },
  ],
} satisfies HomeDirectoryPromoData["composition"];

function render(lang: "es" | "en", items = portraits) {
  return renderToStaticMarkup(
    <LegislatorProfileProvider lang={lang}>
      <CongressDirectoryPromo portraits={items} composition={composition} lang={lang} />
    </LegislatorProfileProvider>,
  );
}

describe("HOME congressional directory promotion", () => {
  it("renders the Spanish directory destination and thirteen profile-bubble triggers", () => {
    const html = render("es");

    expect(html).toContain("Visita el Directorio de Congresistas");
    expect(html).toContain("Todo lo que necesitas saber de los legisladores");
    expect(html).toContain(
      '<h2 id="home-directory-portraits-title">Todo lo que necesitas saber de los legisladores</h2>',
    );
    expect(html.indexOf("Composición partidaria")).toBeLessThan(
      html.indexOf("Todo lo que necesitas saber de los legisladores"),
    );
    expect(html).toMatch(
      /<h3 id="home-directory-promo-title"[^>]*>Visita el Directorio de Congresistas<\/h3>/,
    );
    expect(html.indexOf("Todo lo que necesitas saber de los legisladores")).toBeLessThan(
      html.indexOf("Visita el Directorio de Congresistas"),
    );
    expect(html).not.toContain("Conoce a quienes te representan");
    expect(html).toContain('href="/congreso"');
    expect(html).toContain('aria-label="Directorio y composición partidaria del Congreso"');
    expect(html.match(/data-entity="legislator"/g)).toHaveLength(13);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(13);
    expect(html.match(/aria-label="Abrir perfil[^"]*Cámara de Diputados/g)).toHaveLength(7);
    expect(html.match(/aria-label="Abrir perfil[^"]*Senado/g)).toHaveLength(6);
    expect(html.match(/data-portrait-scale="small"/g)).toHaveLength(4);
    expect(html.match(/data-portrait-scale="medium"/g)).toHaveLength(4);
    expect(html.match(/data-portrait-scale="large"/g)).toHaveLength(4);
    expect(html.match(/data-portrait-scale="hero"/g)).toHaveLength(1);
    expect(html).toContain("Cada foto abre primero la ficha de Oculis");
    expect(html).toContain("roles en comisiones");
    expect(html).toContain("contacto público disponible");
    expect(html).toContain("iniciativas depositadas vinculadas por Oculis");
    expect(html).toContain("PRM (Partido Revolucionario Moderno)");
    expect(html).toContain("FP (Fuerza del Pueblo)");
    expect(html).toContain(
      'aria-label="Abrir perfil de Persona 1, Cámara de Diputados, PRM (Partido Revolucionario Moderno)"',
    );
    expect(html).not.toContain("/sil/legislador/");
  });

  it("localizes the complete presentation and preserves the English directory URL", () => {
    const html = render("en");

    expect(html).toContain("Visit the Members of Congress Directory");
    expect(html).toContain("Everything you need to know about legislators");
    expect(html.indexOf("Party composition")).toBeLessThan(
      html.indexOf("Everything you need to know about legislators"),
    );
    expect(html.indexOf("Everything you need to know about legislators")).toBeLessThan(
      html.indexOf("Visit the Members of Congress Directory"),
    );
    expect(html).not.toContain("Meet the people who represent you");
    expect(html).toContain('href="/congreso?lang=en"');
    expect(html).toContain('aria-label="Congressional directory and party composition"');
    expect(html).toContain("Portraits published by the chambers");
    expect(html).toContain("Each portrait opens the Oculis profile first");
    expect(html).toContain("committee roles");
    expect(html).toContain("available public contact information");
    expect(html).toContain("filed initiatives linked by Oculis");
    expect(html).toContain("PRM (Partido Revolucionario Moderno)");
    expect(html).toContain(
      'aria-label="Open Persona 2&#x27;s profile, Senate, FP (Fuerza del Pueblo)"',
    );
    expect(html).not.toContain("Todo lo que necesitas saber de los legisladores");
  });

  it("renders source-backed images with fixed dimensions and non-duplicative alt text", () => {
    const html = render("es");

    expect(html.match(/<img /g)).toHaveLength(13);
    expect(html.match(/width="112" height="112"/g)).toHaveLength(13);
    expect(html.match(/alt=""/g)).toHaveLength(13);
    expect(html).toContain("Abrir perfil de Persona 1");
  });

  it("renders exactly thirteen distinct official profiles and fails closed for a partial set", () => {
    const withDuplicates = [portraits[0]!, portraits[0]!, ...portraits];
    const complete = render("es", withDuplicates);
    const profileKeys = [...complete.matchAll(/data-legislator-key="profile:(\d+)"/g)].map(
      (match) => match[1],
    );

    expect(profileKeys).toHaveLength(13);
    expect(new Set(profileKeys).size).toBe(13);

    const partial = render("es", portraits.slice(0, 12));
    expect(partial).toContain("todavía no reúne trece retratos oficiales verificables");
    expect(partial).not.toContain('data-entity="legislator"');

    const overflow = render("es", [
      ...portraits,
      { ...portraits[0]!, profileId: 99, fullName: "Persona 99" },
    ]);
    expect(overflow.match(/data-entity="legislator"/g)).toHaveLength(13);
    expect(overflow).not.toContain('data-legislator-key="profile:99"');
  });
});
