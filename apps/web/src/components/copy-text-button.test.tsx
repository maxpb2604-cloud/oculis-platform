import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyTextButton } from "./copy-text-button";

describe("CopyTextButton labels", () => {
  it("renders a contextual Spanish description label without changing the copied text", () => {
    const html = renderToStaticMarkup(
      <CopyTextButton
        text="Descripción oficial del proyecto."
        lang="es"
        idleLabel="Copiar descripción"
        ariaLabel="del PDL 06211-2024-2028-CD"
      />,
    );

    expect(html).toContain("Copiar descripción</button>");
    expect(html).toContain('aria-label="Copiar descripción del PDL 06211-2024-2028-CD"');
  });

  it("keeps the existing localized default for other copy actions", () => {
    const html = renderToStaticMarkup(<CopyTextButton text="Official description" lang="en" />);

    expect(html).toContain("Copy</button>");
    expect(html).toContain('aria-label="Copy"');
  });
});
