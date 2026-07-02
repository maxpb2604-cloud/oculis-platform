/** Minimal bilingual dictionary (ES default, EN alternate) — Wish List requirement. */
export type Lang = "es" | "en";

export const dict: Record<Lang, Record<string, string>> = {
  es: {
    appName: "Oculis Auribus",
    tagline: "Seguimiento Experto de Legislación y Regulaciones",
    legislative: "Monitoreo Legislativo",
    regulatory: "Monitoreo Regulatorio",
    totalBills: "Iniciativas Totales",
    highRisk: "Riesgo Alto",
    highApproval: "Prob. de Aprobación ALTA",
    needsReview: "Por Revisar",
    published: "Publicadas",
    byRisk: "Iniciativas por Nivel de Riesgo",
    byApproval: "Probabilidad de Aprobación",
    byCategory: "Iniciativas por Categoría",
    byStatus: "Iniciativas por Estado",
    byProvince: "Iniciativas por Provincia",
    recent: "Iniciativas Recientes",
    code: "Código",
    title: "Iniciativa",
    category: "Categoría",
    status: "Estado",
    risk: "Riesgo",
    approval: "Prob. aprobación",
    sponsor: "Proponente",
    province: "Provincia",
    noData: "Aún no hay datos. Ejecute la ingesta para poblar la plataforma.",
    source: "Congreso Nacional (SIL)",

    // Scope labels (Pleno / Asamblea / Comisión)
    scopePLENARY: "Pleno",
    scopeASAMBLEA: "Asamblea",
    scopeCOMMITTEE: "Comisión",

    // Monitoring building blocks
    viewDocument: "Ver documento ↗",
    openDocument: "Abrir documento ↗",
    filedBy: "Depositada por",
    coSponsors: "proponente",
    coSponsorsPlural: "proponentes",
    initiative: "iniciativa",
    initiativePlural: "iniciativas",
    docFiled: "Documento depositado",
    docPending: "Documento pendiente",
    docSenate: "Documento: consultar en el portal del Senado",
    openSenateRecord: "Abrir expediente en el Senado ↗",
    viewSilRecord: "Ver ficha en SIL ↗",
    publicConsultation: "CONSULTA PÚBLICA",
    deadline: "Plazo",
    intervHigh: "Alta posibilidad de intervención",
    intervHighShort: "Intervención ALTA",
    intervMid: "Posibilidad intermedia",
    intervMidShort: "Intervención MEDIA",
    intervLow: "Baja posibilidad (ya publicado)",
    intervLowShort: "Intervención BAJA",

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
    mapAriaLabel: "Mapa de iniciativas por provincia. Cada círculo representa una provincia; su tamaño es proporcional al número de iniciativas. Use el panel lateral para ver los legisladores.",

    // Charts
    total: "Total",

    // Approval tag
    approvalTag: "Prob. aprobación",

    // Risk / approval pill values (raw DB enums → display)
    riskALTO: "ALTO",
    riskMEDIO: "MEDIO",
    riskBAJO: "BAJO",
    approvalALTA: "ALTA",
    approvalMEDIA: "MEDIA",
    approvalBAJA: "BAJA",
  },
  en: {
    appName: "Oculis Auribus",
    tagline: "Expert Monitoring of Legislation & Regulations",
    legislative: "Legislative Monitoring",
    regulatory: "Regulatory Monitoring",
    totalBills: "Total Initiatives",
    highRisk: "High Risk",
    highApproval: "HIGH Approval Probability",
    needsReview: "Needs Review",
    published: "Published",
    byRisk: "Initiatives by Business Risk",
    byApproval: "Probability of Approval",
    byCategory: "Initiatives by Category",
    byStatus: "Initiatives by Status",
    byProvince: "Initiatives by Province",
    recent: "Recent Initiatives",
    code: "Code",
    title: "Initiative",
    category: "Category",
    status: "Status",
    risk: "Risk",
    approval: "Approval prob.",
    sponsor: "Sponsor",
    province: "Province",
    noData: "No data yet. Run the ingestion to populate the platform.",
    source: "National Congress (SIL)",

    // Scope labels (Floor / Assembly / Committee)
    scopePLENARY: "Floor",
    scopeASAMBLEA: "Assembly",
    scopeCOMMITTEE: "Committee",

    // Monitoring building blocks
    viewDocument: "View document ↗",
    openDocument: "Open document ↗",
    filedBy: "Filed by",
    coSponsors: "co-sponsor",
    coSponsorsPlural: "co-sponsors",
    initiative: "initiative",
    initiativePlural: "initiatives",
    docFiled: "Document filed",
    docPending: "Document pending",
    docSenate: "Document: consult the Senate portal",
    openSenateRecord: "Open Senate record ↗",
    viewSilRecord: "View SIL record ↗",
    publicConsultation: "PUBLIC CONSULTATION",
    deadline: "Deadline",
    intervHigh: "High possibility of intervention",
    intervHighShort: "Intervention HIGH",
    intervMid: "Intermediate possibility",
    intervMidShort: "Intervention MEDIUM",
    intervLow: "Low possibility (already published)",
    intervLowShort: "Intervention LOW",

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
    mapAriaLabel: "Map of initiatives by province. Each circle represents a province; its size is proportional to the number of initiatives. Use the side panel to view legislators.",

    // Charts
    total: "Total",

    // Approval tag
    approvalTag: "Approval prob.",

    // Risk / approval pill values (raw DB enums → display)
    riskALTO: "HIGH",
    riskMEDIO: "MEDIUM",
    riskBAJO: "LOW",
    approvalALTA: "HIGH",
    approvalMEDIA: "MEDIUM",
    approvalBAJA: "LOW",
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
