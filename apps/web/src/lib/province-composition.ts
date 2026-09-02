import { resolvePartyPresentation } from "@/lib/party-presentation";

export interface InitiativeCompositionInput {
  total: number;
  active: number;
}

export interface InitiativeComposition {
  total: number;
  active: number;
  remaining: number;
  isConsistent: boolean;
}

export interface PartyCompositionGroup {
  label: string;
  count: number;
  isMissing: boolean;
}

export interface PartyComposition {
  groups: PartyCompositionGroup[];
  total: number;
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function normalizeInitiativeComposition({
  total,
  active,
}: InitiativeCompositionInput): InitiativeComposition {
  const normalizedTotal = normalizeCount(total);
  const normalizedActive = normalizeCount(active);
  const isConsistent = normalizedActive <= normalizedTotal;

  return {
    total: normalizedTotal,
    active: normalizedActive,
    remaining: isConsistent ? normalizedTotal - normalizedActive : 0,
    isConsistent,
  };
}

export function groupCongressMembersByParty(
  parties: readonly (string | null | undefined)[],
  missingLabel = "No informado",
): PartyComposition {
  const counts = new Map<string, number>();
  let missingCount = 0;

  for (const party of parties) {
    const rawLabel = party?.trim() ?? "";
    if (!rawLabel) {
      missingCount += 1;
      continue;
    }

    const presentation = resolvePartyPresentation(rawLabel);
    const label = presentation.acronym ?? presentation.fullName ?? rawLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const groups: PartyCompositionGroup[] = [...counts.entries()]
    .map(([label, count]) => ({ label, count, isMissing: false }))
    .sort((left, right) => {
      const countDifference = right.count - left.count;
      if (countDifference !== 0) return countDifference;
      if (left.label < right.label) return -1;
      if (left.label > right.label) return 1;
      return 0;
    });

  if (missingCount > 0) {
    groups.push({
      label: missingLabel.trim() || "No informado",
      count: missingCount,
      isMissing: true,
    });
  }

  return { groups, total: parties.length };
}
