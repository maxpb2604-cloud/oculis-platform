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

/** Canonical internal legislator profile id used by profile and catalog routes. */
export function parseLegislatorProfileId(value: string | null | undefined): number | null {
  if (value == null || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null;
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
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}

export function dateSpanDays(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function isISOTimestamp(value: string | null | undefined): value is string {
  if (!value || value.length > 40) return false;
  return Number.isFinite(Date.parse(value));
}

function isBlockedWebHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]" || host === "0.0.0.0") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return octets[0] === 127 || octets[0] === 0;
}

/** Allow only ordinary external web links from scraped/source-controlled data. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || isBlockedWebHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isHostOrSubdomain(hostname: string, base: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === base || host.endsWith(`.${base}`);
}

const SOURCE_OFFICIAL_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  "sil-actividad": ["diputadosrd.gob.do", "camaradediputados.gob.do"],
  "sil-diputados": ["diputadosrd.gob.do", "camaradediputados.gob.do"],
  "sil-deposits": ["diputadosrd.gob.do", "camaradediputados.gob.do"],
  "sil-movements": ["diputadosrd.gob.do", "camaradediputados.gob.do"],
  "sil-documents": ["diputadosrd.gob.do", "camaradediputados.gob.do"],
  "dip-oficial": ["camaradediputados.gob.do"],
  "dip-known-agenda": ["camaradediputados.gob.do"],
  "roster-diputados": ["diputadosrd.gob.do", "camaradediputados.gob.do"],
  senado: ["senadord.gob.do", "senado.gov.do"],
  "senado-sil": ["senadord.gob.do", "senado.gov.do"],
  "senado-publicaciones": ["senadord.gob.do", "senado.gov.do"],
  "sen-approved": ["senadord.gob.do", "senado.gov.do"],
  "sen-expired": ["senadord.gob.do", "senado.gov.do"],
  "sen-votes": ["senadord.gob.do", "senado.gov.do"],
  "sen-attendance": ["senadord.gob.do", "senado.gov.do"],
  "sen-reports": ["senadord.gob.do", "senado.gov.do"],
  "roster-senado": ["senadord.gob.do", "senado.gov.do"],
};

/**
 * Validate a scraped official link against the domains owned by the adapter that
 * supplied it. Unknown sources fail closed instead of turning arbitrary scraped URLs
 * into links labelled "oficial".
 */
export function safeOfficialUrl(
  value: string | null | undefined,
  source: string | null | undefined,
): string | null {
  const safe = safeHttpUrl(value);
  const domains = source ? SOURCE_OFFICIAL_DOMAINS[source] : undefined;
  if (!safe || !domains) return null;
  const hostname = new URL(safe).hostname;
  return domains.some((domain) => isHostOrSubdomain(hostname, domain)) ? safe : null;
}
