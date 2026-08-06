import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { MeshBackground } from "@/components/ui/background-shader";
import { InitiativeModalHost } from "@/components/initiative-modal";
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
    timeZone: "America/Santo_Domingo",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date())
    .toUpperCase();

  return (
    <>
      <MeshBackground />
      <InitiativeModalHost lang={lang} />
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[70] -translate-y-24 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        {lang === "es" ? "Saltar al contenido" : "Skip to content"}
      </a>
      <div className="relative z-10 flex min-h-dvh">
        <Sidebar lang={lang} />
        <div className="min-w-0 flex-1">
          <TopBar lang={lang} title={title} subtitle={subtitle} dateLabel={dateLabel} />
          <main id="main-content" className="mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6 sm:py-7">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
