"use client";

import { useRouter } from "next/navigation";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { t, type Lang } from "@/lib/i18n";

interface Bucket {
  key: string | null;
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

export function StatusDonut({ data, lang }: { data: Bucket[]; lang: Lang }) {
  const nav = useFilterNav("status", lang);
  const total = data.reduce((s, d) => s + d.count, 0);
  const rows = data.map((row) => ({
    ...row,
    label: row.key ?? (lang === "es" ? "No informado" : "Not reported"),
  }));
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={rows}
            dataKey="count"
            nameKey="label"
            innerRadius={64}
            outerRadius={96}
            paddingAngle={1.5}
            stroke="var(--surface)"
            strokeWidth={2}
            cursor="pointer"
            onClick={(d: { key?: string | null }) => nav(d.key ?? "")}
          >
            {rows.map((_, i) => (
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
