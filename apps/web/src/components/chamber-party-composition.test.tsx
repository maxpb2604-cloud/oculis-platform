import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HomeChamberComposition } from "@/lib/data";
import { ChamberPartyComposition, nextChamberTab } from "./chamber-party-composition";

const chambers: HomeChamberComposition[] = [
  {
    chamber: "DIPUTADOS",
    groups: [
      {
        acronym: "PRM",
        fullName: "Partido Revolucionario Moderno",
        isMissing: false,
        count: 146,
      },
      { acronym: "FP", fullName: "Fuerza del Pueblo", isMissing: false, count: 28 },
      {
        acronym: "PLD",
        fullName: "Partido de la Liberación Dominicana",
        isMissing: false,
        count: 13,
      },
      { acronym: null, fullName: null, isMissing: true, count: 3 },
    ],
    observedTotal: 190,
    reportedTotal: 187,
    unreportedTotal: 3,
  },
  {
    chamber: "SENADO",
    groups: [
      {
        acronym: "PRM",
        fullName: "Partido Revolucionario Moderno",
        isMissing: false,
        count: 19,
      },
      { acronym: "FP", fullName: "Fuerza del Pueblo", isMissing: false, count: 9 },
      {
        acronym: "PLD",
        fullName: "Partido de la Liberación Dominicana",
        isMissing: false,
        count: 3,
      },
      {
        acronym: "PRSC",
        fullName: "Partido Reformista Social Cristiano",
        isMissing: false,
        count: 1,
      },
    ],
    observedTotal: 32,
    reportedTotal: 32,
    unreportedTotal: 0,
  },
];

const render = (lang: "es" | "en") =>
  renderToStaticMarkup(<ChamberPartyComposition chambers={chambers} lang={lang} />);

describe("HOME chamber party composition", () => {
  it("defaults to the Senate with an exact one-seat-per-member contract", () => {
    const html = render("es");

    expect(html).toContain("Composición partidaria");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Seleccionar cámara legislativa"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Senado<\/button>/);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Cámara de Diputados<\/button>/);
    expect(html).toContain('data-seat-count="32"');
    expect(html).toContain('data-observed-total="32"');
    expect(html).toContain("Senado de la República");
  });

  it("expands every acronym, exposes counts and percentages, and uses permanent colors", () => {
    const html = render("es");

    expect(html).toContain("PRM (Partido Revolucionario Moderno)");
    expect(html).toContain("FP (Fuerza del Pueblo)");
    expect(html).toContain("PLD (Partido de la Liberación Dominicana)");
    expect(html).toContain("PRSC (Partido Reformista Social Cristiano)");
    expect(html).toContain("59.4%");
    expect(html).toContain("28.1%");
    expect(html).toContain("var(--party-prm-fill)");
    expect(html).toContain("var(--party-fp-fill)");
    expect(html).toContain("var(--party-pld-fill)");
    expect(html).toContain("la posición no representa ideología");
  });

  it("localizes the complete interface while retaining official Spanish party names", () => {
    const html = render("en");

    expect(html).toContain("Party composition");
    expect(html).toContain("National Congress");
    expect(html).toContain("Senate of the Republic");
    expect(html).toContain("Chamber of Deputies");
    expect(html).toContain("active directory members");
    expect(html).toContain("position does not represent ideology");
    expect(html).toContain("PRM (Partido Revolucionario Moderno)");
    expect(html).toContain("FP (Fuerza del Pueblo)");
    expect(html).toContain("PLD (Partido de la Liberación Dominicana)");
  });

  it("implements wrapping arrow navigation plus Home and End", () => {
    const available = ["SENADO", "DIPUTADOS"] as const;

    expect(nextChamberTab("SENADO", "ArrowRight", available)).toBe("DIPUTADOS");
    expect(nextChamberTab("DIPUTADOS", "ArrowRight", available)).toBe("SENADO");
    expect(nextChamberTab("SENADO", "ArrowLeft", available)).toBe("DIPUTADOS");
    expect(nextChamberTab("DIPUTADOS", "ArrowUp", available)).toBe("SENADO");
    expect(nextChamberTab("SENADO", "End", available)).toBe("DIPUTADOS");
    expect(nextChamberTab("DIPUTADOS", "Home", available)).toBe("SENADO");
    expect(nextChamberTab("SENADO", "Enter", available)).toBeNull();
  });
});
