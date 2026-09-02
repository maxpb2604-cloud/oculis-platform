import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RecentInitiativeMovement } from "@/lib/data";
import { ExecutiveBriefing } from "./dashboard";

const officialTitle =
  "Resolución aprobatoria del contrato de donación núm. 003, del 21 de agosto de 2024, suscrito entre el Estado, a través de la Dirección General de Bienes Nacionales.";

function movement(overrides: Partial<RecentInitiativeMovement> = {}): RecentInitiativeMovement {
  return {
    initiativeId: 239,
    code: "05818-2024-2028-CD",
    title: officialTitle,
    titleEn:
      "Resolution approving donation agreement No. 003, dated August 21, 2024, entered into by the State through the General Directorate of National Assets.",
    status: "Firmado Presidencia y Secretarios en única",
    eventDate: "2026-08-26",
    chamber: "DIPUTADOS",
    evidenceType: "SOURCE_HISTORY",
    observedAt: "2026-08-28 20:00:00",
    effectiveAt: "2026-08-26 00:00:00",
    ...overrides,
  };
}

describe("HOME latest movements", () => {
  it("shows an action-first short headline that opens the canonical full initiative page", () => {
    const html = renderToStaticMarkup(<ExecutiveBriefing lang="es" movements={[movement()]} />);

    expect(html).not.toContain("Agenda próxima");
    expect(html).not.toContain("Abrir agenda");
    expect(html).not.toContain("Ver toda la agenda");
    expect(html).not.toContain("Cambio verificado");
    expect(html).not.toContain("Sin cambios oficiales recientes");
    expect(html).toContain("Últimos movimientos");
    expect(html).toContain("Ver todos los movimientos");
    expect(html).toContain("data-home-movement-headline");
    expect(html).toContain("data-home-movement-action");
    expect(html).toContain("Firmado por la Presidencia y las secretarías en única lectura");
    expect(html).toContain("Contrato de donación núm. 003");
    expect(html).toContain('href="/initiatives/239"');
    expect(html).not.toContain("suscrito entre el Estado");
    expect(html).not.toContain("RecentChangeRow");
  });

  it("uses the reviewed English title and preserves English in the canonical destination", () => {
    const html = renderToStaticMarkup(<ExecutiveBriefing lang="en" movements={[movement()]} />);

    expect(html).not.toContain("Upcoming agenda");
    expect(html).not.toContain("Open agenda");
    expect(html).not.toContain("View the full agenda");
    expect(html).not.toContain("Verified change");
    expect(html).not.toContain("No recent official changes");
    expect(html).toContain("Latest movements");
    expect(html).toContain("Signed by the President and Secretaries after single reading");
    expect(html).toContain("Donation agreement No. 003");
    expect(html).toContain('href="/initiatives/239?lang=en"');
    expect(html).toContain("Official title in Spanish");
  });
});
