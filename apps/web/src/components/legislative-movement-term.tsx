"use client";

import React, { useId, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { officialStatusLabel } from "@/lib/legislative-labels";
import { legislativeMovementDefinition } from "@/lib/legislative-movement-glossary";

export function LegislativeMovementTerm({
  status,
  lang,
  className = "",
}: {
  status: string;
  lang: Lang;
  className?: string;
}) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const definition = legislativeMovementDefinition(status, lang);
  const label = officialStatusLabel(status, lang) ?? status;

  if (!definition) return null;

  return (
    <span
      className="relative inline-flex max-w-full align-baseline"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`inline-flex min-h-11 max-w-full items-center rounded-md text-left font-semibold leading-snug underline decoration-dotted decoration-current/45 underline-offset-4 transition-colors hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
        style={{ color: "var(--accent)", outlineColor: "var(--accent)" }}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.blur();
          }
        }}
      >
        {label}
      </button>

      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!open}
        className={`absolute left-0 top-full z-[80] mt-1.5 w-[min(19rem,calc(100vw-3rem))] rounded-xl border p-3.5 text-left shadow-xl transition duration-150 ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
        }`}
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 28%, var(--border))",
          background: "var(--surface)",
          color: "var(--text)",
        }}
      >
        <span
          className="block text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: "var(--accent)" }}
        >
          {lang === "es" ? "Qué significa" : "What it means"}
        </span>
        <span className="mt-1 block text-sm font-semibold leading-snug">{definition.label}</span>
        <span
          className="mt-1.5 block text-xs font-normal leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {definition.description}
        </span>
        <span className="mt-2.5 block border-t pt-2 text-[10px] font-normal leading-relaxed">
          <span className="font-semibold">
            {lang === "es" ? "Movimiento publicado por la fuente:" : "Source-published movement:"}
          </span>{" "}
          <span lang="es">{status}</span>
        </span>
      </span>
    </span>
  );
}
