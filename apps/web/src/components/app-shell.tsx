import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import type { Lang } from "@/lib/i18n";

/** Page chrome shared by every route: module rail + top bar + content area. */
export function AppShell({
  lang,
  title,
  subtitle,
  children,
}: {
  lang: Lang;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const dateLabel = new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date())
    .toUpperCase();

  return (
    <div className="flex">
      <Sidebar lang={lang} />
      <div className="min-w-0 flex-1">
        <TopBar lang={lang} title={title} subtitle={subtitle} dateLabel={dateLabel} />
        <main className="mx-auto max-w-[1320px] px-6 py-7">{children}</main>
      </div>
    </div>
  );
}
