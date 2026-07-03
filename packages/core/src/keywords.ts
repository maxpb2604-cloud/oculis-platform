/**
 * Dominican legislative keyword thesaurus + search-blob builder.
 *
 * This is the offline "semantic-ish" layer that makes bills findable by keyword
 * EVEN WHEN the word is not literally in the title — via curated domain synonyms,
 * abbreviations, and concept tags. It powers two things, deterministically and with
 * ZERO external dependencies (no API, no network):
 *
 *   1. `expandQueryTerms(query)` — given a user query, returns extra domain synonyms
 *      to OR into the Postgres full-text query (so "impuesto" also searches "ITBIS",
 *      "tributario", "DGII", …).
 *   2. `keywordBlob(row)` — given an initiative's fields, returns a normalized text
 *      blob = the fields PLUS every concept tag whose synonyms appear in the
 *      title/purpose (so a bill about "ITBIS" gets tagged "fiscal impuesto tributario",
 *      making it findable by "impuesto"). This blob feeds a generated tsvector column.
 *
 * Typo tolerance itself is handled at the DB layer by pg_trgm (word_similarity), so
 * this file focuses on synonym/abbreviation reach; only a few very common typos are
 * corrected here as a bonus. Accent-insensitivity is achieved by folding accents in
 * `normalizeText` on BOTH the stored blob and the query, so "energía"/"energia" agree.
 */

/**
 * Accent-fold + lowercase + strip punctuation to single-spaced tokens. Shared by the
 * stored blob and the query so both sides of the match are normalized identically
 * (Postgres has no `unaccent` extension installed, so we fold here).
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents (á→a, ñ→n, ü→u)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One domain concept: `match` triggers (roots + abbreviations, already in normalized
 * form) that flag the concept when present in text/query, and `tags` (natural Spanish
 * synonym words) that get injected into the blob and OR'd into the query.
 *
 * Matching rule (see `termMatches`): terms of length ≤ 4 match on WORD BOUNDARIES
 * (abbreviations like "afp", "itbis", real short words like "agua" — avoids matching
 * "agua" inside "paraguay"); longer terms match as SUBSTRINGS so a stem like "tributar"
 * catches "tributario/tributación/tributaria" and "electric" catches "eléctrica".
 */
export interface ConceptGroup {
  key: string;
  match: string[];
  tags: string[];
}

/** A handful of very common Dominican typos → canonical token (trgm handles the rest). */
export const COMMON_TYPOS: Record<string, string> = {
  inpuesto: "impuesto",
  inpuestos: "impuestos",
  impuesto: "impuesto",
  impuedto: "impuesto",
  tributaion: "tributacion",
  energina: "energia",
  energa: "energia",
  electrisidad: "electricidad",
  electricida: "electricidad",
  seguidad: "seguridad",
  segurida: "seguridad",
  educasion: "educacion",
  educacon: "educacion",
  educaion: "educacion",
  polisia: "policia",
  policía: "policia",
  aborrto: "aborto",
  pencion: "pension",
  pensiones: "pension",
  municiplio: "municipio",
  municipio: "municipio",
  ayuntamento: "ayuntamiento",
  medicina: "medicamento",
  medioambiente: "ambiente",
  transito: "transito",
  tránsito: "transito",
  migracon: "migracion",
  corupcion: "corrupcion",
  corrupcion: "corrupcion",
};

/**
 * The curated thesaurus — ~90 concept groups covering the Dominican legislative
 * domain (fiscal, seguridad social, salud, educación, energía, agua, ambiente,
 * seguridad, penal, laboral, municipal, agro, turismo, TIC, transporte, vivienda,
 * comercio, género, electoral, migración, deportes, cultura, discapacidad, adulto
 * mayor, niñez, drogas, transparencia, presupuesto, and more). Each group mixes
 * common abbreviations (ITBIS, DGII, AFP, ARS, SNS, INAPA, EDEs, INTRANT, INDOTEL,
 * MINERD, JCE, DNCD…) with natural synonyms and morphological stems.
 */
export const THESAURUS: ConceptGroup[] = [
  // --- Fiscal / tributario / aduanas / presupuesto ---
  {
    key: "fiscal",
    match: ["impuest", "tributar", "fiscal", "itbis", "isr", "isc", "impositiv", "gravamen", "gravar", "recaudac", "contribuyente", "exoneracion", "exencion", "exento", "tributacion", "hacienda", "recargo", "selectivo", "retencion", "plusvalia", "renta"],
    tags: ["fiscal", "impuesto", "tributario", "tributacion", "impositivo", "itbis", "isr", "gravamen", "recaudacion", "contribuyente", "exoneracion", "exencion", "hacienda", "renta"],
  },
  {
    key: "aduanas",
    match: ["aduan", "arancel", "dga", "importacion", "exportacion", "contrabando", "zona franca", "zonas francas", "mercancia", "comercio exterior"],
    tags: ["aduana", "arancel", "importacion", "exportacion", "zona franca", "comercio exterior", "contrabando", "dga"],
  },
  {
    key: "presupuesto",
    match: ["presupuest", "gasto publico", "deuda publica", "credito publico", "apropiacion", "endeudamiento", "camara de cuentas", "fondo especial"],
    tags: ["presupuesto", "gasto publico", "deuda publica", "apropiacion", "endeudamiento", "credito publico"],
  },
  {
    key: "fideicomiso",
    match: ["fideicomiso", "fiducia", "fiduciari"],
    tags: ["fideicomiso", "fiduciario"],
  },
  {
    key: "financiero",
    match: ["banco", "banca", "financier", "monetario", "superintendencia de bancos", "bolsa de valores", "mercado de valores", "cooperativa de ahorro", "prestamo", "tasa de interes", "fintech", "criptomoneda", "microcredito"],
    tags: ["financiero", "banca", "monetario", "cooperativa", "credito", "valores", "prestamo"],
  },
  {
    key: "seguros",
    match: ["aseguradora", "poliza", "superintendencia de seguros", "seguro de", "reaseguro"],
    tags: ["seguros", "aseguradora", "poliza"],
  },

  // --- Seguridad social / pensiones / salud ---
  {
    key: "seguridad_social",
    match: ["seguridad social", "pension", "jubilac", "afp", "sfs", "senasa", "tss", "sispen", "cotizac", "pensionad", "sipen", "sdss"],
    tags: ["seguridad social", "pension", "jubilacion", "afp", "sfs", "senasa", "tss", "cotizacion", "pensionado"],
  },
  {
    key: "ars_seguro_salud",
    match: ["ars", "seguro de salud", "seguro familiar", "sisalril", "plan basico", "regimen contributivo", "regimen subsidiado"],
    tags: ["ars", "seguro de salud", "sfs", "seguro familiar de salud", "sisalril"],
  },
  {
    key: "salud",
    match: ["salud", "sanitar", "hospital", "clinica", "medic", "enferm", "farmac", "mispas", "sns", "epidem", "vacun", "paciente", "salubr", "dispensario", "emergencia medica"],
    tags: ["salud", "sanitario", "hospital", "clinica", "medicamento", "farmacia", "mispas", "sns", "salud publica", "medico"],
  },
  {
    key: "medicamentos",
    match: ["medicament", "generico", "receta medica", "insulina", "vademecum", "promese"],
    tags: ["medicamento", "farmaco", "medicina", "promese"],
  },
  {
    key: "salud_mental",
    match: ["salud mental", "psicolog", "psiquiat", "suicidi", "adiccion"],
    tags: ["salud mental", "psicologia", "adiccion"],
  },
  {
    key: "vih_its",
    match: ["vih", "sida", "its", "enfermedades de transmision"],
    tags: ["vih", "sida", "salud"],
  },
  {
    key: "cancer",
    match: ["cancer", "oncolog", "tumor", "quimioterap"],
    tags: ["cancer", "oncologia", "salud"],
  },
  {
    key: "lactancia",
    match: ["lactancia", "leche materna", "materno infantil"],
    tags: ["lactancia", "lactancia materna", "salud"],
  },
  {
    key: "donacion_organos",
    match: ["donacion de organos", "trasplante", "donante"],
    tags: ["donacion de organos", "trasplante"],
  },

  // --- Educación ---
  {
    key: "educacion",
    match: ["educac", "escuela", "colegio", "minerd", "estudiante", "docente", "maestro", "aula", "curricul", "alfabetiz", "ensenanza", "plan educativo", "politecnic"],
    tags: ["educacion", "escuela", "minerd", "docente", "estudiante", "ensenanza", "colegio"],
  },
  {
    key: "universidad",
    match: ["universi", "uasd", "mescyt", "educacion superior", "beca", "posgrado", "academic"],
    tags: ["universidad", "educacion superior", "uasd", "mescyt", "beca"],
  },
  {
    key: "ciencia",
    match: ["ciencia", "investigacion cientifica", "innovacion", "tecnologia e innovacion"],
    tags: ["ciencia", "investigacion", "innovacion"],
  },

  // --- Niñez, juventud, familia, adulto mayor, discapacidad, género ---
  {
    key: "ninez",
    match: ["nino", "nina", "adolescent", "infancia", "conani", "menor de edad", "codigo del menor", "ninez", "trabajo infantil"],
    tags: ["ninez", "infancia", "conani", "adolescente", "menores"],
  },
  {
    key: "juventud",
    match: ["juventud", "joven", "jovenes", "ministerio de la juventud"],
    tags: ["juventud", "jovenes"],
  },
  {
    key: "familia",
    match: ["familia", "matrimonio", "divorcio", "adopcion", "union libre", "patria potestad", "pension alimentaria", "alimentos"],
    tags: ["familia", "matrimonio", "adopcion", "pension alimentaria"],
  },
  {
    key: "adulto_mayor",
    match: ["adulto mayor", "envejecient", "tercera edad", "conape", "ancian", "geriatr"],
    tags: ["adulto mayor", "envejeciente", "tercera edad", "conape"],
  },
  {
    key: "discapacidad",
    match: ["discapac", "conadis", "accesibilidad", "sordo", "ciego", "autismo", "inclusion social", "personas con discapacidad"],
    tags: ["discapacidad", "conadis", "accesibilidad", "inclusion", "personas con discapacidad"],
  },
  {
    key: "genero_mujer",
    match: ["genero", "violencia intrafamiliar", "violencia de genero", "feminicidio", "mujer", "igualdad de genero", "acoso", "ministerio de la mujer"],
    tags: ["genero", "violencia de genero", "feminicidio", "mujer", "violencia intrafamiliar", "igualdad de genero"],
  },
  {
    key: "diversidad",
    match: ["lgbt", "diversidad sexual", "orientacion sexual"],
    tags: ["diversidad", "lgbt"],
  },

  // --- Energía / agua / ambiente ---
  {
    key: "energia",
    match: ["energ", "electric", "apagon", "cdeee", "edes", "edeeste", "edenorte", "edesur", "tendido electrico", "kilovatio", "megavatio", "subestacion", "tarifa electrica", "generacion electrica", "electrificacion", "alumbrado"],
    tags: ["energia", "electricidad", "energia electrica", "ede", "apagon", "cdeee", "tarifa electrica", "electrificacion"],
  },
  {
    key: "combustibles",
    match: ["combustible", "gasolina", "gasoil", "diesel", "gas licuado", "glp", "hidrocarburo", "refidomsa", "petroleo"],
    tags: ["combustible", "gasolina", "gasoil", "glp", "hidrocarburos", "petroleo"],
  },
  {
    key: "energia_renovable",
    match: ["renovable", "energia solar", "fotovoltaic", "eolic", "biomasa", "energia limpia", "panel solar"],
    tags: ["energia renovable", "solar", "eolica", "fotovoltaica", "energia limpia"],
  },
  {
    key: "mineria",
    match: ["mineria", "minero", "extraccion minera", "barrick", "pueblo viejo", "cantera", "concesion minera"],
    tags: ["mineria", "minero", "concesion minera"],
  },
  {
    key: "agua",
    match: ["agua", "acueduct", "inapa", "caasd", "coraa", "potable", "alcantarillad", "saneamiento", "pluvial", "presa", "hidric"],
    tags: ["agua", "acueducto", "inapa", "caasd", "agua potable", "alcantarillado", "saneamiento"],
  },
  {
    key: "medio_ambiente",
    match: ["medio ambiente", "ambiental", "mimarena", "ecolog", "contaminac", "residuo", "basura", "reciclaje", "area protegida", "areas protegidas", "sostenib", "deforestac", "biodivers", "cambio climatico"],
    tags: ["medio ambiente", "ambiental", "mimarena", "sostenibilidad", "residuos", "reciclaje", "contaminacion", "areas protegidas"],
  },
  {
    key: "plasticos",
    match: ["plastico", "poliestireno", "foam", "funda plastica", "un solo uso", "desechable"],
    tags: ["plastico", "plasticos", "foam", "fundas plasticas"],
  },
  {
    key: "gestion_riesgos",
    match: ["desastre", "emergencia nacional", "defensa civil", "huracan", "terremoto", "inundacion", "gestion de riesgo", "coe"],
    tags: ["gestion de riesgos", "desastres", "emergencia", "coe", "defensa civil"],
  },

  // --- Seguridad, penal, defensa, drogas, armas ---
  {
    key: "seguridad_ciudadana",
    match: ["seguridad ciudadana", "policia", "crimen", "delincuen", "delito", "homicidio", "atraco", "robo", "patrulla", "videovigilancia", "camaras de seguridad", "911"],
    tags: ["seguridad ciudadana", "policia", "crimen", "delincuencia", "delito", "seguridad publica"],
  },
  {
    key: "armas",
    match: ["arma", "armas", "armamento", "porte de arma", "municion", "pistola", "fusil", "pirotecnic"],
    tags: ["armas", "porte de armas", "municiones", "armas de fuego"],
  },
  {
    key: "codigo_penal",
    match: ["codigo penal", "penal", "delito", "pena", "sancion penal", "tipificac", "reincidenc", "vacatio legis"],
    tags: ["codigo penal", "penal", "delito", "pena"],
  },
  {
    key: "aborto",
    match: ["aborto", "interrupcion del embarazo", "tres causales", "interrupcion voluntaria", "ive", "despenalizac", "salud reproductiva"],
    tags: ["aborto", "interrupcion del embarazo", "tres causales", "despenalizacion", "salud reproductiva"],
  },
  {
    key: "drogas",
    match: ["droga", "narcotrafic", "dncd", "estupefacient", "sustancias controladas", "cannabis", "marihuana", "lavado de activos"],
    tags: ["drogas", "narcotrafico", "dncd", "estupefacientes"],
  },
  {
    key: "defensa",
    match: ["defensa nacional", "militar", "fuerzas armadas", "ejercito", "armada", "ministerio de defensa", "seguridad nacional"],
    tags: ["defensa", "militar", "fuerzas armadas", "seguridad nacional"],
  },

  // --- Laboral / social ---
  {
    key: "laboral",
    match: ["laboral", "codigo de trabajo", "salario", "salario minimo", "cesantia", "sindicato", "empleo", "jornada", "obrero", "trabajador", "contrato de trabajo", "ministerio de trabajo", "prestaciones laborales"],
    tags: ["laboral", "trabajo", "codigo de trabajo", "salario", "salario minimo", "cesantia", "empleo", "sindicato"],
  },
  {
    key: "asistencia_social",
    match: ["asistencia social", "subsidio", "superate", "gabinete social", "adess", "comedores economicos", "ayuda social", "pobreza", "bono"],
    tags: ["asistencia social", "subsidio", "gabinete social", "superate", "pobreza"],
  },
  {
    key: "emprendimiento",
    match: ["emprend", "mipyme", "pyme", "promipyme", "startup", "incubadora", "microempresa"],
    tags: ["emprendimiento", "mipyme", "pyme", "promipyme"],
  },

  // --- Municipal / territorio / vivienda / infraestructura ---
  {
    key: "municipal",
    match: ["municip", "ayuntamiento", "alcald", "regidor", "junta de distrito", "distrito municipal", "liga municipal", "cabildo", "arbitrio", "sindico"],
    tags: ["municipal", "ayuntamiento", "alcalde", "regidor", "distrito municipal", "asuntos municipales"],
  },
  {
    key: "territorio",
    match: ["ordenamiento territorial", "uso de suelo", "planificacion urbana", "catastro", "limite provincial", "division territorial", "demarcacion"],
    tags: ["ordenamiento territorial", "uso de suelo", "catastro", "planificacion urbana"],
  },
  {
    key: "vivienda",
    match: ["vivienda", "invi", "mived", "habitat", "urbaniz", "titulacion", "dominio", "jurisdiccion inmobiliaria", "condominio", "inquilinato", "alquiler"],
    tags: ["vivienda", "invi", "habitat", "titulacion", "dominio", "urbanizacion"],
  },
  {
    key: "infraestructura",
    match: ["obras publicas", "mopc", "carretera", "puente", "infraestructura", "asfaltado", "autopista", "construccion vial", "acera"],
    tags: ["infraestructura", "obras publicas", "mopc", "carretera", "puente"],
  },

  // --- Agro / pesca / animal ---
  {
    key: "agro",
    match: ["agric", "agro", "agropecuar", "pesca", "ganader", "cultivo", "cosecha", "campesino", "banco agricola", "arroz", "cafe", "cacao", "platano", "agroindustr", "riego", "reforma agraria"],
    tags: ["agro", "agricultura", "agropecuario", "ganaderia", "pesca", "banco agricola", "campesino"],
  },
  {
    key: "bienestar_animal",
    match: ["bienestar animal", "maltrato animal", "mascota", "fauna", "veterinar", "proteccion animal"],
    tags: ["bienestar animal", "animales", "mascotas", "fauna"],
  },

  // --- Turismo / marítimo / aviación ---
  {
    key: "turismo",
    match: ["turism", "hotel", "hotelero", "mitur", "ecoturis", "destino turistico", "cluster turistico", "playa"],
    tags: ["turismo", "hotelero", "mitur", "turistico"],
  },
  {
    key: "maritimo",
    match: ["maritim", "puerto", "portuari", "nautic", "apordom", "buque", "zona costera", "faro"],
    tags: ["maritimo", "puerto", "portuario", "nautico"],
  },
  {
    key: "aviacion",
    match: ["aviacion", "aeropuerto", "aeronaut", "idac", "jac", "aerolinea", "vuelo"],
    tags: ["aviacion", "aeropuerto", "aeronautico", "idac"],
  },

  // --- TIC / datos / medios ---
  {
    key: "tic",
    match: ["telecom", "tecnolog", "indotel", "internet", "digital", "informatic", "software", "banda ancha", "ogtic", "gobierno digital", "telefonia"],
    tags: ["tecnologia", "telecomunicaciones", "indotel", "digital", "internet", "tic"],
  },
  {
    key: "inteligencia_artificial",
    match: ["inteligencia artificial", "ia", "algoritmo", "aprendizaje automatico"],
    tags: ["inteligencia artificial", "ia", "tecnologia"],
  },
  {
    key: "ciberseguridad",
    match: ["ciberseg", "ciberdelito", "ciberataque", "delito informatico", "phishing"],
    tags: ["ciberseguridad", "ciberdelito", "delito informatico"],
  },
  {
    key: "datos_personales",
    match: ["dato personal", "datos personales", "proteccion de datos", "privacidad", "habeas data"],
    tags: ["datos personales", "proteccion de datos", "privacidad"],
  },
  {
    key: "medios",
    match: ["medios de comunicacion", "prensa", "periodismo", "radio", "television", "libertad de expresion", "difamacion", "espectro radioelectrico"],
    tags: ["medios de comunicacion", "prensa", "periodismo", "libertad de expresion"],
  },

  // --- Transporte / movilidad ---
  {
    key: "transporte",
    match: ["transport", "transito", "intrant", "movilidad", "vehicul", "trafico", "peaje", "licencia de conducir", "dgtt", "ley de transito", "motoconch", "guagua", "metro", "telecabina", "semaforo", "matricula"],
    tags: ["transporte", "transito", "intrant", "movilidad", "vehiculo", "trafico"],
  },

  // --- Comercio / consumidor / etiquetado / vicios ---
  {
    key: "comercio",
    match: ["comercio", "proconsumidor", "competencia", "procompetencia", "consumidor", "industria y comercio", "mercado", "monopoli", "precio", "abasto"],
    tags: ["comercio", "proconsumidor", "competencia", "consumidor", "industria"],
  },
  {
    key: "etiquetado",
    match: ["etiquetad", "etiqueta", "rotulad", "empaque", "semaforo nutricional", "octogono"],
    tags: ["etiquetado", "etiqueta", "rotulado"],
  },
  {
    key: "bebidas_alcoholicas",
    match: ["alcohol", "bebida alcoholic", "bebidas alcoholic", "cerveza", "licor", "expendio de bebidas"],
    tags: ["bebidas alcoholicas", "alcohol", "licor"],
  },
  {
    key: "tabaco",
    match: ["tabaco", "cigarrillo", "vapeo", "cigarro electronico", "nicotina"],
    tags: ["tabaco", "cigarrillo", "vapeo"],
  },
  {
    key: "comercio_ilicito",
    match: ["comercio ilicito", "falsificac", "pirateria", "adulterac", "mercancia ilicita"],
    tags: ["comercio ilicito", "contrabando", "falsificacion", "pirateria"],
  },
  {
    key: "zonas_francas",
    match: ["zona franca", "zonas francas", "cnzfe", "parque industrial"],
    tags: ["zonas francas", "parque industrial", "comercio exterior"],
  },
  {
    key: "loteria",
    match: ["loteria", "banca de apuestas", "juegos de azar", "casino", "sorteo"],
    tags: ["loteria", "juegos de azar", "banca de apuestas"],
  },
  {
    key: "propiedad_intelectual",
    match: ["propiedad intelectual", "onapi", "patente", "marca registrada", "derecho de autor"],
    tags: ["propiedad intelectual", "onapi", "patente", "derecho de autor"],
  },

  // --- Gobierno / justicia / electoral / migración / exterior / DDHH ---
  {
    key: "gobierno",
    match: ["administracion publica", "funcion publica", "servicio civil", "descentralizac", "reforma del estado", "poder ejecutivo", "carrera administrativa", "burocracia"],
    tags: ["gobierno", "instituciones", "administracion publica", "funcion publica", "estado"],
  },
  {
    key: "justicia",
    match: ["justicia", "judicial", "tribunal", "suprema corte", "poder judicial", "fiscalia", "ministerio publico", "procuraduria", "carrera judicial", "defensa publica"],
    tags: ["justicia", "judicial", "tribunal", "poder judicial", "ministerio publico"],
  },
  {
    key: "constitucion",
    match: ["constituc", "reforma constitucional", "asamblea nacional revisora", "enmienda constitucional"],
    tags: ["constitucion", "reforma constitucional"],
  },
  {
    key: "transparencia",
    match: ["corrupcion", "transparencia", "pepca", "rendicion de cuentas", "integridad", "declaracion jurada", "acceso a la informacion", "conflicto de interes"],
    tags: ["transparencia", "corrupcion", "rendicion de cuentas", "integridad"],
  },
  {
    key: "contratacion_publica",
    match: ["licitacion", "contratacion publica", "compras publicas", "dgcp", "proveedor del estado", "concurso publico"],
    tags: ["contratacion publica", "licitacion", "compras publicas", "dgcp"],
  },
  {
    key: "electoral",
    match: ["electoral", "jce", "tse", "partido politico", "sufragio", "voto", "elecciones", "padron", "financiamiento politico", "primarias"],
    tags: ["electoral", "jce", "partido", "elecciones", "voto", "sufragio"],
  },
  {
    key: "registro_civil",
    match: ["registro civil", "acta de nacimiento", "cedula", "oficialia", "identificacion civil"],
    tags: ["registro civil", "cedula", "acta de nacimiento", "jce"],
  },
  {
    key: "migracion",
    match: ["migrac", "migrant", "nacionalidad", "extranjero", "haitian", "frontera", "naturalizac", "pasaporte", "refugiado", "dgm", "residencia legal"],
    tags: ["migracion", "migrante", "nacionalidad", "extranjero", "haitianos", "frontera"],
  },
  {
    key: "relaciones_exteriores",
    match: ["relaciones exteriores", "mirex", "tratado", "diplomatic", "consulado", "embajada", "acuerdo internacional", "convenio internacional"],
    tags: ["relaciones exteriores", "mirex", "tratado internacional", "diplomacia"],
  },
  {
    key: "derechos_humanos",
    match: ["derechos humanos", "derechos fundamentales", "tortura", "trata de personas", "esclavitud"],
    tags: ["derechos humanos", "derechos fundamentales", "trata de personas"],
  },

  // --- Deportes / cultura / religión / colegios profesionales ---
  {
    key: "deportes",
    match: ["deporte", "miderec", "atleta", "estadio", "olimpic", "federacion deportiva", "beisbol", "baloncesto", "juegos deportivos"],
    tags: ["deportes", "miderec", "atleta", "estadio", "federacion deportiva"],
  },
  {
    key: "cultura",
    match: ["cultura", "patrimonio", "cultural", "artista", "museo", "folklor", "ministerio de cultura", "bellas artes", "monumento"],
    tags: ["cultura", "patrimonio", "artistico", "museo"],
  },
  {
    key: "religion",
    match: ["religion", "iglesia", "libertad religiosa", "libertad de culto"],
    tags: ["religion", "iglesia", "libertad de culto"],
  },
  {
    key: "colegios_profesionales",
    match: ["colegio de abogados", "colegio medico", "colegio de notarios", "notariado", "notario", "ejercicio profesional", "carne profesional"],
    tags: ["colegios profesionales", "notariado", "ejercicio profesional"],
  },

  // --- Reconocimientos / declaratorias (common in Diputados resolutions) ---
  {
    key: "reconocimiento",
    match: ["reconocimiento", "meritorio", "homenaje", "condecoracion", "dia nacional", "exaltacion", "declarar el", "declara"],
    tags: ["reconocimiento", "homenaje", "declaratoria"],
  },
];

/** Word-boundary for short/abbr terms (≤4), substring for longer stems. */
function termMatches(spaced: string, term: string): boolean {
  if (term.length <= 4) return spaced.includes(` ${term} `);
  return spaced.includes(term);
}

/** Correct a few very common typos token-by-token before concept matching. */
function correctTypos(norm: string): string {
  if (!norm) return norm;
  return norm
    .split(" ")
    .map((t) => COMMON_TYPOS[t] ?? t)
    .join(" ");
}

/** Concept groups triggered by the given normalized text (matches roots ∪ tags). */
function matchedGroups(normText: string): ConceptGroup[] {
  const spaced = ` ${normText} `;
  const out: ConceptGroup[] = [];
  for (const g of THESAURUS) {
    let hit = false;
    for (const t of g.match) {
      if (termMatches(spaced, t)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const t of g.tags) {
        if (termMatches(spaced, t)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) out.push(g);
  }
  return out;
}

/**
 * Expand a user query into extra domain synonym terms to OR into the full-text search.
 * Tokenizes + accent-folds + typo-corrects the query, finds every concept group it
 * triggers, and returns the union of those groups' natural-word tags (NOT including the
 * raw query — the caller adds that itself). Deterministic and order-stable.
 *
 * e.g. expandQueryTerms("impuesto") → ["fiscal","tributario","itbis","dgii",…]
 *      expandQueryTerms("energia electrica") → ["energia","electricidad","ede","apagon",…]
 */
export function expandQueryTerms(query: string): string[] {
  const norm = correctTypos(normalizeText(query));
  if (!norm) return [];
  const groups = matchedGroups(norm);
  const out = new Set<string>();
  for (const g of groups) for (const tag of g.tags) out.add(tag);
  return [...out];
}

export interface KeywordBlobRow {
  title?: string | null;
  purpose?: string | null;
  category?: string | null;
  sponsor?: string | null;
  party?: string | null;
  province?: string | null;
  committee?: string | null;
}

/**
 * Build the normalized search blob stored in `initiatives.search_text` and fed to the
 * generated Spanish tsvector. It is the accent-folded concatenation of the row's
 * searchable fields PLUS every concept tag whose synonyms appear in the title/purpose —
 * so a bill whose title only says "ITBIS" still carries "fiscal impuesto tributario",
 * making it findable by any of those synonyms. Deterministic; safe on partial rows.
 */
export function keywordBlob(row: KeywordBlobRow): string {
  const fieldParts = [
    row.title,
    row.purpose,
    row.category,
    row.sponsor,
    row.party,
    row.province,
    row.committee,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => normalizeText(v))
    .filter(Boolean);

  // Concept tags are derived from the TOPICAL fields (title + purpose) only, so a
  // sponsor/province string can't spuriously inject a policy concept.
  const topical = normalizeText([row.title, row.purpose].filter(Boolean).join(" "));
  const tags = new Set<string>();
  if (topical) {
    for (const g of matchedGroups(topical)) for (const tag of g.tags) tags.add(tag);
  }

  return [...fieldParts, ...tags].join(" ").replace(/\s+/g, " ").trim();
}
