import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { CommissionsAgendas, type CommissionSummary } from "@/components/commissions-agendas";
import {
  monthBounds,
  normalizeCommissionName,
  type CommissionCalendarView,
  weekBounds,
} from "@/lib/commission-calendar";
import { getCommissions, getCommissionsWithMembers, getRangeActivity, todayISO } from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { isISODate } from "@/lib/input";

export const dynamic = "force-dynamic";

type HoySearchParams = {
  lang?: string;
  date?: string;
  chamber?: string;
  view?: string;
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<HoySearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Comisiones & Agendas",
        description:
          "Calendario de reuniones, comisiones y agendas públicas de la Cámara de Diputados y el Senado.",
      }
    : {
        title: "Committees & Agendas",
        description:
          "Calendar of meetings, committees, and public agendas from the Chamber of Deputies and the Senate.",
      };
}

export default async function HoyPage({
  searchParams,
}: {
  searchParams: Promise<HoySearchParams>;
}) {
  const sp = await searchParams;
  const lang: Lang = parseLang(sp.lang);
  const es = lang === "es";
  const today = todayISO();
  const selectedDate = isISODate(sp.date) ? sp.date : today;
  const view: CommissionCalendarView = sp.view === "week" || sp.view === "day" ? sp.view : "month";
  const month = monthBounds(selectedDate);
  const visibleRange =
    view === "week"
      ? weekBounds(selectedDate)
      : view === "day"
        ? { from: selectedDate, to: selectedDate }
        : month;
  const from = visibleRange.from < month.from ? visibleRange.from : month.from;
  const to = visibleRange.to > month.to ? visibleRange.to : month.to;
  const [
    activity,
    rawDipCommissions,
    rawSenCommissions,
    dipRosterCommissions,
    senRosterCommissions,
  ] = await Promise.all([
    getRangeActivity(from, to),
    getCommissions("DIPUTADOS"),
    getCommissions("SENADO"),
    getCommissionsWithMembers("DIPUTADOS"),
    getCommissionsWithMembers("SENADO"),
  ]);

  const isMeeting = (item: { scope: string; source: string }) =>
    item.scope === "COMMITTEE" && item.source !== "sen-attendance";
  const dipItems = activity.dip.filter(isMeeting);
  const senItems = activity.sen.filter(isMeeting);
  const mergeCommissions = (
    stored: Array<{ name: string; president: string | null }>,
    roster: Array<{
      name: string;
      members: Array<{ name: string; cargo: string | null }>;
    }>,
  ): CommissionSummary[] => {
    const byName = new Map<string, CommissionSummary>();
    for (const commission of stored) {
      byName.set(normalizeCommissionName(commission.name), {
        name: commission.name,
        president: commission.president,
      });
    }
    for (const commission of roster) {
      const key = normalizeCommissionName(commission.name);
      const existing = byName.get(key);
      byName.set(key, {
        name: existing?.name ?? commission.name,
        president:
          existing?.president ??
          commission.members.find((member) => member.cargo === "Presidente")?.name ??
          null,
      });
    }
    return [...byName.values()];
  };

  return (
    <AppShell
      lang={lang}
      title={es ? "Comisiones & Agendas" : "Committees & Agendas"}
      subtitle={
        es
          ? "Calendario de reuniones y agendas públicas de las comisiones del Congreso Nacional."
          : "Calendar of meetings and public agendas for National Congress committees."
      }
    >
      <CommissionsAgendas
        es={es}
        selectedDate={selectedDate}
        today={today}
        dipItems={dipItems}
        senItems={senItems}
        dipCommissions={mergeCommissions(rawDipCommissions, dipRosterCommissions)}
        senCommissions={mergeCommissions(rawSenCommissions, senRosterCommissions)}
      />

      <p className="mt-6 border-t pt-4 text-[11px] leading-relaxed text-[var(--text-muted)]">
        {es
          ? "Oculis muestra una agenda como pública únicamente cuando existe un enlace oficial exacto y disponible. Una reunión puede estar publicada antes de que aparezca su agenda."
          : "Oculis marks an agenda as public only when an exact, available official link exists. A meeting may be published before its agenda appears."}
      </p>
    </AppShell>
  );
}
