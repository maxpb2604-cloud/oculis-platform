import { describe, expect, it } from "vitest";
import { homeMovementHeadline, homeMovementSubject } from "../home-movement-headline";

describe("homeMovementHeadline", () => {
  const officialTitle =
    "Resolución aprobatoria del contrato de donación núm. 003, del 21 de agosto de 2024, suscrito entre el Estado, a través de la Dirección General de Bienes Nacionales, representada por el señor Rafael A. Santos.";

  it("creates a concise Spanish HOME headline while preserving the exact official title", () => {
    expect(
      homeMovementHeadline({
        sourceTitle: officialTitle,
        displayTitle: officialTitle,
        displayLanguage: "es",
        status: "Firmado Presidencia y Secretarios en única",
        sourceId: "status:2526",
        lang: "es",
      }),
    ).toEqual({
      movement: "Firmado por la Presidencia y las secretarías en única lectura",
      subject: "Contrato de donación núm. 003",
      headlineLanguage: "es",
      officialTitle,
      officialStatus: "Firmado Presidencia y Secretarios en única",
    });
  });

  it("uses reviewed English display copy for both parts of an English headline", () => {
    expect(
      homeMovementHeadline({
        sourceTitle: "Proyecto de ley sobre salud pública",
        displayTitle: "Bill on public health",
        displayLanguage: "en",
        status: "Certificado en única discusión",
        sourceId: "status:5",
        lang: "en",
      }),
    ).toMatchObject({
      movement: "Certified in single reading",
      subject: "Bill on public health",
      headlineLanguage: "en",
      officialTitle: "Proyecto de ley sobre salud pública",
      officialStatus: "Certificado en única discusión",
    });
  });

  it("turns common Senate wrappers and statuses into a compact extractive headline", () => {
    expect(
      homeMovementHeadline({
        sourceTitle:
          "PROYECTO DE LEY GENERAL DE ALIANZAS PÚBLICO-PRIVADA, MEDIANTE LA CUAL SE DEROGA LA LEY NÚM 47-20.",
        status: "Depositada",
        lang: "es",
        displayLanguage: "es",
      }),
    ).toMatchObject({
      movement: "Iniciativa depositada",
      subject: "LEY GENERAL DE ALIANZAS PÚBLICO-PRIVADA",
      headlineLanguage: "es",
    });
  });

  it("keeps the requested policy object instead of stopping at the official's name", () => {
    expect(
      homeMovementSubject(
        "Resolution requesting that the President of the Republic, Lic. Luis Abinader Corona, instruct the Ministry of Public Health and Social Assistance—Víctor Atallah—to incorporate continuous glucose monitors for children and adolescents enrolled in the PROMEDIA program of PROMESE/CAL.",
        "en",
      ),
    ).toBe(
      "Continuous glucose monitors for children and adolescents enrolled in the PROMEDIA program of PROMESE/CAL.",
    );
  });

  it("fails closed to a fully Spanish headline when English has no reviewed title", () => {
    const spanishTitle = "Proyecto de ley que protege el acceso a la salud pública";
    expect(
      homeMovementHeadline({
        sourceTitle: spanishTitle,
        displayTitle: spanishTitle,
        displayLanguage: "es",
        status: "Depositado",
        sourceId: "deposit:78242",
        lang: "en",
      }),
    ).toMatchObject({
      movement: "Iniciativa depositada",
      subject: "Protege el acceso a la salud pública",
      headlineLanguage: "es",
    });
  });

  it("classifies only an exact deposit signal, not a status-like substring", () => {
    const base = {
      sourceTitle: "Proyecto de ley sobre salud pública",
      displayLanguage: "es" as const,
      status: null,
      lang: "es" as const,
    };

    expect(homeMovementHeadline({ ...base, sourceId: "deposit:42" }).movement).toBe(
      "Iniciativa depositada",
    );
    expect(homeMovementHeadline({ ...base, sourceId: "status:deposit:42" }).movement).toBe(
      "Actualización oficial",
    );
  });

  it("keeps an unknown Spanish procedure literal and does not mutate its input", () => {
    const input = {
      sourceTitle: "Proyecto de ley que no elimina la protección ambiental",
      displayTitle: "Proyecto de ley que no elimina la protección ambiental",
      displayLanguage: "es" as const,
      status: "Pendiente de revisión especial",
      sourceId: "status:999",
      lang: "es" as const,
    };
    const before = JSON.stringify(input);

    expect(homeMovementHeadline(input)).toMatchObject({
      movement: "Pendiente de revisión especial",
      subject: "No elimina la protección ambiental",
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps an unknown source status and its subject entirely in Spanish", () => {
    expect(
      homeMovementHeadline({
        sourceTitle: "Proyecto de ley sobre salud pública",
        displayTitle: "Bill on public health",
        displayLanguage: "en",
        status: "Pendiente de revisión especial",
        sourceId: "status:999",
        lang: "en",
      }),
    ).toMatchObject({
      movement: "Pendiente de revisión especial",
      subject: "Ley sobre salud pública",
      headlineLanguage: "es",
      officialStatus: "Pendiente de revisión especial",
    });
  });
});

describe("homeMovementSubject", () => {
  it("keeps names, numbers, and negations intact when shortening a long source title", () => {
    const subject = homeMovementSubject(
      "Proyecto de ley que no autoriza la venta del Parque Nacional Duarte a María Pérez por RD$ 10,000,000, según las disposiciones aplicables y los procedimientos administrativos correspondientes.",
      "es",
    );

    expect(subject).toMatch(/no autoriza/i);
    expect(subject).toContain("Duarte");
    expect(subject).toContain("María Pérez");
    expect(subject).toContain("RD$ 10,000,000");
    expect(subject).not.toContain("según las disposiciones");
  });
});
