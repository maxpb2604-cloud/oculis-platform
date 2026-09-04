function normalizeAgendaText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
}

/**
 * Returns only actual agenda copy. Some upstream records use the committee or
 * session name as a description fallback; repeating that label as a topic would
 * incorrectly imply that the source published more detail than it did.
 */
export function publishedAgendaTopic(description: string, body: string | null): string | null {
  const topic = description.trim();
  if (!topic || normalizeAgendaText(topic) === normalizeAgendaText(body)) return null;
  return topic;
}

/**
 * Senate weekly agendas can cite bare expediente numbers without publishing a
 * complete initiative code. Keep those literal references visible, but do not
 * turn them into initiative links unless the exact-code relation is available.
 */
export function officialExpedienteReferences(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = (raw as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return [];
  const expedientes = (payload as { expedientes?: unknown }).expedientes;
  if (!Array.isArray(expedientes)) return [];
  return [
    ...new Set(
      expedientes
        .filter((value): value is string | number => ["string", "number"].includes(typeof value))
        .map((value) => String(value).trim())
        .filter((value) => /^\d{1,12}$/.test(value)),
    ),
  ];
}
