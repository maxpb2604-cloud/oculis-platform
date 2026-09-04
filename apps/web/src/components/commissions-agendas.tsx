"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Clock,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { ChamberToggle, type Chamber } from "@/components/ui/chamber-toggle";
import { Modal } from "@/components/ui/modal";
import type { ActivityItem } from "@/components/monitoring";
import { safeOfficialActivityUrl } from "@/lib/activity-links";
import {
  buildMonthGrid,
  monthBounds,
  normalizeCommissionName,
  shiftCalendarView,
  weekDates,
  type CommissionCalendarView,
} from "@/lib/commission-calendar";
import { formatOfficialTime } from "@/lib/format";

export interface CommissionSummary {
  name: string;
  president: string | null;
}

interface CommissionGroup extends CommissionSummary {
  key: string;
  meetings: ActivityItem[];
  publicAgendaCount: number;
}

const WEEKDAYS = {
  es: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

function formatLongDate(iso: string, es: boolean) {
  const formatted = new Intl.DateTimeFormat(es ? "es-DO" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
  return formatted.charAt(0).toLocaleUpperCase(es ? "es-DO" : "en-US") + formatted.slice(1);
}

function formatMonth(iso: string, es: boolean) {
  const formatted = new Intl.DateTimeFormat(es ? "es-DO" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso.slice(0, 7)}-01T12:00:00Z`));
  return formatted.charAt(0).toLocaleUpperCase(es ? "es-DO" : "en-US") + formatted.slice(1);
}

function formatWeek(isoDates: string[], es: boolean): string {
  const locale = es ? "es-DO" : "en-US";
  const formatPart = (iso: string, includeYear: boolean) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      ...(includeYear ? { year: "numeric" as const } : {}),
      timeZone: "UTC",
    }).format(new Date(`${iso}T12:00:00Z`));
  const first = isoDates[0]!;
  const last = isoDates.at(-1)!;
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const range = `${formatPart(first, !sameYear)} – ${formatPart(last, true)}`;
  return es ? `Semana del ${range}` : `Week of ${range}`;
}

function formatWeekday(iso: string, es: boolean): string {
  const formatted = new Intl.DateTimeFormat(es ? "es-DO" : "en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
  return formatted.charAt(0).toLocaleUpperCase(es ? "es-DO" : "en-US") + formatted.slice(1);
}

function formatDayNumber(iso: string, es: boolean): string {
  return new Intl.DateTimeFormat(es ? "es-DO" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function displayMeetingTime(item: ActivityItem, lang: "es" | "en"): string | null {
  if (!item.eventTime) return null;
  const formatted = formatOfficialTime(item.eventTime, lang);
  return formatted === "No informado" || formatted === "Not reported" ? null : formatted;
}

function hasPublicAgenda(item: ActivityItem): boolean {
  return Boolean(safeOfficialActivityUrl(item.agendaUrl, item.source, item.sourceEventId));
}

function meetingCountLabel(count: number, es: boolean): string {
  if (es) return count === 1 ? "reunión publicada" : "reuniones publicadas";
  return count === 1 ? "published meeting" : "published meetings";
}

function publicAgendaCountLabel(count: number, es: boolean): string {
  if (es) return count === 1 ? "agenda pública" : "agendas públicas";
  return count === 1 ? "public agenda" : "public agendas";
}

function sortMeetings(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort(
    (a, b) =>
      (a.eventDate ?? "").localeCompare(b.eventDate ?? "") ||
      (a.eventTime ?? "").localeCompare(b.eventTime ?? "") ||
      a.id - b.id,
  );
}

function groupCommissions(
  commissions: CommissionSummary[],
  meetings: ActivityItem[],
  locale: string,
): CommissionGroup[] {
  const groups = new Map<string, CommissionGroup>();

  for (const commission of commissions) {
    const key = normalizeCommissionName(commission.name);
    if (!key || groups.has(key)) continue;
    groups.set(key, { ...commission, key, meetings: [], publicAgendaCount: 0 });
  }

  for (const meeting of meetings) {
    const name = meeting.body?.trim();
    if (!name) continue;
    const key = normalizeCommissionName(name);
    const group = groups.get(key) ?? {
      key,
      name,
      president: null,
      meetings: [],
      publicAgendaCount: 0,
    };
    group.meetings.push(meeting);
    if (hasPublicAgenda(meeting)) group.publicAgendaCount += 1;
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, meetings: sortMeetings(group.meetings) }))
    .sort(
      (first, second) =>
        Number(second.meetings.length > 0) - Number(first.meetings.length > 0) ||
        first.name.localeCompare(second.name, locale),
    );
}

export function CommissionsAgendas({
  es,
  selectedDate,
  today,
  dipItems,
  senItems,
  dipCommissions,
  senCommissions,
}: {
  es: boolean;
  selectedDate: string;
  today: string;
  dipItems: ActivityItem[];
  senItems: ActivityItem[];
  dipCommissions: CommissionSummary[];
  senCommissions: CommissionSummary[];
}) {
  const lang = es ? "es" : "en";
  const locale = es ? "es-DO" : "en-US";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chamber: Chamber = searchParams.get("chamber") === "senado" ? "senadores" : "diputados";
  const calendarView: CommissionCalendarView =
    searchParams.get("view") === "week" || searchParams.get("view") === "day"
      ? (searchParams.get("view") as CommissionCalendarView)
      : "month";
  const isDip = chamber === "diputados";
  const items = isDip ? dipItems : senItems;
  const commissions = isDip ? dipCommissions : senCommissions;
  const chamberLabel = isDip
    ? es
      ? "Cámara de Diputados"
      : "Chamber of Deputies"
    : es
      ? "Senado de la República"
      : "Senate of the Republic";
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale));
  const [openCommissionKey, setOpenCommissionKey] = useState<string | null>(null);

  const pageHref = (
    values: { date?: string; chamber?: Chamber; view?: CommissionCalendarView } = {},
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    if (values.date) params.set("date", values.date);
    if (values.chamber === "senadores") params.set("chamber", "senado");
    if (values.chamber === "diputados") params.delete("chamber");
    if (values.view === "month") params.delete("view");
    if (values.view === "week" || values.view === "day") params.set("view", values.view);
    const queryString = params.toString();
    return `${pathname}${queryString ? `?${queryString}` : ""}`;
  };

  const agendaHref = (item: ActivityItem) => {
    const params = new URLSearchParams();
    if (!isDip) params.set("chamber", "senado");
    if (item.eventDate) params.set("date", item.eventDate);
    if (calendarView !== "month") params.set("view", calendarView);
    if (!es) params.set("lang", "en");
    const queryString = params.toString();
    return `/agenda/${item.id}${queryString ? `?${queryString}` : ""}`;
  };

  const meetingsByDate = useMemo(() => {
    const grouped = new Map<string, ActivityItem[]>();
    for (const item of items) {
      if (!item.eventDate) continue;
      const current = grouped.get(item.eventDate) ?? [];
      current.push(item);
      grouped.set(item.eventDate, current);
    }
    for (const [date, meetings] of grouped) grouped.set(date, sortMeetings(meetings));
    return grouped;
  }, [items]);

  const selectedMonth = monthBounds(selectedDate);
  const selectedWeek = weekDates(selectedDate);
  const monthItems = items.filter(
    (item) =>
      item.eventDate != null &&
      item.eventDate >= selectedMonth.from &&
      item.eventDate <= selectedMonth.to,
  );
  const periodItems = items.filter((item) => {
    if (!item.eventDate) return false;
    if (calendarView === "day") return item.eventDate === selectedDate;
    if (calendarView === "week") return selectedWeek.includes(item.eventDate);
    return item.eventDate >= selectedMonth.from && item.eventDate <= selectedMonth.to;
  });
  const selectedMeetings = meetingsByDate.get(selectedDate) ?? [];
  const activeDays = new Set(periodItems.map((item) => item.eventDate).filter(Boolean)).size;
  const publicAgendaCount = periodItems.filter(hasPublicAgenda).length;
  const directory = useMemo(
    () => groupCommissions(commissions, monthItems, locale),
    [commissions, monthItems, locale],
  );
  const visibleDirectory = deferredQuery
    ? directory.filter((commission) =>
        [commission.name, commission.president]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase(locale).includes(deferredQuery)),
      )
    : directory;
  const openCommission = openCommissionKey
    ? (directory.find((commission) => commission.key === openCommissionKey) ?? null)
    : null;
  const grid = buildMonthGrid(selectedDate);
  const periodTitle =
    calendarView === "day"
      ? formatLongDate(selectedDate, es)
      : calendarView === "week"
        ? formatWeek(selectedWeek, es)
        : formatMonth(selectedDate, es);
  const previousDate = shiftCalendarView(selectedDate, calendarView, -1);
  const nextDate = shiftCalendarView(selectedDate, calendarView, 1);
  const periodNoun =
    calendarView === "day"
      ? es
        ? "día"
        : "day"
      : calendarView === "week"
        ? es
          ? "semana"
          : "week"
        : es
          ? "mes"
          : "month";

  return (
    <>
      <section
        className="mb-6 flex flex-col gap-4 rounded-[var(--radius-xl)] border bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:flex-row sm:items-center sm:justify-between"
        aria-label={es ? "Seleccionar cámara" : "Select chamber"}
      >
        <div>
          <p className="eyebrow">{es ? "Cámara legislativa" : "Legislative chamber"}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {es
              ? "El calendario, las reuniones y las comisiones cambian juntos."
              : "The calendar, meetings, and committees update together."}
          </p>
        </div>
        <ChamberToggle
          value={chamber}
          hrefFor={(next) => pageHref({ chamber: next })}
          lang={lang}
        />
      </section>

      <section aria-labelledby="commission-calendar-heading">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <p className="eyebrow text-[var(--accent)]">
              {es ? "Calendario oficial" : "Official calendar"}
            </p>
            <h2 id="commission-calendar-heading" className="section-title mt-1.5">
              {periodTitle}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {es
                ? "Seleccione un día o abra directamente una reunión para consultar su agenda."
                : "Select a day or open a meeting directly to review its agenda."}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <div
              role="group"
              aria-label={es ? "Vista del calendario" : "Calendar view"}
              className="grid grid-cols-3 rounded-xl border bg-[var(--surface-2)] p-1"
            >
              {(["month", "week", "day"] as const).map((view) => {
                const selected = calendarView === view;
                const label =
                  view === "month"
                    ? es
                      ? "Mes"
                      : "Month"
                    : view === "week"
                      ? es
                        ? "Semana"
                        : "Week"
                      : es
                        ? "Día"
                        : "Day";
                return (
                  <a
                    key={view}
                    href={pageHref({ view })}
                    aria-current={selected ? "page" : undefined}
                    className="inline-flex min-h-11 min-w-[76px] items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors"
                    style={
                      selected
                        ? {
                            background: "var(--accent)",
                            color: "white",
                            boxShadow: "var(--shadow-xs)",
                          }
                        : { color: "var(--text-muted)" }
                    }
                  >
                    {label}
                  </a>
                );
              })}
            </div>
            <dl className="grid grid-cols-3 gap-5 rounded-xl border bg-[var(--surface)] px-4 py-3 text-right">
              <div>
                <dt className="eyebrow">{es ? "Reuniones" : "Meetings"}</dt>
                <dd className="tnum mt-1 text-xl font-semibold">{periodItems.length}</dd>
              </div>
              <div>
                <dt className="eyebrow">{es ? "Días activos" : "Active days"}</dt>
                <dd className="tnum mt-1 text-xl font-semibold">{activeDays}</dd>
              </div>
              <div>
                <dt className="eyebrow">{es ? "Agendas públicas" : "Public agendas"}</dt>
                <dd className="tnum mt-1 text-xl font-semibold text-[var(--verified)]">
                  {publicAgendaCount}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div
          className={
            calendarView === "day"
              ? "grid gap-5"
              : "grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.65fr)]"
          }
        >
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <a
                  href={pageHref({ date: previousDate })}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
                  aria-label={es ? `${periodNoun} anterior` : `Previous ${periodNoun}`}
                >
                  <CaretLeft size={18} aria-hidden />
                </a>
                <a
                  href={pageHref({ date: nextDate })}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
                  aria-label={es ? `${periodNoun} siguiente` : `Next ${periodNoun}`}
                >
                  <CaretRight size={18} aria-hidden />
                </a>
                <a
                  href={pageHref({ date: today })}
                  className="inline-flex min-h-11 items-center rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
                >
                  {es ? "Ir a hoy" : "Go to today"}
                </a>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle
                    size={13}
                    weight="fill"
                    className="text-[var(--verified)]"
                    aria-hidden
                  />
                  {es ? "Agenda pública" : "Public agenda"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={13} className="text-[var(--accent)]" aria-hidden />
                  {es ? "Reunión publicada" : "Published meeting"}
                </span>
              </div>
            </div>

            {calendarView === "month" ? (
              <>
                <div className="grid grid-cols-7 border-b bg-[var(--surface-2)] px-2 py-2 sm:px-3">
                  {WEEKDAYS[lang].map((day) => (
                    <div key={day} className="eyebrow py-1 text-center">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
                  {grid.map((cell, index) => {
                    if (!cell.iso) {
                      return (
                        <div
                          key={`empty-${index}`}
                          aria-hidden
                          className="min-h-[74px] bg-[var(--surface-2)] sm:min-h-[94px] lg:min-h-[118px]"
                        />
                      );
                    }
                    const meetings = meetingsByDate.get(cell.iso) ?? [];
                    const selected = cell.iso === selectedDate;
                    const isToday = cell.iso === today;
                    const dayHasPublicAgenda = meetings.some(hasPublicAgenda);
                    return (
                      <div
                        key={cell.iso}
                        className="min-h-[74px] min-w-0 bg-[var(--surface)] p-1.5 sm:min-h-[94px] sm:p-2 lg:min-h-[118px]"
                        style={
                          selected ? { boxShadow: "inset 0 0 0 2px var(--accent)" } : undefined
                        }
                      >
                        <div className="flex items-start justify-between gap-1">
                          <a
                            href={pageHref({ date: cell.iso })}
                            aria-label={formatLongDate(cell.iso, es)}
                            aria-current={selected ? "date" : undefined}
                            className="tnum inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors hover:bg-[var(--accent-soft)]"
                            style={
                              selected
                                ? { background: "var(--accent)", color: "white" }
                                : isToday
                                  ? {
                                      color: "var(--accent)",
                                      boxShadow: "inset 0 0 0 1px var(--accent)",
                                    }
                                  : undefined
                            }
                          >
                            {cell.day}
                          </a>
                          {meetings.length > 0 && (
                            <MeetingCount
                              count={meetings.length}
                              es={es}
                              publicAgenda={dayHasPublicAgenda}
                            />
                          )}
                        </div>
                        <div className="mt-1 hidden flex-col gap-1 lg:flex">
                          {meetings.slice(0, 2).map((meeting) => {
                            const meetingTime = displayMeetingTime(meeting, lang);
                            return (
                              <Link
                                key={meeting.id}
                                href={agendaHref(meeting)}
                                className="block truncate rounded px-1.5 py-1 text-[10px] font-medium leading-tight transition-colors hover:brightness-110"
                                style={{
                                  background: hasPublicAgenda(meeting)
                                    ? "var(--verified-soft)"
                                    : "var(--accent-soft)",
                                  color: hasPublicAgenda(meeting)
                                    ? "var(--verified)"
                                    : "var(--accent)",
                                }}
                                title={meeting.body ?? meeting.description}
                              >
                                {meetingTime ? `${meetingTime} · ` : ""}
                                {meeting.body || (es ? "Reunión de comisión" : "Committee meeting")}
                              </Link>
                            );
                          })}
                          {meetings.length > 2 && (
                            <a
                              href={pageHref({ date: cell.iso })}
                              className="px-1.5 text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)]"
                            >
                              +{meetings.length - 2} {es ? "más" : "more"}
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : calendarView === "week" ? (
              <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-7">
                {selectedWeek.map((iso) => {
                  const meetings = meetingsByDate.get(iso) ?? [];
                  const selected = iso === selectedDate;
                  return (
                    <div
                      key={iso}
                      className="min-h-[250px] min-w-0 bg-[var(--surface)] p-3"
                      style={selected ? { boxShadow: "inset 0 0 0 2px var(--accent)" } : undefined}
                    >
                      <a
                        href={pageHref({ date: iso })}
                        aria-current={selected ? "date" : undefined}
                        className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 transition-colors hover:bg-[var(--surface-2)]"
                      >
                        <span>
                          <span className="block text-xs font-semibold">
                            {formatWeekday(iso, es)}
                          </span>
                          <span className="tnum mt-0.5 block text-[11px] text-[var(--text-muted)]">
                            {formatDayNumber(iso, es)}
                          </span>
                        </span>
                        {meetings.length > 0 && (
                          <MeetingCount
                            count={meetings.length}
                            es={es}
                            publicAgenda={meetings.some(hasPublicAgenda)}
                          />
                        )}
                      </a>
                      <div className="mt-2 space-y-2">
                        {meetings.length > 0 ? (
                          meetings
                            .slice(0, 4)
                            .map((meeting) => (
                              <WeekMeetingLink
                                key={meeting.id}
                                meeting={meeting}
                                href={agendaHref(meeting)}
                                es={es}
                              />
                            ))
                        ) : (
                          <p className="px-2 py-5 text-xs text-[var(--text-muted)]">
                            {es ? "Sin reuniones" : "No meetings"}
                          </p>
                        )}
                        {meetings.length > 4 && (
                          <a
                            href={pageHref({ date: iso, view: "day" })}
                            className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-[var(--accent)] hover:underline"
                          >
                            +{meetings.length - 4} {es ? "reuniones" : "meetings"}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-px bg-[var(--border)]">
                {selectedMeetings.length > 0 ? (
                  selectedMeetings.map((meeting) => (
                    <div key={meeting.id} className="bg-[var(--surface)]">
                      <MeetingLink meeting={meeting} href={agendaHref(meeting)} es={es} spacious />
                    </div>
                  ))
                ) : (
                  <div className="col-span-full flex min-h-[320px] flex-col items-center justify-center bg-[var(--surface)] px-6 py-10 text-center">
                    <CalendarBlank size={38} className="text-[var(--text-subtle)]" aria-hidden />
                    <p className="mt-3 text-sm font-semibold">
                      {es ? "No hay reuniones registradas" : "No meetings are recorded"}
                    </p>
                    <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
                      {es
                        ? "Use las flechas para cambiar de día o regrese a la vista semanal o mensual."
                        : "Use the arrows to change the day or return to the week or month view."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {calendarView !== "day" && (
            <aside className="card flex min-h-[360px] flex-col overflow-hidden" aria-live="polite">
              <div className="border-b px-5 py-4">
                <p className="eyebrow text-[var(--accent)]">
                  {es ? "Agenda del día" : "Agenda for the day"}
                </p>
                <h3 className="serif mt-1.5 text-lg font-semibold">
                  {formatLongDate(selectedDate, es)}
                </h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {selectedMeetings.length} {meetingCountLabel(selectedMeetings.length, es)}
                </p>
              </div>
              {selectedMeetings.length > 0 ? (
                <div className="divide-y">
                  {selectedMeetings.map((meeting) => (
                    <MeetingLink
                      key={meeting.id}
                      meeting={meeting}
                      href={agendaHref(meeting)}
                      es={es}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                  <CalendarBlank size={34} className="text-[var(--text-subtle)]" aria-hidden />
                  <p className="mt-3 text-sm font-semibold">
                    {es ? "No hay reuniones registradas" : "No meetings are recorded"}
                  </p>
                  <p className="mt-1 max-w-[30ch] text-xs leading-relaxed text-[var(--text-muted)]">
                    {es
                      ? "Seleccione otro día marcado en el calendario."
                      : "Choose another marked day in the calendar."}
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
      </section>

      <section className="mt-10 border-t pt-8" aria-labelledby="commission-directory-heading">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow text-[var(--accent)]">{chamberLabel}</p>
            <h2 id="commission-directory-heading" className="section-title mt-1.5">
              {es ? "Todas las comisiones" : "All committees"}
            </h2>
            <p className="mt-1 max-w-[72ch] text-sm text-[var(--text-muted)]">
              {es
                ? "Abra una comisión para ver sus reuniones del mes y distinguir cuáles tienen una agenda oficial disponible."
                : "Open a committee to see this month's meetings and which ones have an official agenda available."}
            </p>
          </div>
          <div className="relative w-full max-w-sm">
            <label htmlFor="commission-directory-search" className="sr-only">
              {es ? "Buscar comisión" : "Search committee"}
            </label>
            <MagnifyingGlass
              size={17}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              id="commission-directory-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={es ? "Buscar comisión o presidente…" : "Search committee or chair…"}
              className="min-h-11 w-full rounded-lg border bg-[var(--surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
          <span>
            {visibleDirectory.length} {es ? "comisiones mostradas" : "committees shown"}
          </span>
          <span>{es ? "Actividad del mes seleccionado" : "Activity in the selected month"}</span>
        </div>

        {visibleDirectory.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleDirectory.map((commission) => {
              const nextMeeting = commission.meetings.find(
                (meeting) => (meeting.eventDate ?? "") >= today,
              );
              const referenceMeeting = nextMeeting ?? commission.meetings.at(-1) ?? null;
              return (
                <button
                  key={commission.key}
                  type="button"
                  onClick={() => setOpenCommissionKey(commission.key)}
                  className="card group flex min-h-[178px] flex-col p-5 text-left shadow-[var(--shadow-xs)] transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[var(--shadow-md)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="serif text-[17px] font-semibold leading-snug">
                      {commission.name}
                    </span>
                    <span
                      className="tnum inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-bold"
                      style={{
                        background:
                          commission.meetings.length > 0
                            ? "var(--accent-soft)"
                            : "var(--surface-2)",
                        color:
                          commission.meetings.length > 0 ? "var(--accent)" : "var(--text-muted)",
                      }}
                    >
                      {commission.meetings.length}
                    </span>
                  </div>
                  {commission.president && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {es ? "Preside" : "Chair"}: {commission.president}
                    </p>
                  )}
                  <div className="mt-4 border-t pt-3 text-xs">
                    {referenceMeeting?.eventDate ? (
                      <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <CalendarBlank size={15} aria-hidden />
                        <span>{formatLongDate(referenceMeeting.eventDate, es)}</span>
                      </div>
                    ) : (
                      <span className="text-[var(--text-muted)]">
                        {es
                          ? "Sin reuniones publicadas este mes"
                          : "No meetings published this month"}
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-3 pt-4 text-[11px]">
                    <span
                      className="font-semibold"
                      style={{
                        color:
                          commission.publicAgendaCount > 0
                            ? "var(--verified)"
                            : "var(--text-muted)",
                      }}
                    >
                      {commission.publicAgendaCount}{" "}
                      {publicAgendaCountLabel(commission.publicAgendaCount, es)}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] group-hover:underline">
                      {es ? "Ver comisión" : "View committee"}
                      <ArrowRight size={13} aria-hidden />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="card mt-4 px-5 py-10 text-center text-sm text-[var(--text-muted)]">
            {es
              ? "No encontramos una comisión con esa búsqueda."
              : "No committee matches that search."}
          </div>
        )}
      </section>

      {openCommission && (
        <CommissionDialog
          commission={openCommission}
          month={formatMonth(selectedDate, es)}
          es={es}
          agendaHref={agendaHref}
          onClose={() => setOpenCommissionKey(null)}
        />
      )}
    </>
  );
}

function MeetingCount({
  count,
  es,
  publicAgenda,
}: {
  count: number;
  es: boolean;
  publicAgenda: boolean;
}) {
  return (
    <span
      className="tnum inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1 text-[10px] font-bold"
      style={{
        background: publicAgenda ? "var(--verified-soft)" : "var(--accent-soft)",
        color: publicAgenda ? "var(--verified)" : "var(--accent)",
      }}
      aria-label={`${count} ${
        es ? (count === 1 ? "reunión" : "reuniones") : count === 1 ? "meeting" : "meetings"
      }`}
    >
      {count}
    </span>
  );
}

function WeekMeetingLink({
  meeting,
  href,
  es,
}: {
  meeting: ActivityItem;
  href: string;
  es: boolean;
}) {
  const publicAgenda = hasPublicAgenda(meeting);
  const meetingTime = displayMeetingTime(meeting, es ? "es" : "en");
  return (
    <Link
      href={href}
      className="group block rounded-lg border px-2.5 py-2.5 transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-2)]"
    >
      <span className="flex items-center justify-between gap-2 text-[10px] font-semibold text-[var(--text-muted)]">
        <span>{meetingTime ?? (es ? "Hora no informada" : "Time not reported")}</span>
        {publicAgenda ? (
          <CheckCircle size={14} weight="fill" className="text-[var(--verified)]" aria-hidden />
        ) : (
          <Clock size={14} className="text-[var(--accent)]" aria-hidden />
        )}
      </span>
      <span className="mt-1 line-clamp-3 text-xs font-semibold leading-snug">
        {meeting.body || (es ? "Reunión de comisión" : "Committee meeting")}
      </span>
      <span
        className="mt-1.5 block text-[10px] font-semibold"
        style={{ color: publicAgenda ? "var(--verified)" : "var(--text-muted)" }}
      >
        {publicAgenda
          ? es
            ? "Agenda pública"
            : "Public agenda"
          : es
            ? "Agenda no publicada"
            : "Agenda not published"}
      </span>
    </Link>
  );
}

function MeetingLink({
  meeting,
  href,
  es,
  spacious = false,
}: {
  meeting: ActivityItem;
  href: string;
  es: boolean;
  spacious?: boolean;
}) {
  const publicAgenda = hasPublicAgenda(meeting);
  const lang = es ? "es" : "en";
  const meetingTime = displayMeetingTime(meeting, lang);
  return (
    <Link
      href={href}
      className={`group flex items-start gap-3 transition-colors hover:bg-[var(--surface-2)] ${
        spacious ? "px-6 py-6" : "px-5 py-4"
      }`}
    >
      <div
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: publicAgenda ? "var(--verified-soft)" : "var(--accent-soft)",
          color: publicAgenda ? "var(--verified)" : "var(--accent)",
        }}
      >
        {publicAgenda ? (
          <CheckCircle size={18} weight="fill" aria-hidden />
        ) : (
          <Clock size={18} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">
          {meeting.body || (es ? "Reunión de comisión" : "Committee meeting")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
          {meetingTime && <span>{meetingTime}</span>}
          <span style={{ color: publicAgenda ? "var(--verified)" : "var(--text-muted)" }}>
            {publicAgenda
              ? es
                ? "Agenda pública"
                : "Public agenda"
              : es
                ? "Agenda aún no publicada"
                : "Agenda not yet published"}
          </span>
          {meeting.initiativeCount > 0 && (
            <span>
              {meeting.initiativeCount}{" "}
              {es
                ? meeting.initiativeCount === 1
                  ? "iniciativa"
                  : "iniciativas"
                : meeting.initiativeCount === 1
                  ? "initiative"
                  : "initiatives"}
            </span>
          )}
        </div>
      </div>
      <ArrowRight
        size={17}
        className="mt-2 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
        aria-hidden
      />
    </Link>
  );
}

function CommissionDialog({
  commission,
  month,
  es,
  agendaHref,
  onClose,
}: {
  commission: CommissionGroup;
  month: string;
  es: boolean;
  agendaHref: (item: ActivityItem) => string;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="commission-agendas-dialog-title"
      className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
      panelStyle={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="eyebrow text-[var(--accent)]">
            {es ? "Comisión · reuniones y agendas" : "Committee · meetings and agendas"}
          </p>
          <h2
            id="commission-agendas-dialog-title"
            className="serif mt-1.5 text-xl font-semibold leading-tight"
          >
            {commission.name}
          </h2>
          {commission.president && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {es ? "Preside" : "Chair"}: {commission.president}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={es ? "Cerrar" : "Close"}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
        >
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="border-b bg-[var(--surface-2)] px-5 py-3 text-xs text-[var(--text-muted)] sm:px-6">
        <span>{month}</span> · {commission.meetings.length}{" "}
        {meetingCountLabel(commission.meetings.length, es)} · {commission.publicAgendaCount}{" "}
        {publicAgendaCountLabel(commission.publicAgendaCount, es)}
      </div>
      <div className="overflow-y-auto">
        {commission.meetings.length > 0 ? (
          <div className="divide-y">
            {commission.meetings.map((meeting) => (
              <div key={meeting.id}>
                <div className="px-5 pt-4 text-[11px] font-semibold text-[var(--text-muted)] sm:px-6">
                  {meeting.eventDate ? formatLongDate(meeting.eventDate, es) : null}
                </div>
                <MeetingLink meeting={meeting} href={agendaHref(meeting)} es={es} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
            <CalendarBlank size={36} className="text-[var(--text-subtle)]" aria-hidden />
            <p className="mt-3 text-sm font-semibold">
              {es ? "Sin reuniones publicadas este mes" : "No meetings published this month"}
            </p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
              {es
                ? "La comisión permanece en el directorio y aparecerá aquí cuando la fuente oficial publique una reunión."
                : "The committee remains in the directory and will appear here when the official source publishes a meeting."}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
