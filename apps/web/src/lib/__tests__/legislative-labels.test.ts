import { describe, expect, it } from "vitest";
import {
  circumscriptionLabel,
  committeeRoleLabel,
  initiativeChamberLabel,
  legislatorRoleLabel,
  officialStatusLabel,
  representationLevelLabel,
} from "@/lib/legislative-labels";

describe("legislative display labels", () => {
  describe("initiativeChamberLabel", () => {
    it("renders both initiative chamber codes as human-readable labels", () => {
      expect(initiativeChamberLabel("DIPUTADOS", "es")).toBe("Cámara de Diputados");
      expect(initiativeChamberLabel("DIPUTADOS", "en")).toBe("Chamber of Deputies");
      expect(initiativeChamberLabel("SENADO", "es")).toBe("Senado de la República");
      expect(initiativeChamberLabel("SENADO", "en")).toBe("Senate of the Republic");
    });

    it("normalizes casing and surrounding whitespace only for lookup", () => {
      expect(initiativeChamberLabel("  dIpUtAdOs  ", "en")).toBe("Chamber of Deputies");
      expect(initiativeChamberLabel(" senado ", "es")).toBe("Senado de la República");
    });

    it("returns an unknown chamber exactly as received", () => {
      expect(initiativeChamberLabel("  Asamblea Nacional  ", "en")).toBe("  Asamblea Nacional  ");
    });

    it("returns null for a missing chamber", () => {
      expect(initiativeChamberLabel(null, "en")).toBeNull();
      expect(initiativeChamberLabel(undefined, "es")).toBeNull();
    });
  });

  describe("officialStatusLabel", () => {
    const statuses = [
      ["Depositado", "Filed"],
      ["Vigente", "Active"],
      ["Sobre la mesa para única discusión", "Tabled for single reading"],
      ["Auditado en única discusión", "Audited in single reading"],
      ["Certificado en única discusión", "Certified in single reading"],
      ["Despachado única lectura", "Dispatched after single reading"],
      [
        "Firmado Presidencia y Secretarios en única",
        "Signed by the President and Secretaries after single reading",
      ],
    ] as const;

    it.each(statuses)("translates %s using the reviewed English label", (source, english) => {
      expect(officialStatusLabel(source, "en")).toBe(english);
    });

    it.each(statuses)("leaves the Spanish source status %s untouched", (source) => {
      expect(officialStatusLabel(source, "es")).toBe(source);
    });

    it("matches a known status after trim and case normalization", () => {
      expect(officialStatusLabel("  dEpOsItAdO  ", "en")).toBe("Filed");
      expect(officialStatusLabel("  SOBRE LA MESA PARA ÚNICA DISCUSIÓN ", "en")).toBe(
        "Tabled for single reading",
      );
    });

    it("does not trim or rewrite Spanish and unknown statuses", () => {
      expect(officialStatusLabel("  dEpOsItAdO  ", "es")).toBe("  dEpOsItAdO  ");
      expect(officialStatusLabel("  Pendiente de revisión  ", "en")).toBe(
        "  Pendiente de revisión  ",
      );
    });

    it("returns null for a missing status", () => {
      expect(officialStatusLabel(null, "en")).toBeNull();
      expect(officialStatusLabel(undefined, "es")).toBeNull();
    });
  });

  describe("legislatorRoleLabel", () => {
    it.each([
      ["Diputado", "Deputy"],
      ["Diputada", "Deputy"],
      ["Diputado/a", "Deputy"],
      ["Senador", "Senator"],
      ["Senadora", "Senator"],
      ["Senador/a", "Senator"],
    ])("translates %s as %s", (source, english) => {
      expect(legislatorRoleLabel(source, null, "en")).toBe(english);
    });

    it("uses the chamber when the published role is missing", () => {
      expect(legislatorRoleLabel(null, "SENADO", "en")).toBe("Senator");
      expect(legislatorRoleLabel(undefined, "diputados", "en")).toBe("Deputy");
      expect(legislatorRoleLabel("   ", " SENADO ", "es")).toBe("Senador");
      expect(legislatorRoleLabel(null, "DIPUTADOS", "es")).toBe("Diputado");
    });

    it("preserves published Spanish and unknown roles", () => {
      expect(legislatorRoleLabel("  Diputada  ", "DIPUTADOS", "es")).toBe("  Diputada  ");
      expect(legislatorRoleLabel("Vocero especial", "DIPUTADOS", "en")).toBe("Vocero especial");
      expect(legislatorRoleLabel(null, "ASAMBLEA", "en")).toBe("");
    });
  });

  describe("circumscriptionLabel", () => {
    it("translates numbered constituencies and the non-applicable value", () => {
      expect(circumscriptionLabel("Circunscripción 3", "en")).toBe("Constituency 3");
      expect(circumscriptionLabel("  CIRCUNSCRIPCIÓN 12 ", "en")).toBe("Constituency 12");
      expect(circumscriptionLabel("No aplica", "en")).toBe("Not applicable");
    });

    it("preserves Spanish and unknown constituency values exactly", () => {
      expect(circumscriptionLabel("  Circunscripción 3  ", "es")).toBe("  Circunscripción 3  ");
      expect(circumscriptionLabel("Circunscripción exterior", "en")).toBe(
        "Circunscripción exterior",
      );
    });

    it("returns null for a missing constituency", () => {
      expect(circumscriptionLabel(null, "en")).toBeNull();
      expect(circumscriptionLabel(undefined, "es")).toBeNull();
    });
  });

  describe("representationLevelLabel", () => {
    it("translates both known representation levels", () => {
      expect(representationLevelLabel("Provincial", "en")).toBe("Provincial");
      expect(representationLevelLabel("Nacional", "en")).toBe("National");
      expect(representationLevelLabel("  NACIONAL ", "en")).toBe("National");
    });

    it("preserves Spanish and unknown levels exactly", () => {
      expect(representationLevelLabel("  Nacional  ", "es")).toBe("  Nacional  ");
      expect(representationLevelLabel("Municipal", "en")).toBe("Municipal");
    });

    it("returns null for a missing representation level", () => {
      expect(representationLevelLabel(null, "en")).toBeNull();
      expect(representationLevelLabel(undefined, "es")).toBeNull();
    });
  });

  describe("committeeRoleLabel", () => {
    it.each([
      ["Presidente", "Chair"],
      ["Presidenta", "Chair"],
      ["Presidente/a", "Chair"],
      ["Vice-Presidente", "Vice Chair"],
      ["Vice-Presidenta", "Vice Chair"],
      ["Vice-Presidente/a", "Vice Chair"],
      ["Vicepresidente", "Vice Chair"],
      ["Vicepresidenta", "Vice Chair"],
      ["Vicepresidente/a", "Vice Chair"],
      ["Secretario", "Secretary"],
      ["Secretaria", "Secretary"],
      ["Secretario/a", "Secretary"],
      ["Miembro", "Member"],
    ])("translates %s as %s", (source, english) => {
      expect(committeeRoleLabel(source, "en")).toBe(english);
    });

    it("normalizes casing and surrounding whitespace for lookup", () => {
      expect(committeeRoleLabel("  VICEPRESIDENTA ", "en")).toBe("Vice Chair");
    });

    it("preserves Spanish and unknown committee roles exactly", () => {
      expect(committeeRoleLabel("  Presidenta  ", "es")).toBe("  Presidenta  ");
      expect(committeeRoleLabel("Enlace técnico", "en")).toBe("Enlace técnico");
    });

    it("returns null for a missing committee role", () => {
      expect(committeeRoleLabel(null, "en")).toBeNull();
      expect(committeeRoleLabel(undefined, "es")).toBeNull();
    });
  });
});
