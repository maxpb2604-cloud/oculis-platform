import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProvinceCompositionCharts } from "./province-composition-charts";

function render(lang: "es" | "en") {
  return renderToStaticMarkup(
    <ProvinceCompositionCharts
      province="Santo Domingo"
      totalInitiatives={641}
      activeInitiatives={251}
      partyAffiliations={[
        "PRM",
        "Partido Revolucionario Moderno",
        "FP",
        "Partido Fuerza del Pueblo",
        "PLD",
        null,
      ]}
      lang={lang}
    />,
  );
}

describe("HOME province party composition", () => {
  it("expands every acronym and uses the permanent PRM, FP, and PLD colors", () => {
    const html = render("es");

    expect(html).toContain("PRM (Partido Revolucionario Moderno)");
    expect(html).toContain("FP (Fuerza del Pueblo)");
    expect(html).toContain("PLD (Partido de la Liberación Dominicana)");
    expect(html).toContain("Partido no informado");
    expect(html).toContain("var(--party-prm-fill)");
    expect(html).toContain("var(--party-fp-fill)");
    expect(html).toContain("var(--party-pld-fill)");
  });

  it("keeps official party names in English mode and localizes the surrounding copy", () => {
    const html = render("en");

    expect(html).toContain("Members of Congress by party");
    expect(html).toContain("PRM (Partido Revolucionario Moderno)");
    expect(html).toContain("FP (Fuerza del Pueblo)");
    expect(html).toContain("PLD (Partido de la Liberación Dominicana)");
    expect(html).toContain("Party not reported");
  });

  it("announces expanded names and merged source aliases without relying on color", () => {
    const html = render("es");

    expect(html).toContain(
      "FP (Fuerza del Pueblo): 2; PRM (Partido Revolucionario Moderno): 2; PLD (Partido de la Liberación Dominicana): 1; Partido no informado: 1",
    );
  });
});
