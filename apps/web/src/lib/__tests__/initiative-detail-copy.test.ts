import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const detailSource = readFileSync(
  fileURLToPath(new URL("../../app/initiatives/[id]/page.tsx", import.meta.url)),
  "utf8",
);
const initiativeApiSource = readFileSync(
  fileURLToPath(new URL("../../app/api/initiatives/[id]/route.ts", import.meta.url)),
  "utf8",
);
const dataSource = readFileSync(fileURLToPath(new URL("../data.ts", import.meta.url)), "utf8");
const shellSource = readFileSync(
  fileURLToPath(new URL("../../components/app-shell.tsx", import.meta.url)),
  "utf8",
);
const tableSource = readFileSync(
  fileURLToPath(new URL("../../components/initiatives-table.tsx", import.meta.url)),
  "utf8",
);
const monitoringSource = readFileSync(
  fileURLToPath(new URL("../../components/monitoring.tsx", import.meta.url)),
  "utf8",
);
const publicPayloadSource = readFileSync(
  fileURLToPath(new URL("../public-initiative-payloads.ts", import.meta.url)),
  "utf8",
);

describe("initiative detail source-status copy", () => {
  it("does not expose the retired document-summary feature", () => {
    for (const source of [detailSource, initiativeApiSource, dataSource]) {
      expect(source).not.toContain("listDocumentSummaries");
      expect(source).not.toContain("document.summaryEligible");
      expect(source).not.toContain("initiative.summaries");
      expect(source).not.toContain("Resumen revisado");
      expect(source).not.toContain("Reviewed summary");
      expect(source).not.toContain("Copiar resumen");
      expect(source).not.toContain("Copy summary");
    }
  });

  it("keeps the technical coverage matrix out of the customer-facing detail", () => {
    expect(detailSource).not.toContain("Cobertura de la fuente pública");
    expect(detailSource).not.toContain("Public-source coverage");
    expect(detailSource).not.toContain("No verificada");
    expect(detailSource).not.toContain("Not verified");
    expect(detailSource).not.toContain("snapshot actual");
  });

  it("retains sourceCoverage only to make factual empty states honest and plain", () => {
    expect(detailSource).toContain("sourceCoverage.history");
    expect(detailSource).toContain("sourceCoverage.documents");
    expect(detailSource).toContain("sourceCoverage.activities");
    expect(detailSource).toContain("sourceCoverage.votes");
    expect(detailSource).toContain("Oculis todavía está verificando");
    expect(detailSource).not.toContain("Colección todavía no verificada");
    expect(detailSource).not.toContain("Collection not yet verified");

    // There is one canonical detail surface; the shell does not mount a duplicate preview.
    expect(shellSource).not.toContain("InitiativeModalHost");
    expect(shellSource).not.toContain("initiative-modal");
  });

  it("opens listed official bill text through a live guarded check", () => {
    expect(detailSource).toContain("officialDocumentLiveHref");
    expect(detailSource).not.toContain(
      "Oculis está verificando que la fuente entregue el archivo correcto",
    );
    expect(detailSource).toContain("Abrir PDF oficial");
    expect(detailSource).toContain("pdfAvailable:");
    expect(tableSource).toContain("officialDocumentOpenHref");
    expect(tableSource).not.toContain("PDF en verificación");
    expect(tableSource).not.toContain("preferredDocumentUrl");
    expect(publicPayloadSource).toContain("officialDocumentLiveHref");
    expect(publicPayloadSource).toContain("pdfAvailable:");
    expect(monitoringSource).toContain("officialDocumentOpenHref");
    expect(monitoringSource).not.toContain("item.docUrl");
    for (const source of [detailSource, tableSource, monitoringSource]) {
      expect(source).not.toContain("Documento registrado; PDF aún no publicado");
    }
    expect(publicPayloadSource).toContain("toPublicInitiativeListItem");
    expect(monitoringSource).toContain("officialDocumentOpenHref");
  });
});
