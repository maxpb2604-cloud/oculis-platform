/**
 * Ingest feed items (news / official / social / legislative-signal) into `feed_items`,
 * auto-tagging each to the bills / legislators / committees it mentions. Mirrors
 * `ingest-regulatory.ts`: per-source isolation + a health row in `ingestion_runs`.
 *
 * Entity resolution reuses existing utilities: initiative codes (`extractCodes` in the
 * adapter), legislator/commission name matching against the DB roster, and the free
 * heuristic categorizer (`createCategorizer`).
 */
import {
  listAllFeedItems,
  listCommissions,
  listFeedAccounts,
  listLegislators,
  listRecentInitiatives,
  recordIngestionRun,
  upsertFeedItem,
  type Database,
  type FeedEntityTag,
  type NewFeedItem,
} from "@oculis/db";
import {
  extractCodes,
  feedAdapters,
  isCongressRelevant,
  XSocialAdapter,
  type RawFeedItem,
  type SocialAccount,
} from "@oculis/scrapers";
import { createCategorizer } from "./categorize.js";
import { buildLegislativeSignals } from "./feed-signals.js";
import { norm, tokenize } from "./text.js";

export interface FeedSummary {
  source: string;
  ok: boolean;
  count: number;
  inserted: number;
  error?: string;
}

/** Stopwords dropped when building significant title bigrams — includes generic geographic
 *  / institutional terms so common bigrams ("república dominicana") don't false-match. */
const STOP = new Set(
  (
    "de la el los las un una y a o e en que del al con para por su sus se lo le no es ley sobre ante este esta como mas " +
    "republica dominicana dominicano dominicanos nacional pais gobierno estado santo domingo distrito millones pesos " +
    "ano anos dia dias hoy segun tras presidente proyecto"
  ).split(" "),
);
function sigTokens(s: string): string[] {
  return tokenize(s, { minLength: 4, stopwords: STOP });
}
/** Adjacent significant-token pairs — distinctive enough to link a news item to a bill. */
function bigrams(s: string): string[] {
  const toks = sigTokens(s);
  const out: string[] = [];
  for (let i = 0; i + 1 < toks.length; i++) out.push(`${toks[i]} ${toks[i + 1]}`);
  return out;
}

/**
 * Generic TOPIC bigrams: phrases that are a bill's SUBJECT, not its identity. They
 * recur in ordinary world/national news ("inteligencia artificial", "libertad
 * expresion", "estados unidos"), so a news item sharing ONE of these with a bill is
 * about the same topic, NOT about that specific bill — it must never be the sole basis
 * for a news→initiative link. A topic bigram can only support a link alongside a
 * distinctive (non-topic) bigram. (See topicInitiativeLinks below.)
 */
const GENERIC_BIGRAMS = new Set(
  [
    "inteligencia artificial", "libertad expresion", "libertad prensa", "derechos humanos",
    "seguridad social", "seguridad ciudadana", "seguridad nacional", "seguridad publica",
    "medio ambiente", "cambio climatico", "desarrollo sostenible", "energia renovable",
    "energia electrica", "codigo penal", "codigo trabajo", "codigo civil", "salud publica",
    "salud mental", "poder ejecutivo", "poder judicial", "sector publico", "sector privado",
    "banco central", "casa blanca", "estados unidos", "america latina", "union europea",
    "naciones unidas", "consejo seguridad", "presupuesto general", "gasto publico",
    "deuda publica", "servicio militar", "fuerzas armadas", "policia nacional",
    "ministerio publico", "junta central", "tribunal constitucional", "corte suprema",
    "relaciones exteriores", "politica exterior", "libre expresion", "opinion publica",
    "redes sociales", "primera dama", "poder legislativo",
  ].map((s) => s), // already accent-folded/lowercase
);

interface InitRef {
  code: string;
  id: number;
}
interface EntityIndex {
  legislators: Array<{ sourceId: string; key: string; name: string }>;
  commissions: Array<{ key: string; name: string }>;
  bigrams: Map<string, InitRef[]>; // distinctive title bigram → initiative(s)
}

async function buildEntityIndex(db: Database): Promise<EntityIndex> {
  const [legs, coms, recent] = await Promise.all([
    listLegislators(db),
    listCommissions(db),
    listRecentInitiatives(db, { limit: 400 }),
  ]);
  const bigramMap = new Map<string, InitRef[]>();
  for (const ini of recent) {
    if (!ini.code) continue;
    const ref: InitRef = { code: ini.code, id: ini.id };
    for (const bg of new Set(bigrams(ini.title))) {
      const arr = bigramMap.get(bg) ?? [];
      arr.push(ref);
      bigramMap.set(bg, arr);
    }
  }
  return {
    legislators: legs
      .filter((l) => l.sourceId && l.fullName)
      .map((l) => ({ sourceId: l.sourceId, key: norm(l.fullName), name: l.fullName })),
    commissions: coms.map((c) => ({ key: norm(c.name), name: c.name })),
    bigrams: bigramMap,
  };
}

/** Legislators and committees named in the text (accent-folded substring match). For
 *  NEWS, a committee whose name is a generic TOPIC ("Inteligencia Artificial") links
 *  only when the text also says "comision/comité" — proof the news is about the
 *  committee, not merely the subject. Official/legislative/social items keep the plain
 *  name match (their committee context is already established by the source). */
function nameEntities(
  rawText: string,
  kind: string,
  idx: EntityIndex,
): { tags: FeedEntityTag[]; primaryLeg: string | null; primaryComm: string | null } {
  const text = norm(rawText);
  const mentionsCommittee = /\bcomision\b|\bcomite\b|\bcomisiones\b/.test(text);
  const tags: FeedEntityTag[] = [];
  let primaryLeg: string | null = null;
  let primaryComm: string | null = null;
  for (const l of idx.legislators) {
    if (l.key.length >= 8 && text.includes(l.key)) {
      tags.push({ entityType: "LEGISLATOR", legislatorSourceId: l.sourceId, label: l.name });
      primaryLeg ??= l.sourceId;
    }
  }
  for (const c of idx.commissions) {
    if (c.key.length < 10 || !text.includes(c.key)) continue;
    // A committee whose whole name is a generic topic needs committee-context in NEWS.
    if (kind === "NEWS" && GENERIC_BIGRAMS.has(c.key) && !mentionsCommittee) continue;
    tags.push({ entityType: "COMMISSION", commissionName: c.name, label: c.name });
    primaryComm ??= c.name;
  }
  return { tags, primaryLeg, primaryComm };
}

/**
 * Bills a news item genuinely concerns, by distinctive title overlap. Precision rule:
 * link only when the text shares ≥2 DISTINCT distinctive title bigrams with the bill AND
 * at least one of them is NOT a generic topic phrase. This is what separates "about this
 * specific bill" from "mentions the same subject" — a single shared phrase like
 * "inteligencia artificial" (a passing mention in world news) no longer links.
 */
function topicInitiativeLinks(rawText: string, idx: EntityIndex): InitRef[] {
  const perBill = new Map<string, { ref: InitRef; shared: Set<string>; hasSpecific: boolean }>();
  for (const bg of new Set(bigrams(rawText))) {
    const refs = idx.bigrams.get(bg);
    if (!refs || refs.length > 2) continue; // non-distinctive across the bill corpus
    const generic = GENERIC_BIGRAMS.has(bg);
    for (const ref of refs) {
      const e = perBill.get(ref.code) ?? { ref, shared: new Set<string>(), hasSpecific: false };
      e.shared.add(bg);
      if (!generic) e.hasSpecific = true;
      perBill.set(ref.code, e);
    }
  }
  return [...perBill.values()]
    .filter((e) => e.shared.size >= 2 && e.hasSpecific)
    .sort((a, b) => b.shared.size - a.shared.size)
    .slice(0, 2)
    .map((e) => e.ref);
}

async function resolveEntities(
  item: RawFeedItem,
  idx: EntityIndex,
  categorizer: ReturnType<typeof createCategorizer>,
): Promise<{ keep: boolean; record?: NewFeedItem; tags: FeedEntityTag[] }> {
  const rawText = `${item.title} ${item.summary ?? ""}`;
  const tags: FeedEntityTag[] = [];

  // 1) Initiatives by exact official code.
  let primaryCode = item.initiativeCodes[0] ?? null;
  for (const code of item.initiativeCodes) {
    tags.push({ entityType: "INITIATIVE", initiativeCode: code, label: code });
  }

  // 2) Legislators and committees by name (topic-committee guard for NEWS).
  const named = nameEntities(rawText, item.kind, idx);
  tags.push(...named.tags);
  const primaryLeg = named.primaryLeg;
  const primaryComm = named.primaryComm;

  // Relevance (STRICT — fuzzy topic matches must NOT rescue irrelevant news). NEWS is kept
  // only with a hard Congress signal: a Congress/cabinet-change phrase, an exact bill code,
  // or a named legislator/committee. Official / legislative / social are always kept.
  const relevant =
    item.kind !== "NEWS" ||
    item.initiativeCodes.length > 0 ||
    primaryLeg !== null ||
    primaryComm !== null ||
    isCongressRelevant(rawText);
  if (!relevant) return { keep: false, tags: [] };

  // 3) Topic enrichment — only on kept items, only when no exact code: link to a bill
  // via distinctive title overlap (≥2 distinct bigrams, ≥1 non-generic — see above).
  if (!primaryCode) {
    const links = topicInitiativeLinks(rawText, idx);
    for (const ref of links) {
      tags.push({ entityType: "INITIATIVE", initiativeCode: ref.code, label: ref.code });
    }
    if (links[0]) primaryCode = links[0].code;
  }

  let category = item.category;
  if (!category) {
    const res = await categorizer.categorize({
      title: item.title,
      sourceCategory: null,
      purpose: item.summary,
    });
    category = res.category;
  }

  const record: NewFeedItem = {
    source: item.source,
    sourceId: item.sourceId,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    imageUrl: item.imageUrl,
    url: item.url,
    author: item.author,
    handle: item.handle,
    platform: item.platform,
    category,
    publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
    initiativeCode: primaryCode,
    legislatorSourceId: primaryLeg,
    commissionName: primaryComm,
    chamber: item.chamber,
    raw: item.raw as object,
  };
  return { keep: true, record, tags };
}

export async function ingestFeed(
  db: Database,
  opts: { log?: (m: string) => void } = {},
): Promise<FeedSummary[]> {
  const log = opts.log ?? (() => {});
  const out: FeedSummary[] = [];
  const idx = await buildEntityIndex(db);
  const categorizer = createCategorizer();

  async function ingestItems(source: string, items: RawFeedItem[], gaps: string[]) {
    let inserted = 0;
    let kept = 0;
    for (const item of items) {
      const { keep, record, tags } = await resolveEntities(item, idx, categorizer);
      if (!keep || !record) continue;
      kept++;
      const res = await upsertFeedItem(db, record, tags);
      if (res.inserted) inserted++;
    }
    await recordIngestionRun(db, {
      source,
      seen: items.length,
      inserted,
      ok: true,
      details: gaps.length ? { gaps } : null,
    });
    log(
      `  ✔ ${kept}/${items.length} relevantes · ${inserted} nuevos${gaps.length ? ` · ${gaps.length} avisos` : ""}`,
    );
    out.push({ source, ok: true, count: kept, inserted });
  }

  async function runSource(
    source: string,
    collect: () => Promise<{ items: RawFeedItem[]; gaps: string[] }>,
  ) {
    log(`\n▶ ${source}`);
    try {
      const { items, gaps } = await collect();
      await ingestItems(source, items, gaps);
    } catch (err) {
      const error = (err as Error).message;
      await recordIngestionRun(db, { source, ok: false, error });
      log(`  ✖ FALLÓ: ${error}`);
      out.push({ source, ok: false, count: 0, inserted: 0, error });
    }
  }

  // 1. RSS / official adapters
  for (const adapter of feedAdapters()) {
    await runSource(adapter.source, () => adapter.collect());
  }

  // 2. Social (credential-gated; reads the registry)
  await runSource("feed-x", async () => {
    const accounts = await listFeedAccounts(db, { platform: "X", activeOnly: true });
    const social: SocialAccount[] = accounts.map((a) => ({
      handle: a.handle,
      name: a.name,
      legislatorSourceId: a.legislatorSourceId,
      chamber: a.chamber,
    }));
    return new XSocialAdapter().collect(social);
  });

  // 3. Our own legislative signals (the "before the news" cards)
  await runSource("feed-legislative", async () => ({
    items: await buildLegislativeSignals(db),
    gaps: [],
  }));

  return out;
}

/**
 * Recompute every STORED feed item's entity links (bills / legislators / committees)
 * with the current (stricter) matching rules and reconcile the tags — so items ingested
 * under looser rules stop showing spurious links (e.g. a Trump-tariffs story tagged to a
 * DR AI bill because both said "inteligencia artificial" once). Idempotent; no scraping.
 */
export async function relinkFeedItems(
  db: Database,
  opts: { log?: (m: string) => void } = {},
): Promise<{ processed: number; changed: number; linksRemoved: number }> {
  const log = opts.log ?? (() => {});
  const idx = await buildEntityIndex(db);
  const items = await listAllFeedItems(db);
  log(`  re-linking ${items.length} stored feed items with the current rules…`);

  let processed = 0;
  let changed = 0;
  let linksRemoved = 0;

  for (const it of items) {
    const rawText = `${it.title} ${it.summary ?? ""}`;
    const tags: FeedEntityTag[] = [];

    // Initiatives by exact code (re-extracted from the stored text).
    const codes = extractCodes(rawText);
    let primaryCode = codes[0] ?? null;
    for (const code of codes) tags.push({ entityType: "INITIATIVE", initiativeCode: code, label: code });

    // Legislators + committees (topic-committee guard for NEWS).
    const named = nameEntities(rawText, it.kind, idx);
    tags.push(...named.tags);

    // Strict topic links only when no exact code.
    if (!primaryCode) {
      const links = topicInitiativeLinks(rawText, idx);
      for (const ref of links) tags.push({ entityType: "INITIATIVE", initiativeCode: ref.code, label: ref.code });
      if (links[0]) primaryCode = links[0].code;
    }

    const oldInitiativeLinks = it.initiativeCode ? 1 : 0; // primary before
    const record: NewFeedItem = {
      ...it,
      initiativeId: null, // upsertFeedItem re-resolves code→id
      initiativeCode: primaryCode,
      legislatorSourceId: named.primaryLeg,
      commissionName: named.primaryComm,
    };
    await upsertFeedItem(db, record, tags);
    processed++;

    const before = it.initiativeCode ?? "";
    const after = primaryCode ?? "";
    if (before !== after || (it.commissionName ?? "") !== (named.primaryComm ?? "")) {
      changed++;
      if (before && !after) linksRemoved += oldInitiativeLinks;
    }
    if (processed % 50 === 0) log(`  …${processed}/${items.length}`);
  }

  log(`  ✔ ${changed} items relinked (${linksRemoved} spurious primary-bill links cleared)`);
  return { processed, changed, linksRemoved };
}
