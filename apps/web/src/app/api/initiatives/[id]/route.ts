import { NextRequest, NextResponse } from "next/server";
import { getInitiative } from "@/lib/data";
import { positiveInteger, safeHttpUrl, safeOfficialUrl } from "@/lib/input";
import { apiError, PRIVATE_READ_CACHE } from "@/lib/api";
import { isDepositedBillDocumentType } from "@oculis/core";
import { parseLang } from "@/lib/i18n";
import { officialDocumentLiveHref } from "@/lib/official-document-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/initiatives/:id — source-backed facts and the official status timeline. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const lang = parseLang(req.nextUrl.searchParams.get("lang"));
    const parsedId = positiveInteger(id);
    if (parsedId == null) return NextResponse.json({ error: "bad_id" }, { status: 400 });
    const ini = await getInitiative(parsedId);
    if (!ini) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Explicit public DTO: internal classifications, workflow fields, and scores stay private.
    const body = {
      id: ini.id,
      source: ini.source,
      code: ini.code,
      /** Exact title published by the official source. */
      title: ini.title,
      /** Reviewed English display translation for the exact current official title. */
      titleEn: ini.titleEn,
      purpose: ini.purpose,
      type: ini.type,
      sourceCategory: ini.sourceCategory,
      status: ini.status,
      chamber: ini.chamber,
      sourceChamber: ini.sourceChamber,
      originChamber: ini.originChamber,
      currentChamber: ini.currentChamber,
      currentBody: ini.currentBody,
      condition: ini.condition,
      sourceId: ini.sourceId,
      subjectMatter: ini.subjectMatter,
      sponsor: ini.sponsor,
      sponsorRole: ini.sponsorRole,
      sponsorCount: ini.sponsorCount,
      proponents: ini.proponents,
      activities: ini.activities,
      votes: ini.votes,
      sourceCoverage: ini.sourceCoverage,
      party: ini.party,
      province: ini.province,
      committee: ini.committee,
      filedAt: ini.filedAt,
      expiresAt: ini.expiresAt,
      proceduralFacts: ini.proceduralFacts,
      initiated: ini.initiated,
      initiatedAt: ini.initiatedAt,
      legislature: ini.legislature,
      registrationPeriod: ini.registrationPeriod,
      officialStatusChangedAt: ini.officialStatusChangedAt,
      promulgationNumber: ini.promulgationNumber,
      promulgatedAt: ini.promulgatedAt,
      sourceUrl: safeOfficialUrl(ini.sourceUrl, ini.source),
      events: ini.events.map((event) => ({
        id: event.id,
        sourceEventId: event.sourceEventId,
        status: event.status,
        eventDate: event.eventDate,
        eventEndDate: event.eventEndDate,
        note: event.note,
        source: event.source,
        sourceUrl: safeOfficialUrl(event.sourceUrl, event.source),
        evidenceType: event.evidenceType,
        observedAt: event.observedAt,
      })),
      commissionAssignments: ini.commissionAssignments,
      documents: ini.documents.map((document) => {
        const depositedBill =
          document.source === "sil-diputados" && isDepositedBillDocumentType(document.docType);
        if (depositedBill) {
          return {
            id: document.id,
            kind: "official-deposited-bill-pdf" as const,
            extension: document.extension,
            uploadedAt: document.uploadedAt,
            modifiedAt: document.modifiedAt,
            firstSeenAt: document.firstSeenAt,
            lastSeenAt: document.lastSeenAt,
            pdfAvailable: document.pdfAvailable,
            openHref: officialDocumentLiveHref(
              {
                source: document.source,
                docType: document.docType,
                url: document.url,
                pdfAvailable: document.pdfAvailable,
              },
              document.id,
              ini.id,
              lang,
            ),
          };
        }
        return {
          id: document.id,
          source: document.source,
          sourceDocId: document.sourceDocId,
          docType: document.docType,
          extension: document.extension,
          url: safeOfficialUrl(document.url, document.source),
          uploadedAt: document.uploadedAt,
          modifiedAt: document.modifiedAt,
          sourceCategory: document.sourceCategory,
          sourceFragment: document.sourceFragment,
          firstSeenAt: document.firstSeenAt,
          lastSeenAt: document.lastSeenAt,
          pdfAvailable: document.pdfAvailable,
        };
      }),
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
