import { describe, expect, it } from "vitest";
import { resolveSenateWpfdLinks, SenadoAdapter, type WpfdFile } from "../src/senado.js";

const ORIGIN = "https://www.senadord.gob.do";

function wpfdFile(
  categoryId: number,
  fileId: number,
  postName: string,
  postTitle = postName,
): WpfdFile {
  return {
    ID: fileId,
    post_title: postTitle,
    post_name: postName,
    ext: "pdf",
    created_time: "2026-07-17 14:43:42",
    catid: String(categoryId),
    openpdflink:
      `${ORIGIN}/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd` +
      `&task=file.download&wpfd_category_id=${categoryId}&wpfd_file_id=${fileId}` +
      `&token=&preview=1`,
    linkdownload: `${ORIGIN}/Descargas/${categoryId}/categoria-${categoryId}/${fileId}/${postName}`,
  };
}

class FixtureSenadoAdapter extends SenadoAdapter {
  readonly requestedPdfs: string[] = [];

  constructor(private readonly byCategory: ReadonlyMap<number, WpfdFile[]>) {
    super();
  }

  override async filesInCategory(categoryId: number): Promise<WpfdFile[]> {
    return this.byCategory.get(categoryId) ?? [];
  }

  protected override async readPdf(url: string) {
    this.requestedPdfs.push(url);
    return {
      pages: 1,
      text: `AÑO 2026
● Lunes 20 de julio:
➢ COMISIÓN PERMANENTE DE JUSTICIA:
HORA: 10:00 A.M.
ASUNTO: Estudio del Expediente No. 12345.
LUGAR: Salón A
➢ COMISIÓN PERMANENTE DE SALUD:
HORA: 11:00 A.M.
ASUNTO: Revisión del Expediente No. 23456.
LUGAR: Salón B`,
    };
  }
}

describe("Senado WPFD agenda destinations", () => {
  it("uses the exact official PDF for committee, plenary, and assembly events", async () => {
    const committee = wpfdFile(
      1382,
      61641,
      "agenda-semanal-de-comisiones-del-20-al-24-de-julio-2026",
      "AGENDA SEMANAL DE COMISIONES DEL 20 AL 24 DE JULIO 2026",
    );
    const plenary = wpfdFile(
      1380,
      61986,
      "agenda-ordinaria-00130-slo-19-8-2026-sil",
      "AGENDA ORDINARIA 00130-SLO-19-8-2026-SIL",
    );
    const assembly = wpfdFile(
      1415,
      49174,
      "orden-del-dia-de-la-asamblea-nacional-07-10-2024",
      "ORDEN DEL DIA DE LA ASAMBLEA NACIONAL 07-10-2024",
    );
    const adapter = new FixtureSenadoAdapter(
      new Map([
        [1380, [plenary]],
        [1415, [assembly]],
        [1382, [committee]],
      ]),
    );

    const result = await adapter.collect({ parsePdfs: false });
    const committeeRows = result.events.filter((event) => event.scope === "COMMITTEE");
    const plenaryRow = result.events.find(
      (event) => event.scope === "PLENARY" && event.description === plenary.post_title,
    );
    const assemblyRow = result.events.find((event) => event.scope === "ASAMBLEA");

    expect(committeeRows).toHaveLength(2);
    expect(committeeRows.map((event) => event.sourceEventId)).toEqual([
      "1382:61641:0",
      "1382:61641:1",
    ]);
    expect(committeeRows.map((event) => event.agendaUrl)).toEqual([
      committee.openpdflink,
      committee.openpdflink,
    ]);
    expect(plenaryRow?.agendaUrl).toBe(plenary.openpdflink);
    expect(plenaryRow?.sourceEventId).toBe("1380:61986");
    expect(assemblyRow?.agendaUrl).toBe(assembly.openpdflink);
    expect(assemblyRow?.sourceEventId).toBe("1415:49174");
    expect(adapter.requestedPdfs).toEqual([committee.linkdownload]);

    for (const event of [...committeeRows, plenaryRow!, assemblyRow!]) {
      const raw = event.raw as {
        provenance: { documentUrl: string | null; linkdownload: string | null };
      };
      expect(raw.provenance.documentUrl).toBe(event.agendaUrl);
      expect(raw.provenance.linkdownload).toMatch(/^https:\/\/www\.senadord\.gob\.do\/Descargas\//);
      expect(event.agendaUrl).not.toContain("/wpfd_file/");
    }
  });

  it("rejects mismatched payload category, URL category, URL file id, and host", () => {
    const exact = wpfdFile(1382, 61641, "agenda-semanal-comisiones");
    expect(resolveSenateWpfdLinks(exact, 1382)?.openpdflink).toBe(exact.openpdflink);

    expect(resolveSenateWpfdLinks({ ...exact, catid: "1380" }, 1382)).toBeNull();
    expect(
      resolveSenateWpfdLinks(
        {
          ...exact,
          openpdflink: exact.openpdflink!.replace("wpfd_category_id=1382", "wpfd_category_id=1380"),
        },
        1382,
      )?.openpdflink,
    ).toBeNull();
    expect(
      resolveSenateWpfdLinks(
        {
          ...exact,
          openpdflink: exact.openpdflink!.replace("wpfd_file_id=61641", "wpfd_file_id=61642"),
        },
        1382,
      )?.openpdflink,
    ).toBeNull();
    expect(
      resolveSenateWpfdLinks(
        {
          ...exact,
          openpdflink: exact.openpdflink!.replace(
            "www.senadord.gob.do",
            "www.senadord.gob.do.evil.test",
          ),
        },
        1382,
      )?.openpdflink,
    ).toBeNull();
  });

  it("rejects generic wpfd_file permalinks and non-exact download parameters", async () => {
    const exact = wpfdFile(1380, 61986, "agenda-ordinaria-00130-slo-19-8-2026-sil");
    const generic = {
      ...exact,
      openpdflink: `${ORIGIN}/wpfd_file/${exact.post_name}/`,
    };
    expect(resolveSenateWpfdLinks(generic, 1380)?.openpdflink).toBeNull();
    expect(
      resolveSenateWpfdLinks(
        { ...exact, openpdflink: `${exact.openpdflink}&redirect=${encodeURIComponent(ORIGIN)}` },
        1380,
      )?.openpdflink,
    ).toBeNull();

    const result = await new FixtureSenadoAdapter(new Map([[1380, [generic]]])).collect({
      parsePdfs: false,
    });
    const row = result.events.find((event) => event.scope === "PLENARY")!;
    const raw = row.raw as {
      payload: WpfdFile;
      provenance: { documentUrl: string | null; linkdownload: string | null };
    };
    expect(row.agendaUrl).toBeNull();
    expect(raw.provenance.documentUrl).toBeNull();
    expect(raw.provenance.linkdownload).toBe(exact.linkdownload);
    expect(raw.payload.linkdownload).toBe(exact.linkdownload);
  });

  it("rejects a linkdownload with a mismatched category, file id, or host", () => {
    const exact = wpfdFile(1382, 61641, "agenda-semanal-comisiones");
    for (const linkdownload of [
      exact.linkdownload!.replace("/Descargas/1382/", "/Descargas/1380/"),
      exact.linkdownload!.replace("/61641/", "/61642/"),
      exact.linkdownload!.replace("www.senadord.gob.do", "senadord.gob.do.evil.test"),
    ]) {
      expect(resolveSenateWpfdLinks({ ...exact, linkdownload }, 1382)?.linkdownload).toBeNull();
    }
  });
});
