import { getFeed, getFeedFacets, getFeedTrending, getSuggestedAccounts } from "@/lib/data";
import { type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { FeedFilters } from "@/components/feed-filters";
import { FeedTimeline } from "@/components/feed-timeline";
import { FeedRail } from "@/components/feed-rail";
import { FeedSocialDirectory } from "@/components/feed-social-directory";

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

  const [page, facets, trending, accounts] = await Promise.all([
    getFeed(filters, { limit: 25 }),
    getFeedFacets(),
    getFeedTrending(windowDays),
    getSuggestedAccounts(),
  ]);

  return (
    <AppShell
      lang={lang}
      title="Feed"
      subtitle={es ? "Noticias y señales del Congreso" : "Congress news & signals"}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)_290px]">
        <FeedFilters lang={lang} facets={facets} active={filters} />
        {filters.kind === "SOCIAL" && page.items.length === 0 ? (
          <FeedSocialDirectory lang={lang} accounts={accounts} />
        ) : (
          <FeedTimeline
            lang={lang}
            initial={page.items}
            nextCursor={page.nextCursor}
            filters={filters}
          />
        )}
        <FeedRail
          lang={lang}
          topics={trending.topics}
          entities={trending.entities}
          accounts={accounts}
          windowDays={windowDays}
        />
      </div>
    </AppShell>
  );
}
