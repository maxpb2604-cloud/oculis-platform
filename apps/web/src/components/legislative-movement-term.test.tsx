import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegislativeMovementTerm } from "@/components/legislative-movement-term";

describe("LegislativeMovementTerm", () => {
  it("renders the source movement as an accessible blue explanation trigger", () => {
    const html = renderToStaticMarkup(
      <LegislativeMovementTerm status="Con Plazo Fijo" lang="es" />,
    );

    expect(html).toContain("Con Plazo Fijo");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("La comisión recibió una fecha límite específica");
    expect(html).toContain("Movimiento publicado por la fuente:");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("var(--accent)");
  });

  it("renders the reviewed English explanation without changing the source literal", () => {
    const html = renderToStaticMarkup(
      <LegislativeMovementTerm status="Enviada a Comisión" lang="en" />,
    );

    expect(html).toContain("Sent to Committee");
    expect(html).toContain("The initiative was referred to a committee");
    expect(html).toContain("Enviada a Comisión");
  });
});
