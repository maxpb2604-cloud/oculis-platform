export interface DirectoryPortraitCandidate {
  profileId: number;
  fullName: string;
  party: string | null;
  province: string | null;
}

export const HOME_DIRECTORY_PORTRAIT_COUNT = 13;
export const HOME_DIRECTORY_DEPUTY_PORTRAIT_COUNT = 7;
export const HOME_DIRECTORY_SENATE_PORTRAIT_COUNT = 6;

function seededRank(seed: string, profileId: number): number {
  let hash = 2_166_136_261;
  for (const character of `${seed}:${profileId}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Pick a stable, neutral preview while preferring distinct published parties and
 * provinces. A server-supplied seed varies equally scored candidates without using
 * client randomness, so the server HTML and hydrated view always agree. This is a
 * diversity-of-source-data rule, not a political ranking.
 */
export function selectDiverseDirectoryPortraits<T extends DirectoryPortraitCandidate>(
  candidates: readonly T[],
  requestedLimit: number,
  seed?: string,
): T[] {
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.trunc(requestedLimit)) : 0;
  if (limit === 0) return [];
  const selectionSeed = seed?.trim() || null;

  const unique = [
    ...new Map(candidates.map((candidate) => [candidate.profileId, candidate])).values(),
  ];
  const selected: T[] = [];
  const remaining = [...unique];
  const parties = new Set<string>();
  const provinces = new Set<string>();

  while (selected.length < limit && remaining.length > 0) {
    remaining.sort((a, b) => {
      const score = (candidate: T) =>
        (candidate.party && !parties.has(candidate.party) ? 4 : 0) +
        (candidate.province && !provinces.has(candidate.province) ? 2 : 0);
      return (
        score(b) - score(a) ||
        (selectionSeed
          ? seededRank(selectionSeed, a.profileId) - seededRank(selectionSeed, b.profileId)
          : 0) ||
        a.fullName.localeCompare(b.fullName, "es") ||
        a.profileId - b.profileId
      );
    });
    const next = remaining.shift()!;
    selected.push(next);
    if (next.party) parties.add(next.party);
    if (next.province) provinces.add(next.province);
  }

  return selected;
}

/**
 * Build the neutral HOME portrait preview from both official chamber rosters.
 * The 7/6 split is a visual balance for the preview, not a claim about chamber size.
 * A request seed changes equally ranked faces on refresh while keeping SSR stable.
 */
export function selectHomeDirectoryPortraits<
  TDeputy extends DirectoryPortraitCandidate,
  TSenator extends DirectoryPortraitCandidate,
>(
  deputyCandidates: readonly TDeputy[],
  senateCandidates: readonly TSenator[],
  seed: string,
): Array<TDeputy | TSenator> {
  const deputies = selectDiverseDirectoryPortraits(
    deputyCandidates,
    HOME_DIRECTORY_PORTRAIT_COUNT,
    `${seed}:diputados`,
  );
  const senators = selectDiverseDirectoryPortraits(
    senateCandidates,
    HOME_DIRECTORY_PORTRAIT_COUNT,
    `${seed}:senado`,
  );
  const preferred: Array<TDeputy | TSenator> = [];

  for (let index = 0; index < HOME_DIRECTORY_DEPUTY_PORTRAIT_COUNT; index += 1) {
    const deputy = deputies[index];
    if (deputy) preferred.push(deputy);
    if (index < HOME_DIRECTORY_SENATE_PORTRAIT_COUNT) {
      const senator = senators[index];
      if (senator) preferred.push(senator);
    }
  }

  const selected: Array<TDeputy | TSenator> = [];
  const used = new Set<number>();
  for (const portrait of [...preferred, ...deputies, ...senators]) {
    if (selected.length >= HOME_DIRECTORY_PORTRAIT_COUNT) break;
    if (used.has(portrait.profileId)) continue;
    selected.push(portrait);
    used.add(portrait.profileId);
  }
  return selected;
}
