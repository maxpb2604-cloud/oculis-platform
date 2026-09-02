/**
 * Strict classification of source-owned omissions versus execution failures.
 *
 * Only exact, reviewed messages are downgraded to coverage notes. Anything new or
 * structurally different remains an execution gap so parser/source drift cannot turn a
 * health indicator green by accident.
 */

export interface SourceGapAssessment {
  gaps: string[];
  coverageNotes: string[];
}

/** Some adapters join independently observed messages with this literal separator. */
export function splitSourceMessages(messages: readonly string[]): string[] {
  return messages.flatMap((message) =>
    message
      .split(" | ")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function isDiputadosDailyPdfCoverageNote(message: string): boolean {
  return (
    /^Diputados · agenda de comisiones \(\d{4}-\d{2}-\d{2}\): la fuente no publicó un PDF diario con esa fecha literal\.$/.test(
      message,
    ) ||
    /^Diputados · agenda de comisiones \(\d{4}-\d{2}-\d{2}\): \d+ PDFs comparten la fecha literal; no se eligió uno por inferencia\.$/.test(
      message,
    ) ||
    /^Diputados · agenda PDF diaria: \d+ de \d+ filas no tuvieron un PDF único y verificable por fecha; 0 fila\(s\) no tuvieron evidencia literal suficiente de la comisión y su agenda dentro del PDF\.$/.test(
      message,
    )
  );
}

function isSenateCommissionDateCoverageNote(message: string): boolean {
  return /^Senado · \d+ comisión\(es\) sin fecha exacta en ".+"; el campo date queda null\.$/.test(
    message,
  );
}

/**
 * Classify only the two audited agenda limitations. Network errors, unreadable files,
 * incomplete pagination, cardinality anomalies and unknown messages stay in `gaps`.
 */
export function classifyAgendaSourceGaps(
  source: string,
  reportedMessages: readonly string[],
): SourceGapAssessment {
  const gaps: string[] = [];
  const coverageNotes: string[] = [];
  for (const message of splitSourceMessages(reportedMessages)) {
    const isCoverageNote =
      (source === "sil-actividad" && isDiputadosDailyPdfCoverageNote(message)) ||
      (source === "senado" && isSenateCommissionDateCoverageNote(message));
    (isCoverageNote ? coverageNotes : gaps).push(message);
  }
  return { gaps, coverageNotes };
}
