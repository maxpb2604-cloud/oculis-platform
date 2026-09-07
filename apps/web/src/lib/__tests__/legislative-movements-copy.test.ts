import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const sidebarSource = read("../../components/sidebar.tsx");
const feedPageSource = read("../../app/feed/page.tsx");
const agendaDetailSource = read("../../app/agenda/[id]/page.tsx");

describe("legislative movements naming", () => {
  it("uses the requested name throughout visible navigation", () => {
    for (const source of [sidebarSource, feedPageSource, agendaDetailSource]) {
      expect(source).not.toContain("Movimientos del Congreso");
      expect(source).not.toContain("Congressional movements");
    }

    expect(sidebarSource).toContain('"Movimientos legislativos"');
    expect(sidebarSource).toContain('"Legislative movements"');
    expect(feedPageSource).toContain('title: "Movimientos legislativos"');
    expect(feedPageSource).toContain('title: "Legislative movements"');
    expect(agendaDetailSource).toContain('"Volver a Movimientos legislativos"');
    expect(agendaDetailSource).toContain('"Back to Legislative movements"');
  });
});
