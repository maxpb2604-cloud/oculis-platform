import { describe, expect, it, vi } from "vitest";
import {
  explicitRegTypeFromTitle,
  canonicalLink,
  MispasAdapter,
  parseRichRssXml,
  parseIntrantDocuments,
  parseMispasCollectionPage,
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

  it("parses MISPAS collection HTML without inventing a missing day", () => {
    const items = parseMispasCollectionPage(`
      <li class="ds-artifact-item odd">
        <h4 class="artifact-title">
          <a href="/handle/123456789/2385">Reglamento t&eacute;cnico de bioseguridad</a>
        </h4>
        <span class="date">2025-11</span>
      </li>
    `);
    expect(items).toEqual([
      {
        title: "Reglamento técnico de bioseguridad",
        url: "https://repositorio.msp.gob.do/handle/123456789/2385",
        dateText: "2025-11",
      },
    ]);
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

  it("uses MISPAS official HTML as a visible fallback when RSS is unavailable", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/rss")) return new Response("missing", { status: 404 });
      return new Response(`
        <li class="ds-artifact-item odd">
          <h4 class="artifact-title">
            <a href="/handle/123456789/2385">Reglamento t&eacute;cnico de bioseguridad</a>
          </h4>
          <span class="date">2025-11</span>
        </li>
      `);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await new MispasAdapter(
        "https://official.test/rss",
        "https://official.test/collection",
      ).collect();
      expect(result.regulations).toHaveLength(1);
      expect(result.regulations[0]?.publishedAt).toBeNull();
      expect(result.regulations[0]?.status).toBeNull();
      expect(result.gaps[0]).toContain("MISPAS RSS");
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
      await expect(
        new MispasAdapter(
          "https://official.test/rss",
          "https://official.test/collection",
        ).collect(),
      ).rejects.toThrow(/UNABLE_TO_VERIFY_LEAF_SIGNATURE.*1 attempt/);
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
      required: false,
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
