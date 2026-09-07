import { describe, expect, it } from "vitest";
import { isExplicitlyActiveRegulation, normalizeRegulatoryStatus } from "../regulatory-status";

describe("regulatory status classification", () => {
  it("normalizes accents, spacing, and case", () => {
    expect(normalizeRegulatoryStatus("  EN   CONSULTA PÚBLICA ")).toBe("en consulta publica");
  });

  it.each(["Activa", "VIGENTE", "Consulta pública abierta", "En consulta"])(
    "counts the explicit active status %s",
    (status) => {
      expect(isExplicitlyActiveRegulation(status)).toBe(true);
    },
  );

  it.each([null, "", "No informado", "Publicada", "Cerrada", "Vencida"])(
    "does not infer that %s is active",
    (status) => {
      expect(isExplicitlyActiveRegulation(status)).toBe(false);
    },
  );
});
