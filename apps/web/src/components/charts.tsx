"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { t, type Lang } from "@/lib/i18n";

interface Bucket {
  key: string;
  count: number;
}

/** Cross-filter: clicking a chart segment navigates to the pre-filtered browse view. */
function useFilterNav(param: string, lang: string, basePath = "/initiatives") {
  const router = useRouter();
  return (key: string) => {
    if (!key || key === "N/D") return;
    const qs = new URLSearchParams({ [param]: key });
    if (lang === "en") qs.set("lang", "en");
    router.push(`${basePath}?${qs.toString()}`);
  };
}

const PROB_COLORS: Record<string, string> = {
  ALTA: "var(--accent)",
  MEDIA: "var(--risk-medio)",
  BAJA: "var(--text-muted)",
  "N/D": "var(--border-strong)",
};
// Tonal, brand-led categorical scale (emerald → teal → slate → ochre → clay).
// Exported so the dashboard Legend shares the exact same palette/assignment order.
export const DONUT_COLORS = [
  "#0b6e4f",
  "#2f8f74",
  "#5aa897",
  "#8a9a93",
  "#b07d2a",
  "#b23b34",
  "#6b7a72",
  "#a9b4ad",
];

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: 12,
  boxShadow: "0 8px 24px -16px rgba(0,0,0,.4)",
};
// Recharts colors the tooltip's label + item text on its OWN inline spans (default a
// dark ink / the series color), so contentStyle's color alone leaves them unreadable on
// the dark surface. Force theme text color on both so the tooltip reads in dark mode.
const tooltipTextStyle = { color: "var(--text)" };

function BarPanel({
  data,
  colorMap,
  labelMap,
  onSelect,
}: {
  data: Bucket[];
  colorMap?: Record<string, string>;
  labelMap?: (k: string) => string;
  onSelect?: (key: string) => void;
}) {
  const rows = data.map((d) => ({ ...d, label: labelMap ? labelMap(d.key) : d.key }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(150, rows.length * 34)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 34, top: 2, bottom: 2 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={132}
          tick={{ fill: "var(--text-muted)", fontSize: 11.5 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipTextStyle} labelStyle={tooltipTextStyle} cursor={{ fill: "var(--surface-2)" }} />
        <Bar
          dataKey="count"
          radius={[0, 3, 3, 0]}
          barSize={16}
          onClick={(d: { key?: string }) => onSelect?.(d.key ?? "")}
        >
          {rows.map((r, i) => {
            // "N/D" is not a filterable value (useFilterNav no-ops on it), so those
            // segments must not advertise interactivity (no pointer, no button role).
            const interactive = !!onSelect && r.key !== "N/D";
            return (
              <Cell
                key={i}
                fill={colorMap?.[r.key] ?? "var(--accent)"}
                cursor={interactive ? "pointer" : "default"}
                // Clickable bars navigate, so make them keyboard-operable (Enter/Space).
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `${r.label}: ${r.count}` : undefined}
                onKeyDown={
                  interactive
                    ? (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(r.key);
                        }
                      }
                    : undefined
                }
              />
            );
          })}
          <LabelList
            dataKey="count"
            position="right"
            offset={8}
            style={{ fill: "var(--text-muted)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const ApprovalBar = ({ data, lang }: { data: Bucket[]; lang: string }) => (
  <BarPanel data={data} colorMap={PROB_COLORS} onSelect={useFilterNav("approval", lang)} />
);
export const CategoryBar = ({ data, lang }: { data: Bucket[]; lang: string }) => (
  <BarPanel
    data={data}
    labelMap={(k) => CATEGORY_LABELS[k as Category] ?? k}
    onSelect={useFilterNav("category", lang)}
  />
);
/** Trending-topics bar for the feed rail — clicking a topic filters the feed. */
export const FeedTopicsBar = ({ data, lang }: { data: Bucket[]; lang: string }) => (
  <BarPanel
    data={data}
    labelMap={(k) => CATEGORY_LABELS[k as Category] ?? k}
    onSelect={useFilterNav("category", lang, "/feed")}
  />
);

export function StatusDonut({ data, lang }: { data: Bucket[]; lang: Lang }) {
  const nav = useFilterNav("status", lang);
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="key"
            innerRadius={64}
            outerRadius={96}
            paddingAngle={1.5}
            stroke="var(--surface)"
            strokeWidth={2}
            onClick={(d: { key?: string }) => nav(d.key ?? "")}
          >
            {data.map((d, i) => (
              // "N/D" slices don't filter (nav no-ops), so don't show a pointer on them.
              <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} cursor={d.key === "N/D" ? "default" : "pointer"} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipTextStyle} labelStyle={tooltipTextStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {/* Explicit theme color so the total is unmistakably readable in both themes
            (white on dark, ink on light) — never relies on inherited color. */}
        <div className="tnum serif text-2xl font-semibold" style={{ color: "var(--text)" }}>
          {total.toLocaleString()}
        </div>
        <div className="eyebrow" style={{ color: "var(--text)", opacity: 0.75 }}>
          {t(lang, "total")}
        </div>
      </div>
    </div>
  );
}
