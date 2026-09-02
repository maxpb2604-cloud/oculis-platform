import { describe, expect, it } from "vitest";
import { initiativeProceduralFacts } from "@/lib/initiative-procedural-facts";

describe("initiativeProceduralFacts", () => {
  it("resolves the captured filed initiative without inventing an expiry date", () => {
    const facts = initiativeProceduralFacts({
      type: "Proyecto de Ley",
      status: "Depositado",
      expiresAt: null,
      initiated: "NO",
      initiatedAt: null,
      legislature: "2026-SLO",
      currentChamber: null,
      sourceChamber: "DIPUTADOS",
      originChamber: "DIPUTADOS",
      events: [
        {
          source: "sil-diputados",
          status: "Depositado",
          eventDate: "2026-08-31",
          observedAt: "2026-08-31T18:52:47.000Z",
          evidenceType: "SOURCE_HISTORY",
          sourceEventId: "616980",
        },
      ],
    });

    expect(facts.currentLocation).toMatchObject({
      state: "CHAMBER",
      basis: "OBSERVED",
      chamber: "DIPUTADOS",
      reason: "LATEST_OFFICIAL_CHAMBER_MOVEMENT",
      evidenceStatus: "Depositado",
      evidenceDate: "2026-08-31",
    });
    expect(facts.expiration).toEqual({
      state: "COUNT_NOT_STARTED",
      basis: "OFFICIAL",
      reason: "SOURCE_REPORTS_NOT_INITIATED",
    });
  });

  it("lets a source-published current chamber and expiry date take precedence", () => {
    const facts = initiativeProceduralFacts({
      type: "Proyecto de Ley",
      status: "En Comisión",
      expiresAt: "2027-01-12",
      initiated: "SI",
      initiatedAt: "2026-03-01",
      legislature: "2026-PLO",
      currentChamber: "SENADO",
      sourceChamber: "DIPUTADOS",
      originChamber: "DIPUTADOS",
    });

    expect(facts.currentLocation).toMatchObject({
      state: "CHAMBER",
      basis: "OFFICIAL",
      chamber: "SENADO",
      reason: "SOURCE_PUBLISHED_CURRENT_CHAMBER",
    });
    expect(facts.expiration).toMatchObject({
      state: "SOURCE_PUBLISHED",
      basis: "OFFICIAL",
      date: "2027-01-12",
      reason: "SOURCE_EXPIRATION_FIELD",
    });
  });

  it.each([
    ["2026-PLO", "2026-03-10", "2027-01-12", "2026-SLO"],
    ["2026-SLO", "2026-09-01", "2027-07-26", "2027-PLO"],
    ["2027-SLO", "2027-09-01", "2028-07-25", "2028-PLO"],
  ])(
    "calculates the second ordinary legislature from %s",
    (legislature, initiatedAt, date, endLegislature) => {
      const expiration = initiativeProceduralFacts({
        type: "PROYECTO DE LEY ORGÁNICA",
        status: "En comisión",
        initiated: "Sí",
        initiatedAt,
        legislature,
        sourceChamber: "DIPUTADOS",
        originChamber: "DIPUTADOS",
      }).expiration;

      expect(expiration).toMatchObject({
        state: "PROJECTED",
        basis: "DERIVED",
        date,
        startLegislature: legislature,
        endLegislature,
        legalBasis: ["CRD-89", "CRD-100", "CRD-104"],
      });
    },
  );

  it("does not apply the two-legislature rule to another initiative type", () => {
    expect(
      initiativeProceduralFacts({
        type: "Resolución interna",
        status: "Depositada",
        initiated: "NO",
        legislature: "2026-SLO",
        sourceChamber: "SENADO",
      }).expiration,
    ).toEqual({
      state: "RULE_NOT_APPLICABLE",
      basis: "DERIVED",
      reason: "TYPE_NOT_COVERED_BY_TWO_LEGISLATURE_RULE",
    });
  });

  it.each([null, "", "Categoría experimental", "Proyecto de Leyenda"])(
    "does not claim that the rule is inapplicable when type %j is missing or unknown",
    (type) => {
      expect(
        initiativeProceduralFacts({
          type,
          status: "Depositada",
          initiated: "NO",
          sourceChamber: "SENADO",
        }).expiration,
      ).toEqual({
        state: "REVIEW_REQUIRED",
        basis: "DERIVED",
        reason: "TYPE_NOT_PUBLISHED_OR_RECOGNIZED",
      });
    },
  );

  it.each(["Resolución", "Contrato de préstamo", "Convenio internacional", "Nombramiento"])(
    "limits RULE_NOT_APPLICABLE to a recognized non-bill type: %s",
    (type) => {
      expect(initiativeProceduralFacts({ type }).expiration).toEqual({
        state: "RULE_NOT_APPLICABLE",
        basis: "DERIVED",
        reason: "TYPE_NOT_COVERED_BY_TWO_LEGISLATURE_RULE",
      });
    },
  );

  it("fails closed for an extraordinary or contradictory start", () => {
    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        initiated: "SI",
        legislature: "2026-PLO",
        sourceChamber: "DIPUTADOS",
        originChamber: "DIPUTADOS",
      }).expiration,
    ).toMatchObject({ state: "REVIEW_REQUIRED", reason: "COUNT_START_NOT_PUBLISHED" });

    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        initiated: "NO",
        initiatedAt: "2026-03-01",
        legislature: "2026-PLO",
        sourceChamber: "DIPUTADOS",
        originChamber: "DIPUTADOS",
      }).expiration,
    ).toMatchObject({ state: "REVIEW_REQUIRED", reason: "CONFLICTING_START_EVIDENCE" });

    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        initiated: "SI",
        initiatedAt: "2026-02-01",
        legislature: "2026-SLE",
        sourceChamber: "SENADO",
        originChamber: "SENADO",
      }).expiration,
    ).toMatchObject({ state: "REVIEW_REQUIRED", reason: "INVALID_OR_EXTRAORDINARY_LEGISLATURE" });

    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        initiated: "SI",
        initiatedAt: "2026-09-01",
        legislature: "2026-PLO",
        sourceChamber: "DIPUTADOS",
        originChamber: "DIPUTADOS",
      }).expiration,
    ).toMatchObject({ state: "REVIEW_REQUIRED", reason: "CONFLICTING_START_EVIDENCE" });
  });

  it("does not restart an unlinked bicameral record from the receiving chamber", () => {
    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        initiated: "SI",
        initiatedAt: "2026-03-01",
        legislature: "2026-PLO",
        sourceChamber: "DIPUTADOS",
        originChamber: "SENADO",
      }).expiration,
    ).toMatchObject({ state: "REVIEW_REQUIRED", reason: "BICAMERAL_START_NOT_LINKED" });
  });

  it("keeps terminal and in-transit positions out of a chamber", () => {
    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "Promulgada",
        sourceChamber: "SENADO",
      }).currentLocation,
    ).toMatchObject({ state: "PROCEDURE_CONCLUDED", status: "Promulgada" });

    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "Despachada",
        sourceChamber: "SENADO",
        events: [{ source: "senado-sil", status: "Despachada", eventDate: "2026-08-28" }],
      }).currentLocation,
    ).toMatchObject({ state: "IN_TRANSIT", evidenceStatus: "Despachada" });
  });

  it("does not turn the origin chamber alone into the current chamber", () => {
    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        originChamber: "SENADO",
      }).currentLocation,
    ).toEqual({
      state: "UNRESOLVED",
      basis: "OBSERVED",
      reason: "ORIGIN_ONLY_NOT_CURRENT_EVIDENCE",
    });
  });

  it("uses an official peremption event before any calculation", () => {
    const expiration = initiativeProceduralFacts({
      type: "Proyecto de Ley",
      status: "Perimida",
      initiated: "SI",
      legislature: "2025-SLO",
      sourceChamber: "SENADO",
      originChamber: "SENADO",
      events: [
        {
          source: "senado-sil",
          status: "Perimida",
          eventDate: "2026-07-26",
          sourceEventId: "official-expiry",
        },
      ],
    }).expiration;

    expect(expiration).toMatchObject({
      state: "SOURCE_PUBLISHED",
      date: "2026-07-26",
      reason: "SOURCE_PEREMPTION_EVENT",
      sourceEventId: "official-expiry",
    });
  });

  it("never promotes observedAt to an official peremption date", () => {
    const expiration = initiativeProceduralFacts({
      type: "Proyecto de Ley",
      status: "Perimida",
      events: [
        {
          source: "senado-sil",
          status: "Perimida",
          eventDate: null,
          observedAt: "2026-07-27T13:00:00.000Z",
          sourceEventId: "observed-only",
        },
      ],
    }).expiration;

    expect(expiration).toEqual({
      state: "EXPIRED_DATE_UNPUBLISHED",
      basis: "OFFICIAL",
      reason: "SOURCE_REPORTS_PEREMPTION_WITHOUT_DATE",
      status: "Perimida",
    });
  });
});
