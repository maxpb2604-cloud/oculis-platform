import {
  getFeed,
  getFeedFacets,
  getFeedTrending,
  getSuggestedAccounts,
  getInitiativeByCode,
  getFeedFreshness,
  todayISO,
} from "@/lib/data";
import { type Lang } from "@/lib/i18n";
import { shortBillName } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { FeedFilters } from "@/components/feed-filters";
import { FeedTimeline } from "@/components/feed-timeline";
import { FeedRail } from "@/components/feed-rail";
import { FeedSocialDirectory } from "@/components/feed-social-directory";
import { FeedFreshness } from "@/components/feed-freshness";
import { FeedSearch } from "@/components/feed-search-overlay";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export default async function FeedPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "es";
  const es = lang === "es";
  const windowDays = sp.window === "30" ? 30 : sp.window === "7" ? 7 : 14;

  const filters = {
    kind: sp.kind,
    category: sp.category,
    chamber: sp.chamber,
    initiativeCode: sp.initiativeCode,
    legislatorSourceId: sp.legislatorSourceId,
    commissionName: sp.commissionName,
    search: sp.search,
  };

  // The explicit directory view never renders the timeline — skip the feed query.
  const directoryView = sp.view === "directory";
  const emptyPage: Awaited<ReturnType<typeof getFeed>> = { items: [], nextCursor: null };
  const [page, facets, trending, accounts, freshness, activeBill] = await Promise.all([
    directoryView ? Promise.resolve(emptyPage) : getFeed(filters, { limit: 25 }),
    getFeedFacets(),
    getFeedTrending(windowDays),
    getSuggestedAccounts(),
    getFeedFreshness(),
    filters.initiativeCode ? getInitiativeByCode(filters.initiativeCode) : Promise.resolve(null),
  ]);

  // Fall back to the accounts directory ONLY when "Redes" (SOCIAL) is the sole
  // active filter and there are genuinely no social posts yet. If OTHER filters
  // (search/category/chamber/entity) caused the emptiness, the normal empty
  // state must show instead — the directory would misattribute the cause.
  const socialOnly =
    filters.kind === "SOCIAL" &&
    !filters.category &&
    !filters.chamber &&
    !filters.initiativeCode &&
    !filters.legislatorSourceId &&
    !filters.commissionName &&
    !filters.search;
  const showDirectory = directoryView || (socialOnly && page.items.length === 0);

  // Resolve the active bill filter to a readable name (instead of the code).
  const activeLabel = filters.initiativeCode
    ? shortBillName(activeBill?.title, filters.initiativeCode)
    : undefined;

  return (
    <AppShell
      lang={lang}
      title="Feed"
      subtitle={es ? "Noticias y señales del Congreso" : "Congress news & signals"}
    >
      <div className="mb-4">
        <FeedSearch lang={lang} activeLabel={activeLabel} />
      </div>
      <div className="mb-4">
        <FeedFreshness
          lang={lang}
          updatedAt={freshness.updatedAt}
          sources={freshness.sources}
        />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)_290px]">
        <FeedFilters
          lang={lang}
          facets={{ categories: facets.categories }}
          active={filters}
          activeLabel={activeLabel}
        />
        {showDirectory ? (
          <FeedSocialDirectory lang={lang} accounts={accounts} />
        ) : (
          <FeedTimeline
            lang={lang}
            initial={page.items}
            nextCursor={page.nextCursor}
            filters={filters}
            today={todayISO()}
          />
        )}
        <FeedRail
          lang={lang}
          topics={trending.topics}
          entities={trending.entities}
          accounts={accounts}
          windowDays={windowDays}
          searchParams={sp}
        />
      </div>
    </AppShell>
  );
}
