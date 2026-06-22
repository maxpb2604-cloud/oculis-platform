import { getDashboardData } from "@/lib/data";
import { dict, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { ChartGrid, Insight, KpiBand } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const t = dict[lang];
  const data = await getDashboardData();

  return (
    <AppShell lang={lang} title={t.legislative} subtitle={t.source}>
      {data.kpis.total > 0 && <Insight lang={lang} data={data} />}
      <KpiBand lang={lang} data={data} />
      <ChartGrid lang={lang} data={data} />
      <p className="mt-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
        {lang === "es"
          ? "Haga clic en cualquier barra o segmento para ver las iniciativas correspondientes."
          : "Click any bar or segment to view the matching initiatives."}
      </p>
    </AppShell>
  );
}
