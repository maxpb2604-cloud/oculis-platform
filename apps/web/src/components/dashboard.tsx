import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { dict, type Lang } from "@/lib/i18n";
import { ApprovalBar, CategoryBar, StatusDonut } from "@/components/charts";
import { ProvinceBubbleMap } from "@/components/province-bubble-map";
import type { DashboardData, ProvinceFC, LegislatorsByProvince } from "@/lib/data";

export function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="card elev p-5">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-2 text-[34px] font-semibold leading-none">{value.toLocaleString()}</div>
      <div className="mt-3 h-[3px] w-9 rounded-full" style={{ background: accent }} />
    </div>
  );
}

export function SectionHeading({ n, title }: { n: string; title: string }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline gap-3">
      <span className="tnum text-xs font-semibold" style={{ color: "var(--accent)" }}>{n}</span>
      <h2 className="serif text-lg font-semibold">{title}</h2>
      <span className="hairline flex-1 self-center" />
    </div>
  );
}

export function Panel({
  title,
  children,
  flush,
  action,
}: {
  title: string;
  children: React.ReactNode;
  flush?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className={flush ? "" : "p-5"}>{children}</div>
    </div>
  );
}

export function Insight({ lang, data }: { lang: Lang; data: DashboardData }) {
  const topCat = data.byCategory.find((c) => c.key !== "N/D");
  const total = data.kpis.total;
  const pct = topCat && total ? Math.round((topCat.count / total) * 100) : 0;
  const catLabel = topCat ? CATEGORY_LABELS[topCat.key as Category] ?? topCat.key : "—";
  const altaProb = data.byApproval.find((r) => r.key === "ALTA")?.count ?? 0;
  const text =
    lang === "es"
      ? `Se monitorean ${total.toLocaleString()} iniciativas. La categoría predominante es ${catLabel} (${pct}%); ${altaProb.toLocaleString()} tienen probabilidad ALTA de aprobación y ${data.kpis.needsReview.toLocaleString()} están pendientes de validación del analista.`
      : `Tracking ${total.toLocaleString()} initiatives. The leading category is ${catLabel} (${pct}%); ${altaProb.toLocaleString()} have HIGH approval probability and ${data.kpis.needsReview.toLocaleString()} await analyst validation.`;
  return (
    <div
      className="mb-5 rounded-xl border-l-2 p-5"
      style={{ background: "var(--surface)", borderColor: "var(--border)", borderLeftColor: "var(--accent)" }}
    >
      <div className="eyebrow">{lang === "es" ? "Lectura clave" : "Key takeaway"}</div>
      <p className="serif mt-1.5 text-[17px] leading-relaxed">{text}</p>
    </div>
  );
}

export function KpiBand({ lang, data }: { lang: Lang; data: DashboardData }) {
  const t = dict[lang];
  // "Needs review" (always 100% until an analyst-confirm flow exists) and
  // "Published" (nothing publishes yet) carried no signal as KPIs — surface the
  // two numbers an analyst actually acts on: likely-to-pass and high-risk.
  const altaProb = data.byApproval.find((r) => r.key === "ALTA")?.count ?? 0;
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Kpi label={t.totalBills} value={data.kpis.total} accent="var(--accent)" />
      <Kpi label={t.highApproval} value={altaProb} accent="var(--risk-medio)" />
      <Kpi label={t.highRisk} value={data.kpis.highRisk} accent="var(--risk-alto)" />
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
          title={lang === "es" ? "Iniciativas por provincia" : "Initiatives by province"}
          flush
          action={
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {lang === "es" ? "Clic en una provincia para ver legisladores" : "Click a province to see legislators"}
            </span>
          }
        >
          <ProvinceBubbleMap data={provinceFC} legislators={legislators} height={420} lang={lang} />
        </Panel>
        <Panel title={t.byStatus}>
          <StatusDonut data={data.byStatus} lang={lang} />
          <Legend data={data.byStatus} />
        </Panel>
      </section>
    </>
  );
}

export function ChartGrid({ lang, data }: { lang: Lang; data: DashboardData }) {
  const t = dict[lang];
  return (
    <>
      <SectionHeading n="02" title={lang === "es" ? "Probabilidad de Aprobación y Categoría" : "Approval Probability & Category"} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={t.byApproval}>
          <ApprovalBar data={data.byApproval} lang={lang} />
        </Panel>
        <Panel title={t.byCategory}>
          <CategoryBar data={data.byCategory} lang={lang} />
        </Panel>
      </section>
    </>
  );
}

function Legend({ data }: { data: { key: string; count: number }[] }) {
  const palette = ["#0b6e4f", "#2f8f74", "#5aa897", "#8a9a93", "#b07d2a", "#b23b34", "#6b7a72", "#a9b4ad"];
  return (
    <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 pb-1 text-xs" style={{ color: "var(--text-muted)" }}>
      {data.slice(0, 8).map((d, i) => (
        <li key={d.key} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: palette[i % palette.length] }} />
          <span className="truncate">{d.key}</span>
          <span className="tnum ml-auto">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}
