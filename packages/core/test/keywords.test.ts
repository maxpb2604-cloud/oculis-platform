import { describe, expect, it } from "vitest";
import {
  expandQueryTerms,
  keywordBlob,
  normalizeText,
  THESAURUS,
} from "../src/keywords.js";

describe("normalizeText", () => {
  it("folds accents, lowercases, and strips punctuation", () => {
    expect(normalizeText("Energía Eléctrica, S.A.")).toBe("energia electrica s a");
    expect(normalizeText("NIÑEZ y Migración")).toBe("ninez y migracion");
    expect(normalizeText("  ITBIS/DGII  ")).toBe("itbis dgii");
  });
});

describe("expandQueryTerms", () => {
  it("expands a fiscal keyword to its domain synonyms/abbreviations", () => {
    const terms = expandQueryTerms("impuesto");
    expect(terms).toContain("tributario");
    expect(terms).toContain("itbis");
    expect(terms).toContain("fiscal");
  });

  it("matches an abbreviation and returns the concept synonyms", () => {
    const terms = expandQueryTerms("ITBIS");
    expect(terms).toContain("impuesto");
    expect(terms).toContain("tributario");
  });

  it("is accent-insensitive", () => {
    const withAccent = expandQueryTerms("energía eléctrica");
    const without = expandQueryTerms("energia electrica");
    expect(without).toEqual(withAccent);
    expect(without).toContain("electricidad");
  });

  it("corrects a common typo before matching", () => {
    // "inpuesto" → "impuesto" via COMMON_TYPOS
    expect(expandQueryTerms("inpuesto")).toContain("tributario");
  });

  it("expands a concept even when no such bill exists in the corpus", () => {
    const terms = expandQueryTerms("aborto");
    expect(terms).toContain("interrupcion del embarazo");
    expect(terms).toContain("tres causales");
  });

  it("returns nothing for an out-of-domain query", () => {
    expect(expandQueryTerms("zxqwv")).toEqual([]);
    expect(expandQueryTerms("")).toEqual([]);
  });
});

describe("keywordBlob", () => {
  it("injects concept tags for synonyms found in the title (findable by synonym)", () => {
    const blob = keywordBlob({
      title: "Proyecto de ley que exonera del pago de ITBIS a los medicamentos",
      category: "FISCAL",
      province: "Santiago",
    });
    // literal content is preserved (accent-folded)…
    expect(blob).toContain("itbis");
    expect(blob).toContain("medicamentos");
    // …and the fiscal concept tags are injected so it's findable by "impuesto"/"tributario"
    expect(blob).toContain("impuesto");
    expect(blob).toContain("tributario");
    // non-topical fields are included verbatim (searchable by province)
    expect(blob).toContain("santiago");
  });

  it("does NOT inject a concept from a non-topical field (sponsor/province only)", () => {
    // "energia" appears only in a province-ish field, not title/purpose → no energy tags
    const blob = keywordBlob({ title: "Reconocimiento a un ciudadano", province: "La Energia" });
    expect(blob).toContain("la energia");
    expect(blob).not.toContain("electricidad");
  });

  it("is deterministic and safe on a partial/empty row", () => {
    expect(keywordBlob({})).toBe("");
    expect(keywordBlob({ title: "Salud pública" })).toBe(keywordBlob({ title: "Salud pública" }));
  });
});

describe("thesaurus coverage", () => {
  it("has a substantial number of concept groups with unique keys", () => {
    expect(THESAURUS.length).toBeGreaterThanOrEqual(60);
    const keys = new Set(THESAURUS.map((g) => g.key));
    expect(keys.size).toBe(THESAURUS.length); // no duplicate keys
    for (const g of THESAURUS) {
      expect(g.match.length).toBeGreaterThan(0);
      expect(g.tags.length).toBeGreaterThan(0);
    }
  });
});
