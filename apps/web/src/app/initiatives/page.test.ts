import { describe, expect, it } from "vitest";

import { initiativeCatalogPageHref, initiativeCatalogProvinceValues } from "./catalog-query";

describe("initiative catalog province filter", () => {
  it("accepts every source-literal spelling for known official aliases", () => {
    expect(initiativeCatalogProvinceValues("Baoruco")).toEqual(["Baoruco", "Bahoruco"]);
    expect(initiativeCatalogProvinceValues("Bahoruco")).toEqual(["Baoruco", "Bahoruco"]);
    expect(initiativeCatalogProvinceValues("Monte Cristi")).toEqual([
      "Monte Cristi",
      "Montecristi",
    ]);
    expect(initiativeCatalogProvinceValues("Distrito Nacional")).toEqual([
      "Distrito Nacional",
      "Santo Domingo de Guzmán",
      "Santo Domingo de Guzman",
    ]);
  });

  it("never reassigns national representation to Distrito Nacional", () => {
    expect(initiativeCatalogProvinceValues("Nacional")).toEqual(["Nacional"]);
  });

  it("keeps a source-literal plain province and ignores an empty query", () => {
    expect(initiativeCatalogProvinceValues(" Santiago ")).toEqual(["Santiago"]);
    expect(initiativeCatalogProvinceValues(undefined)).toEqual([]);
    expect(initiativeCatalogProvinceValues("   ")).toEqual([]);
  });
});

describe("initiative catalog pagination URL", () => {
  it("preserves province and deposited status when moving between pages", () => {
    expect(
      initiativeCatalogPageHref({ province: "Santo Domingo", status: "Depositado", page: "8" }, 2),
    ).toBe("/initiatives?status=Depositado&province=Santo+Domingo&page=2");
  });

  it("preserves English and every active filter while returning to page one", () => {
    expect(
      initiativeCatalogPageHref(
        {
          lang: "en",
          search: "salud",
          party: "PRM",
          status: "Depositado",
          chamber: "DIPUTADOS",
          province: "María Trinidad Sánchez",
          legislator: "42",
          page: "4",
        },
        1,
      ),
    ).toBe(
      "/initiatives?lang=en&search=salud&party=PRM&status=Depositado&chamber=DIPUTADOS&province=Mar%C3%ADa+Trinidad+S%C3%A1nchez&legislator=42",
    );
  });

  it("preserves the canonical legislator filter without exposing a source id", () => {
    expect(initiativeCatalogPageHref({ legislator: "314", page: "1" }, 3)).toBe(
      "/initiatives?legislator=314&page=3",
    );
  });
});
