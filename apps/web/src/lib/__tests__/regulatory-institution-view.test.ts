import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/regulatorio/page.tsx", import.meta.url)),
  "utf8",
);

describe("regulatory institution view", () => {
  it.each([
    "mispas.png",
    "proconsumidor.png",
    "indotel.png",
    "indocal.png",
    "micm.svg",
    "intrant.png",
    "mimarena.svg",
    "superseguros.png",
    "simv.png",
    "sisalril.svg",
    "sb.svg",
  ])("uses the official %s logo asset", (asset) => {
    expect(pageSource).toContain(`/assets/oculis/institutions/${asset}`);
  });

  it("links every institution card to a filtered initiative list", () => {
    expect(pageSource).toContain('query.set("institution", institution)');
    expect(pageSource).toContain('id="institution-regulations"');
    expect(pageSource).toContain("selectedRegulations as RegulationItem[]");
  });

  it("keeps the chronological recent-publication feed", () => {
    expect(pageSource).toContain("Últimas iniciativas regulatorias depositadas");
    expect(pageSource).toContain("items={recent as RegulationItem[]}");
  });
});
