import {
  getFeed,
  getAccountDirectory,
  getInitiativeByCode,
  getFeedFreshness,
  todayISO,
} from "@/lib/data";
import { type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { FeedFilters } from "@/components/feed-filters";
import { FeedTimeline } from "@/components/feed-timeline";
import { FeedRail } from "@/components/feed-rail";
import { FeedSocialDirectory } from "@/components/feed-social-directory";
import { FeedFreshness } from "@/components/feed-freshness";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export default async function FeedPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "es";
  const es = lang === "es";

  const filters = {
    kind: sp.kind,
    chamber: sp.chamber,
    initiativeCode: sp.initiativeCode,
    legislatorSourceId: sp.legislatorSourceId,
    commissionName: sp.commissionName,
    search: sp.search,
  };

  const [page, accounts, freshness] = await Promise.all([
    getFeed(filters, { limit: 25 }),
    getAccountDirectory(),
    getFeedFreshness(),
  ]);

  // Resolve the active bill filter to a readable name (instead of the code).
  let activeLabel: string | undefined;
  if (filters.initiativeCode) {
    const bill = await getInitiativeByCode(filters.initiativeCode);
    activeLabel = bill?.title ?? filters.initiativeCode;
  }

  return (
    <AppShell
      lang={lang}
      title="Feed"
      subtitle={es ? "Noticias y señales del Congreso" : "Congress news & signals"}
    >
      <div className="mb-4">
        <FeedFreshness
          lang={lang}
          newestSuccessAt={freshness.newestSuccessAt}
          sources={freshness.sources}
        />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)_290px]">
        <FeedFilters lang={lang} active={filters} activeLabel={activeLabel} />
        {sp.view === "directory" || (filters.kind === "SOCIAL" && page.items.length === 0) ? (
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
        <FeedRail lang={lang} accounts={accounts} />
      </div>
    </AppShell>
  );
}
