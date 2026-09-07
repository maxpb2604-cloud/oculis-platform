import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegulationRow, type RegulationItem } from "./monitoring";

const baseItem: RegulationItem = {
  id: 1,
  source: "reg-mispas-consultas",
  institution: "MISPAS",
  regType: "Resolución",
  title: "Anteproyecto sometido a participación",
  status: "Consulta pública",
  isConsulta: true,
  publishedAt: "2026-09-01",
  deadline: "2026-09-30",
  url: "https://msp.gob.do/consulta",
  activityState: "OPEN",
};

describe("RegulationRow public-consultation terminology", () => {
  it("presents the complete category and current state together", () => {
    const html = renderToStaticMarkup(<RegulationRow item={baseItem} lang="es" />);
    expect(html).toContain("INICIATIVA EN CONSULTA PÚBLICA · Abierta hoy");
    expect(html).toContain("Iniciativa en Consulta Pública");
  });

  it("does not label an ordinary regulatory record as a public consultation", () => {
    const html = renderToStaticMarkup(
      <RegulationRow
        item={{
          ...baseItem,
          source: "reg-mispas",
          status: "VIGENTE",
          isConsulta: false,
          activityState: "UNKNOWN",
        }}
        lang="es"
      />,
    );
    expect(html).toContain("Estado regulatorio por confirmar");
    expect(html).toContain("En aplicación");
    expect(html).not.toContain("INICIATIVA EN CONSULTA PÚBLICA");
  });
});
