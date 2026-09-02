import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  isInitiativeStats,
  isLegislatorProfileId,
  LegislatorProfileProvider,
  LegislatorProfileTrigger,
} from "./legislator-profile-provider";

describe("site-wide legislator profile trigger", () => {
  it("uses a canonical profile id and announces a dialog in Spanish", () => {
    const html = renderToStaticMarkup(
      <LegislatorProfileProvider lang="es">
        <LegislatorProfileTrigger profileId={42} fullName="Ada Pérez">
          Ada Pérez
        </LegislatorProfileTrigger>
      </LegislatorProfileProvider>,
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('data-entity="legislator"');
    expect(html).toContain('data-legislator-key="profile:42"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Abrir perfil de Ada Pérez"');
    expect(html).not.toContain("/api/legislators/");
    expect(html).not.toContain("href=");
  });

  it("keeps an unresolved English name as a dialog button without inventing identity", () => {
    const html = renderToStaticMarkup(
      <LegislatorProfileProvider lang="en">
        <LegislatorProfileTrigger
          profileId={null}
          fullName="Alex Doe"
          chamber="SENADO"
          party="PRM"
        />
      </LegislatorProfileProvider>,
    );

    expect(html).toContain('data-legislator-key="unresolved"');
    expect(html).toContain('aria-label="Open Alex Doe&#x27;s profile"');
    expect(html).toContain("Alex Doe");
    expect(html).not.toContain("href=");
  });

  it("accepts only positive safe integer profile ids", () => {
    expect(isLegislatorProfileId(1)).toBe(true);
    expect(isLegislatorProfileId(2_147_483_647)).toBe(true);
    expect(isLegislatorProfileId(0)).toBe(false);
    expect(isLegislatorProfileId(-1)).toBe(false);
    expect(isLegislatorProfileId(1.5)).toBe(false);
    expect(isLegislatorProfileId("42")).toBe(false);
  });

  it("accepts a source-complete verified zero without confusing it with partial coverage", () => {
    expect(
      isInitiativeStats({
        availability: "observed",
        basis: "official-proponent-id",
        coverage: "complete",
        deposited: 0,
        active: 0,
        otherConditionOrUnpublished: 0,
      }),
    ).toBe(true);
    expect(
      isInitiativeStats({
        availability: "observed",
        basis: "official-proponent-id",
        coverage: "complete",
        deposited: 1,
        active: 1,
        otherConditionOrUnpublished: 0,
      }),
    ).toBe(false);
  });
});
