import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChamberToggle } from "./chamber-toggle";

describe("ChamberToggle", () => {
  it("renders document links when navigation must work before hydration", () => {
    const html = renderToStaticMarkup(
      <ChamberToggle
        value="diputados"
        hrefFor={(chamber) => `/hoy?chamber=${chamber}`}
        lang="es"
      />,
    );

    expect(html).toContain('href="/hoy?chamber=diputados"');
    expect(html).toContain('href="/hoy?chamber=senadores"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("<button");
  });

  it("keeps interactive buttons for local state toggles", () => {
    const html = renderToStaticMarkup(
      <ChamberToggle value="senadores" onChange={vi.fn()} lang="en" />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Senate");
  });
});
