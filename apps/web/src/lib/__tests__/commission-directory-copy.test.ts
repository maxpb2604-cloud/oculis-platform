import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const congressRosterSource = readFileSync(
  fileURLToPath(new URL("../../components/congress-roster.tsx", import.meta.url)),
  "utf8",
);
const congressPageSource = readFileSync(
  fileURLToPath(new URL("../../app/congreso/page.tsx", import.meta.url)),
  "utf8",
);
const sidebarSource = readFileSync(
  fileURLToPath(new URL("../../components/sidebar.tsx", import.meta.url)),
  "utf8",
);

describe("commission directory details", () => {
  it("keeps the expanded commission card focused on its members", () => {
    expect(congressRosterSource).toContain('{es ? "Integrantes" : "Members"}');
    expect(congressRosterSource).not.toContain("Agendas de esta comisión");
    expect(congressRosterSource).not.toContain("This committee's agendas");
    expect(congressRosterSource).not.toContain("agenda vinculada");
    expect(congressRosterSource).not.toContain("linked agenda");
    expect(congressRosterSource).not.toContain(
      "Oculis todavía no tiene una agenda pública vinculada",
    );
    expect(congressRosterSource.toLowerCase()).not.toContain("agenda");
    expect(congressPageSource.toLowerCase()).not.toContain("agenda");
  });

  it("uses the requested directory name in the sidebar", () => {
    expect(sidebarSource).toContain('"Directorio de Congresistas"');
    expect(sidebarSource).toContain('"Congressional Directory"');
    expect(sidebarSource).not.toContain('"Legisladores y comisiones"');
    expect(sidebarSource).not.toContain('"Legislators and committees"');
  });

  it("does not expose public consultations in the sidebar", () => {
    expect(sidebarSource).not.toContain('href: "/regulatorio/consultas"');
    expect(sidebarSource).not.toContain('"Consultas públicas"');
    expect(sidebarSource).not.toContain('"Public consultations"');
    expect(sidebarSource).not.toContain("FileMagnifyingGlass");
  });

  it("uses the requested initiative library name in the sidebar", () => {
    expect(sidebarSource).toContain('"Librería de Iniciativas"');
    expect(sidebarSource).toContain('"Initiative Library"');
    expect(sidebarSource).not.toContain('label: es ? "Iniciativas" : "Initiatives"');
  });

  it("uses the requested regulatory movements name in the sidebar", () => {
    expect(sidebarSource).toContain('"Movimientos regulatorios"');
    expect(sidebarSource).toContain('"Regulatory movements"');
    expect(sidebarSource).not.toContain('"Instrumentos regulatorios"');
    expect(sidebarSource).not.toContain('"Regulatory instruments"');
  });
});
