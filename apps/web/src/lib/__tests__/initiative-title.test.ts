import { describe, expect, it } from "vitest";
import { initiativeTitlePresentation } from "../initiative-title";

describe("initiativeTitlePresentation", () => {
  const initiative = {
    title: "Proyecto de ley sobre salud pública",
    titleEn: "Bill on public health",
  };

  it("keeps the exact official title in Spanish mode", () => {
    expect(initiativeTitlePresentation(initiative, "es")).toEqual({
      text: initiative.title,
      contentLanguage: "es",
      isOculisTranslation: false,
      isTranslationPending: false,
      officialSpanishTitle: initiative.title,
    });
  });

  it("uses the separate Oculis translation in English mode", () => {
    expect(initiativeTitlePresentation(initiative, "en")).toEqual({
      text: initiative.titleEn,
      contentLanguage: "en",
      isOculisTranslation: true,
      isTranslationPending: false,
      officialSpanishTitle: initiative.title,
    });
  });

  it("fails closed to declared Spanish content when no translation exists", () => {
    expect(initiativeTitlePresentation({ title: initiative.title, titleEn: "   " }, "en")).toEqual({
      text: initiative.title,
      contentLanguage: "es",
      isOculisTranslation: false,
      isTranslationPending: true,
      officialSpanishTitle: initiative.title,
    });
  });
});
