import Link from "next/link";
import { getDayActivity, getDeposits, getDepositsRange, getRangeActivity, todayISO } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { ActivityList, DepositList, StatTile } from "@/components/monitoring";
import { LiveClock } from "@/components/live-clock";
import { RangePicker } from "@/components/range-picker";

export const dynamic = "force-dynamic";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default async function HoyPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; date?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "es";
  const es = lang === "es";
  const q = es ? "" : "&lang=en";

  const from = sp.from;
  const to = sp.to;
  const isRange = !!(from && to && ISO_RE.test(from) && ISO_RE.test(to) && from <= to);

  const date = sp.date && ISO_RE.test(sp.date) ? sp.date : todayISO();
  const isToday = !isRange && date === todayISO();
  const dlink = (iso: string) => `/hoy?date=${iso}${q}`;

  const [activity, deposits] = await Promise.all([
    isRange ? getRangeActivity(from!, to!) : getDayActivity({ date }),
    isRange ? getDepositsRange(from!, to!) : getDeposits(date),
  ]);
  const { dip, sen } = activity;
  const committee = [...dip, ...sen].filter((i) => i.scope === "COMMITTEE");
  const plenary = [...dip, ...sen].filter((i) => i.scope === "PLENARY" || i.scope === "ASAMBLEA");
  const docsUp = deposits.filter((d) => d.docUploaded).length;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(es ? "es-DO" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(iso + "T12:00:00"),
    );
  // Plain-language label for the active window (used in panel titles / empty states).
  const when = isRange
    ? es
      ? `del ${fmt(from!)} al ${fmt(to!)}`
      : `from ${fmt(from!)} to ${fmt(to!)}`
    : isToday
      ? es ? "hoy" : "today"
      : es ? "en esta fecha" : "on this date";

  const prevLink = (label: string) =>
    isRange ? null : (
      <Link href={dlink(shift(date, -1))} className="font-medium underline" style={{ color: "var(--accent)" }}>{label}</Link>
    );

  return (
    <AppShell
      lang={lang}
      title={es ? "Actividad Legislativa" : "Legislative Activity"}
      subtitle={es ? "Cámara de Diputados y Senado · monitoreo diario" : "Chamber of Deputies & Senate · daily monitoring"}
    >
      {/* Live "situation-room" clock (date seeded server-side to avoid a hydration flash) */}
      <LiveClock
        lang={lang}
        initialDate={new Intl.DateTimeFormat(es ? "es-DO" : "en-US", {
          timeZone: "America/Santo_Domingo",
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(new Date())}
      />

      {/* Controls — day selector (or active period) + custom range picker */}
      <div className="mb-5 mt-5 flex flex-wrap items-center gap-2">
        {isRange ? (
          <>
            <span className="eyebrow mr-1">{es ? "Período" : "Period"}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
              {fmt(from!)} — {fmt(to!)}
            </span>
            <Link href={`/hoy${es ? "" : "?lang=en"}`} className="text-[12px] font-medium underline" style={{ color: "var(--accent)" }}>
              {es ? "volver a hoy" : "back to today"}
            </Link>
          </>
        ) : (
          <>
            <span className="eyebrow mr-1">{es ? "Mostrando" : "Showing"}</span>
            <Link href={dlink(shift(date, -1))} className="card px-2.5 py-1 text-sm" aria-label="Día anterior">←</Link>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
              {isToday ? (es ? "HOY" : "TODAY") : (es ? "FECHA" : "DATE")} · {date}
            </span>
            <Link href={dlink(shift(date, 1))} className="card px-2.5 py-1 text-sm" aria-label="Día siguiente">→</Link>
            {!isToday && (
              <Link href={dlink(todayISO())} className="text-[12px] font-medium underline" style={{ color: "var(--accent)" }}>
                {es ? "volver a hoy" : "back to today"}
              </Link>
            )}
          </>
        )}
        <div className="ml-auto">
          <RangePicker lang={lang} initialFrom={isRange ? from : null} initialTo={isRange ? to : null} />
        </div>
      </div>

      {/* Counts over the active window */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile value={deposits.length} label={es ? "Iniciativas depositadas" : "Initiatives deposited"} />
        <StatTile value={committee.length} label={es ? "Movimientos en comisión" : "Committee movements"} accent="#8b5cf6" />
        <StatTile value={`${docsUp}/${deposits.length || 0}`} label={es ? "Con documento cargado" : "With document uploaded"} accent="#0b6e4f" />
      </div>

      {/* 1 — Iniciativas depositadas */}
      <div className="mt-6">
        <Panel title={`${es ? "Iniciativas depositadas" : "Initiatives deposited"} · ${deposits.length}`} flush
          action={isRange ? <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{when}</span> : undefined}>
          <DepositList
            items={deposits}
            empty={<>{es ? "No se depositaron iniciativas" : "No initiatives deposited"} {when}. {prevLink(es ? "ver día anterior" : "see previous day")}</>}
          />
        </Panel>
      </div>

      {/* 2 — Movimientos en comisiones (+ pleno secundario) */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={`${es ? "Movimientos en comisiones" : "Committee movements"} · ${committee.length}`} flush
          action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{es ? "ambas cámaras" : "both chambers"}</span>}>
          <ActivityList
            items={committee}
            empty={<>{es ? "Sin movimientos de comisión" : "No committee movements"} {when}. {prevLink(es ? "ver día anterior" : "see previous day")}</>}
          />
        </Panel>
        <Panel title={`${es ? "Pleno y Asamblea" : "Floor & Assembly"} · ${plenary.length}`} flush>
          <ActivityList items={plenary} empty={`${es ? "Sin sesiones de pleno/asamblea" : "No floor/assembly sessions"} ${when}.`} />
        </Panel>
      </div>

      <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {es
          ? 'Iniciativas depositadas: Cámara de Diputados (SIL). Cada ficha enlaza a la página oficial de la iniciativa, donde aparece su documento; "Documento pendiente" indica que el PDF aún no ha sido cargado por la Cámara.'
          : 'Deposited initiatives: Chamber of Deputies (SIL). Each card links to the official initiative page where its document appears; "Documento pendiente" means the PDF has not been uploaded yet.'}
      </p>
    </AppShell>
  );
}
