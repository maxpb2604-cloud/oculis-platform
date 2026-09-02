import type { InitiativeListItem } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { officialDocumentLiveHref } from "@/lib/official-document-links";
import { officialInitiativeHref } from "@/lib/initiative-links";

/**
 * Deliberately narrow initiative catalog payload.
 *
 * Stored source identifiers, upstream URLs and document-verification metadata stay
 * on the server. The rendered catalog receives only the display facts it needs and
 * destinations that have already passed the corresponding server-side guard.
 */
export interface InitiativeCatalogRow {
  id: number;
  chamber: "DIPUTADOS" | "SENADO" | null;
  code: string | null;
  title: string;
  titleEn: string | null;
  status: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  sponsorProfileId: number | null;
  sponsorIsLegislator: boolean;
  filteredProponentRelationship: "principal" | "coproponent" | "published" | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  officialRecordHref: string | null;
  officialDocumentOpenHref: string | null;
  officialDocumentRegistered: boolean;
}

/** Build the only catalog row shape allowed to cross out of the server page. */
export function toInitiativeCatalogRow(item: InitiativeListItem, lang: Lang): InitiativeCatalogRow {
  const officialDocumentOpenHref = officialDocumentLiveHref(
    {
      source: item.source,
      docType: "Proyecto depositado",
      url: item.preferredDocumentUrl,
      pdfAvailable: item.preferredDocumentAvailable,
    },
    item.preferredDocumentId,
    item.id,
    lang,
  );
  const officialDocumentRegistered = Boolean(
    Number.isSafeInteger(item.preferredDocumentId) &&
    item.preferredDocumentId != null &&
    item.preferredDocumentId > 0 &&
    item.preferredDocumentUrl,
  );
  const chamber =
    item.source === "sil-diputados" ? "DIPUTADOS" : item.source === "senado-sil" ? "SENADO" : null;
  const sponsorIsLegislator = Boolean(
    item.sponsor &&
    (item.sponsorProfileId ||
      item.sponsorLegislatorSourceId ||
      /\b(?:diputad[oa]|senador(?:a)?)\b/i.test(item.sponsorRole ?? "")),
  );

  return {
    id: item.id,
    chamber,
    code: item.code,
    title: item.title,
    titleEn: item.titleEn,
    status: item.status,
    sponsor: item.sponsor,
    sponsorRole: item.sponsorRole,
    sponsorProfileId: item.sponsorProfileId,
    sponsorIsLegislator,
    filteredProponentRelationship: item.filteredProponentRelationship,
    party: item.party,
    province: item.province,
    filedAt: item.filedAt,
    officialRecordHref: officialInitiativeHref(item, lang),
    officialDocumentOpenHref,
    officialDocumentRegistered,
  };
}
