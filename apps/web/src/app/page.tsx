import Link from "next/link";
import { getDashboardData, getInitiativesByProvince } from "@/lib/data";
import { dict, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { ChartGrid, GeoOverview, Insight, KpiBand, Panel, SectionHeading } from "@/components/dashboard";
import { InitiativesTable } from "@/components/initiatives-table";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const t = dict[lang];
  const [data, provinceFC] = await Promise.all([getDashboardData(), getInitiativesByProvince()]);
  const empty = data.kpis.total === 0;
  const q = lang === "en" ? "?lang=en" : "";

  return (
    <AppShell
      lang={lang}
      title={lang === "es" ? "Resumen Ejecutivo" : "Executive Summary"}
      subtitle={`${t.legislative} · ${t.source}`}
    >
      {!empty && <Insight lang={lang} data={data} />}
      <KpiBand lang={lang} data={data} />

      {empty ? (
        <EmptyState lang={lang} message={t.noData} />
      ) : (
        <>
          <GeoOverview lang={lang} data={data} provinceFC={provinceFC} />
          <ChartGrid lang={lang} data={data} />

          <SectionHeading n="04" title={lang === "es" ? "Iniciativas Recientes" : "Recent Initiatives"} />
          <Panel
            title={t.recent}
            flush
            action={
              <Link
                href={`/initiatives${q}`}
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--accent)", cursor: "pointer" }}
              >
                {lang === "es" ? "Ver todas →" : "View all →"}
              </Link>
            }
          >
            <InitiativesTable rows={data.recent} lang={lang} />
          </Panel>
        </>
      )}

      <footer className="mt-10 flex items-center justify-between border-t pt-4 text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="serif italic">{t.tagline}</span>
        <span>© {new Date().getFullYear()} Ferdinand Herrera Consultants · Oculis Auribus</span>
      </footer>
    </AppShell>
  );
}

function EmptyState({ lang, message }: { lang: Lang; message: string }) {
  return (
    <div className="card mt-6 border-dashed p-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      {message}
    </div>
  );
}
