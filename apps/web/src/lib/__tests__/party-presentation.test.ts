import { describe, expect, it } from "vitest";
import { partyColor, partyDisplayLabel, resolvePartyPresentation } from "@/lib/party-presentation";

const OFFICIAL_NAMES = {
  ALPAIS: "Partido Alianza País",
  DXC: "Dominicanos por el Cambio",
  FA: "Frente Amplio",
  FP: "Fuerza del Pueblo",
  IND: "Independiente",
  JCE: "Junta Central Electoral",
  JS: "Partido Justicia Social",
  MODA: "Movimiento Democrático Alternativo",
  OD: "Opción Democrática",
  PCR: "Partido Cívico Renovador",
  PE: "Poder Ejecutivo",
  PLD: "Partido de la Liberación Dominicana",
  PLR: "Partido Liberal Reformista",
  PPG: "Partido Primero La Gente",
  PQDC: "Partido Quisqueyano Demócrata Cristiano",
  PRD: "Partido Revolucionario Dominicano",
  PRM: "Partido Revolucionario Moderno",
  PRSC: "Partido Reformista Social Cristiano",
  SCJ: "Suprema Corte de Justicia",
} as const;

describe("resolvePartyPresentation", () => {
  it.each(Object.entries(OFFICIAL_NAMES))(
    "expands %s with its source-backed official name",
    (acronym, fullName) => {
      expect(partyDisplayLabel(acronym)).toBe(`${acronym} (${fullName})`);
    },
  );

  it("classifies parties, institutions, and an independent value", () => {
    expect(resolvePartyPresentation("PRM").kind).toBe("party");
    expect(resolvePartyPresentation("JCE").kind).toBe("institution");
    expect(resolvePartyPresentation("PE").kind).toBe("institution");
    expect(resolvePartyPresentation("SCJ").kind).toBe("institution");
    expect(resolvePartyPresentation("IND").kind).toBe("independent");
  });

  it("matches acronyms and full names without case, spacing, or diacritic sensitivity", () => {
    expect(partyDisplayLabel("  pld  ")).toBe("PLD (Partido de la Liberación Dominicana)");
    expect(partyDisplayLabel("partido de la liberacion   dominicana")).toBe(
      "PLD (Partido de la Liberación Dominicana)",
    );
    expect(partyDisplayLabel(null, "opcion democratica")).toBe("OD (Opción Democrática)");
  });

  it("canonicalizes the Senate Fuerza del Pueblo alias", () => {
    expect(partyDisplayLabel("Partido Fuerza del Pueblo")).toBe("FP (Fuerza del Pueblo)");
    expect(partyDisplayLabel("FP", "Partido Fuerza del Pueblo")).toBe("FP (Fuerza del Pueblo)");
  });

  it("is idempotent for acronym-first and full-name-first labels", () => {
    const canonical = "PRM (Partido Revolucionario Moderno)";

    expect(partyDisplayLabel(canonical)).toBe(canonical);
    expect(partyDisplayLabel("Partido Revolucionario Moderno (PRM)")).toBe(canonical);
    expect(partyDisplayLabel(partyDisplayLabel(canonical))).toBe(canonical);
  });

  it("does not invent an expansion for unknown values", () => {
    expect(partyDisplayLabel("XYZ")).toBe("XYZ (nombre completo no informado)");
    expect(partyDisplayLabel("XYZ", null, "en")).toBe("XYZ (full name not reported)");
    expect(partyDisplayLabel("XYZ", "Movimiento de Ejemplo")).toBe("XYZ (Movimiento de Ejemplo)");
    expect(partyDisplayLabel("Movimiento de Ejemplo")).toBe("Movimiento de Ejemplo");
  });

  it("uses localized missing labels while keeping official proper names in Spanish", () => {
    expect(partyDisplayLabel()).toBe("Partido no informado");
    expect(partyDisplayLabel(null, null, "en")).toBe("Party not reported");
    expect(partyDisplayLabel("PLD", null, "en")).toBe("PLD (Partido de la Liberación Dominicana)");
  });

  it("returns a complete, stable presentation contract", () => {
    expect(resolvePartyPresentation("FP")).toEqual({
      acronym: "FP",
      fullName: "Fuerza del Pueblo",
      label: "FP (Fuerza del Pueblo)",
      kind: "party",
      isKnown: true,
      isMissing: false,
      color: "var(--party-fp-fill)",
    });
  });
});

describe("partyColor", () => {
  it("uses the permanent party colors requested for PRM, FP, and PLD", () => {
    expect(partyColor("PRM")).toBe("var(--party-prm-fill)");
    expect(partyColor("Partido Revolucionario Moderno")).toBe("var(--party-prm-fill)");
    expect(partyColor("FP")).toBe("var(--party-fp-fill)");
    expect(partyColor("PLD")).toBe("var(--party-pld-fill)");
  });

  it("uses neutral colors for institutions, independents, and missing values", () => {
    expect(partyColor("JCE")).toBe("var(--party-institution-fill)");
    expect(partyColor("IND")).toBe("var(--party-independent-fill)");
    expect(partyColor()).toBe("var(--party-missing-fill)");
    expect(partyColor("PRM", true)).toBe("var(--party-missing-fill)");
  });

  it("assigns deterministic neutral slots to every other value", () => {
    expect(partyColor("PRD")).toMatch(/^var\(--party-neutral-[1-6]-fill\)$/);
    expect(partyColor("PRD")).toBe(partyColor(" prd "));
    expect(partyColor("Partido Revolucionario Dominicano")).toBe(partyColor("PRD"));
    expect(partyColor("XYZ")).toBe(partyColor("xyz"));
  });
});
