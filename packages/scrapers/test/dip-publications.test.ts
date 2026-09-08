import { describe, expect, it } from "vitest";
import {
  DIP_PUBLICATION_SOURCES,
  DipPublicationsAdapter,
  parseDipPublicationCatalog,
  parseDipPublicationFilesPage,
  type DipPublicationTransport,
} from "../src/dip-publications.js";

const approved = DIP_PUBLICATION_SOURCES.find(
  (source) => source.kind === "APPROVED_INITIATIVES_INDEX",
)!;

function category(id: number, name: string, count: number) {
  return { term_id: id, name, slug: name.toLowerCase().replaceAll(" ", "-"), count };
}

function file(id: number, categoryId: number, title = `Documento ${id}`) {
  return {
    ID: id,
    post_title: title,
    post_name: `documento-${id}`,
    ext: "pdf",
    size: 1234,
    created_time: "2026-09-07 19:08:55",
    modified_time: "2026-09-08 08:00:00",
    catid: String(categoryId),
    cattitle: "Colección oficial",
    linkdownload: `https://camaradediputados.gob.do/download/${categoryId}/coleccion/${id}/documento-${id}.pdf`,
    openpdflink: null,
  };
}

describe("Cámara documentary publications", () => {
  it("reconciles files stored directly in a root category", async () => {
    const responses = [
      { category: category(147, "Iniciativas Aprobadas", 2), categories: [] },
      {
        category: category(147, "Iniciativas Aprobadas", 2),
        files: [
          file(4908, 147, "Aviso Iniciativas Priorizadas 2017"),
          file(4909, 147, "Aviso Iniciativas Priorizadas 2016"),
        ],
      },
    ];
    const requested: string[] = [];
    const transport: DipPublicationTransport = {
      json: async (url) => {
        requested.push(url);
        return responses.shift();
      },
    };
    const result = await new DipPublicationsAdapter(transport).collect([
      "APPROVED_INITIATIVES_INDEX",
    ]);

    expect(requested).toHaveLength(2);
    expect(requested[0]).toContain("categories.getCategories");
    expect(requested[1]).toContain("files.display");
    expect(result.gaps).toEqual([]);
    expect(result.observations[0]).toMatchObject({
      sourceId: "dip-approved",
      reportedCount: 2,
      collectedCount: 2,
      complete: true,
    });
    expect(result.documents[0]).toMatchObject({
      title: "Aviso Iniciativas Priorizadas 2017",
      uploadedOn: "2026-09-07",
      modifiedOn: "2026-09-08",
      sizeBytes: 1234,
    });
  });

  it("counts root and child collections without interpreting document titles", () => {
    const source = { ...approved, rootCategoryId: 141, label: "Actas" };
    const catalog = parseDipPublicationCatalog(
      {
        category: category(141, "Actas", 1),
        categories: [category(2181, "2025 Segunda Legislatura Ordinaria", 15)],
      },
      source,
    );
    expect(catalog.declaredDocumentCount).toBe(16);

    const parsed = parseDipPublicationFilesPage(
      {
        category: category(2181, "2025 Segunda Legislatura Ordinaria", 15),
        files: [file(28524, 2181, "Acta 01 del sábado 16 de agosto de 2025")],
      },
      source,
      catalog.categories[0]!,
    );
    expect(parsed[0]).toMatchObject({
      fileId: 28524,
      categoryId: 2181,
      title: "Acta 01 del sábado 16 de agosto de 2025",
    });
  });

  it("fails closed on a non-official download host", () => {
    expect(() =>
      parseDipPublicationFilesPage(
        {
          category: category(147, "Iniciativas Aprobadas", 1),
          files: [
            {
              ...file(1, 147),
              linkdownload: "https://example.com/documento.pdf",
            },
          ],
        },
        approved,
        {
          id: 147,
          title: "Iniciativas Aprobadas",
          slug: "iniciativas-aprobadas",
          count: 1,
          ordering: "ordering",
          orderingDirection: "asc",
        },
      ),
    ).toThrow(/URL no oficial/);
  });
});
