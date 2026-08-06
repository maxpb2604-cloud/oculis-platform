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
        {data.byStatus.length > 0
          ? lang === "es"
            ? "Haga clic en un segmento para ver las iniciativas con ese estado informado."
            : "Click a segment to view initiatives with that reported status."
          : lang === "es"
            ? "Esta conexión todavía no contiene estados informados por una fuente."
            : "This connection does not yet contain source-reported statuses."}
      </p>
    </AppShell>
  );
}
