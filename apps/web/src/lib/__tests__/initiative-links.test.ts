import { describe, expect, it } from "vitest";
import {
  initiativeCatalogReturnHref,
  initiativeCatalogReturnLegislatorProfileId,
  initiativeDetailHref,
  legislatorFiledInitiativesHref,
  officialInitiativeHref,
} from "@/lib/initiative-links";

describe("initiative destinations", () => {
  it("uses the read-only ficha proxy only for exact senado-sil records", () => {
    expect(
      officialInitiativeHref({
        source: "senado-sil",
        sourceId: "39660",
        sourceUrl: "https://www.senadord.gob.do/secretaria/iniciativas/",
      }),
    ).toBe("/api/senado/ficha/39660");
    expect(
      officialInitiativeHref(
        {
          source: "senado-sil",
          sourceId: "39660",
          sourceUrl: "https://www.senadord.gob.do/secretaria/iniciativas/",
        },
        "en",
      ),
    ).toBe("/api/senado/ficha/39660?lang=en");
    expect(
      officialInitiativeHref({
        source: "senado",
        sourceId: "39660",
        sourceUrl: null,
      }),
    ).toBeNull();
  });

  it("does not fall back to a generic Senate landing when the record id is invalid", () => {
    expect(
      officialInitiativeHref({
        source: "senado-sil",
        sourceId: "01677-2026-PLO-SE",
        sourceUrl:
          "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
      }),
    ).toBeNull();
  });

  it("keeps exact official Diputados records and rejects mismatched hosts", () => {
    expect(
      officialInitiativeHref({
        source: "sil-diputados",
        sourceId: "123",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/123",
      }),
    ).toBe("https://www.diputadosrd.gob.do/sil/iniciativa/123");
    expect(
      officialInitiativeHref({
        source: "sil-diputados",
        sourceId: "123",
        sourceUrl: "https://example.com/sil/iniciativa/123",
      }),
    ).toBeNull();
    expect(
      officialInitiativeHref({
        source: "sil-diputados",
        sourceId: "123",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/456",
      }),
    ).toBeNull();
    expect(
      officialInitiativeHref({
        source: "sil-diputados",
        sourceId: "123",
        sourceUrl: "https://www.diputadosrd.gob.do/sil/",
      }),
    ).toBeNull();
  });

  it("builds copyable detail URLs while preserving English", () => {
    expect(initiativeDetailHref(42, "es")).toBe("/initiatives/42");
    expect(initiativeDetailHref(42, "en")).toBe("/initiatives/42?lang=en");
  });

  it("carries a validated filtered-catalog return target into the detail URL", () => {
    expect(
      initiativeDetailHref(
        42,
        "es",
        "/initiatives?legislator=13&chamber=DIPUTADOS&status=Depositado&page=2",
      ),
    ).toBe(
      "/initiatives/42?returnTo=%2Finitiatives%3Fstatus%3DDepositado%26chamber%3DDIPUTADOS%26legislator%3D13%26page%3D2",
    );
    expect(initiativeDetailHref(42, "en", "/initiatives?legislator=13&chamber=DIPUTADOS")).toBe(
      "/initiatives/42?lang=en&returnTo=%2Finitiatives%3Fchamber%3DDIPUTADOS%26legislator%3D13%26lang%3Den",
    );
  });

  it("never turns an external or non-catalog return target into a back link", () => {
    for (const unsafe of [
      "https://example.com/initiatives?legislator=13",
      "//example.com/initiatives?legislator=13",
      "javascript:alert(1)",
      "/initiatives/42?legislator=13",
      "/initiatives#https://example.com",
    ]) {
      expect(initiativeDetailHref(42, "es", unsafe)).toBe("/initiatives/42");
      expect(initiativeCatalogReturnHref(unsafe, "es")).toBe("/initiatives");
      expect(initiativeCatalogReturnLegislatorProfileId(unsafe, "es")).toBeNull();
    }
  });

  it("rebuilds only owned catalog filters and returns the canonical profile id", () => {
    const returnTo =
      "/initiatives?legislator=013&chamber=DIPUTADOS&unknown=https://example.com&lang=es";
    expect(initiativeCatalogReturnHref(returnTo, "en")).toBe(
      "/initiatives?chamber=DIPUTADOS&legislator=13&lang=en",
    );
    expect(initiativeCatalogReturnLegislatorProfileId(returnTo, "en")).toBe(13);
    expect(
      initiativeCatalogReturnLegislatorProfileId("/initiatives?legislator=13&legislator=14", "es"),
    ).toBeNull();
  });

  it("builds a canonical legislator catalog URL without exposing source identifiers", () => {
    expect(legislatorFiledInitiativesHref(42, "es")).toBe("/initiatives?legislator=42");
    expect(legislatorFiledInitiativesHref(42, "en")).toBe("/initiatives?legislator=42&lang=en");
    expect(legislatorFiledInitiativesHref(0, "es")).toBeNull();
    expect(legislatorFiledInitiativesHref(Number.NaN, "en")).toBeNull();
  });
});
