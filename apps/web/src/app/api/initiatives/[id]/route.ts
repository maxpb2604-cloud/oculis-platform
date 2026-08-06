import { NextRequest, NextResponse } from "next/server";
import { getInitiative } from "@/lib/data";
import { positiveInteger, safeHttpUrl } from "@/lib/input";
import { apiError, PRIVATE_READ_CACHE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/initiatives/:id — source-backed facts and the official status timeline. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsedId = positiveInteger(id);
    if (parsedId == null) return NextResponse.json({ error: "bad_id" }, { status: 400 });
    const ini = await getInitiative(parsedId);
    if (!ini) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Explicit public DTO: internal classifications, workflow fields, and scores stay private.
    const body = {
      id: ini.id,
      source: ini.source,
      code: ini.code,
      title: ini.title,
      type: ini.type,
      sourceCategory: ini.sourceCategory,
      status: ini.status,
      chamber: ini.chamber,
      sourceId: ini.sourceId,
      sponsor: ini.sponsor,
      sponsorRole: ini.sponsorRole,
      sponsorCount: ini.sponsorCount,
      proponents: ini.proponents,
      party: ini.party,
      province: ini.province,
      filedAt: ini.filedAt,
      sourceUrl: safeHttpUrl(ini.sourceUrl),
      events: ini.events.map((event) => ({
        id: event.id,
        status: event.status,
        eventDate: event.eventDate,
        note: event.note,
        source: event.source,
        sourceUrl: safeHttpUrl(event.sourceUrl),
        evidenceType: event.evidenceType,
        observedAt: event.observedAt,
      })),
      documents: ini.documents.map((document) => ({
        id: document.id,
        source: document.source,
        sourceDocId: document.sourceDocId,
        docType: document.docType,
        extension: document.extension,
        url: safeHttpUrl(document.url),
        uploadedAt: document.uploadedAt,
      })),
      relatedNews: ini.relatedNews.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        url: safeHttpUrl(item.url),
        source: item.source,
        publishedAt: item.publishedAt,
        observedAt: item.observedAt,
      })),
    };
    return NextResponse.json(body, {
      headers: { "cache-control": PRIVATE_READ_CACHE },
    });
  } catch (error) {
    return apiError(req, error, "initiative-detail");
  }
}
