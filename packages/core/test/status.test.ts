import { describe, expect, it } from "vitest";
import { normalizeStatus } from "../src/taxonomy.js";

describe("normalizeStatus", () => {
  it.each([
    "Aprobado en Segunda Lectura",
    "Enviado a Comisión",
    "En Orden del Día",
    "Promulgado",
    "Perimido",
  ])("does not infer a lifecycle stage from %s", (raw) => {
    expect(normalizeStatus(raw)).toMatchObject({ stage: "DESCONOCIDO", label: raw });
  });

  it("preserves the complete source label after trimming", () => {
    const raw = `  ${"Estado oficial muy largo ".repeat(4)}  `;
    expect(normalizeStatus(raw).label).toBe(raw.trim());
  });

  it("marks missing source status as unknown", () => {
    expect(normalizeStatus("")).toMatchObject({
      stage: "DESCONOCIDO",
      label: "Sin estado reportado",
    });
    expect(normalizeStatus(null).stage).toBe("DESCONOCIDO");
    expect(normalizeStatus(undefined).stage).toBe("DESCONOCIDO");
  });

  it("always returns a factual tooltip and the unknown stage", () => {
    const meta = normalizeStatus("Texto de la fuente");
    expect(meta.tooltip).toContain("fuente");
    expect(meta.stage).toBe("DESCONOCIDO");
  });
});
