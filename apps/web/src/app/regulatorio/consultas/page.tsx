import type { Metadata } from "next";
import { getConsultas } from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Kpi, Panel, SectionHeading } from "@/components/report-ui";
import { RegulationList, type RegulationItem } from "@/components/monitoring";
import { ButtonLink, Notice } from "@/components/ui/primitives";
import {
  ArrowLeft,
  ArrowSquareOut,
  CalendarDots,
  FileText,
  ShieldCheck,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";
type ConsultasSearchParams = { lang?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ConsultasSearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Iniciativas en Consulta Pública",
        description:
          "Iniciativas regulatorias sometidas formalmente a Consulta Pública, con institución, documento, plazo y enlace oficial disponible.",
      }
    : {
        title: "Initiatives in Public Consultation",
        description:
          "Regulatory Initiatives in Public Consultation with the institution, document, deadline, and available official link.",
      };
}

export default async function ConsultasPage({
  searchParams,
}: {
  searchParams: Promise<ConsultasSearchParams>;
}) {
  const lang: Lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const consultas = (await getConsultas()) as RegulationItem[];
  const byInstitution = new Set(consultas.map((consulta) => consulta.institution)).size;
  const withDeadline = consultas.filter((consulta) => consulta.deadline).length;
  const openToday = consultas.filter((consulta) => consulta.consultationState === "OPEN").length;
  const upcoming = consultas.filter((consulta) => consulta.consultationState === "UPCOMING").length;
  const langSuffix = lang === "en" ? "?lang=en" : "";

  return (
    <AppShell
      lang={lang}
      title={es ? "Iniciativas en Consulta Pública" : "Initiatives in Public Consultation"}
      subtitle={
        es
          ? "Propuestas regulatorias sometidas formalmente a participación ciudadana"
          : "Regulatory proposals formally submitted for public participation"
      }
    >
      {consultas.length === 0 ? (
        <>
          <EmptyState
            lang={lang}
            title={
              es
                ? "Oculis todavía no tiene Iniciativas en Consulta Pública verificadas en esta base"
                : "Oculis does not yet have verified Initiatives in Public Consultation in this database"
            }
            description={
              es
                ? "Este estado no confirma que no existan Iniciativas en Consulta Pública abiertas. Solo indica que no hay registros cargados con título, institución y enlace oficial suficientes para mostrarlos responsablemente."
                : "This state does not confirm that no Initiatives in Public Consultation are open. It only means there are no loaded records with enough title, institution, and official-link evidence to display responsibly."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href={`/estado-fuentes${langSuffix}`} variant="primary">
                  <ShieldCheck size={18} aria-hidden="true" />
                  {es ? "Revisar cobertura" : "Review coverage"}
                </ButtonLink>
                <ButtonLink href={`/regulatorio${langSuffix}`}>
                  <ArrowLeft size={17} aria-hidden="true" />
                  {es ? "Volver a Regulatorio" : "Back to Regulatory"}
                </ButtonLink>
              </div>
            }
          />

          <SectionHeading
            title={
              es
                ? "Cómo se mostrará una Iniciativa en Consulta Pública"
                : "How an Initiative in Public Consultation will be shown"
            }
            description={
              es
                ? "La información aparecerá solo cuando pueda atribuirse a una publicación oficial concreta."
                : "Information will appear only when it can be attributed to a specific official publication."
            }
          />
          <div className="grid gap-3 md:grid-cols-3">
            <FactCard
              icon={<FileText size={22} aria-hidden="true" />}
              title={es ? "Título y entidad" : "Title and institution"}
              description={
                es
                  ? "El nombre del documento y la institución que lo publica."
                  : "The document name and the institution that publishes it."
              }
            />
            <FactCard
              icon={<CalendarDots size={22} aria-hidden="true" />}
              title={es ? "Plazo informado" : "Reported deadline"}
              description={
                es
                  ? "La fecha límite solo si aparece en la fuente; de lo contrario, “No informado”."
                  : "The deadline only when it appears in the source; otherwise, “Not reported.”"
              }
            />
            <FactCard
              icon={<ArrowSquareOut size={22} aria-hidden="true" />}
              title={es ? "Publicación oficial" : "Official publication"}
              description={
                es
                  ? "Un enlace directo al documento o a la página oficial correspondiente."
                  : "A direct link to the document or its corresponding official page."
              }
            />
          </div>
        </>
      ) : (
        <>
          <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="eyebrow text-[var(--accent)]">
                {es ? "Plazos publicados" : "Published deadlines"}
              </div>
              <h2 className="section-title mt-2 max-w-[32ch]">
                {es
                  ? "Abra la fuente antes de actuar sobre una fecha"
                  : "Open the source before acting on a date"}
              </h2>
              <p className="page-subtitle mt-3">
                {es
                  ? "Una Iniciativa en Consulta Pública es una propuesta regulatoria que una institución somete formalmente a participación ciudadana para recibir comentarios, observaciones o propuestas dentro de un plazo anunciado. Oculis organiza esos registros, pero la publicación oficial sigue siendo la evidencia principal para documentos, requisitos y fechas."
                  : "An Initiative in Public Consultation is a regulatory proposal that an institution formally submits for public participation to receive comments, observations, or proposals during an announced window. Oculis organizes those records, but the official publication remains the primary evidence for documents, requirements, and dates."}
              </p>
            </div>
            <ButtonLink href={`/regulatorio${langSuffix}`}>
              <ArrowLeft size={17} aria-hidden="true" />
              {es ? "Volver a Regulatorio" : "Back to Regulatory"}
            </ButtonLink>
          </section>

          <div className="mt-8 grid gap-5 border-b pb-8 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              value={openToday}
              label={
                es
                  ? "Iniciativas en Consulta Pública abiertas hoy"
                  : "Initiatives in Public Consultation open today"
              }
              accent="var(--verified)"
            />
            <Kpi
              value={upcoming}
              label={
                es
                  ? "Iniciativas en Consulta Pública próximas"
                  : "Upcoming Initiatives in Public Consultation"
              }
              accent="var(--warn)"
            />
            <Kpi
              value={byInstitution}
              label={es ? "Instituciones con registros" : "Institutions with records"}
              accent="var(--verified)"
            />
            <Kpi
              value={withDeadline}
              label={es ? "Con plazo informado" : "With a reported deadline"}
              accent="var(--warn)"
            />
          </div>

          <div className="mt-8">
            <Panel
              title={
                es
                  ? `Iniciativas en Consulta Pública · ${consultas.length}`
                  : `Initiatives in Public Consultation · ${consultas.length}`
              }
              flush
            >
              <RegulationList
                items={consultas}
                lang={lang}
                empty={
                  es
                    ? "No hay Iniciativas en Consulta Pública verificadas en esta base."
                    : "There are no verified Initiatives in Public Consultation in this database."
                }
              />
            </Panel>
          </div>
          <Notice className="mt-5 text-sm" tone="warning">
            {es
              ? "Antes de preparar una respuesta a una Iniciativa en Consulta Pública, confirme los requisitos en el enlace oficial. Oculis la clasifica como “abierta hoy” únicamente cuando el plazo publicado incluye la fecha actual o la fuente declara expresamente abierto el período para recibir observaciones."
              : "Before responding to an Initiative in Public Consultation, confirm the requirements through the official link. Oculis classifies it as “open today” only when the published window includes the current date or the source expressly states that the comment period is open."}
          </Notice>
        </>
      )}
    </AppShell>
  );
}

function FactCard({
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
