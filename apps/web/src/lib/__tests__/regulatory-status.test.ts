import { describe, expect, it } from "vitest";
import {
  classifyPublicConsultation,
  classifyRegulatoryProcess,
  classifyRegulatoryProcessStage,
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
    expect(
      classifyPublicConsultation({ status: "VIGENTE", isConsulta: false }, "2026-09-07"),
    ).toBeNull();
    expect(
      classifyPublicConsultation({ status: "Abierta", isConsulta: false }, "2026-09-07"),
    ).toBeNull();
    expect(classifyPublicConsultation({ status: "Abierta", isConsulta: true }, "2026-09-07")).toBe(
      "OPEN",
    );
    expect(isOpenPublicConsultation({ isConsulta: false, consultationState: null })).toBe(false);
    expect(isOpenPublicConsultation({ isConsulta: true, consultationState: "OPEN" })).toBe(true);
  });

  it("counts a dated consultation as open only inside its official window", () => {
    const consultation = {
      status: "Consulta pública",
      isConsulta: true,
      publishedAt: "2026-08-24",
      deadline: "2026-10-26",
    };
    expect(classifyPublicConsultation(consultation, "2026-09-07")).toBe("OPEN");
    expect(classifyPublicConsultation(consultation, "2026-08-20")).toBe("UPCOMING");
    expect(classifyPublicConsultation(consultation, "2026-10-27")).toBe("CLOSED");
  });

  it("uses mutually exclusive classifiers for regulatory process and public participation", () => {
    expect(classifyRegulatoryProcess({ status: "Agenda", isConsulta: false })).toBe("IN_PROCESS");
    expect(classifyRegulatoryProcess({ status: "Borrador", isConsulta: null })).toBe("IN_PROCESS");
    expect(classifyRegulatoryProcess({ status: "Finalizada", isConsulta: false })).toBe(
      "CONCLUDED",
    );
    expect(classifyRegulatoryProcess({ status: null, isConsulta: false })).toBe("UNKNOWN");
    expect(classifyRegulatoryProcess({ status: "VIGENTE", isConsulta: true })).toBeNull();
    expect(
      classifyPublicConsultation({ status: "Agenda", isConsulta: false }, "2026-09-07"),
    ).toBeNull();
  });

  it.each([
    ["Borrador", "DRAFT"],
    ["Draft", "DRAFT"],
    ["Agenda", "AGENDA"],
    ["En elaboración", "IN_DEVELOPMENT"],
    ["Por iniciar", "TO_START"],
    ["En proceso", "IN_PROCESS"],
    ["Iniciativa", "INITIATIVE"],
  ] as const)("breaks the source status %s into the %s process stage", (status, expected) => {
    expect(classifyRegulatoryProcessStage({ status, isConsulta: false })).toBe(expected);
  });

  it("never places an Initiative in Public Consultation in a process-stage bucket", () => {
    expect(classifyRegulatoryProcessStage({ status: "Agenda", isConsulta: true })).toBeNull();
    expect(classifyRegulatoryProcessStage({ status: "En proceso", isConsulta: true })).toBeNull();
  });
});
