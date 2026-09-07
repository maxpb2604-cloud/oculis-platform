import { describe, expect, it } from "vitest";
import { initiativeProceduralFacts } from "@/lib/initiative-procedural-facts";

describe("initiativeProceduralFacts", () => {
  it("counts the filing legislature even when the source says consideration has not started", () => {
    const facts = initiativeProceduralFacts({
      type: "Proyecto de Ley",
      status: "Depositado",
      filedAt: "2026-08-31",
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
    expect(facts.expiration).toMatchObject({
      state: "PROJECTED",
      basis: "DERIVED",
      reason: "TWO_ORDINARY_LEGISLATURES",
      date: "2027-07-26",
      startLegislature: "2026-SLO",
      endLegislature: "2027-PLO",
      startEvidenceDate: "2026-08-31",
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
        filedAt: initiatedAt,
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

  it("applies the platform's legislative validity rule to every filed legislative initiative", () => {
    expect(
      initiativeProceduralFacts({
        type: "Resolución interna",
        status: "Depositada",
        initiated: "NO",
        filedAt: "2026-08-20",
        legislature: "2026-SLO",
        sourceChamber: "SENADO",
      }).expiration,
    ).toMatchObject({
      state: "PROJECTED",
      reason: "TWO_ORDINARY_LEGISLATURES",
      startLegislature: "2026-SLO",
    });
  });

  it("fails closed when filing evidence is missing or contradictory", () => {
    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        sourceChamber: "DIPUTADOS",
      }).expiration,
    ).toMatchObject({
      state: "REVIEW_REQUIRED",
      reason: "INVALID_OR_EXTRAORDINARY_LEGISLATURE",
    });

    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        filedAt: "2026-09-01",
        legislature: "2026-PLO",
        sourceChamber: "DIPUTADOS",
        originChamber: "DIPUTADOS",
      }).expiration,
    ).toMatchObject({ state: "REVIEW_REQUIRED", reason: "CONFLICTING_START_EVIDENCE" });

    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        filedAt: "2026-08-01",
        legislature: "2026-SLE",
        sourceChamber: "SENADO",
        originChamber: "SENADO",
      }).expiration,
    ).toMatchObject({ state: "REVIEW_REQUIRED", reason: "INVALID_OR_EXTRAORDINARY_LEGISLATURE" });
  });

  it("does not restart the two-legislature window when the record changes chamber", () => {
    expect(
      initiativeProceduralFacts({
        type: "Proyecto de Ley",
        status: "En comisión",
        filedAt: "2026-03-01",
        legislature: "2026-PLO",
        sourceChamber: "DIPUTADOS",
        originChamber: "SENADO",
      }).expiration,
    ).toMatchObject({
      state: "PROJECTED",
      startLegislature: "2026-PLO",
      endLegislature: "2026-SLO",
    });
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
