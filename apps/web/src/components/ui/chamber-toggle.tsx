"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated segmented control to switch between the two congressional chambers.
 * Adapted from a 21st.dev segmented-control pattern: a sliding pill indicator,
 * here driven by a CSS transform transition (no framer-motion dependency) and the
 * project's own color tokens so it reads correctly in both light and dark mode.
 */
export type Chamber = "diputados" | "senadores";

const LABELS: Record<Chamber, { es: string; en: string }> = {
  diputados: { es: "Diputados", en: "Deputies" },
  senadores: { es: "Senadores", en: "Senators" },
};

const OPTIONS: { value: Chamber; icon: React.ReactNode }[] = [
  { value: "diputados", icon: <IconUsers /> },
  { value: "senadores", icon: <IconColumns /> },
];

export function ChamberToggle({
  value,
  onChange,
  className = "",
  lang = "es",
}: {
  value: Chamber;
  onChange: (v: Chamber) => void;
  className?: string;
  lang?: "es" | "en";
}) {
  const refs = useRef<Record<Chamber, HTMLButtonElement | null>>({
    diputados: null,
    senadores: null,
  });
  const [pill, setPill] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = refs.current[value];
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);

  return (
    <div
      role="tablist"
      aria-label={lang === "es" ? "Cámara" : "Chamber"}
      className={`relative inline-flex items-center gap-1 rounded-full border p-1 ${className}`}
      style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
    >
      {/* Sliding pill — animates between the active tabs. */}
      <span
        aria-hidden
        className="absolute z-0 rounded-full transition-[left,width] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
        style={{
          left: pill.left,
          width: pill.width,
          top: 4,
          bottom: 4,
          background: "var(--accent)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        }}
      />
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[opt.value] = el;
            }}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className="relative z-10 flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-semibold transition-colors duration-200"
            style={{ color: active ? "#fff" : "var(--text-muted)" }}
          >
            <span className="h-4 w-4">{opt.icon}</span>
            <span>{LABELS[opt.value][lang]}</span>
          </button>
        );
      })}
    </div>
  );
}

function IconUsers() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconColumns() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M3 21h18" />
      <path d="M5 21V8l7-4 7 4v13" />
      <path d="M9 21V11" />
      <path d="M15 21V11" />
      <path d="M12 21V11" />
    </svg>
  );
}
