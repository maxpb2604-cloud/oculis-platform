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
  recordIngestionRun,
  upsertFeedItem,
  type Database,
  type FeedEntityTag,
  type NewFeedItem,
} from "@oculis/db";
import {
  feedAdapters,
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

interface EntityIndex {
  legislators: Array<{ sourceId: string; key: string; name: string }>;
  commissions: Array<{ key: string; name: string }>;
}

async function buildEntityIndex(db: Database): Promise<EntityIndex> {
  const [legs, coms] = await Promise.all([listLegislators(db), listCommissions(db)]);
  return {
    legislators: legs
      .filter((l) => l.sourceId && l.fullName)
      .map((l) => ({ sourceId: l.sourceId, key: norm(l.fullName), name: l.fullName })),
    commissions: coms.map((c) => ({ key: norm(c.name), name: c.name })),
  };
}

async function resolveEntities(
  item: RawFeedItem,
  idx: EntityIndex,
  categorizer: ReturnType<typeof createCategorizer>,
): Promise<{ record: NewFeedItem; tags: FeedEntityTag[] }> {
  const text = norm(`${item.title} ${item.summary ?? ""}`);
  const tags: FeedEntityTag[] = [];

  const primaryCode = item.initiativeCodes[0] ?? null;
  for (const code of item.initiativeCodes) {
    tags.push({ entityType: "INITIATIVE", initiativeCode: code, label: code });
  }

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
  return { record, tags };
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
    for (const item of items) {
      const { record, tags } = await resolveEntities(item, idx, categorizer);
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
      `  ✔ ${items.length} ítems (${inserted} nuevos)${gaps.length ? ` · ${gaps.length} avisos` : ""}`,
    );
    out.push({ source, ok: true, count: items.length, inserted });
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
