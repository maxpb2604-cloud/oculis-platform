import {
  isDepositedBillDocumentType,
  officialDepositedBillPdfUrl,
  type DepositedBillDocumentFacts,
} from "@oculis/core";
import type { Lang } from "@/lib/i18n";
import { safeOfficialUrl } from "@/lib/input";

export type OfficialDocumentLinkFacts = DepositedBillDocumentFacts & {
  /** Persisted validation of the exact current PDF metadata snapshot. */
  pdfAvailable?: boolean;
};

function localOfficialDocumentOpenHref(
  facts: OfficialDocumentLinkFacts,
  documentId: number | null | undefined,
  initiativeId: number | null | undefined,
  lang: Lang,
): string | null {
  const officialUrl = officialDepositedBillPdfUrl(facts);
  if (
    !officialUrl ||
    !Number.isSafeInteger(documentId) ||
    documentId! <= 0 ||
    !Number.isSafeInteger(initiativeId) ||
    initiativeId! <= 0
  ) {
    return null;
  }

  const query = new URLSearchParams({
    documentId: String(documentId),
    initiativeId: String(initiativeId),
  });
  if (lang === "en") query.set("lang", "en");
  return `/api/document/open?${query.toString()}`;
}

/**
 * Build the local, fail-closed opener for one official deposited bill PDF.
 *
 * Components must first apply their source-aware URL allowlist and pass a persisted
 * availability decision for the exact current metadata snapshot. The core document
 * contract is intentionally checked a second time so metadata alone, a contextual
 * attachment, or a URL from another source never reaches the probe.
 */
export function officialDocumentGuardHref(
  facts: OfficialDocumentLinkFacts,
  documentId: number | null | undefined,
  initiativeId: number | null | undefined,
  lang: Lang = "es",
): string | null {
  return facts.pdfAvailable === true
    ? localOfficialDocumentOpenHref(facts, documentId, initiativeId, lang)
    : null;
}

/**
 * Build an on-demand opener from exact official metadata.
 *
 * Unlike `officialDocumentGuardHref`, this does not require a previously persisted
 * extraction. The local endpoint still reloads the server-owned row and verifies the
 * live response's official host, MIME type and PDF signature before redirecting. This
 * is intended for an explicit click in the initiative's official-document list; it
 * does not make a background availability claim.
 */
export function officialDocumentLiveHref(
  facts: OfficialDocumentLinkFacts,
  documentId: number | null | undefined,
  initiativeId: number | null | undefined,
  lang: Lang = "es",
): string | null {
  const safeUrl = safeOfficialUrl(facts.url, facts.source);
  if (!safeUrl) return null;
  return localOfficialDocumentOpenHref({ ...facts, url: safeUrl }, documentId, initiativeId, lang);
}

/**
 * Destination for a document listed on an initiative.
 *
 * The official deposited bill text appears only after persisted verification and still
 * goes through the live PDF guard. Other contextual attachments (agendas, reports,
 * etc.) remain directly usable after the ordinary source/domain allowlist. A deposited
 * metadata row that fails the stricter contract never falls back to a direct link.
 */
export function officialDocumentCtaHref(
  facts: OfficialDocumentLinkFacts,
  documentId: number | null | undefined,
  initiativeId: number | null | undefined,
  lang: Lang = "es",
): string | null {
  const safeUrl = safeOfficialUrl(facts.url, facts.source);
  if (!safeUrl) return null;
  const isDepositedBill =
    facts.source === "sil-diputados" && isDepositedBillDocumentType(facts.docType);
  return isDepositedBill
    ? officialDocumentGuardHref({ ...facts, url: safeUrl }, documentId, initiativeId, lang)
    : safeUrl;
}
