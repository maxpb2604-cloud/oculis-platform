import type { Lang } from "@/lib/i18n";
import { safeOfficialUrl } from "@/lib/input";

export function activityDetailHref(id: number, lang: Lang): string {
  return `/agenda/${id}${lang === "en" ? "?lang=en" : ""}`;
}

/** The SIL activity feed sometimes exposes only the exact commission record, not a PDF agenda. */
export function isOfficialCommissionRecordUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return /^\/sil\/comision\/\d+\/?$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

/** Semantic validation for the external evidence behind an activity row. Domain-only
 * validation is insufficient: both `/sil/comision/{id}` and Senate's old
 * `/wpfd_file/{slug}` URLs are official domains but are not exact agenda destinations. */
export function safeOfficialActivityUrl(
  value: string | null | undefined,
  source: string | null | undefined,
  _sourceEventId?: string | null,
): string | null {
  const safe = safeOfficialUrl(value, source);
  if (!safe || isOfficialCommissionRecordUrl(safe)) return null;
  const url = new URL(safe);

  if (source === "sil-actividad") {
    // `sourceEventId` identifies the SIL calendar row, but its JSON API is technical
    // provenance rather than a human-readable agenda. The public action must point to
    // the exact WPFD daily-agenda file selected by category + file id. Some official
    // daily rows do not expose a calendar id, so the verified WPFD identity stands on
    // its own instead of hiding a valid agenda.
    if (
      url.protocol !== "https:" ||
      url.hostname !== "camaradediputados.gob.do" ||
      url.port !== "" ||
      url.hash !== "" ||
      url.pathname !== "/wp-admin/admin-ajax.php"
    ) {
      return null;
    }
    const allowedParams = new Set([
      "juwpfisadmin",
      "action",
      "task",
      "wpfd_category_id",
      "wpfd_file_id",
      "token",
      "preview",
    ]);
    if ([...url.searchParams.keys()].some((key) => !allowedParams.has(key))) return null;
    if ([...allowedParams].some((key) => url.searchParams.getAll(key).length > 1)) return null;
    const categoryId = url.searchParams.get("wpfd_category_id");
    const fileId = url.searchParams.get("wpfd_file_id");
    return url.searchParams.get("juwpfisadmin") === "false" &&
      url.searchParams.get("action") === "wpfd" &&
      url.searchParams.get("task") === "file.download" &&
      url.searchParams.get("preview") === "1" &&
      Boolean(categoryId && /^\d+$/.test(categoryId)) &&
      Boolean(fileId && /^\d+$/.test(fileId))
      ? safe
      : null;
  }

  if (source === "senado") {
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.senadord.gob.do" ||
      url.port !== "" ||
      url.hash !== "" ||
      url.pathname !== "/wp-admin/admin-ajax.php"
    ) {
      return null;
    }
    const allowedParams = new Set([
      "juwpfisadmin",
      "action",
      "task",
      "wpfd_category_id",
      "wpfd_file_id",
      "token",
      "preview",
    ]);
    if ([...url.searchParams.keys()].some((key) => !allowedParams.has(key))) return null;
    if ([...allowedParams].some((key) => url.searchParams.getAll(key).length > 1)) return null;
    const categoryId = url.searchParams.get("wpfd_category_id");
    const fileId = url.searchParams.get("wpfd_file_id");
    return url.searchParams.get("juwpfisadmin") === "false" &&
      url.searchParams.get("action") === "wpfd" &&
      url.searchParams.get("task") === "file.download" &&
      url.searchParams.get("preview") === "1" &&
      Boolean(categoryId && /^\d+$/.test(categoryId)) &&
      Boolean(fileId && /^\d+$/.test(fileId))
      ? safe
      : null;
  }

  return safe;
}

const VERIFIED_AGENDA_SOURCES = new Set([
  "sil-actividad",
  "dip-oficial",
  "dip-known-agenda",
  "senado",
]);

export function activityDestinationLabel(
  value: string,
  lang: Lang,
  source?: string | null,
): string {
  if (isOfficialCommissionRecordUrl(value)) {
    return lang === "es" ? "Abrir comisión oficial" : "Open official committee";
  }
  if (source && VERIFIED_AGENDA_SOURCES.has(source)) {
    if (source === "sil-actividad") {
      return lang === "es" ? "Abrir agenda oficial del día" : "Open the official daily agenda";
    }
    return lang === "es" ? "Ver agenda oficial" : "View official agenda";
  }
  return lang === "es" ? "Abrir documento oficial" : "Open official document";
}
