import { describe, expect, it } from "vitest";
import { SOURCE_REGISTRY } from "@oculis/scrapers";
import {
  feedSourceLabel,
  initiativeSourceLabel,
  sourceRegistryPresentation,
} from "@/lib/source-labels";

describe("source presentation labels", () => {
  it("localizes known initiative and feed sources without changing proper outlet names", () => {
    expect(initiativeSourceLabel("sil-diputados", "en")).toBe("Chamber of Deputies · SIL");
    expect(feedSourceLabel("feed-legislative", "en")).toBe("Legislative signals");
    expect(feedSourceLabel("feed-diputados", "en")).toBe("Chamber (official)");
    expect(feedSourceLabel("feed-diariolibre", "en")).toBe("Diario Libre");
  });

  it("uses the supplied fallback for an unknown feed source", () => {
    expect(feedSourceLabel("feed-example", "en", "Example News")).toBe("Example News");
  });

  it("leaves the Spanish registry presentation exactly as declared", () => {
    const source = SOURCE_REGISTRY.find((entry) => entry.id === "sil-actividad")!;
    expect(sourceRegistryPresentation(source, "es")).toEqual({
      label: source.label,
      owner: source.owner,
      coverage: source.coverage,
      gapReason: source.gapReason,
    });
  });

  it("has English customer-facing coverage copy for every registered source", () => {
    for (const source of SOURCE_REGISTRY) {
      const presentation = sourceRegistryPresentation(source, "en");
      expect(presentation.label, source.id).toBeTruthy();
      expect(presentation.owner, source.id).toBeTruthy();
      expect(presentation.coverage, source.id).toBeTruthy();
      expect(presentation.coverage, source.id).not.toBe(source.coverage);
      if (source.status === "KNOWN_GAP") {
        expect(presentation.gapReason, source.id).toBeTruthy();
        expect(presentation.gapReason, source.id).not.toBe(source.gapReason);
      }
    }
  });
});
