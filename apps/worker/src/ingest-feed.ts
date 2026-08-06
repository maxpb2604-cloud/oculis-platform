/**
 * Persist source-selected feed items and attach only exact, auditable entity mentions.
 *
 * There is no topic classifier, relevance heuristic, or title-similarity linking here.
 * Press coverage is scoped by the upstream feed/query; entity tags require an official
 * initiative code or an explicit full-name mention in the item text.
 */
import {
  beginIngestionRun,
  listCommissions,
  listFeedAccounts,
  listLegislators,
  legislatorCommittees,
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
import { buildLegislativeSignals } from "./feed-signals.js";

export interface FeedSummary {
  source: string;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  seen: number;
  count: number;
  inserted: number;
  gaps: string[];
  error?: string;
}

const norm = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface EntityIndex {
  legislators: Array<{ sourceId: string; key: string; name: string; chamber: string }>;
  commissions: Array<{ key: string; name: string; chamber: string }>;
}

async function buildEntityIndex(db: Database): Promise<EntityIndex> {
  const [legs, registeredCommissions, committeeSeats] = await Promise.all([
    listLegislators(db),
    listCommissions(db),
    legislatorCommittees(db),
  ]);
  const commissionRows = new Map<string, { key: string; name: string; chamber: string }>();
  for (const commission of registeredCommissions) {
    const key = norm(commission.name);
    commissionRows.set(`${commission.chamber}\u0000${key}\u0000${commission.name}`, {
      key,
      name: commission.name,
      chamber: commission.chamber,
    });
  }
  // Roster ingestion persists membership rows even when the separate commissions table
  // is empty. These are still explicit official commission names, so index them exactly.
  for (const seat of committeeSeats) {
    const key = norm(seat.commissionName);
    commissionRows.set(`${seat.chamber}\u0000${key}\u0000${seat.commissionName}`, {
      key,
      name: seat.commissionName,
      chamber: seat.chamber,
    });
  }
  return {
    legislators: legs
      .filter((legislator) => legislator.sourceId && legislator.fullName)
      .map((legislator) => ({
        sourceId: legislator.sourceId,
        key: norm(legislator.fullName),
        name: legislator.fullName,
        chamber: legislator.chamber,
      })),
    commissions: [...commissionRows.values()],
  };
}

function explicitMention(text: string, key: string): boolean {
  return key.length >= 8 && ` ${text} `.includes(` ${key} `);
}

/** Persist only a complete, timezone-qualified timestamp supplied by the source. */
function sourceTimestamp(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveExplicitEntities(
  item: RawFeedItem,
  idx: EntityIndex,
): { record: NewFeedItem; tags: FeedEntityTag[] } {
  const text = norm(`${item.title} ${item.summary ?? ""}`);
  const tags: FeedEntityTag[] = [];

  const codes = [...new Set(item.initiativeCodes.filter(Boolean))];
  const primaryCode = codes.length === 1 ? codes[0]! : null;
  for (const code of codes) {
    tags.push({ entityType: "INITIATIVE", initiativeCode: code, label: code });
  }

  const legislatorsByName = new Map<string, EntityIndex["legislators"]>();
  for (const legislator of idx.legislators) {
    const candidates = legislatorsByName.get(legislator.key) ?? [];
    candidates.push(legislator);
    legislatorsByName.set(legislator.key, candidates);
  }
  const matchedLegislators: EntityIndex["legislators"] = [];
  for (const [key, candidates] of legislatorsByName) {
    if (!explicitMention(text, key)) continue;
    const inScope = candidates.filter(
      (candidate) => !item.chamber || candidate.chamber === item.chamber,
    );
    if (inScope.length !== 1) continue;
    const [legislator] = inScope;
    matchedLegislators.push(legislator!);
    tags.push({
      entityType: "LEGISLATOR",
      legislatorSourceId: legislator!.sourceId,
      label: legislator!.name,
    });
  }
  const primaryLegislator =
    matchedLegislators.length === 1 ? matchedLegislators[0]!.sourceId : null;

  const commissionsByName = new Map<string, EntityIndex["commissions"]>();
  for (const commission of idx.commissions) {
    const candidates = commissionsByName.get(commission.key) ?? [];
    candidates.push(commission);
    commissionsByName.set(commission.key, candidates);
  }
  const matchedCommissions: EntityIndex["commissions"] = [];
  for (const [key, candidates] of commissionsByName) {
    if (!explicitMention(text, key)) continue;
    const inScope = candidates.filter(
      (candidate) => !item.chamber || candidate.chamber === item.chamber,
    );
    const names = [...new Set(inScope.map((candidate) => candidate.name))];
    if (names.length !== 1) continue;
    const commission = inScope.find((candidate) => candidate.name === names[0])!;
    matchedCommissions.push(commission);
    tags.push({
      entityType: "COMMISSION",
      commissionName: commission.name,
      label: commission.name,
    });
  }
  const primaryCommission = matchedCommissions.length === 1 ? matchedCommissions[0]!.name : null;

  return {
    record: {
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
      category: null,
      publishedAt: sourceTimestamp(item.publishedAt),
      initiativeCode: primaryCode,
      legislatorSourceId: primaryLegislator,
      commissionName: primaryCommission,
      chamber: item.chamber,
      raw: item.raw as object,
    },
    tags,
  };
}

export async function ingestFeed(
  db: Database,
  opts: { log?: (message: string) => void } = {},
): Promise<FeedSummary[]> {
  const log = opts.log ?? (() => {});
  const out: FeedSummary[] = [];
  const idx = await buildEntityIndex(db);

  async function ingestItems(runId: number, source: string, items: RawFeedItem[], gaps: string[]) {
    let inserted = 0;
    for (const item of items) {
      const { record, tags } = resolveExplicitEntities(item, idx);
      const result = await upsertFeedItem(db, record, tags);
      if (result.inserted) inserted++;
    }
    const outcome = gaps.length ? "PARTIAL" : "COMPLETE";
    const ok = outcome === "COMPLETE";
    await recordIngestionRun(db, {
      source,
      runId,
      seen: items.length,
      inserted,
      ok,
      outcome,
      details: {
        selection: "UPSTREAM_SOURCE_OR_QUERY",
        entityResolution: "EXACT_CODE_OR_FULL_NAME",
        gaps,
      },
    });
    log(
      `  ${ok ? "✔" : "⚠"} ${items.length} source item(s) persisted · ${inserted} new` +
        (gaps.length ? ` · ${gaps.length} notice(s)` : ""),
    );
    gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    out.push({
      source,
      ok,
      outcome,
      seen: items.length,
      count: items.length,
      inserted,
      gaps,
    });
  }

  async function runSource(
    source: string,
    collect: () => Promise<{ items: RawFeedItem[]; gaps: string[] }>,
  ) {
    log(`\n▶ ${source}`);
    const runId = await beginIngestionRun(db, source);
    try {
      const { items, gaps } = await collect();
      await ingestItems(runId, source, items, gaps);
    } catch (error) {
      const message = (error as Error).message;
      await recordIngestionRun(db, { runId, source, ok: false, error: message });
      log(`  ✖ FAILED: ${message}`);
      out.push({
        source,
        ok: false,
        outcome: "FAILED",
        seen: 0,
        count: 0,
        inserted: 0,
        gaps: [],
        error: message,
      });
    }
  }

  for (const adapter of feedAdapters()) {
    await runSource(adapter.source, () => adapter.collect());
  }

  await runSource("feed-x", async () => {
    const accounts = await listFeedAccounts(db, { platform: "X", activeOnly: true });
    const social: SocialAccount[] = accounts.map((account) => ({
      handle: account.handle,
      name: account.name,
      legislatorSourceId: account.legislatorSourceId,
      chamber: account.chamber,
    }));
    return new XSocialAdapter().collect(social);
  });

  await runSource("feed-legislative", async () => ({
    items: await buildLegislativeSignals(db),
    gaps: [],
  }));

  return out;
}
