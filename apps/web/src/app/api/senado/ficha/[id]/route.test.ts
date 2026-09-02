import { describe, expect, it } from "vitest";
import { prepareSenadoFichaHtml, stripExecutableHtml } from "@/lib/senado-ficha-html";

describe("Senate ficha read-only proxy", () => {
  it("removes executable content, forms, event handlers, and active links", () => {
    const sanitized = stripExecutableHtml(`
      <form action="Descargar.aspx"><a href="Documento.aspx?id=7" onclick="steal()">PDF</a>
      <img src="plano.png" usemap="#acciones"><map name="acciones">
      <area href="Documento.aspx?id=8" shape="rect" coords="0,0,20,20"></map>
      <script>alert(1)</script><iframe src="https://evil.test"></iframe></form>`);
    expect(sanitized).not.toMatch(/<script|<iframe|<form|onclick=|href=|<area|usemap=/i);
    expect(sanitized).toContain('data-oculis-protected-link="blocked"');
    expect(sanitized).toContain("PDF");
    expect(sanitized).not.toMatch(/<img|<input/i);
  });

  it("adds an explicit protected-download notice without retaining network resources", () => {
    const prepared = prepareSenadoFichaHtml(
      `<html><head><link rel="stylesheet" href="https://evil.test/x.css"></head><body>` +
        `<a href="Descargar.aspx?id=7">Descargar</a>` +
        `<img src="http://127.0.0.1:8123/side-effect" style="background:url(https://evil.test/pixel)">` +
        `</body></html>`,
    );
    expect(prepared).toMatch(/vista de solo lectura/i);
    expect(prepared).toContain("HTTP sin TLS");
    expect(prepared).toContain("no puede garantizar criptográficamente");
    expect(prepared).toContain("descargas, enlaces y acciones");
    expect(prepared).not.toContain(`href="Descargar.aspx?id=7"`);
    expect(prepared).not.toMatch(/evil\.test|127\.0\.0\.1|<link|\ssrc=|\sstyle=/i);
  });

  it("always prepends the transport warning even when upstream omits the body", () => {
    const prepared = prepareSenadoFichaHtml("<p>Ficha sin envoltura</p>");
    expect(prepared).toContain("HTTP sin TLS");
    expect(prepared.indexOf("HTTP sin TLS")).toBeLessThan(prepared.indexOf("Ficha sin envoltura"));
    expect(prepared).toMatch(/^<!doctype html><html lang="es">/i);
  });

  it("localizes the Oculis shell while marking the official record as Spanish", () => {
    const prepared = prepareSenadoFichaHtml("<p>Contenido oficial</p>", "en");
    expect(prepared).toMatch(/^<!doctype html><html lang="en">/i);
    expect(prepared).toContain("<title>Senate legacy-system record</title>");
    expect(prepared).toContain("Transport warning");
    expect(prepared).toContain("The official record below remains in Spanish.");
    expect(prepared).toContain(
      '<section lang="es" aria-label="Official source content in Spanish">',
    );
    expect(prepared).toContain("<p>Contenido oficial</p>");
    expect(prepared).not.toContain("Advertencia de transporte");
  });

  it("does not let upstream CSS or body attributes hide the transport warning", () => {
    const prepared = prepareSenadoFichaHtml(
      "<html><head><style>aside[role=note]{display:none!important}</style></head>" +
        '<body hidden inert style="display:none"><dialog open>Engaño</dialog><p>Ficha</p></body></html>',
    );
    expect(prepared).toContain("Advertencia de transporte");
    expect(prepared).toContain("Ficha");
    expect(prepared).not.toMatch(/<style|display\s*:|\shidden|\sinert|\sopen/i);
    expect(prepared.indexOf("Advertencia de transporte")).toBeLessThan(
      prepared.indexOf("Ficha</p>"),
    );
  });

  it("sanitizes many malformed unclosed active tags in bounded linear time", () => {
    const hostile = "<script>".repeat(32_000);
    const startedAt = performance.now();
    const sanitized = stripExecutableHtml(hostile);
    const elapsedMs = performance.now() - startedAt;
    expect(sanitized).toBe("");
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
