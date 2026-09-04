import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowSquareOut,
  Buildings,
  CalendarBlank,
  Clock,
  FileText,
  HashStraight,
  Info,
  ListChecks,
  MapPin,
  SealCheck,
} from "@phosphor-icons/react/dist/ssr";
import { AppShell } from "@/components/app-shell";
import { CopyTextButton } from "@/components/copy-text-button";
import { officialExpedienteReferences, publishedAgendaTopic } from "@/lib/agenda-topics";
import { safeOfficialActivityUrl } from "@/lib/activity-links";
import { getActivity } from "@/lib/data";
import { formatISODate, formatOfficialTime } from "@/lib/format";
import { langQuery, parseLang, type Lang } from "@/lib/i18n";
import { dateSpanDays, isISODate, positiveInteger } from "@/lib/input";
import { initiativeDetailHref } from "@/lib/initiative-links";
import { NewTabNotice } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

type AgendaSearchParams = {
  lang?: string;
  date?: string;
  from?: string;
  to?: string;
  chamber?: string;
  view?: string;
  returnTo?: string;
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<AgendaSearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Detalle de agenda",
        description:
          "Registro de una actividad legislativa con fecha, hora, contenido y evidencia oficial.",
      }
    : {
        title: "Agenda details",
        description:
          "Legislative activity record with its date, time, content, and official evidence.",
      };
}

const SOURCE_LABELS: Record<string, { es: string; en: string }> = {
  "sil-actividad": { es: "Cámara de Diputados · SIL", en: "Chamber of Deputies · SIL" },
  senado: { es: "Senado de la República", en: "Senate of the Republic" },
  "dip-oficial": { es: "Cámara de Diputados", en: "Chamber of Deputies" },
};

function formatObserved(value: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
    timeZone: "America/Santo_Domingo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AgendaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<AgendaSearchParams>;
}) {
  const sp = await searchParams;
  const lang: Lang = parseLang(sp.lang);
  const es = lang === "es";
  const id = positiveInteger((await params).id);
  if (id == null) notFound();

  const agenda = await getActivity(id);
  if (!agenda) notFound();

  const missing = es ? "No informado por la fuente" : "Not reported by the source";
  const sourceLabel = SOURCE_LABELS[agenda.source]?.[lang] ?? agenda.source;
  const isDiputadosSil = agenda.source === "sil-actividad";
  const officialHref = safeOfficialActivityUrl(
    agenda.agendaUrl,
    agenda.source,
    agenda.sourceEventId,
  );
  const back = new URLSearchParams();
  if (lang === "en") back.set("lang", "en");
  const hasRange = Boolean(
    isISODate(sp.from) &&
    isISODate(sp.to) &&
    sp.from <= sp.to &&
    dateSpanDays(sp.from, sp.to) <= 366,
  );
  if (hasRange) {
    back.set("from", sp.from!);
    back.set("to", sp.to!);
  } else {
    const returnDate = isISODate(sp.date)
      ? sp.date
      : isISODate(agenda.eventDate ?? undefined)
        ? agenda.eventDate
        : null;
    if (returnDate) back.set("date", returnDate);
  }
  const returnChamber = sp.chamber === "senado" || agenda.chamber === "SENADO" ? "senado" : null;
  if (returnChamber) back.set("chamber", returnChamber);
  if (sp.view === "week" || sp.view === "day") back.set("view", sp.view);
  const backQuery = back.toString();
  const backHref =
    sp.returnTo === "inicio"
      ? `/${langQuery(lang)}`
      : sp.returnTo === "actualidad"
        ? `/feed${langQuery(lang)}`
        : `/hoy${backQuery ? `?${backQuery}` : ""}`;
  const backLabel =
    sp.returnTo === "inicio"
      ? es
        ? "Volver al inicio"
        : "Back to home"
      : sp.returnTo === "actualidad"
        ? es
          ? "Volver a Movimientos del Congreso"
          : "Back to Congressional movements"
        : es
          ? "Volver a Comisiones & Agendas"
          : "Back to Committees & Agendas";
  const scopeLabel =
    agenda.scope === "COMMITTEE"
      ? es
        ? "Comisión"
        : "Committee"
      : agenda.scope === "ASAMBLEA"
        ? es
          ? "Asamblea"
          : "Assembly"
        : es
          ? "Pleno"
          : "Floor";
  const pageTitle =
    agenda.scope === "COMMITTEE"
      ? es
        ? "Agenda de comisión"
        : "Committee agenda"
      : agenda.scope === "ASAMBLEA"
        ? es
          ? "Agenda de asamblea"
          : "Assembly agenda"
        : es
          ? "Agenda del pleno"
          : "Floor agenda";
  const agendaTopic = publishedAgendaTopic(agenda.description, agenda.body);
  const expedienteReferences = officialExpedienteReferences(agenda.raw);
  const hasPublishedTopics = Boolean(
    agendaTopic || agenda.initiatives.length || expedienteReferences.length,
  );

  return (
    <AppShell
      lang={lang}
      title={pageTitle}
      subtitle={[sourceLabel, agenda.eventDate ? formatISODate(agenda.eventDate, lang) : null]
        .filter(Boolean)
        .join(" · ")}
    >
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline-offset-2 hover:underline"
        style={{ color: "var(--accent)" }}
      >
        <ArrowLeft size={17} aria-hidden />
        {backLabel}
      </Link>

      <article className="mt-3">
        <header
          className="overflow-hidden rounded-xl border px-5 py-6 sm:px-7 sm:py-7"
          style={{ background: "var(--surface)" }}
        >
          <div
            className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--accent)" }}
          >
            <SealCheck size={21} weight="fill" aria-hidden />
            {es ? "Registro oficial" : "Official record"}
            <span style={{ color: "var(--text-muted)" }}>· {scopeLabel}</span>
          </div>
          <h2 className="serif mt-4 max-w-4xl text-[clamp(1.55rem,3vw,2.45rem)] font-semibold leading-[1.14]">
            {agenda.body || (es ? "Agenda oficial" : "Official agenda")}
          </h2>

          <dl className="mt-6 grid gap-4 border-y py-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex gap-3">
              <CalendarBlank size={20} style={{ color: "var(--accent)" }} aria-hidden />
              <div>
                <dt className="eyebrow">{es ? "Fecha" : "Date"}</dt>
                <dd className="mt-1 font-medium">
                  {agenda.eventDate ? formatISODate(agenda.eventDate, lang) : missing}
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Clock size={20} style={{ color: "var(--accent)" }} aria-hidden />
              <div>
                <dt className="eyebrow">{es ? "Hora" : "Time"}</dt>
                <dd className="mt-1 font-medium">
                  {agenda.eventTime ? formatOfficialTime(agenda.eventTime, lang) : missing}
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Buildings size={20} style={{ color: "var(--accent)" }} aria-hidden />
              <div>
                <dt className="eyebrow">{es ? "Tipo" : "Type"}</dt>
                <dd className="mt-1 font-medium">{agenda.kind || missing}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <MapPin size={20} style={{ color: "var(--accent)" }} aria-hidden />
              <div>
                <dt className="eyebrow">{es ? "Lugar" : "Location"}</dt>
                <dd className="mt-1 font-medium">{agenda.location || missing}</dd>
              </div>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {officialHref ? (
              <a
                href={officialHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-110"
                style={{ background: "var(--accent)" }}
              >
                {isDiputadosSil
                  ? es
                    ? "Abrir agenda oficial"
                    : "Open official agenda"
                  : es
                    ? "Abrir documento oficial"
                    : "Open official document"}
                <ArrowSquareOut size={17} aria-hidden />
                <NewTabNotice lang={lang} />
              </a>
            ) : (
              <span
                className="max-w-xl text-sm leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                {es
                  ? isDiputadosSil
                    ? "La Cámara todavía no ha publicado un PDF disponible para esta fecha."
                    : "La fuente no publicó un enlace oficial exacto para esta actividad."
                  : isDiputadosSil
                    ? "The Chamber has not yet published an available PDF for this date."
                    : "The source did not publish an exact official link for this activity."}
              </span>
            )}
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
          <div className="space-y-5">
            <section className="rounded-xl border p-5 sm:p-6" aria-labelledby="agenda-topics">
              <div className="flex items-start gap-3">
                <span
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  <ListChecks size={22} aria-hidden />
                </span>
                <div>
                  <p className="eyebrow">{es ? "Agenda oficial" : "Official agenda"}</p>
                  <h2 id="agenda-topics" className="serif mt-1 text-xl font-semibold sm:text-2xl">
                    {es ? "Temas pautados para esta reunión" : "Topics scheduled for this meeting"}
                  </h2>
                  <p
                    className="mt-1 text-sm leading-relaxed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {es
                      ? "Contenido publicado por la cámara para la fecha de esta comisión."
                      : "Content published by the chamber for this committee date."}
                  </p>
                </div>
              </div>

              {agendaTopic && (
                <div
                  className="mt-5 rounded-lg border p-4 sm:p-5"
                  style={{ background: "var(--surface-2)" }}
                >
                  <p className="eyebrow">{es ? "Tema publicado" : "Published topic"}</p>
                  <p className="mt-2 select-text whitespace-pre-wrap text-[15px] font-medium leading-relaxed">
                    {agendaTopic}
                  </p>
                </div>
              )}

              {agenda.initiatives.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold">
                    {es
                      ? `Iniciativas incluidas (${agenda.initiatives.length})`
                      : `Initiatives included (${agenda.initiatives.length})`}
                  </h3>
                  <ul className="mt-3 grid gap-2 text-sm">
                    {agenda.initiatives.map((initiative) => (
                      <li
                        key={`${initiative.code}-${initiative.initiativeId ?? "unresolved"}`}
                        className="rounded-lg border px-4 py-3"
                      >
                        <div className="flex items-start gap-3">
                          <FileText
                            size={19}
                            className="mt-0.5 shrink-0"
                            style={{ color: "var(--accent)" }}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p
                              className="font-mono text-[11px]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {initiative.code}
                            </p>
                            {initiative.initiativeId ? (
                              <Link
                                href={initiativeDetailHref(initiative.initiativeId, lang)}
                                className="mt-1 inline-flex font-semibold leading-relaxed underline-offset-2 hover:underline"
                                style={{ color: "var(--accent)" }}
                              >
                                {initiative.title ||
                                  (es ? "Abrir ficha de la iniciativa" : "Open initiative record")}
                              </Link>
                            ) : (
                              <p className="mt-1 font-medium leading-relaxed">
                                {initiative.title ||
                                  (es
                                    ? "La fuente no publicó un título enlazable."
                                    : "The source did not publish a linkable title.")}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {expedienteReferences.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold">
                    {es ? "Expedientes citados por la agenda" : "Files cited by the agenda"}
                  </h3>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {expedienteReferences.map((reference) => (
                      <li
                        key={reference}
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs"
                      >
                        <HashStraight size={15} style={{ color: "var(--accent)" }} aria-hidden />
                        {es ? `Expediente ${reference}` : `File ${reference}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!hasPublishedTopics && (
                <div className="notice mt-5 text-sm leading-relaxed" data-tone="warning">
                  {es
                    ? "La agenda oficial no detalla los temas ni identifica iniciativas específicas para esta reunión."
                    : "The official agenda does not detail topics or identify specific initiatives for this meeting."}
                </div>
              )}

              <div
                className="mt-5 flex gap-2.5 rounded-lg px-3 py-3 text-xs leading-relaxed"
                style={{ background: "var(--accent-soft)", color: "var(--text-muted)" }}
              >
                <Info
                  size={18}
                  className="shrink-0"
                  style={{ color: "var(--accent)" }}
                  aria-hidden
                />
                <p>
                  {es
                    ? agenda.initiatives.length
                      ? "Estos son los asuntos e iniciativas que aparecen en la agenda oficial. La agenda no confirma qué fue debatido o decidido durante la reunión."
                      : "Este es el asunto que aparece en la agenda oficial. La fuente no enumera iniciativas específicas y Oculis no las completa por inferencia."
                    : agenda.initiatives.length
                      ? "These are the matters and initiatives listed in the official agenda. The agenda does not confirm what was debated or decided during the meeting."
                      : "This is the matter listed in the official agenda. The source does not enumerate specific initiatives, and Oculis does not infer them."}
                </p>
              </div>

              {agendaTopic && (
                <CopyTextButton
                  text={agendaTopic}
                  lang={lang}
                  className="mt-4"
                  ariaLabel={es ? "temas pautados" : "scheduled topics"}
                  idleLabel={es ? "Copiar temas" : "Copy topics"}
                />
              )}
            </section>
          </div>

          <aside className="h-fit rounded-xl border p-5" aria-labelledby="agenda-evidence">
            <FileText size={24} style={{ color: "var(--accent)" }} aria-hidden />
            <h2 id="agenda-evidence" className="serif mt-3 text-xl font-semibold">
              {es ? "Fuente oficial" : "Official source"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {sourceLabel}
            </p>
            {officialHref && (
              <a
                href={officialHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {es ? "Abrir evidencia" : "Open evidence"}
                <ArrowSquareOut size={16} aria-hidden />
                <NewTabNotice lang={lang} />
              </a>
            )}
            {isDiputadosSil && (
              <a
                href="https://camaradediputados.gob.do/agenda-comisiones/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex min-h-11 items-center gap-2 border-t pt-3 text-xs font-semibold hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                {es ? "Archivo oficial de agendas" : "Official agenda archive"}
                <ArrowSquareOut size={15} aria-hidden />
                <NewTabNotice lang={lang} />
              </a>
            )}
          </aside>
        </div>

        <details className="mt-5 rounded-xl border px-4 py-3 text-xs">
          <summary className="min-h-8 cursor-pointer font-semibold">
            {es ? "Detalles de procedencia" : "Source details"}
          </summary>
          <dl className="mt-3 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="eyebrow">{es ? "Fuente" : "Source"}</dt>
              <dd className="mt-1">{sourceLabel}</dd>
            </div>
            <div>
              <dt className="eyebrow">{es ? "Identificador oficial" : "Official identifier"}</dt>
              <dd className="mt-1 font-mono">{agenda.sourceEventId || missing}</dd>
            </div>
            <div>
              <dt className="eyebrow">{es ? "Primera consulta" : "First checked"}</dt>
              <dd className="mt-1">{formatObserved(agenda.firstSeenAt, lang)}</dd>
            </div>
            <div>
              <dt className="eyebrow">{es ? "Última comprobación" : "Last checked"}</dt>
              <dd className="mt-1">{formatObserved(agenda.lastSeenAt, lang)}</dd>
            </div>
          </dl>
        </details>
      </article>
    </AppShell>
  );
}
