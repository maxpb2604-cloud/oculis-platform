import type { Lang } from "./i18n";

export interface LocalizedInitiativeTitle {
  /** Exact title published by the official source. */
  title: string;
  /** Current Oculis English translation for this exact source title, when available. */
  titleEn?: string | null;
}

export interface InitiativeTitlePresentation {
  text: string;
  contentLanguage: Lang;
  isOculisTranslation: boolean;
  /** English was requested, but no current translation exists for the exact source title. */
  isTranslationPending: boolean;
  officialSpanishTitle: string;
}

/**
 * Select the customer-facing title without ever replacing the official source value.
 * A missing translation fails closed to the Spanish title and declares its language.
 */
export function initiativeTitlePresentation(
  initiative: LocalizedInitiativeTitle,
  lang: Lang,
): InitiativeTitlePresentation {
  const officialSpanishTitle = initiative.title.trim();
  const translatedTitle = initiative.titleEn?.trim() || null;

  if (lang === "en" && translatedTitle) {
    return {
      text: translatedTitle,
      contentLanguage: "en",
      isOculisTranslation: true,
      isTranslationPending: false,
      officialSpanishTitle,
    };
  }

  return {
    text: officialSpanishTitle,
    contentLanguage: "es",
    isOculisTranslation: false,
    isTranslationPending: lang === "en",
    officialSpanishTitle,
  };
}
