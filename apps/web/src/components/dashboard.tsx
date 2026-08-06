import { dict, type Lang } from "@/lib/i18n";
import { StatusDonut } from "@/components/charts";
import { LazyProvinceMap } from "@/components/lazy-province-map";
import { Kpi, Panel, SectionHeading } from "@/components/report-ui";
import type { DashboardData, ProvinceFC, LegislatorsByProvince } from "@/lib/data";

export function Insight({ lang, data }: { lang: Lang; data: DashboardData }) {
  const total = data.kpis.total;
  const text =
    lang === "es"
      ? `${total.toLocaleString()} iniciativas registradas; ${data.kpis.withStatus.toLocaleString()} tienen estado informado por la fuente y ${data.kpis.withOfficialDocument.toLocaleString()} cuentan con documento oficial.`
      : `${total.toLocaleString()} initiatives recorded; ${data.kpis.withStatus.toLocaleString()} have a source-reported status and ${data.kpis.withOfficialDocument.toLocaleString()} have an official document.`;
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
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      <SectionHeading n="01" title={lang === "es" ? "Panorama" : "Overview"} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
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
        <Panel title={t.byStatus}>
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
        <Panel title={t.byStatus}>
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
