import React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  FilePdf,
  Info,
} from "@/components/ui/icons";
import { NewTabNotice } from "@/components/ui/primitives";
import type { CongressMovement, CongressMovementChamber, CongressMovementDay } from "@/lib/data";
import { formatISODate } from "@/lib/format";
import { homeMovementHeadline, homeMovementSubject } from "@/lib/home-movement-headline";
import type { Lang } from "@/lib/i18n";
import { initiativeDetailHref } from "@/lib/initiative-links";
import { initiativeTitlePresentation } from "@/lib/initiative-title";
import { initiativeChamberLabel } from "@/lib/legislative-labels";
import styles from "./congress-movements.module.css";

interface CongressMovementsProps {
  day: CongressMovementDay;
  lang: Lang;
  today: string;
}

const copy = {
  es: {
    archive: "Archivo diario",
    dateLead: "Movimientos con fecha oficial y depósitos registrados por las fuentes del Congreso.",
    movements: "Movimientos registrados",
    initiatives: "Iniciativas afectadas",
    dateNavigation: "Navegar por fechas con movimientos registrados",
    previous: "Día anterior con movimientos",
    next: "Siguiente día con movimientos",
    noPrevious: "No hay una fecha anterior disponible",
    noNext: "No hay una fecha posterior disponible",
    chooseDate: "Elegir otra fecha",
    viewDate: "Ver fecha",
    today: "Hoy",
    chamberNavigation: "Seleccionar cámara legislativa",
    diputados: "Cámara de Diputados",
    senado: "Senado de la República",
    resultsEyebrow: "Movimientos del día",
    resultsTitle: "Movimientos de iniciativas",
    resultCount: (movements: number, initiatives: number) =>
      `${movements} ${movements === 1 ? "movimiento" : "movimientos"} en ${initiatives} ${initiatives === 1 ? "iniciativa" : "iniciativas"}`,
    emptyTitle: "No hay movimientos oficiales fechados registrados",
    emptyBody:
      "Oculis no tiene un movimiento con fecha oficial almacenado para esta cámara y este día. Esto no demuestra que la cámara no haya tenido actividad.",
    filedEvidence: "Fecha oficial de depósito",
    historyEvidence: "Historial oficial",
    pdfOpen: "Abrir PDF oficial",
    pdfUnavailable: "PDF no disponible",
    openPdf: (initiative: string) => `Abrir el PDF oficial de ${initiative} en una pestaña nueva`,
    translation: "Traducción de Oculis",
    translationPending: "Título oficial en español · traducción pendiente",
    statusTranslationPending: "Estado oficial en español · traducción del procedimiento pendiente",
    initiativeFiled: "Initiative filed",
    officialUpdate: "Official update",
  },
  en: {
    archive: "Daily archive",
    dateLead: "Source-dated movements and filings recorded from official congressional sources.",
    movements: "Recorded movements",
    initiatives: "Affected initiatives",
    dateNavigation: "Browse dates with recorded movements",
    previous: "Previous day with movements",
    next: "Next day with movements",
    noPrevious: "No earlier date is available",
    noNext: "No later date is available",
    chooseDate: "Choose another date",
    viewDate: "View date",
    today: "Today",
    chamberNavigation: "Select legislative chamber",
    diputados: "Chamber of Deputies",
    senado: "Senate of the Republic",
    resultsEyebrow: "Movements for the day",
    resultsTitle: "Initiative movements",
    resultCount: (movements: number, initiatives: number) =>
      `${movements} ${movements === 1 ? "movement" : "movements"} across ${initiatives} ${initiatives === 1 ? "initiative" : "initiatives"}`,
    emptyTitle: "No source-dated official movements are recorded",
    emptyBody:
      "Oculis has no stored source-dated movement for this chamber and day. This does not establish that the chamber had no activity.",
    filedEvidence: "Official filing date",
    historyEvidence: "Official history",
    pdfOpen: "Open official PDF",
    pdfUnavailable: "PDF unavailable",
    openPdf: (initiative: string) => `Open the official PDF for ${initiative} in a new tab`,
    translation: "Oculis translation",
    translationPending: "Official Spanish title · translation pending",
    statusTranslationPending: "Official Spanish status · procedure translation pending",
    initiativeFiled: "Initiative filed",
    officialUpdate: "Official update",
  },
} as const;

function capitalizeDate(value: string): string {
  return value ? `${value.slice(0, 1).toLocaleUpperCase()}${value.slice(1)}` : value;
}

export function congressMovementsHref({
  date,
  chamber,
  lang,
}: {
  date: string;
  chamber: CongressMovementChamber;
  lang: Lang;
}): string {
  const params = new URLSearchParams({ date, chamber });
  if (lang === "en") params.set("lang", "en");
  return `/feed?${params.toString()}`;
}

function DateLink({
  direction,
  date,
  chamber,
  lang,
}: {
  direction: "previous" | "next";
  date: string | null;
  chamber: CongressMovementChamber;
  lang: Lang;
}) {
  const labels = copy[lang];
  const isPrevious = direction === "previous";
  const label = isPrevious ? labels.previous : labels.next;
  const unavailable = isPrevious ? labels.noPrevious : labels.noNext;
  const Icon = isPrevious ? ArrowLeft : ArrowRight;

  if (!date) {
    return (
      <span className={styles.dateArrow} aria-label={unavailable} aria-disabled="true">
        <Icon size={18} aria-hidden="true" />
      </span>
    );
  }

  const humanDate = formatISODate(date, lang, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <Link
      href={congressMovementsHref({ date, chamber, lang })}
      className={styles.dateArrow}
      aria-label={`${label}: ${humanDate}`}
      title={`${label}: ${humanDate}`}
    >
      <Icon size={18} aria-hidden="true" />
    </Link>
  );
}

function ChamberNavigation({
  chamber,
  date,
  lang,
}: {
  chamber: CongressMovementChamber;
  date: string;
  lang: Lang;
}) {
  const labels = copy[lang];
  const chambers: Array<{ key: CongressMovementChamber; label: string }> = [
    { key: "DIPUTADOS", label: labels.diputados },
    { key: "SENADO", label: labels.senado },
  ];

  return (
    <nav className={styles.chamberRail} aria-label={labels.chamberNavigation}>
      {chambers.map((item) => (
        <Link
          key={item.key}
          href={congressMovementsHref({ date, chamber: item.key, lang })}
          className={styles.chamberButton}
          aria-current={item.key === chamber ? "page" : undefined}
          data-active={item.key === chamber ? "true" : "false"}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function congressMovementPdfHref(
  publication: CongressMovement["documentPublication"],
  initiativeId: number,
  lang: Lang,
): string | null {
  const documentId = publication.documentId;
  const canOpen =
    (publication.status === "PUBLISHED_VERIFIED" && publication.available === true) ||
    (publication.status === "REGISTERED_UNVERIFIED" && publication.available === false);
  if (
    !canOpen ||
    typeof documentId !== "number" ||
    !Number.isSafeInteger(documentId) ||
    documentId <= 0 ||
    !Number.isSafeInteger(initiativeId) ||
    initiativeId <= 0
  ) {
    return null;
  }

  const query = new URLSearchParams({
    documentId: String(documentId),
    initiativeId: String(initiativeId),
  });
  if (lang === "en") query.set("lang", "en");
  return `/api/document/open?${query.toString()}`;
}

function MovementDocumentAvailability({
  publication,
  initiativeId,
  initiativeLabel,
  lang,
}: {
  publication: CongressMovement["documentPublication"];
  initiativeId: number;
  initiativeLabel: string;
  lang: Lang;
}) {
  const labels = copy[lang];
  const href = congressMovementPdfHref(publication, initiativeId, lang);

  if (href) {
    return (
      <a
        href={href}
        className={`${styles.pdfAvailability} ${styles.pdfAvailable}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={labels.openPdf(initiativeLabel)}
        data-pdf-availability="available"
        data-pdf-control="true"
      >
        <FilePdf size={16} weight="fill" aria-hidden="true" />
        <span>{labels.pdfOpen}</span>
        <NewTabNotice lang={lang} />
      </a>
    );
  }

  return (
    <span
      className={`${styles.pdfAvailability} ${styles.pdfUnavailable}`}
      data-pdf-availability="unavailable"
    >
      <FilePdf size={15} aria-hidden="true" />
      <span>{labels.pdfUnavailable}</span>
    </span>
  );
}

function MovementRow({ movement, lang }: { movement: CongressMovement; lang: Lang }) {
  const labels = copy[lang];
  const title = initiativeTitlePresentation(
    { title: movement.title, titleEn: movement.titleEn },
    lang,
  );
  const headline = homeMovementHeadline({
    sourceTitle: movement.title,
    displayTitle: title.text,
    displayLanguage: title.contentLanguage,
    status: movement.status,
    sourceId:
      movement.kind === "FILED"
        ? `deposit:${movement.initiativeId}`
        : `status:${movement.sourceEventId ?? movement.initiativeId}`,
    lang,
  });
  const isPendingEnglishTitle = lang === "en" && title.contentLanguage === "es";
  const isPendingEnglishStatus =
    lang === "en" && movement.kind === "STATUS" && headline.headlineLanguage === "es";
  const needsEnglishFallback =
    isPendingEnglishTitle ||
    isPendingEnglishStatus ||
    (lang === "en" && movement.kind === "FILED" && headline.headlineLanguage === "es");
  const englishActionCandidate = needsEnglishFallback
    ? homeMovementHeadline({
        sourceTitle: movement.title,
        displayTitle: "Initiative",
        displayLanguage: "en",
        status: movement.status,
        sourceId:
          movement.kind === "FILED"
            ? `deposit:${movement.initiativeId}`
            : `status:${movement.sourceEventId ?? movement.initiativeId}`,
        lang: "en",
      })
    : null;
  const movementAction = needsEnglishFallback
    ? movement.kind === "FILED"
      ? labels.initiativeFiled
      : englishActionCandidate?.headlineLanguage === "en"
        ? englishActionCandidate.movement
        : labels.officialUpdate
    : headline.movement;
  const movementSubject = needsEnglishFallback
    ? homeMovementSubject(
        title.contentLanguage === "en" ? title.text : movement.title,
        title.contentLanguage,
      )
    : headline.subject;
  const chamber = initiativeChamberLabel(movement.chamber, lang) ?? movement.chamber;
  const evidence = movement.kind === "FILED" ? labels.filedEvidence : labels.historyEvidence;
  const initiativeLabel = movement.code ?? movementSubject;
  const initiativeHref = initiativeDetailHref(movement.initiativeId, lang);

  return (
    <li className={styles.movementItem}>
      <div className={styles.movementRow}>
        <Link href={initiativeHref} className={styles.movementPrimaryLink}>
          <div className={styles.movementCopy}>
            <h3 className={styles.movementHeadline}>
              <span
                className={styles.movementAction}
                lang={needsEnglishFallback ? "en" : headline.headlineLanguage}
              >
                {movementAction}:
              </span>{" "}
              <span lang={needsEnglishFallback ? title.contentLanguage : headline.headlineLanguage}>
                {movementSubject}
              </span>
            </h3>
            <div className={styles.movementMeta}>
              {movement.code ? <span className="tnum">{movement.code}</span> : null}
              <span>{chamber}</span>
              <span className={styles.evidence}>
                <CheckCircle size={14} weight="fill" aria-hidden="true" />
                {evidence}
              </span>
              {title.isOculisTranslation ? <span>{labels.translation}</span> : null}
              {isPendingEnglishTitle ? <span>{labels.translationPending}</span> : null}
              {isPendingEnglishStatus && movement.status ? (
                <span>
                  {labels.statusTranslationPending}: <span lang="es">{movement.status}</span>
                </span>
              ) : null}
            </div>
          </div>
          <span className={styles.rowArrow} aria-hidden="true">
            <ArrowRight size={19} aria-hidden="true" />
          </span>
        </Link>

        <div className={styles.movementActions}>
          <MovementDocumentAvailability
            publication={movement.documentPublication}
            initiativeId={movement.initiativeId}
            initiativeLabel={initiativeLabel}
            lang={lang}
          />
        </div>
      </div>
    </li>
  );
}

export function CongressMovements({ day, lang, today }: CongressMovementsProps) {
  const labels = copy[lang];
  const selectedDateLabel = capitalizeDate(
    formatISODate(day.selectedDate, lang, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  );

  return (
    <div className={styles.archive} data-testid="congress-movements">
      <header className={styles.archiveHeader}>
        <div className={styles.archiveIntro}>
          <p className="eyebrow">{labels.archive}</p>
          <h2>
            <time dateTime={day.selectedDate}>{selectedDateLabel}</time>
          </h2>
          <p>{labels.dateLead}</p>
        </div>

        <dl className={styles.summaryStats}>
          <div>
            <dt>{labels.movements}</dt>
            <dd className="tnum">{day.totalMovementCount}</dd>
          </div>
          <div>
            <dt>{labels.initiatives}</dt>
            <dd className="tnum">{day.uniqueInitiativeCount}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.controlDeck}>
        <nav className={styles.dateNavigation} aria-label={labels.dateNavigation}>
          <DateLink
            direction="previous"
            date={day.previousAvailableDate}
            chamber={day.chamber}
            lang={lang}
          />

          <form className={styles.dateForm} action="/feed" method="get">
            <label htmlFor="movement-date">
              <CalendarBlank size={17} aria-hidden="true" />
              {labels.chooseDate}
            </label>
            <input
              key={day.selectedDate}
              id="movement-date"
              name="date"
              type="date"
              defaultValue={day.selectedDate}
              max={today}
            />
            <input type="hidden" name="chamber" value={day.chamber} />
            {lang === "en" ? <input type="hidden" name="lang" value="en" /> : null}
            <button type="submit">{labels.viewDate}</button>
          </form>

          <DateLink
            direction="next"
            date={day.nextAvailableDate}
            chamber={day.chamber}
            lang={lang}
          />
        </nav>

        <div className={styles.quickDates}>
          <Link
            href={congressMovementsHref({ date: today, chamber: day.chamber, lang })}
            aria-current={day.selectedDate === today ? "date" : undefined}
          >
            {labels.today}
          </Link>
        </div>

        <ChamberNavigation chamber={day.chamber} date={day.selectedDate} lang={lang} />
      </div>

      <section className={styles.results} aria-labelledby="congress-movements-heading">
        <header className={styles.resultsHeader}>
          <div>
            <p className="eyebrow">{labels.resultsEyebrow}</p>
            <h2 id="congress-movements-heading">{labels.resultsTitle}</h2>
          </div>
          <span>{labels.resultCount(day.totalMovementCount, day.uniqueInitiativeCount)}</span>
        </header>

        {day.movements.length > 0 ? (
          <ol className={styles.movementList}>
            {day.movements.map((movement, index) => (
              <MovementRow
                key={`${movement.source}:${movement.kind}:${movement.sourceEventId ?? "no-event"}:${movement.initiativeId}:${movement.status ?? "no-status"}:${movement.eventDate}:${index}`}
                movement={movement}
                lang={lang}
              />
            ))}
          </ol>
        ) : (
          <div className={styles.emptyState} role="status">
            <Info size={24} aria-hidden="true" />
            <div>
              <h3>{labels.emptyTitle}</h3>
              <p>{labels.emptyBody}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
