/**
 * Evidence-backed account directory.
 *
 * Only institutional accounts explicitly named by an official publication are active.
 * Legacy seed rows are retained for auditability but disabled; no popularity
 * ordering is computed or persisted.
 */
import { listFeedAccounts, upsertFeedAccount, type Database } from "@oculis/db";

interface VerifiedAccount {
  name: string;
  handle: string;
  platform: "X";
  url: string;
  kind: "SENADO_OFFICIAL" | "INSTITUTION";
  chamber: "SENADO" | "DIPUTADOS";
  evidenceUrl: string;
  verifiedAt: string;
}

/** Alphabetical, with one primary-source citation per handle. */
export const VERIFIED_FEED_ACCOUNTS: readonly VerifiedAccount[] = [
  {
    name: "Cámara de Diputados",
    handle: "@DiputadosRD",
    platform: "X",
    url: "https://x.com/DiputadosRD",
    kind: "INSTITUTION",
    chamber: "DIPUTADOS",
    evidenceUrl:
      "https://camaradediputados.gob.do/wp-content/uploads/2024/08/REVISTA-DIPUTAD_SRD1_Optimized.pdf",
    verifiedAt: "2026-08-05",
  },
  {
    name: "Senado de la República",
    handle: "@SenadoRD",
    platform: "X",
    url: "https://x.com/SenadoRD",
    kind: "SENADO_OFFICIAL",
    chamber: "SENADO",
    evidenceUrl:
      "https://memoriahistorica.senadord.gob.do/server/api/core/bitstreams/0bf6766c-2d7a-4956-92d9-84c0f4c4ad5d/content",
    verifiedAt: "2026-08-05",
  },
];

export async function seedFeedAccounts(
  db: Database,
  opts: { log?: (message: string) => void } = {},
): Promise<{ total: number; linked: number; deactivated: number }> {
  const log = opts.log ?? (() => {});
  const existing = await listFeedAccounts(db);
  let deactivated = 0;

  // Make the transition safe for databases that already received the old candidate list.
  for (const account of existing) {
    if (account.active) deactivated++;
    await upsertFeedAccount(db, {
      name: account.name,
      handle: account.handle,
      platform: account.platform,
      url: account.url,
      kind: account.kind,
      chamber: account.chamber,
      legislatorSourceId: null,
      influenceRank: null,
      active: false,
      raw: account.raw,
    });
  }

  for (const account of VERIFIED_FEED_ACCOUNTS) {
    await upsertFeedAccount(db, {
      name: account.name,
      handle: account.handle,
      platform: account.platform,
      url: account.url,
      kind: account.kind,
      chamber: account.chamber,
      // Institutional accounts are not linked to a person.
      legislatorSourceId: null,
      influenceRank: null,
      active: true,
      raw: {
        verification: "OFFICIAL_PUBLICATION",
        evidenceUrl: account.evidenceUrl,
        verifiedAt: account.verifiedAt,
      },
    });
  }

  log(
    `  ✔ ${VERIFIED_FEED_ACCOUNTS.length} cuentas institucionales verificadas; ` +
      `${deactivated} entradas previas desactivadas`,
  );
  return { total: VERIFIED_FEED_ACCOUNTS.length, linked: 0, deactivated };
}
