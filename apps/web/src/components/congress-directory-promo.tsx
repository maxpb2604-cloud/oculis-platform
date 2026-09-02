"use client";

import React, { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, IdentificationCard, UsersThree } from "@phosphor-icons/react";
import type { HomeDirectoryPortrait, HomeDirectoryPromoData } from "@/lib/data";
import { HOME_DIRECTORY_PORTRAIT_COUNT } from "@/lib/home-directory-promo";
import type { Lang } from "@/lib/i18n";
import { partyDisplayLabel } from "@/lib/party-presentation";
import { ChamberPartyComposition } from "./chamber-party-composition";
import { LegislatorProfileTrigger } from "./legislator-profile-provider";
import styles from "./congress-directory-promo.module.css";

const portraitPositions = [
  styles.portraitOne,
  styles.portraitTwo,
  styles.portraitThree,
  styles.portraitFour,
  styles.portraitFive,
  styles.portraitSix,
  styles.portraitSeven,
  styles.portraitEight,
  styles.portraitNine,
  styles.portraitTen,
  styles.portraitEleven,
  styles.portraitTwelve,
  styles.portraitThirteen,
];

const portraitScales = [
  "small",
  "medium",
  "small",
  "large",
  "medium",
  "large",
  "hero",
  "medium",
  "large",
  "small",
  "large",
  "medium",
  "small",
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function chamberLabel(chamber: string, lang: Lang): string {
  if (chamber === "SENADO") return lang === "es" ? "Senado" : "Senate";
  return lang === "es" ? "Cámara de Diputados" : "Chamber of Deputies";
}

function PortraitButton({
  person,
  index,
  lang,
}: {
  person: HomeDirectoryPortrait;
  index: number;
  lang: Lang;
}) {
  const [failed, setFailed] = useState(false);
  const role = chamberLabel(person.chamber, lang);
  const party = partyDisplayLabel(person.party, null, lang);

  return (
    <LegislatorProfileTrigger
      profileId={person.profileId}
      fullName={person.fullName}
      chamber={person.chamber}
      role={person.role}
      party={person.party}
      province={person.province}
      className={`${styles.portraitButton} ${portraitPositions[index] ?? ""}`}
      style={{ "--portrait-order": index } as CSSProperties}
      data-portrait-index={index + 1}
      data-portrait-scale={portraitScales[index] ?? "small"}
      ariaLabel={
        lang === "es"
          ? `Abrir perfil de ${person.fullName}, ${role}, ${party}`
          : `Open ${person.fullName}'s profile, ${role}, ${party}`
      }
    >
      <span className={styles.portraitFrame}>
        {!failed ? (
          <img
            src={person.photoUrl}
            alt=""
            width={112}
            height={112}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className={styles.portraitFallback} aria-hidden="true">
            {initials(person.fullName)}
          </span>
        )}
      </span>
      <span className={styles.portraitLabel} aria-hidden="true">
        <strong>{person.fullName}</strong>
        <small>{[role, party].filter(Boolean).join(" · ")}</small>
      </span>
    </LegislatorProfileTrigger>
  );
}

export function CongressDirectoryPromo({
  portraits,
  composition,
  lang,
}: {
  portraits: HomeDirectoryPortrait[];
  composition: HomeDirectoryPromoData["composition"];
  lang: Lang;
}) {
  const es = lang === "es";
  const titleId = "home-directory-promo-title";
  const portraitTitleId = "home-directory-portraits-title";
  const descriptionId = "home-directory-promo-description";
  const visiblePortraits = [
    ...new Map(
      portraits
        .filter((portrait) => Number.isSafeInteger(portrait.profileId) && portrait.profileId > 0)
        .map((portrait) => [portrait.profileId, portrait]),
    ).values(),
  ].slice(0, HOME_DIRECTORY_PORTRAIT_COUNT);

  return (
    <section
      className={styles.band}
      aria-label={
        es
          ? "Directorio y composición partidaria del Congreso"
          : "Congressional directory and party composition"
      }
      data-testid="directory-promo"
    >
      <ChamberPartyComposition chambers={composition.chambers} lang={lang} />

      <article className={styles.promo} aria-labelledby={portraitTitleId}>
        <div className={styles.portraitStage}>
          <div className={styles.portraitHeading}>
            <div>
              <span className={styles.portraitEyebrow}>
                {es ? "Retratos publicados por las cámaras" : "Portraits published by the chambers"}
              </span>
              <h2 id={portraitTitleId}>
                {es
                  ? "Todo lo que necesitas saber de los legisladores"
                  : "Everything you need to know about legislators"}
              </h2>
            </div>
            <span className={styles.profileHint}>
              {es ? "Selecciona una foto" : "Select a portrait"}
            </span>
          </div>

          {visiblePortraits.length === HOME_DIRECTORY_PORTRAIT_COUNT ? (
            <div className={styles.portraitArc} role="group" aria-labelledby={portraitTitleId}>
              {visiblePortraits.map((person, index) => (
                <PortraitButton key={person.profileId} person={person} index={index} lang={lang} />
              ))}
            </div>
          ) : (
            <div className={styles.emptyPortraits}>
              <UsersThree size={42} weight="duotone" aria-hidden />
              <p>
                {es
                  ? "Este registro todavía no reúne trece retratos oficiales verificables."
                  : "This record does not yet include thirteen verifiable official portraits."}
              </p>
            </div>
          )}

          <p className={styles.portraitNote}>
            {es
              ? "Cada foto abre primero la ficha de Oculis; desde allí puedes consultar el perfil oficial."
              : "Each portrait opens the Oculis profile first; the official profile is available from there."}
          </p>
        </div>

        <Link
          href={es ? "/congreso" : "/congreso?lang=en"}
          className={styles.directoryLink}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <IdentificationCard className={styles.backgroundIcon} weight="duotone" aria-hidden />
          <span className={styles.eyebrow}>
            <UsersThree size={18} weight="duotone" aria-hidden />
            {es ? "Directorio del Congreso" : "Congressional directory"}
          </span>
          <h3 id={titleId} className={styles.title}>
            {es
              ? "Visita el Directorio de Congresistas"
              : "Visit the Members of Congress Directory"}
          </h3>
          <p id={descriptionId} className={styles.description}>
            {es
              ? "Revisa el partido, los roles en comisiones, el contacto público disponible y las iniciativas depositadas vinculadas por Oculis."
              : "Review party affiliation, committee roles, available public contact information, and filed initiatives linked by Oculis."}
          </p>
          <span className={styles.action}>
            <span>{es ? "Explorar el directorio" : "Explore the directory"}</span>
            <span className={styles.actionIcon} aria-hidden="true">
              <ArrowRight size={24} weight="bold" />
            </span>
          </span>
        </Link>
      </article>
    </section>
  );
}
