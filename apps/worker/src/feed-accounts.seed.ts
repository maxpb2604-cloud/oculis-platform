/**
 * Curated registry of influential DR politics/legislation accounts — the feed's "follow"
 * directory and (when X_BEARER_TOKEN is set) the account list the social adapter pulls.
 *
 * Phase 1 ships this VERIFIED STARTER SET (official institutions, major outlets, and top
 * national figures). Handles should be confirmed before enabling live social ingestion.
 * Phase 2 expands this to the full 300–1,000 from an analyst-maintained CSV imported into
 * this same array. Lower `rank` = more influential / higher in the list.
 */
import { listLegislators, upsertFeedAccount, type Database } from "@oculis/db";

type AccountKind =
  | "SENADO_OFFICIAL"
  | "SENATOR"
  | "DEPUTY"
  | "JOURNALIST"
  | "NEWSPAPER"
  | "INSTITUTION";

interface SeedAccount {
  name: string;
  handle: string; // with leading @
  platform: "X" | "INSTAGRAM" | "YOUTUBE" | "WEB";
  url: string;
  kind: AccountKind;
  chamber?: "SENADO" | "DIPUTADOS" | null;
  rank: number;
}

const x = (h: string) => `https://x.com/${h.replace(/^@/, "")}`;

export const FEED_ACCOUNTS: SeedAccount[] = [
  // --- Official institutions ---
  {
    name: "Senado de la República",
    handle: "@SenadoRD",
    platform: "X",
    url: x("SenadoRD"),
    kind: "SENADO_OFFICIAL",
    chamber: "SENADO",
    rank: 1,
  },
  {
    name: "Cámara de Diputados",
    handle: "@DiputadosRD",
    platform: "X",
    url: x("DiputadosRD"),
    kind: "INSTITUTION",
    chamber: "DIPUTADOS",
    rank: 2,
  },
  {
    name: "Presidencia de la República",
    handle: "@PresidenciaRD",
    platform: "X",
    url: x("PresidenciaRD"),
    kind: "INSTITUTION",
    rank: 3,
  },
  {
    name: "Ministerio de la Presidencia",
    handle: "@MinpreRD",
    platform: "X",
    url: x("MinpreRD"),
    kind: "INSTITUTION",
    rank: 4,
  },
  {
    name: "Junta Central Electoral",
    handle: "@JCErd",
    platform: "X",
    url: x("JCErd"),
    kind: "INSTITUTION",
    rank: 5,
  },
  {
    name: "Procuraduría General",
    handle: "@PGR_RD",
    platform: "X",
    url: x("PGR_RD"),
    kind: "INSTITUTION",
    rank: 6,
  },

  // --- Top national political figures ---
  {
    name: "Luis Abinader",
    handle: "@luisabinader",
    platform: "X",
    url: x("luisabinader"),
    kind: "INSTITUTION",
    rank: 10,
  },
  {
    name: "Raquel Peña",
    handle: "@RaquelPenaVice",
    platform: "X",
    url: x("RaquelPenaVice"),
    kind: "INSTITUTION",
    rank: 11,
  },
  {
    name: "Leonel Fernández",
    handle: "@LeonelFernandez",
    platform: "X",
    url: x("LeonelFernandez"),
    kind: "INSTITUTION",
    rank: 12,
  },
  {
    name: "Danilo Medina",
    handle: "@DaniloMedina",
    platform: "X",
    url: x("DaniloMedina"),
    kind: "INSTITUTION",
    rank: 13,
  },
  {
    name: "David Collado",
    handle: "@David_Collado",
    platform: "X",
    url: x("David_Collado"),
    kind: "INSTITUTION",
    rank: 14,
  },

  // --- Newspapers / outlets (very public, stable handles) ---
  {
    name: "Diario Libre",
    handle: "@diariolibre",
    platform: "X",
    url: x("diariolibre"),
    kind: "NEWSPAPER",
    rank: 20,
  },
  {
    name: "Listín Diario",
    handle: "@ListinDiario",
    platform: "X",
    url: x("ListinDiario"),
    kind: "NEWSPAPER",
    rank: 21,
  },
  {
    name: "Acento",
    handle: "@acentodiario",
    platform: "X",
    url: x("acentodiario"),
    kind: "NEWSPAPER",
    rank: 22,
  },
  {
    name: "El Nacional",
    handle: "@ElNacionalRD",
    platform: "X",
    url: x("ElNacionalRD"),
    kind: "NEWSPAPER",
    rank: 23,
  },
  {
    name: "Periódico Hoy",
    handle: "@hoy_rd",
    platform: "X",
    url: x("hoy_rd"),
    kind: "NEWSPAPER",
    rank: 24,
  },
  {
    name: "El Caribe",
    handle: "@elcaribe",
    platform: "X",
    url: x("elcaribe"),
    kind: "NEWSPAPER",
    rank: 25,
  },
  {
    name: "Noticias SIN",
    handle: "@NoticiasSIN",
    platform: "X",
    url: x("NoticiasSIN"),
    kind: "NEWSPAPER",
    rank: 26,
  },
  { name: "CDN 37", handle: "@CDN37", platform: "X", url: x("CDN37"), kind: "NEWSPAPER", rank: 27 },
  {
    name: "El Día",
    handle: "@eldia_do",
    platform: "X",
    url: x("eldia_do"),
    kind: "NEWSPAPER",
    rank: 28,
  },
  {
    name: "El Nuevo Diario",
    handle: "@ELNUEVODIARIO",
    platform: "X",
    url: x("ELNUEVODIARIO"),
    kind: "NEWSPAPER",
    rank: 29,
  },
  {
    name: "Z101 Digital",
    handle: "@Z101digital",
    platform: "X",
    url: x("Z101digital"),
    kind: "NEWSPAPER",
    rank: 30,
  },
  {
    name: "N Digital",
    handle: "@NDIGITALrd",
    platform: "X",
    url: x("NDIGITALrd"),
    kind: "NEWSPAPER",
    rank: 31,
  },
  {
    name: "Diario Libre — Política",
    handle: "@diariolibre",
    platform: "WEB",
    url: "https://www.diariolibre.com/actualidad/politica",
    kind: "NEWSPAPER",
    rank: 32,
  },

  // --- Prominent political journalists / commentators ---
  {
    name: "Nuria Piera",
    handle: "@nuriapiera",
    platform: "X",
    url: x("nuriapiera"),
    kind: "JOURNALIST",
    rank: 40,
  },
  {
    name: "Marino Zapete",
    handle: "@marinozapete",
    platform: "X",
    url: x("marinozapete"),
    kind: "JOURNALIST",
    rank: 41,
  },
  {
    name: "Altagracia Salazar",
    handle: "@AltagraciaSalaz",
    platform: "X",
    url: x("AltagraciaSalaz"),
    kind: "JOURNALIST",
    rank: 42,
  },
  {
    name: "Huchi Lora",
    handle: "@huchilora",
    platform: "X",
    url: x("huchilora"),
    kind: "JOURNALIST",
    rank: 43,
  },
  {
    name: "Edith Febles",
    handle: "@edithfebles",
    platform: "X",
    url: x("edithfebles"),
    kind: "JOURNALIST",
    rank: 44,
  },
  {
    name: "Julio Martínez Pozo",
    handle: "@JulioMtnzPozo",
    platform: "X",
    url: x("JulioMtnzPozo"),
    kind: "JOURNALIST",
    rank: 45,
  },

  // --- Phase 2: 100 most-relevant accounts, mapped via research workflow and
  //     VERIFIED against the live X API (followers-ranked). 2026-06-30. ---
  { name: "Margarita Cedeno", handle: "@margaritacdf", platform: "X", url: x("margaritacdf"), kind: "INSTITUTION", rank: 50 },
  { name: "Héctor Acosta", handle: "@ElTorito48", platform: "X", url: x("ElTorito48"), kind: "SENATOR", chamber: "SENADO", rank: 51 },
  { name: "Omar Fernández", handle: "@OmarLFernandez", platform: "X", url: x("OmarLFernandez"), kind: "SENATOR", chamber: "SENADO", rank: 52 },
  { name: "Faride Raful", handle: "@FarideRaful", platform: "X", url: x("FarideRaful"), kind: "INSTITUTION", rank: 53 },
  { name: "David Collado", handle: "@DavidColladoM", platform: "X", url: x("DavidColladoM"), kind: "INSTITUTION", rank: 54 },
  { name: "Ministerio de Educación (MINERD)", handle: "@EducacionRDo", platform: "X", url: x("EducacionRDo"), kind: "INSTITUTION", rank: 55 },
  { name: "Hipolito Mejia", handle: "@llegopapa", platform: "X", url: x("llegopapa"), kind: "INSTITUTION", rank: 56 },
  { name: "Jose Ignacio Paliza", handle: "@JosePaliza", platform: "X", url: x("JosePaliza"), kind: "INSTITUTION", rank: 57 },
  { name: "Carolina Mejia", handle: "@CarolinaMejiaG", platform: "X", url: x("CarolinaMejiaG"), kind: "INSTITUTION", rank: 58 },
  { name: "Junta Central Electoral (JCE)", handle: "@juntacentral", platform: "X", url: x("juntacentral"), kind: "INSTITUTION", rank: 59 },
  { name: "Abel Martinez", handle: "@AbelMartinezD", platform: "X", url: x("AbelMartinezD"), kind: "INSTITUTION", rank: 60 },
  { name: "Procuraduría General de la República (PGR)", handle: "@ProcuraduriaRD", platform: "X", url: x("ProcuraduriaRD"), kind: "INSTITUTION", rank: 61 },
  { name: "Guido Gomez Mazara", handle: "@ggomezmazara", platform: "X", url: x("ggomezmazara"), kind: "INSTITUTION", rank: 62 },
  { name: "ProConsumidor", handle: "@ProConsumidorRD", platform: "X", url: x("ProConsumidorRD"), kind: "INSTITUTION", rank: 63 },
  { name: "Partido Revolucionario Moderno (PRM)", handle: "@PRM_Oficial", platform: "X", url: x("PRM_Oficial"), kind: "INSTITUTION", rank: 64 },
  { name: "Ministerio de Salud Pública", handle: "@SaludPublicaRD", platform: "X", url: x("SaludPublicaRD"), kind: "INSTITUTION", rank: 65 },
  { name: "Partido de la Liberación Dominicana (PLD)", handle: "@PLDenlinea", platform: "X", url: x("PLDenlinea"), kind: "INSTITUTION", rank: 66 },
  { name: "Félix Bautista", handle: "@felixrbautista", platform: "X", url: x("felixrbautista"), kind: "SENATOR", chamber: "SENADO", rank: 67 },
  { name: "Victor (Ito) Bisono", handle: "@itobisono", platform: "X", url: x("itobisono"), kind: "INSTITUTION", rank: 68 },
  { name: "Banco Central de la República Dominicana", handle: "@BancoCentralRD", platform: "X", url: x("BancoCentralRD"), kind: "INSTITUTION", rank: 69 },
  { name: "Ramón Rogelio Genao", handle: "@RogelioGenao", platform: "X", url: x("RogelioGenao"), kind: "SENATOR", chamber: "SENADO", rank: 70 },
  { name: "Ministerio de Obras Públicas y Comunicaciones (MOPC)", handle: "@MOPCRD", platform: "X", url: x("MOPCRD"), kind: "INSTITUTION", rank: 71 },
  { name: "Poder Judicial / Suprema Corte de Justicia", handle: "@PoderJudicialRD", platform: "X", url: x("PoderJudicialRD"), kind: "INSTITUTION", rank: 72 },
  { name: "INDOTEL (Instituto Dominicano de las Telecomunicaciones)", handle: "@IndotelRD", platform: "X", url: x("IndotelRD"), kind: "INSTITUTION", rank: 73 },
  { name: "Ministerio de Trabajo", handle: "@MTrabajoRD", platform: "X", url: x("MTrabajoRD"), kind: "INSTITUTION", rank: 74 },
  { name: "Miguel Vargas Maldonado", handle: "@MiguelVargasM", platform: "X", url: x("MiguelVargasM"), kind: "INSTITUTION", rank: 75 },
  { name: "Alicia Ortega", handle: "@AliciaOrtegah", platform: "X", url: x("AliciaOrtegah"), kind: "JOURNALIST", rank: 76 },
  { name: "Vinicio Castillo Semán (Vinicito)", handle: "@VinicioSenador", platform: "X", url: x("VinicioSenador"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 77 },
  { name: "Vicepresidencia de la República Dominicana", handle: "@ViceRDo", platform: "X", url: x("ViceRDo"), kind: "INSTITUTION", rank: 78 },
  { name: "Roberto Cavada", handle: "@rcavada", platform: "X", url: x("rcavada"), kind: "JOURNALIST", rank: 79 },
  { name: "Dirección General de Impuestos Internos (DGII)", handle: "@DGii", platform: "X", url: x("DGii"), kind: "INSTITUTION", rank: 80 },
  { name: "Gonzalo Castillo", handle: "@GonzaloCastillo", platform: "X", url: x("GonzaloCastillo"), kind: "INSTITUTION", rank: 81 },
  { name: "Tribunal Constitucional de la República Dominicana", handle: "@TribunalConstRD", platform: "X", url: x("TribunalConstRD"), kind: "INSTITUTION", rank: 82 },
  { name: "Fuerza del Pueblo (FP)", handle: "@FPcomunica", platform: "X", url: x("FPcomunica"), kind: "INSTITUTION", rank: 83 },
  { name: "TV Senado", handle: "@tvsenado", platform: "X", url: x("tvsenado"), kind: "INSTITUTION", chamber: "SENADO", rank: 84 },
  { name: "FUNGLODE (Fundación Global Democracia y Desarrollo)", handle: "@FUNGLODE", platform: "X", url: x("FUNGLODE"), kind: "INSTITUTION", rank: 85 },
  { name: "Antonio Taveras Guzmán", handle: "@ATaverasGuzman", platform: "X", url: x("ATaverasGuzman"), kind: "SENATOR", chamber: "SENADO", rank: 86 },
  { name: "Charlie Mariotti", handle: "@charliemariotti", platform: "X", url: x("charliemariotti"), kind: "INSTITUTION", rank: 87 },
  { name: "Federico (Quique) Antun Batlle", handle: "@QuiqueAntun", platform: "X", url: x("QuiqueAntun"), kind: "INSTITUTION", rank: 88 },
  { name: "Participación Ciudadana", handle: "@PCiudadana", platform: "X", url: x("PCiudadana"), kind: "INSTITUTION", rank: 89 },
  { name: "Ministerio de Medio Ambiente y Recursos Naturales", handle: "@AmbienteRD", platform: "X", url: x("AmbienteRD"), kind: "INSTITUTION", rank: 90 },
  { name: "Ministerio de Interior y Policía", handle: "@MinInteriorRD", platform: "X", url: x("MinInteriorRD"), kind: "INSTITUTION", rank: 91 },
  { name: "Francisco Javier Garcia", handle: "@FJavierGarciaF", platform: "X", url: x("FJavierGarciaF"), kind: "INSTITUTION", rank: 92 },
  { name: "Roberto Alvarez", handle: "@RobalsdqAlvarez", platform: "X", url: x("RobalsdqAlvarez"), kind: "INSTITUTION", rank: 93 },
  { name: "Noticias SIN", handle: "@SIN24Horas", platform: "X", url: x("SIN24Horas"), kind: "NEWSPAPER", rank: 94 },
  { name: "Dirección General de Aduanas (DGA)", handle: "@aduanard", platform: "X", url: x("aduanard"), kind: "INSTITUTION", rank: 95 },
  { name: "Marino Zapete", handle: "@mzapete", platform: "X", url: x("mzapete"), kind: "JOURNALIST", rank: 96 },
  { name: "Ministerio de Agricultura", handle: "@AgriculturaRD", platform: "X", url: x("AgriculturaRD"), kind: "INSTITUTION", rank: 97 },
  { name: "Guillermo Moreno", handle: "@MorenoGuillermo", platform: "X", url: x("MorenoGuillermo"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 98 },
  { name: "Alexis Victoria Yeb", handle: "@avictoria_yeb", platform: "X", url: x("avictoria_yeb"), kind: "SENATOR", chamber: "SENADO", rank: 99 },
  { name: "CONEP (Consejo Nacional de la Empresa Privada)", handle: "@CONEP_RD", platform: "X", url: x("CONEP_RD"), kind: "INSTITUTION", rank: 100 },
  { name: "Ministerio de Economía, Planificación y Desarrollo", handle: "@mineconomiard", platform: "X", url: x("mineconomiard"), kind: "INSTITUTION", rank: 101 },
  { name: "Rafael Barón Duluc Rijo", handle: "@CholitinDuluc", platform: "X", url: x("CholitinDuluc"), kind: "SENATOR", chamber: "SENADO", rank: 102 },
  { name: "FINJUS (Fundación Institucionalidad y Justicia)", handle: "@finjusrd", platform: "X", url: x("finjusrd"), kind: "INSTITUTION", rank: 103 },
  { name: "ANJE (Asociación Nacional de Jóvenes Empresarios)", handle: "@ANJE_RD", platform: "X", url: x("ANJE_RD"), kind: "INSTITUTION", rank: 104 },
  { name: "Partido Reformista Social Cristiano (PRSC)", handle: "@PartidoPRSC", platform: "X", url: x("PartidoPRSC"), kind: "INSTITUTION", rank: 105 },
  { name: "Minou Tavárez Mirabal", handle: "@minoutavarezm", platform: "X", url: x("minoutavarezm"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 106 },
  { name: "Julito Fulcar", handle: "@JulitoFulcar", platform: "X", url: x("JulitoFulcar"), kind: "SENATOR", chamber: "SENADO", rank: 107 },
  { name: "Altagracia Salazar", handle: "@altagraciasa", platform: "X", url: x("altagraciasa"), kind: "JOURNALIST", rank: 108 },
  { name: "El Caribe", handle: "@ElCaribeRD", platform: "X", url: x("ElCaribeRD"), kind: "NEWSPAPER", rank: 109 },
  { name: "Contraloría General de la República", handle: "@ContraloriaRD", platform: "X", url: x("ContraloriaRD"), kind: "INSTITUTION", rank: 110 },
  { name: "Argentarium (Alejandro Fernández W.)", handle: "@Argentarium", platform: "X", url: x("Argentarium"), kind: "JOURNALIST", rank: 111 },
  { name: "Santiago José Zorrilla", handle: "@senadorzorrilla", platform: "X", url: x("senadorzorrilla"), kind: "SENATOR", chamber: "SENADO", rank: 112 },
  { name: "Antonio Marte", handle: "@AntonioMartePPG", platform: "X", url: x("AntonioMartePPG"), kind: "SENATOR", chamber: "SENADO", rank: 113 },
  { name: "Pedro Tomás Botello Solimán", handle: "@PedroBotello_", platform: "X", url: x("PedroBotello_"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 114 },
  { name: "Ginnette Bournigal", handle: "@ginette_bj", platform: "X", url: x("ginette_bj"), kind: "SENATOR", chamber: "SENADO", rank: 115 },
  { name: "Alfredo Pacheco", handle: "@Pachecoalfredoo", platform: "X", url: x("Pachecoalfredoo"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 116 },
  { name: "Elías Báez", handle: "@Eliasbaezd", platform: "X", url: x("Eliasbaezd"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 117 },
  { name: "Gustavo Sánchez", handle: "@GustavoSanchezq", platform: "X", url: x("GustavoSanchezq"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 118 },
  { name: "Ricardo de los Santos", handle: "@ricardodlsanto3", platform: "X", url: x("ricardodlsanto3"), kind: "SENATOR", chamber: "SENADO", rank: 119 },
  { name: "Tobías Crespo", handle: "@TobiasCrespo", platform: "X", url: x("TobiasCrespo"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 120 },
  { name: "José Horacio Rodríguez", handle: "@JoseHoracioR", platform: "X", url: x("JoseHoracioR"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 121 },
  { name: "Franklin Romero", handle: "@FranklnRomero", platform: "X", url: x("FranklnRomero"), kind: "SENATOR", chamber: "SENADO", rank: 122 },
  { name: "Lía Díaz", handle: "@liadediazd", platform: "X", url: x("liadediazd"), kind: "SENATOR", chamber: "SENADO", rank: 123 },
  { name: "Daniel Enrique Rivera Reyes", handle: "@drdaniel_rivera", platform: "X", url: x("drdaniel_rivera"), kind: "SENATOR", chamber: "SENADO", rank: 124 },
  { name: "Eugenio Cedeño", handle: "@eugeniocedenolr", platform: "X", url: x("eugeniocedenolr"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 125 },
  { name: "Alexis Jiménez", handle: "@alexisjimenezrd", platform: "X", url: x("alexisjimenezrd"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 126 },
  { name: "Aracelis Villanueva", handle: "@DraAracelisVil1", platform: "X", url: x("DraAracelisVil1"), kind: "SENATOR", chamber: "SENADO", rank: 127 },
  { name: "Eduard Espiritusanto", handle: "@EduardSenador", platform: "X", url: x("EduardSenador"), kind: "SENATOR", chamber: "SENADO", rank: 128 },
  { name: "Robinson Díaz", handle: "@RobinsondiazRD", platform: "X", url: x("RobinsondiazRD"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 129 },
  { name: "Sandra Abinader", handle: "@AbinaderSandra", platform: "X", url: x("AbinaderSandra"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 130 },
  { name: "Moisés Ayala Pérez", handle: "@MoisesayalDr", platform: "X", url: x("MoisesayalDr"), kind: "SENATOR", chamber: "SENADO", rank: 131 },
  { name: "Olfanny Méndez", handle: "@olfannymendez1", platform: "X", url: x("olfannymendez1"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 132 },
  { name: "Soraya Suárez", handle: "@sorayasuarezprm", platform: "X", url: x("sorayasuarezprm"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 133 },
  { name: "Amado Díaz", handle: "@AmadoDiazSDE", platform: "X", url: x("AmadoDiazSDE"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 134 },
  { name: "Pedro Catrain", handle: "@senador_catrain", platform: "X", url: x("senador_catrain"), kind: "SENATOR", chamber: "SENADO", rank: 135 },
  { name: "Rogelio Alfonso Genao Lanza", handle: "@RogelioGenaoLz", platform: "X", url: x("RogelioGenaoLz"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 136 },
  { name: "Wandy Batista", handle: "@WandyBatista", platform: "X", url: x("WandyBatista"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 137 },
  { name: "Luis Báez", handle: "@LicLuisBaez", platform: "X", url: x("LicLuisBaez"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 138 },
  { name: "Carlos Manuel Gómez Ureña", handle: "@CarlosGomezSena", platform: "X", url: x("CarlosGomezSena"), kind: "SENATOR", chamber: "SENADO", rank: 139 },
  { name: "Rafael Castillo", handle: "@castillorafael1", platform: "X", url: x("castillorafael1"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 140 },
  { name: "Leyvi Bautista (Eduviges Bautista)", handle: "@LeyviBautista", platform: "X", url: x("LeyviBautista"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 141 },
  { name: "Cristóbal Castillo", handle: "@CastilloSenador", platform: "X", url: x("CastilloSenador"), kind: "SENATOR", chamber: "SENADO", rank: 142 },
  { name: "Pedro Antonio Martínez Moronta", handle: "@pmartinez_rd", platform: "X", url: x("pmartinez_rd"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 143 },
  { name: "Mateo Espaillat", handle: "@MateoEspaillat", platform: "X", url: x("MateoEspaillat"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 144 },
  { name: "Yuderka de la Rosa", handle: "@DiputadaYuderka", platform: "X", url: x("DiputadaYuderka"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 145 },
  { name: "Dharuelly D'Aza", handle: "@Dharuellydaza", platform: "X", url: x("Dharuellydaza"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 146 },
  { name: "Ramón Bueno", handle: "@RamnBueno2", platform: "X", url: x("RamnBueno2"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 147 },
  { name: "Ydenia Doñé", handle: "@YdeniaD", platform: "X", url: x("YdeniaD"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 148 },
  { name: "Nelson Marmolejos", handle: "@Nelsonmarmolej6", platform: "X", url: x("Nelsonmarmolej6"), kind: "DEPUTY", chamber: "DIPUTADOS", rank: 149 },
];

/** Accent-fold + lowercase for name → legislator matching. */
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Significant name tokens (drop particles + short bits) for subset matching. */
const STOP = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "di"]);
const tokens = (s: string) =>
  new Set(
    norm(s)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );

/** Upsert the registry; auto-link senator/deputy accounts to a legislator by name. */
export async function seedFeedAccounts(
  db: Database,
  opts: { log?: (m: string) => void } = {},
): Promise<{ total: number; linked: number }> {
  const log = opts.log ?? (() => {});
  const legs = await listLegislators(db);
  const withId = legs.filter((l) => l.sourceId);
  const byName = new Map(withId.map((l) => [norm(l.fullName), l.sourceId]));
  // Token-subset index: a short account name ("Omar Fernández") links to the
  // roster's full name ("Omar Leonel Fernández Domínguez") when all its
  // significant tokens are contained in exactly one legislator's name.
  const legTokens = withId.map((l) => ({ sourceId: l.sourceId, toks: tokens(l.fullName) }));
  const matchByTokens = (name: string): string | null => {
    const want = [...tokens(name)];
    if (want.length < 2) return null; // too generic to match safely
    const hits = legTokens.filter((l) => want.every((t) => l.toks.has(t)));
    return hits.length === 1 ? hits[0]!.sourceId : null;
  };
  let linked = 0;
  for (const a of FEED_ACCOUNTS) {
    let legislatorSourceId: string | null = null;
    if (a.kind === "SENATOR" || a.kind === "DEPUTY") {
      legislatorSourceId = byName.get(norm(a.name)) ?? matchByTokens(a.name) ?? null;
      if (legislatorSourceId) linked++;
    }
    await upsertFeedAccount(db, {
      name: a.name,
      handle: a.handle,
      platform: a.platform,
      url: a.url,
      kind: a.kind,
      chamber: a.chamber ?? null,
      legislatorSourceId,
      influenceRank: a.rank,
      active: true,
    });
  }
  log(`  ✔ ${FEED_ACCOUNTS.length} cuentas en el directorio (${linked} enlazadas a legisladores)`);
  return { total: FEED_ACCOUNTS.length, linked };
}
