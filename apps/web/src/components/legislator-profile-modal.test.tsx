import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LegislatorInitiativeStatsPanel } from "./legislator-profile-modal";

function findFiledInitiativesAction(node: React.ReactNode): React.ReactElement<{
  "data-action"?: string;
  href?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<{
    "data-action"?: string;
    href?: string;
    onClick?: () => void;
    children?: React.ReactNode;
  }>;
  if (element.props["data-action"] === "view-filed-initiatives") return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const match = findFiledInitiativesAction(child);
    if (match) return match;
  }
  return null;
}

describe("legislator initiative statistics", () => {
  it("renders exact linked counts in Spanish without calling the remainder archived", () => {
    const html = renderToStaticMarkup(
      <LegislatorInitiativeStatsPanel
        lang="es"
        titleId="stats-es"
        initiativesHref="/initiatives?legislator=77"
        legislatorName="María Ejemplo"
        stats={{
          availability: "observed",
          basis: "official-proponent-id",
          coverage: "partial",
          deposited: 14,
          active: 9,
          otherConditionOrUnpublished: 5,
        }}
      />,
    );

    expect(html).toContain("Iniciativas depositadas");
    expect(html).toContain("Depositadas vinculadas");
    expect(html).toContain("Vigentes");
    expect(html).toContain("No marcadas vigentes");
    expect(html).toContain(">14<");
    expect(html).toContain(">9<");
    expect(html).toContain(">5<");
    expect(html).toContain("no significa que estén archivadas");
    expect(html).toContain("Mínimo verificable");
    expect(html).toContain('href="/initiatives?legislator=77"');
    expect(html).toContain("Ver iniciativas depositadas");
    expect(html).toContain('data-action="view-filed-initiatives"');
    expect(html).toContain('aria-label="Ver iniciativas depositadas vinculadas a María Ejemplo"');
  });

  it("localizes the exact-count method and fails closed when identity is unavailable", () => {
    const exact = renderToStaticMarkup(
      <LegislatorInitiativeStatsPanel
        lang="en"
        titleId="stats-en"
        initiativesHref="/initiatives?legislator=91&lang=en"
        legislatorName="María Example"
        stats={{
          availability: "observed",
          basis: "official-proponent-id",
          coverage: "partial",
          deposited: 0,
          active: 0,
          otherConditionOrUnpublished: 0,
        }}
      />,
    );
    const unavailable = renderToStaticMarkup(
      <LegislatorInitiativeStatsPanel
        lang="en"
        titleId="stats-unavailable"
        initiativesHref="/initiatives?legislator=92&lang=en"
        stats={{
          availability: "unavailable",
          reason: "no-compatible-official-identifier",
          deposited: null,
          active: null,
          otherConditionOrUnpublished: null,
        }}
      />,
    );

    expect(exact).toContain("Filed initiatives");
    expect(exact).toContain("Not marked active");
    expect(exact).toContain("exact sponsor relationship retained with its official evidence");
    expect(exact).toContain("Verified minimum");
    expect(exact).toContain('href="/initiatives?legislator=91&amp;lang=en"');
    expect(exact).toContain("View filed initiatives");
    expect(exact).toContain('aria-label="View filed initiatives linked to María Example"');
    expect(unavailable).toContain("does not yet have an exact official relationship");
    expect(unavailable).toContain("Zero is not shown");
    expect(unavailable).not.toMatch(/>0</);
    expect(unavailable).not.toContain("View filed initiatives");
    expect(unavailable).not.toContain('data-action="view-filed-initiatives"');
  });

  it("does not publish a zero before the full source reconciliation is known", () => {
    const html = renderToStaticMarkup(
      <LegislatorInitiativeStatsPanel
        lang="es"
        titleId="stats-incomplete"
        initiativesHref="/initiatives?legislator=92"
        stats={{
          availability: "unavailable",
          reason: "reconciliation-incomplete",
          deposited: null,
          active: null,
          otherConditionOrUnpublished: null,
        }}
      />,
    );

    expect(html).toContain("reconciliación completa");
    expect(html).toContain("no presenta un cero");
    expect(html).not.toMatch(/>0</);
    expect(html).not.toContain('data-action="view-filed-initiatives"');
  });

  it("runs the supplied close callback before internal navigation", () => {
    const onNavigate = vi.fn();
    const tree = LegislatorInitiativeStatsPanel({
      lang: "es",
      titleId: "stats-callback",
      initiativesHref: "/initiatives?legislator=103",
      onNavigate,
      stats: {
        availability: "observed",
        basis: "official-proponent-id",
        coverage: "partial",
        deposited: 2,
        active: 1,
        otherConditionOrUnpublished: 1,
      },
    });
    const action = findFiledInitiativesAction(tree);

    expect(action?.props.href).toBe("/initiatives?legislator=103");
    action?.props.onClick?.();
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
