import { describe, expect, it } from "vitest";
import { parseOrdenFileName, detectReadingStatuses } from "../src/dip-oficial.js";
import { parseSenadoDate, parseSenateCommitteeAgenda } from "../src/senado.js";
import { extractCodes } from "../src/codes.js";
import { stripHtml } from "../src/feeds.js";

describe("dip-oficial: parseOrdenFileName", () => {
  it("parses session type, number, and date from a real filename", () => {
    const r = parseOrdenFileName(
      "https://camaradediputados.gob.do/download/142/ordenes-del-dia-del-pleno/28519/sesion-ordinaria-no-00031-jueves-18-de-junio-de-2026-10-00-a-m-2.pdf",
    );
    expect(r.sessionType).toBe("ordinaria");
    expect(r.sessionNumber).toBe("31");
    expect(r.date).toBe("2026-06-18");
  });

  it("detects extraordinaria", () => {
    const r = parseOrdenFileName(
      "https://x/download/sesion-extraordinaria-no-00028-lunes-15-de-junio-de-2026-2-00pm.pdf",
    );
    expect(r.sessionType).toBe("extraordinaria");
    expect(r.date).toBe("2026-06-15");
  });
});

describe("dip-oficial: detectReadingStatuses", () => {
  it("finds reading statuses present in agenda text", () => {
    const text = "... aprobado en SEGUNDA LECTURA ... declarado de urgencia ... tomado en consideración ...";
    const s = detectReadingStatuses(text);
    expect(s).toContain("Aprobado 2da lectura");
    expect(s).toContain("Declarado de urgencia");
    expect(s).toContain("Tomado en consideración");
    expect(s).not.toContain("Aprobado 1ra lectura");
  });
});

describe("senado: parseSenateCommitteeAgenda", () => {
  const AGENDA =
    "AGENDA SEMANAL AÑO 2026 " +
    "● Lunes 22 de junio: " +
    "➢ COMISIÓN PERMANENTE DE SALUD: HORA: 9:00 A.M. " +
    "ASUNTO: Estudio del Expediente No. 01677 LUGAR: Sala 1 " +
    "➢ COMISIÓN PERMANENTE DE SALUD: HORA: 3:00 P.M. " +
    "ASUNTO: Continuación del estudio, ver 01693-2026-PLO-SE INVITADOS: MISPAS LUGAR: Sala 2";

  it("keeps two same-day meetings of one committee as distinct entries (no overwrite)", () => {
    const entries = parseSenateCommitteeAgenda(AGENDA, "2026");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.committee).toBe(entries[1]!.committee);
    expect(entries[0]!.date).toBe("2026-06-22");
    expect(entries[1]!.date).toBe("2026-06-22");
    expect(entries[0]!.hora).not.toBe(entries[1]!.hora);
  });

  it("bare expediente numbers stay in .expedientes (never resolvable as codes), full codes are extractable from the asunto", () => {
    const [first, second] = parseSenateCommitteeAgenda(AGENDA, "2026");
    expect(first!.expedientes).toEqual(["01677"]);
    // the bare number must NOT surface as an initiative code
    expect(extractCodes(first!.asunto)).toEqual([]);
    // a full Senate code named in the asunto IS a resolvable initiative code
    expect(extractCodes(second!.asunto)).toEqual(["01693-2026-PLO-SE"]);
  });
});

describe("feeds: stripHtml entity decoding (shared with regulatory adapters)", () => {
  it("decodes named + numeric entities and strips tags/CDATA", () => {
    expect(stripHtml("<![CDATA[Resoluci&oacute;n <b>No.&nbsp;12</b> &#8220;salud&#8221;]]>")).toBe(
      "Resolución No. 12 “salud”",
    );
  });
});

describe("senado: parseSenadoDate", () => {
  it("parses numeric dd-m-yyyy from a WPFD title", () => {
    expect(parseSenadoDate("AGENDA EXTRAORDINARIA 00118-PLO-17-6-2026-SIL")).toBe("2026-06-17");
    expect(parseSenadoDate("AGENDA ORDINARIA 00117-PLO-17-06-2026-SE")).toBe("2026-06-17");
  });
  it("returns null when no date present", () => {
    expect(parseSenadoDate("Organigrama Institucional")).toBeNull();
  });
});
