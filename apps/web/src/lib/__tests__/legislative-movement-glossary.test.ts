import { describe, expect, it } from "vitest";
import {
  legislativeMovementDefinition,
  localizedLegislativeMovementGlossary,
} from "@/lib/legislative-movement-glossary";

describe("legislative movement glossary", () => {
  it.each([
    ["Depositada", "filed"],
    ["Depositado", "filed"],
    ["En Agenda", "agenda"],
    ["En Agenda para Tomar en Consideración", "agenda-consideration"],
    ["Tomada en Consideración", "taken-into-consideration"],
    ["Tomado en Consideración", "taken-into-consideration"],
    ["Enviada a Comisión", "sent-to-committee"],
    ["Enviado a Comisión", "sent-to-committee"],
    ["En Comisión", "sent-to-committee"],
    ["Con Plazo Fijo", "fixed-deadline"],
    ["Plazo vencido", "deadline-expired"],
    ["Con informe de comisión", "committee-report"],
    ["Informe Leído", "report-read"],
    ["Liberado de Comisión", "released-from-committee"],
    ["Liberada de Trámites", "procedures-waived"],
    ["Sobre la mesa", "tabled"],
    ["Sobre la Mesa 2da. discusión", "tabled-second"],
    ["Orden del Día de siguiente sesión", "next-session-order"],
    ["En Orden del Día", "order-of-business"],
    ["En Orden del Día para 1era. discusión", "order-of-business-first"],
    ["En Orden del Día para 2da. discusión", "order-of-business"],
    ["Declarado de Urgencia", "urgent"],
    ["Declarado de Urgencia y aprobado en 1ra. lectura", "urgent-first-approved"],
    ["Declarado de Urgencia y aprobado en Seg. lectura", "urgent-second-approved"],
    ["Aprobada en Primera lectura", "approved-first"],
    ["Aprobado en 1ra. lectura", "approved-first"],
    ["Aprobado en 2da. lectura", "approved-second"],
    ["Aprobada en Unica Lectura", "approved-single"],
    ["Aprobado en única lectura", "approved-single"],
    ["Aprobado", "approved"],
    ["En Auditoría Legislativa", "under-audit"],
    ["Auditado", "audited"],
    ["En Transcripción Legislativa", "transcription"],
    ["Certificado", "certified"],
    ["Esperando Firmas Presidente y Secretarios", "awaiting-signatures"],
    ["Firmado Presidencia y Secretarios", "signed"],
    ["Despachada", "dispatched"],
    ["Despachado única lectura", "dispatched-single"],
    ["Promulgada", "promulgated"],
    ["Fusionado", "merged"],
    ["Retirado", "withdrawn"],
    ["Perimida", "expired-legislatively"],
    ["Reintroducida", "reintroduced"],
    ["Rechazado", "rejected"],
    ["En Archivo y Correspondencia", "archives"],
    ["Remitido a Archivo y Correspondencia", "referred-to-archives"],
    ["En Pleno", "plenary"],
    ["Vigente", "valid"],
    ["No vigente", "not-valid"],
  ])("maps the official status %s to %s", (status, expectedId) => {
    expect(legislativeMovementDefinition(status, "es")?.id).toBe(expectedId);
  });

  it.each([
    ["Aceptado por el Senado", "accepted-by-senate"],
    ["Aplazado para única discusión", "postponed-single"],
    ["Aprobada en Primera Con Modificaciones", "approved-first-amended"],
    ["Aprobada en Unica Lectura Conformación Comisión Especial", "approved-special-committee"],
    ["Aprobada en Unica con Modificaciones", "approved-single-amended"],
    ["Aprobada la Conformacion de la Comision General", "approved-general-committee"],
    [
      "Aprobada la conformación de la Comisión para la investigación",
      "approved-investigative-committee",
    ],
    ["Dejada sobre la mesa", "left-tabled"],
    ["Descargada", "discharged"],
    ["Despachado al Ejecutivo", "dispatched-executive"],
    ["En Orden del Día para única discusión", "order-of-business-single"],
    ["Enviada a Comisión Modificaciones de la Cámara", "sent-to-committee-amendments"],
    ["Enviado a Comisión en 2da. Discusión", "sent-to-committee-second"],
    ["Informe Leído con Modificaciones", "report-read-amended"],
    ["Informe de Gestión Leído", "management-report-read"],
    ["Pendiente Orden del Día anterior", "pending-previous-order"],
    ["Pendiente Orden del Día única discusión", "pending-single-order"],
    ["Perimido procedente del Senado", "expired-from-senate"],
    ["Sobre la mesa 1era discusión", "tabled-first"],
    ["Sobre la mesa para única discusión", "tabled-single"],
  ])("explains the previously undocumented movement %s", (status, expectedId) => {
    expect(legislativeMovementDefinition(status, "es")).toMatchObject({
      id: expectedId,
      known: true,
    });
  });

  it("keeps a committee deadline separate from legislative validity", () => {
    const fixedDeadline = legislativeMovementDefinition("Con Plazo Fijo", "es");
    const validity = legislativeMovementDefinition("Vigente", "es");
    const deadlineExpired = legislativeMovementDefinition("Plazo vencido", "es");

    expect(fixedDeadline?.id).toBe("fixed-deadline");
    expect(fixedDeadline?.description).toContain(
      "no significa aprobación, promulgación ni vigencia",
    );
    expect(deadlineExpired?.description).toContain("No equivale por sí solo");
    expect(validity?.id).toBe("valid");
  });

  it("returns a factual source-literal fallback for an unknown movement", () => {
    const definition = legislativeMovementDefinition("Pendiente de cotejo especial", "es");

    expect(definition).toMatchObject({
      label: "Pendiente de cotejo especial",
      known: false,
    });
    expect(definition?.description).toContain("fuente oficial publicó este texto");
  });

  it("publishes a bilingual complete guide without collapsing distinct steps", () => {
    const spanish = localizedLegislativeMovementGlossary("es");
    const english = localizedLegislativeMovementGlossary("en");

    expect(spanish.length).toBeGreaterThanOrEqual(30);
    expect(english).toHaveLength(spanish.length);
    expect(new Set(spanish.map((definition) => definition.id)).size).toBe(spanish.length);
    expect(spanish.find((definition) => definition.id === "committee-report")?.label).toBe(
      "Informe emitido por Comisión",
    );
  });
});
