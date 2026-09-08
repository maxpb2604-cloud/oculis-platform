export const DIPUTADOS_OFFICIAL_DOCUMENT_DOMAINS = [
  "diputadosrd.gob.do",
  "camaradediputados.gob.do",
] as const;

export interface DepositedBillDocumentFacts {
  source: string | null | undefined;
  docType: string | null | undefined;
  url: string | null | undefined;
}

/**
 * Exact official labels used by the Cámara SIL for the deposited bill text.
 *
 * `P DEPOSITADO` is the historical label (predominantly 2010–2023) and
 * `PROYECTO DEPOSITADO` is the current label. This deliberately does not use a
 * prefix/contains match: labels such as `PROYECTO DEPOSITADO PREVIO` remain
 * contextual evidence and never become the primary bill PDF.
 */
export function isDepositedBillDocumentType(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "proyecto depositado" || normalized === "p depositado";
}

function normalizedOfficialLabel(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");
}

/** Exact source-history states that assert a committee report was issued. */
export function isCommitteeReportStatus(value: string | null | undefined): boolean {
  const normalized = normalizedOfficialLabel(value);
  return normalized === "con informe de comision" || normalized === "con informe de la comision";
}

/** Official document labels that identify a report issued by a committee. */
export function isCommitteeReportDocumentType(value: string | null | undefined): boolean {
  const normalized = normalizedOfficialLabel(value);
  return /\binforme\b.*\bcomision\b/.test(normalized);
}

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Fail-closed URL contract for one official deposited-bill PDF. Contextual
 * agendas/reports, HTTP, credentials, foreign hosts, and generic pages fail.
 */
export function officialDepositedBillPdfUrl(facts: DepositedBillDocumentFacts): string | null {
  if (facts.source !== "sil-diputados") return null;
  if (!isDepositedBillDocumentType(facts.docType)) return null;
  if (!facts.url || facts.url.length > 2_048) return null;
  try {
    const url = new URL(facts.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (
      !DIPUTADOS_OFFICIAL_DOCUMENT_DOMAINS.some((domain) => isHostOrSubdomain(url.hostname, domain))
    ) {
      return null;
    }
    const directPdf = /\.pdf$/i.test(url.pathname);
    const viewer =
      url.pathname.toLowerCase() === "/reportesgenerales/verdocumento" &&
      /^\d+$/.test(url.searchParams.get("documentoId") ?? "");
    return directPdf || viewer ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Fail-closed URL contract for an official Cámara committee-report PDF.
 * The document type and source must both identify the report; a generic initiative
 * page or a deposited-project document can never satisfy this contract.
 */
export function officialCommitteeReportPdfUrl(facts: DepositedBillDocumentFacts): string | null {
  if (facts.source !== "sil-diputados") return null;
  if (!isCommitteeReportDocumentType(facts.docType)) return null;
  if (!facts.url || facts.url.length > 2_048) return null;
  try {
    const url = new URL(facts.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (
      !DIPUTADOS_OFFICIAL_DOCUMENT_DOMAINS.some((domain) => isHostOrSubdomain(url.hostname, domain))
    ) {
      return null;
    }
    const directPdf = /\.pdf$/i.test(url.pathname);
    const viewer =
      url.pathname.toLowerCase() === "/reportesgenerales/verdocumento" &&
      /^\d+$/.test(url.searchParams.get("documentoId") ?? "");
    return directPdf || viewer ? url.toString() : null;
  } catch {
    return null;
  }
}
