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
