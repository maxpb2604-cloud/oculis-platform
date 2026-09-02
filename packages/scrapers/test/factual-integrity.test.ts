import { describe, expect, it, vi } from "vitest";
import {
  explicitRegTypeFromTitle,
  canonicalLink,
  MispasAdapter,
  parseMispasWpfdCategories,
  parseRichRssXml,
  parseIntrantDocuments,
  rssDateToIso,
  SilDiputadosAdapter,
  SOURCE_REGISTRY,
} from "../src/index.js";

describe("factual extraction policy", () => {
  it("extracts a regulation type only from literal title text", () => {
    expect(explicitRegTypeFromTitle("Resolución interna 04-2026")).toBe("Resolución Interna");
    expect(explicitRegTypeFromTitle("Documento para comentarios")).toBeNull();
  });

  it("can address both perimidas and non-perimidas SIL slices", () => {
    const adapter = new SilDiputadosAdapter("https://official.test/api/iniciativa");
    expect(adapter.buildListUrl(4, true, 2, false)).toContain("perimidas=false");
    expect(adapter.buildListUrl(4, true, 2, true)).toContain("perimidas=true");
  });

  it("does not invent a publication time for an RSS date-only value", () => {
    expect(rssDateToIso("2026-08-05")).toBeNull();
    expect(rssDateToIso("Wed, 05 Aug 2026 10:30:00 GMT")).toBe("2026-08-05T10:30:00.000Z");
  });

  it("does not synthesize an RSS summary or split a Google News-style title", () => {
    const [item] = parseRichRssXml(`
      <item>
        <title>Ley A - debate interno - Medio Ejemplo</title>
        <link>https://example.test/a?edition=1</link>
        <content:encoded><![CDATA[Texto completo que no es resumen.]]></content:encoded>
        <source url="https://medio.test">Medio Ejemplo</source>
      </item>
    `);
    expect(item).toMatchObject({
      title: "Ley A - debate interno - Medio Ejemplo",
      summary: null,
      feedSource: "Medio Ejemplo",
    });
  });

  it("preserves query parameters that distinguish source URLs", () => {
    expect(canonicalLink("https://EXAMPLE.test/a?edition=1#top")).toBe(
      "https://example.test/a?edition=1",
    );
    expect(canonicalLink("https://example.test/a?edition=2")).not.toBe(
      canonicalLink("https://example.test/a?edition=1"),
    );
  });

  it("extracts only populated MISPAS categories with exact official ids", () => {
    expect(
      parseMispasWpfdCategories({
        success: true,
        data: [
          {
            term_id: 420,
            name: "Normas y Reglamentos Técnicos",
            count: 0,
            children: [
              { term_id: 421, name: "Enfermedades No Transmisibles", count: 4 },
              { term_id: 422, name: "Vacío", count: 0 },
              { term_id: "unsafe", name: "Inválido", count: 2 },
            ],
          },
        ],
      }),
    ).toEqual([{ id: 421, name: "Enfermedades No Transmisibles", count: 4 }]);
  });

  it("parses exact INTRANT card title, date, type and URL", () => {
    const docs = parseIntrantDocuments(
      `
        <div class="archivo-card">
          <div class="archivo-title"><strong>Resoluci&oacute;n Administrativa 9</strong></div>
          <span class="archivo-tipo">PDF</span>
          <span class="archivo-fecha">29 enero 2026</span>
          <a href="/wp-content/uploads/res-9.pdf" class="btn-descargar">Descargar</a>
        </div>
      `,
      "https://intrant.gob.do/transparencia/resoluciones",
    );
    expect(docs).toEqual([
      {
        title: "Resolución Administrativa 9",
        url: "https://intrant.gob.do/wp-content/uploads/res-9.pdf",
        dateText: "29 enero 2026",
        fileType: "PDF",
      },
    ]);
  });

  it("collects every MISPAS WPFD page without exposing placeholder legends", async () => {
    const files = Array.from({ length: 11 }, (_, index) => ({
      ID: 10_000 + index,
      post_title: index === 0 ? "Leyenda" : "Reglamento Técnico",
      description:
        index === 0
          ? "Este apartado no posee publicaciones oficiales en el mes de octubre 2020"
          : `Documento sanitario ${index}`,
      created_time: `2026-08-${String(index + 1).padStart(2, "0")} 12:00:00`,
      catname: "reglamentos-tecnicos",
      catid: 421,
      post_name: `documento-${index}`,
      ext: "pdf",
      seouri: "documentos_oai",
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("task=categories.getCats")) {
        return Response.json({
          success: true,
          data: [
            {
              term_id: 420,
              name: "Normas y Reglamentos Técnicos",
              count: 0,
              children: [{ term_id: 421, name: "Reglamentos Técnicos", count: 11 }],
            },
          ],
        });
      }
      const page = new URL(url).searchParams.get("page");
      return Response.json({
        files: page === "2" ? files.slice(10) : files.slice(0, 10),
        pagination:
          page === "2"
            ? "<a data-page='1'>Anterior</a><span class='current'>2</span>"
            : "<span class='current'>1</span><a data-page='2'>2</a>",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await new MispasAdapter("https://official.test", 420, 26).collect();
      expect(result.regulations).toHaveLength(10);
      expect(result.gaps).toEqual([]);
      expect(result.regulations[0]).toMatchObject({
        source: "reg-mispas",
        sourceId: "10001",
        institution: "MISPAS",
        regType: "Reglamento",
        title: "Reglamento Técnico: Documento sanitario 1",
        sourceCategory: "Reglamentos Técnicos",
        publishedAt: "2026-08-02",
        url: "https://official.test/documentos_oai/421/reglamentos-tecnicos/10001/documento-1.pdf",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not retry or bypass a permanent MISPAS certificate failure", async () => {
    const certificateError = Object.assign(new Error("issuer unavailable"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: certificateError });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(new MispasAdapter("https://official.test", 420, 26).collect()).rejects.toThrow(
        /UNABLE_TO_VERIFY_LEAF_SIGNATURE.*1 attempt/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("source registry", () => {
  it("has unique ids and discriminates known gaps", () => {
    const ids = SOURCE_REGISTRY.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of SOURCE_REGISTRY) {
      if (source.status === "KNOWN_GAP") {
        expect(source.required).toBe(false);
        expect(source.gapReason.length).toBeGreaterThan(0);
      }
    }
  });

  it("registers official movement sources and acknowledged missing coverage", () => {
    expect(SOURCE_REGISTRY.find((source) => source.id === "sil-movements")?.status).toBe("ACTIVE");
    expect(SOURCE_REGISTRY.find((source) => source.id === "reg-mispas")).toMatchObject({
      status: "ACTIVE",
      required: true,
      officialUrl: "https://www.msp.gob.do/web/Transparencia/base-legal-otras-normativas/",
    });
    expect(SOURCE_REGISTRY.find((source) => source.id === "roster-senado")).toMatchObject({
      status: "ACTIVE",
      required: true,
      officialUrl: "https://www.senadord.gob.do/senadores-2024-2028/",
    });
    for (const id of [
      "dip-known-agenda",
      "sen-approved",
      "sen-expired",
      "sen-votes",
      "sen-attendance",
      "sen-reports",
    ]) {
      expect(SOURCE_REGISTRY.find((source) => source.id === id)?.status).toBe("ACTIVE");
    }
    const diputadosApproved = SOURCE_REGISTRY.find((source) => source.id === "gap-dip-approved");
    expect(diputadosApproved?.status).toBe("KNOWN_GAP");
    expect(diputadosApproved?.gapReason).toContain("priorizadas");
  });
});
