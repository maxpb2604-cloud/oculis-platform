/**
 * Categorization taxonomy, status vocabularies, and source institutions.
 *
 * Derived from the live dashboard manuals, the web registration form's topic
 * list, and the two monitoring workbooks.
 */

/**
 * Topic categories shared by legislative and regulatory initiatives.
 * Superset taken from the dashboard category charts and the website's
 * multi-select interest list (`Formulario para Página Web`).
 */
export const CATEGORIES = [
  "AGRO",
  "BEBIDAS_ALCOHOLICAS",
  "ENERGIA",
  "FISCAL",
  "GOBIERNO_E_INSTITUCIONES",
  "SALUD",
  "COMERCIO_ILICITO",
  "MIGRACION",
  "INDUSTRIA_Y_COMERCIO",
  "ETIQUETADO",
  "LABORAL",
  "LEGAL",
  "MOVILIDAD",
  "ASUNTOS_MUNICIPALES",
  "PLASTICOS",
  "SEGURIDAD_PUBLICA",
  "SOSTENIBILIDAD",
  "TIC",
  "TURISMO",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Human-readable Spanish labels for UI display. */
export const CATEGORY_LABELS: Record<Category, string> = {
  AGRO: "Agro",
  BEBIDAS_ALCOHOLICAS: "Bebidas Alcohólicas",
  ENERGIA: "Energía",
  FISCAL: "Fiscal",
  GOBIERNO_E_INSTITUCIONES: "Gobierno e Instituciones",
  SALUD: "Salud",
  COMERCIO_ILICITO: "Comercio Ilícito",
  MIGRACION: "Migración",
  INDUSTRIA_Y_COMERCIO: "Industria y Comercio",
  ETIQUETADO: "Etiquetado",
  LABORAL: "Laboral",
  LEGAL: "Legal",
  MOVILIDAD: "Movilidad",
  ASUNTOS_MUNICIPALES: "Asuntos Municipales",
  PLASTICOS: "Plásticos",
  SEGURIDAD_PUBLICA: "Seguridad Pública",
  SOSTENIBILIDAD: "Sostenibilidad",
  TIC: "TIC (incl. IA)",
  TURISMO: "Turismo",
};

/** Legislative lifecycle statuses (Monitoreo Legislativo). */
export const LEGISLATIVE_STATUSES = [
  "BORRADOR", // Draft bill
  "DEPOSITADO", // Bill deposited in initiating chamber
  "EN_COMISION", // Bill on committee
  "ENVIADO", // Bill is sent to (other body)
  "EN_PLENO", // Bill on floor
  "RECIBIDO_OTRA_CAMARA", // Bill received in receiving chamber
  "APROBADO", // Approved
  "OBSERVADO", // Observed by Executive
  "PROMULGADO", // Enacted
  "RECHAZADO", // Rejected
  "PERIMIDO", // Expired (perención)
] as const;
export type LegislativeStatus = (typeof LEGISLATIVE_STATUSES)[number];

/** Regulatory lifecycle statuses (Monitoreo Regulatorio). */
export const REGULATORY_STATUSES = [
  "BORRADOR", // Draft
  "REVISION_INTERNA", // Internal review of regulatory body
  "CONSULTA_PUBLICA", // Public consultation
  "PUBLICADO", // Published / in force
  "DEROGADO", // Repealed
] as const;
export type RegulatoryStatus = (typeof REGULATORY_STATUSES)[number];

/** Regulatory instrument types (Monitoreo Regulatorio). */
export const REGULATION_TYPES = [
  "REGLAMENTO",
  "NORDOM",
  "NORMA",
  "RESOLUCION",
  "DECRETO",
  "AVISO",
] as const;
export type RegulationType = (typeof REGULATION_TYPES)[number];

/** Regulatory institutions tracked (acronym → full name). */
export const INSTITUTIONS: Record<string, string> = {
  INDOCAL: "Instituto Dominicano para la Calidad",
  DGA: "Dirección General de Aduanas",
  INTRANT: "Instituto Nacional de Tránsito y Transporte Terrestre",
  MIMARENA: "Ministerio de Medio Ambiente y Recursos Naturales",
  MISPAS: "Ministerio de Salud Pública y Asistencia Social",
  BANCO_CENTRAL: "Banco Central de la República Dominicana",
  DGII: "Dirección General de Impuestos Internos",
  PODER_EJECUTIVO: "Poder Ejecutivo",
  INDOTEL: "Instituto Dominicano de las Telecomunicaciones",
  MUNICIPALIDAD: "Municipalidad",
};
