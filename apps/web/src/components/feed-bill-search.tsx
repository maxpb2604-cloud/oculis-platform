"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { type Lang } from "@/lib/i18n";

interface BillOption {
  id: number;
  code: string;
  title: string;
  status: string | null;
  chamber: string | null;
}

/**
 * PDL (proyecto de ley) typeahead: type a keyword, pick a bill from the
 * suggestions, and the feed filters to everything related to it (news,
 * articles, official signals, social) via `initiativeCode`.
 */
export function FeedBillSearch({
  lang,
  onSelect,
}: {
  lang: Lang;
  onSelect: (code: string) => void;
}) {
  const es = lang === "es";
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<BillOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listId = useId();

  // Debounced search against the bills typeahead endpoint.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      setActiveIndex(-1);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/feed/bills?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        setOptions(data.items ?? []);
        setActiveIndex(-1);
        setOpen(true);
      } catch {
        /* aborted or network error — leave prior options */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (code: string) => {
    setOpen(false);
    setActiveIndex(-1);
    setQuery("");
    setOptions([]);
    onSelect(code);
  };

  return (
    <div className="rounded-lg border p-3">
      <label htmlFor={inputId} className="eyebrow mb-2 block">
        {es ? "Buscar iniciativa" : "Search initiative"}
      </label>
      <div ref={boxRef} className="relative">
        <MagnifyingGlass
          size={16}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
          aria-hidden
        />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && activeIndex >= 0 && options[activeIndex]
              ? `${listId}-option-${options[activeIndex].id}`
              : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => options.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && options.length > 0) {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, options.length - 1));
            } else if (e.key === "ArrowUp" && options.length > 0) {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
            } else if (e.key === "Enter" && open && activeIndex >= 0 && options[activeIndex]) {
              e.preventDefault();
              pick(options[activeIndex].code);
            } else if (e.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
          placeholder={es ? "Código o palabra clave…" : "Code or keyword…"}
          className="min-h-10 w-full rounded-lg py-1.5 pl-8 pr-2.5 text-[13px] outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
        {open && (loading || options.length > 0 || query.trim().length >= 2) && (
          <ul
            id={listId}
            role="listbox"
            aria-label={es ? "Proyectos encontrados" : "Bill search results"}
            aria-busy={loading}
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg py-1 shadow-lg"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            {loading && options.length === 0 && (
              <li
                role="presentation"
                className="px-2.5 py-2 text-[12px]"
                style={{ color: "var(--text-muted)" }}
              >
                {es ? "Buscando…" : "Searching…"}
              </li>
            )}
            {!loading && options.length === 0 && (
              <li
                role="presentation"
                className="px-2.5 py-2 text-[12px]"
                style={{ color: "var(--text-muted)" }}
              >
                {es ? "Sin iniciativas" : "No initiatives found"}
              </li>
            )}
            {options.map((o, index) => (
              <li key={o.id} role="presentation">
                <button
                  type="button"
                  id={`${listId}-option-${o.id}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(o.code)}
                  className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                  style={{
                    cursor: "pointer",
                    background: activeIndex === index ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <span
                    className="line-clamp-2 text-[13px] font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    {o.title.trim() || (es ? "Título: No informado" : "Title: Not reported")}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {o.code}
                    {o.chamber
                      ? ` · ${
                          o.chamber === "SENADO"
                            ? "Senado"
                            : o.chamber === "DIPUTADOS"
                              ? "Diputados"
                              : o.chamber
                        }`
                      : ""}
                    {o.status ? ` · ${o.status}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
