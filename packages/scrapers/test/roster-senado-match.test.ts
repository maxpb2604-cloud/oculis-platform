import { describe, expect, it } from "vitest";
import { matchCardSlug, nameTokens } from "../src/roster-senado.js";

// A few real senator cards (short forms from the /senadores/ index).
const CARDS = [
  { slug: "sanchez-ramirez", name: "Ricardo De Los Santos", role: null },
  { slug: "puerto-plata", name: "Ginnette Altagracia Bournigal", role: null },
  { slug: "bahoruco", name: "Secundino Velázquez Pimentel", role: null },
  { slug: "azua", name: "Lía Ynocencia Díaz Santana", role: null },
  { slug: "distrito-nacional", name: "Antonio M. Taveras Guzmán", role: null },
];

describe("roster-senado: nameTokens", () => {
  it("lowercases, strips accents and connector words", () => {
    expect(nameTokens("Ricardo De Los Santos Polanco")).toEqual(["ricardo", "santos", "polanco"]);
  });
  it("drops standalone initials shorter than 3 chars only when filtered downstream", () => {
    expect(nameTokens("Antonio M. Taveras")).toEqual(["antonio", "m", "taveras"]);
  });
});

describe("roster-senado: matchCardSlug", () => {
  it("matches a full legal name to its short-form card (extra surname)", () => {
    // committee member carries the full name; card is shorter
    expect(matchCardSlug("Ricardo De Los Santos Polanco", CARDS)).toBe("sanchez-ramirez");
  });

  it("matches across a different given name (senator goes by second name)", () => {
    // card: "Secundino Velázquez Pimentel" vs member "Augusto Velázquez Pimentel"
    expect(matchCardSlug("Augusto Velázquez Pimentel", CARDS)).toBe("bahoruco");
  });

  it("matches across a given-name spelling variant via a distinctive surname", () => {
    // card "Ginnette" vs member "Ginette A. Bournigal De Jiménez" — bournigal is unique
    expect(matchCardSlug("Ginette A. Bournigal De Jiménez", CARDS)).toBe("puerto-plata");
  });

  it("does not mis-link on a single common given name", () => {
    expect(matchCardSlug("Antonio Pérez Gómez", CARDS)).toBeNull();
  });

  it("returns null when nothing meaningfully overlaps", () => {
    expect(matchCardSlug("Juan Carlos Mejía", CARDS)).toBeNull();
  });
});
