"use client";

import { useEffect, useState } from "react";
import { type Lang } from "@/lib/i18n";
import { BillSearchOverlay, Kbd, SearchIcon, type BillOption } from "@/components/bill-search-overlay";
import { openInitiativeBubble } from "@/components/initiative-modal";

/**
 * Top-of-Iniciativas smart search — the SAME keyword engine + overlay as /feed
 * (Spanish FTS + synonyms + typo tolerance). Here picking a result opens that
 * bill's bubble directly (the page is a bill browser, so "find it and open it" is
 * the natural action). Also opens with "/" from anywhere on the page.
 */
export function InitiativeSearch({ lang }: { lang: Lang }) {
  const es = lang === "es";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const placeholder = es ? "Buscar iniciativa por palabra clave…" : "Search a bill by keyword…";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={es ? "Abrir buscador de iniciativas" : "Open bill search"}
        className="group mb-4 flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", cursor: "pointer" }}
      >
        <SearchIcon size={20} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="min-w-0 flex-1 truncate text-[15px] sm:text-base" style={{ color: "var(--text-muted)" }}>
          {placeholder}
        </span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd>/</Kbd>
        </span>
      </button>
      <BillSearchOverlay
        lang={lang}
        open={open}
        onClose={() => setOpen(false)}
        onPick={(opt: BillOption) => openInitiativeBubble({ id: opt.id })}
        showViewButton={false}
        actionVerb="open"
      />
    </>
  );
}
