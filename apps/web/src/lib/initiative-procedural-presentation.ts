import { formatISODate } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { initiativeChamberLabel, officialStatusLabel } from "@/lib/legislative-labels";
import type {
  ResolvedCurrentLocation,
  ResolvedInitiativeExpiration,
} from "@/lib/initiative-procedural-facts";

export interface ProceduralFactPresentation {
  value: string;
  basis: string;
  detail: string;
  dateTime: string | null;
  tone: "official" | "observed" | "derived" | "pending";
}

function shortDate(iso: string, lang: Lang): string {
  return formatISODate(iso, lang, { day: "numeric", month: "short", year: "numeric" });
}

export function currentLocationPresentation(
  fact: ResolvedCurrentLocation,
  lang: Lang,
): ProceduralFactPresentation {
  const es = lang === "es";
  if (fact.state === "CHAMBER") {
    const value = initiativeChamberLabel(fact.chamber, lang) ?? fact.chamber;
    if (fact.reason === "SOURCE_PUBLISHED_CURRENT_CHAMBER") {
      return {
        value,
        basis: es ? "Dato publicado" : "Source-published",
        detail: es
          ? "La ficha oficial identifica esta como la cámara actual."
          : "The official record identifies this as the current chamber.",
        dateTime: null,
        tone: "official",
      };
    }
    if (fact.reason === "LATEST_OFFICIAL_CHAMBER_MOVEMENT") {
      const movement = officialStatusLabel(fact.evidenceStatus, lang) ?? fact.evidenceStatus;
      const date = fact.evidenceDate ? shortDate(fact.evidenceDate, lang) : null;
      return {
        value,
        basis: es ? "Última cámara oficial observada" : "Latest official chamber observed",
        detail: [es ? "Movimiento oficial" : "Official movement", movement, date]
          .filter(Boolean)
          .join(" · "),
        dateTime: null,
        tone: "observed",
      };
    }
    if (fact.reason === "SOURCE_CORPUS") {
      return {
        value,
        basis: es ? "Cámara del expediente oficial" : "Official record chamber",
        detail: es
          ? "La fuente no publica un campo separado de cámara actual; Oculis muestra la cámara del expediente oficial."
          : "The source does not publish a separate current-chamber field; Oculis shows the chamber of the official record.",
        dateTime: null,
        tone: "observed",
      };
    }
    return {
      value,
      basis: es ? "Cámara observada" : "Observed chamber",
      detail: es
        ? "La evidencia oficial observada identifica esta cámara, pero no publica un campo separado de cámara actual."
        : "The observed official evidence identifies this chamber but does not publish a separate current-chamber field.",
      dateTime: null,
      tone: "pending",
    };
  }
  if (fact.state === "OTHER_BODY") {
    return {
      value: fact.body,
      basis: es ? "Dato publicado" : "Source-published",
      detail: es
        ? "La fuente identifica este órgano como la ubicación procesal actual."
        : "The source identifies this body as the current procedural location.",
      dateTime: null,
      tone: "official",
    };
  }
  if (fact.state === "IN_TRANSIT") {
    return {
      value: es ? "Despachada / en tránsito" : "Dispatched / in transit",
      basis: es ? "Último movimiento oficial" : "Latest official movement",
      detail: es
        ? "La fuente no publica todavía la cámara receptora; Oculis no presume el destino."
        : "The source has not yet published the receiving chamber; Oculis does not assume a destination.",
      dateTime: null,
      tone: "pending",
    };
  }
  if (fact.state === "PROCEDURE_CONCLUDED") {
    const status = officialStatusLabel(fact.status, lang) ?? fact.status;
    return {
      value: es ? "Trámite concluido" : "Proceeding concluded",
      basis: es ? "Estado publicado" : "Published status",
      detail: `${es ? "Estado oficial" : "Official status"}: ${status}.`,
      dateTime: null,
      tone: "official",
    };
  }
  if (fact.reason === "ORIGIN_ONLY_NOT_CURRENT_EVIDENCE") {
    return {
      value: es ? "Ubicación procesal por confirmar" : "Procedural location pending confirmation",
      basis: es ? "Solo cámara de origen publicada" : "Only origin chamber published",
      detail: es
        ? "La cámara de origen no demuestra la ubicación actual; Oculis no presume que la iniciativa permanezca allí."
        : "The origin chamber does not establish the current location; Oculis does not assume the initiative remains there.",
      dateTime: null,
      tone: "pending",
    };
  }
  return {
    value: es ? "Ubicación procesal por confirmar" : "Procedural location pending confirmation",
    basis: es ? "No determinable" : "Not determinable",
    detail: es
      ? "La evidencia disponible no permite identificar una cámara actual con seguridad."
      : "The available evidence does not reliably identify a current chamber.",
    dateTime: null,
    tone: "pending",
  };
}

export function expirationPresentation(
  fact: ResolvedInitiativeExpiration,
  lang: Lang,
): ProceduralFactPresentation {
  const es = lang === "es";
  if (fact.state === "SOURCE_PUBLISHED") {
    return {
      value: shortDate(fact.date, lang),
      basis: es ? "Fecha publicada" : "Source-published date",
      detail: es
        ? "La fecha de vencimiento consta en la evidencia oficial."
        : "The expiry date appears in the official evidence.",
      dateTime: fact.date,
      tone: "official",
    };
  }
  if (fact.state === "PROJECTED") {
    return {
      value: `${es ? "Al cierre del" : "At the close of"} ${shortDate(fact.date, lang)}`,
      basis: es ? "Cálculo de Oculis" : "Oculis calculation",
      detail: es
        ? `Dos legislaturas ordinarias desde ${fact.startLegislature}; arts. 89, 100 y 104 de la Constitución. El depósito no inicia el cómputo.`
        : `Two ordinary legislatures from ${fact.startLegislature}; Constitution arts. 89, 100, and 104. Filing does not start the count.`,
      dateTime: fact.date,
      tone: "derived",
    };
  }
  if (fact.state === "COUNT_NOT_STARTED") {
    return {
      value: es ? "Cómputo aún no iniciado" : "Legislature count not started",
      basis: es ? "Dato publicado" : "Source-published",
      detail: es
        ? "La fuente publica «NO» en iniciado. El plazo comienza con la toma en consideración, no con el depósito."
        : "The source reports that the count has not started. The period begins upon consideration, not filing.",
      dateTime: null,
      tone: "official",
    };
  }
  if (fact.state === "RULE_NOT_APPLICABLE") {
    return {
      value: es
        ? "No aplica la regla de dos legislaturas"
        : "The two-legislature rule does not apply",
      basis: es ? "Tipo fuera de alcance" : "Type outside this rule",
      detail: es
        ? "La norma general verificada aplica a proyectos de ley; Oculis no la extiende a otros tipos de iniciativa."
        : "The verified general rule applies to bills; Oculis does not extend it to other initiative types.",
      dateTime: null,
      tone: "derived",
    };
  }
  if (fact.state === "PROCEDURE_CONCLUDED") {
    const status = officialStatusLabel(fact.status, lang) ?? fact.status;
    return {
      value: es ? "No hay vencimiento pendiente" : "No pending expiry",
      basis: es ? "Trámite concluido" : "Proceeding concluded",
      detail: `${es ? "Estado oficial" : "Official status"}: ${status}.`,
      dateTime: null,
      tone: "official",
    };
  }
  if (fact.state === "EXPIRED_DATE_UNPUBLISHED") {
    return {
      value: es ? "Perimida — fecha no publicada" : "Expired — date not published",
      basis: es ? "Estado publicado" : "Published status",
      detail: es
        ? "La fuente publica la perención, pero no una fecha exacta."
        : "The source publishes the expiration status but not an exact date.",
      dateTime: null,
      tone: "official",
    };
  }

  type ReviewReason = Extract<ResolvedInitiativeExpiration, { state: "REVIEW_REQUIRED" }>["reason"];
  const copy: Record<ReviewReason, [string, string]> = {
    TYPE_NOT_PUBLISHED_OR_RECOGNIZED: [
      es ? "Aplicación de la norma por confirmar" : "Rule applicability pending confirmation",
      es
        ? "La fuente no publica un tipo reconocible que permita determinar si aplica la regla de dos legislaturas."
        : "The source does not publish a recognized type that establishes whether the two-legislature rule applies.",
    ],
    COUNT_START_NOT_PUBLISHED: [
      es ? "Fecha normativa por confirmar" : "Normative date pending confirmation",
      es
        ? "La fuente aún no publica cuándo comenzó la primera legislatura computable."
        : "The source does not yet publish when the first countable legislature began.",
    ],
    INVALID_OR_EXTRAORDINARY_LEGISLATURE: [
      es ? "Cómputo ordinario por confirmar" : "Ordinary-legislature count pending",
      es
        ? "La legislatura publicada no permite aplicar con seguridad el cómputo ordinario."
        : "The published legislature does not safely support the ordinary-legislature calculation.",
    ],
    CONFLICTING_START_EVIDENCE: [
      es ? "Evidencia en revisión" : "Evidence under review",
      es
        ? "La fecha y la legislatura inicial publicadas no coinciden."
        : "The published start date and initial legislature do not agree.",
    ],
    BICAMERAL_START_NOT_LINKED: [
      es ? "Vínculo entre cámaras por confirmar" : "Cross-chamber link pending confirmation",
      es
        ? "Oculis no reinicia el plazo al cambiar de cámara sin un vínculo oficial entre expedientes."
        : "Oculis does not restart the period after a chamber transfer without an official record link.",
    ],
    LEGAL_EXCEPTION_REVIEW: [
      es ? "Revisión normativa requerida" : "Legal review required",
      es
        ? "El período coincide con una excepción normativa y no se calcula automáticamente."
        : "The period overlaps a legal exception and is not calculated automatically.",
    ],
  };
  const [value, detail] = copy[fact.reason];
  return {
    value,
    basis: es ? "No determinable" : "Not determinable",
    detail,
    dateTime: null,
    tone: "pending",
  };
}
