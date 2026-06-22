import { getDayActivity, todayISO } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { ActivityList, StatTile, StatusLegend, type ActivityItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

function split(items: ActivityItem[], chamber: string) {
  return items.filter((i) => i.chamber === chamber);
}

export default async function HoyPage({ searchParams }: { searchParams: Promise<{ lang?: string; date?: string }> }) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "es";
  const { date, items } = await getDayActivity({ date: sp.date });
  const dip = split(items, "DIPUTADOS");
  const sen = split(items, "SENADO");
  const committees = items.filter((i) => i.scope === "COMMITTEE").length;
  const plenary = items.filter((i) => i.scope === "PLENARY" || i.scope === "ASAMBLEA").length;
  const billsOnAgenda = items.reduce((n, i) => n + i.initiativeCount, 0);
  const pretty = new Intl.DateTimeFormat("es-DO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(date + "T12:00:00"));
  const isToday = date === todayISO();

  return (
    <AppShell lang={lang} title="¿Qué tenemos hoy?" subtitle={`Actividad legislativa · ${pretty}`}>
      <div className="mb-5 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          {isToday ? "HOY" : "FECHA"} · {date}
        </span>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Ambas cámaras · Cámara de Diputados y Senado
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={items.length} label="Actividades hoy" />
        <StatTile value={plenary} label="Pleno / Asamblea" accent="#3b82f6" />
        <StatTile value={committees} label="Comisiones" accent="#8b5cf6" />
        <StatTile value={billsOnAgenda} label="Iniciativas en agenda" accent="#d97706" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={`Cámara de Diputados · ${dip.length}`} flush>
          <ActivityList items={dip} empty="Sin actividad registrada para esta fecha." />
        </Panel>
        <Panel title={`Senado · ${sen.length}`} flush>
          <ActivityList items={sen} empty="Sin actividad registrada para esta fecha." />
        </Panel>
      </div>

      <div className="card mt-6 p-5">
        <div className="eyebrow mb-3">Cómo leer los estados</div>
        <StatusLegend />
      </div>
    </AppShell>
  );
}
