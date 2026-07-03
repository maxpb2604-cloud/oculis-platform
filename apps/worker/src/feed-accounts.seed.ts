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
import { norm, tokenize } from "./text.js";

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

/**
 * Registry of DOMINICAN GOVERNMENT INSTITUTION accounts on X — the ONLY accounts the
 * social adapter monitors (client requirement: monitor government institutions only —
 * ministries, general directorates, autonomous/decentralized institutions,
 * superintendencies, constitutional/oversight bodies, security forces, and the two
 * chambers). NO individual politicians, parties, press, or private associations.
 *
 * Compiled 2026-07-03 via an 8-agent research sweep (web-grounded official handles) —
 * 107 institutions across every category. Handles are best-effort official accounts;
 * two are lower-confidence (marked "verificar handle"). When the X API is funded again,
 * run scripts/verify-x-handles.mjs to confirm every handle against the live API.
 */
export const FEED_ACCOUNTS: SeedAccount[] = [
  { name: "Consultoría Jurídica del Poder Ejecutivo", handle: "@CJPE_RD", platform: "X", url: x("CJPE_RD"), kind: "INSTITUTION", rank: 1 },
  { name: "Cámara de Diputados de la República Dominicana", handle: "@DiputadosRD", platform: "X", url: x("DiputadosRD"), kind: "INSTITUTION", chamber: "DIPUTADOS", rank: 2 },
  { name: "Poder Judicial / Suprema Corte de Justicia", handle: "@PoderJudicialRD", platform: "X", url: x("PoderJudicialRD"), kind: "INSTITUTION", rank: 3 },
  { name: "Presidencia de la República", handle: "@PresidenciaRD", platform: "X", url: x("PresidenciaRD"), kind: "INSTITUTION", rank: 4 },
  { name: "Senado de la República", handle: "@SenadoRD", platform: "X", url: x("SenadoRD"), kind: "INSTITUTION", chamber: "SENADO", rank: 5 },
  { name: "Vicepresidencia de la República Dominicana", handle: "@ViceRDo", platform: "X", url: x("ViceRDo"), kind: "INSTITUTION", rank: 6 },
  { name: "Contraloría General de la República", handle: "@ContraloriaRD", platform: "X", url: x("ContraloriaRD"), kind: "INSTITUTION", rank: 7 },
  { name: "Cámara de Cuentas de la República Dominicana", handle: "@camaracuentasrd", platform: "X", url: x("camaracuentasrd"), kind: "INSTITUTION", rank: 8 },
  { name: "Defensor del Pueblo", handle: "@DefensorRD", platform: "X", url: x("DefensorRD"), kind: "INSTITUTION", rank: 9 },
  { name: "Junta Central Electoral (JCE)", handle: "@juntacentral", platform: "X", url: x("juntacentral"), kind: "INSTITUTION", rank: 10 },
  { name: "Procuraduría General de la República", handle: "@ProcuraduriaRD", platform: "X", url: x("ProcuraduriaRD"), kind: "INSTITUTION", rank: 11 },
  { name: "Tribunal Constitucional (TCRD)", handle: "@TribunalConstRD", platform: "X", url: x("TribunalConstRD"), kind: "INSTITUTION", rank: 12 },
  { name: "Tribunal Superior Electoral (TSE)", handle: "@tse_rd", platform: "X", url: x("tse_rd"), kind: "INSTITUTION", rank: 13 },
  { name: "Ministerio de Administración Pública (MAP)", handle: "@MapRDo", platform: "X", url: x("MapRDo"), kind: "INSTITUTION", rank: 14 },
  { name: "Ministerio de Agricultura", handle: "@AgriculturaRD", platform: "X", url: x("AgriculturaRD"), kind: "INSTITUTION", rank: 15 },
  { name: "Ministerio de Cultura", handle: "@MiculturaRD", platform: "X", url: x("MiculturaRD"), kind: "INSTITUTION", rank: 16 },
  { name: "Ministerio de Defensa (MIDE)", handle: "@MDefensaRD", platform: "X", url: x("MDefensaRD"), kind: "INSTITUTION", rank: 17 },
  { name: "Ministerio de Deportes y Recreación (MIDEREC)", handle: "@miderec_rd", platform: "X", url: x("miderec_rd"), kind: "INSTITUTION", rank: 18 },
  { name: "Ministerio de Economía, Planificación y Desarrollo (MEPyD)", handle: "@mineconomiard", platform: "X", url: x("mineconomiard"), kind: "INSTITUTION", rank: 19 },
  { name: "Ministerio de Educación (MINERD)", handle: "@EducacionRDo", platform: "X", url: x("EducacionRDo"), kind: "INSTITUTION", rank: 20 },
  { name: "Ministerio de Educación Superior, Ciencia y Tecnología (MESCyT)", handle: "@MESCYTRD", platform: "X", url: x("MESCYTRD"), kind: "INSTITUTION", rank: 21 },
  { name: "Ministerio de Energía y Minas (MEM)", handle: "@energiayminasrd", platform: "X", url: x("energiayminasrd"), kind: "INSTITUTION", rank: 22 },
  { name: "Ministerio de Hacienda", handle: "@MinHaciendard", platform: "X", url: x("MinHaciendard"), kind: "INSTITUTION", rank: 23 },
  { name: "Ministerio de Industria, Comercio y Mipymes (MICM)", handle: "@MIC_RD", platform: "X", url: x("MIC_RD"), kind: "INSTITUTION", rank: 24 },
  { name: "Ministerio de Interior y Policía", handle: "@MinInteriorRD", platform: "X", url: x("MinInteriorRD"), kind: "INSTITUTION", rank: 25 },
  { name: "Ministerio de Medio Ambiente y Recursos Naturales", handle: "@AmbienteRD", platform: "X", url: x("AmbienteRD"), kind: "INSTITUTION", rank: 26 },
  { name: "Ministerio de Obras Públicas y Comunicaciones (MOPC)", handle: "@MOPCRD", platform: "X", url: x("MOPCRD"), kind: "INSTITUTION", rank: 27 },
  { name: "Ministerio de Relaciones Exteriores (MIREX)", handle: "@MIREXRD", platform: "X", url: x("MIREXRD"), kind: "INSTITUTION", rank: 28 },
  { name: "Ministerio de Salud Pública y Asistencia Social (MISPAS)", handle: "@SaludPublicaRD", platform: "X", url: x("SaludPublicaRD"), kind: "INSTITUTION", rank: 29 },
  { name: "Ministerio de Trabajo", handle: "@MTrabajoRD", platform: "X", url: x("MTrabajoRD"), kind: "INSTITUTION", rank: 30 },
  { name: "Ministerio de Turismo (MITUR)", handle: "@TurismoRD", platform: "X", url: x("TurismoRD"), kind: "INSTITUTION", rank: 31 },
  { name: "Ministerio de la Juventud", handle: "@JuventudRD", platform: "X", url: x("JuventudRD"), kind: "INSTITUTION", rank: 32 },
  { name: "Ministerio de la Mujer", handle: "@MMujerRD", platform: "X", url: x("MMujerRD"), kind: "INSTITUTION", rank: 33 },
  { name: "Ministerio de la Presidencia (MINPRE)", handle: "@MinpreRD", platform: "X", url: x("MinpreRD"), kind: "INSTITUTION", rank: 34 },
  { name: "Ministerio de la Vivienda y Edificaciones (MIVED)", handle: "@Mivedrd", platform: "X", url: x("Mivedrd"), kind: "INSTITUTION", rank: 35 },
  { name: "Superintendencia de Bancos de la República Dominicana", handle: "@SuperdeBancosRD", platform: "X", url: x("SuperdeBancosRD"), kind: "INSTITUTION", rank: 36 },
  { name: "Superintendencia de Electricidad (SIE)", handle: "@SIEGOBRD", platform: "X", url: x("SIEGOBRD"), kind: "INSTITUTION", rank: 37 },
  { name: "Superintendencia de Pensiones (SIPEN)", handle: "@SipenRD", platform: "X", url: x("SipenRD"), kind: "INSTITUTION", rank: 38 },
  { name: "Superintendencia de Salud y Riesgos Laborales (SISALRIL)", handle: "@SISALRILRD", platform: "X", url: x("SISALRILRD"), kind: "INSTITUTION", rank: 39 },
  { name: "Superintendencia de Seguros", handle: "@SuperSegurosDO", platform: "X", url: x("SuperSegurosDO"), kind: "INSTITUTION", rank: 40 },
  { name: "Superintendencia del Mercado de Valores", handle: "@SIMVRDO", platform: "X", url: x("SIMVRDO"), kind: "INSTITUTION", rank: 41 },
  { name: "Banco Agrícola de la República Dominicana", handle: "@bagricolaRD", platform: "X", url: x("bagricolaRD"), kind: "INSTITUTION", rank: 42 },
  { name: "Banco Central de la República Dominicana", handle: "@BancoCentralRD", platform: "X", url: x("BancoCentralRD"), kind: "INSTITUTION", rank: 43 },
  { name: "Banco de Reservas de la República Dominicana (Banreservas)", handle: "@BanreservasRD", platform: "X", url: x("BanreservasRD"), kind: "INSTITUTION", rank: 44 },
  { name: "Dirección General de Aduanas (DGA)", handle: "@aduanard", platform: "X", url: x("aduanard"), kind: "INSTITUTION", rank: 45 },
  { name: "Dirección General de Bienes Nacionales (DGBN)", handle: "@DGBNRDO", platform: "X", url: x("DGBNRDO"), kind: "INSTITUTION", rank: 46 },
  { name: "Dirección General de Catastro Nacional (DGCN)", handle: "@CatastroRD", platform: "X", url: x("CatastroRD"), kind: "INSTITUTION", rank: 47 },
  { name: "Dirección General de Cine (DGCINE)", handle: "@DGCINERD", platform: "X", url: x("DGCINERD"), kind: "INSTITUTION", rank: 48 },
  { name: "Dirección General de Contabilidad Gubernamental (DIGECOG)", handle: "@digecogrd", platform: "X", url: x("digecogrd"), kind: "INSTITUTION", rank: 49 },
  { name: "Dirección General de Contrataciones Públicas (DGCP)", handle: "@ComprasRD", platform: "X", url: x("ComprasRD"), kind: "INSTITUTION", rank: 50 },
  { name: "Dirección General de Desarrollo Fronterizo (DGDF)", handle: "@DGDFRD__", platform: "X", url: x("DGDFRD__"), kind: "INSTITUTION", rank: 51 },
  { name: "Dirección General de Impuestos Internos (DGII)", handle: "@DGii", platform: "X", url: x("DGii"), kind: "INSTITUTION", rank: 52 },
  { name: "Dirección General de Información y Defensa de los Afiliados a la Seguridad Social (DIDA)", handle: "@DIDA_RDo", platform: "X", url: x("DIDA_RDo"), kind: "INSTITUTION", rank: 53 },
  { name: "Dirección General de Jubilaciones y Pensiones a Cargo del Estado (DGJP)", handle: "@pensionesrd", platform: "X", url: x("pensionesrd"), kind: "INSTITUTION", rank: 54 },
  { name: "Dirección General de Migración", handle: "@MigracionRDo", platform: "X", url: x("MigracionRDo"), kind: "INSTITUTION", rank: 55 },
  { name: "Dirección General de Pasaportes", handle: "@Pasaportesrd", platform: "X", url: x("Pasaportesrd"), kind: "INSTITUTION", rank: 56 },
  { name: "Dirección General de Presupuesto (DIGEPRES)", handle: "@DIGEPRESRD", platform: "X", url: x("DIGEPRESRD"), kind: "INSTITUTION", rank: 57 },
  { name: "Dirección General de Seguridad de Tránsito y Transporte Terrestre (DIGESETT)", handle: "@digesettrd_", platform: "X", url: x("digesettrd_"), kind: "INSTITUTION", rank: 58 },
  { name: "Dirección General de Ética e Integridad Gubernamental (DIGEIG)", handle: "@DIGEIGRD", platform: "X", url: x("DIGEIGRD"), kind: "INSTITUTION", rank: 59 },
  { name: "Oficina Gubernamental de Tecnologías de la Información y Comunicación (OGTIC)", handle: "@OGTICRDO", platform: "X", url: x("OGTICRDO"), kind: "INSTITUTION", rank: 60 },
  { name: "Oficina Nacional de Estadística (ONE)", handle: "@ONERD_", platform: "X", url: x("ONERD_"), kind: "INSTITUTION", rank: 61 },
  { name: "Oficina Nacional de la Propiedad Industrial (ONAPI)", handle: "@OnapiRD", platform: "X", url: x("OnapiRD"), kind: "INSTITUTION", rank: 62 },
  { name: "Autoridad Portuaria Dominicana (APORDOM)", handle: "@PortuariaRD", platform: "X", url: x("PortuariaRD"), kind: "INSTITUTION", rank: 63 },
  { name: "Corporación Dominicana de Empresas Eléctricas Estatales (CDEEE)", handle: "@CDEEE_RD", platform: "X", url: x("CDEEE_RD"), kind: "INSTITUTION", rank: 64 },
  { name: "Corporación Estatal de Radio y Televisión (CERTV / RTVD)", handle: "@rtvd_4", platform: "X", url: x("rtvd_4"), kind: "INSTITUTION", rank: 65 },  // ⚠ verificar handle
  { name: "Corporación del Acueducto y Alcantarillado de Santiago (CORAASAN)", handle: "@CORAASANRDO", platform: "X", url: x("CORAASANRDO"), kind: "INSTITUTION", rank: 66 },
  { name: "Corporación del Acueducto y Alcantarillado de Santo Domingo (CAASD)", handle: "@caasdrd", platform: "X", url: x("caasdrd"), kind: "INSTITUTION", rank: 67 },
  { name: "Empresa Distribuidora de Electricidad del Este (EDEESTE Dominicana)", handle: "@EdeesteRD", platform: "X", url: x("EdeesteRD"), kind: "INSTITUTION", rank: 68 },
  { name: "Empresa Distribuidora de Electricidad del Norte (EDENORTE Dominicana)", handle: "@EdenorteRD", platform: "X", url: x("EdenorteRD"), kind: "INSTITUTION", rank: 69 },
  { name: "Empresa Distribuidora de Electricidad del Sur (EDESUR Dominicana)", handle: "@EdesurRD", platform: "X", url: x("EdesurRD"), kind: "INSTITUTION", rank: 70 },
  { name: "Empresa de Generación Hidroeléctrica Dominicana (EGEHID)", handle: "@EgehidRD", platform: "X", url: x("EgehidRD"), kind: "INSTITUTION", rank: 71 },
  { name: "Empresa de Transmisión Eléctrica Dominicana (ETED)", handle: "@ETED_RD", platform: "X", url: x("ETED_RD"), kind: "INSTITUTION", rank: 72 },
  { name: "Instituto Dominicano de Aviación Civil (IDAC)", handle: "@IDAC_RD", platform: "X", url: x("IDAC_RD"), kind: "INSTITUTION", rank: 73 },
  { name: "Instituto Nacional de Aguas Potables y Alcantarillados (INAPA)", handle: "@INAPAGOB", platform: "X", url: x("INAPAGOB"), kind: "INSTITUTION", rank: 74 },
  { name: "Instituto Nacional de Protección de los Derechos del Consumidor (ProConsumidor)", handle: "@ProConsumidorRD", platform: "X", url: x("ProConsumidorRD"), kind: "INSTITUTION", rank: 75 },
  { name: "Instituto Nacional de Recursos Hidráulicos (INDRHI)", handle: "@INDRHIRD", platform: "X", url: x("INDRHIRD"), kind: "INSTITUTION", rank: 76 },
  { name: "Instituto Nacional de Tránsito y Transporte Terrestre (INTRANT)", handle: "@INTRANT_RD", platform: "X", url: x("INTRANT_RD"), kind: "INSTITUTION", rank: 77 },
  { name: "Instituto Nacional de la Vivienda (INVI)", handle: "@INVI_RD", platform: "X", url: x("INVI_RD"), kind: "INSTITUTION", rank: 78 },
  { name: "Instituto Postal Dominicano (INPOSDOM)", handle: "@InposdomRD", platform: "X", url: x("InposdomRD"), kind: "INSTITUTION", rank: 79 },
  { name: "Junta de Aviación Civil (JAC)", handle: "@JAC_RD", platform: "X", url: x("JAC_RD"), kind: "INSTITUTION", rank: 80 },
  { name: "Armada de República Dominicana", handle: "@ArmadaRepDom", platform: "X", url: x("ArmadaRepDom"), kind: "INSTITUTION", rank: 81 },
  { name: "Centro de Operaciones de Emergencias (COE)", handle: "@COE_RD", platform: "X", url: x("COE_RD"), kind: "INSTITUTION", rank: 82 },
  { name: "Cuerpo Especializado de Seguridad Fronteriza Terrestre (CESFRONT)", handle: "@CESFRONTRD", platform: "X", url: x("CESFRONTRD"), kind: "INSTITUTION", rank: 83 },
  { name: "Cuerpo Especializado en Seguridad Aeroportuaria y de la Aviación Civil (CESAC)", handle: "@CESAC_RD", platform: "X", url: x("CESAC_RD"), kind: "INSTITUTION", rank: 84 },
  { name: "Cuerpo de Bomberos del Distrito Nacional (CBDN)", handle: "@BomberosDn", platform: "X", url: x("BomberosDn"), kind: "INSTITUTION", rank: 85 },
  { name: "Defensa Civil", handle: "@DefensaCivilRD", platform: "X", url: x("DefensaCivilRD"), kind: "INSTITUTION", rank: 86 },
  { name: "Dirección Nacional de Control de Drogas (DNCD)", handle: "@DNCDRD", platform: "X", url: x("DNCDRD"), kind: "INSTITUTION", rank: 87 },
  { name: "Ejército de República Dominicana", handle: "@EjercitoRD", platform: "X", url: x("EjercitoRD"), kind: "INSTITUTION", rank: 88 },
  { name: "Fuerza Aérea de República Dominicana (FARD)", handle: "@FuerzaAereaRD", platform: "X", url: x("FuerzaAereaRD"), kind: "INSTITUTION", rank: 89 },
  { name: "Instituto Nacional de Ciencias Forenses (INACIF)", handle: "@InacifRD", platform: "X", url: x("InacifRD"), kind: "INSTITUTION", rank: 90 },  // ⚠ verificar handle
  { name: "Policía Nacional", handle: "@PoliciaRD", platform: "X", url: x("PoliciaRD"), kind: "INSTITUTION", rank: 91 },
  { name: "Sistema Nacional de Atención a Emergencias y Seguridad 9-1-1", handle: "@Sistema911_RD", platform: "X", url: x("Sistema911_RD"), kind: "INSTITUTION", rank: 92 },
  { name: "Administradora de Subsidios Sociales (ADESS)", handle: "@AdessRD", platform: "X", url: x("AdessRD"), kind: "INSTITUTION", rank: 93 },
  { name: "Consejo Nacional de Discapacidad (CONADIS)", handle: "@ConadisRD", platform: "X", url: x("ConadisRD"), kind: "INSTITUTION", rank: 94 },
  { name: "Consejo Nacional de la Persona Envejeciente (CONAPE)", handle: "@CONAPERD", platform: "X", url: x("CONAPERD"), kind: "INSTITUTION", rank: 95 },
  { name: "Consejo Nacional para la Niñez y la Adolescencia (CONANI)", handle: "@CONANIRDo", platform: "X", url: x("CONANIRDo"), kind: "INSTITUTION", rank: 96 },
  { name: "Gabinete de Coordinación de Política Social (GCPS)", handle: "@gabsocialRD", platform: "X", url: x("gabsocialRD"), kind: "INSTITUTION", rank: 97 },
  { name: "Instituto Nacional de Atención Integral a la Primera Infancia (INAIPI)", handle: "@INAIPIRD", platform: "X", url: x("INAIPIRD"), kind: "INSTITUTION", rank: 98 },
  { name: "Instituto Nacional de Bienestar Estudiantil (INABIE)", handle: "@INABIERD", platform: "X", url: x("INABIERD"), kind: "INSTITUTION", rank: 99 },
  { name: "Instituto Nacional de Estabilización de Precios (INESPRE)", handle: "@inesprerd", platform: "X", url: x("inesprerd"), kind: "INSTITUTION", rank: 100 },
  { name: "Instituto Nacional de Formación Técnico Profesional (INFOTEP)", handle: "@InfotepRD", platform: "X", url: x("InfotepRD"), kind: "INSTITUTION", rank: 101 },
  { name: "Programa de Medicamentos Esenciales / Central de Apoyo Logístico (PROMESE/CAL)", handle: "@PromesecalRD", platform: "X", url: x("PromesecalRD"), kind: "INSTITUTION", rank: 102 },
  { name: "Seguro Nacional de Salud (SeNaSa)", handle: "@ARSSeNaSaRD", platform: "X", url: x("ARSSeNaSaRD"), kind: "INSTITUTION", rank: 103 },
  { name: "Servicio Nacional de Salud (SNS)", handle: "@SNSRDO", platform: "X", url: x("SNSRDO"), kind: "INSTITUTION", rank: 104 },
  { name: "Sistema Único de Beneficiarios (SIUBEN)", handle: "@SiubenRD", platform: "X", url: x("SiubenRD"), kind: "INSTITUTION", rank: 105 },
  { name: "Supérate (antes Progresando con Solidaridad / Prosoli)", handle: "@SuperateRDO", platform: "X", url: x("SuperateRDO"), kind: "INSTITUTION", rank: 106 },
  { name: "Tesorería de la Seguridad Social (TSS)", handle: "@TSSDOM", platform: "X", url: x("TSSDOM"), kind: "INSTITUTION", rank: 107 },
];

/** Significant name tokens (drop particles + short bits) for subset matching. */
const STOP = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "di"]);
const tokens = (s: string) => new Set(tokenize(s, { minLength: 3, stopwords: STOP }));

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
