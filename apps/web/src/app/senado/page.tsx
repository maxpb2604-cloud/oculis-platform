import {
  getChamberActivity,
  getMonitoringHealth,
  getOfficialPublicationDocuments,
} from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { type ActivityItem } from "@/components/monitoring";
import { AgendaBrowser } from "@/components/agenda-browser";
import { CommitteeBubbles } from "@/components/committee-bubbles";
import { OfficialPublications } from "@/components/official-publications";
import { formatISODate } from "@/lib/format";
import { safeOfficialUrl } from "@/lib/input";
import { Kpi, SectionHeading } from "@/components/report-ui";
import { ButtonLink, NewTabNotice } from "@/components/ui/primitives";
import { ArrowRight, ArrowSquareOut, CalendarDots, UserList } from "@/components/ui/icons";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
type SenadoSearchParams = { lang?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SenadoSearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Senado de la República",
        description:
          "Actividad reciente, comisiones y publicaciones oficiales del Senado de la República.",
      }
    : {
        title: "Senate of the Republic",
        description:
          "Recent activity, committees, and official publications from the Senate of the Republic.",
      };
}

export default async function SenadoPage({
  searchParams,
}: {
  searchParams: Promise<SenadoSearchParams>;
}) {
  const lang: Lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const [items, publications, health] = await Promise.all([
    getChamberActivity("SENADO", 80) as Promise<ActivityItem[]>,
    getOfficialPublicationDocuments("SENADO"),
    getMonitoringHealth(),
  ]);
  const pleno = items.filter((i) => i.scope === "PLENARY");
  const asamblea = items.filter((i) => i.scope === "ASAMBLEA");
  const comisiones = items.filter((i) => i.scope === "COMMITTEE");
  const asistencia = comisiones.filter((i) => i.source === "sen-attendance");
  const asistenciaDocuments = groupAttendanceDocuments(asistencia);
  const agendasComision = comisiones.filter((i) => i.source !== "sen-attendance");
  const votesRun = health.find((row) => row.source === "sen-votes") ?? null;
  const votesDetails =
    votesRun?.details && typeof votesRun.details === "object" && !Array.isArray(votesRun.details)
      ? (votesRun.details as Record<string, unknown>)
      : null;
  const votesEmptyMessage =
    typeof votesDetails?.emptyMessage === "string" && votesDetails.emptyMessage.trim()
      ? votesDetails.emptyMessage
      : null;
  const langSuffix = lang === "en" ? "&lang=en" : "";

  return (
    <AppShell
      lang={lang}
      title={es ? "Senado de la República" : "Senate of the Republic"}
      subtitle={
        es
          ? "Perfil institucional, actividad reciente y publicaciones oficiales"
          : "Institutional profile, recent activity, and official publications"
      }
    >
      <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="eyebrow text-[var(--accent)]">
            {es ? "Cámara legislativa" : "Legislative chamber"}
          </div>
          <h2 className="section-title mt-2 max-w-[28ch]">
            {es
              ? "Actividad oficial del Senado, organizada por evidencia"
              : "Official Senate activity, organized by evidence"}
          </h2>
          <p className="page-subtitle mt-3">
            {es
              ? "Sesiones, Asamblea, reuniones de comisión y documentos publicados por sus fuentes oficiales."
              : "Sessions, Assembly, committee meetings, and documents published by official sources."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/hoy?chamber=senado${langSuffix}`} variant="primary">
            <CalendarDots size={18} aria-hidden="true" />
            {es ? "Ver agenda" : "View agenda"}
          </ButtonLink>
          <ButtonLink href={`/congreso?chamber=senado&view=committees${langSuffix}`}>
            <UserList size={18} aria-hidden="true" />
            {es ? "Ver comisiones" : "View committees"}
          </ButtonLink>
        </div>
      </section>

      <div className="mt-8 grid gap-5 border-b pb-8 sm:grid-cols-3">
        <Kpi
          value={pleno.length + asamblea.length}
          label={es ? "Pleno y Asamblea" : "Floor and Assembly"}
          accent="var(--accent)"
        />
        <Kpi
          value={agendasComision.length}
          label={es ? "Agendas de comisión" : "Committee agendas"}
          accent="var(--verified)"
        />
        <Kpi
          value={publications.length}
          label={es ? "Publicaciones mostradas" : "Publications shown"}
          accent="var(--warn)"
        />
      </div>

      <div>
        <SectionHeading
          title={es ? "Comisiones" : "Committees"}
          description={
            es ? "Reuniones y composición publicadas" : "Published meetings and membership"
          }
          action={
            <ButtonLink
              href={`/congreso?chamber=senado&view=committees${langSuffix}`}
              variant="quiet"
            >
              {es ? "Abrir directorio" : "Open directory"}
              <ArrowRight size={17} aria-hidden="true" />
            </ButtonLink>
          }
        />
        <CommitteeBubbles
          items={agendasComision}
          lang={lang}
          chamber={es ? "Senado" : "Senate"}
          showMembers={false}
        />
      </div>

      <div>
        <SectionHeading title={es ? "Asistencia a comisiones" : "Committee attendance"} />
        {asistenciaDocuments.length > 0 ? (
          <ul className="card divide-y overflow-hidden">
            {asistenciaDocuments.map((document) => (
              <li key={document.key} className="px-5 py-3 text-sm">
                <div className="font-medium">{document.description}</div>
                <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {document.dates.length}{" "}
                  {es
                    ? document.dates.length === 1
                      ? "fecha de reunión publicada"
                      : "fechas de reunión publicadas"
                    : document.dates.length === 1
                      ? "published meeting date"
                      : "published meeting dates"}
                  {document.dates.length > 0 && (
                    <> · {formatAttendanceDateRange(document.dates, lang)}</>
                  )}
                </div>
                {document.url && (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    {es ? "Ver documento de asistencia" : "View attendance document"}
                    <ArrowSquareOut size={15} aria-hidden="true" className="ml-1.5" />
                    <NewTabNotice lang={lang} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="card px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            {es
              ? "Esta conexión no contiene registros de asistencia almacenados."
              : "This connection contains no stored attendance records."}
          </div>
        )}
      </div>

      <div>
        <SectionHeading
          title={es ? "Pleno y Asamblea" : "Floor and Assembly"}
          description={
            es ? "Órdenes del día y documentos de sesión" : "Agendas and session documents"
          }
        />
        <AgendaBrowser
          lang={lang}
          sections={[
            {
              key: "pleno",
              title: es ? "Órdenes del día" : "Agendas",
              items: [...pleno, ...asamblea],
            },
          ]}
        />
      </div>

      <div>
        <SectionHeading title={es ? "Publicaciones oficiales" : "Official publications"} />
        <p className="mb-4 max-w-[78ch] text-sm text-[var(--text-muted)]">
          {es
            ? "La sección oficial de origen se conserva literalmente. Agendas, asistencias e informes no cambian por sí solos el estado de un PDL; aprobadas y perimidas solo se registran cuando la sección o el PDF lo declara."
            : "The official source section is preserved literally. Agendas, attendance files, and reports do not change a bill status by themselves; approved and expired events are recorded only when the section or PDF states them."}
        </p>
        <OfficialPublications items={publications} lang={lang} />
        <section className="mt-5 border-t pt-5">
          <h3 className="serif text-lg font-semibold">
            {es ? "Votaciones electrónicas" : "Electronic votes"}
          </h3>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {es
              ? "Documentos observados en la última ejecución"
              : "Documents observed in latest run"}
            : {votesRun ? votesRun.seen : es ? "No informado" : "Not reported"}
          </p>
          <p className="mt-2 text-sm">
            {votesEmptyMessage ? (
              <>
                <span className="font-medium">
                  {es ? "Mensaje literal de la fuente:" : "Literal source message:"}
                </span>{" "}
                {votesEmptyMessage}
              </>
            ) : es ? (
              "Mensaje literal de la fuente: No informado"
            ) : (
              "Literal source message: Not reported"
            )}
          </p>
        </section>
      </div>

      <div className="notice mt-8 text-sm" data-tone="warning">
        <span className="font-semibold" style={{ color: "var(--text)" }}>
          {es ? "Nota de cobertura:" : "Coverage note:"}
        </span>{" "}
        {es
          ? "las fichas del Sistema de Gestión de Expedientes Digitales se enlazan mediante una vista de consulta de solo lectura cuando la fuente senado-sil registra un IdExpediente. Las descargas y acciones que requieren la sesión protegida del sistema legado permanecen bloqueadas; sin identificador exacto, el enlace figura como No informado."
          : "Digital Records System records use a read-only lookup view only when the senado-sil source records an IdExpediente. Downloads and actions that require the legacy system's protected session remain blocked; without an exact identifier, the link is shown as Not reported."}
      </div>
    </AppShell>
  );
}

function groupAttendanceDocuments(items: ActivityItem[]) {
  const grouped = new Map<
    string,
    { key: string; description: string; url: string | null; dates: string[] }
  >();
  for (const item of items) {
    const url = safeOfficialUrl(item.agendaUrl, item.source);
    const key = url ?? `event:${item.id}`;
    const current = grouped.get(key) ?? {
      key,
      description: item.description,
      url,
      dates: [],
    };
    if (item.eventDate && !current.dates.includes(item.eventDate)) {
      current.dates.push(item.eventDate);
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].map((group) => ({
    ...group,
    dates: group.dates.sort(),
  }));
}

function formatAttendanceDateRange(dates: string[], lang: Lang): string {
  if (dates.length === 0) return "";
  const first = formatISODate(dates[0]!, lang);
  const last = formatISODate(dates[dates.length - 1]!, lang);
  return first === last ? first : `${first} – ${last}`;
}
