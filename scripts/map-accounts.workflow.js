/**
 * Disabled by the factual-data policy.
 *
 * The former workflow asked AI agents to decide which political accounts were
 * relevant and to guess handles. That output cannot satisfy Oculis's requirement
 * for explicit, source-backed facts. Account discovery must now start from an
 * official profile or institution page and pass through a deterministic verifier.
 */
export const meta = {
  name: "map-dr-political-accounts-disabled",
  description: "Disabled: AI-curated account selection is not permitted by FACTUAL_DATA_POLICY.md",
  phases: [{ title: "Disabled", detail: "Use documented official account URLs only" }],
};

phase("Disabled");
log("No candidates produced: Oculis requires explicit source evidence for every account.");

return {
  candidates: [],
  disabled: true,
  policy: "FACTUAL_DATA_POLICY.md",
};
