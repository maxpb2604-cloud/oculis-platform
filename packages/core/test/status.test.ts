import { describe, expect, it } from "vitest";
import { normalizeStatus, STAGE_META } from "../src/taxonomy.js";

describe("normalizeStatus", () => {
  it("maps reading statuses to the right lifecycle stage", () => {
    expect(normalizeStatus("Aprobado en Segunda Lectura").stage).toBe("APROBACION");
    expect(normalizeStatus("Aprobado en Primera Lectura").stage).toBe("DEBATE");
    expect(normalizeStatus("Enviado a Comisión").stage).toBe("COMISION");
    expect(normalizeStatus("En Orden del Día").stage).toBe("AGENDA");
    expect(normalizeStatus("Depositado").stage).toBe("DEPOSITO");
    expect(normalizeStatus("Promulgado").stage).toBe("EJECUTIVO");
    expect(normalizeStatus("Perimido").stage).toBe("CERRADO");
  });

  it("specific patterns win over generic (segunda before aprobado)", () => {
    expect(normalizeStatus("Declarado de Urgencia y aprobado en 2da. lectura").label).toMatch(/2da/i);
  });

  it("always returns a tooltip and a valid stage", () => {
    const m = normalizeStatus("algo totalmente desconocido");
    expect(m.tooltip).toBeTruthy();
    expect(Object.keys(STAGE_META)).toContain(m.stage);
  });

  it("handles empty input", () => {
    expect(normalizeStatus("").stage).toBe("DEPOSITO");
    expect(normalizeStatus(null).stage).toBe("DEPOSITO");
  });
});
