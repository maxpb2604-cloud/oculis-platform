import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { InitiativeListItem } from "@/lib/data";
import { toInitiativeCatalogRow } from "./catalog-row";

const upstreamPdf =
  "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=260674";

const storedRow = {
  id: 20710,
  source: "sil-diputados",
  sourceId: "159672",
  code: "06218-2024-2028-CD",
  title: "Proyecto de ley sobre archivos públicos",
  titleEn: "Bill on public records",
  status: "Depositado",
  sponsor: "Persona legisladora",
  sponsorRole: "Diputado",
  sponsorLegislatorSourceId: "7001",
  sponsorProfileId: 9,
  filteredProponentRelationship: null,
  party: "PRM",
  province: "Santo Domingo",
  filedAt: "2026-08-31",
  sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/159672",
  preferredDocumentUrl: upstreamPdf,
  preferredDocumentId: 19788,
  preferredDocumentAvailable: true,
} satisfies InitiativeListItem;

describe("initiative catalog server boundary", () => {
  it("passes only the narrowed server DTO to the catalog table", () => {
    const pageSource = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

    expect(pageSource).toContain("toInitiativeCatalogRow");
    expect(pageSource).toContain("rows={publicRows}");
    expect(pageSource).not.toContain("rows={result.rows}");
    expect(pageSource).not.toContain("preferredDocumentUrl");
    expect(pageSource).not.toContain("s-sil.camaradediputados.gob.do");
  });

  for (const [lang, suffix] of [
    ["es", ""],
    ["en", "&lang=en"],
  ] as const) {
    it(`exposes only guarded destinations and display facts (${lang})`, () => {
      const row = toInitiativeCatalogRow(storedRow, lang);
      const serialized = JSON.stringify(row);

      expect(row.officialDocumentOpenHref).toBe(
        `/api/document/open?documentId=19788&initiativeId=20710${suffix}`,
      );
      expect(row.officialRecordHref).toBe(storedRow.sourceUrl);
      for (const privateField of [
        "source",
        "sourceId",
        "sourceUrl",
        "sponsorLegislatorSourceId",
        "preferredDocumentId",
        "preferredDocumentUrl",
        "preferredDocumentAvailable",
      ]) {
        expect(row).not.toHaveProperty(privateField);
      }
      expect(serialized).not.toContain(upstreamPdf);
      expect(serialized).not.toContain("s-sil.camaradediputados.gob.do");
      expect(serialized).not.toContain("preferredDocumentUrl");
    });
  }

  it("fails closed for a non-official upstream document host", () => {
    const row = toInitiativeCatalogRow(
      {
        ...storedRow,
        preferredDocumentUrl: "https://example.com/not-official.pdf",
      },
      "es",
    );

    expect(row.officialDocumentOpenHref).toBeNull();
    expect(JSON.stringify(row)).not.toContain("example.com");
  });

  it("fails closed unless both exact database identifiers are valid", () => {
    const row = toInitiativeCatalogRow(
      {
        ...storedRow,
        preferredDocumentId: null,
      },
      "es",
    );

    expect(row.officialDocumentOpenHref).toBeNull();
    expect(row.officialDocumentRegistered).toBe(false);
  });
});
