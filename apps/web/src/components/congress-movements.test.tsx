import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CongressMovement, CongressMovementDay } from "@/lib/data";
import {
  CongressMovements,
  congressMovementPdfHref,
  congressMovementsHref,
  shiftCongressMovementDate,
} from "./congress-movements";

vi.mock("@/components/ui/primitives", () => ({
  NewTabNotice: ({ lang }: { lang: "es" | "en" }) => (
    <span className="sr-only">
      {lang === "es" ? " (abre en una pestaña nueva)" : " (opens in a new tab)"}
    </span>
  ),
}));

const day: CongressMovementDay = {
  chamber: "DIPUTADOS",
  selectedDate: "2026-08-31",
  previousAvailableDate: "2026-08-29",
  nextAvailableDate: null,
  latestAvailableDate: "2026-08-31",
  totalMovementCount: 2,
  uniqueInitiativeCount: 1,
  movements: [
    {
      kind: "FILED",
      initiativeId: 27061,
      code: "06226-2024-2028-CD",
      title:
        "Proyecto de ley que declara el día 26 de octubre de cada año como Día Nacional de la Prevención del Paciente Quemado.",
      titleEn: "Bill declaring October 26 of each year National Burn Patient Prevention Day.",
      status: "Depositado",
      eventDate: "2026-08-31",
      chamber: "DIPUTADOS",
      source: "sil-diputados",
      sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/27061",
      evidenceType: "OFFICIAL_FILED_AT",
      sourceRowCount: 1,
      sourceEventIds: [],
      sourceEventId: null,
      note: null,
      observedAt: "2026-08-31 12:00:00",
      documentPublication: {
        status: "PUBLISHED_VERIFIED",
        checkedAt: null,
        available: true,
        documentId: 501,
      },
    },
    {
      kind: "STATUS",
      initiativeId: 27061,
      code: "06226-2024-2028-CD",
      title:
        "Proyecto de ley que declara el día 26 de octubre de cada año como Día Nacional de la Prevención del Paciente Quemado.",
      titleEn: "Bill declaring October 26 of each year National Burn Patient Prevention Day.",
      status: "Certificado en única discusión",
      eventDate: "2026-08-31",
      chamber: "DIPUTADOS",
      source: "sil-diputados",
      sourceUrl: "https://www.diputadosrd.gob.do/sil/iniciativa/27061",
      evidenceType: "SOURCE_HISTORY",
      sourceRowCount: 1,
      sourceEventIds: ["history-8"],
      sourceEventId: "history-8",
      note: null,
      observedAt: "2026-08-31 12:00:00",
      documentPublication: {
        status: "REGISTERED_UNVERIFIED",
        checkedAt: "2026-08-31T12:00:00.000Z",
        available: false,
        documentId: 501,
      },
    },
  ],
  depositedPdfs: {
    supported: true,
    eligibleFiledInitiativeCount: 1,
    withOfficialMetadata: 1,
    withFreshVerifiedPdf: 1,
    unavailableOrUnverified: 0,
    contractNote: "fixture",
  },
  publications: {
    sources: ["dip-known-agenda"],
    publishedOnDate: 4,
    modifiedOnDate: 2,
    undatedStoredCatalog: 3,
    storedCatalogTotal: 95,
    expectedDailyTotal: null,
    contractNote: "fixture",
  },
};

describe("CongressMovements", () => {
  it("renders a day-by-day chamber archive with accessible date controls", () => {
    const html = renderToStaticMarkup(<CongressMovements day={day} lang="es" today="2026-08-31" />);

    expect(html).toContain("Movimientos registrados");
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-08-31"');
    expect(html).toContain('aria-label="Seleccionar cámara legislativa"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/feed?date=2026-08-30&amp;chamber=DIPUTADOS"');
    expect(html).toContain('aria-label="Ya estás en el día de hoy"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Cámara de Diputados");
    expect(html).toContain("Senado de la República");
    expect(html).toContain("Abrir PDF oficial");
    expect(html).not.toContain("Registros documentales del día seleccionado");
    expect(html).not.toContain("Textos de depósitos registrados");
    expect(html).not.toContain("Publicaciones registradas en catálogos monitoreados");
  });

  it("omits the retired Today and latest-record shortcuts in both languages", () => {
    const spanish = renderToStaticMarkup(
      <CongressMovements
        day={{ ...day, selectedDate: "2026-08-29" }}
        lang="es"
        today="2026-09-01"
      />,
    );
    const english = renderToStaticMarkup(
      <CongressMovements
        day={{ ...day, selectedDate: "2026-08-29" }}
        lang="en"
        today="2026-09-01"
      />,
    );

    expect(spanish).not.toContain(">Hoy</a>");
    expect(spanish).not.toContain("Última fecha con registros");
    expect(spanish).not.toContain("Publicaciones registradas en catálogos monitoreados");
    expect(english).not.toContain(">Today</a>");
    expect(english).not.toContain("Latest date with records");
    expect(english).not.toContain("Publications recorded in monitored catalogs");
  });

  it("moves through adjacent calendar days instead of skipping empty dates", () => {
    expect(shiftCongressMovementDate("2026-08-31", -1)).toBe("2026-08-30");
    expect(shiftCongressMovementDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftCongressMovementDate("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("uses action-first linked headlines and keeps the complete initiative in its detail page", () => {
    const html = renderToStaticMarkup(<CongressMovements day={day} lang="es" today="2026-08-31" />);

    expect(html).toContain("Iniciativa depositada:");
    expect(html).toContain("Declara el día 26 de octubre");
    expect(html).toContain("Certificado en única discusión:");
    expect(html.match(/href="\/initiatives\/27061"/g)).toHaveLength(2);
    expect(html).toContain("Fecha oficial de depósito");
    expect(html).toContain("Historial oficial");
    expect(html).toContain("Abrir PDF oficial");
    expect(html).toContain('data-pdf-availability="available"');
  });

  it("uses reviewed English titles and preserves language in links and controls", () => {
    const html = renderToStaticMarkup(<CongressMovements day={day} lang="en" today="2026-08-31" />);

    expect(html).toContain("Initiative filed:");
    expect(html).toContain("National Burn Patient Prevention Day");
    expect(html).toContain("Certified in single reading:");
    expect(html.match(/href="\/initiatives\/27061\?lang=en"/g)).toHaveLength(2);
    expect(html).toContain("Oculis translation");
    expect(html).toContain('name="lang" value="en"');
    expect(html).toContain("Open official PDF");
  });

  it("labels a missing reviewed English title instead of presenting Spanish as translated", () => {
    const html = renderToStaticMarkup(
      <CongressMovements
        day={{
          ...day,
          movements: [{ ...day.movements[0], titleEn: null }],
          totalMovementCount: 1,
        }}
        lang="en"
        today="2026-08-31"
      />,
    );

    expect(html).toContain("Initiative filed:");
    expect(html).toContain('lang="es"');
    expect(html).toContain("Official Spanish title · translation pending");
    expect(html).not.toContain("Oculis translation");
  });

  it("keeps a filing action in English and discloses an untranslated official status", () => {
    const html = renderToStaticMarkup(
      <CongressMovements
        day={{
          ...day,
          movements: [
            {
              ...day.movements[1],
              titleEn: "A reviewed English initiative title.",
              status: "En comisión",
            },
          ],
          totalMovementCount: 1,
        }}
        lang="en"
        today="2026-08-31"
      />,
    );

    expect(html).toContain("Official update:");
    expect(html).toContain("A reviewed English initiative title");
    expect(html).toContain("Official Spanish status · procedure translation pending");
    expect(html).toContain('lang="es">En comisión</span>');
    expect(html).toContain("Oculis translation");
  });

  it("uses the exact filed-event action even when the initiative now has another status", () => {
    const html = renderToStaticMarkup(
      <CongressMovements
        day={{
          ...day,
          movements: [
            {
              ...day.movements[0],
              titleEn: "A reviewed English initiative title.",
              status: "En comisión",
            },
          ],
          totalMovementCount: 1,
        }}
        lang="en"
        today="2026-08-31"
      />,
    );

    expect(html).toContain("Initiative filed:");
    expect(html).toContain("A reviewed English initiative title");
    expect(html).not.toContain("Official update:");
  });

  it("states unavailable Senate PDF coverage without inventing a ratio", () => {
    const senateDay: CongressMovementDay = {
      ...day,
      chamber: "SENADO",
      movements: day.movements.map((movement) => ({
        ...movement,
        chamber: "SENADO",
        documentPublication: {
          status: "UNSUPPORTED",
          checkedAt: null,
          available: false,
          documentId: null,
        },
      })),
      depositedPdfs: {
        supported: false,
        eligibleFiledInitiativeCount: null,
        withOfficialMetadata: null,
        withFreshVerifiedPdf: null,
        unavailableOrUnverified: null,
        contractNote: "fixture",
      },
    };
    const html = renderToStaticMarkup(
      <CongressMovements day={senateDay} lang="es" today="2026-08-31" />,
    );

    expect(html).toContain("PDF no disponible");
    expect(html).not.toContain("Verificación de textos depositados no disponible");
    expect(html).not.toContain("Monitoreo documental");
    expect(html).not.toContain("null/null");
  });

  it("shows only the two simple PDF states regardless of the backend evidence status", () => {
    const html = renderToStaticMarkup(
      <CongressMovements
        day={{
          ...day,
          movements: [
            {
              ...day.movements[0],
              documentPublication: {
                status: "NOT_PUBLISHED_LATEST_CHECK",
                checkedAt: "2026-08-31T12:00:00.000Z",
                available: false,
                documentId: null,
              },
            },
            {
              ...day.movements[1],
              documentPublication: {
                status: "UNCONFIRMED",
                checkedAt: null,
                available: false,
                documentId: null,
              },
            },
          ],
          totalMovementCount: 2,
        }}
        lang="es"
        today="2026-08-31"
      />,
    );

    expect(html.match(/PDF no disponible/g)).toHaveLength(2);
    expect(html).not.toContain("No publicado en la última verificación");
    expect(html).not.toContain("Publicación sin confirmar");
    expect(html).not.toContain('data-pdf-control="true"');
    expect(html).not.toContain("/api/document/open?");
  });

  it("opens a registered official PDF through the guarded internal route without nesting anchors", () => {
    const html = renderToStaticMarkup(
      <CongressMovements
        day={{
          ...day,
          movements: [day.movements[0]],
          totalMovementCount: 1,
        }}
        lang="en"
        today="2026-08-31"
      />,
    );

    expect(html).toContain("Open official PDF");
    expect(html).toContain('data-pdf-control="true"');
    expect(html).toContain(
      'href="/api/document/open?documentId=501&amp;initiativeId=27061&amp;lang=en"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(opens in a new tab)");
    expect(html).toContain(
      'aria-label="Open the official PDF for 06226-2024-2028-CD in a new tab"',
    );
    expect(html).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
  });

  it("renders an honest empty state and never claims the chamber had no activity", () => {
    const html = renderToStaticMarkup(
      <CongressMovements
        day={{ ...day, movements: [], totalMovementCount: 0, uniqueInitiativeCount: 0 }}
        lang="es"
        today="2026-08-31"
      />,
    );

    expect(html).toContain("No hay movimientos oficiales fechados registrados");
    expect(html).toContain("Esto no demuestra que la cámara no haya tenido actividad");
    expect(html).not.toContain("No hubo movimientos");
  });
});

describe("congressMovementsHref", () => {
  it("builds shareable date/chamber links and keeps English", () => {
    expect(congressMovementsHref({ date: "2026-08-31", chamber: "SENADO", lang: "en" })).toBe(
      "/feed?date=2026-08-31&chamber=SENADO&lang=en",
    );
  });
});

describe("congressMovementPdfHref", () => {
  it("fails closed unless availability and both local identifiers are valid", () => {
    expect(
      congressMovementPdfHref(
        {
          status: "PUBLISHED_VERIFIED",
          checkedAt: null,
          available: true,
          documentId: 501,
        },
        27061,
        "es",
      ),
    ).toBe("/api/document/open?documentId=501&initiativeId=27061");
    expect(
      congressMovementPdfHref(
        {
          status: "REGISTERED_UNVERIFIED",
          checkedAt: "2026-08-31T12:00:00.000Z",
          available: false,
          documentId: 501,
        },
        27061,
        "en",
      ),
    ).toBe("/api/document/open?documentId=501&initiativeId=27061&lang=en");
    expect(
      congressMovementPdfHref(
        {
          status: "PUBLISHED_VERIFIED",
          checkedAt: null,
          available: false,
          documentId: 501,
        } as unknown as CongressMovement["documentPublication"],
        27061,
        "es",
      ),
    ).toBeNull();
    expect(
      congressMovementPdfHref(
        {
          status: "UNCONFIRMED",
          checkedAt: null,
          available: true,
          documentId: 501,
        } as unknown as CongressMovement["documentPublication"],
        27061,
        "es",
      ),
    ).toBeNull();
    expect(
      congressMovementPdfHref(
        {
          status: "PUBLISHED_VERIFIED",
          checkedAt: null,
          available: true,
          documentId: null,
        } as unknown as CongressMovement["documentPublication"],
        27061,
        "es",
      ),
    ).toBeNull();
    expect(
      congressMovementPdfHref(
        {
          status: "PUBLISHED_VERIFIED",
          checkedAt: null,
          available: true,
          documentId: 501,
        },
        Number.NaN,
        "es",
      ),
    ).toBeNull();
  });
});
