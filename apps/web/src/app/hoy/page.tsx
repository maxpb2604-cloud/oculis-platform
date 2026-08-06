import Link from "next/link";
import {
  getDayActivity,
  getDeposits,
  getDepositsRange,
  getRangeActivity,
  todayISO,
} from "@/lib/data";
import { langParam, langQuery, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { HoyChambers } from "@/components/hoy-chambers";
import { LiveClock } from "@/components/live-clock";
import { RangePicker } from "@/components/range-picker";
import { dateSpanDays, isISODate } from "@/lib/input";

export const dynamic = "force-dynamic";

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
  const q = langParam(lang);

  const from = sp.from;
  const to = sp.to;
  const isRange = !!(
    isISODate(from) &&
    isISODate(to) &&
    from <= to &&
    dateSpanDays(from, to) <= 366
  );

  const date = isISODate(sp.date) ? sp.date : todayISO();
  const isToday = !isRange && date === todayISO();
  const dlink = (iso: string) => `/hoy?date=${iso}${q}`;

  const [activity, deposits, senDeposits] = await Promise.all([
    isRange ? getRangeActivity(from!, to!) : getDayActivity({ date, senateWindowDays: 0 }),
    isRange ? getDepositsRange(from!, to!) : getDeposits(date),
    // Senate deposits: only the selected day (today by default), same as Diputados.
    isRange ? getDepositsRange(from!, to!, "SENADO") : getDeposits(date, "SENADO"),
  ]);
  const { dip, sen } = activity;
  const isCommittee = (i: { scope: string }) => i.scope === "COMMITTEE";
  const isPlenary = (i: { scope: string }) => i.scope === "PLENARY" || i.scope === "ASAMBLEA";
  // Every persisted source record remains visible. Exact source identifiers provide
  // idempotency; the UI does not collapse rows because their content looks similar.
  const dipCommittee = dip.filter(isCommittee);
  const senCommittee = sen.filter(isCommittee);
  const dipPlenary = dip.filter(isPlenary);
  const senPlenary = sen.filter(isPlenary);

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(es ? "es-DO" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso + "T12:00:00"));
  // Plain-language label for the active window (used in panel titles / empty states).
  const when = isRange
    ? es
      ? `del ${fmt(from!)} al ${fmt(to!)}`
      : `from ${fmt(from!)} to ${fmt(to!)}`
    : isToday
      ? es
        ? "hoy"
        : "today"
      : es
        ? "en esta fecha"
        : "on this date";

  const prevLink = (label: string) =>
    isRange ? null : (
      <Link
        href={dlink(shift(date, -1))}
        className="font-medium underline"
        style={{ color: "var(--accent)" }}
      >
        {label}
      </Link>
    );

  return (
    <AppShell
      lang={lang}
      title={es ? "Actividad Legislativa" : "Legislative Activity"}
      subtitle={
        es
          ? "Cámara de Diputados y Senado · monitoreo diario"
          : "Chamber of Deputies & Senate · daily monitoring"
      }
    >
      {/* Dominican Republic clock for the daily view (date seeded server-side). */}
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
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              {fmt(from!)} — {fmt(to!)}
            </span>
            <Link
              href={`/hoy${langQuery(lang)}`}
              className="text-[12px] font-medium underline"
              style={{ color: "var(--accent)" }}
            >
              {es ? "volver a hoy" : "back to today"}
            </Link>
          </>
        ) : (
          <>
            <span className="eyebrow mr-1">{es ? "Mostrando" : "Showing"}</span>
            <Link
              href={dlink(shift(date, -1))}
              className="card px-2.5 py-1 text-xs font-medium"
              aria-label={es ? "Día anterior" : "Previous day"}
            >
              {es ? "Anterior" : "Previous"}
            </Link>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              {isToday ? (es ? "HOY" : "TODAY") : es ? "FECHA" : "DATE"} · {date}
            </span>
            <Link
              href={dlink(shift(date, 1))}
              className="card px-2.5 py-1 text-xs font-medium"
              aria-label={es ? "Día siguiente" : "Next day"}
            >
              {es ? "Siguiente" : "Next"}
            </Link>
            {!isToday && (
              <Link
                href={dlink(todayISO())}
                className="text-[12px] font-medium underline"
                style={{ color: "var(--accent)" }}
              >
                {es ? "volver a hoy" : "back to today"}
              </Link>
            )}
          </>
        )}
        <div className="ml-auto">
          <RangePicker
            lang={lang}
            initialFrom={isRange ? from : null}
            initialTo={isRange ? to : null}
          />
        </div>
      </div>

      {/* Per-chamber feed — segmented toggle switches Diputados ⇄ Senadores */}
      <HoyChambers
        es={es}
        when={when}
        prevDayLink={prevLink(es ? "ver día anterior" : "see previous day")}
        deposits={deposits}
        senDeposits={senDeposits}
        senDepositsWindow={false}
        dipCommittee={dipCommittee}
        senCommittee={senCommittee}
        dipPlenary={dipPlenary}
        senPlenary={senPlenary}
      />

      <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {es
          ? "Iniciativas depositadas: Cámara de Diputados (SIL). Cada ficha enlaza a la fuente oficial; “Con documento oficial” se muestra solo cuando existe un documento registrado y, en caso contrario, figura “No informado”."
          : "Deposited initiatives: Chamber of Deputies (SIL). Each card links to the official source; “With official document” appears only when a document is recorded, otherwise it shows “Not reported”."}
      </p>
    </AppShell>
  );
}
