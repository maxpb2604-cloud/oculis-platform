import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestHeaders } = vi.hoisted(() => ({
  requestHeaders: { lang: "es" },
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "x-oculis-lang" ? requestHeaders.lang : null),
  }),
}));

import NotFound from "./not-found";

describe("localized not-found page", () => {
  beforeEach(() => {
    requestHeaders.lang = "es";
  });

  it("uses the request language header and preserves English in the home link", async () => {
    requestHeaders.lang = "en";
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("Page not found");
    expect(html).toContain("Back to the main dashboard");
    expect(html).toContain('href="/?lang=en"');
    expect(html).not.toContain("Página no encontrada");
  });

  it("defaults safely to Spanish when the header is absent or unsupported", async () => {
    requestHeaders.lang = "fr";
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("Página no encontrada");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("?lang=en");
  });
});
