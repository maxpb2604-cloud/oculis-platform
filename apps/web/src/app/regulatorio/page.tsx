import type { Metadata } from "next";
import { getRegulatoryOverview, SOURCE_REGISTRY, type SourceRegistryEntry } from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Kpi, Panel, SectionHeading } from "@/components/report-ui";
import { RegulationList, type RegulationItem } from "@/components/monitoring";
import { ButtonLink, Notice } from "@/components/ui/primitives";
import {
  ArrowRight,
  ArrowSquareOut,
  CalendarDots,
  FileMagnifyingGlass,
  ShieldCheck,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";
type RegulatorioSearchParams = { lang?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RegulatorioSearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Monitoreo regulatorio",
        description:
          "Instrumentos, consultas públicas, fechas y enlaces de fuentes regulatorias oficiales.",
      }
    : {
        title: "Regulatory monitoring",
        description:
          "Regulatory instruments, public consultations, dates, and links to official sources.",
      };
}

export default async function RegulatorioPage({
  searchParams,
}: {
  searchParams: Promise<RegulatorioSearchParams>;
}) {
  const lang: Lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const { kpis, byInstitution, recent, consultas } = await getRegulatoryOverview();
  const sources = SOURCE_REGISTRY.filter((source) => source.id.startsWith("reg-"));
  const langSuffix = lang === "en" ? "?lang=en" : "";
  const hasData = kpis.total > 0;

  return (
    <AppShell
      lang={lang}
      title={es ? "Monitoreo regulatorio" : "Regulatory monitoring"}
      subtitle={
        es
          ? "Instrumentos y consultas públicas organizados desde sus fuentes oficiales"
          : "Instruments and public consultations organized from their official sources"
      }
    >
      {!hasData ? (
        <>
          <EmptyState
            lang={lang}
            title={
              es
                ? "Esta base todavía no contiene instrumentos regulatorios verificados"
                : "This database does not yet contain verified regulatory instruments"
            }
            description={
              es
                ? "Esto no significa que las instituciones no hayan publicado documentos. Significa que Oculis aún no tiene registros regulatorios cargados y verificables en esta conexión, por lo que no mostrará una lista vacía como si fuera evidencia de que no existe actividad."
                : "This does not mean institutions have published no documents. It means Oculis does not yet have regulatory records loaded and verifiable in this connection, so it will not present an empty list as evidence that no activity exists."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href={`/estado-fuentes${langSuffix}`} variant="primary">
                  <ShieldCheck size={18} aria-hidden="true" />
                  {es ? "Ver cobertura de fuentes" : "View source coverage"}
                </ButtonLink>
                <ButtonLink href={`/regulatorio/consultas${langSuffix}`}>
                  {es ? "Ir a consultas públicas" : "Open public consultations"}
                  <ArrowRight size={17} aria-hidden="true" />
                </ButtonLink>
              </div>
            }
          />

          <SectionHeading
            title={es ? "Qué encontrará en este espacio" : "What this workspace will contain"}
            description={
              es
                ? "La interfaz está preparada, pero solo se completará con hechos publicados y enlaces verificables."
                : "The interface is ready, but it will be populated only with published facts and verifiable links."
            }
          />
          <div className="grid gap-3 md:grid-cols-3">
            <ExplainerCard
              icon={<FileMagnifyingGlass size={22} aria-hidden="true" />}
              title={es ? "Documento identificado" : "Identified document"}
              description={
                es
                  ? "Institución, título y tipo tal como aparecen en la fuente."
                  : "Institution, title, and type exactly as reported by the source."
              }
            />
            <ExplainerCard
              icon={<CalendarDots size={22} aria-hidden="true" />}
              title={es ? "Fechas declaradas" : "Reported dates"}
              description={
                es
                  ? "Publicación y vencimiento solo cuando la institución los informa."
                  : "Publication and deadline only when the institution reports them."
              }
            />
            <ExplainerCard
              icon={<ArrowSquareOut size={22} aria-hidden="true" />}
              title={es ? "Evidencia oficial" : "Official evidence"}
              description={
                es
                  ? "Un enlace directo a la publicación de origen cuando esté disponible."
                  : "A direct link to the original publication when it is available."
              }
            />
          </div>
        </>
      ) : (
        <>
          <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="eyebrow text-[var(--accent)]">
                {es ? "Espacio de investigación" : "Research workspace"}
              </div>
              <h2 className="section-title mt-2 max-w-[30ch]">
                {es
                  ? "Revise primero el documento y después su plazo"
                  : "Review the document first, then its deadline"}
              </h2>
              <p className="page-subtitle mt-3">
                {es
                  ? "Oculis conserva el título, el tipo, las fechas y el estado publicados. No completa campos ausentes ni deduce consecuencias regulatorias."
                  : "Oculis preserves the published title, type, dates, and status. It does not fill missing fields or infer regulatory consequences."}
              </p>
            </div>
            <ButtonLink href={`/regulatorio/consultas${langSuffix}`} variant="primary">
              <CalendarDots size={18} aria-hidden="true" />
              {es ? "Ver consultas públicas" : "View public consultations"}
            </ButtonLink>
          </section>

          <div className="mt-8 grid gap-5 border-b pb-8 sm:grid-cols-3">
            <Kpi
              value={kpis.total}
              label={es ? "Instrumentos registrados" : "Recorded instruments"}
              accent="var(--accent)"
            />
            <Kpi
              value={kpis.consultas}
              label={es ? "Consultas públicas" : "Public consultations"}
              accent="var(--verified)"
            />
            <Kpi
              value={kpis.institutions}
              label={es ? "Instituciones con registros" : "Institutions with records"}
              accent="var(--warn)"
            />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel
                title={es ? "Actividad regulatoria reciente" : "Recent regulatory activity"}
                flush
              >
                <RegulationList
                  items={recent as RegulationItem[]}
                  lang={lang}
                  empty={
                    es
                      ? "No hay instrumentos recientes verificados en esta base."
                      : "There are no recently verified instruments in this database."
                  }
                />
              </Panel>
            </div>
            <div className="space-y-5">
              <Panel
                title={`${es ? "Consultas públicas" : "Public consultations"} · ${consultas.length}`}
                flush
              >
                <RegulationList
                  items={consultas as RegulationItem[]}
                  lang={lang}
                  empty={
                    es
                      ? "No hay consultas públicas verificadas en esta base."
                      : "There are no verified public consultations in this database."
                  }
                />
              </Panel>
              <Panel title={es ? "Registros por institución" : "Records by institution"}>
                {byInstitution.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    {es
                      ? "No hay instituciones con registros cargados."
                      : "No institutions have loaded records."}
                  </p>
                ) : (
                  <dl className="divide-y">
                    {byInstitution.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <dt className="text-sm">{item.key}</dt>
                        <dd className="tnum font-semibold">{item.count}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Panel>
            </div>
          </div>

          <Notice className="mt-6 text-sm">
            {es
              ? "Los estados y plazos se muestran literalmente desde la fuente. Oculis no estima impacto, cumplimiento ni probabilidad de aprobación."
              : "Statuses and deadlines are shown literally from the source. Oculis does not estimate impact, compliance, or approval likelihood."}
          </Notice>
        </>
      )}

      <SectionHeading
        title={es ? "Fuentes regulatorias configuradas" : "Configured regulatory sources"}
        description={
          es
            ? "Estos enlaces permiten revisar directamente qué publica cada institución. Una fuente configurada no equivale a cobertura completa."
            : "These links let you review what each institution publishes directly. A configured source does not mean complete coverage."
        }
      />
      <RegulatorySourceList sources={sources} lang={lang} />
    </AppShell>
  );
}

function ExplainerCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="card p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </div>
      <h3 className="serif mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
    </article>
  );
}

function RegulatorySourceList({
  sources,
  lang,
}: {
  sources: readonly SourceRegistryEntry[];
  lang: Lang;
}) {
  const es = lang === "es";
  return (
    <ul className="card divide-y overflow-hidden">
      {sources.map((source) => (
        <li
          key={source.id}
          className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <div className="min-w-0">
            <div className="font-semibold">{source.owner}</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              {source.coverage}
            </p>
          </div>
          {source.officialUrl ? (
            <ButtonLink
              href={source.officialUrl}
              external
              lang={lang}
              variant="quiet"
              className="shrink-0"
              ariaLabel={
                es
                  ? `Abrir fuente oficial de ${source.owner} en una pestaña nueva`
                  : `Open ${source.owner}'s official source in a new tab`
              }
            >
              {es ? "Abrir fuente oficial" : "Open official source"}
              <ArrowSquareOut size={17} aria-hidden="true" />
            </ButtonLink>
          ) : (
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {es ? "Enlace seguro no disponible" : "Secure link unavailable"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
