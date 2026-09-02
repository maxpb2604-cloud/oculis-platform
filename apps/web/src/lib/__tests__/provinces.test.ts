import { describe, expect, it } from "vitest";
import { normProvince, PROVINCE_ALIASES, resolveProvince } from "@/lib/provinces";

describe("normProvince", () => {
  it("lowercases input", () => {
    expect(normProvince("SANTIAGO")).toBe("santiago");
  });

  it("strips accents", () => {
    expect(normProvince("Peravia")).toBe("peravia");
    expect(normProvince("María Trinidad Sánchez")).toBe("maria trinidad sanchez");
    expect(normProvince("Espaillat")).toBe("espaillat");
  });

  it("collapses runs of whitespace to single spaces", () => {
    expect(normProvince("Santo   Domingo")).toBe("santo domingo");
    expect(normProvince("Hato\tMayor")).toBe("hato mayor");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normProvince("  Azua  ")).toBe("azua");
  });

  it("combines lowercasing, accent stripping, and whitespace collapse", () => {
    expect(normProvince("  MARÍA   TRINIDAD  SÁNCHEZ ")).toBe("maria trinidad sanchez");
  });
});

describe("resolveProvince", () => {
  it("does not assign national representation to Distrito Nacional", () => {
    expect(resolveProvince("Nacional")).toBe("nacional");
  });

  it("resolves the 'Santo Domingo de Guzmán' alias to 'distrito nacional'", () => {
    expect(resolveProvince("Santo Domingo de Guzmán")).toBe("distrito nacional");
  });

  it("resolves the 'Bahoruco' alias to 'baoruco'", () => {
    expect(resolveProvince("Bahoruco")).toBe("baoruco");
  });

  it("resolves aliases case- and accent-insensitively", () => {
    expect(resolveProvince("BAHORUCO")).toBe("baoruco");
    expect(resolveProvince("santo domingo de guzman")).toBe("distrito nacional");
  });

  it("reconciles the official one-word Montecristi spelling with the map label", () => {
    expect(resolveProvince("Montecristi")).toBe("monte cristi");
    expect(resolveProvince("Monte Cristi")).toBe("monte cristi");
  });

  it("passes a plain (non-aliased) province through normalized", () => {
    expect(resolveProvince("Santiago")).toBe("santiago");
    expect(resolveProvince("La Vega")).toBe("la vega");
    // already-canonical province with accent is normalized but not re-aliased
    expect(resolveProvince("Distrito Nacional")).toBe("distrito nacional");
  });
});

describe("PROVINCE_ALIASES", () => {
  it("is keyed on already-normalized province names", () => {
    for (const key of Object.keys(PROVINCE_ALIASES)) {
      expect(normProvince(key)).toBe(key);
    }
  });
});
