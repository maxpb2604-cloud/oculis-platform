import type { Lang } from "@/lib/i18n";

const MONTHS = {
  es: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
} as const;

const SHORT_MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
} as const;

const WEEKDAYS = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
} as const;

function parts(iso: string): { year: number; month: number; day: number; weekday: number } {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return { year: year!, month: month!, day: day!, weekday: date.getUTCDay() };
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function formatCommissionLongDate(iso: string, lang: Lang): string {
  const date = parts(iso);
  if (lang === "es") {
    return capitalize(
      `${WEEKDAYS.es[date.weekday]}, ${date.day} de ${MONTHS.es[date.month - 1]} de ${date.year}`,
    );
  }
  return `${WEEKDAYS.en[date.weekday]}, ${MONTHS.en[date.month - 1]} ${date.day}, ${date.year}`;
}

export function formatCommissionMonth(iso: string, lang: Lang): string {
  const date = parts(iso);
  return lang === "es"
    ? `${capitalize(MONTHS.es[date.month - 1]!)} de ${date.year}`
    : `${MONTHS.en[date.month - 1]} ${date.year}`;
}

export function formatCommissionWeekday(iso: string, lang: Lang): string {
  const date = parts(iso);
  return capitalize(WEEKDAYS[lang][date.weekday]!);
}

export function formatCommissionDayNumber(iso: string, lang: Lang): string {
  const date = parts(iso);
  return lang === "es"
    ? `${date.day} ${SHORT_MONTHS.es[date.month - 1]}`
    : `${SHORT_MONTHS.en[date.month - 1]} ${date.day}`;
}

export function formatCommissionWeek(isoDates: string[], lang: Lang): string {
  const first = parts(isoDates[0]!);
  const last = parts(isoDates.at(-1)!);
  const sameYear = first.year === last.year;
  const endpoint = (date: ReturnType<typeof parts>, includeYear: boolean) => {
    if (lang === "es") {
      return `${date.day} ${SHORT_MONTHS.es[date.month - 1]}${includeYear ? ` de ${date.year}` : ""}`;
    }
    return `${SHORT_MONTHS.en[date.month - 1]} ${date.day}${includeYear ? `, ${date.year}` : ""}`;
  };
  const range = `${endpoint(first, !sameYear)} – ${endpoint(last, true)}`;
  return lang === "es" ? `Semana del ${range}` : `Week of ${range}`;
}
