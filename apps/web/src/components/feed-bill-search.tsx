"use client";

import { useEffect, useRef, useState } from "react";
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
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search against the bills typeahead endpoint.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
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
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (code: string) => {
    setOpen(false);
    setQuery("");
    setOptions([]);
    onSelect(code);
  };

  return (
    <div className="card p-3">
      <div className="eyebrow mb-2">{es ? "Buscar proyecto (PDL)" : "Search bill (PDL)"}</div>
      <div ref={boxRef} className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => options.length > 0 && setOpen(true)}
          placeholder={es ? "Palabra clave del proyecto…" : "Bill keyword…"}
          className="w-full rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
        {open && (loading || options.length > 0 || query.trim().length >= 2) && (
          <ul
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg py-1 shadow-lg"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            {loading && options.length === 0 && (
              <li className="px-2.5 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                {es ? "Buscando…" : "Searching…"}
              </li>
            )}
            {!loading && options.length === 0 && (
              <li className="px-2.5 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                {es ? "Sin proyectos" : "No bills found"}
              </li>
            )}
            {options.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => pick(o.code)}
                  className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                  style={{ cursor: "pointer" }}
                >
                  <span className="line-clamp-2 text-[13px] font-medium" style={{ color: "var(--text)" }}>
                    {o.title}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {o.code}
                    {o.chamber ? ` · ${o.chamber === "SENADO" ? "Senado" : "Diputados"}` : ""}
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
