import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DipKnownAgendaAdapter,
  parseKnownAgendaCatalog,
  parseKnownAgendaFilesPage,
  parseKnownAgendaPdf,
  parseKnownAgendaTitle,
} from "../src/dip-known-agenda.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("dip-known-agenda literal parsers", () => {
  it("preserves the official section/category metadata", () => {
    const catalog = parseKnownAgendaCatalog(fixture("dip-known-catalog.json"));
    expect(catalog.sectionId).toBe(143);
    expect(catalog.sectionTitle).toBe("Orden del día conocida por el pleno");
    expect(catalog.sectionCount).toBe(0);
    expect(catalog.categories[0]).toMatchObject({
      id: 1936,
      title: "2026-PLO-ÓRDENES DEL DÍA CONOCIDOS POR EL PLENO",
      count: 3,
    });
  });

  it("keeps literal file metadata and normalizes only title/date fields", () => {
    const page = parseKnownAgendaFilesPage(
      fixture("dip-known-files-page-1.json"),
      "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?page=1",
      1936,
    );
    expect(page.documents[0]).toMatchObject({
      sourceId: "1936:28859",
      title: "Sesión 50 del viernes 24 de julio de 2026",
      sessionNumber: "50",
      sessionDate: "2026-07-24",
      uploadedDate: "2026-07-27",
      initiativeCodes: [],
    });
    expect(page.documents[0]).not.toHaveProperty("status");
    expect(page.documents[0]).not.toHaveProperty("result");
    expect(page.documents[0]).not.toHaveProperty("probability");
  });

  it("returns null when a title does not state a session number or date", () => {
    expect(parseKnownAgendaTitle("Documento conocido por el Pleno")).toEqual({
      sessionNumber: null,
      sessionDate: null,
    });
  });

  it("extracts exact codes from PDF text without interpreting approval language", () => {
    const text = readFileSync(new URL("./fixtures/dip-known-pdf.txt", import.meta.url), "utf8");
    const parsed = parseKnownAgendaPdf(text);
    expect(parsed).toMatchObject({
      initiativeCodes: ["05956-2024-2028-CD", "01677-2026-PLO-SE"],
    });
    expect(parsed.mentions.map((mention) => mention.code)).toEqual(parsed.initiativeCodes);
    expect(parsed.mentions[0]?.rawText).toContain("05956-2024-2028-CD");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("result");
  });
});

describe("dip-known-agenda pagination", () => {
  it("reconciles unique file IDs with the official category count", async () => {
    const adapter = new DipKnownAgendaAdapter({
      fetchJson: async (url) => {
        const task = new URL(url).searchParams.get("task");
        if (task === "categories.getCategories") return fixture("dip-known-catalog.json");
        const page = new URL(url).searchParams.get("page");
        return fixture(
          page === "1" ? "dip-known-files-page-1.json" : "dip-known-files-page-2.json",
        );
      },
    });
    const catalog = await adapter.catalog();
    const documents = await adapter.documentsInCategory(catalog.categories[0]!, { pageSize: 2 });
    expect(documents.map((document) => document.fileId)).toEqual([28859, 28858, 28836]);
  });
});

const live = process.env.OCULIS_LIVE === "1" ? describe : describe.skip;
live("dip-known-agenda live metadata smoke", () => {
  it("reads an official category and reconciles its document metadata", async () => {
    const adapter = new DipKnownAgendaAdapter();
    const catalog = await adapter.catalog();
    expect(catalog.sectionId).toBe(143);
    expect(catalog.categories.length).toBeGreaterThan(0);
    const category = catalog.categories[0]!;
    const documents = await adapter.documentsInCategory(category);
    expect(documents).toHaveLength(category.count);
    expect(documents[0]?.downloadUrl).toMatch(/^https:\/\/camaradediputados\.gob\.do\//);
    expect(documents[0]).not.toHaveProperty("status");
    expect(documents[0]).not.toHaveProperty("result");
  }, 60_000);
});
