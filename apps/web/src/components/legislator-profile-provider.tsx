"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { LegislatorProfileModal } from "@/components/legislator-profile-modal";
import { Modal } from "@/components/ui/modal";
import { X } from "@/components/ui/icons";
import type { LegislatorProfile } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { legislatorRoleLabel } from "@/lib/legislative-labels";
import { partyDisplayLabel } from "@/lib/party-presentation";

export interface LegislatorProfileReference {
  /** Canonical `legislators.id`. The visible name is never used to resolve a profile. */
  profileId: number | null;
  fullName: string;
  chamber?: string | null;
  role?: string | null;
  party?: string | null;
  province?: string | null;
}

type LoadState = "minimal" | "loading" | "ready" | "error";

interface Selection extends LegislatorProfileReference {
  state: LoadState;
  profile: LegislatorProfile | null;
}

interface LegislatorProfileContextValue {
  lang: Lang;
  openProfile: (reference: LegislatorProfileReference) => void;
}

const LegislatorProfileContext = createContext<LegislatorProfileContextValue | null>(null);
// Module-scoped caches survive App Router page transitions while remaining browser-local.
const PROFILE_CACHE = new Map<number, LegislatorProfile>();
const PROFILE_REQUESTS = new Map<number, Promise<LegislatorProfile>>();

export function isLegislatorProfileId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isProfilePayload(value: unknown, profileId: number): value is LegislatorProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<LegislatorProfile>;
  return (
    profile.id === profileId &&
    typeof profile.fullName === "string" &&
    profile.fullName.trim().length > 0 &&
    typeof profile.source === "string" &&
    typeof profile.sourceId === "string" &&
    typeof profile.chamber === "string" &&
    typeof profile.active === "boolean" &&
    Array.isArray(profile.committees) &&
    isInitiativeStats(profile.initiativeStats)
  );
}

export function isInitiativeStats(value: unknown): value is LegislatorProfile["initiativeStats"] {
  if (!value || typeof value !== "object") return false;
  const stats = value as Partial<LegislatorProfile["initiativeStats"]>;
  if (stats.availability === "unavailable") {
    return (
      (stats.reason === "no-compatible-official-identifier" ||
        stats.reason === "reconciliation-incomplete") &&
      stats.deposited === null &&
      stats.active === null &&
      stats.otherConditionOrUnpublished === null
    );
  }
  if (
    stats.availability !== "observed" ||
    stats.basis !== "official-proponent-id" ||
    (stats.coverage !== "partial" && stats.coverage !== "complete")
  ) {
    return false;
  }
  const values = [stats.deposited, stats.active, stats.otherConditionOrUnpublished];
  const validCounts =
    values.every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0) &&
    stats.active! + stats.otherConditionOrUnpublished! === stats.deposited;
  return validCounts && (stats.coverage !== "complete" || stats.deposited === 0);
}

/**
 * One profile-dialog owner for the whole customer shell.
 *
 * A trigger supplies only the canonical internal id and display name. The provider opens
 * a dialog synchronously, then loads the source-backed profile once and caches it for the
 * rest of the browser session. Failed or stale requests never navigate the customer away.
 */
export function LegislatorProfileProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectedIdRef = useRef<number | null>(null);

  const loadProfile = useCallback((profileId: number): Promise<LegislatorProfile> => {
    const cached = PROFILE_CACHE.get(profileId);
    if (cached) return Promise.resolve(cached);

    const pending = PROFILE_REQUESTS.get(profileId);
    if (pending) return pending;

    const request = fetch(`/api/legislators/${profileId}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`profile_request_${response.status}`);
        const payload = (await response.json()) as { profile?: unknown };
        if (!isProfilePayload(payload.profile, profileId)) {
          throw new Error("invalid_profile_payload");
        }
        PROFILE_CACHE.set(profileId, payload.profile);
        return payload.profile;
      })
      .finally(() => {
        PROFILE_REQUESTS.delete(profileId);
      });

    PROFILE_REQUESTS.set(profileId, request);
    return request;
  }, []);

  const requestProfile = useCallback(
    (reference: LegislatorProfileReference) => {
      const fullName = reference.fullName.trim();
      if (!isLegislatorProfileId(reference.profileId)) {
        selectedIdRef.current = null;
        setSelection({ ...reference, fullName, state: "minimal", profile: null });
        return;
      }
      const profileId = reference.profileId;
      const cached = PROFILE_CACHE.get(profileId) ?? null;
      selectedIdRef.current = profileId;
      setSelection({
        ...reference,
        profileId,
        fullName,
        state: cached ? "ready" : "loading",
        profile: cached,
      });
      if (cached) return;

      void loadProfile(profileId).then(
        (profile) => {
          if (selectedIdRef.current !== profileId) return;
          setSelection({
            ...reference,
            profileId,
            fullName: profile.fullName,
            state: "ready",
            profile,
          });
        },
        () => {
          if (selectedIdRef.current !== profileId) return;
          setSelection({ ...reference, profileId, fullName, state: "error", profile: null });
        },
      );
    },
    [loadProfile],
  );

  const closeProfile = useCallback(() => {
    selectedIdRef.current = null;
    setSelection(null);
  }, []);
  const contextValue = useMemo(
    () => ({ lang, openProfile: requestProfile }),
    [lang, requestProfile],
  );

  return (
    <LegislatorProfileContext.Provider value={contextValue}>
      {children}
      {selection?.state === "ready" && selection.profile ? (
        <LegislatorProfileModal profile={selection.profile} lang={lang} onClose={closeProfile} />
      ) : selection ? (
        <ProfileRequestModal
          selection={selection}
          lang={lang}
          onClose={closeProfile}
          onRetry={() => requestProfile(selection)}
        />
      ) : null}
    </LegislatorProfileContext.Provider>
  );
}

export type LegislatorProfileTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "role" | "type"
> & {
  profileId: number | null | undefined;
  fullName: string;
  chamber?: string | null;
  role?: string | null;
  party?: string | null;
  province?: string | null;
  children?: ReactNode;
  ariaLabel?: string;
  onBeforeOpen?: () => void;
};

/** The required interaction for every source-linked senator or deputy name. */
export function LegislatorProfileTrigger({
  profileId,
  fullName,
  chamber,
  role,
  party,
  province,
  children,
  ariaLabel,
  onBeforeOpen,
  "aria-label": ariaLabelAttribute,
  ...buttonProps
}: LegislatorProfileTriggerProps) {
  const context = useContext(LegislatorProfileContext);
  const content = children ?? fullName;

  if (!context) {
    throw new Error("LegislatorProfileTrigger must be used inside LegislatorProfileProvider");
  }

  return (
    <button
      {...buttonProps}
      type="button"
      data-entity="legislator"
      data-legislator-key={isLegislatorProfileId(profileId) ? `profile:${profileId}` : "unresolved"}
      aria-haspopup="dialog"
      aria-label={
        ariaLabel ??
        ariaLabelAttribute ??
        (context.lang === "es" ? `Abrir perfil de ${fullName}` : `Open ${fullName}'s profile`)
      }
      onClick={() => {
        try {
          onBeforeOpen?.();
        } finally {
          context.openProfile({
            profileId: isLegislatorProfileId(profileId) ? profileId : null,
            fullName,
            chamber,
            role,
            party,
            province,
          });
        }
      }}
    >
      {content}
    </button>
  );
}

function ProfileRequestModal({
  selection,
  lang,
  onClose,
  onRetry,
}: {
  selection: Selection;
  lang: Lang;
  onClose: () => void;
  onRetry: () => void;
}) {
  const titleId = `legislator-profile-request-${useId().replace(/:/g, "")}`;
  const es = lang === "es";
  const loading = selection.state === "loading";

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      className="w-full max-w-[520px] rounded-2xl p-5 shadow-2xl"
      panelStyle={{
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        color: "var(--text)",
      }}
    >
      <div lang={lang} data-dialog="legislator-profile" aria-busy={loading || undefined}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow text-[var(--accent)]">
              {es ? "Perfil del congresista" : "Member of Congress profile"}
            </p>
            <h2 id={titleId} className="serif mt-1 text-[19px] font-semibold leading-tight">
              {selection.fullName || (es ? "Congresista" : "Member of Congress")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={es ? "Cerrar perfil" : "Close profile"}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
          >
            <X size={16} aria-hidden="true" />
            {es ? "Cerrar" : "Close"}
          </button>
        </div>

        {loading ? (
          <div className="mt-5" role="status" aria-live="polite">
            <div
              aria-hidden="true"
              className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
            >
              <span className="block h-full w-1/2 animate-pulse rounded-full bg-[var(--accent)]" />
            </div>
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              {es ? "Cargando el perfil verificado…" : "Loading the verified profile…"}
            </p>
          </div>
        ) : selection.state === "minimal" ? (
          <div className="mt-5">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-[12.5px] min-[480px]:grid-cols-2">
              <MinimalField
                label={es ? "Cámara" : "Chamber"}
                value={chamberName(selection.chamber, lang)}
              />
              <MinimalField label={es ? "Provincia" : "Province"} value={selection.province} />
              <MinimalField
                label={es ? "Partido" : "Party"}
                value={partyDisplayLabel(selection.party, null, lang)}
              />
              <MinimalField
                label={es ? "Función" : "Role"}
                value={
                  legislatorRoleLabel(selection.role, selection.chamber, lang) || selection.role
                }
              />
            </dl>
            <p className="mt-5 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {es
                ? "Este nombre no tiene todavía una ficha vinculada mediante un identificador oficial. Oculis muestra únicamente los datos disponibles y no intenta identificar a la persona por su nombre."
                : "This name does not yet have a profile linked through an official identifier. Oculis shows only the available facts and does not try to identify the person by name."}
            </p>
          </div>
        ) : (
          <div className="mt-5" role="alert">
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {es
                ? "No pudimos cargar este perfil en este momento. Oculis no abrirá otra página ni intentará identificar a la persona por su nombre."
                : "We could not load this profile right now. Oculis will not open another page or try to identify the person by name."}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {es ? "Intentar de nuevo" : "Try again"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function chamberName(value: string | null | undefined, lang: Lang): string | null {
  const chamber = value?.trim().toUpperCase();
  if (chamber === "DIPUTADOS") return lang === "es" ? "Cámara de Diputados" : "Chamber of Deputies";
  if (chamber === "SENADO")
    return lang === "es" ? "Senado de la República" : "Senate of the Republic";
  return value?.trim() || null;
}

function MinimalField({ label, value }: { label: string; value: string | null | undefined }) {
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
