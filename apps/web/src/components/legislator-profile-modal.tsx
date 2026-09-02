"use client";

import React, { useId, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { NewTabNotice } from "@/components/ui/primitives";
import { ArrowRight, ArrowSquareOut, X } from "@/components/ui/icons";
import type { LegislatorProfile } from "@/lib/data";
import { safeHttpUrl, safeOfficialUrl } from "@/lib/input";
import type { Lang } from "@/lib/i18n";
import { legislatorFiledInitiativesHref } from "@/lib/initiative-links";
import { partyDisplayLabel } from "@/lib/party-presentation";
import {
  circumscriptionLabel,
  committeeRoleLabel,
  legislatorRoleLabel,
  representationLevelLabel,
} from "@/lib/legislative-labels";

const CARGO_COLOR: Record<string, string> = {
  Presidente: "var(--verified)",
  Vicepresidente: "var(--accent)",
  Secretario: "var(--accent)",
};

const CARGO_SOFT: Record<string, string> = {
  Presidente: "var(--verified-soft)",
  Vicepresidente: "var(--accent-soft)",
  Secretario: "var(--accent-soft)",
};

function chamberName(chamber: string, es: boolean): string {
  if (chamber === "SENADO") return es ? "Senado de la República" : "Senate of the Republic";
  if (chamber === "DIPUTADOS") {
    return es ? "Cámara de Diputados" : "Chamber of Deputies";
  }
  return chamber || (es ? "No informado por la fuente" : "Not reported by the source");
}

export function LegislatorProfileModal({
  profile: l,
  lang: requestedLang,
  es,
  onClose,
}: {
  profile: LegislatorProfile;
  lang?: Lang;
  /** Backward-compatible while existing HOME/Congress consumers move to the provider. */
  es?: boolean;
  onClose: () => void;
}) {
  const lang: Lang = requestedLang ?? (es === false ? "en" : "es");
  const isSpanish = lang === "es";
  const titleId = `legislator-profile-${useId().replace(/:/g, "")}`;
  const memberType = legislatorRoleLabel(l.role, l.chamber, lang);
  const party = partyDisplayLabel(l.partyShort, l.party, lang);
  const bioParts = [
    `${memberType}${l.province ? ` ${isSpanish ? "por" : "for"} ${l.province}` : ""}`,
    circumscriptionLabel(l.circumscription, lang),
    party,
    l.period ? `${isSpanish ? "período" : "term"} ${l.period}` : null,
  ].filter(Boolean);
  const presidencies = l.committees.filter((committee) => committee.cargo === "Presidente");
  const initials = l.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const officialUrl = safeOfficialUrl(l.sourceUrl, l.source);
  const initiativesHref = legislatorFiledInitiativesHref(l.id, lang);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      className="max-h-[88dvh] w-full max-w-[620px] overflow-y-auto rounded-2xl p-5 shadow-2xl sm:max-w-[620px]"
      panelStyle={{
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        color: "var(--text)",
      }}
    >
      <div lang={lang} data-dialog="legislator-profile">
        <div className="flex items-start gap-4">
          <Avatar src={l.photoUrl} initials={initials} name={l.fullName} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="eyebrow text-[var(--accent)]">
                  {l.active
                    ? isSpanish
                      ? "Perfil del congresista"
                      : "Member of Congress profile"
                    : isSpanish
                      ? "Perfil histórico del congresista"
                      : "Historical member of Congress profile"}
                </p>
                <h2 id={titleId} className="serif mt-1 text-[19px] font-semibold leading-tight">
                  {l.fullName}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={isSpanish ? "Cerrar perfil" : "Close profile"}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
              >
                <X size={16} aria-hidden="true" />
                {isSpanish ? "Cerrar" : "Close"}
              </button>
            </div>
            {memberType && (
              <div className="mt-1 text-[12px] font-medium" style={{ color: "var(--accent)" }}>
                {memberType}
              </div>
            )}
            {!l.active && (
              <p
                className="mt-1.5 inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                {isSpanish
                  ? "No figura en el directorio activo actual"
                  : "Not listed in the current active directory"}
              </p>
            )}
            <p className="mt-1.5 text-[12.5px] leading-snug" style={{ color: "var(--text-muted)" }}>
              {bioParts.join(" · ")}.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-x-4 gap-y-3 text-[12.5px] min-[480px]:grid-cols-2">
          <Field
            label={isSpanish ? "Cámara" : "Chamber"}
            value={chamberName(l.chamber, isSpanish)}
          />
          <Field label={isSpanish ? "Provincia" : "Province"} value={l.province} />
          <Field label={isSpanish ? "Partido" : "Party"} value={party} />
          <Field label={isSpanish ? "Período" : "Term"} value={l.period} />
          <Field
            label={isSpanish ? "Circunscripción" : "Constituency"}
            value={circumscriptionLabel(l.circumscription, lang)}
          />
          <Field
            label={isSpanish ? "Nivel de representación" : "Representation level"}
            value={representationLevelLabel(l.representationLevel, lang)}
          />
          <Field label={isSpanish ? "Profesión" : "Profession"} value={l.profession} />
          <Field label={isSpanish ? "Correo público" : "Public email"} value={l.email} />
          <Field label={isSpanish ? "Teléfono público" : "Public phone"} value={l.phone} />
        </dl>

        <LegislatorInitiativeStatsPanel
          stats={l.initiativeStats}
          lang={lang}
          titleId={`${titleId}-initiatives`}
          initiativesHref={initiativesHref ?? undefined}
          legislatorName={l.fullName}
          onNavigate={onClose}
        />

        <section className="mt-5" aria-labelledby={`${titleId}-committees`}>
          <h3
            id={`${titleId}-committees`}
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {isSpanish ? "Comisiones" : "Committees"}{" "}
            {l.committees.length > 0 && `· ${l.committees.length}`}
          </h3>
          {l.committees.length === 0 ? (
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              {isSpanish
                ? "Oculis no tiene comisiones vinculadas mediante un identificador oficial para este perfil."
                : "Oculis has no committees linked to this profile through an official identifier."}
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {l.committees
                .slice()
                .sort(
                  (a, b) =>
                    (a.cargo === "Presidente" ? -1 : 0) - (b.cargo === "Presidente" ? -1 : 0),
                )
                .map((committee) => (
                  <li
                    key={`${committee.name}-${committee.cargo ?? ""}`}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px]"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span lang={isSpanish ? undefined : "es"}>{committee.name}</span>
                    {committee.cargo && committee.cargo !== "Miembro" && (
                      <span
                        className="rounded px-1 text-[9.5px] font-semibold"
                        style={{
                          background: CARGO_SOFT[committee.cargo] ?? "var(--surface-2)",
                          color: CARGO_COLOR[committee.cargo] ?? "var(--text-muted)",
                        }}
                      >
                        {committeeRoleLabel(committee.cargo, lang)}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}
          {presidencies.length > 0 && (
            <p className="mt-2 text-[11px]" style={{ color: "var(--verified)" }}>
              {isSpanish ? "Preside" : "Chairs"}: {presidencies.map((item) => item.name).join(", ")}
            </p>
          )}
        </section>

        {officialUrl && (
          <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
            <a
              href={officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-action="open-official-legislator-profile"
              aria-label={
                isSpanish
                  ? `Abrir perfil oficial de ${l.fullName} en una pestaña nueva`
                  : `Open ${l.fullName}'s official profile in a new tab`
              }
              className="ui-button"
            >
              {isSpanish ? "Abrir perfil oficial" : "Open official profile"}
              <ArrowSquareOut size={17} aria-hidden="true" />
              <NewTabNotice lang={lang} />
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function LegislatorInitiativeStatsPanel({
  stats,
  lang,
  titleId,
  initiativesHref,
  legislatorName,
  onNavigate,
}: {
  stats: LegislatorProfile["initiativeStats"];
  lang: Lang;
  titleId: string;
  initiativesHref?: string;
  legislatorName?: string;
  onNavigate?: () => void;
}) {
  const es = lang === "es";
  return (
    <section
      className="mt-5 rounded-xl border p-3.5"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      aria-labelledby={titleId}
      data-profile-initiative-stats={stats.availability}
    >
      <h3
        id={titleId}
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {es ? "Iniciativas depositadas" : "Filed initiatives"}
      </h3>

      {stats.availability === "observed" ? (
        <>
          <dl className="mt-2 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
            <InitiativeStat
              label={es ? "Depositadas vinculadas" : "Linked filed"}
              value={stats.deposited}
              color="var(--accent)"
            />
            <InitiativeStat
              label={es ? "Vigentes" : "Active"}
              value={stats.active}
              color="var(--verified)"
            />
            <InitiativeStat
              label={es ? "No marcadas vigentes" : "Not marked active"}
              value={stats.otherConditionOrUnpublished}
              color="var(--text)"
            />
          </dl>
          <p
            className="mt-2.5 text-[10.5px] leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            {es
              ? "Mínimo verificable: se cuentan solo iniciativas con fecha de depósito publicada y una relación exacta de proponente conservada con su evidencia oficial. Oculis no compara nombres por similitud. La cobertura histórica aún puede ser incompleta. “No marcadas vigentes” reúne otras condiciones oficiales o ninguna condición publicada; no significa que estén archivadas."
              : "Verified minimum: only initiatives with a published filing date and an exact sponsor relationship retained with its official evidence are counted. Oculis does not use approximate name matching. Historical coverage may still be incomplete. “Not marked active” includes other official conditions or no published condition; it does not mean the initiatives were archived."}
          </p>
          {initiativesHref && (
            <Link
              href={initiativesHref}
              onClick={onNavigate}
              data-action="view-filed-initiatives"
              aria-label={
                legislatorName
                  ? es
                    ? `Ver iniciativas depositadas vinculadas a ${legislatorName}`
                    : `View filed initiatives linked to ${legislatorName}`
                  : undefined
              }
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ borderColor: "var(--border-strong)" }}
            >
              {es ? "Ver iniciativas depositadas" : "View filed initiatives"}
              <ArrowRight size={17} weight="bold" aria-hidden="true" />
            </Link>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {stats.reason === "reconciliation-incomplete"
            ? es
              ? "La reconciliación completa de esta fuente todavía no ha finalizado. Oculis no presenta un cero como si fuera cobertura completa."
              : "Full reconciliation for this source has not finished yet. Oculis does not show zero as if coverage were complete."
            : es
              ? "Oculis todavía no tiene una relación oficial exacta que permita vincular iniciativas a este perfil sin inferir por nombre. No se presenta un cero como si fuera cobertura completa."
              : "Oculis does not yet have an exact official relationship that can link initiatives to this profile without name-based inference. Zero is not shown as if coverage were complete."}
        </p>
      )}
    </section>
  );
}

function InitiativeStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex min-w-0 items-center justify-between gap-3 rounded-lg border px-2.5 py-2 min-[480px]:block"
      style={{ borderColor: "var(--border)" }}
    >
      <dt
        className="text-[9.5px] font-semibold uppercase leading-snug tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </dt>
      <dd
        className="tnum text-[19px] font-semibold leading-none min-[480px]:mt-1"
        style={{ color }}
      >
        {value.toLocaleString("es-DO")}
      </dd>
    </div>
  );
}

function Avatar({ src, initials, name }: { src: string | null; initials: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const safeSrc = safeHttpUrl(src);
  if (safeSrc && !failed) {
    return (
      <img
        src={safeSrc}
        alt={name}
        onError={() => setFailed(true)}
        className="h-16 w-16 shrink-0 rounded-xl object-cover"
        style={{ background: "var(--surface-2)" }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-[18px] font-semibold"
      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
    >
      {initials}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
