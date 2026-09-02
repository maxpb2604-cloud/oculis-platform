import {
  ArrowRight,
  Buildings,
  CalendarBlank,
  FilePdf,
  FileText,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import React from "react";
import type { InitiativeCatalogRow } from "@/app/initiatives/catalog-row";
import type { LegislatorCatalogFilter } from "@/components/filters";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";
import { NewTabNotice } from "@/components/ui/primitives";
import { dict, type Lang } from "@/lib/i18n";
import { formatISODate } from "@/lib/format";
import { initiativeDetailHref } from "@/lib/initiative-links";
import { initiativeTitlePresentation } from "@/lib/initiative-title";
import { partyDisplayLabel } from "@/lib/party-presentation";

type FilteredProponentRelationship = NonNullable<
  InitiativeCatalogRow["filteredProponentRelationship"]
>;

/** Canonical initiative catalog: one responsive evidence list at every viewport. */
export function InitiativesTable({
  rows,
  lang,
  legislatorFilter = null,
  detailReturnTo = null,
  clearAdditionalFiltersHref = null,
}: {
  rows: InitiativeCatalogRow[];
  lang: Lang;
  legislatorFilter?: LegislatorCatalogFilter | null;
  detailReturnTo?: string | null;
  clearAdditionalFiltersHref?: string | null;
}) {
  const t = dict[lang];
  const es = lang === "es";
  const missing = es ? "No informado por la fuente" : "Not reported by the source";

  if (rows.length === 0) {
    return (
      <div className="card px-5 py-14 text-center">
        <FileText
          aria-hidden
          size={30}
          className="mx-auto"
          style={{ color: "var(--text-muted)" }}
        />
        <h2 className="serif mt-3 text-lg font-semibold">
          {legislatorFilter
            ? es
              ? "No hay iniciativas vinculadas con estos filtros"
              : "No linked initiatives match these filters"
            : es
              ? "No encontramos iniciativas"
              : "No initiatives found"}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--text-muted)" }}>
          {legislatorFilter
            ? es
              ? `No encontramos registros vinculados a ${legislatorFilter.fullName} que además cumplan los filtros seleccionados.`
              : `We found no records linked to ${legislatorFilter.fullName} that also match the selected filters.`
            : es
              ? "Prueba con un código más corto, otro término o elimina alguno de los filtros."
              : "Try a shorter code, another term, or remove one of the filters."}
        </p>
        {legislatorFilter && clearAdditionalFiltersHref && (
          <Link
            href={clearAdditionalFiltersHref}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {es ? "Quitar filtros adicionales" : "Remove additional filters"}
          </Link>
        )}
      </div>
    );
  }

  return (
    <section
      className="card elev overflow-hidden"
      aria-label={es ? "Listado de iniciativas legislativas" : "Legislative initiatives list"}
    >
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(0,39fr)_minmax(0,14fr)_minmax(0,15fr)_minmax(0,17fr)_minmax(0,15fr)] border-b bg-[var(--surface-2)] text-[11px] font-semibold xl:grid"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="px-5 py-3.5">{es ? "Iniciativa" : "Initiative"}</span>
        <span className="px-4 py-3.5">{es ? "Cámara y fecha" : "Chamber and date"}</span>
        <span className="px-4 py-3.5">{t.status}</span>
        <span className="px-4 py-3.5">{t.sponsor}</span>
        <span className="px-5 py-3.5">{es ? "Evidencia oficial" : "Official evidence"}</span>
      </div>

      <ul className="divide-y" role="list">
        {rows.map((row) => {
          const detailHref = initiativeDetailHref(row.id, lang, detailReturnTo);
          const chamber = chamberLabel(row.chamber, lang);
          const filteredRelationship = legislatorFilter
            ? (row.filteredProponentRelationship ?? null)
            : null;
          const displayedParty = partyDisplayLabel(row.party, null, lang);
          const displayedTitle = initiativeTitlePresentation(row, lang);
          const sponsor = [row.sponsor, displayedParty].filter(Boolean).join(" · ") || missing;
          return (
            <li
              key={row.id}
              className="border-l-[3px] border-l-[var(--accent)] p-4 transition-colors hover:bg-[var(--surface-2)] focus-within:bg-[var(--surface-2)] sm:p-5 xl:grid xl:grid-cols-[minmax(0,39fr)_minmax(0,14fr)_minmax(0,15fr)_minmax(0,17fr)_minmax(0,15fr)] xl:border-l-0 xl:p-0"
            >
              <div className="min-w-0 xl:px-5 xl:py-4">
                <div className="flex flex-wrap items-center justify-between gap-2 xl:block">
                  <span
                    className="tnum block font-mono text-[11px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {row.code ?? missing}
                  </span>
                </div>
                {legislatorFilter && filteredRelationship && (
                  <p
                    className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold leading-snug"
                    style={{
                      borderColor: "color-mix(in srgb, var(--accent) 32%, var(--border))",
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                    }}
                  >
                    <span>{es ? "Vinculada a" : "Linked to"}</span>
                    <LegislatorProfileTrigger
                      profileId={legislatorFilter.profileId}
                      fullName={legislatorFilter.fullName}
                      chamber={legislatorFilter.chamber}
                      className="inline-flex min-h-11 items-center rounded px-1 text-left underline decoration-current/45 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      {legislatorFilter.fullName}
                    </LegislatorProfileTrigger>
                    <span aria-hidden>·</span>
                    <span>{proponentRelationshipLabel(filteredRelationship, lang)}</span>
                  </p>
                )}
                <Link
                  href={detailHref}
                  lang={displayedTitle.contentLanguage}
                  className="serif mt-2 block text-base font-semibold leading-snug underline-offset-4 hover:underline sm:text-lg xl:text-base"
                  style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 5,
                    overflow: "hidden",
                  }}
                >
                  {displayedTitle.text || missing}
                </Link>
                {lang === "en" && (
                  <span
                    className="mt-1 block text-[11px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {displayedTitle.isOculisTranslation
                      ? "Oculis translation"
                      : "Official Spanish title · translation pending"}
                  </span>
                )}
                <Link
                  href={detailHref}
                  className="mt-2 inline-flex min-h-8 items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {es ? "Ver ficha" : "View record"}
                  <ArrowRight aria-hidden size={13} weight="bold" />
                </Link>
              </div>

              <div className="mt-4 grid min-w-0 grid-cols-1 gap-2.5 text-xs sm:grid-cols-2 xl:mt-0 xl:block xl:px-4 xl:py-4">
                <Meta
                  icon={<Buildings aria-hidden size={16} />}
                  label={es ? "Cámara" : "Chamber"}
                  value={chamber}
                  desktopPlain
                />
                <div className="mt-2 flex min-w-0 items-start gap-2 xl:mt-1">
                  <CalendarBlank
                    aria-hidden
                    size={16}
                    className="mt-0.5 shrink-0 xl:hidden"
                    style={{ color: "var(--text-muted)" }}
                  />
                  <div className="min-w-0">
                    <div
                      className="text-[10px] font-semibold xl:hidden"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {es ? "Depositada" : "Filed"}
                    </div>
                    <div
                      className="tnum mt-0.5 break-words leading-snug"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {row.filedAt ? formatISODate(row.filedAt, lang) : missing}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 min-w-0 xl:mt-0 xl:px-4 xl:py-4">
                <span
                  className="mb-1.5 block text-[10px] font-semibold xl:hidden"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t.status}
                </span>
                <StatusPill value={row.status ?? missing} />
              </div>

              <div className="mt-2 min-w-0 text-xs sm:mt-0 xl:px-4 xl:py-4 xl:text-sm">
                <Meta
                  icon={<UserCircle aria-hidden size={16} />}
                  label={t.sponsor}
                  value={
                    row.sponsorIsLegislator && row.sponsor ? (
                      <LegislatorProfileTrigger
                        profileId={row.sponsorProfileId}
                        fullName={row.sponsor}
                        chamber={row.chamber}
                        role={row.sponsorRole}
                        party={row.party}
                        province={row.province}
                        className="-ml-2 inline-flex min-h-11 max-w-full items-center rounded-md px-2 text-left font-semibold underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                      >
                        {sponsor}
                      </LegislatorProfileTrigger>
                    ) : (
                      sponsor
                    )
                  }
                  desktopPlain
                />
                {row.province && (
                  <span
                    className="mt-1 hidden text-xs xl:block"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {row.province}
                  </span>
                )}
              </div>

              <div className="mt-4 min-w-0 border-t pt-4 xl:mt-0 xl:border-t-0 xl:px-5 xl:py-4">
                <InitiativeSourceActions row={row} lang={lang} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function proponentRelationshipLabel(
  relationship: FilteredProponentRelationship,
  lang: Lang,
): string {
  if (relationship === "principal") {
    return lang === "es" ? "Proponente principal" : "Principal sponsor";
  }
  if (relationship === "coproponent") {
    return lang === "es" ? "Coproponente" : "Co-sponsor";
  }
  return lang === "es" ? "Proponente publicado" : "Published sponsor";
}

function Meta({
  icon,
  label,
  value,
  desktopPlain = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  desktopPlain?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span
        className={`mt-0.5 shrink-0 ${desktopPlain ? "xl:hidden" : ""}`}
        style={{ color: "var(--text-muted)" }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div
          className={`text-[10px] font-semibold ${desktopPlain ? "xl:hidden" : ""}`}
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </div>
        <div className="mt-0.5 break-words leading-snug">{value}</div>
      </div>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  return (
    <span
      className="inline-flex max-w-full rounded-full px-2.5 py-1 text-[11px] font-semibold leading-tight"
      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
    >
      {value}
    </span>
  );
}

function chamberLabel(chamber: InitiativeCatalogRow["chamber"], lang: Lang): string {
  if (chamber === "SENADO") return lang === "es" ? "Senado" : "Senate";
  if (chamber === "DIPUTADOS") return lang === "es" ? "Diputados" : "Deputies";
  return lang === "es" ? "Fuente oficial" : "Official source";
}

function InitiativeSourceActions({ row, lang }: { row: InitiativeCatalogRow; lang: Lang }) {
  const es = lang === "es";
  const missing = es ? "No informado" : "Not reported";
  const officialHref = row.officialRecordHref;
  const documentHref = row.officialDocumentOpenHref;
  const rowLabel = row.code || row.title.trim() || missing;
  const documentRegistered = row.officialDocumentRegistered;

  if (!officialHref && !documentHref && !documentRegistered) {
    return (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {missing}
      </span>
    );
  }

  return (
    <div className="flex flex-col flex-wrap items-start gap-x-3 gap-y-2 text-xs sm:flex-row xl:flex-col">
      {documentHref && (
        <a
          href={documentHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 font-semibold transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--accent)" }}
        >
          <FilePdf aria-hidden size={15} weight="bold" />
          {es ? "PDF oficial" : "Official PDF"}
          <span className="sr-only">{es ? ` de ${rowLabel}` : ` for ${rowLabel}`}</span>
          <NewTabNotice lang={lang} />
        </a>
      )}
      {documentRegistered && !documentHref && (
        <span
          className="inline-flex items-center gap-1.5 leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          <FilePdf aria-hidden size={15} />
          {es ? "PDF no disponible" : "PDF unavailable"}
        </span>
      )}
      {officialHref && (
        <a
          href={officialHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline-offset-4 hover:underline"
          style={{ color: "var(--accent)" }}
        >
          <FileText aria-hidden size={15} />
          {es ? "Ficha oficial" : "Official record"}
          <span className="sr-only">{es ? ` de ${rowLabel}` : ` for ${rowLabel}`}</span>
          <NewTabNotice lang={lang} />
        </a>
      )}
    </div>
  );
}
