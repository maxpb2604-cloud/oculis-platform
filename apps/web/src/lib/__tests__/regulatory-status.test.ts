import { describe, expect, it } from "vitest";
import {
  classifyRegulatoryActivity,
  isExplicitlyOpenConsultationStatus,
  isOpenPublicConsultation,
  normalizeRegulatoryStatus,
} from "../regulatory-status";

describe("regulatory status classification", () => {
  it("normalizes accents, spacing, and case", () => {
    expect(normalizeRegulatoryStatus("  EN   CONSULTA PÚBLICA ")).toBe("en consulta publica");
  });

  it.each(["Abierta", "Consulta pública abierta", "En consulta"])(
    "recognizes the explicit public-consultation status %s",
    (status) => {
      expect(isExplicitlyOpenConsultationStatus(status)).toBe(true);
    },
  );

  it.each([null, "", "No informado", "Publicada", "VIGENTE", "Activa", "Cerrada", "Vencida"])(
    "does not infer that %s opens a public consultation",
    (status) => {
      expect(isExplicitlyOpenConsultationStatus(status)).toBe(false);
    },
  );

  it("never converts an active regulatory instrument into an open public consultation", () => {
    expect(classifyRegulatoryActivity({ status: "VIGENTE", isConsulta: false }, "2026-09-07")).toBe(
      "UNKNOWN",
    );
    expect(classifyRegulatoryActivity({ status: "Abierta", isConsulta: false }, "2026-09-07")).toBe(
      "UNKNOWN",
    );
    expect(classifyRegulatoryActivity({ status: "Abierta", isConsulta: true }, "2026-09-07")).toBe(
      "OPEN",
    );
    expect(isOpenPublicConsultation({ isConsulta: false, activityState: "OPEN" })).toBe(false);
    expect(isOpenPublicConsultation({ isConsulta: true, activityState: "OPEN" })).toBe(true);
  });

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
