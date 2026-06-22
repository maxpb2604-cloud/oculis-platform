import { describe, expect, it } from "vitest";
import { parseOrdenFileName, detectReadingStatuses } from "../src/dip-oficial.js";
import { parseSenadoDate } from "../src/senado.js";

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

describe("senado: parseSenadoDate", () => {
  it("parses numeric dd-m-yyyy from a WPFD title", () => {
    expect(parseSenadoDate("AGENDA EXTRAORDINARIA 00118-PLO-17-6-2026-SIL")).toBe("2026-06-17");
    expect(parseSenadoDate("AGENDA ORDINARIA 00117-PLO-17-06-2026-SE")).toBe("2026-06-17");
  });
  it("returns null when no date present", () => {
    expect(parseSenadoDate("Organigrama Institucional")).toBeNull();
  });
});
