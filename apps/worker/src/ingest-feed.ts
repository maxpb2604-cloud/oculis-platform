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
  feedAdapters,
  isCongressRelevant,
  XSocialAdapter,
  type RawFeedItem,
  type SocialAccount,
} from "@oculis/scrapers";
import { createCategorizer } from "./categorize.js";
import { buildLegislativeSignals } from "./feed-signals.js";

export interface FeedSummary {
  source: string;
  ok: boolean;
  count: number;
  inserted: number;
  error?: string;
}

/** Accent-fold + lowercase for matching names against free text. */
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

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
  return norm(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}
/** Adjacent significant-token pairs — distinctive enough to link a news item to a bill. */
function bigrams(s: string): string[] {
  const toks = sigTokens(s);
  const out: string[] = [];
  for (let i = 0; i + 1 < toks.length; i++) out.push(`${toks[i]} ${toks[i + 1]}`);
  return out;
}

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

async function resolveEntities(
  item: RawFeedItem,
  idx: EntityIndex,
  categorizer: ReturnType<typeof createCategorizer>,
): Promise<{ keep: boolean; record?: NewFeedItem; tags: FeedEntityTag[] }> {
  const rawText = `${item.title} ${item.summary ?? ""}`;
  const text = norm(rawText);
  const tags: FeedEntityTag[] = [];

  // 1) Initiatives by exact official code.
  let primaryCode = item.initiativeCodes[0] ?? null;
  for (const code of item.initiativeCodes) {
    tags.push({ entityType: "INITIATIVE", initiativeCode: code, label: code });
  }

  // 2) Legislators and committees by name.
  let primaryLeg: string | null = null;
  for (const l of idx.legislators) {
    if (l.key.length >= 8 && text.includes(l.key)) {
      tags.push({ entityType: "LEGISLATOR", legislatorSourceId: l.sourceId, label: l.name });
      primaryLeg ??= l.sourceId;
    }
  }
  let primaryComm: string | null = null;
  for (const c of idx.commissions) {
    if (c.key.length >= 10 && text.includes(c.key)) {
      tags.push({ entityType: "COMMISSION", commissionName: c.name, label: c.name });
      primaryComm ??= c.name;
    }
  }

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

  // 3) Topic enrichment — only on items we KEEP: link to a bill via distinctive title
  // bigrams (generic geographic bigrams are stopworded out; needs ≥2 points to link).
  if (!primaryCode) {
    const scored = new Map<string, { ref: InitRef; pts: number }>();
    for (const bg of new Set(bigrams(rawText))) {
      const refs = idx.bigrams.get(bg);
      if (!refs || refs.length > 2) continue; // non-distinctive → ignore
      const w = refs.length === 1 ? 2 : 1; // a unique bigram is the stronger signal
      for (const ref of refs) {
        const cur = scored.get(ref.code) ?? { ref, pts: 0 };
        cur.pts += w;
        scored.set(ref.code, cur);
      }
    }
    const best = [...scored.values()]
      .filter((s) => s.pts >= 2)
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 2);
    for (const s of best) {
      tags.push({ entityType: "INITIATIVE", initiativeCode: s.ref.code, label: s.ref.code });
    }
    if (best[0]) primaryCode = best[0].ref.code;
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
