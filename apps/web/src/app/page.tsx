import Link from "next/link";
import { getDashboardData, getInitiativesByProvince, getLegislatorsByProvince } from "@/lib/data";
import { dict, langQuery, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { GeoOverview, KpiBand } from "@/components/dashboard";
import { Panel, SectionHeading } from "@/components/report-ui";
import { InitiativesTable } from "@/components/initiatives-table";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const t = dict[lang];
  const [data, provinceFC, legislators] = await Promise.all([
    getDashboardData(),
    getInitiativesByProvince(),
    getLegislatorsByProvince(),
  ]);
  const empty = data.kpis.total === 0;
  const q = langQuery(lang);

  return (
    <AppShell
      lang={lang}
      title={lang === "es" ? "Resumen Ejecutivo" : "Executive Summary"}
      subtitle={`${t.legislative} · ${t.source}`}
    >
      <KpiBand lang={lang} data={data} />

      {empty ? (
        <EmptyState
          lang={lang}
          className="mt-6"
          title={
            lang === "es"
              ? "No hay iniciativas guardadas en esta base de datos"
              : "No initiatives are stored in this database"
          }
          description={
            lang === "es"
              ? "Este resultado no determina la causa. El estado de fuentes indica cuáles nunca se ejecutaron, cuáles están en curso y cuáles terminaron completas, parciales o fallidas."
              : "This result does not determine the cause. Source status shows which collectors never ran, are running, or finished as complete, partial, or failed."
          }
          action={
            <Link
              href={`/estado-fuentes${q}`}
              className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text)" }}
            >
              {lang === "es" ? "Ver estado de fuentes" : "View source status"}
            </Link>
          }
        />
      ) : (
        <>
          <GeoOverview lang={lang} data={data} provinceFC={provinceFC} legislators={legislators} />

          <SectionHeading
            n="02"
            title={lang === "es" ? "Iniciativas Recientes" : "Recent Initiatives"}
          />
          <Panel
            title={t.recent}
            flush
            action={
              <Link
                href={`/initiatives${q}`}
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--accent)", cursor: "pointer" }}
              >
                {lang === "es" ? "Ver todas" : "View all"}
              </Link>
            }
          >
            <InitiativesTable rows={data.recent} lang={lang} />
          </Panel>
        </>
      )}

      <footer
        className="mt-10 flex items-center justify-between border-t pt-4 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="serif italic">{t.tagline}</span>
        <span>© {new Date().getFullYear()} Ferdinand Herrera Consultants · Oculis Auribus</span>
      </footer>
    </AppShell>
  );
}
