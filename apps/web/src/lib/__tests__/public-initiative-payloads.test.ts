import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { InitiativeListItem } from "@/lib/data";
import {
  toPublicHoyDepositItem,
  toPublicInitiativeListItem,
} from "@/lib/public-initiative-payloads";

const upstreamPdf =
  "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=260674";
const sourceRecord = "https://www.diputadosrd.gob.do/sil/iniciativa/27047";

const storedDeposit = {
  id: 20710,
  source: "sil-diputados",
  code: "06218-2024-2028-CD",
  type: "Proyecto de ley",
  title: "Proyecto de ley sobre archivos públicos",
  status: "Depositado",
  chamber: "DIPUTADOS",
  sourceId: "27047",
  sponsor: "Persona legisladora",
  sponsorRole: "Diputado",
  sponsorCount: 1,
  party: "PRM",
  province: "Santo Domingo",
  filedAt: "2026-08-31",
  sourceUrl: sourceRecord,
  sponsorProfileId: 9,
  sponsorLegislatorSourceId: "7001",
  docUploaded: true,
  docAvailable: false,
  docId: 19788,
  docUrl: upstreamPdf,
  docSource: "sil-diputados",
  docType: "PROYECTO DEPOSITADO",
};

const storedCatalogRow = {
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
  sourceUrl: sourceRecord,
  preferredDocumentUrl: upstreamPdf,
  preferredDocumentId: 19788,
  preferredDocumentAvailable: false,
} satisfies InitiativeListItem;

describe("Agenda public deposit payload", () => {
  for (const [lang, suffix] of [
    ["es", ""],
    ["en", "&lang=en"],
  ] as const) {
    it(`serializes only the local document opener across the RSC boundary (${lang})`, () => {
      const item = toPublicHoyDepositItem(storedDeposit, lang);
      const serialized = JSON.stringify(item);

      expect(item.officialRecordHref).toBe(sourceRecord);
      expect(item.officialDocumentOpenHref).toBe(
        `/api/document/open?documentId=19788&initiativeId=20710${suffix}`,
      );
      for (const privateField of [
        "source",
        "sourceId",
        "sourceUrl",
        "docId",
        "docUrl",
        "docSource",
        "docType",
      ]) {
        expect(item).not.toHaveProperty(privateField);
      }
      expect(serialized).not.toContain(upstreamPdf);
      expect(serialized).not.toContain("s-sil.camaradediputados.gob.do");
    });
  }

  it("keeps deposit document metadata out of the Commissions & Agendas client surface", () => {
    const pageSource = readFileSync(
      fileURLToPath(new URL("../../app/hoy/page.tsx", import.meta.url)),
      "utf8",
    );
    const commissionsSource = readFileSync(
      fileURLToPath(new URL("../../components/commissions-agendas.tsx", import.meta.url)),
      "utf8",
    );

    expect(pageSource).toContain("CommissionsAgendas");
    expect(pageSource).not.toContain("getDeposits");
    expect(pageSource).not.toContain("toPublicHoyDepositItem");
    for (const privateField of ["docUrl", "docSource", "docType"]) {
      expect(commissionsSource).not.toContain(privateField);
    }
  });
});

describe("Initiative catalog public payload", () => {
  for (const [lang, suffix] of [
    ["es", ""],
    ["en", "&lang=en"],
  ] as const) {
    it(`keeps the PDF clickable without serializing upstream metadata (${lang})`, () => {
      const item = toPublicInitiativeListItem(storedCatalogRow, lang);
      const serialized = JSON.stringify(item);

      expect(item.officialDocumentRegistered).toBe(true);
      expect(item.officialDocumentOpenHref).toBe(
        `/api/document/open?documentId=19788&initiativeId=20710${suffix}`,
      );
      for (const privateField of [
        "preferredDocumentId",
        "preferredDocumentUrl",
        "preferredDocumentAvailable",
      ]) {
        expect(item).not.toHaveProperty(privateField);
      }
      expect(serialized).not.toContain(upstreamPdf);
      expect(serialized).not.toContain("s-sil.camaradediputados.gob.do");
    });
  }
});
