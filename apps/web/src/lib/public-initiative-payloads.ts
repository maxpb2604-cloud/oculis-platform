import type {
  DepositItem as StoredDepositItem,
  InitiativeListItem as StoredInitiativeListItem,
} from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { officialDocumentLiveHref } from "@/lib/official-document-links";
import { officialInitiativeHref } from "@/lib/initiative-links";

/**
 * Deposit facts that may cross the React Server Component boundary into Agenda's
 * interactive chamber switcher. Upstream document metadata stays server-only: the
 * browser receives only Oculis' guarded opener and the already-sanitized initiative
 * record destination needed by the visible controls.
 */
export type PublicHoyDepositItem = Omit<
  StoredDepositItem,
  "source" | "sourceId" | "sourceUrl" | "docId" | "docUrl" | "docSource" | "docType"
> & {
  officialRecordHref: string | null;
  officialDocumentOpenHref: string | null;
};

/**
 * Catalog row safe to serialize into the React payload. The official document's
 * upstream URL and server-owned identifiers never cross the server boundary; the
 * browser receives only Oculis' guarded opener and the small display state it needs.
 */
export type PublicInitiativeListItem = Omit<
  StoredInitiativeListItem,
  "preferredDocumentId" | "preferredDocumentUrl" | "preferredDocumentAvailable"
> & {
  officialDocumentOpenHref: string | null;
  officialDocumentRegistered: boolean;
};

export function toPublicInitiativeListItem(
  item: StoredInitiativeListItem,
  lang: Lang,
): PublicInitiativeListItem {
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
  const {
    preferredDocumentId: _preferredDocumentId,
    preferredDocumentUrl: _preferredDocumentUrl,
    preferredDocumentAvailable: _preferredDocumentAvailable,
    ...publicItem
  } = item;
  return { ...publicItem, officialDocumentOpenHref, officialDocumentRegistered };
}

export function toPublicHoyDepositItem(item: StoredDepositItem, lang: Lang): PublicHoyDepositItem {
  const officialRecordHref = officialInitiativeHref(item, lang);
  const officialDocumentOpenHref = officialDocumentLiveHref(
    {
      source: item.docSource,
      docType: item.docType,
      url: item.docUrl,
      pdfAvailable: item.docAvailable,
    },
    item.docId,
    item.id,
    lang,
  );
  const {
    source: _source,
    sourceId: _sourceId,
    sourceUrl: _sourceUrl,
    docId: _docId,
    docUrl: _docUrl,
    docSource: _docSource,
    docType: _docType,
    ...publicItem
  } = item;

  return { ...publicItem, officialRecordHref, officialDocumentOpenHref };
}
