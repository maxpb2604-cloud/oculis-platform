import { isISODate } from "@/lib/input";

export interface CommissionCalendarCell {
  iso: string | null;
  day: number | null;
}

export type CommissionCalendarView = "month" | "week" | "day";

function formatISODate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function shiftCalendarDate(iso: string, deltaDays: number): string {
  if (!isISODate(iso) || !Number.isInteger(deltaDays)) throw new Error("Invalid calendar shift");
  const shifted = new Date(`${iso}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return formatISODate(shifted);
}

export function weekDates(iso: string): string[] {
  if (!isISODate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  const date = new Date(`${iso}T12:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = shiftCalendarDate(iso, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => shiftCalendarDate(monday, index));
}

export function weekBounds(iso: string): { from: string; to: string } {
  const dates = weekDates(iso);
  return { from: dates[0]!, to: dates[6]! };
}

export function monthBounds(iso: string): { from: string; to: string } {
  if (!isISODate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  const [year, month] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

/** A stable six-week, Monday-first calendar grid. Empty cells are deliberately null. */
export function buildMonthGrid(iso: string): CommissionCalendarCell[] {
  const { from, to } = monthBounds(iso);
  const [year, month] = from.split("-").map(Number);
  const totalDays = Number(to.slice(-2));
  const sundayFirst = new Date(`${from}T12:00:00Z`).getUTCDay();
  const leading = (sundayFirst + 6) % 7;
  const cells: CommissionCalendarCell[] = Array.from({ length: leading }, () => ({
    iso: null,
    day: null,
  }));

  for (let day = 1; day <= totalDays; day += 1) {
    cells.push({
      iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      day,
    });
  }

  while (cells.length < 42) cells.push({ iso: null, day: null });
  return cells;
}

export function shiftCalendarMonth(iso: string, delta: number): string {
  if (!isISODate(iso) || !Number.isInteger(delta)) throw new Error("Invalid calendar shift");
  const [year, month] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function shiftCalendarView(
  iso: string,
  view: CommissionCalendarView,
  delta: -1 | 1,
): string {
  if (view === "month") return shiftCalendarMonth(iso, delta);
  return shiftCalendarDate(iso, view === "week" ? delta * 7 : delta);
}

/** Spelling-only normalization; committee attribution still requires whole-name equality. */
export function normalizeCommissionName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
