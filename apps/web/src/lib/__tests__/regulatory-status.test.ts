import { describe, expect, it } from "vitest";
import {
  classifyRegulatoryActivity,
  isExplicitlyActiveRegulation,
  normalizeRegulatoryStatus,
} from "../regulatory-status";

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

  it("counts a dated consultation as open only inside its official window", () => {
    const consultation = {
      status: "Consulta pública",
      isConsulta: true,
      publishedAt: "2026-08-24",
      deadline: "2026-10-26",
    };
    expect(classifyRegulatoryActivity(consultation, "2026-09-07")).toBe("OPEN");
    expect(classifyRegulatoryActivity(consultation, "2026-08-20")).toBe("UPCOMING");
    expect(classifyRegulatoryActivity(consultation, "2026-10-27")).toBe("CLOSED");
  });

  it("separates regulatory pipeline stages from open consultation windows", () => {
    expect(classifyRegulatoryActivity({ status: "Agenda" }, "2026-09-07")).toBe("IN_PROCESS");
    expect(classifyRegulatoryActivity({ status: "Borrador" }, "2026-09-07")).toBe("IN_PROCESS");
    expect(classifyRegulatoryActivity({ status: "Finalizada" }, "2026-09-07")).toBe("CLOSED");
    expect(classifyRegulatoryActivity({ status: null }, "2026-09-07")).toBe("UNKNOWN");
  });
});
