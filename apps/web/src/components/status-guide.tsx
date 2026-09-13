"use client";

import React, { useId, useState } from "react";
import { Info, X } from "@phosphor-icons/react";
import { Modal } from "@/components/ui/modal";
import type { CatalogStatus } from "@/lib/initiative-status-catalog";
import type { Lang } from "@/lib/i18n";

export function StatusGuide({ statuses, lang }: { statuses: CatalogStatus[]; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const es = lang === "es";

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-xs font-semibold hover:underline focus-visible:outline-2"
        style={{ color: "var(--accent)" }}
      >
        <Info aria-hidden size={16} />
        {es ? "¿Qué significa cada estado?" : "What does each status mean?"}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={titleId}
        className="card elev flex max-h-[min(84vh,800px)] w-full max-w-2xl flex-col overflow-hidden"
        panelStyle={{ background: "var(--surface)", color: "var(--text)" }}
      >
        <div
          className="flex shrink-0 items-start justify-between gap-3 border-b p-5"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <h2 id={titleId} className="text-lg font-bold">
              {es ? "Guía de estados de iniciativas" : "Guide to initiative statuses"}
            </h2>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {es
                ? "Un estado describe un paso publicado por la cámara; no equivale por sí solo a la vigencia legislativa ni a una iniciativa en consulta pública. Se agrupan únicamente nombres equivalentes."
                : "A status describes a step published by the chamber; it does not by itself establish legislative validity or a public consultation. Only equivalent names are grouped."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={es ? "Cerrar guía" : "Close guide"}
            className="rounded-lg border p-2 hover:bg-[var(--surface-2)]"
          >
            <X aria-hidden size={18} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-2">
          {statuses.map((status) => (
            <div
              key={status.value}
              className="border-b py-3.5 last:border-b-0"
              style={{ borderColor: "var(--border)" }}
            >
              <h3 className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                {status.label}
              </h3>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {status.description}
              </p>
              {status.variants.length > 1 && (
                <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {es ? "Nombres publicados agrupados: " : "Grouped source labels: "}
                  {status.variants.join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
