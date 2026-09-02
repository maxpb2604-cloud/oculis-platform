import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  officialDocumentCtaHref,
  officialDocumentGuardHref,
  officialDocumentLiveHref,
} from "@/lib/official-document-links";

describe("official document guard links", () => {
  it("builds a local opener only for the official deposited Diputados PDF contract", () => {
    const href = officialDocumentGuardHref(
      {
        source: "sil-diputados",
        docType: "Proyecto depositado",
        url: "https://www.diputadosrd.gob.do/documentos/proyecto.pdf",
        pdfAvailable: true,
      },
      42,
      7,
    );
    expect(href).toMatch(/^\/api\/document\/open\?/);
    const query = new URL(href!, "http://localhost").searchParams;
    expect(query.get("documentId")).toBe("42");
    expect(query.get("initiativeId")).toBe("7");
    expect(query.has("source")).toBe(false);
    expect(query.has("docType")).toBe(false);
    expect(query.has("url")).toBe(false);
    expect(query.has("lang")).toBe(false);

    const englishHref = officialDocumentGuardHref(
      {
        source: "sil-diputados",
        docType: "Proyecto depositado",
        url: "https://www.diputadosrd.gob.do/documentos/proyecto.pdf",
        pdfAvailable: true,
      },
      42,
      7,
      "en",
    );
    expect(new URL(englishHref!, "http://localhost").searchParams.get("lang")).toBe("en");
  });

  it("fails closed for contextual, insecure, or foreign files", () => {
    expect(
      officialDocumentGuardHref(
        {
          source: "sil-diputados",
          docType: "Orden del día",
          url: "https://www.diputadosrd.gob.do/agenda.pdf",
        },
        42,
        7,
      ),
    ).toBeNull();
    expect(
      officialDocumentGuardHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "http://www.diputadosrd.gob.do/proyecto.pdf",
          pdfAvailable: true,
        },
        42,
        7,
      ),
    ).toBeNull();
    expect(
      officialDocumentGuardHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "https://example.test/proyecto.pdf",
          pdfAvailable: true,
        },
        42,
        7,
      ),
    ).toBeNull();
  });

  it("keeps contextual official attachments usable without bypassing a failed deposited row", () => {
    expect(
      officialDocumentCtaHref(
        {
          source: "sil-diputados",
          docType: "Orden del día",
          url: "https://www.diputadosrd.gob.do/documentos/agenda.pdf",
        },
        42,
        7,
      ),
    ).toBe("https://www.diputadosrd.gob.do/documentos/agenda.pdf");
    expect(
      officialDocumentCtaHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "https://www.diputadosrd.gob.do/sil/",
        },
        42,
        7,
      ),
    ).toBeNull();
    expect(
      officialDocumentCtaHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "https://www.diputadosrd.gob.do/documentos/proyecto.pdf",
          pdfAvailable: true,
        },
        42,
        7,
      ),
    ).toMatch(/^\/api\/document\/open\?/);
    expect(
      officialDocumentCtaHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "https://www.diputadosrd.gob.do/documentos/proyecto.pdf",
          pdfAvailable: false,
        },
        42,
        7,
      ),
    ).toBeNull();
    expect(
      officialDocumentCtaHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "https://www.diputadosrd.gob.do/documentos/proyecto.pdf",
          pdfAvailable: true,
        },
        null,
        7,
      ),
    ).toBeNull();
    expect(
      officialDocumentCtaHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "https://www.diputadosrd.gob.do/documentos/proyecto.pdf",
          pdfAvailable: true,
        },
        42,
        null,
      ),
    ).toBeNull();
  });

  it("builds an on-demand guarded opener for listed official metadata", () => {
    const href = officialDocumentLiveHref(
      {
        source: "sil-diputados",
        docType: "Proyecto depositado",
        url: "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=260674",
        pdfAvailable: false,
      },
      19_788,
      20_710,
    );
    expect(href).toBe("/api/document/open?documentId=19788&initiativeId=20710");

    expect(
      officialDocumentLiveHref(
        {
          source: "sil-diputados",
          docType: "P DEPOSITADO",
          url: "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=214727",
          pdfAvailable: false,
        },
        4_224,
        6_101,
      ),
    ).toBe("/api/document/open?documentId=4224&initiativeId=6101");

    expect(
      officialDocumentLiveHref(
        {
          source: "sil-diputados",
          docType: "Orden del día",
          url: "https://www.diputadosrd.gob.do/documentos/agenda.pdf",
        },
        42,
        7,
      ),
    ).toBeNull();
    expect(
      officialDocumentLiveHref(
        {
          source: "sil-diputados",
          docType: "Proyecto depositado",
          url: "https://example.test/proyecto.pdf",
        },
        42,
        7,
      ),
    ).toBeNull();
  });

  it("routes every bill-document CTA through the guard instead of a raw metadata URL", () => {
    const files = ["../../app/initiatives/[id]/page.tsx", "../public-initiative-payloads.ts"].map(
      (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"),
    );

    for (const source of files) {
      expect(source).toMatch(/officialDocument(?:Cta|Live)Href/);
      expect(source).not.toMatch(/href=\{(?:documentUrl|docUrl|r\.preferredDocumentUrl)\}/);
    }

    const tableSource = readFileSync(
      fileURLToPath(new URL("../../components/initiatives-table.tsx", import.meta.url)),
      "utf8",
    );
    expect(tableSource).toContain("officialDocumentOpenHref");
    expect(tableSource).not.toContain("preferredDocumentUrl");
    expect(tableSource).not.toContain("preferredDocumentId");

    const monitoringSource = readFileSync(
      fileURLToPath(new URL("../../components/monitoring.tsx", import.meta.url)),
      "utf8",
    );
    expect(monitoringSource).toContain("officialDocumentOpenHref");
    expect(monitoringSource).not.toContain("item.docUrl");
    expect(monitoringSource).not.toContain("item.docSource");
    expect(monitoringSource).not.toContain("item.docType");

    const shellSource = readFileSync(
      fileURLToPath(new URL("../../components/app-shell.tsx", import.meta.url)),
      "utf8",
    );
    expect(shellSource).not.toContain("InitiativeModalHost");
    expect(shellSource).not.toContain("initiative-modal");
  });
});
