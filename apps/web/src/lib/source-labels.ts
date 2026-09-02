import type { Lang } from "@/lib/i18n";

interface SourceRegistryPresentationInput {
  id: string;
  label: string;
  owner: string;
  coverage: string;
  gapReason?: string;
}

export interface SourceRegistryPresentation {
  label: string;
  owner: string;
  coverage: string;
  gapReason?: string;
}

type EnglishSourcePresentation = SourceRegistryPresentation;

const CHAMBER_OWNER = "Chamber of Deputies";
const SENATE_OWNER = "Senate of the Republic";

/**
 * Customer-facing translations for descriptions authored by Oculis in the source
 * registry. The underlying registry and stored run evidence remain untouched.
 */
const ENGLISH_SOURCE_PRESENTATIONS: Record<string, EnglishSourcePresentation> = {
  "sil-actividad": {
    label: "Chamber committee agendas",
    owner: CHAMBER_OWNER,
    coverage: "Structured SIL meetings and the official daily committee agenda PDF",
  },
  "dip-oficial": {
    label: "Floor order of business",
    owner: CHAMBER_OWNER,
    coverage: "Order-of-business PDFs, initiative codes, and literal procedural mentions",
  },
  "dip-known-agenda": {
    label: "Order of business considered by the floor",
    owner: CHAMBER_OWNER,
    coverage:
      "Complete inventory by sitting; recent PDFs daily and a full weekly scan for exact codes; does not create legislative statuses",
  },
  senado: {
    label: "Senate agendas",
    owner: SENATE_OWNER,
    coverage: "Floor and National Assembly orders of business and the weekly committee agenda",
  },
  "sil-deposits": {
    label: "Chamber filings",
    owner: CHAMBER_OWNER,
    coverage: "Recent filings, explicitly identified principal sponsor, and document metadata",
  },
  "senado-sil-deposits": {
    label: "Recent Senate filings",
    owner: SENATE_OWNER,
    coverage: "Dated rows from the configured legislative collection",
  },
  "senado-sil-fichas": {
    label: "Recent Senate bill files and histories",
    owner: SENATE_OWNER,
    coverage:
      "Official details and histories for initiatives in the recent window; the complete collection is refreshed weekly",
  },
  "sil-diputados": {
    label: "Chamber legislative corpus",
    owner: CHAMBER_OWNER,
    coverage:
      "Daily recent segments; all groups, types, and expired or non-expired segments weekly; details and history in enrichment mode",
  },
  "sil-movements": {
    label: "Official Chamber bill history",
    owner: CHAMBER_OWNER,
    coverage: "Status field from each row of the historicos endpoint",
  },
  "sil-movements-incremental": {
    label: "Changed Chamber bill histories",
    owner: CHAMBER_OWNER,
    coverage:
      "Complete daily index; the historicos endpoint is queried only when status or fechaUltimoCambioPrincipal changes, with a complete weekly safety scan",
  },
  "senado-sil-movements-incremental": {
    label: "Changed Senate bill histories",
    owner: SENATE_OWNER,
    coverage:
      "Complete daily index; a verified bill file is queried only when its list status changes, with a complete weekly safety scan",
  },
  "senado-sil-corpus": {
    label: "Senate legislative collection",
    owner: SENATE_OWNER,
    coverage: "Complete collection configured in the legacy SIL",
  },
  "sen-approved": {
    label: "Initiatives approved by the Senate",
    owner: SENATE_OWNER,
    coverage:
      "Complete inventory; recent PDFs daily and a full weekly scan for exact codes; the event remains undated when the flattened table does not support exact attribution",
  },
  "sen-expired": {
    label: "Expired Senate initiatives",
    owner: SENATE_OWNER,
    coverage:
      "Complete inventory; recent PDFs daily and a full weekly scan; a date is recorded only when the PDF literally states “Expired on”",
  },
  "sen-votes": {
    label: "Senate electronic votes",
    owner: SENATE_OWNER,
    coverage:
      "Document inventory and the literal empty-state message published by the official page",
  },
  "sen-attendance": {
    label: "Senate committee attendance",
    owner: SENATE_OWNER,
    coverage:
      "Complete inventory; meeting dates from recent PDFs daily and a full weekly scan; does not infer individual attendance",
  },
  "sen-reports": {
    label: "Senate committee reports",
    owner: SENATE_OWNER,
    coverage: "Complete report inventory; partial references from recent PDFs remain unlinked",
  },
  "sil-documents": {
    label: "Bill document metadata",
    owner: CHAMBER_OWNER,
    coverage:
      "Initiatives missing a deposited PDF three times daily by exact official id; full daily, weekly, and manual recovery scans",
  },
  "document-pdf-byte-verification": {
    label: "Deposited PDF availability",
    owner: "Oculis",
    coverage:
      "Binary verification after metadata discovery; preserves per-document failures and retries regardless of filing date",
  },
  "roster-diputados": {
    label: "Deputies and committees",
    owner: CHAMBER_OWNER,
    coverage: "Elected roster, individual profiles, and literal committee membership and roles",
  },
  "roster-senado": {
    label: "Senators and committees",
    owner: SENATE_OWNER,
    coverage: "32 province profiles and exact committee membership",
  },
  "reg-mispas": {
    label: "Regulatory documents · MISPAS",
    owner: "MISPAS",
    coverage: "Official technical standards and regulations in the Transparency portal",
  },
  "reg-proconsumidor": regulatoryPresentation("PROCONSUMIDOR"),
  "reg-indotel": regulatoryPresentation("INDOTEL"),
  "reg-indocal": regulatoryPresentation("INDOCAL"),
  "reg-micm": regulatoryPresentation("MICM"),
  "reg-intrant": regulatoryPresentation("INTRANT"),
  "feed-senado": {
    label: "Official Senate news",
    owner: SENATE_OWNER,
    coverage: "Items selected by the source section or query, without local classification",
  },
  "feed-diputados": {
    label: "Official Chamber news",
    owner: CHAMBER_OWNER,
    coverage: "Items selected by the source section or query, without local classification",
  },
  "feed-diariolibre": {
    label: "Diario Libre Politics section",
    owner: "Diario Libre",
    coverage: "Items selected by the source section or query, without local classification",
  },
  "feed-prensa": {
    label: "Congress press search",
    owner: "Google News",
    coverage: "Items selected by the source section or query, without local classification",
  },
  "feed-x": {
    label: "Posts from verified institutional accounts",
    owner: "X",
    coverage: "Only accounts with official evidence and only when API credentials are available",
  },
  "feed-legislative": {
    label: "Factual legislative signals",
    owner: "Oculis",
    coverage: "Representation of stored filings, activity, and status events",
  },
  "activity-link-backfill": {
    label: "Activity-to-bill links",
    owner: "Oculis",
    coverage: "Internal links created only from exact official codes",
  },
  "gap-dip-approved": gapPresentation(
    "Initiatives approved by the Chamber",
    CHAMBER_OWNER,
    "The official page currently contains two old PDFs described as prioritized initiatives (2016 and 2017), not a validated record of approved initiatives. Oculis does not treat prioritization as approval.",
  ),
  "gap-dip-minutes": gapPresentation("Chamber sitting minutes", CHAMBER_OWNER),
  "gap-dip-debates": gapPresentation("Chamber debates", CHAMBER_OWNER),
  "gap-dip-attendance": gapPresentation("Chamber sitting attendance", CHAMBER_OWNER),
  "gap-sen-minutes": gapPresentation("Senate sitting minutes", SENATE_OWNER),
};

function regulatoryPresentation(owner: string): EnglishSourcePresentation {
  return {
    label: `Regulatory documents · ${owner}`,
    owner,
    coverage: "Published documents and official consultation sections; no derived status",
  };
}

function gapPresentation(
  label: string,
  owner: string,
  gapReason = "An institutional portal is confirmed; the specific URL, parser, and scheduled run have not yet been validated.",
): EnglishSourcePresentation {
  return { label, owner, coverage: label, gapReason };
}

const FEED_SOURCE_LABELS: Record<string, { es: string; en: string }> = {
  "feed-senado": { es: "Senado (oficial)", en: "Senate (official)" },
  "feed-diputados": { es: "Diputados (oficial)", en: "Chamber (official)" },
  "feed-diariolibre": { es: "Diario Libre", en: "Diario Libre" },
  "feed-prensa": { es: "Prensa (Google News)", en: "Press (Google News)" },
  "feed-x": { es: "Redes (X)", en: "Social media (X)" },
  "feed-legislative": { es: "Señales legislativas", en: "Legislative signals" },
  "feed-listin": { es: "Listín Diario", en: "Listín Diario" },
  "feed-acento": { es: "Acento", en: "Acento" },
  "feed-elnacional": { es: "El Nacional", en: "El Nacional" },
  "feed-hoy": { es: "Hoy", en: "Hoy" },
  "feed-elcaribe": { es: "El Caribe", en: "El Caribe" },
};

const INITIATIVE_SOURCE_LABELS: Record<string, { es: string; en: string }> = {
  "sil-diputados": {
    es: "Cámara de Diputados · SIL",
    en: "Chamber of Deputies · SIL",
  },
  "senado-sil": {
    es: "Senado de la República · SIL",
    en: "Senate of the Republic · SIL",
  },
};

export function initiativeSourceLabel(source: string, lang: Lang): string {
  return INITIATIVE_SOURCE_LABELS[source]?.[lang] ?? source;
}

export function feedSourceLabel(source: string, lang: Lang, fallback?: string): string {
  return FEED_SOURCE_LABELS[source]?.[lang] ?? fallback ?? source;
}

export function sourceRegistryPresentation(
  source: SourceRegistryPresentationInput,
  lang: Lang,
): SourceRegistryPresentation {
  if (lang === "es") {
    return {
      label: source.label,
      owner: source.owner,
      coverage: source.coverage,
      gapReason: source.gapReason,
    };
  }

  const translated = ENGLISH_SOURCE_PRESENTATIONS[source.id];
  return translated
    ? { ...translated, gapReason: translated.gapReason ?? source.gapReason }
    : {
        label: source.label,
        owner: source.owner,
        coverage: source.coverage,
        gapReason: source.gapReason,
      };
}
