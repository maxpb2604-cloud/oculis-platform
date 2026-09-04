"use client";

import React from "react";
import { Buildings, UsersThree } from "@/components/ui/icons";

export type Chamber = "diputados" | "senadores";

const LABELS: Record<Chamber, { es: string; en: string }> = {
  diputados: { es: "Diputados", en: "Deputies" },
  senadores: { es: "Senado", en: "Senate" },
};

const OPTIONS = [
  { value: "diputados" as const, Icon: UsersThree },
  { value: "senadores" as const, Icon: Buildings },
];

/** Accessible chamber selector with the same editorial treatment as the global shell. */
export function ChamberToggle({
  value,
  onChange,
  hrefFor,
  className = "",
  lang = "es",
}: {
  value: Chamber;
  onChange?: (value: Chamber) => void;
  hrefFor?: (value: Chamber) => string;
  className?: string;
  lang?: "es" | "en";
}) {
  return (
    <div
      role="group"
      aria-label={lang === "es" ? "Seleccionar cámara" : "Select chamber"}
      className={`inline-flex max-w-full items-center gap-1 rounded-[var(--radius-md)] border bg-[var(--surface-2)] p-1 ${className}`}
    >
      {OPTIONS.map(({ value: option, Icon }) => {
        const active = value === option;
        const content = (
          <>
            <Icon size={18} weight={active ? "fill" : "regular"} aria-hidden="true" />
            <span>{LABELS[option][lang]}</span>
          </>
        );
        const controlClass =
          "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-[calc(var(--radius-md)-3px)] px-3.5 py-2 text-sm font-semibold transition-colors sm:px-5";
        const controlStyle = {
          color: active ? "white" : "var(--text-muted)",
          background: active ? "var(--accent)" : "transparent",
          boxShadow: active ? "var(--shadow-xs)" : "none",
        };

        if (hrefFor) {
          return (
            <a
              key={option}
              href={hrefFor(option)}
              aria-current={active ? "page" : undefined}
              className={controlClass}
              style={controlStyle}
            >
              {content}
            </a>
          );
        }

        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(option)}
            className={controlClass}
            style={controlStyle}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
