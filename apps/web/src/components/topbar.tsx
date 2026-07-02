"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

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
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const el = document.documentElement;
    const next = !el.classList.contains("dark");
    el.classList.toggle("dark", next);
    localStorage.setItem("fhc-theme", next ? "dark" : "light");
    setDark(next);
  }

  const other = lang === "es" ? "en" : "es";
  // Language switch keeps every other query param (filters, pagination) intact;
  // Spanish is the default so its link carries no `lang` param at all.
  const switchParams = new URLSearchParams(searchParams.toString());
  if (other === "en") switchParams.set("lang", "en");
  else switchParams.delete("lang");
  const switchQuery = switchParams.toString();
  const switchHref = switchQuery ? `${pathname}?${switchQuery}` : pathname;

  return (
    <div
      className="sticky top-0 z-20 flex items-end justify-between gap-4 border-b py-4 pl-16 pr-6 backdrop-blur lg:pl-6"
      style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}
    >
      <div>
        <div className="eyebrow">{dateLabel}</div>
        <h1 className="serif mt-1 text-[26px] font-semibold leading-none">{title}</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <div
          className="flex overflow-hidden rounded-lg border text-xs font-medium"
          role="group"
          aria-label={lang === "es" ? "Idioma" : "Language"}
        >
          <span
            className="px-2.5 py-1.5"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            {lang.toUpperCase()}
          </span>
          <a
            href={switchHref}
            className="px-2.5 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
            style={{ cursor: "pointer", color: "var(--text-muted)" }}
          >
            {other.toUpperCase()}
          </a>
        </div>
        <button
          onClick={toggleTheme}
          aria-label={lang === "es" ? "Cambiar tema" : "Toggle theme"}
          className="flex h-[30px] w-[34px] items-center justify-center rounded-lg border text-sm transition-colors hover:bg-[var(--surface-2)]"
          style={{ cursor: "pointer" }}
        >
          {dark ? "☀" : "☾"}
        </button>
      </div>
    </div>
  );
}
