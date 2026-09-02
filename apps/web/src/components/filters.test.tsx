import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ query: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

import { Filters } from "./filters";

const facets = { parties: [], statuses: [], provinces: [] };

describe("initiative catalog legislator filter", () => {
  it("explains the exact sponsor/co-sponsor scope and renders a removable Spanish chip", () => {
    navigation.query = "legislator=13";
    const html = renderToStaticMarkup(
      <Filters
        lang="es"
        facets={facets}
        legislatorFilter={{
          profileId: 13,
          fullName: "Brailyn Vargas",
          chamber: "DIPUTADOS",
        }}
      />,
    );

    expect(html).toContain("Iniciativas vinculadas a Brailyn Vargas");
    expect(html).toContain("figura como proponente principal, coproponente o proponente publicado");
    expect(html).toContain("Proponente: Brailyn Vargas");
    expect(html).toContain('aria-label="Quitar Proponente: Brailyn Vargas"');
  });

  it("localizes the linked sponsor context without exposing the official source id", () => {
    navigation.query = "legislator=13&lang=en";
    const html = renderToStaticMarkup(
      <Filters
        lang="en"
        facets={facets}
        legislatorFilter={{
          profileId: 13,
          fullName: "Brailyn Vargas",
          chamber: "DIPUTADOS",
        }}
      />,
    );

    expect(html).toContain("Initiatives linked to Brailyn Vargas");
    expect(html).toContain("appears as a principal sponsor, co-sponsor, or published sponsor");
    expect(html).toContain("Sponsor: Brailyn Vargas");
    expect(html).not.toContain("9912345");
  });

  it("shows the profile chamber as a locked chip and disables contradictory choices", () => {
    navigation.query = "legislator=13&chamber=SENADO";
    const html = renderToStaticMarkup(
      <Filters
        lang="es"
        facets={facets}
        legislatorFilter={{
          profileId: 13,
          fullName: "Brailyn Vargas",
          chamber: "DIPUTADOS",
        }}
      />,
    );

    expect(html).toContain("Cámara: Cámara de Diputados");
    expect(html).toContain("La cámara corresponde al perfil seleccionado.");
    expect(html).toContain(
      'aria-label="Cámara: Cámara de Diputados; fijada por el perfil seleccionado"',
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain('aria-label="Quitar Cámara: Cámara de Diputados"');
  });
});
