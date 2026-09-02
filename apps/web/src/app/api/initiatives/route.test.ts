import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getInitiatives } = vi.hoisted(() => ({ getInitiatives: vi.fn() }));

vi.mock("@/lib/data", () => ({ getInitiatives }));

import { GET } from "./route";

const upstreamPdf =
  "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=260674";

describe("initiative list public document boundary", () => {
  beforeEach(() => getInitiatives.mockReset());

  for (const [lang, suffix] of [
    ["es", ""],
    ["en", "&lang=en"],
  ] as const) {
    it(`keeps the deposited-bill upstream URL server-side (${lang})`, async () => {
      getInitiatives.mockResolvedValue([
        {
          id: 20710,
          source: "sil-diputados",
          sourceId: "27047",
          code: "06218-2024-2028-CD",
          title: "Proyecto de ley sobre archivos públicos",
          titleEn: "Public Records Bill",
          preferredDocumentId: 19788,
          preferredDocumentUrl: upstreamPdf,
          preferredDocumentAvailable: false,
        },
      ]);

      const response = await GET(
        new NextRequest(`http://localhost/api/initiatives?limit=1&lang=${lang}`),
      );
      const payload = await response.json();
      const serialized = JSON.stringify(payload);

      expect(response.status).toBe(200);
      expect(payload.data[0].officialDocument).toEqual({
        available: false,
        openHref: `/api/document/open?documentId=19788&initiativeId=20710${suffix}`,
      });
      expect(payload.data[0]).not.toHaveProperty("preferredDocumentId");
      expect(payload.data[0]).not.toHaveProperty("preferredDocumentUrl");
      expect(payload.data[0]).not.toHaveProperty("preferredDocumentAvailable");
      expect(serialized).not.toContain(upstreamPdf);
      expect(serialized).not.toContain("s-sil.camaradediputados.gob.do");
    });
  }
});
