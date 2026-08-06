"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MobileNavigation } from "@/components/sidebar";

/** Top bar — page title (serif), generated date, language + theme controls. */
export function TopBar({
  lang,
  title,
  subtitle,
  dateLabel,
}: {
  lang: "es" | "en";
  title: string;
  subtitle: string;
  dateLabel: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.lang = lang;
    setDark(document.documentElement.classList.contains("dark"));
  }, [lang]);

  function toggleTheme() {
    const el = document.documentElement;
    const next = !el.classList.contains("dark");
    el.classList.toggle("dark", next);
    localStorage.setItem("fhc-theme", next ? "dark" : "light");
    setDark(next);
  }

  const other = lang === "es" ? "en" : "es";
  const otherParams = new URLSearchParams(searchParams.toString());
  if (other === "en") otherParams.set("lang", "en");
  else otherParams.delete("lang");
  const otherQuery = otherParams.toString();
  const otherHref = `${pathname}${otherQuery ? `?${otherQuery}` : ""}`;

  return (
    <header
      className="sticky top-0 z-20 flex flex-col gap-3 border-b px-4 py-3 backdrop-blur sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-4"
      style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}
    >
      <div className="min-w-0">
        <div className="eyebrow">{dateLabel}</div>
        <h1 className="serif mt-1 text-[24px] font-semibold leading-tight sm:text-[26px]">{title}</h1>
        <p className="mt-1 text-[13px] leading-snug sm:mt-1.5 sm:text-sm" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </p>
      </div>
      <div className="flex w-full items-center gap-1.5 sm:w-auto sm:justify-end">
        <MobileNavigation lang={lang} />
        <div
          className="ml-auto flex min-h-9 overflow-hidden rounded-lg border text-xs font-medium sm:ml-0"
          role="group"
          aria-label={lang === "es" ? "Idioma" : "Language"}
        >
          <span
            className="flex items-center px-2.5 py-1.5"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            {lang.toUpperCase()}
          </span>
          <a
            href={otherHref}
            hrefLang={other}
            lang={other}
            aria-label={other === "en" ? "Switch to English" : "Cambiar a español"}
            className="flex items-center px-2.5 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            {other.toUpperCase()}
          </a>
        </div>
        <button
          onClick={toggleTheme}
          type="button"
          aria-label={lang === "es" ? "Cambiar tema visual" : "Change color theme"}
          aria-pressed={dark}
          className="flex min-h-9 items-center justify-center rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
        >
          {lang === "es" ? "Tema" : "Theme"}
        </button>
      </div>
    </header>
  );
}
