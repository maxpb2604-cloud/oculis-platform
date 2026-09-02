import Link from "next/link";
import type { Metadata } from "next";
import {
  getDayActivity,
  getDeposits,
  getDepositsRange,
  getRangeActivity,
  todayISO,
} from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { HoyChambers } from "@/components/hoy-chambers";
import { RangePicker } from "@/components/range-picker";
import { dateSpanDays, isISODate } from "@/lib/input";
import { toPublicHoyDepositItem } from "@/lib/public-initiative-payloads";

export const dynamic = "force-dynamic";

type HoySearchParams = {
  lang?: string;
  date?: string;
  from?: string;
  to?: string;
  chamber?: string;
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<HoySearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Agenda",
        description:
          "Reuniones, sesiones e iniciativas publicadas por la Cámara de Diputados y el Senado.",
      }
    : {
        title: "Agenda",
        description:
          "Meetings, sessions, and initiatives published by the Chamber of Deputies and the Senate.",
      };
}

function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default async function HoyPage({
  searchParams,
}: {
  searchParams: Promise<HoySearchParams>;
}) {
  const sp = await searchParams;
  const lang: Lang = parseLang(sp.lang);
  const es = lang === "es";
  const chamber = sp.chamber === "senado" ? "senado" : null;

  const hoyHref = (values: Record<string, string | null> = {}) => {
    const params = new URLSearchParams();
    if (lang === "en") params.set("lang", "en");
    if (chamber) params.set("chamber", chamber);
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return `/hoy${query ? `?${query}` : ""}`;
  };

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
  const dlink = (iso: string) => hoyHref({ date: iso });

  const [activity, deposits, senDeposits] = await Promise.all([
    isRange ? getRangeActivity(from!, to!) : getDayActivity({ date, senateWindowDays: 0 }),
    isRange ? getDepositsRange(from!, to!) : getDeposits(date),
    // Senate deposits: only the selected day (today by default), same as Diputados.
    isRange ? getDepositsRange(from!, to!, "SENADO") : getDeposits(date, "SENADO"),
  ]);
  const { dip, sen } = activity;
  // Keep official PDF URLs and their source metadata on the server. The client-side
  // chamber switcher receives only Oculis' guarded local opener.
  const publicDeposits = deposits.map((item) => toPublicHoyDepositItem(item, lang));
  const publicSenDeposits = senDeposits.map((item) => toPublicHoyDepositItem(item, lang));
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
      title={es ? "Agenda" : "Agenda"}
      subtitle={
        es
          ? "Reuniones, sesiones e iniciativas publicadas por el Congreso Nacional."
          : "Meetings, sessions, and initiatives published by the National Congress."
      }
    >
      {/* Controls — day selector (or active period) + custom range picker */}
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b pb-5">
        {isRange ? (
          <>
            <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
              {es ? "Período seleccionado" : "Selected period"}
            </span>
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
              href={hoyHref()}
              className="inline-flex min-h-11 items-center px-2 text-[12px] font-medium underline"
              style={{ color: "var(--accent)" }}
            >
              {es ? "Volver a hoy" : "Back to today"}
            </Link>
          </>
        ) : (
          <>
            <Link
              href={dlink(shift(date, -1))}
              className="inline-flex min-h-11 items-center rounded-lg border px-3 text-xs font-semibold hover:bg-[var(--surface-2)]"
              aria-label={es ? "Día anterior" : "Previous day"}
            >
              {es ? "Anterior" : "Previous"}
            </Link>
            <span
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              {isToday ? (es ? "Hoy" : "Today") : es ? "Fecha" : "Date"} · {date}
            </span>
            <Link
              href={dlink(shift(date, 1))}
              className="inline-flex min-h-11 items-center rounded-lg border px-3 text-xs font-semibold hover:bg-[var(--surface-2)]"
              aria-label={es ? "Día siguiente" : "Next day"}
            >
              {es ? "Siguiente" : "Next"}
            </Link>
            {!isToday && (
              <Link
                href={dlink(todayISO())}
                className="inline-flex min-h-11 items-center px-2 text-[12px] font-medium underline"
                style={{ color: "var(--accent)" }}
              >
                {es ? "Volver a hoy" : "Back to today"}
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
        deposits={publicDeposits}
        senDeposits={publicSenDeposits}
        senDepositsWindow={false}
        dipCommittee={dipCommittee}
        senCommittee={senCommittee}
        dipPlenary={dipPlenary}
        senPlenary={senPlenary}
      />

      <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {es
          ? "Oculis abre un archivo oficial solamente después de comprobar que el enlace corresponde a un PDF disponible."
          : "Oculis opens an official file only after confirming that the link points to an available PDF."}
      </p>
    </AppShell>
  );
}
