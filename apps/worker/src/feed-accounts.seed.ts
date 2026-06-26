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
];

/** Accent-fold + lowercase for name → legislator matching. */
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Upsert the registry; auto-link senator/deputy accounts to a legislator by name. */
export async function seedFeedAccounts(
  db: Database,
  opts: { log?: (m: string) => void } = {},
): Promise<{ total: number; linked: number }> {
  const log = opts.log ?? (() => {});
  const legs = await listLegislators(db);
  const byName = new Map(legs.filter((l) => l.sourceId).map((l) => [norm(l.fullName), l.sourceId]));
  let linked = 0;
  for (const a of FEED_ACCOUNTS) {
    let legislatorSourceId: string | null = null;
    if (a.kind === "SENATOR" || a.kind === "DEPUTY") {
      legislatorSourceId = byName.get(norm(a.name)) ?? null;
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
