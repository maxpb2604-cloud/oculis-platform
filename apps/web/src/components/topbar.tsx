"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MobileNavigation } from "@/components/sidebar";
import {
  ArrowRight,
  CalendarBlank,
  MagnifyingGlass,
  Moon,
  SidebarSimple,
  Sun,
} from "@/components/ui/icons";
import { languageSwitchHref, type Lang } from "@/lib/i18n";

/** Persistent command bar: navigation, search, date, language, and appearance. */
export function TopBar({
  lang,
  dateLabel,
  desktopSidebarOpen,
  onDesktopSidebarToggle,
}: {
  lang: Lang;
  dateLabel: string;
  desktopSidebarOpen: boolean;
  onDesktopSidebarToggle: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const el = document.documentElement;
    const next = !el.classList.contains("dark");
    el.classList.toggle("dark", next);
    localStorage.setItem("fhc-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-4 py-3 backdrop-blur-xl sm:px-7 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1320px] items-center gap-2.5">
        <span className="hidden lg:inline-flex">
          <button
            type="button"
            aria-controls="desktop-navigation"
            aria-expanded={desktopSidebarOpen}
            aria-label={
              lang === "es"
                ? desktopSidebarOpen
                  ? "Ocultar navegación principal"
                  : "Mostrar navegación principal"
                : desktopSidebarOpen
                  ? "Hide main navigation"
                  : "Show main navigation"
            }
            title={
              lang === "es"
                ? desktopSidebarOpen
                  ? "Ocultar barra lateral"
                  : "Mostrar barra lateral"
                : desktopSidebarOpen
                  ? "Hide sidebar"
                  : "Show sidebar"
            }
            onClick={onDesktopSidebarToggle}
            className="ui-button min-h-10 min-w-10 px-2.5"
          >
            <SidebarSimple size={19} aria-hidden="true" />
          </button>
        </span>
        <MobileNavigation lang={lang} />
        <form
          action="/initiatives"
          method="get"
          className="relative min-w-0 flex-1 sm:max-w-[520px]"
        >
          {lang === "en" && <input type="hidden" name="lang" value="en" />}
          <label htmlFor="shell-search" className="sr-only">
            {lang === "es" ? "Buscar iniciativas" : "Search initiatives"}
          </label>
          <MagnifyingGlass
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            id="shell-search"
            name="search"
            type="search"
            maxLength={160}
            placeholder={
              lang === "es"
                ? "Buscar iniciativas por código o título"
                : "Search initiatives by code or title"
            }
            className="ui-input w-full !pl-10 !pr-11 sm:!pr-16"
          />
          <button
            type="submit"
            aria-label={lang === "es" ? "Buscar iniciativas" : "Search initiatives"}
            className="absolute right-1 top-1/2 inline-flex min-h-9 min-w-9 -translate-y-1/2 items-center justify-center rounded-md px-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)] sm:right-1.5 sm:min-w-0"
          >
            <span className="hidden sm:inline">{lang === "es" ? "Buscar" : "Search"}</span>
            <ArrowRight size={17} aria-hidden="true" className="sm:hidden" />
          </button>
        </form>

        <div className="ml-auto hidden items-center gap-2 text-xs text-[var(--text-muted)] xl:flex">
          <CalendarBlank size={18} aria-hidden="true" />
          <span className="tnum whitespace-nowrap">{dateLabel}</span>
        </div>

        <div
          className="flex min-h-10 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] text-xs font-semibold"
          role="group"
          aria-label={lang === "es" ? "Idioma" : "Language"}
        >
          {(["es", "en"] as const).map((option) =>
            option === lang ? (
              <span
                key={option}
                className={`inline-flex min-w-9 items-center justify-center bg-[var(--accent-soft)] px-2 text-[var(--accent)] ${
                  option === "en" ? "border-l border-[var(--border)]" : ""
                }`}
                aria-label={
                  option === "es" ? "Idioma actual: español" : "Current language: English"
                }
              >
                {option.toUpperCase()}
              </span>
            ) : (
              <a
                key={option}
                href={languageSwitchHref(pathname, searchParams, option)}
                hrefLang={option}
                lang={option}
                aria-label={
                  lang === "es"
                    ? option === "en"
                      ? "Cambiar a inglés"
                      : "Cambiar a español"
                    : option === "es"
                      ? "Switch to Spanish"
                      : "Switch to English"
                }
                className={`inline-flex min-w-9 items-center justify-center px-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] ${
                  option === "en" ? "border-l border-[var(--border)]" : ""
                }`}
              >
                {option.toUpperCase()}
              </a>
            ),
          )}
        </div>
        <button
          onClick={toggleTheme}
          type="button"
          aria-label={lang === "es" ? "Cambiar tema visual" : "Change color theme"}
          aria-pressed={dark}
          className="ui-button min-h-10 min-w-10 px-2.5"
          title={lang === "es" ? "Cambiar tema" : "Change theme"}
        >
          {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
