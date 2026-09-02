import { describe, expect, it } from "vitest";
import {
  currentLocationPresentation,
  expirationPresentation,
} from "@/lib/initiative-procedural-presentation";

describe("initiative procedural presentation", () => {
  it("explains the exact filed screenshot case in Spanish and English", () => {
    const current = {
      state: "CHAMBER" as const,
      basis: "OBSERVED" as const,
      chamber: "DIPUTADOS" as const,
      reason: "LATEST_OFFICIAL_CHAMBER_MOVEMENT" as const,
      evidenceStatus: "Depositado",
      evidenceDate: "2026-08-31",
      evidenceSource: "sil-diputados",
    };
    const expiry = {
      state: "COUNT_NOT_STARTED" as const,
      basis: "OFFICIAL" as const,
      reason: "SOURCE_REPORTS_NOT_INITIATED" as const,
    };

    expect(currentLocationPresentation(current, "es")).toMatchObject({
      value: "Cámara de Diputados",
      basis: "Última cámara oficial observada",
      detail: "Movimiento oficial · Depositado · 31 ago de 2026",
    });
    expect(currentLocationPresentation(current, "en")).toMatchObject({
      value: "Chamber of Deputies",
      basis: "Latest official chamber observed",
      detail: "Official movement · Filed · Aug 31, 2026",
    });
    expect(expirationPresentation(expiry, "es")).toMatchObject({
      value: "Cómputo aún no iniciado",
      basis: "Dato publicado",
    });
    expect(expirationPresentation(expiry, "en")).toMatchObject({
      value: "Legislature count not started",
      basis: "Source-published",
    });
  });

  it("labels a projected deadline as an Oculis calculation", () => {
    const fact = {
      state: "PROJECTED" as const,
      basis: "DERIVED" as const,
      date: "2028-07-25",
      reason: "TWO_ORDINARY_LEGISLATURES" as const,
      startLegislature: "2027-SLO",
      endLegislature: "2028-PLO",
      startEvidenceDate: "2027-09-01",
      legalBasis: ["CRD-89", "CRD-100", "CRD-104"] as const,
      methodVersion: "oculis-constitutional-expiry-v1" as const,
    };

    expect(expirationPresentation(fact, "es")).toMatchObject({
      value: "Al cierre del 25 jul de 2028",
      basis: "Cálculo de Oculis",
      dateTime: "2028-07-25",
      tone: "derived",
    });
    expect(expirationPresentation(fact, "en")).toMatchObject({
      value: "At the close of Jul 25, 2028",
      basis: "Oculis calculation",
    });
  });

  it("does not turn a non-bill into a calculated date", () => {
    expect(
      expirationPresentation(
        {
          state: "RULE_NOT_APPLICABLE",
          basis: "DERIVED",
          reason: "TYPE_NOT_COVERED_BY_TWO_LEGISLATURE_RULE",
        },
        "es",
      ),
    ).toMatchObject({
      value: "No aplica la regla de dos legislaturas",
      basis: "Tipo fuera de alcance",
      dateTime: null,
    });
  });

  it.each([
    [
      "es" as const,
      "Aplicación de la norma por confirmar",
      "La fuente no publica un tipo reconocible",
    ],
    [
      "en" as const,
      "Rule applicability pending confirmation",
      "The source does not publish a recognized type",
    ],
  ])(
    "explains an unknown initiative type in %s without claiming the rule is inapplicable",
    (lang, value, detail) => {
      const presentation = expirationPresentation(
        {
          state: "REVIEW_REQUIRED",
          basis: "DERIVED",
          reason: "TYPE_NOT_PUBLISHED_OR_RECOGNIZED",
        },
        lang,
      );

      expect(presentation.value).toBe(value);
      expect(presentation.detail).toContain(detail);
      expect(presentation.basis).toBe(lang === "es" ? "No determinable" : "Not determinable");
    },
  );

  it.each([
    [
      "es" as const,
      "Solo cámara de origen publicada",
      "La cámara de origen no demuestra la ubicación actual",
    ],
    [
      "en" as const,
      "Only origin chamber published",
      "The origin chamber does not establish the current location",
    ],
  ])(
    "explains origin-only evidence in %s without presenting it as the current chamber",
    (lang, basis, detail) => {
      const presentation = currentLocationPresentation(
        {
          state: "UNRESOLVED",
          basis: "OBSERVED",
          reason: "ORIGIN_ONLY_NOT_CURRENT_EVIDENCE",
        },
        lang,
      );

      expect(presentation.value).toBe(
        lang === "es"
          ? "Ubicación procesal por confirmar"
          : "Procedural location pending confirmation",
      );
      expect(presentation.basis).toBe(basis);
      expect(presentation.detail).toContain(detail);
    },
  );
});
