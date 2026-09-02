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
        title: "Consultas públicas",
        description:
          "Consultas públicas regulatorias con institución, documento, plazo y enlace oficial disponible.",
      }
    : {
        title: "Public consultations",
        description:
          "Regulatory public consultations with the institution, document, deadline, and available official link.",
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
  const langSuffix = lang === "en" ? "?lang=en" : "";

  return (
    <AppShell
      lang={lang}
      title={es ? "Consultas públicas" : "Public consultations"}
      subtitle={
        es
          ? "Borradores, documentos y plazos publicados por las instituciones monitoreadas"
          : "Drafts, documents, and deadlines published by monitored institutions"
      }
    >
      {consultas.length === 0 ? (
        <>
          <EmptyState
            lang={lang}
            title={
              es
                ? "Oculis todavía no tiene consultas públicas verificadas en esta base"
                : "Oculis does not yet have verified public consultations in this database"
            }
            description={
              es
                ? "Este estado no confirma que no existan consultas abiertas. Solo indica que no hay registros cargados con título, institución y enlace oficial suficientes para mostrarlos responsablemente."
                : "This state does not confirm that no consultations are open. It only means there are no loaded records with enough title, institution, and official-link evidence to display responsibly."
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
            title={es ? "Cómo se mostrará una consulta" : "How a consultation will be shown"}
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
                  ? "Oculis organiza las consultas registradas, pero la publicación oficial sigue siendo la evidencia principal para documentos, requisitos y plazos."
                  : "Oculis organizes recorded consultations, but the official publication remains the primary evidence for documents, requirements, and deadlines."}
              </p>
            </div>
            <ButtonLink href={`/regulatorio${langSuffix}`}>
              <ArrowLeft size={17} aria-hidden="true" />
              {es ? "Volver a Regulatorio" : "Back to Regulatory"}
            </ButtonLink>
          </section>

          <div className="mt-8 grid gap-5 border-b pb-8 sm:grid-cols-3">
            <Kpi
              value={consultas.length}
              label={es ? "Consultas registradas" : "Recorded consultations"}
              accent="var(--accent)"
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
              title={es ? "Consultas públicas registradas" : "Recorded public consultations"}
              flush
            >
              <RegulationList
                items={consultas}
                lang={lang}
                empty={
                  es
                    ? "No hay consultas públicas verificadas en esta base."
                    : "There are no verified public consultations in this database."
                }
              />
            </Panel>
          </div>
          <Notice className="mt-5 text-sm" tone="warning">
            {es
              ? "Antes de preparar una respuesta, confirme el plazo y los requisitos en el enlace oficial. Oculis no completa fechas ausentes ni interpreta si una consulta continúa abierta."
              : "Before preparing a response, confirm the deadline and requirements through the official link. Oculis does not fill missing dates or interpret whether a consultation remains open."}
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
