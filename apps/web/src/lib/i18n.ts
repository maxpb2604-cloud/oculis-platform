/** Minimal bilingual dictionary (ES default, EN alternate) — Wish List requirement. */
export type Lang = "es" | "en";

/** Internal request header set by middleware so the root layout can render the right HTML lang. */
export const LANG_REQUEST_HEADER = "x-oculis-lang";

/**
 * Resolve the only two supported interface languages. The URL query is canonical:
 * exact `lang=en` selects English and every other value falls back to Spanish.
 */
export function parseLang(value: unknown): Lang {
  return value === "en" ? "en" : "es";
}

export const dict: Record<Lang, Record<string, string>> = {
  es: {
    appName: "Oculis Auribus",
    tagline: "Seguimiento experto de legislación y regulaciones",
    legislative: "Monitoreo legislativo",
    regulatory: "Monitoreo regulatorio",
    totalBills: "Iniciativas totales",
    published: "Con archivo registrado",
    byStatus: "Iniciativas por estado",
    byProvince: "Iniciativas por provincia",
    recent: "Iniciativas recientes",
    code: "Código",
    title: "Iniciativa",
    status: "Estado",
    sponsor: "Proponente",
    province: "Provincia",
    noData: "Aún no hay datos. Ejecute la ingesta para poblar la plataforma.",
    source: "Cámara de Diputados (SIL)",

    // Scope labels (Pleno / Asamblea / Comisión)
    scopePLENARY: "Pleno",
    scopeASAMBLEA: "Asamblea",
    scopeCOMMITTEE: "Comisión",

    // Monitoring building blocks
    viewDocument: "Ver documento",
    openDocument: "Abrir documento",
    filedBy: "Depositada por",
    coSponsors: "proponente",
    coSponsorsPlural: "proponentes",
    initiative: "iniciativa",
    initiativePlural: "iniciativas",
    docFiled: "Archivo registrado por la fuente",
    docPending: "Archivo oficial: No registrado",
    docSenate: "Documento oficial: consultar fuente",
    openSenateRecord: "Abrir ficha del Senado",
    viewSilRecord: "Ver ficha en SIL",
    publicConsultation: "CONSULTA PÚBLICA",
    deadline: "Plazo",

    // Map (province bubble map)
    mapLess: "Menos",
    mapMore: "Más",
    close: "Cerrar",
    senators: "Senadores",
    deputies: "Diputados",
    noSenator: "Sin senador registrado para esta provincia.",
    noDeputies: "Sin diputados registrados para esta provincia.",
    mapMissingToken: "Falta NEXT_PUBLIC_MAPBOX_TOKEN",
    mapError: "Error de Mapbox",
    mapAriaLabel:
      "Mapa de iniciativas por provincia. Cada círculo representa una provincia; su tamaño es proporcional al número de iniciativas. Use el panel lateral para ver los legisladores.",

    // Charts
    total: "Total",
  },
  en: {
    appName: "Oculis Auribus",
    tagline: "Expert Monitoring of Legislation & Regulations",
    legislative: "Legislative Monitoring",
    regulatory: "Regulatory Monitoring",
    totalBills: "Total Initiatives",
    published: "With registered file",
    byStatus: "Initiatives by Status",
    byProvince: "Initiatives by Province",
    recent: "Recent Initiatives",
    code: "Code",
    title: "Initiative",
    status: "Status",
    sponsor: "Sponsor",
    province: "Province",
    noData: "No data yet. Run the ingestion to populate the platform.",
    source: "Chamber of Deputies (SIL)",

    // Scope labels (Floor / Assembly / Committee)
    scopePLENARY: "Floor",
    scopeASAMBLEA: "Assembly",
    scopeCOMMITTEE: "Committee",

    // Monitoring building blocks
    viewDocument: "View document",
    openDocument: "Open document",
    filedBy: "Filed by",
    coSponsors: "co-sponsor",
    coSponsorsPlural: "co-sponsors",
    initiative: "initiative",
    initiativePlural: "initiatives",
    docFiled: "File registered by source",
    docPending: "Official file: Not registered",
    docSenate: "Official document: consult source",
    openSenateRecord: "Open Senate record",
    viewSilRecord: "View SIL record",
    publicConsultation: "PUBLIC CONSULTATION",
    deadline: "Deadline",

    // Map (province bubble map)
    mapLess: "Fewer",
    mapMore: "More",
    close: "Close",
    senators: "Senators",
    deputies: "Deputies",
    noSenator: "No senator on record for this province.",
    noDeputies: "No deputies on record for this province.",
    mapMissingToken: "Missing NEXT_PUBLIC_MAPBOX_TOKEN",
    mapError: "Mapbox error",
    mapAriaLabel:
      "Map of initiatives by province. Each circle represents a province; its size is proportional to the number of initiatives. Use the side panel to view legislators.",

    // Charts
    total: "Total",
  },
};

export type Dict = Record<string, string>;

/** Dictionary getter. Falls back to the key itself if missing (so nothing renders blank). */
export function t(lang: Lang, key: string): string {
  return dict[lang][key] ?? dict.es[key] ?? key;
}

/**
 * Canonical "?lang=" suffix for a URL with no existing query string.
 * Returns "" for Spanish (the default) and "?lang=en" for English.
 * Centralizes the `?lang=` reconstruction duplicated across the app.
 */
export function langQuery(lang: Lang): string {
  return lang === "en" ? "?lang=en" : "";
}

/** Same as `langQuery` but as a parameter to append to an existing query string ("&lang=en"). */
export function langParam(lang: Lang): string {
  return lang === "en" ? "&lang=en" : "";
}

/**
 * Switch language without losing filters, dates, pagination, or any other URL state.
 * Spanish is the canonical default and therefore omits the `lang` query parameter.
 */
export function languageSwitchHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, "toString">,
  target: Lang,
): string {
  const params = new URLSearchParams(searchParams.toString());
  if (target === "en") params.set("lang", "en");
  else params.delete("lang");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
