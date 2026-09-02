import {
  ArrowLeft,
  ArrowSquareOut,
  Buildings,
  CalendarBlank,
  CaretDown,
  Circle,
  ClockCounterClockwise,
  FilePdf,
  FileText,
  HourglassHigh,
  Info,
  SealCheck,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import React, { type ReactNode } from "react";
import { isDepositedBillDocumentType } from "@oculis/core";
import { AppShell } from "@/components/app-shell";
import { CopyTextButton } from "@/components/copy-text-button";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";
import { getInitiative } from "@/lib/data";
import { formatISODate, formatISODateTime } from "@/lib/format";
import { parseLang, type Lang } from "@/lib/i18n";
import { positiveInteger, safeOfficialUrl } from "@/lib/input";
import {
  initiativeCatalogReturnHref,
  initiativeCatalogReturnLegislatorProfileId,
  officialInitiativeHref,
} from "@/lib/initiative-links";
import { initiativeTitlePresentation } from "@/lib/initiative-title";
import {
  currentLocationPresentation,
  expirationPresentation,
  type ProceduralFactPresentation,
} from "@/lib/initiative-procedural-presentation";
import { initiativeChamberLabel, officialStatusLabel } from "@/lib/legislative-labels";
import { officialDocumentCtaHref, officialDocumentLiveHref } from "@/lib/official-document-links";
import { partyDisplayLabel } from "@/lib/party-presentation";
import { initiativeSourceLabel } from "@/lib/source-labels";
import { statusEvidenceLabel } from "@/lib/status-events";
import { NewTabNotice } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

type InitiativeRouteProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string; returnTo?: string }>;
};

function safeMetadataText(value: string | null | undefined, maxLength: number): string {
  const clean = Array.from(value ?? "")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxLength) return clean;

  const clipped = clean.slice(0, Math.max(1, maxLength - 1));
  const boundary = clipped.lastIndexOf(" ");
  return `${(boundary > maxLength * 0.55 ? clipped.slice(0, boundary) : clipped).trimEnd()}…`;
}

export async function generateMetadata({
  params,
  searchParams,
}: InitiativeRouteProps): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const parsedId = positiveInteger((await params).id);
  if (parsedId == null) return { title: es ? "Iniciativa" : "Initiative" };

  const initiative = await getInitiative(parsedId);
  if (!initiative) return { title: es ? "Iniciativa no encontrada" : "Initiative not found" };

  const localizedTitle = initiativeTitlePresentation(initiative, lang);
  const code = safeMetadataText(initiative.code, 48);
  const title = safeMetadataText(localizedTitle.text, 96);
  const description = safeMetadataText(
    localizedTitle.isOculisTranslation
      ? localizedTitle.text
      : initiative.purpose || localizedTitle.text,
    160,
  );
  return {
    title: [code, title].filter(Boolean).join(" — ") || (es ? "Iniciativa" : "Initiative"),
    description:
      description ||
      (es
        ? "Estado, actores y evidencia oficial de esta iniciativa legislativa."
        : "Published status, participants, and official evidence for this legislative initiative."),
  };
}

export default async function Page({ params, searchParams }: InitiativeRouteProps) {
  const { id } = await params;
  const sp = await searchParams;
  const lang: Lang = parseLang(sp.lang);
  const es = lang === "es";
  const returnHref = initiativeCatalogReturnHref(sp.returnTo, lang);
  const focusedLegislatorProfileId = initiativeCatalogReturnLegislatorProfileId(sp.returnTo, lang);
  const parsedId = positiveInteger(id);
  if (parsedId == null) notFound();

  const initiative = await getInitiative(parsedId);
  if (!initiative) notFound();

  const localizedTitle = initiativeTitlePresentation(initiative, lang);
  const titleContextId = localizedTitle.isOculisTranslation
    ? "initiative-title-provenance"
    : localizedTitle.isTranslationPending
      ? "initiative-title-translation-pending"
      : undefined;
  const missing = es ? "No informado por la fuente" : "Not reported by the source";
  const officialHref = officialInitiativeHref(initiative, lang);
  const sourceLabel = initiativeSourceLabel(initiative.source, lang);
  const currentLocation = currentLocationPresentation(
    initiative.proceduralFacts.currentLocation,
    lang,
  );
  const expiration = expirationPresentation(initiative.proceduralFacts.expiration, lang);
  const officialDescription = initiative.purpose?.trim() || initiative.title.trim() || missing;
  const showPurpose =
    Boolean(initiative.purpose?.trim()) && initiative.purpose?.trim() !== initiative.title.trim();
  const focusedProponent =
    focusedLegislatorProfileId == null
      ? null
      : (initiative.proponents.find(
          (proponent) => proponent.profileId === focusedLegislatorProfileId,
        ) ?? null);
  const visibleProponents = focusedProponent
    ? [
        focusedProponent,
        ...initiative.proponents.filter((proponent) => proponent !== focusedProponent).slice(0, 4),
      ]
    : initiative.proponents.slice(0, 5);

  const documentRows = initiative.documents
    .map((document) => {
      const deposited =
        document.source === "sil-diputados" && isDepositedBillDocumentType(document.docType);
      const documentFacts = {
        source: document.source,
        docType: document.docType,
        url: document.url,
        pdfAvailable: document.pdfAvailable,
      };
      const href = deposited
        ? officialDocumentLiveHref(documentFacts, document.id, initiative.id, lang)
        : officialDocumentCtaHref(documentFacts, document.id, initiative.id, lang);
      return { document, deposited, href };
    })
    .sort((a, b) => Number(b.deposited) - Number(a.deposited));
  const primaryOfficialDocument = documentRows.find((row) => row.deposited && row.href);

  const eventTimestamp = (event: (typeof initiative.events)[number]) =>
    event.eventDate || event.observedAt || "";
  const recentEvents = [...initiative.events]
    .sort((a, b) => eventTimestamp(b).localeCompare(eventTimestamp(a)))
    .slice(0, 3);
  const fullEvents = [...initiative.events].sort((a, b) =>
    eventTimestamp(b).localeCompare(eventTimestamp(a)),
  );
  const contextualNews = initiative.relatedNews.filter(
    (item) => item.source !== "feed-legislative",
  );

  const completeFacts: Array<[string, string | null]> = [
    [es ? "Función del proponente" : "Sponsor role", initiative.sponsorRole],
    [es ? "Cantidad de proponentes" : "Sponsor count", initiative.sponsorCount?.toString() ?? null],
    [es ? "Partido" : "Party", partyDisplayLabel(initiative.party, null, lang)],
    [es ? "Provincia" : "Province", initiative.province],
    [es ? "Comisión" : "Committee", initiative.committee],
    [es ? "Tipo" : "Type", initiative.type],
    [es ? "Estado oficial" : "Official status", initiative.status],
    [
      es ? "Último cambio oficial" : "Latest official change",
      initiative.officialStatusChangedAt
        ? formatISODateTime(initiative.officialStatusChangedAt, lang)
        : null,
    ],
    [es ? "Condición oficial" : "Official condition", initiative.condition],
    [es ? "Cámara de la fuente" : "Source chamber", initiative.sourceChamber],
    [es ? "Cámara de origen" : "Origin chamber", initiative.originChamber],
    [es ? "Órgano actual publicado" : "Published current body", initiative.currentBody],
    [
      es ? "Fecha de depósito" : "Filing date",
      initiative.filedAt ? formatISODate(initiative.filedAt, lang) : null,
    ],
    [es ? "Categoría oficial" : "Official category", initiative.sourceCategory],
    [es ? "Materia" : "Subject matter", initiative.subjectMatter],
    [es ? "Iniciado" : "Initiated", initiative.initiated],
    [
      es ? "Fecha de inicio" : "Initiation date",
      initiative.initiatedAt ? formatISODate(initiative.initiatedAt, lang) : null,
    ],
    [es ? "Legislatura" : "Legislature", initiative.legislature],
    [es ? "Período de registro" : "Registration period", initiative.registrationPeriod],
    [es ? "N.º de promulgación" : "Promulgation number", initiative.promulgationNumber],
    [
      es ? "Fecha de promulgación" : "Promulgation date",
      initiative.promulgatedAt ? formatISODate(initiative.promulgatedAt, lang) : null,
    ],
    [es ? "Fuente" : "Source", sourceLabel],
    [es ? "ID en la fuente" : "Source ID", initiative.sourceId],
  ];

  return (
    <AppShell
      lang={lang}
      title={es ? "Iniciativa" : "Initiative"}
      subtitle={initiative.code ?? (es ? "Ficha de evidencia" : "Evidence record")}
      titleIsHeading={false}
    >
      <Link
        href={returnHref}
        className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold underline-offset-4 hover:underline"
        style={{ color: "var(--accent)" }}
      >
        <ArrowLeft aria-hidden size={15} weight="bold" />
        {es ? "Volver a iniciativas" : "Back to initiatives"}
      </Link>

      <article className="card elev mt-3 overflow-hidden">
        <div className="border-l-4 border-l-[var(--accent)] p-5 sm:p-7 lg:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum rounded-md bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[11px] font-semibold">
              {initiative.code ?? missing}
            </span>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
            >
              {sourceLabel}
            </span>
            {initiative.type && (
              <span
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                {initiative.type}
              </span>
            )}
          </div>

          <h1
            className="serif mt-4 max-w-5xl text-[1.35rem] font-semibold leading-[1.12] sm:text-[clamp(1.65rem,2.4vw,2.25rem)]"
            lang={localizedTitle.contentLanguage}
            aria-describedby={titleContextId}
          >
            {localizedTitle.text || missing}
          </h1>
          {localizedTitle.isOculisTranslation ? (
            <div
              id="initiative-title-provenance"
              className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2 text-xs"
            >
              <span
                className="inline-flex rounded-full border px-2 py-0.5 font-bold uppercase tracking-[0.07em]"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent) 30%, var(--border))",
                  background: "color-mix(in srgb, var(--accent-soft) 58%, transparent)",
                  color: "var(--accent)",
                }}
              >
                Oculis translation
              </span>
              <details className="min-w-0 max-w-4xl">
                <summary
                  className="cursor-pointer font-semibold underline decoration-current/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ color: "var(--text-muted)", outlineColor: "var(--accent)" }}
                >
                  Official title in Spanish
                </summary>
                <p
                  className="mt-2 border-l-2 px-3 py-2 leading-relaxed"
                  lang="es"
                  style={{
                    borderColor: "var(--accent)",
                    background: "color-mix(in srgb, var(--surface-2) 72%, transparent)",
                    color: "var(--text)",
                  }}
                >
                  {localizedTitle.officialSpanishTitle}
                </p>
              </details>
            </div>
          ) : localizedTitle.isTranslationPending ? (
            <p
              id="initiative-title-translation-pending"
              className="mt-3 max-w-4xl text-xs leading-relaxed"
              lang="en"
              style={{ color: "var(--text-muted)" }}
            >
              English translation pending. Showing the official title in Spanish.
            </p>
          ) : null}
          {showPurpose && (
            <p
              className="mt-4 max-w-4xl text-sm leading-relaxed sm:text-base"
              style={{ color: "var(--text-muted)" }}
            >
              {initiative.purpose}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {primaryOfficialDocument?.href && (
              <a
                href={primaryOfficialDocument.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                <FilePdf aria-hidden size={17} weight="bold" />
                {es ? "Abrir PDF oficial" : "Open official PDF"}
                <ArrowSquareOut aria-hidden size={14} weight="bold" />
                <NewTabNotice lang={lang} />
              </a>
            )}
            {officialHref && (
              <a
                href={officialHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: "var(--accent)" }}
              >
                <FileText aria-hidden size={17} />
                {es ? "Ver ficha oficial" : "View official record"}
                <ArrowSquareOut aria-hidden size={14} />
                <NewTabNotice lang={lang} />
              </a>
            )}
            <CopyTextButton
              text={officialDescription}
              lang={lang}
              idleLabel={es ? "Copiar descripción" : "Copy description"}
              ariaLabel={es ? "oficial de la iniciativa" : "official initiative description"}
            />
          </div>

          <section className="mt-6 border-t pt-5" aria-labelledby="official-position-heading">
            <h2 id="official-position-heading" className="sr-only">
              {es ? "Situación oficial" : "Official position"}
            </h2>
            <dl className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
              <HeroFact
                icon={<SealCheck aria-hidden size={19} />}
                label={es ? "Estado publicado" : "Published status"}
                value={officialStatusLabel(initiative.status, lang) ?? missing}
              />
              <ProceduralHeroFact
                icon={<Buildings aria-hidden size={19} />}
                label={es ? "Cámara actual" : "Current chamber"}
                presentation={currentLocation}
                descriptionId="current-chamber-evidence"
              />
              <ProceduralHeroFact
                icon={<HourglassHigh aria-hidden size={19} />}
                label={es ? "Vencimiento normativo" : "Normative expiry"}
                presentation={expiration}
                descriptionId="initiative-expiration-evidence"
              />
              <HeroFact
                icon={<Buildings aria-hidden size={19} />}
                label={es ? "Cámara de origen" : "Origin chamber"}
                value={initiativeChamberLabel(initiative.originChamber, lang) ?? missing}
              />
              <HeroFact
                icon={<CalendarBlank aria-hidden size={19} />}
                label={es ? "Fecha de depósito" : "Filing date"}
                value={initiative.filedAt ? formatISODate(initiative.filedAt, lang) : missing}
              />
              <HeroFact
                icon={<ClockCounterClockwise aria-hidden size={19} />}
                label={es ? "Último cambio oficial" : "Latest official change"}
                value={
                  initiative.officialStatusChangedAt
                    ? formatISODateTime(initiative.officialStatusChangedAt, lang)
                    : missing
                }
              />
            </dl>

            <details className="mt-5 overflow-hidden rounded-xl border">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold marker:hidden">
                <span className="flex items-center gap-2">
                  <Info aria-hidden size={16} style={{ color: "var(--accent)" }} />
                  {es
                    ? "Cómo se determinan cámara actual y vencimiento"
                    : "How current chamber and expiry are determined"}
                </span>
                <CaretDown aria-hidden size={15} style={{ color: "var(--text-muted)" }} />
              </summary>
              <div className="grid gap-5 border-t p-4 text-xs leading-relaxed sm:grid-cols-2">
                <section aria-labelledby="current-location-method-heading">
                  <h3 id="current-location-method-heading" className="font-semibold">
                    {es ? "Cámara actual" : "Current chamber"}
                  </h3>
                  <p className="mt-1.5" style={{ color: "var(--text-muted)" }}>
                    {es
                      ? "Si la fuente no publica un campo de cámara actual, Oculis muestra la cámara del movimiento oficial más reciente y la identifica como observada. Nunca presume un traslado por el código, el título o el estado."
                      : "When the source does not publish a current-chamber field, Oculis shows the chamber of the latest official movement and labels it as observed. It never assumes a transfer from the code, title, or status."}
                  </p>
                </section>
                <section aria-labelledby="expiration-method-heading">
                  <h3 id="expiration-method-heading" className="font-semibold">
                    {es ? "Vencimiento normativo" : "Normative expiry"}
                  </h3>
                  <p className="mt-1.5" style={{ color: "var(--text-muted)" }}>
                    {es
                      ? "Para un proyecto de ley, el depósito no inicia el plazo. La toma en consideración inicia el cómputo de dos legislaturas ordinarias; las extraordinarias no cuentan. Si falta esa evidencia, Oculis no fabrica una fecha."
                      : "For a bill, filing does not start the period. Consideration starts the two-ordinary-legislature count; extraordinary legislatures do not count. If that evidence is missing, Oculis does not manufacture a date."}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-semibold">
                    <a
                      href="https://camaradediputados.gob.do/download/64/constitucion/24441/constitucion-de-la-republica-2024.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {es
                        ? "Constitución, arts. 89, 100 y 104"
                        : "Constitution, arts. 89, 100, and 104"}
                      <ArrowSquareOut aria-hidden size={12} />
                      <NewTabNotice lang={lang} />
                    </a>
                    <a
                      href="https://camaradediputados.gob.do/download/63/reglamentos/2807/manual-de-procedimientos-legislativos.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {es ? "Manual legislativo" : "Legislative manual"}
                      <ArrowSquareOut aria-hidden size={12} />
                      <NewTabNotice lang={lang} />
                    </a>
                    <a
                      href="https://transparencia.senadord.gob.do/download/725/resoluciones/43294/reglamento-del-senado-rep-dom.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {es ? "Reglamento del Senado, arts. 19–20" : "Senate Rules, arts. 19–20"}
                      <ArrowSquareOut aria-hidden size={12} />
                      <NewTabNotice lang={lang} />
                    </a>
                  </p>
                </section>
              </div>
            </details>
          </section>
        </div>
      </article>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <CardSection
            title={es ? "Movimientos más recientes" : "Latest movements"}
            icon={<ClockCounterClockwise aria-hidden size={21} />}
          >
            {recentEvents.length > 0 ? (
              <ol className="divide-y">
                {recentEvents.map((event) => (
                  <li
                    key={event.id}
                    className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[150px_minmax(0,1fr)]"
                  >
                    <div
                      className="tnum text-xs font-medium"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {event.eventDate
                        ? formatISODate(event.eventDate, lang)
                        : event.observedAt
                          ? formatISODateTime(event.observedAt, lang)
                          : missing}
                    </div>
                    <div>
                      <p className="font-semibold leading-snug">{event.status}</p>
                      {event.note && (
                        <p
                          className="mt-1 text-xs leading-relaxed"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {event.note}
                        </p>
                      )}
                      <div
                        className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <span>{statusEvidenceLabel(event.evidenceType, lang)}</span>
                        {event.sourceUrl && (
                          <a
                            href={event.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
                            style={{ color: "var(--accent)" }}
                          >
                            {es ? "Ver evidencia" : "View evidence"}
                            <ArrowSquareOut aria-hidden size={12} />
                            <NewTabNotice lang={lang} />
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyText>
                {initiative.sourceCoverage.history
                  ? es
                    ? "La fuente fue consultada y no reporta movimientos en el historial."
                    : "The source was checked and reports no movements in its history."
                  : es
                    ? "Oculis todavía está verificando el historial de esta iniciativa."
                    : "Oculis is still checking this initiative's history."}
              </EmptyText>
            )}
          </CardSection>

          <CardSection
            title={es ? "Documentos oficiales" : "Official documents"}
            icon={<FilePdf aria-hidden size={21} />}
            action={
              <span className="tnum text-xs" style={{ color: "var(--text-muted)" }}>
                {documentRows.length}
              </span>
            }
          >
            {documentRows.length > 0 ? (
              <ul className="divide-y">
                {documentRows.map(({ document, deposited, href }) => {
                  const label = document.docType ?? document.sourceDocId ?? missing;
                  return (
                    <li
                      key={document.id}
                      className="flex items-start gap-3 py-4 first:pt-0 last:pb-0"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                        {document.extension?.toLowerCase() === "pdf" || deposited ? (
                          <FilePdf aria-hidden size={21} />
                        ) : (
                          <FileText aria-hidden size={21} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold leading-snug">
                            {deposited && es
                              ? "Texto depositado del proyecto"
                              : deposited
                                ? "Filed bill text"
                                : label}
                          </h3>
                          {deposited && document.pdfAvailable && (
                            <span className="rounded-full bg-[var(--verified-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--verified)]">
                              {es ? "PDF verificado" : "Verified PDF"}
                            </span>
                          )}
                        </div>
                        {!deposited &&
                          label !== (es ? "Texto depositado del proyecto" : "Filed bill text") && (
                            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                              {label}
                            </p>
                          )}
                        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {initiativeSourceLabel(document.source, lang)}
                          {document.uploadedAt
                            ? ` · ${formatISODate(document.uploadedAt, lang)}`
                            : ""}
                        </p>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold underline-offset-4 hover:underline"
                            style={{ color: "var(--accent)" }}
                          >
                            {deposited
                              ? es
                                ? "Abrir PDF oficial"
                                : "Open official PDF"
                              : es
                                ? "Abrir archivo oficial"
                                : "Open official file"}
                            <ArrowSquareOut aria-hidden size={13} />
                            <NewTabNotice lang={lang} />
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyText>
                {initiative.sourceCoverage.documents
                  ? es
                    ? "La fuente fue consultada y no reporta documentos vinculados."
                    : "The source was checked and reports no linked documents."
                  : es
                    ? "Oculis todavía está verificando los documentos de esta iniciativa."
                    : "Oculis is still checking this initiative's documents."}
              </EmptyText>
            )}
          </CardSection>
        </div>

        <aside className="min-w-0 space-y-5">
          <CardSection
            title={es ? "Personas y órganos" : "People and bodies"}
            icon={<UsersThree aria-hidden size={21} />}
          >
            <div>
              <h3 className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                {es ? "Proponentes" : "Sponsors"}
              </h3>
              {initiative.proponents.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {visibleProponents.map((proponent, index) => {
                    const focused = proponent === focusedProponent;
                    return (
                      <li
                        key={`${proponent.legislatorId ?? proponent.name}-${index}`}
                        className={`flex items-start gap-2.5 ${focused ? "rounded-lg border p-3" : ""}`}
                        aria-current={focused ? "true" : undefined}
                        style={
                          focused
                            ? {
                                borderColor: "color-mix(in srgb, var(--accent) 34%, var(--border))",
                                background: "var(--accent-soft)",
                              }
                            : undefined
                        }
                      >
                        <UserCircle
                          aria-hidden
                          size={20}
                          className="mt-0.5 shrink-0"
                          style={{ color: "var(--text-muted)" }}
                        />
                        <div className="min-w-0">
                          <LegislatorProfileTrigger
                            profileId={proponent.profileId}
                            fullName={proponent.name}
                            chamber={proponent.chamber}
                            role={proponent.role}
                            party={proponent.partyName ?? proponent.party}
                            province={proponent.province}
                            className="-ml-2 inline-flex min-h-11 max-w-full items-center rounded-md px-2 text-left font-semibold leading-snug underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                          >
                            {proponent.name}
                          </LegislatorProfileTrigger>
                          <p
                            className="text-xs leading-snug"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {[
                              partyDisplayLabel(proponent.party, proponent.partyName, lang),
                              proponent.province,
                              proponent.role,
                            ]
                              .filter(Boolean)
                              .join(" · ") || missing}
                          </p>
                          {focused && (
                            <p
                              className="mt-1 inline-flex flex-wrap items-center gap-x-1.5 rounded-full border px-2 py-1 text-[10px] font-bold"
                              style={{ color: "var(--accent)", borderColor: "currentColor" }}
                            >
                              <span>{es ? "Vínculo seleccionado" : "Selected link"}</span>
                              <span aria-hidden>·</span>
                              <span>
                                {detailProponentRelationshipLabel(proponent.principal, lang)}
                              </span>
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {initiative.proponents.length > visibleProponents.length && (
                    <li className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {es
                        ? `Y ${initiative.proponents.length - visibleProponents.length} proponentes más en los datos completos.`
                        : `And ${initiative.proponents.length - visibleProponents.length} more sponsors in the complete data.`}
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  {initiative.sponsor && initiative.sponsorProfileId ? (
                    <LegislatorProfileTrigger
                      profileId={initiative.sponsorProfileId}
                      fullName={initiative.sponsor}
                      chamber={initiative.chamber}
                      role={initiative.sponsorRole}
                      party={initiative.party}
                      province={initiative.province}
                      className="inline-flex min-h-11 items-center rounded-md px-2 font-semibold text-[var(--text)] underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      {initiative.sponsor}
                    </LegislatorProfileTrigger>
                  ) : (
                    (initiative.sponsor ??
                    (initiative.sourceCoverage.proponents
                      ? es
                        ? "La fuente no reporta proponentes."
                        : "The source reports no sponsors."
                      : missing))
                  )}
                </p>
              )}
            </div>

            <div className="mt-5 border-t pt-5">
              <h3 className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                {es ? "Comisiones" : "Committees"}
              </h3>
              {initiative.commissionAssignments.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {initiative.commissionAssignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-start gap-2.5">
                      <Buildings
                        aria-hidden
                        size={19}
                        className="mt-0.5 shrink-0"
                        style={{ color: "var(--text-muted)" }}
                      />
                      <div>
                        <p className="font-semibold leading-snug">{assignment.name ?? missing}</p>
                        {assignment.type && (
                          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                            {assignment.type}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  {initiative.committee ??
                    (initiative.sourceCoverage.commissions
                      ? es
                        ? "La fuente no reporta una comisión asignada."
                        : "The source reports no assigned committee."
                      : missing)}
                </p>
              )}
            </div>
          </CardSection>

          <CardSection
            title={es ? "Datos clave" : "Key facts"}
            icon={<Info aria-hidden size={21} />}
          >
            <dl className="space-y-4">
              <CompactFact label={es ? "Tipo" : "Type"} value={initiative.type ?? missing} />
              <CompactFact
                label={es ? "Condición oficial" : "Official condition"}
                value={initiative.condition ?? missing}
              />
              <CompactFact
                label={es ? "Materia" : "Subject matter"}
                value={initiative.subjectMatter ?? missing}
              />
              <CompactFact
                label={es ? "Legislatura" : "Legislature"}
                value={initiative.legislature ?? missing}
              />
              <CompactFact label={es ? "Fuente" : "Source"} value={sourceLabel} />
            </dl>
            <p
              className="mt-5 border-t pt-4 text-xs leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {es
                ? "La cámara observada y el vencimiento normativo se muestran arriba con su procedencia. Esta ficha conserva aquí únicamente los valores literales publicados por la fuente."
                : "The observed chamber and normative expiry appear above with their provenance. This record keeps only source-published literal values here."}
            </p>
          </CardSection>
        </aside>
      </div>

      <details id="complete-history" className="card elev mt-5 overflow-hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold marker:hidden sm:px-6">
          <span className="flex items-center gap-2.5">
            <FileText aria-hidden size={20} style={{ color: "var(--accent)" }} />
            {es ? "Historial completo y datos de la fuente" : "Full history and source data"}
          </span>
          <CaretDown aria-hidden size={18} style={{ color: "var(--text-muted)" }} />
        </summary>
        <div className="space-y-8 border-t p-5 sm:p-6">
          <section aria-labelledby="full-history-heading">
            <h2 id="full-history-heading" className="serif text-lg font-semibold">
              {es ? "Historial completo" : "Full history"}
            </h2>
            {fullEvents.length > 0 ? (
              <ol className="relative ml-1 mt-4 border-l pl-5">
                {fullEvents.map((event) => (
                  <li key={event.id} className="relative mb-5 last:mb-0">
                    <Circle
                      aria-hidden
                      size={9}
                      weight="fill"
                      className="absolute -left-[26px] top-1.5"
                      style={{ color: "var(--accent)" }}
                    />
                    <p className="font-semibold leading-snug">{event.status}</p>
                    <p className="tnum mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {event.eventDate
                        ? formatISODate(event.eventDate, lang)
                        : event.observedAt
                          ? formatISODateTime(event.observedAt, lang)
                          : missing}
                      {` · ${initiativeSourceLabel(event.source, lang)} · ${statusEvidenceLabel(event.evidenceType, lang)}`}
                    </p>
                    {event.note && (
                      <p
                        className="mt-1 text-xs leading-relaxed"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {event.note}
                      </p>
                    )}
                    {event.sourceUrl && (
                      <a
                        href={event.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
                        style={{ color: "var(--accent)" }}
                      >
                        {es ? "Abrir evidencia" : "Open evidence"}
                        <ArrowSquareOut aria-hidden size={12} />
                        <NewTabNotice lang={lang} />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyText>
                {es
                  ? "No hay eventos publicados por la fuente."
                  : "There are no events published by the source."}
              </EmptyText>
            )}
          </section>

          <section className="border-t pt-7" aria-labelledby="complete-facts-heading">
            <h2 id="complete-facts-heading" className="serif text-lg font-semibold">
              {es ? "Ficha oficial completa" : "Complete official record"}
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {completeFacts.map(([label, value]) => (
                <CompactFact key={label} label={label} value={value ?? missing} />
              ))}
            </dl>
          </section>

          {initiative.proponents.length > 0 && (
            <section className="border-t pt-7" aria-labelledby="complete-sponsors-heading">
              <h2 id="complete-sponsors-heading" className="serif text-lg font-semibold">
                {es ? "Datos completos de proponentes" : "Complete sponsor data"}
              </h2>
              <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {initiative.proponents.map((proponent, index) => {
                  const party = partyDisplayLabel(proponent.party, proponent.partyName, lang);
                  const term = [
                    proponent.representationPeriod,
                    proponent.representationStart
                      ? `${formatISODate(proponent.representationStart, lang)}–${formatISODate(proponent.representationEnd, lang)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li
                      key={`${proponent.legislatorId ?? proponent.name}-${index}`}
                      className="rounded-lg border p-4"
                    >
                      <LegislatorProfileTrigger
                        profileId={proponent.profileId}
                        fullName={proponent.name}
                        chamber={proponent.chamber}
                        role={proponent.role}
                        party={party}
                        province={proponent.province}
                        className="-ml-2 inline-flex min-h-11 max-w-full items-center rounded-md px-2 text-left font-semibold underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                      >
                        {proponent.name}
                      </LegislatorProfileTrigger>
                      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <CompactFact
                          label={es ? "Función" : "Role"}
                          value={proponent.role ?? missing}
                        />
                        <CompactFact label={es ? "Partido" : "Party"} value={party ?? missing} />
                        <CompactFact
                          label={es ? "Representación" : "Representation"}
                          value={proponent.representationLevel ?? missing}
                        />
                        <CompactFact
                          label={es ? "Provincia" : "Province"}
                          value={proponent.province ?? missing}
                        />
                        <CompactFact
                          label={es ? "Circunscripción" : "Constituency"}
                          value={proponent.constituency ?? missing}
                        />
                        <CompactFact label={es ? "Período" : "Term"} value={term || missing} />
                        <CompactFact
                          label={es ? "Estado de representación" : "Representation status"}
                          value={proponent.representationStatus ?? missing}
                        />
                        <CompactFact
                          label={es ? "ID oficial" : "Official ID"}
                          value={proponent.legislatorId?.toString() ?? missing}
                        />
                      </dl>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {initiative.commissionAssignments.length > 0 && (
            <section className="border-t pt-7" aria-labelledby="complete-commissions-heading">
              <h2 id="complete-commissions-heading" className="serif text-lg font-semibold">
                {es ? "Asignaciones a comisión" : "Committee assignments"}
              </h2>
              <ul className="mt-4 space-y-3">
                {initiative.commissionAssignments.map((assignment) => (
                  <li key={assignment.id} className="rounded-lg border p-4">
                    <p className="font-semibold">{assignment.name ?? missing}</p>
                    <p
                      className="mt-1 text-xs leading-relaxed"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {[
                        assignment.type,
                        assignment.startDate
                          ? `${es ? "Inicio" : "Start"}: ${formatISODate(assignment.startDate, lang)}`
                          : null,
                        assignment.endDate
                          ? `${es ? "Fin" : "End"}: ${formatISODate(assignment.endDate, lang)}`
                          : null,
                        assignment.sourceAssignmentId
                          ? `ID: ${assignment.sourceAssignmentId}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || missing}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="border-t pt-7" aria-labelledby="activities-heading">
            <h2 id="activities-heading" className="serif text-lg font-semibold">
              {es ? "Actividades vinculadas" : "Linked activities"}
            </h2>
            {initiative.activities.length > 0 ? (
              <ul className="mt-4 divide-y">
                {initiative.activities.map((activity) => (
                  <li key={activity.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="font-semibold">{activity.description}</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {[
                        activity.date ? formatISODate(activity.date, lang) : null,
                        activity.type,
                        activity.location,
                        activity.commissionId
                          ? `${es ? "Comisión" : "Committee"} ID: ${activity.commissionId}`
                          : null,
                        `${es ? "Actividad" : "Activity"} ID: ${activity.id}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || missing}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <EmptyText>
                  {initiative.sourceCoverage.activities
                    ? es
                      ? "La fuente fue consultada y no reporta actividades vinculadas."
                      : "The source was checked and reports no linked activities."
                    : es
                      ? "Oculis todavía no ha podido consultar las actividades de esta iniciativa."
                      : "Oculis has not yet been able to check this initiative's activities."}
                </EmptyText>
              </div>
            )}
          </section>

          <section className="border-t pt-7" aria-labelledby="votes-heading">
            <h2 id="votes-heading" className="serif text-lg font-semibold">
              {es ? "Votaciones oficiales" : "Official votes"}
            </h2>
            {initiative.votes.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {initiative.votes.map((vote) => {
                  const voteHref = safeOfficialUrl(
                    `https://www.diputadosrd.gob.do/sil/api/votacion/votacion/${vote.id}`,
                    "sil-diputados",
                  );
                  return (
                    <li key={vote.id} className="rounded-lg border p-4">
                      <p className="font-semibold">{vote.title ?? vote.motion ?? missing}</p>
                      {vote.motion && vote.motion !== vote.title && (
                        <p
                          className="mt-1 text-xs leading-relaxed"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {vote.motion}
                        </p>
                      )}
                      <dl className="tnum mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <CompactFact
                          label={es ? "Fecha" : "Date"}
                          value={vote.date ? formatISODate(vote.date, lang) : missing}
                        />
                        <CompactFact
                          label={es ? "Sesión / votación" : "Session / vote"}
                          value={
                            [vote.sessionNumber, vote.voteNumber].filter(Boolean).join(" / ") ||
                            missing
                          }
                        />
                        <CompactFact
                          label={es ? "Sí" : "Yes"}
                          value={vote.yesVotes?.toString() ?? missing}
                        />
                        <CompactFact
                          label={es ? "No" : "No"}
                          value={vote.noVotes?.toString() ?? missing}
                        />
                        <CompactFact
                          label={es ? "Abstenciones" : "Abstentions"}
                          value={vote.abstentions?.toString() ?? missing}
                        />
                        <CompactFact
                          label={es ? "Votos totales" : "Total votes"}
                          value={vote.totalVotes?.toString() ?? missing}
                        />
                        <CompactFact
                          label={es ? "Presentes" : "Present"}
                          value={vote.present?.toString() ?? missing}
                        />
                        <CompactFact
                          label={es ? "Ausentes" : "Absent"}
                          value={vote.absent?.toString() ?? missing}
                        />
                      </dl>
                      {voteHref && (
                        <a
                          href={voteHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
                          style={{ color: "var(--accent)" }}
                        >
                          {es ? "Abrir votación oficial" : "Open official vote"}
                          <ArrowSquareOut aria-hidden size={12} />
                          <NewTabNotice lang={lang} />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-3">
                <EmptyText>
                  {initiative.sourceCoverage.votes
                    ? es
                      ? "La fuente fue consultada y no reporta votaciones para esta iniciativa."
                      : "The source was checked and reports no votes for this initiative."
                    : es
                      ? "Oculis todavía no ha podido consultar las votaciones de esta iniciativa."
                      : "Oculis has not yet been able to check this initiative's votes."}
                </EmptyText>
              </div>
            )}
          </section>

          {initiative.documents.some((document) => document.sourceFragment) && (
            <section className="border-t pt-7" aria-labelledby="provenance-heading">
              <h2 id="provenance-heading" className="serif text-lg font-semibold">
                {es ? "Fragmentos registrados" : "Stored source fragments"}
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {es
                  ? "Texto literal conservado para trazabilidad técnica."
                  : "Literal text retained for technical traceability."}
              </p>
              <div className="mt-4 space-y-3">
                {initiative.documents
                  .filter((document) => document.sourceFragment)
                  .map((document) => (
                    <details key={document.id} className="rounded-lg border p-3">
                      <summary className="cursor-pointer text-xs font-semibold">
                        {document.docType ?? document.sourceDocId ?? missing}
                      </summary>
                      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-2)] p-3 font-mono text-[10px] leading-relaxed">
                        {document.sourceFragment}
                      </pre>
                    </details>
                  ))}
              </div>
            </section>
          )}
        </div>
      </details>

      {contextualNews.length > 0 && (
        <section
          className="card elev mt-5 overflow-hidden"
          aria-labelledby="related-context-heading"
        >
          <div className="border-b px-5 py-4 sm:px-6">
            <h2 id="related-context-heading" className="serif text-lg font-semibold">
              {es ? "Contexto informativo relacionado" : "Related news context"}
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {es
                ? "Estos enlaces aportan contexto; no sustituyen la evidencia oficial."
                : "These links provide context; they do not replace official evidence."}
            </p>
          </div>
          <ul className="divide-y px-5 sm:px-6">
            {contextualNews.map((item) => (
              <li key={item.id} className="py-4">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-start gap-2 font-semibold leading-snug underline-offset-4 hover:underline"
                  >
                    <span>{item.title}</span>
                    <ArrowSquareOut aria-hidden size={14} className="mt-0.5 shrink-0" />
                    <NewTabNotice lang={lang} />
                  </a>
                ) : (
                  <span className="font-semibold">{item.title}</span>
                )}
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {newsSourceLabel(item.source)}
                  {item.publishedAt ? ` · ${formatISODate(item.publishedAt, lang)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

function detailProponentRelationshipLabel(
  principal: boolean | null | undefined,
  lang: Lang,
): string {
  if (principal === true) return lang === "es" ? "Proponente principal" : "Principal sponsor";
  if (principal === false) return lang === "es" ? "Coproponente" : "Co-sponsor";
  return lang === "es" ? "Proponente publicado" : "Published sponsor";
}

function CardSection({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card elev overflow-hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b px-5 py-3.5 sm:px-6">
        <h2 className="serif flex items-center gap-2.5 text-lg font-semibold">
          <span style={{ color: "var(--accent)" }}>{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function HeroFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt
        className="flex items-center gap-1.5 text-[10px] font-semibold"
        style={{ color: "var(--text-muted)" }}
      >
        <span style={{ color: "var(--accent)" }}>{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-semibold leading-snug">{value}</dd>
    </div>
  );
}

function ProceduralHeroFact({
  icon,
  label,
  presentation,
  descriptionId,
}: {
  icon: ReactNode;
  label: string;
  presentation: ProceduralFactPresentation;
  descriptionId: string;
}) {
  const tone = {
    official: { color: "var(--verified)", background: "var(--verified-soft)" },
    observed: { color: "var(--accent)", background: "var(--accent-soft)" },
    derived: { color: "var(--warn)", background: "var(--warn-soft)" },
    pending: { color: "var(--text-muted)", background: "var(--surface-3)" },
  }[presentation.tone];
  const value = presentation.dateTime ? (
    <time dateTime={presentation.dateTime}>{presentation.value}</time>
  ) : (
    presentation.value
  );

  return (
    <div className="min-w-0" aria-describedby={descriptionId}>
      <dt
        className="flex items-center gap-1.5 text-[11px] font-semibold"
        style={{ color: "var(--text-muted)" }}
      >
        <span style={{ color: "var(--accent)" }}>{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-semibold leading-snug">{value}</dd>
      <span
        className="mt-2 inline-flex min-h-6 max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight"
        style={tone}
      >
        {presentation.basis}
      </span>
      <p
        id={descriptionId}
        className="mt-1.5 max-w-[36rem] text-xs leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        {presentation.detail}
      </p>
    </div>
  );
}

function CompactFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm leading-snug">{value}</dd>
    </div>
  );
}

function EmptyText({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

function newsSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    "feed-senado": "Senado de la República",
    "feed-diputados": "Cámara de Diputados",
    "feed-diariolibre": "Diario Libre",
    "feed-listin": "Listín Diario",
    "feed-acento": "Acento",
    "feed-elnacional": "El Nacional",
    "feed-hoy": "Hoy",
    "feed-elcaribe": "El Caribe",
    "feed-x": "X",
  };
  return labels[source] ?? source;
}
