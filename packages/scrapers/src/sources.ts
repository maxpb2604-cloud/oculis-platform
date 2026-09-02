/** Static, factual registry of ingestion processes and acknowledged coverage gaps. */
export type SourceRegistryStatus = "ACTIVE" | "KNOWN_GAP";
export type SourceCadence =
  | "THREE_TIMES_DAILY"
  | "DAILY"
  | "WEEKLY"
  | "BOOTSTRAP"
  | "MANUAL"
  | "NOT_SCHEDULED";

interface SourceRegistryBase {
  /** Process id stored in ingestion_runs, or a stable id for a known missing source. */
  id: string;
  label: string;
  owner: string;
  chamber: "DIPUTADOS" | "SENADO" | "BOTH" | null;
  coverage: string;
  officialUrl: string | null;
  cadence: SourceCadence;
  /** Whether a missed scheduled run should be treated as an operational failure. */
  required: boolean;
}

export type SourceRegistryEntry =
  | (SourceRegistryBase & { status: "ACTIVE"; gapReason?: never })
  | (SourceRegistryBase & { status: "KNOWN_GAP"; gapReason: string });

export const SOURCE_REGISTRY: readonly SourceRegistryEntry[] = [
  {
    id: "sil-actividad",
    label: "Agenda de comisiones de la Cámara",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage: "Reuniones estructuradas del SIL y PDF diario oficial de comisiones",
    officialUrl: "https://camaradediputados.gob.do/agenda-comisiones/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "dip-oficial",
    label: "Orden del día del Pleno",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage: "PDF de orden del día, códigos y menciones procedimentales literales",
    officialUrl: "https://camaradediputados.gob.do/ordenes-del-dia-del-pleno/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "dip-known-agenda",
    label: "Orden del día conocida por el Pleno",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage:
      "Inventario completo por sesión; PDF recientes a diario y barrido total semanal para códigos exactos; no crea estados legislativos",
    officialUrl: "https://camaradediputados.gob.do/orden-del-dia-conocida-por-el-pleno/",
    cadence: "DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "senado",
    label: "Agendas del Senado",
    owner: "Senado de la República",
    chamber: "SENADO",
    coverage: "Órdenes del Pleno/Asamblea y agenda semanal de comisiones",
    officialUrl: "https://www.senadord.gob.do/secretaria-general-legislativa/orden-del-dia/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "sil-deposits",
    label: "Depósitos de la Cámara",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage: "Depósitos recientes, proponente principal explícito y metadatos documentales",
    officialUrl: "https://www.diputadosrd.gob.do/sil/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "senado-sil-deposits",
    label: "Depósitos recientes del Senado",
    owner: "Senado de la República",
    chamber: "SENADO",
    coverage: "Filas fechadas de la colección legislativa configurada",
    officialUrl:
      "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "senado-sil-fichas",
    label: "Fichas e historiales recientes del Senado",
    owner: "Senado de la República",
    chamber: "SENADO",
    coverage:
      "Detalle e historial oficial de las iniciativas de la ventana reciente; colección completa actualizada semanalmente",
    officialUrl:
      "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "sil-diputados",
    label: "Corpus legislativo de la Cámara",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage:
      "Segmentos recientes a diario; todos los grupos, tipos y segmentos perimidos/no perimidos semanalmente; detalle e historial en modo enriquecido",
    officialUrl: "https://www.diputadosrd.gob.do/sil/",
    cadence: "DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "sil-movements",
    label: "Historial oficial de PDL de la Cámara",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage: "Campo estado de cada fila del endpoint historicos",
    officialUrl: "https://www.diputadosrd.gob.do/sil/",
    cadence: "WEEKLY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "sil-movements-incremental",
    label: "Historiales cambiados de la Cámara",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage:
      "Índice completo tres veces al día; consulta historicos solo cuando estado/fechaUltimoCambioPrincipal cambia; barrido total semanal de respaldo",
    officialUrl: "https://www.diputadosrd.gob.do/sil/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "senado-sil-movements-incremental",
    label: "Historiales cambiados del Senado",
    owner: "Senado de la República",
    chamber: "SENADO",
    coverage:
      "Índice completo tres veces al día; consulta Ficha verificada solo cuando el estado de lista cambia; barrido total semanal de respaldo",
    officialUrl:
      "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "senado-sil-corpus",
    label: "Colección legislativa del Senado",
    owner: "Senado de la República",
    chamber: "SENADO",
    coverage: "Colección completa configurada en el SIL legado",
    officialUrl:
      "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
    cadence: "WEEKLY",
    required: true,
    status: "ACTIVE",
  },
  ...[
    [
      "sen-approved",
      "Iniciativas aprobadas por el Senado",
      "Inventario completo; PDF recientes a diario y barrido total semanal para códigos exactos; el evento queda sin fecha cuando la tabla aplanada no permite atribuirla",
      "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-aprobadas/",
    ],
    [
      "sen-expired",
      "Proyectos perimidos del Senado",
      "Inventario completo; PDF recientes a diario y barrido total semanal; fecha únicamente cuando el PDF dice literalmente «Perimida el»",
      "https://www.senadord.gob.do/secretaria-general-legislativa/proyectos-perimidos/",
    ],
    [
      "sen-votes",
      "Votaciones electrónicas del Senado",
      "Inventario documental y mensaje vacío literal publicado por la página oficial",
      "https://www.senadord.gob.do/elaboracion-de-actas/votaciones-electronicas/",
    ],
    [
      "sen-attendance",
      "Asistencia a comisiones del Senado",
      "Inventario completo; fechas «Fecha Reunión» de PDF recientes a diario y barrido total semanal; no deduce asistencia individual",
      "https://www.senadord.gob.do/comisiones/asistencia-a-comisiones/",
    ],
    [
      "sen-reports",
      "Informes de comisión del Senado",
      "Inventario completo de informes; referencias parciales de PDF recientes permanecen sin enlace",
      "https://www.senadord.gob.do/comisiones/informes-para-lectura/",
    ],
  ].map(
    ([id, label, coverage, officialUrl]): SourceRegistryEntry => ({
      id: id!,
      label: label!,
      owner: "Senado de la República",
      chamber: "SENADO",
      coverage: coverage!,
      officialUrl: officialUrl!,
      cadence: "DAILY",
      required: true,
      status: "ACTIVE",
    }),
  ),
  {
    id: "sil-documents",
    label: "Metadatos de documentos de PDL",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage:
      "Iniciativas sin PDF depositado tres veces al día por id oficial exacto; barrido completo diario, semanal y en recuperación manual",
    officialUrl: "https://www.diputadosrd.gob.do/sil/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "document-pdf-byte-verification",
    label: "Disponibilidad de PDF depositado",
    owner: "Oculis",
    chamber: "DIPUTADOS",
    coverage:
      "Verificación binaria posterior al descubrimiento de metadatos; conserva fallos por documento y reintenta sin depender de la fecha de depósito",
    officialUrl: "https://www.diputadosrd.gob.do/sil/",
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "roster-diputados",
    label: "Diputados y comisiones",
    owner: "Cámara de Diputados",
    chamber: "DIPUTADOS",
    coverage: "Roster electo, ficha individual y membresía/cargo literal de comisiones",
    officialUrl: "https://www.diputadosrd.gob.do/sil/legisladores",
    cadence: "WEEKLY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "roster-senado",
    label: "Senadores y comisiones",
    owner: "Senado de la República",
    chamber: "SENADO",
    coverage: "32 fichas provinciales y membresía exacta de comisiones",
    officialUrl: "https://www.senadord.gob.do/senadores-2024-2028/",
    cadence: "WEEKLY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "reg-mispas",
    label: "Documentos regulatorios · MISPAS",
    owner: "MISPAS",
    chamber: null,
    coverage: "Catálogo oficial de normas y reglamentos técnicos en el portal de Transparencia",
    officialUrl: "https://www.msp.gob.do/web/Transparencia/base-legal-otras-normativas/",
    cadence: "DAILY",
    required: true,
    status: "ACTIVE",
  },
  ...[
    ["reg-proconsumidor", "PROCONSUMIDOR", "https://proconsumidor.gob.do/consultas-publicas/"],
    ["reg-indotel", "INDOTEL", "https://indotel.gob.do/transparencia/documentos/consulta-publica/"],
    ["reg-indocal", "INDOCAL", "https://indocal.gob.do/"],
    [
      "reg-micm",
      "MICM",
      "https://micm.gob.do/transparencia/consultas-publicas-transparencia/proceso-de-consultas-abiertas",
    ],
    ["reg-intrant", "INTRANT", "https://intrant.gob.do/transparencia/"],
  ].map(
    ([id, owner, officialUrl]): SourceRegistryEntry => ({
      id: id!,
      label: `Documentos regulatorios · ${owner}`,
      owner: owner!,
      chamber: null,
      coverage: "Documentos publicados y secciones oficiales de consulta; sin estado derivado",
      officialUrl: officialUrl!,
      cadence: "DAILY",
      required: true,
      status: "ACTIVE",
    }),
  ),
  ...[
    [
      "feed-senado",
      "Noticias oficiales del Senado",
      "Senado de la República",
      "https://www.senadord.gob.do/category/noticias/",
    ],
    [
      "feed-diputados",
      "Noticias oficiales de la Cámara",
      "Cámara de Diputados",
      "https://camaradediputados.gob.do/",
    ],
    [
      "feed-diariolibre",
      "Sección Política de Diario Libre",
      "Diario Libre",
      "https://www.diariolibre.com/actualidad/politica",
    ],
    ["feed-prensa", "Consulta de prensa sobre Congreso", "Google News", null],
  ].map(
    ([id, label, owner, officialUrl]): SourceRegistryEntry => ({
      id: id!,
      label: label!,
      owner: owner!,
      chamber: id === "feed-senado" ? "SENADO" : id === "feed-diputados" ? "DIPUTADOS" : null,
      coverage:
        "Ítems seleccionados por la sección o consulta de la fuente, sin clasificador local",
      officialUrl: officialUrl!,
      cadence: "THREE_TIMES_DAILY",
      required: id === "feed-senado" || id === "feed-diputados",
      status: "ACTIVE",
    }),
  ),
  {
    id: "feed-x",
    label: "Publicaciones de cuentas institucionales verificadas",
    owner: "X",
    chamber: "BOTH",
    coverage: "Solo cuentas con evidencia oficial y solo cuando existe credencial API",
    officialUrl: null,
    cadence: "THREE_TIMES_DAILY",
    required: false,
    status: "ACTIVE",
  },
  {
    id: "feed-legislative",
    label: "Señales legislativas factuales",
    owner: "Oculis",
    chamber: "BOTH",
    coverage: "Representación de depósitos, actividad y eventos de estado ya almacenados",
    officialUrl: null,
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  {
    id: "activity-link-backfill",
    label: "Enlace actividad↔PDL",
    owner: "Oculis",
    chamber: "BOTH",
    coverage: "Enlace interno solo por código oficial exacto",
    officialUrl: null,
    cadence: "THREE_TIMES_DAILY",
    required: true,
    status: "ACTIVE",
  },
  ...[
    [
      "gap-dip-approved",
      "Iniciativas aprobadas por la Cámara",
      "Cámara de Diputados",
      "DIPUTADOS",
      "https://camaradediputados.gob.do/iniciativas-aprobadas/",
      "PRIORITIZED_ONLY",
    ],
    [
      "gap-dip-minutes",
      "Actas de sesiones de la Cámara",
      "Cámara de Diputados",
      "DIPUTADOS",
      "https://camaradediputados.gob.do/",
      false,
    ],
    [
      "gap-dip-debates",
      "Debates de la Cámara",
      "Cámara de Diputados",
      "DIPUTADOS",
      "https://camaradediputados.gob.do/",
      false,
    ],
    [
      "gap-dip-attendance",
      "Asistencia a sesiones de la Cámara",
      "Cámara de Diputados",
      "DIPUTADOS",
      "https://camaradediputados.gob.do/",
      false,
    ],
    [
      "gap-sen-minutes",
      "Actas de sesiones del Senado",
      "Senado de la República",
      "SENADO",
      "https://www.senadord.gob.do/",
      false,
    ],
  ].map(
    ([id, label, owner, chamber, officialUrl, sourceEvidence]): SourceRegistryEntry => ({
      id: String(id),
      label: String(label),
      owner: String(owner),
      chamber: chamber as "DIPUTADOS" | "SENADO",
      coverage: String(label),
      officialUrl: String(officialUrl),
      cadence: "NOT_SCHEDULED",
      required: false,
      status: "KNOWN_GAP",
      gapReason:
        sourceEvidence === "PRIORITIZED_ONLY"
          ? "La página oficial actualmente contiene dos PDF antiguos titulados como iniciativas priorizadas (2016 y 2017), no un registro validado de iniciativas aprobadas. Oculis no convierte priorización en aprobación."
          : sourceEvidence === true
            ? "URL específica oficial confirmada; aún no existe un parser validado ni una ejecución programada."
            : "Portal institucional confirmado; la URL específica, el parser y la ejecución programada aún no están validados.",
    }),
  ),
] as const;

export function sourceRegistryEntry(id: string): SourceRegistryEntry | null {
  return SOURCE_REGISTRY.find((entry) => entry.id === id) ?? null;
}
