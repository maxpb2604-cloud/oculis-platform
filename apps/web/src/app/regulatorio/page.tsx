import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  getAdminClientChoices,
  getRegulatoryOverview,
  SOURCE_REGISTRY,
  type RegulatoryInstitutionSummary,
  type SourceRegistryEntry,
} from "@/lib/data";
import { getAdminSession } from "@/lib/admin-auth";
import { formatISODate } from "@/lib/format";
import { parseLang, type Lang } from "@/lib/i18n";
import type { RegulatoryProcessStage } from "@/lib/regulatory-status";
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
type RegulatorioSearchParams = { lang?: string; institution?: string };

const INSTITUTION_PRESENTATION: Record<
  string,
  {
    name: string;
    nameEn: string;
    logo?: string;
    width?: number;
    height?: number;
    logoBackground?: string;
  }
> = {
  MISPAS: {
    name: "Ministerio de Salud Pública",
    nameEn: "Ministry of Public Health",
    logo: "/assets/oculis/institutions/mispas.png",
    width: 1951,
    height: 941,
  },
  PROCONSUMIDOR: {
    name: "Pro Consumidor",
    nameEn: "Pro Consumidor",
    logo: "/assets/oculis/institutions/proconsumidor.png",
    width: 300,
    height: 85,
  },
  INDOTEL: {
    name: "Instituto Dominicano de las Telecomunicaciones",
    nameEn: "Dominican Telecommunications Institute",
    logo: "/assets/oculis/institutions/indotel.png",
    width: 355,
    height: 104,
  },
  INDOCAL: {
    name: "Instituto Dominicano para la Calidad",
    nameEn: "Dominican Institute for Quality",
    logo: "/assets/oculis/institutions/indocal.png",
    width: 350,
    height: 86,
  },
  MICM: {
    name: "Ministerio de Industria, Comercio y Mipymes",
    nameEn: "Ministry of Industry, Commerce and MSMEs",
    logo: "/assets/oculis/institutions/micm.svg",
    width: 235,
    height: 40,
  },
  INTRANT: {
    name: "Instituto Nacional de Tránsito y Transporte Terrestre",
    nameEn: "National Institute of Transit and Land Transportation",
    logo: "/assets/oculis/institutions/intrant.png",
    width: 419,
    height: 170,
  },
  MIMARENA: {
    name: "Ministerio de Medio Ambiente y Recursos Naturales",
    nameEn: "Ministry of Environment and Natural Resources",
    logo: "/assets/oculis/institutions/mimarena.svg",
    width: 450,
    height: 60,
  },
  SUPERSEGURO: {
    name: "Superintendencia de Seguros",
    nameEn: "Superintendency of Insurance",
    logo: "/assets/oculis/institutions/superseguros.png",
    width: 2560,
    height: 578,
  },
  SIMV: {
    name: "Superintendencia del Mercado de Valores",
    nameEn: "Securities Market Superintendency",
    logo: "/assets/oculis/institutions/simv.png",
    width: 507,
    height: 87,
  },
  SISALRIL: {
    name: "Superintendencia de Salud y Riesgos Laborales",
    nameEn: "Superintendency of Health and Labor Risks",
    logo: "/assets/oculis/institutions/sisalril.svg",
    width: 982,
    height: 332,
  },
  SB: {
    name: "Superintendencia de Bancos",
    nameEn: "Superintendency of Banks",
    logo: "/assets/oculis/institutions/sb.svg",
    width: 366,
    height: 44,
    logoBackground: "#0d3048",
  },
};

const REGULATORY_PROCESS_STAGE_LABELS: Record<RegulatoryProcessStage, { es: string; en: string }> =
  {
    DRAFT: { es: "en borrador", en: "in draft" },
    AGENDA: { es: "en agenda", en: "on an agenda" },
    IN_DEVELOPMENT: { es: "en elaboración", en: "in development" },
    TO_START: { es: "por iniciar", en: "not started" },
    IN_PROCESS: { es: "en proceso", en: "in process" },
    INITIATIVE: { es: "con estado «Iniciativa»", en: "with ‘Initiative’ status" },
  };

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
          "Instrumentos e Iniciativas en Consulta Pública con fechas y enlaces de fuentes regulatorias oficiales.",
      }
    : {
        title: "Regulatory monitoring",
        description:
          "Regulatory instruments and Initiatives in Public Consultation with dates and links to official sources.",
      };
}

export default async function RegulatorioPage({
  searchParams,
}: {
  searchParams: Promise<RegulatorioSearchParams>;
}) {
  const params = await searchParams;
  const lang: Lang = parseLang(params.lang);
  const es = lang === "es";
  const {
    kpis,
    byInstitution,
    openByInstitution,
    recent,
    selectedInstitution,
    selectedRegulations,
  } = await getRegulatoryOverview({ institution: params.institution });
  const adminSession = await getAdminSession();
  const adminClients = adminSession ? await getAdminClientChoices() : undefined;
  const sources = SOURCE_REGISTRY.filter((source) => source.id.startsWith("reg-"));
  const langSuffix = lang === "en" ? "?lang=en" : "";
  const hasData = kpis.total > 0;
  const regulatoryHref = (institution?: string) => {
    const query = new URLSearchParams();
    if (lang === "en") query.set("lang", "en");
    if (institution) query.set("institution", institution);
    const suffix = query.size ? `?${query.toString()}` : "";
    return `/regulatorio${suffix}${institution ? "#institution-regulations" : ""}`;
  };

  return (
    <AppShell
      lang={lang}
      title={es ? "Monitoreo regulatorio" : "Regulatory monitoring"}
      subtitle={
        es
          ? "Iniciativas regulatorias e Iniciativas en Consulta Pública organizadas desde sus fuentes oficiales"
          : "Regulatory initiatives and Initiatives in Public Consultation organized from official sources"
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
                  {es
                    ? "Ver Iniciativas en Consulta Pública"
                    : "View Initiatives in Public Consultation"}
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
                {es ? "Vista institucional" : "Institutional view"}
              </div>
              <h2 className="section-title mt-2 max-w-[30ch]">
                {es
                  ? "Qué Iniciativas en Consulta Pública están abiertas hoy"
                  : "Which Initiatives in Public Consultation are open today"}
              </h2>
              <p className="page-subtitle mt-3">
                {es
                  ? "Una Iniciativa en Consulta Pública es una propuesta regulatoria sometida formalmente a participación ciudadana para recibir observaciones dentro de un plazo oficial. Solo figura como abierta hoy cuando la fuente publica ese estado o un plazo que incluye la fecha actual."
                  : "An Initiative in Public Consultation is a regulatory proposal formally submitted for public participation so comments can be received during an official window. It appears as open today only when the source publishes that status or a window that includes today."}
              </p>
            </div>
            <ButtonLink href={`/regulatorio/consultas${langSuffix}`} variant="primary">
              <CalendarDots size={18} aria-hidden="true" />
              {es
                ? "Ver Iniciativas en Consulta Pública"
                : "View Initiatives in Public Consultation"}
            </ButtonLink>
          </section>

          <div className="mt-8 grid gap-5 border-b pb-8 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              value={kpis.openToday}
              label={
                es
                  ? "Iniciativas en Consulta Pública abiertas hoy"
                  : "Initiatives in Public Consultation open today"
              }
              accent="var(--verified)"
            />
            <Kpi
              value={kpis.inProcess}
              label={
                es ? "Iniciativas en proceso regulatorio" : "Initiatives in regulatory process"
              }
              accent="var(--warn)"
            >
              <ul
                className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t pt-2 text-[11px] leading-snug text-[var(--text-muted)]"
                aria-label={
                  es
                    ? `Desglose de ${kpis.inProcess} iniciativas por estado del proceso regulatorio`
                    : `Breakdown of ${kpis.inProcess} initiatives by regulatory process stage`
                }
              >
                {kpis.inProcessByStage.map((item) => (
                  <li key={item.stage}>
                    <span className="tnum font-semibold text-[var(--text)]">{item.count}</span>{" "}
                    {REGULATORY_PROCESS_STAGE_LABELS[item.stage][lang]}
                  </li>
                ))}
              </ul>
            </Kpi>
            <Kpi
              value={kpis.institutions}
              label={es ? "Instituciones observadas" : "Observed institutions"}
              accent="var(--accent)"
            />
            <Kpi
              value={kpis.total}
              label={
                es
                  ? "Iniciativas regulatorias registradas en la base de datos"
                  : "Regulatory initiatives registered in the database"
              }
              accent="var(--text-muted)"
            />
          </div>

          <SectionHeading
            title={
              es
                ? "Iniciativas en Consulta Pública abiertas hoy por institución"
                : "Initiatives in Public Consultation open today by institution"
            }
            description={
              es
                ? "Conteo sustentado por el plazo o estado publicado en la fuente oficial."
                : "Count supported by the deadline or status published by the official source."
            }
          />
          {openByInstitution.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {openByInstitution.map((item) => (
                <Link
                  key={item.key}
                  href={regulatoryHref(item.key)}
                  className="card elev flex items-center justify-between gap-4 p-5 transition hover:border-[var(--verified)]"
                >
                  <div>
                    <div className="eyebrow text-[var(--verified)]">
                      {es
                        ? "Iniciativas en Consulta Pública abiertas hoy"
                        : "Initiatives in Public Consultation open today"}
                    </div>
                    <div className="mt-2 text-lg font-semibold">{item.key}</div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {INSTITUTION_PRESENTATION[item.key]?.[es ? "name" : "nameEn"] ?? item.key}
                    </p>
                  </div>
                  <div className="tnum text-4xl font-semibold text-[var(--verified)]">
                    {item.openCount}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Notice tone="warning">
              {es
                ? `No hay Iniciativas en Consulta Pública abiertas hoy demostradas por fecha o estado. ${kpis.unknown} expediente(s) siguen sin datos suficientes para clasificarlos.`
                : `No Initiatives in Public Consultation are proven open today by date or status. ${kpis.unknown} record(s) still lack enough data to classify them.`}
            </Notice>
          )}

          <SectionHeading
            title={es ? "Directorio regulatorio" : "Regulatory directory"}
            description={
              es
                ? "Incluye toda institución actualmente representada en el registro nacional y las fuentes institucionales directas configuradas por Oculis."
                : "Each card opens the regulatory initiatives filed by that institution."
            }
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {byInstitution.map((item) => (
              <InstitutionCard
                key={item.key}
                item={item}
                lang={lang}
                href={regulatoryHref(item.key)}
                selected={selectedInstitution === item.key}
              />
            ))}
          </div>

          {selectedInstitution && (
            <div id="institution-regulations" className="scroll-mt-24 pt-10">
              <Panel
                title={`${
                  es ? "Iniciativas regulatorias de" : "Regulatory initiatives from"
                } ${selectedInstitution} · ${selectedRegulations.length}`}
                action={
                  <ButtonLink href={regulatoryHref()} variant="quiet">
                    {es ? "Ver todas las instituciones" : "View all institutions"}
                  </ButtonLink>
                }
                flush
              >
                <RegulationList
                  items={selectedRegulations as RegulationItem[]}
                  lang={lang}
                  adminClients={adminClients}
                  empty={
                    es
                      ? "Esta institución no tiene iniciativas verificadas en la base."
                      : "This institution has no verified initiatives in the database."
                  }
                />
              </Panel>
            </div>
          )}

          <SectionHeading
            title={
              es
                ? "Últimas iniciativas regulatorias depositadas"
                : "Latest filed regulatory initiatives"
            }
            description={
              es
                ? "Feed cronológico según la fecha de publicación informada por cada fuente oficial."
                : "A chronological feed based on the publication date reported by each official source."
            }
          />
          <Panel
            title={
              es
                ? `Publicaciones recientes · ${recent.length}`
                : `Recent publications · ${recent.length}`
            }
            flush
          >
            <RegulationList
              items={recent as RegulationItem[]}
              lang={lang}
              adminClients={adminClients}
              empty={
                es
                  ? "No hay iniciativas regulatorias recientes verificadas en esta base."
                  : "There are no recently verified regulatory initiatives in this database."
              }
            />
          </Panel>

          <Notice className="mt-6 text-sm">
            {es
              ? "“Iniciativa en Consulta Pública” identifica una propuesta regulatoria sometida formalmente a participación ciudadana. “Abierta hoy” significa que la fecha actual cae dentro del plazo oficial publicado o que la fuente declara expresamente abierto el período para recibir observaciones. Estar en agenda, borrador o proceso regulatorio no convierte por sí solo un expediente en una Iniciativa en Consulta Pública abierta."
              : "“Initiative in Public Consultation” identifies a regulatory proposal formally submitted for public participation. “Open today” means today falls within the official published window or the source expressly states that the comment period is open. Being on an agenda, in draft, or in a regulatory process does not by itself make a record an open Initiative in Public Consultation."}
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

function InstitutionCard({
  item,
  lang,
  href,
  selected,
}: {
  item: RegulatoryInstitutionSummary;
  lang: Lang;
  href: string;
  selected: boolean;
}) {
  const es = lang === "es";
  const presentation = INSTITUTION_PRESENTATION[item.key];
  const deadlineLabel = es ? "Plazo oficial informado" : "Official deadline reported";

  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={`group card elev overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        selected ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]" : ""
      }`}
    >
      <article className="flex h-full flex-col">
        <div
          className="flex min-h-28 items-center justify-center border-b px-6 py-5"
          style={{ backgroundColor: presentation?.logoBackground ?? "#ffffff" }}
        >
          {presentation?.logo ? (
            <Image
              src={presentation.logo}
              alt={`${es ? "Logo de" : "Logo of"} ${presentation.name}`}
              width={presentation.width ?? 320}
              height={presentation.height ?? 100}
              className="h-16 w-full object-contain"
            />
          ) : (
            <div className="flex h-16 items-center justify-center gap-3 text-slate-700">
              <FileMagnifyingGlass size={30} aria-hidden="true" />
              <span className="text-lg font-bold">{item.key}</span>
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold">{item.key}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)]">
                {presentation ? (es ? presentation.name : presentation.nameEn) : item.key}
              </p>
            </div>
            <ArrowRight
              size={20}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-[var(--accent)] transition-transform group-hover:translate-x-1"
            />
          </div>
          <dl className="mt-5 grid grid-cols-2 divide-x border-y py-3">
            <div className="pr-4">
              <dt className="eyebrow">
                {es ? "Iniciativas registradas" : "Registered initiatives"}
              </dt>
              <dd className="tnum mt-1 text-2xl font-semibold">{item.count.toLocaleString()}</dd>
            </div>
            <div className="pl-4">
              <dt className="eyebrow">
                {es
                  ? "Iniciativas en Consulta Pública abiertas hoy"
                  : "Initiatives in Public Consultation open today"}
              </dt>
              <dd className="tnum mt-1 text-2xl font-semibold text-[var(--verified)]">
                {item.openCount.toLocaleString()}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {deadlineLabel}: {item.deadlineReportedCount}/{item.count}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {es ? "En proceso regulatorio" : "In regulatory process"}: {item.inProcessCount}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {es ? "Última publicación" : "Latest publication"}:{" "}
            {item.latestPublishedAt
              ? formatISODate(item.latestPublishedAt, lang)
              : es
                ? "No informada"
                : "Not reported"}
          </p>
        </div>
      </article>
    </Link>
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
