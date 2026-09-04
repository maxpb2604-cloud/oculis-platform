import { describe, expect, it } from "vitest";
import {
  matchCardSlug,
  matchCommissionMemberSlug,
  normalizeRosterName,
  parseProfileName,
} from "../src/roster-senado.js";

// A few real senator cards (short forms from the /senadores/ index).
const CARDS = [
  { slug: "sanchez-ramirez", name: "Ricardo De Los Santos", role: null },
  { slug: "puerto-plata", name: "Ginnette Altagracia Bournigal", role: null },
  { slug: "bahoruco", name: "Secundino Velázquez Pimentel", role: null },
  { slug: "azua", name: "Lía Ynocencia Díaz Santana", role: null },
  { slug: "distrito-nacional", name: "Antonio M. Taveras Guzmán", role: null },
];

describe("roster-senado: normalizeRosterName", () => {
  it("folds formatting without dropping identity-bearing words", () => {
    expect(normalizeRosterName("Ricardo Dé Los Santos Polanco")).toBe(
      "ricardo de los santos polanco",
    );
  });
});

describe("roster-senado: matchCardSlug", () => {
  it("matches one exact normalized full name", () => {
    expect(matchCardSlug("RICARDO DE LOS SANTOS", CARDS)).toBe("sanchez-ramirez");
  });

  it("does not link an extra-surname variant", () => {
    expect(matchCardSlug("Ricardo De Los Santos Polanco", CARDS)).toBeNull();
  });

  it("does not link different given names or spelling variants", () => {
    expect(matchCardSlug("Augusto Velázquez Pimentel", CARDS)).toBeNull();
    expect(matchCardSlug("Ginette A. Bournigal De Jiménez", CARDS)).toBeNull();
  });

  it("does not mis-link on a single common given name", () => {
    expect(matchCardSlug("Antonio Pérez Gómez", CARDS)).toBeNull();
  });

  it("returns null when nothing meaningfully overlaps", () => {
    expect(matchCardSlug("Juan Carlos Mejía", CARDS)).toBeNull();
  });
});

describe("roster-senado: reviewed commission identity literals", () => {
  const currentCards = [
    { slug: "bahoruco", name: "Andrés Guillermo Lama Pérez", role: null },
    { slug: "santiago", name: "Daniel Enrique De Jesús Rivera Reyes", role: null },
    { slug: "azua", name: "Lía Ynocencia Díaz De Díaz", role: null },
  ];

  it("links only exact reviewed Senate commission literals", () => {
    expect(matchCommissionMemberSlug("Andrés Gullermo Lama Pérez", currentCards)).toBe("bahoruco");
    expect(matchCommissionMemberSlug("Daniel Enrique Rivera", currentCards)).toBe("santiago");
    expect(matchCommissionMemberSlug("Lia Diaz Santana De Dìaz", currentCards)).toBe("azua");
  });

  it("fails closed if the reviewed target is absent or duplicated", () => {
    expect(
      matchCommissionMemberSlug("Andrés Gullermo Lama Pérez", currentCards.slice(1)),
    ).toBeNull();
    expect(
      matchCommissionMemberSlug("Andrés Gullermo Lama Pérez", [
        currentCards[0]!,
        { ...currentCards[0]!, name: "Otra tarjeta" },
      ]),
    ).toBeNull();
    expect(matchCommissionMemberSlug("Andrés Lama", currentCards)).toBeNull();
  });
});

describe("roster-senado: province-profile fallback", () => {
  it("extracts the senator name from semantic headings without Divi card markup", () => {
    const html = `
      <html><head><title>Senado | Santiago</title></head><body>
        <h2>DANIEL ENRIQUE DE JESÚS RIVERA REYES</h2>
        <h5>SENADOR DE LA REPÚBLICA, PROV. SANTIAGO</h5>
        <h6>Partido Revolucionario Moderno (PRM)</h6>
      </body></html>`;
    expect(parseProfileName(html)).toBe("Daniel Enrique De Jesús Rivera Reyes");
  });

  it("ignores institutional headings", () => {
    expect(parseProfileName("<h2>Senado de la República</h2><h3>Provincia</h3>")).toBeNull();
  });
});
