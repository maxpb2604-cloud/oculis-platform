import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  isLegislatorProfileId,
  LegislatorProfileProvider,
  LegislatorProfileTrigger,
} from "@/components/legislator-profile-provider";

function renderTrigger(lang: "es" | "en", profileId: number | null) {
  return renderToStaticMarkup(
    <LegislatorProfileProvider lang={lang}>
      <LegislatorProfileTrigger
        profileId={profileId}
        fullName="Ana María Peña"
        chamber="DIPUTADOS"
        role="Diputada"
        party="PRM"
        province="Santo Domingo"
      />
    </LegislatorProfileProvider>,
  );
}

describe("global legislator profile trigger contract", () => {
  it("renders a canonical button for an exactly resolved profile", () => {
    const html = renderTrigger("es", 42);

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('data-entity="legislator"');
    expect(html).toContain('data-legislator-key="profile:42"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Abrir perfil de Ana María Peña"');
    expect(html).toContain("Ana María Peña");
    expect(html).not.toContain("<a");
  });

  it("still renders a dialog trigger when no exact source identity exists", () => {
    const html = renderTrigger("es", null);

    expect(html).toContain("<button");
    expect(html).toContain('data-entity="legislator"');
    expect(html).toContain('data-legislator-key="unresolved"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Abrir perfil de Ana María Peña"');
    expect(html).not.toContain("<a");
  });

  it("localizes the trigger's accessible name without changing the person's name", () => {
    const html = renderTrigger("en", 42);

    expect(html).toContain("Ana María Peña");
    expect(html).toContain("Open Ana María Peña");
    expect(html).toContain("profile");
    expect(html).not.toContain("Abrir perfil");
  });

  it("accepts only positive safe integer profile ids", () => {
    expect(isLegislatorProfileId(1)).toBe(true);
    expect(isLegislatorProfileId(Number.MAX_SAFE_INTEGER)).toBe(true);

    for (const value of [null, undefined, "1", 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isLegislatorProfileId(value)).toBe(false);
    }
  });
});
