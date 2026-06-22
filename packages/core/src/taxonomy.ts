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

/**
 * Canonical lifecycle stages used to order and color any status across sources.
 * The free-text status labels from SIL history and the agenda PDFs are mapped onto
 * these by `normalizeStatus`, so the dashboard can sort, group, and explain them.
 */
export const LIFECYCLE_STAGES = [
  "DEPOSITO", // filed
  "COMISION", // in committee
  "AGENDA", // scheduled / on the order of the day
  "DEBATE", // under floor discussion (readings)
  "APROBACION", // approved in a chamber
  "EJECUTIVO", // with the Executive (observed / enacted)
  "CERRADO", // rejected / withdrawn / expired
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface StatusMeta {
  /** Canonical lifecycle stage. */
  stage: LifecycleStage;
  /** Short human label (Spanish) for chips. */
  label: string;
  /** One-line plain-Spanish explanation (dashboard tooltip). */
  tooltip: string;
}

/**
 * Ordered regex rules: raw status text (from SIL `historicos.estado`, agenda PDFs,
 * Senate orden-del-día) → canonical meaning. First match wins, so put the more
 * specific patterns (e.g. "aprobado en segunda lectura") before generic ones.
 */
const STATUS_RULES: Array<[RegExp, StatusMeta]> = [
  [/perimid|perenci/i, { stage: "CERRADO", label: "Perimido", tooltip: "Expiró por perención: no se actuó dentro del plazo legal." }],
  [/rechazad/i, { stage: "CERRADO", label: "Rechazado", tooltip: "La iniciativa fue rechazada." }],
  [/retirad/i, { stage: "CERRADO", label: "Retirado", tooltip: "El proponente retiró la iniciativa." }],
  [/promulgad/i, { stage: "EJECUTIVO", label: "Promulgado", tooltip: "Promulgada por el Poder Ejecutivo: ya es ley." }],
  [/observ/i, { stage: "EJECUTIVO", label: "Observado", tooltip: "Observada (vetada) por el Poder Ejecutivo; vuelve al Congreso." }],
  [/segunda lectura|2da\.? lectura|2a\.? lectura/i, { stage: "APROBACION", label: "Aprobado 2da lectura", tooltip: "Aprobado en segunda lectura: paso final de aprobación en la cámara." }],
  [/primera lectura|1ra\.? lectura|1a\.? lectura/i, { stage: "DEBATE", label: "Aprobado 1ra lectura", tooltip: "Aprobado en primera lectura: falta la segunda para completar la cámara." }],
  [/única lectura|unica lectura|única discusi|unica discusi/i, { stage: "APROBACION", label: "Aprobado única lectura", tooltip: "Aprobado en lectura/discusión única." }],
  [/aprobad|sancionad/i, { stage: "APROBACION", label: "Aprobado", tooltip: "Aprobado por la cámara." }],
  [/despachad/i, { stage: "APROBACION", label: "Despachado", tooltip: "Despachado por la cámara hacia el siguiente trámite." }],
  [/declarad[ao] de urgencia/i, { stage: "DEBATE", label: "Declarado de urgencia", tooltip: "Declarado de urgencia: se discute de forma expedita." }],
  [/tomad[ao] en consideraci/i, { stage: "DEBATE", label: "Tomado en consideración", tooltip: "El pleno acordó tomarla en consideración (la admite a trámite)." }],
  [/sobre la mesa/i, { stage: "AGENDA", label: "Sobre la mesa", tooltip: "Colocada sobre la mesa del pleno, pendiente de conocer." }],
  [/orden del d[ií]a/i, { stage: "AGENDA", label: "En orden del día", tooltip: "Incluida en el orden del día de una sesión." }],
  [/informe de comisi|con informe/i, { stage: "COMISION", label: "Con informe de comisión", tooltip: "La comisión rindió su informe sobre la iniciativa." }],
  [/liberad[ao] de comisi/i, { stage: "COMISION", label: "Liberado de comisión", tooltip: "Liberada de comisión sin informe, pasa al pleno." }],
  [/enviad[ao] a comisi|en comisi|estudio.*comisi/i, { stage: "COMISION", label: "En comisión", tooltip: "Enviada a comisión para su estudio." }],
  [/recibid[ao].*c[aá]mara|en c[aá]mara revisora/i, { stage: "COMISION", label: "Recibido otra cámara", tooltip: "Recibida en la cámara revisora para su segundo trámite." }],
  [/depositad|recibid/i, { stage: "DEPOSITO", label: "Depositado", tooltip: "Depositada formalmente en la secretaría de la cámara." }],
  [/borrador/i, { stage: "DEPOSITO", label: "Borrador", tooltip: "Borrador, aún no depositado formalmente." }],
];

const FALLBACK_STATUS: StatusMeta = {
  stage: "DEPOSITO",
  label: "Otro",
  tooltip: "Estado no clasificado; ver la fuente oficial.",
};

/** Map any raw status string to its canonical stage + label + tooltip. */
export function normalizeStatus(raw: string | null | undefined): StatusMeta {
  const text = (raw ?? "").trim();
  if (!text) return FALLBACK_STATUS;
  for (const [re, meta] of STATUS_RULES) if (re.test(text)) return meta;
  return { ...FALLBACK_STATUS, label: text.slice(0, 40) };
}

/** Display order + color hint per lifecycle stage (for the dashboard). */
export const STAGE_META: Record<LifecycleStage, { order: number; label: string; color: string }> = {
  DEPOSITO: { order: 1, label: "Depósito", color: "slate" },
  COMISION: { order: 2, label: "En comisión", color: "blue" },
  AGENDA: { order: 3, label: "En agenda", color: "violet" },
  DEBATE: { order: 4, label: "En debate", color: "amber" },
  APROBACION: { order: 5, label: "Aprobación", color: "green" },
  EJECUTIVO: { order: 6, label: "Poder Ejecutivo", color: "teal" },
  CERRADO: { order: 7, label: "Cerrado", color: "rose" },
};

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
