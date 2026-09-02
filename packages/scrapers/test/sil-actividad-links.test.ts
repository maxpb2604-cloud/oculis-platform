import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveCommitteeActivityUrl,
  SilActividadAdapter,
  type SilAgendaActividad,
  type SilComisionOrden,
} from "../src/sil-actividad.js";
import type {
  CommissionAgendaDocument,
  CommissionAgendaResolver,
} from "../src/dip-commission-agenda.js";

const API_ROOT = "https://official.test/sil/api";

const specialCommissionOrder: SilComisionOrden = {
  fecha: "2026-08-27T00:00:00",
  descripcion:
    "Coordinar la agenda de trabajo de la Comisión para la Segunda Legislatura Ordinaria 2026 (SLO-2026).\r\n\r\nPresentar la iniciativa No.05278-2024-2028-CD:\r\n\r\nContinuar con el estudio de la iniciativa No.05368-2024-2028-CD:",
  tipo: "Reunión",
  nombreComision:
    "05368-2024-2028-CD Comisión especial designada para estudiar el Proyecto de ley que modifica la Ley núm.5-13 sobre Discapacidad en la República Dominicana.",
  periodoLegislativo: 2761,
};

const calendar161253: SilAgendaActividad = {
  id: 161253,
  title: "Reunión de la comisión especial",
  tipoActividad: "Reunión",
  comision:
    "05368-2024-2028-CD Comisión especial designada para estudiar el Proyecto de ley que modifica la Ley núm.5-13 sobre Discapacidad en la República Dominicana.",
  start: "2026-08-27T09:30:00",
  end: "2026-08-27T09:30:00",
  descripcion:
    "Coordinar la agenda de trabajo de la Comisión para la Segunda Legislatura Ordinaria 2026 (SLO-2026).\n\nPresentar la iniciativa No.05278-2024-2028-CD:\n\nContinuar con el estudio de la iniciativa No.05368-2024-2028-CD:",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sil-actividad: exact committee destinations", () => {
  it("maps commission 5243 to exact activity 161253, including its reported time and detail", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comision/ordenes")) {
        return json(page([specialCommissionOrder]));
      }
      if (url.pathname.endsWith("/actividad/AgendaActividad")) {
        expect(url.searchParams.get("inicio")).toBe("2026-08-27");
        expect(url.searchParams.get("fin")).toBe("2026-08-27");
        return json([calendar161253]);
      }
      if (url.pathname.endsWith("/actividad/actividad/161253")) {
        return json({
          id: 367680,
          ubicacion: "Salón Rafaela Alburquerque",
          comisionId: 5243,
          comision: calendar161253.comision,
        });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SilActividadAdapter(
      API_ROOT,
      dailyAgendaResolver(specialCommissionPdfText),
    ).committeeOrders();
    const event = result.events[0]!;
    expect(event).toMatchObject({
      sourceEventId: "161253",
      agendaUrl: dailyAgendaDocument.previewUrl,
      time: "09:30:00",
      location: "Salón Rafaela Alburquerque",
    });
    expect(event.agendaUrl).not.toContain("/comision/5243");
    expect(event.raw).toMatchObject({
      calendarEvent: { id: 161253, start: "2026-08-27T09:30:00" },
      activityDetail: {
        ubicacion: "Salón Rafaela Alburquerque",
        comisionId: 5243,
      },
      provenance: {
        matchStatus: "UNIQUE",
        matchCandidateCount: 1,
        activityId: 161253,
        calendarSourceUrl:
          "https://official.test/sil/api/actividad/AgendaActividad?inicio=2026-08-27&fin=2026-08-27",
        calendarEventUrl: "https://official.test/sil/api/actividad/actividad/161253",
        dailyAgendaPageSource:
          "https://camaradediputados.gob.do/agenda-comisiones/#211-2245-wpfd-agosto-slo-2026",
        dailyAgendaCategoryId: 2245,
        dailyAgendaFileId: 28988,
        dailyAgendaDownloadUrl: dailyAgendaDocument.downloadUrl,
        dailyAgendaPreviewUrl: dailyAgendaDocument.previewUrl,
        agendaDestination: dailyAgendaDocument.previewUrl,
        officialLocation: "Salón Rafaela Alburquerque",
        officialCommissionId: 5243,
      },
    });

    const previousFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          fecha: specialCommissionOrder.fecha,
          descripcion: specialCommissionOrder.descripcion,
          tipo: specialCommissionOrder.tipo,
          nombreComision: specialCommissionOrder.nombreComision,
          periodoLegislativo: specialCommissionOrder.periodoLegislativo,
        }),
      )
      .digest("hex");
    expect(event.dedupeKey).toBe(`sil-com|${previousFingerprint}|1`);
    expect(result.gap).toBeUndefined();
  });

  it("returns null when the four-field match is ambiguous", () => {
    expect(
      resolveCommitteeActivityUrl(
        specialCommissionOrder,
        [calendar161253, { ...calendar161253, id: 161999 }],
        API_ROOT,
      ),
    ).toBeNull();
  });

  it("returns null when date, commission, type, or description does not match", () => {
    expect(
      resolveCommitteeActivityUrl(
        specialCommissionOrder,
        [{ ...calendar161253, descripcion: "Una agenda diferente" }],
        API_ROOT,
      ),
    ).toBeNull();
    expect(
      resolveCommitteeActivityUrl(
        specialCommissionOrder,
        [{ ...calendar161253, start: "2026-08-28T09:30:00" }],
        API_ROOT,
      ),
    ).toBeNull();
  });

  it("normalizes only case, Unicode composition, and whitespace for an exact factual match", () => {
    expect(
      resolveCommitteeActivityUrl(
        {
          ...specialCommissionOrder,
          nombreComision: specialCommissionOrder.nombreComision?.toLocaleUpperCase("es") ?? null,
          tipo: "  REUNIÓN ",
        },
        [calendar161253],
        API_ROOT,
      ),
    ).toBe("https://official.test/sil/api/actividad/actividad/161253");
  });

  it("never falls back to a commission or generic agenda page", () => {
    expect(resolveCommitteeActivityUrl(specialCommissionOrder, [], API_ROOT)).toBeNull();
    expect(
      resolveCommitteeActivityUrl(
        { ...specialCommissionOrder, agendaUrl: "/sil/comision/5243", comisionId: 5243 },
        [],
        API_ROOT,
      ),
    ).toBeNull();
  });

  it("keeps the exact activity id, URL, and time when optional detail enrichment fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comision/ordenes")) {
        return json(page([specialCommissionOrder]));
      }
      if (url.pathname.endsWith("/actividad/AgendaActividad")) return json([calendar161253]);
      if (url.pathname.endsWith("/actividad/actividad/161253")) {
        return new Response("not available", { status: 404 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SilActividadAdapter(
      API_ROOT,
      dailyAgendaResolver(specialCommissionPdfText),
    ).committeeOrders();
    expect(result.events[0]).toMatchObject({
      sourceEventId: "161253",
      agendaUrl: dailyAgendaDocument.previewUrl,
      time: "09:30:00",
      location: null,
      raw: {
        calendarEvent: { id: 161253 },
        activityDetail: null,
        provenance: {
          activityId: 161253,
          calendarEventUrl: "https://official.test/sil/api/actividad/actividad/161253",
          agendaDestination: dailyAgendaDocument.previewUrl,
        },
      },
    });
    expect(result.gap).toContain("su ID y hora exactos se conservaron");
  });

  it("keeps agendaUrl null when the date-matched PDF does not contain the commission", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comision/ordenes")) return json(page([specialCommissionOrder]));
      if (url.pathname.endsWith("/actividad/AgendaActividad")) return json([calendar161253]);
      if (url.pathname.endsWith("/actividad/actividad/161253")) {
        return json({ ubicacion: "Salón Rafaela Alburquerque", comisionId: 5243 });
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new SilActividadAdapter(
      API_ROOT,
      dailyAgendaResolver("Agenda diaria\nHacienda\n27/08/2026"),
    ).committeeOrders();
    expect(result.events[0]).toMatchObject({
      sourceEventId: "161253",
      agendaUrl: null,
      raw: {
        dailyAgendaDocument: { fileId: 28988 },
        dailyAgendaVerification: { matched: false },
        provenance: {
          calendarEventUrl: "https://official.test/sil/api/actividad/actividad/161253",
          agendaDestination: null,
        },
      },
    });
    expect(result.gap).toContain(
      "no tuvieron evidencia literal suficiente de la comisión y su agenda",
    );
  });
});

const dailyAgendaDocument: CommissionAgendaDocument = {
  source: "dip-commission-agenda",
  sourceId: "2245:28988",
  categoryId: 2245,
  categoryTitle: "agosto",
  fileId: 28988,
  title: "Agenda del 27 de agosto de 2026",
  slug: "agenda-del-27-de-agosto-de-2026-2",
  extension: "pdf",
  agendaDate: "2026-08-27",
  downloadUrl:
    "https://camaradediputados.gob.do/download/2245/agosto/28988/agenda-del-27-de-agosto-de-2026-2.pdf",
  previewUrl:
    "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=file.download&wpfd_category_id=2245&wpfd_file_id=28988&token=&preview=1",
  raw: {
    payload: { ID: 28988, catid: "2245" },
    provenance: {
      pageSource:
        "https://camaradediputados.gob.do/agenda-comisiones/#211-2245-wpfd-agosto-slo-2026",
      metadataUrl:
        "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=files.display&id=2245",
      downloadUrl:
        "https://camaradediputados.gob.do/download/2245/agosto/28988/agenda-del-27-de-agosto-de-2026-2.pdf",
      previewUrl:
        "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=file.download&wpfd_category_id=2245&wpfd_file_id=28988&token=&preview=1",
    },
  },
};

const specialCommissionPdfText = `Agenda del jueves, 27 de agosto de 2026
1 ${specialCommissionOrder.nombreComision} 27/08/2026
${specialCommissionOrder.descripcion}`;

function dailyAgendaResolver(pdfText: string): CommissionAgendaResolver {
  return {
    resolveDates: async (dates) => ({
      documentsByDate: new Map(
        dates.map((date) => [date, date === "2026-08-27" ? dailyAgendaDocument : null]),
      ),
      pdfTextBySourceId: new Map([[dailyAgendaDocument.sourceId, pdfText]]),
      gaps: [],
    }),
  };
}

function page<T>(results: T[]) {
  return { page: 1, pageSize: 10, total: results.length, results };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
