import { describe, expect, it } from "vitest";
import {
  parseApprovedInitiativeMentions,
  parseExpiredInitiativeRecords,
  parseSenadoAttendanceMeetingDates,
  parseSenadoPublicationLanding,
  parseSenadoReportReferences,
  SenadoPublicationsAdapter,
  SENADO_PUBLICATION_SOURCES,
  type SenadoPublicationTransport,
} from "../src/senado-publicaciones.js";

const approvedSource = SENADO_PUBLICATION_SOURCES.find(
  (source) => source.kind === "APPROVED_INITIATIVES",
)!;

function wpfdFile(id: number, title = `Documento ${id}`) {
  return {
    ID: id,
    post_title: title,
    post_name: `documento-${id}`,
    ext: "pdf",
    size: "1234",
    created_time: "2026-05-14 10:32:09",
    modified_time: "2026-05-15 11:00:00",
    created: "14-05-2026",
    modified: "15-05-2026",
    catname: "iniciativas-aprobadas",
    cattitle: "Iniciativas Aprobadas",
    catid: "1389",
    linkdownload: `https://www.senadord.gob.do/Descargas/1389/iniciativas-aprobadas/${id}/documento-${id}`,
    openpdflink: `https://www.senadord.gob.do/preview/${id}`,
  };
}

describe("Senado documentary publications", () => {
  it("paginates until the official category count and preserves exact document metadata", async () => {
    const pages = [
      { files: [wpfdFile(10), wpfdFile(9)], category: { term_id: 1389, count: 3 } },
      { files: [wpfdFile(8)], category: { term_id: 1389, count: 3 } },
    ];
    const requested: string[] = [];
    const transport: SenadoPublicationTransport = {
      json: async (url) => {
        requested.push(url);
        return pages[requested.length - 1];
      },
      text: async () => "",
      pdfText: async () => ({ text: "", pages: 0 }),
    };
    const result = await new SenadoPublicationsAdapter(transport).collect({
      kinds: ["APPROVED_INITIATIVES"],
    });

    expect(requested).toHaveLength(2);
    expect(requested[1]).toContain("page=2");
    expect(result.gaps).toEqual([]);
    expect(result.observations[0]).toMatchObject({
      reportedCount: 3,
      collectedCount: 3,
      complete: true,
    });
    expect(result.documents[0]).toMatchObject({
      source: "senado-publicaciones",
      kind: "APPROVED_INITIATIVES",
      categoryId: approvedSource.categoryId,
      fileId: 10,
      title: "Documento 10",
      sizeBytes: 1234,
      addedOn: "2026-05-14",
      modifiedOn: "2026-05-15",
      downloadUrl:
        "https://www.senadord.gob.do/Descargas/1389/iniciativas-aprobadas/10/documento-10",
    });
  });

  it("makes a page limit explicit instead of presenting a partial collection as complete", async () => {
    const transport: SenadoPublicationTransport = {
      json: async () => ({
        files: [wpfdFile(10), wpfdFile(9)],
        category: { term_id: 1389, count: 3 },
      }),
      text: async () => "",
      pdfText: async () => ({ text: "", pages: 0 }),
    };
    const result = await new SenadoPublicationsAdapter(transport).collect({
      kinds: ["APPROVED_INITIATIVES"],
      maxPagesPerSource: 1,
    });
    expect(result.observations[0]?.complete).toBe(false);
    expect(result.gaps[0]).toContain("2 de 3");
  });

  it("preserves the official electronic-votes empty state as literal evidence", async () => {
    const officialMessage = "Esta categoría actualmente no cuenta con archivos para ser mostrados";
    const html = `<div class="wpfd-empty-category-message-section"><p class="wpfd-empty-category-message">${officialMessage}</p></div>`;
    expect(parseSenadoPublicationLanding(html)).toEqual({
      categoryId: null,
      emptyMessage: officialMessage,
    });

    const result = await new SenadoPublicationsAdapter({
      json: async () => ({}),
      text: async () => html,
      pdfText: async () => ({ text: "", pages: 0 }),
    }).collect({ kinds: ["ELECTRONIC_VOTES"] });
    expect(result.documents).toEqual([]);
    expect(result.observations[0]).toMatchObject({ collectedCount: 0, complete: true });
    expect(result.observations[0]?.emptyMessage).toBe(officialMessage);
    expect(result.gaps).toEqual([]);
  });

  it("extracts complete codes from approved lists without inferring flattened columns", () => {
    const text =
      "01 01450-2026-PLO-SE PROYECTO DE LEY ... 15/04/2026 SENADO PROPONENTE " +
      "02 01080-2025-SLO-SE RESOLUCIÓN ... 15/04/2026 SENADO PROPONENTE";
    const records = parseApprovedInitiativeMentions(text);
    expect(records.map((record) => record.code)).toEqual([
      "01450-2026-PLO-SE",
      "01080-2025-SLO-SE",
    ]);
    expect(records[0]?.rawText).toContain("15/04/2026 SENADO");
    expect(records[0]).not.toHaveProperty("status");
    expect(records[0]).not.toHaveProperty("proponent");
  });

  it("assigns an expiry date only from the literal Perimida el phrase", () => {
    const text = `
      PROYECTO DE LEY SOBRE UNA MATERIA. Perimida el 26/07/2026
      »Número Iniciativa: 00636-2025-SLO-SE
      PROYECTO SIN FECHA EXPLÍCITA
      »Número Iniciativa: 00420-2024-PLO-SE`;
    expect(parseExpiredInitiativeRecords(text)).toEqual([
      expect.objectContaining({
        code: "00636-2025-SLO-SE",
        expiredOn: "2026-07-26",
        expiredOnRaw: "Perimida el 26/07/2026",
      }),
      expect.objectContaining({
        code: "00420-2024-PLO-SE",
        expiredOn: null,
        expiredOnRaw: null,
      }),
    ]);
  });

  it("keeps report expediente references partial and never manufactures joinable codes", () => {
    const refs = parseSenadoReportReferences("EXP.: 01387-2026 y Expediente: 01234 - 2025");
    expect(refs).toEqual([
      { reference: "01387-2026", rawReference: "EXP.: 01387-2026" },
      { reference: "01234-2025", rawReference: "Expediente: 01234 - 2025" },
    ]);
    expect(refs.some((ref) => ref.reference.endsWith("-PLO-SE"))).toBe(false);
  });

  it("extracts only explicitly labelled committee meeting dates", () => {
    const dates = parseSenadoAttendanceMeetingDates(
      "Fecha Reunión 4/6/2026 Nombre: ANA Fecha impresión 30/06/2026 Fecha Reunión: 31/02/2026",
    );
    expect(dates).toEqual([
      { date: "2026-06-04", rawText: "Fecha Reunión 4/6/2026" },
      { date: null, rawText: "Fecha Reunión: 31/02/2026" },
    ]);
    expect(dates[0]).not.toHaveProperty("attended");
  });
});
