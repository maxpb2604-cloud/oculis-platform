import {
  getFeed,
  getFeedFacets,
  getFeedTrending,
  getSuggestedAccounts,
  getInitiativeByCode,
  todayISO,
} from "@/lib/data";
import { type Lang } from "@/lib/i18n";
import { shortBillName } from "@/lib/format";
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

  // Resolve the active bill filter to a readable name (instead of the code).
  let activeLabel: string | undefined;
  if (filters.initiativeCode) {
    const bill = await getInitiativeByCode(filters.initiativeCode);
    activeLabel = shortBillName(bill?.title, filters.initiativeCode);
  }

  return (
    <AppShell
      lang={lang}
      title="Feed"
      subtitle={es ? "Noticias y señales del Congreso" : "Congress news & signals"}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)_290px]">
        <FeedFilters lang={lang} facets={facets} active={filters} activeLabel={activeLabel} />
        {filters.kind === "SOCIAL" && page.items.length === 0 ? (
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
        />
      </div>
    </AppShell>
  );
}
