import { NextRequest, NextResponse } from "next/server";
import { getInitiatives } from "@/lib/data";
import { boundedInteger } from "@/lib/input";
import { apiError, PRIVATE_READ_CACHE } from "@/lib/api";
import { parseLang } from "@/lib/i18n";
import { officialDocumentLiveHref } from "@/lib/official-document-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/initiatives?limit= — source-backed initiative facts as JSON. */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const lang = parseLang(sp.get("lang"));
    const limit = boundedInteger(sp.get("limit"), { fallback: 50, min: 1, max: 500 });
    const rows = await getInitiatives({ limit });
    const data = rows.map((row) => {
      const {
        preferredDocumentId,
        preferredDocumentUrl,
        preferredDocumentAvailable,
        ...publicRow
      } = row;
      return {
        ...publicRow,
        officialDocument: {
          available: preferredDocumentAvailable,
          openHref: officialDocumentLiveHref(
            {
              source: row.source,
              docType: "Proyecto depositado",
              url: preferredDocumentUrl,
              pdfAvailable: preferredDocumentAvailable,
            },
            preferredDocumentId,
            row.id,
            lang,
          ),
        },
      };
    });
    return NextResponse.json(
      { count: data.length, data },
      { headers: { "cache-control": PRIVATE_READ_CACHE } },
    );
  } catch (error) {
    return apiError(req, error, "initiatives");
  }
}
