"use client";

import Link from "next/link";
import React, { useId, useState } from "react";
import { Briefcase, CheckCircle, Plus, X } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import type { Lang } from "@/lib/i18n";

export interface AssignmentClientChoice {
  id: number;
  name: string;
  slug: string;
}

export function AssignClientDialog({
  clients,
  kind,
  recordId,
  title,
  reference,
  lang,
}: {
  clients: AssignmentClientChoice[];
  kind: "LEGISLATIVE" | "REGULATORY";
  recordId: number;
  title: string;
  reference: string | null;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const descriptionId = useId();
  const es = lang === "es";

  async function submit(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          recordId,
          clientId: Number(formData.get("clientId")),
          impactOnBusiness: formData.get("impactOnBusiness"),
          executiveSupport: formData.get("executiveSupport"),
          keyStakeholderSupport: formData.get("keyStakeholderSupport"),
          publicOpinion: formData.get("publicOpinion"),
          internalNote: formData.get("internalNote"),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || (es ? "No se pudo guardar." : "Could not save."));
      setSaved(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSaved(false);
          setError(null);
        }}
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[var(--accent)] px-3 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
      >
        <Plus size={15} weight="bold" aria-hidden="true" />
        {es ? "Asignar al cliente" : "Assign to client"}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={headingId}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-lg)] border bg-[var(--surface)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[var(--accent)]">
              <Briefcase size={18} weight="fill" aria-hidden="true" />
              <span className="eyebrow">
                {es ? "Información interna de FHC" : "FHC internal information"}
              </span>
            </div>
            <h2 id={headingId} className="mt-2 text-xl font-semibold sm:text-2xl">
              {es ? "Asignar iniciativa a un cliente" : "Assign initiative to a client"}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--text-muted)]"
            >
              {reference ? `${reference} · ` : ""}
              {title}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ui-button min-h-10 min-w-10 shrink-0 px-2"
            aria-label={es ? "Cerrar" : "Close"}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {saved ? (
          <div className="px-5 py-10 text-center sm:px-7">
            <CheckCircle
              size={42}
              weight="fill"
              aria-hidden="true"
              className="mx-auto text-[var(--verified)]"
            />
            <h3 className="mt-4 text-xl font-semibold">
              {es ? "Iniciativa asignada" : "Initiative assigned"}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
              {es
                ? "La iniciativa ya forma parte de la cartera relevante del cliente. Puedes actualizar esta información repitiendo la asignación."
                : "The initiative is now part of the client's relevant portfolio. You can update this information by assigning it again."}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-6 min-h-11 rounded-lg bg-[var(--accent)] px-6 text-sm font-semibold text-white"
            >
              {es ? "Listo" : "Done"}
            </button>
          </div>
        ) : clients.length ? (
          <form
            action={submit}
            aria-describedby={descriptionId}
            className="px-5 py-5 sm:px-7 sm:py-6"
          >
            <AssignmentField
              label={es ? "Cliente" : "Client"}
              htmlFor={`client-${recordId}-${kind}`}
            >
              <select
                id={`client-${recordId}-${kind}`}
                name="clientId"
                required
                defaultValue=""
                className="ui-input w-full"
              >
                <option value="" disabled>
                  {es ? "Seleccionar cliente" : "Select client"}
                </option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </AssignmentField>

            <div className="my-6 border-t pt-5">
              <h3 className="text-lg font-semibold">
                {es ? "Información interna" : "Internal information"}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                {es
                  ? "Estas valoraciones pertenecen a FHC y al cliente seleccionado; no modifican ni sustituyen el estado oficial publicado."
                  : "These assessments belong to FHC and the selected client; they do not alter or replace the published official status."}
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <AssignmentField
                label={es ? "Impacto en el negocio" : "Impact on business"}
                htmlFor={`impact-${recordId}-${kind}`}
              >
                <select
                  id={`impact-${recordId}-${kind}`}
                  name="impactOnBusiness"
                  required
                  defaultValue=""
                  className="ui-input w-full"
                >
                  <option value="" disabled>
                    {es ? "Seleccionar impacto" : "Select impact"}
                  </option>
                  <option value="HIGH">{es ? "Alto" : "High"}</option>
                  <option value="MEDIUM">{es ? "Medio" : "Medium"}</option>
                  <option value="LOW">{es ? "Bajo" : "Low"}</option>
                  <option value="TO_ASSESS">{es ? "Por evaluar" : "To assess"}</option>
                </select>
              </AssignmentField>
              <AssignmentField
                label={es ? "Apoyo del Poder Ejecutivo" : "Support from the Executive Branch"}
                htmlFor={`executive-${recordId}-${kind}`}
              >
                <select
                  id={`executive-${recordId}-${kind}`}
                  name="executiveSupport"
                  required
                  defaultValue=""
                  className="ui-input w-full"
                >
                  <option value="" disabled>
                    {es ? "Seleccionar" : "Select"}
                  </option>
                  <option value="SUPPORTS">{es ? "A favor" : "Supports"}</option>
                  <option value="NEUTRAL">
                    {es ? "Neutral o no definido" : "Neutral or undecided"}
                  </option>
                  <option value="OPPOSES">{es ? "En contra" : "Opposes"}</option>
                  <option value="UNKNOWN">{es ? "Sin información" : "Unknown"}</option>
                </select>
              </AssignmentField>
              <AssignmentField
                label={es ? "Apoyo de actores clave" : "Support from key stakeholders"}
                htmlFor={`stakeholder-${recordId}-${kind}`}
              >
                <select
                  id={`stakeholder-${recordId}-${kind}`}
                  name="keyStakeholderSupport"
                  required
                  defaultValue=""
                  className="ui-input w-full"
                >
                  <option value="" disabled>
                    {es ? "Seleccionar" : "Select"}
                  </option>
                  <option value="SUPPORTS">{es ? "A favor" : "Supports"}</option>
                  <option value="MIXED">{es ? "Mixto o no definido" : "Mixed or undecided"}</option>
                  <option value="OPPOSES">{es ? "En contra" : "Opposes"}</option>
                  <option value="UNKNOWN">{es ? "Sin información" : "Unknown"}</option>
                </select>
              </AssignmentField>
              <AssignmentField
                label={es ? "Opinión pública" : "Public opinion"}
                htmlFor={`opinion-${recordId}-${kind}`}
              >
                <select
                  id={`opinion-${recordId}-${kind}`}
                  name="publicOpinion"
                  required
                  defaultValue=""
                  className="ui-input w-full"
                >
                  <option value="" disabled>
                    {es ? "Seleccionar" : "Select"}
                  </option>
                  <option value="FAVORABLE">{es ? "Favorable" : "Favorable"}</option>
                  <option value="MIXED">{es ? "Mixta o neutral" : "Mixed or neutral"}</option>
                  <option value="UNFAVORABLE">{es ? "Desfavorable" : "Unfavorable"}</option>
                  <option value="UNKNOWN">{es ? "Sin información" : "Unknown"}</option>
                </select>
              </AssignmentField>
            </div>

            <div className="mt-5">
              <AssignmentField
                label={es ? "Nota interna (opcional)" : "Internal note (optional)"}
                htmlFor={`note-${recordId}-${kind}`}
              >
                <textarea
                  id={`note-${recordId}-${kind}`}
                  name="internalNote"
                  maxLength={1500}
                  rows={3}
                  className="ui-input w-full resize-y"
                  placeholder={
                    es
                      ? "Contexto útil para el equipo y el cliente…"
                      : "Useful context for the team and client…"
                  }
                />
              </AssignmentField>
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
              >
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ui-button min-h-11 px-5 text-sm"
              >
                {es ? "Cancelar" : "Cancel"}
              </button>
              <button
                disabled={saving}
                className="min-h-11 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving
                  ? es
                    ? "Guardando…"
                    : "Saving…"
                  : es
                    ? "Asignar al cliente"
                    : "Assign to client"}
              </button>
            </div>
          </form>
        ) : (
          <div className="px-5 py-10 text-center sm:px-7">
            <Briefcase size={36} aria-hidden="true" className="mx-auto text-[var(--text-muted)]" />
            <h3 className="mt-4 text-lg font-semibold">
              {es ? "Primero agrega un cliente" : "Add a client first"}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
              {es
                ? "Las iniciativas solo pueden asignarse a un cliente registrado y activo."
                : "Initiatives can only be assigned to a registered, active client."}
            </p>
            <Link
              href={`/admin${lang === "en" ? "?lang=en" : ""}`}
              className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-white"
            >
              {es ? "Ir al panel administrativo" : "Open administrative panel"}
            </Link>
          </div>
        )}
      </Modal>
    </>
  );
}

function AssignmentField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
