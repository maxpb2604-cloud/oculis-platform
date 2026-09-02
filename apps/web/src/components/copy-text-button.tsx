"use client";

import { Check, Copy, WarningCircle } from "@phosphor-icons/react";
import React, { useEffect, useRef, useState } from "react";

export function CopyTextButton({
  text,
  lang = "es",
  className = "",
  ariaLabel,
  idleLabel,
}: {
  text: string;
  lang?: "es" | "en";
  className?: string;
  ariaLabel?: string;
  /** Optional visible idle-state label; success and failure feedback stay localized. */
  idleLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function copy() {
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch {
          // Sandboxed/permission-denied Clipboard API: try the local selection path.
        }
      }
      if (!copied) {
        const previousFocus =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : buttonRef.current;
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        let commandCopied = false;
        try {
          commandCopied = document.execCommand("copy");
        } finally {
          textarea.remove();
          (previousFocus ?? buttonRef.current)?.focus();
        }
        if (!commandCopied) throw new Error("copy command was rejected");
      }
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setState("idle"), 2_000);
  }

  const label =
    state === "copied"
      ? lang === "es"
        ? "Copiado"
        : "Copied"
      : state === "failed"
        ? lang === "es"
          ? "No se pudo copiar"
          : "Could not copy"
        : (idleLabel ?? (lang === "es" ? "Copiar" : "Copy"));
  const Icon = state === "copied" ? Check : state === "failed" ? WarningCircle : Copy;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={copy}
        aria-label={ariaLabel ? `${label} ${ariaLabel}` : label}
        className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold underline-offset-2 transition-colors hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: "var(--accent)" }}
      >
        <Icon aria-hidden size={15} weight="bold" />
        {label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied"
          ? lang === "es"
            ? "Texto copiado al portapapeles."
            : "Text copied to the clipboard."
          : state === "failed"
            ? lang === "es"
              ? "No se pudo copiar el texto. Selecciónelo manualmente."
              : "The text could not be copied. Select it manually."
            : ""}
      </span>
    </span>
  );
}
