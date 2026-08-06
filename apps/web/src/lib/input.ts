export function boundedInteger(
  value: string | null | undefined,
  options: { fallback: number; min: number; max: number },
): number {
  if (value == null || value.trim() === "") return options.fallback;
  if (!/^\d+$/.test(value.trim())) return options.fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return options.fallback;
  return Math.min(options.max, Math.max(options.min, parsed));
}

export function positiveInteger(value: string | null | undefined): number | null {
  if (value == null || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The Senate proxy accepts only the numeric legacy `IdExpediente` value. */
export function senateRecordId(value: string | null | undefined): string | null {
  return value && /^\d{1,10}$/.test(value) ? value : null;
}

export function optionalText(
  value: string | null | undefined,
  maxLength = 160,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

export function isISODate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

export function dateSpanDays(from: string, to: string): number {
  return Math.floor(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

export function isISOTimestamp(value: string | null | undefined): value is string {
  if (!value || value.length > 40) return false;
  return Number.isFinite(Date.parse(value));
}

/** Allow only ordinary external web links from scraped/source-controlled data. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
