import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InitiativeTitleProvenance } from "./dashboard";

describe("InitiativeTitleProvenance", () => {
  it("labels an English translation and exposes the official Spanish title in details", () => {
    const html = renderToStaticMarkup(
      <InitiativeTitleProvenance
        lang="en"
        officialSpanishTitle="Proyecto de ley sobre salud pública"
      />,
    );

    expect(html).toContain("Oculis translation");
    expect(html).toContain("<details");
    expect(html).toContain("Official title in Spanish");
    expect(html).toContain('lang="es"');
    expect(html).toContain("Proyecto de ley sobre salud pública");
    expect(html).not.toContain("title=");
  });

  it("uses the Spanish provenance labels when requested", () => {
    const html = renderToStaticMarkup(
      <InitiativeTitleProvenance lang="es" officialSpanishTitle="Título oficial" />,
    );

    expect(html).toContain("Traducción de Oculis");
    expect(html).toContain("Título oficial en español");
  });
});
