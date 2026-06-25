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
function useFilterNav(param: string, lang: string) {
  const router = useRouter();
  return (key: string) => {
    if (!key || key === "N/D") return;
    const qs = new URLSearchParams({ [param]: key });
    if (lang === "en") qs.set("lang", "en");
    router.push(`/initiatives?${qs.toString()}`);
  };
}

const RISK_COLORS: Record<string, string> = {
  ALTO: "var(--risk-alto)",
  MEDIO: "var(--risk-medio)",
  BAJO: "var(--risk-bajo)",
  "N/D": "var(--border-strong)",
};
const PROB_COLORS: Record<string, string> = {
  ALTA: "var(--accent)",
  MEDIA: "var(--risk-medio)",
  BAJA: "var(--text-muted)",
  "N/D": "var(--border-strong)",
};
// Tonal, brand-led categorical scale (emerald → teal → slate → ochre → clay).
const DONUT_COLORS = [
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
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} />
        <Bar
          dataKey="count"
          radius={[0, 3, 3, 0]}
          barSize={16}
          cursor={onSelect ? "pointer" : undefined}
          onClick={(d: { key?: string }) => onSelect?.(d.key ?? "")}
        >
          {rows.map((r, i) => (
            <Cell
              key={i}
              fill={colorMap?.[r.key] ?? "var(--accent)"}
              // Clickable bars navigate, so make them keyboard-operable (Enter/Space).
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `${r.label}: ${r.count}` : undefined}
              onKeyDown={
                onSelect
                  ? (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(r.key);
                      }
                    }
                  : undefined
              }
            />
          ))}
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

export const RiskBar = ({ data, lang }: { data: Bucket[]; lang: string }) => (
  <BarPanel data={data} colorMap={RISK_COLORS} onSelect={useFilterNav("risk", lang)} />
);
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
            cursor="pointer"
            onClick={(d: { key?: string }) => nav(d.key ?? "")}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="tnum serif text-2xl font-semibold">{total.toLocaleString()}</div>
        <div className="eyebrow">{t(lang, "total")}</div>
      </div>
    </div>
  );
}
