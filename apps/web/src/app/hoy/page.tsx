import Link from "next/link";
import { getDayActivity, todayISO } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { ActivityList, StatTile, StatusLegend } from "@/components/monitoring";

export const dynamic = "force-dynamic";

function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default async function HoyPage({ searchParams }: { searchParams: Promise<{ lang?: string; date?: string }> }) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "es";
  const { date, dip, sen } = await getDayActivity({ date: sp.date });
  const isToday = date === todayISO();
  const committees = [...dip, ...sen].filter((i) => i.scope === "COMMITTEE").length;
  const plenary = [...dip, ...sen].filter((i) => i.scope === "PLENARY" || i.scope === "ASAMBLEA").length;
  const billsOnAgenda = dip.reduce((n, i) => n + i.initiativeCount, 0);
  const pretty = new Intl.DateTimeFormat("es-DO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(date + "T12:00:00"));
  const q = lang === "en" ? "&lang=en" : "";
  const dlink = (iso: string) => `/hoy?date=${iso}${q}`;

  const dipEmpty = (
    <>Sin actividad de la Cámara de Diputados {isToday ? "hoy" : "en esta fecha"}.{" "}
      <Link href={dlink(shift(date, -1))} className="font-medium underline" style={{ color: "var(--accent)" }}>ver día anterior</Link>{" · "}
      <Link href="/monitoreo" className="font-medium underline" style={{ color: "var(--accent)" }}>estado de monitoreo</Link>
    </>
  );

  return (
    <AppShell lang={lang} title="¿Qué tenemos hoy?" subtitle={`Actividad legislativa · ${pretty}`}>
      {/* Date navigation stepper */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={dlink(shift(date, -1))} className="card px-2.5 py-1 text-sm" aria-label="Día anterior">←</Link>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          {isToday ? "HOY" : "FECHA"} · {date}
        </span>
        <Link href={dlink(shift(date, 1))} className="card px-2.5 py-1 text-sm" aria-label="Día siguiente">→</Link>
        {!isToday && (
          <Link href={dlink(todayISO())} className="text-[12px] font-medium underline" style={{ color: "var(--accent)" }}>
            volver a hoy
          </Link>
        )}
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Ambas cámaras · Cámara de Diputados y Senado
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={dip.length + sen.length} label="Actividades" />
        <StatTile value={plenary} label="Pleno / Asamblea" accent="#3b82f6" />
        <StatTile value={committees} label="Comisiones" accent="#8b5cf6" />
        <StatTile value={billsOnAgenda} label="Iniciativas en agenda (Dip.)" accent="#d97706" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={`Cámara de Diputados · ${dip.length}`} flush>
          <ActivityList items={dip} empty={dipEmpty} />
        </Panel>
        <Panel
          title={`Senado · ${sen.length}`}
          flush
          action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>agenda reciente (7 días)</span>}
        >
          <ActivityList items={sen} empty="Sin agendas del Senado publicadas en los últimos 7 días." />
        </Panel>
      </div>

      <div className="card mt-6 p-5">
        <div className="eyebrow mb-3">Cómo leer los estados</div>
        <StatusLegend />
        <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
          "Iniciativas en agenda" cuenta sólo la Cámara de Diputados; la vinculación de iniciativas del Senado por agenda
          está pendiente (ver Estado de monitoreo). El Senado se muestra en ventana de 7 días porque sus fechas de sesión
          pueden publicarse con retraso.
        </p>
      </div>
    </AppShell>
  );
}
