import React from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { dict, type Lang } from "@/lib/i18n";
import { StatusDonut } from "@/components/charts";
import { LazyProvinceMap } from "@/components/lazy-province-map";
import { Kpi, Panel, SectionHeading } from "@/components/report-ui";
import type {
  DashboardData,
  LegislatorsByProvince,
  ProvinceFC,
  RecentInitiativeMovement,
} from "@/lib/data";
import { initiativeDetailHref } from "@/lib/initiative-links";
import { initiativeTitlePresentation } from "@/lib/initiative-title";
import { homeMovementHeadline } from "@/lib/home-movement-headline";
import { formatISODate } from "@/lib/format";

function chamberLabel(chamber: string | null, lang: Lang): string {
  if (chamber === "SENADO") return lang === "es" ? "Senado" : "Senate";
  if (chamber === "DIPUTADOS") {
    return lang === "es" ? "Cámara de Diputados" : "Chamber of Deputies";
  }
  return lang === "es" ? "Cámara no informada" : "Chamber not reported";
}

/** Compact, keyboard-operable provenance for translated initiative movements. */
export function InitiativeTitleProvenance({
  lang,
  officialSpanishTitle,
}: {
  lang: Lang;
  officialSpanishTitle: string;
}) {
  const es = lang === "es";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 text-[11px] sm:px-5">
      <span
        className="inline-flex rounded-full border px-2 py-0.5 font-bold uppercase tracking-[0.07em]"
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 30%, var(--border))",
          background: "color-mix(in srgb, var(--accent-soft) 58%, transparent)",
          color: "var(--accent)",
        }}
      >
        {es ? "Traducción de Oculis" : "Oculis translation"}
      </span>
      <details className="min-w-0">
        <summary
          className="cursor-pointer font-semibold underline decoration-current/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: "var(--text-muted)", outlineColor: "var(--accent)" }}
        >
          {es ? "Título oficial en español" : "Official title in Spanish"}
        </summary>
        <p
          className="mt-2 max-w-4xl border-l-2 px-3 py-2 leading-relaxed"
          lang="es"
          style={{
            borderColor: "var(--accent)",
            background: "color-mix(in srgb, var(--surface-2) 72%, transparent)",
            color: "var(--text)",
          }}
        >
          {officialSpanishTitle}
        </p>
      </details>
    </div>
  );
}

/** The task-first briefing shown above the fold on Inicio. */
export function ExecutiveBriefing({
  lang,
  movements,
}: {
  lang: Lang;
  movements: RecentInitiativeMovement[];
}) {
  const es = lang === "es";
  const recent = movements.slice(0, 5);

  return (
    <div>
      <section aria-labelledby="latest-movements-heading">
        <div className="mb-3 flex items-center justify-between gap-4 border-t pt-5">
          <h2 id="latest-movements-heading" className="serif text-lg font-semibold">
            {es ? "Últimos movimientos" : "Latest movements"}
          </h2>
          <Link
            href={es ? "/feed?kind=LEGISLATIVE" : "/feed?kind=LEGISLATIVE&lang=en"}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {es ? "Ver todos los movimientos" : "View all movements"}
            <ArrowRight size={18} aria-hidden />
          </Link>
        </div>
        {recent.length ? (
          <div className="overflow-hidden border-y" style={{ borderColor: "var(--border)" }}>
            {recent.map((movement) => (
              <RecentMovementRow
                key={`${movement.initiativeId}-${movement.status}-${movement.effectiveAt}`}
                movement={movement}
                lang={lang}
              />
            ))}
          </div>
        ) : (
          <p className="border-y py-8 text-sm" style={{ color: "var(--text-muted)" }}>
            {es
              ? "Todavía no hay movimientos de iniciativas registrados."
              : "No initiative movements are recorded yet."}
          </p>
        )}
      </section>
    </div>
  );
}

function RecentMovementRow({ movement, lang }: { movement: RecentInitiativeMovement; lang: Lang }) {
  const title = initiativeTitlePresentation(
    { title: movement.title, titleEn: movement.titleEn },
    lang,
  );
  const headline = homeMovementHeadline({
    sourceTitle: movement.title,
    displayTitle: title.text,
    displayLanguage: title.contentLanguage,
    status: movement.status,
    lang,
  });
  const href = initiativeDetailHref(movement.initiativeId, lang);
  const shownDate = formatISODate(movement.eventDate ?? movement.effectiveAt, lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const usesTranslatedTitle = headline.headlineLanguage === "en" && title.isOculisTranslation;

  return (
    <div className="border-b last:border-0" data-home-movement-headline>
      <Link
        href={href}
        className="group grid min-h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-4 transition-colors hover:bg-[var(--surface-2)] sm:grid-cols-[minmax(0,1fr)_7.5rem_auto] sm:px-5"
        aria-label={
          lang === "es"
            ? `${headline.movement}: ${headline.subject}. Abrir ficha de la iniciativa.`
            : `${headline.movement}: ${headline.subject}. Open initiative details.`
        }
      >
        <span className="min-w-0">
          <span
            className="block text-[17px] font-semibold leading-[1.35] tracking-[-0.012em] sm:text-[18px]"
            lang={headline.headlineLanguage}
          >
            <span data-home-movement-action style={{ color: "var(--accent)" }}>
              {headline.movement}
            </span>
            <span aria-hidden>: </span>
            <span data-home-movement-subject>{headline.subject}</span>
          </span>
          <span
            className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {movement.code && <span className="tnum">{movement.code}</span>}
            <span>{chamberLabel(movement.chamber, lang)}</span>
            <span className="tnum sm:hidden">{shownDate}</span>
          </span>
        </span>
        <span
          className="tnum hidden text-right text-xs sm:block"
          style={{ color: "var(--text-muted)" }}
        >
          {shownDate}
        </span>
        <ArrowRight
          size={19}
          className="transition-transform group-hover:translate-x-0.5"
          style={{ color: "var(--text-muted)" }}
          aria-hidden
        />
      </Link>
      {usesTranslatedTitle ? (
        <InitiativeTitleProvenance lang={lang} officialSpanishTitle={headline.officialTitle} />
      ) : null}
    </div>
  );
}

export function Insight({ lang, data }: { lang: Lang; data: DashboardData }) {
  const total = data.kpis.total;
  const text =
    lang === "es"
      ? `${total.toLocaleString()} iniciativas registradas; ${data.kpis.withStatus.toLocaleString()} tienen estado informado por la fuente y ${data.kpis.withOfficialDocument.toLocaleString()} cuentan con un archivo registrado por la fuente oficial.`
      : `${total.toLocaleString()} initiatives recorded; ${data.kpis.withStatus.toLocaleString()} have a source-reported status and ${data.kpis.withOfficialDocument.toLocaleString()} have a file registered by the official source.`;
  return (
    <div
      className="mb-5 rounded-xl border-l-2 p-5"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        borderLeftColor: "var(--accent)",
      }}
    >
      <div className="eyebrow">{lang === "es" ? "Cobertura registrada" : "Recorded coverage"}</div>
      <p className="serif mt-1.5 text-[17px] leading-relaxed">{text}</p>
    </div>
  );
}

export function KpiBand({ lang, data }: { lang: Lang; data: DashboardData }) {
  const t = dict[lang];
  return (
    <section className="grid grid-cols-3 gap-2 sm:gap-4">
      <Kpi label={t.totalBills} value={data.kpis.total} accent="var(--accent)" />
      <Kpi
        label={lang === "es" ? "Con estado informado" : "With reported status"}
        value={data.kpis.withStatus}
        accent="var(--accent)"
      />
      <Kpi label={t.published} value={data.kpis.withOfficialDocument} accent="var(--accent)" />
    </section>
  );
}

/**
 * Top "panorama" row: the province bubble map at half width, with the status donut
 * beside it. The donut lives here (pulled out of the thematic section) so it isn't
 * duplicated on the page.
 */
export function GeoOverview({
  lang,
  data,
  provinceFC,
  legislators,
}: {
  lang: Lang;
  data: DashboardData;
  provinceFC: ProvinceFC;
  legislators: LegislatorsByProvince;
}) {
  const t = dict[lang];
  return (
    <>
      <SectionHeading n="02" title={lang === "es" ? "Panorama" : "Overview"} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          headingLevel={3}
          title={
            lang === "es"
              ? "Iniciativas según provincia representada por el proponente principal"
              : "Initiatives by the principal sponsor's represented province"
          }
          flush
          action={
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {lang === "es"
                ? "Clic en una provincia para ver legisladores"
                : "Click a province to see legislators"}
            </span>
          }
        >
          <LazyProvinceMap data={provinceFC} legislators={legislators} height={420} lang={lang} />
        </Panel>
        <Panel title={t.byStatus} headingLevel={3}>
          <StatusDonut data={data.byStatus} lang={lang} />
          <Legend data={data.byStatus} lang={lang} />
        </Panel>
      </section>
    </>
  );
}

export function ChartGrid({ lang, data }: { lang: Lang; data: DashboardData }) {
  const t = dict[lang];
  return (
    <>
      <SectionHeading
        n="02"
        title={lang === "es" ? "Estados informados por la fuente" : "Source-reported statuses"}
      />
      <section className="grid grid-cols-1 gap-4">
        <Panel title={t.byStatus} headingLevel={3}>
          <StatusDonut data={data.byStatus} lang={lang} />
          <Legend data={data.byStatus} lang={lang} />
        </Panel>
      </section>
    </>
  );
}

function Legend({ data, lang }: { data: { key: string | null; count: number }[]; lang: Lang }) {
  const palette = [
    "#0b6e4f",
    "#2f8f74",
    "#5aa897",
    "#8a9a93",
    "#b07d2a",
    "#b23b34",
    "#6b7a72",
    "#a9b4ad",
  ];
  return (
    <ul
      className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 pb-1 text-xs"
      style={{ color: "var(--text-muted)" }}
    >
      {data.slice(0, 8).map((d, i) => (
        <li key={d.key ?? "not-reported"} className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ background: palette[i % palette.length] }}
          />
          <span className="truncate">
            {d.key ?? (lang === "es" ? "No informado" : "Not reported")}
          </span>
          <span className="tnum ml-auto">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}
