import { describe, expect, it, vi } from "vitest";
import {
  commissionAppearsInAgendaPdf,
  DipCommissionAgendaAdapter,
  parseCommissionAgendaFilesPage,
  parseCommissionAgendaTitleDate,
  type CommissionAgendaCategory,
} from "../src/dip-commission-agenda.js";

const root = category(211, 202, "Agendas", "agendas", 0);
const period = category(2244, 211, "SLO 2026", "slo-2026", 0);
const month = category(2245, 2244, "agosto", "agosto-slo-2026", 2);

describe("dip-commission-agenda literal metadata", () => {
  it("parses only the date stated in the canonical daily title", () => {
    expect(parseCommissionAgendaTitleDate("Agenda del 27 de agosto de 2026")).toBe("2026-08-27");
    expect(parseCommissionAgendaTitleDate("Subido el 27 de agosto de 2026")).toBeNull();
    expect(parseCommissionAgendaTitleDate("Agenda sin fecha")).toBeNull();
  });

  it("requires official download and preview URLs with the same category/file IDs", () => {
    const metadataUrl = officialMetadataUrl(2245, 1);
    expect(
      parseCommissionAgendaFilesPage(
        filesPayload(month, [dailyFile(28988, "27")]),
        metadataUrl,
        2245,
      ).documents[0],
    ).toMatchObject({
      sourceId: "2245:28988",
      agendaDate: "2026-08-27",
      fileId: 28988,
      categoryId: 2245,
      raw: {
        provenance: {
          pageSource:
            "https://camaradediputados.gob.do/agenda-comisiones/#211-2245-wpfd-agosto-slo-2026",
        },
      },
    });

    expect(() =>
      parseCommissionAgendaFilesPage(
        filesPayload(month, [
          {
            ...dailyFile(28988, "27"),
            openpdflink: previewUrl(2245, 28997),
          },
        ]),
        metadataUrl,
        2245,
      ),
    ).toThrow(/does not identify category 2245, file 28988/);
    expect(() =>
      parseCommissionAgendaFilesPage(
        filesPayload(month, [
          {
            ...dailyFile(28988, "27"),
            linkdownload: "https://evil.example/download/2245/agosto/28988/file.pdf",
          },
        ]),
        metadataUrl,
        2245,
      ),
    ).toThrow(/Non-official download URL/);
  });
});

describe("dip-commission-agenda recursive resolution", () => {
  it("walks period → month, paginates files.display, and resolves 27/28 August exactly", async () => {
    const requests: URL[] = [];
    const readPdfText = vi.fn(async (url: string) => ({
      pages: 2,
      text: url.includes("28988")
        ? "Agenda del jueves, 27 de agosto de 2026\n05368-2024-2028-CD Comisión especial"
        : "Agenda del viernes, 28 de agosto de 2026\nContratos",
    }));
    const adapter = new DipCommissionAgendaAdapter({
      readJson: async (input) => {
        const url = new URL(input);
        requests.push(url);
        const task = url.searchParams.get("task");
        const id = Number(url.searchParams.get("id"));
        if (task === "categories.getCategories" && id === 211) {
          return catalogPayload(root, [period]);
        }
        if (task === "categories.getCategories" && id === 2244) {
          return catalogPayload(period, [month]);
        }
        if (task === "categories.getCategories" && id === 2245) {
          return catalogPayload(month, []);
        }
        if (task === "files.display" && id === 2245) {
          return filesPayload(month, [
            url.searchParams.get("page") === "1" ? dailyFile(28988, "27") : dailyFile(28997, "28"),
          ]);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      readPdfText,
    });

    const result = await adapter.resolveDates(["2026-08-27", "2026-08-28"], {
      pageSize: 1,
    });
    expect(result.documentsByDate.get("2026-08-27")).toMatchObject({
      categoryId: 2245,
      fileId: 28988,
      previewUrl: previewUrl(2245, 28988),
    });
    expect(result.documentsByDate.get("2026-08-28")).toMatchObject({
      categoryId: 2245,
      fileId: 28997,
      previewUrl: previewUrl(2245, 28997),
    });
    expect(result.pdfTextBySourceId.get("2245:28988")).toContain("05368-2024-2028-CD");
    expect(result.pdfTextBySourceId.get("2245:28997")).toContain("Contratos");
    expect(result.gaps).toEqual([]);
    expect(readPdfText).toHaveBeenCalledTimes(2);
    expect(requests.filter((url) => url.searchParams.get("task") === "files.display")).toHaveLength(
      2,
    );
    expect(requests.some((url) => url.searchParams.get("task") === "files.getFiles")).toBe(false);
  });

  it("fails closed when two different official files state the same date", async () => {
    const readPdfText = vi.fn();
    const adapter = simpleAdapter(
      category(2245, 2244, "agosto", "agosto-slo-2026", 2),
      [dailyFile(28988, "27"), dailyFile(28989, "27")],
      readPdfText,
    );
    const result = await adapter.resolveDates(["2026-08-27"]);
    expect(result.documentsByDate.get("2026-08-27")).toBeNull();
    expect(result.gaps.join(" ")).toContain("2 PDFs comparten la fecha literal");
    expect(readPdfText).not.toHaveBeenCalled();
  });

  it("retries one count change from a concurrent upload and then reconciles", async () => {
    let fileRequests = 0;
    const initialMonth = category(2245, 2244, "agosto", "agosto-slo-2026", 1);
    const updatedMonth = { ...initialMonth, count: 2 };
    const adapter = new DipCommissionAgendaAdapter({
      readJson: async (input) => {
        const url = new URL(input);
        const task = url.searchParams.get("task");
        const id = Number(url.searchParams.get("id"));
        if (task === "categories.getCategories" && id === 211)
          return catalogPayload(root, [period]);
        if (task === "categories.getCategories" && id === 2244)
          return catalogPayload(period, [initialMonth]);
        if (task === "categories.getCategories" && id === 2245)
          return catalogPayload(initialMonth, []);
        if (task === "files.display") {
          fileRequests++;
          return filesPayload(updatedMonth, [dailyFile(28988, "27"), dailyFile(28997, "28")]);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      readPdfText: async () => ({ pages: 1, text: "05368-2024-2028-CD" }),
    });
    const result = await adapter.resolveDates(["2026-08-27"]);
    expect(result.documentsByDate.get("2026-08-27")?.fileId).toBe(28988);
    expect(fileRequests).toBe(2);
  });

  it("fails closed if the category count changes again during the retry", async () => {
    let fileRequests = 0;
    const initialMonth = category(2245, 2244, "agosto", "agosto-slo-2026", 1);
    const adapter = new DipCommissionAgendaAdapter({
      readJson: async (input) => {
        const url = new URL(input);
        const task = url.searchParams.get("task");
        const id = Number(url.searchParams.get("id"));
        if (task === "categories.getCategories" && id === 211)
          return catalogPayload(root, [period]);
        if (task === "categories.getCategories" && id === 2244)
          return catalogPayload(period, [initialMonth]);
        if (task === "categories.getCategories" && id === 2245)
          return catalogPayload(initialMonth, []);
        if (task === "files.display") {
          fileRequests++;
          const changed = { ...initialMonth, count: fileRequests === 1 ? 2 : 3 };
          return filesPayload(changed, [dailyFile(28988, "27")]);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      readPdfText: async () => ({ pages: 1, text: "05368-2024-2028-CD" }),
    });
    await expect(adapter.resolveDates(["2026-08-27"])).rejects.toThrow(
      /count changed for category 2245: 2 → 3/,
    );
    expect(fileRequests).toBe(2);
  });

  it("does not expose metadata when the official download is not a readable PDF", async () => {
    const adapter = simpleAdapter(
      category(2245, 2244, "agosto", "agosto-slo-2026", 1),
      [dailyFile(28988, "27")],
      async () => {
        throw new Error("not a PDF");
      },
    );
    const result = await adapter.resolveDates(["2026-08-27"]);
    expect(result.documentsByDate.get("2026-08-27")).toBeNull();
    expect(result.gaps.join(" ")).toContain("no fue un PDF legible");
  });
});

describe("dip-commission-agenda PDF commission evidence", () => {
  it("accepts a literal commission code or complete normalized commission name", () => {
    expect(
      commissionAppearsInAgendaPdf(
        "05368-2024-2028-CD Comisión especial sobre Discapacidad",
        "Continuar con el estudio de la iniciativa 05368-2024-2028-CD",
        "2026-08-27",
        "Agenda diaria\n3 05368-2024-2028-CD Comisión especial sobre Discapacidad 27/08/2026\nContinuar con el estudio de la iniciativa 05368-2024-2028-CD",
      ),
    ).toMatchObject({
      matched: true,
      evidenceType: "COMMISSION_CODE",
      agendaEvidenceType: "DESCRIPTION",
    });
    expect(
      commissionAppearsInAgendaPdf(
        "Contratos",
        "Coordinar la agenda de la comisión",
        "2026-08-28",
        "Agenda diaria\n1 CONTRATOS 28/08/2026\nCoordinar la agenda de la comisión",
      ),
    ).toMatchObject({ matched: true, evidenceType: "COMMISSION_NAME" });
  });

  it("does not accept a generic commission word mentioned outside that meeting row", () => {
    expect(
      commissionAppearsInAgendaPdf(
        "Trabajo",
        "Coordinar la agenda de trabajo",
        "2026-08-27",
        "Salud 27/08/2026\nCoordinar la agenda de trabajo",
      ),
    ).toMatchObject({ matched: false });
  });

  it("does not treat a longer commission name as the selected commission's row", () => {
    expect(
      commissionAppearsInAgendaPdf(
        "Trabajo",
        "Coordinar la agenda de trabajo",
        "2026-08-27",
        "1 Comisión Especial de Trabajo 27/08/2026\nCoordinar la agenda de trabajo",
      ),
    ).toMatchObject({ matched: false });
  });

  it("requires a numeric row boundary even when the heading starts the extracted text", () => {
    expect(
      commissionAppearsInAgendaPdf(
        "Trabajo",
        "Coordinar la agenda de trabajo",
        "2026-08-27",
        "Trabajo 27/08/2026\nCoordinar la agenda de trabajo",
      ),
    ).toMatchObject({ matched: false });
    expect(
      commissionAppearsInAgendaPdf(
        "Trabajo",
        "Coordinar la agenda de trabajo",
        "2026-08-27",
        "1 Trabajo 27/08/2026\nCoordinar la agenda de trabajo",
      ),
    ).toMatchObject({ matched: true, evidenceType: "COMMISSION_NAME" });
  });

  it("does not fuzzy-match a commission or agenda description absent from the PDF", () => {
    expect(
      commissionAppearsInAgendaPdf(
        "Contratos",
        "Coordinar la agenda de la comisión",
        "2026-08-28",
        "Agenda diaria\nHacienda 28/08/2026\nCoordinar la agenda de la comisión",
      ),
    ).toMatchObject({ matched: false, evidenceType: null, evidence: null });
    expect(
      commissionAppearsInAgendaPdf(
        "Contratos",
        "Coordinar la agenda de la comisión",
        "2026-08-28",
        "Agenda diaria\n1 Contratos 28/08/2026\nUna descripción distinta",
      ),
    ).toMatchObject({ matched: false });
  });
});

function simpleAdapter(
  fileCategory: CommissionAgendaCategory,
  files: Record<string, unknown>[],
  readPdfText: (url: string) => Promise<{ pages: number; text: string }>,
): DipCommissionAgendaAdapter {
  return new DipCommissionAgendaAdapter({
    readJson: async (input) => {
      const url = new URL(input);
      const task = url.searchParams.get("task");
      const id = Number(url.searchParams.get("id"));
      if (task === "categories.getCategories" && id === 211) return catalogPayload(root, [period]);
      if (task === "categories.getCategories" && id === 2244)
        return catalogPayload(period, [fileCategory]);
      if (task === "categories.getCategories" && id === 2245)
        return catalogPayload(fileCategory, []);
      if (task === "files.display" && id === 2245) return filesPayload(fileCategory, files);
      throw new Error(`Unexpected URL: ${url}`);
    },
    readPdfText,
  });
}

function category(
  id: number,
  parent: number,
  name: string,
  slug: string,
  count: number,
): CommissionAgendaCategory {
  return {
    id,
    parentId: parent,
    title: name,
    slug,
    count,
    ordering: "title",
    orderingDirection: "desc",
  };
}

function wireCategory(input: CommissionAgendaCategory): Record<string, unknown> {
  return {
    term_id: input.id,
    parent: input.parentId,
    name: input.title,
    slug: input.slug,
    count: input.count,
    ordering: input.ordering,
    orderingdir: input.orderingDirection,
  };
}

function catalogPayload(
  parent: CommissionAgendaCategory,
  children: CommissionAgendaCategory[],
): Record<string, unknown> {
  return {
    category: wireCategory(parent),
    categories: children.map(wireCategory),
  };
}

function filesPayload(
  fileCategory: CommissionAgendaCategory,
  files: Record<string, unknown>[],
): Record<string, unknown> {
  return { category: wireCategory(fileCategory), files };
}

function dailyFile(id: number, day: string): Record<string, unknown> {
  return {
    ID: id,
    catid: "2245",
    post_title: `Agenda del ${day} de agosto de 2026`,
    post_name: `agenda-del-${day}-de-agosto-de-2026-2`,
    ext: "pdf",
    cattitle: "agosto",
    linkdownload: `https://camaradediputados.gob.do/download/2245/agosto/${id}/agenda-del-${day}-de-agosto-de-2026-2.pdf`,
    openpdflink: previewUrl(2245, id),
    created_time: "2026-08-01 00:00:00",
  };
}

function previewUrl(categoryId: number, fileId: number): string {
  return `https://camaradediputados.gob.do/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=file.download&wpfd_category_id=${categoryId}&wpfd_file_id=${fileId}&token=&preview=1`;
}

function officialMetadataUrl(categoryId: number, page: number): string {
  return `https://camaradediputados.gob.do/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=files.display&id=${categoryId}&page=${page}`;
}
