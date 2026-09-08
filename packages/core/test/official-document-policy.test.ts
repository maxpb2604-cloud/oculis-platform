import { describe, expect, it } from "vitest";
import {
  isCommitteeReportDocumentType,
  isCommitteeReportStatus,
  isDepositedBillDocumentType,
  officialCommitteeReportPdfUrl,
  officialDepositedBillPdfUrl,
} from "../src/official-document-policy.js";

const facts = (url: string | null, docType = "PROYECTO DEPOSITADO") => ({
  source: "sil-diputados",
  docType,
  url,
});

describe("official deposited bill PDF policy", () => {
  it("accepts exact HTTPS PDF/viewer URLs on both official domain families", () => {
    expect(
      officialDepositedBillPdfUrl(
        facts(
          "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=77",
        ),
      ),
    ).toContain("documentoId=77");
    expect(
      officialDepositedBillPdfUrl(
        facts("https://documentos.diputadosrd.gob.do/proyectos/texto-oficial.pdf"),
      ),
    ).toBe("https://documentos.diputadosrd.gob.do/proyectos/texto-oficial.pdf");
    expect(
      officialDepositedBillPdfUrl(
        facts(
          "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=214727",
          " P DEPOSITADO ",
        ),
      ),
    ).toContain("documentoId=214727");
  });

  it("recognizes only the two audited deposited-text labels", () => {
    expect(isDepositedBillDocumentType("PROYECTO DEPOSITADO")).toBe(true);
    expect(isDepositedBillDocumentType(" p depositado ")).toBe(true);
    expect(isDepositedBillDocumentType("PROYECTO DEPOSITADO PREVIO")).toBe(false);
    expect(isDepositedBillDocumentType("INFORME COMISIÓN")).toBe(false);
    expect(isDepositedBillDocumentType(null)).toBe(false);
  });

  it("recognizes committee-report statuses and document labels without mixing them", () => {
    expect(isCommitteeReportStatus("Con informe de comisión")).toBe(true);
    expect(isCommitteeReportStatus(" CON INFORME DE LA COMISION ")).toBe(true);
    expect(isCommitteeReportStatus("Enviada a comisión")).toBe(false);
    expect(isCommitteeReportDocumentType("INFORME COMISIÓN OBRAS PÚBLICAS")).toBe(true);
    expect(isCommitteeReportDocumentType("Informe favorable de la Comisión de Justicia")).toBe(
      true,
    );
    expect(isCommitteeReportDocumentType("PROYECTO DEPOSITADO")).toBe(false);
  });

  it("accepts only an exact official committee-report PDF URL", () => {
    const url =
      "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=261188";
    expect(
      officialCommitteeReportPdfUrl({
        source: "sil-diputados",
        docType: "INFORME COMISIÓN OBRAS PÚBLICAS Y COMUNICACIONES",
        url,
      }),
    ).toBe(url);
    expect(
      officialCommitteeReportPdfUrl({
        source: "sil-diputados",
        docType: "PROYECTO DEPOSITADO",
        url,
      }),
    ).toBeNull();
    expect(
      officialCommitteeReportPdfUrl({
        source: "sil-diputados",
        docType: "INFORME COMISIÓN",
        url: "https://evil.example/ReportesGenerales/VerDocumento?documentoId=261188",
      }),
    ).toBeNull();
  });

  it("rejects contextual types, HTTP, hostile hosts, credentials, and generic pages", () => {
    expect(
      officialDepositedBillPdfUrl(
        facts("https://www.diputadosrd.gob.do/agenda.pdf", "ORDEN DEL DÍA"),
      ),
    ).toBeNull();
    expect(
      officialDepositedBillPdfUrl(
        facts("https://www.diputadosrd.gob.do/proyecto-anterior.pdf", "PROYECTO DEPOSITADO PREVIO"),
      ),
    ).toBeNull();
    expect(
      officialDepositedBillPdfUrl(facts("http://www.diputadosrd.gob.do/proyecto.pdf")),
    ).toBeNull();
    expect(officialDepositedBillPdfUrl(facts("https://evil.test/proyecto.pdf"))).toBeNull();
    expect(
      officialDepositedBillPdfUrl(facts("https://user:pass@www.diputadosrd.gob.do/proyecto.pdf")),
    ).toBeNull();
    expect(officialDepositedBillPdfUrl(facts("https://www.diputadosrd.gob.do/sil/"))).toBeNull();
  });
});
