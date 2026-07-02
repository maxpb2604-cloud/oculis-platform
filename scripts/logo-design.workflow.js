export const meta = {
  name: 'pulso-legislativo-logo',
  description: 'Generate & judge futuristic logo concepts for "Pulso Legislativo" (Capitol dome + pulse)',
  phases: [
    { title: 'Design', detail: 'six agents each produce a distinct SVG logo concept' },
    { title: 'Judge', detail: 'panel scores concepts on 6 criteria and picks the best' },
  ],
}

const PALETTE = `Palette (use these exact hex):
- Ink/navy (primary): #0E2A47  (darker: #0A1F36)
- Brand blue: #1565A8
- Pulse blue (accent line): #1E7FC0
- Futuristic cyan pop (sparingly, for "intelligence"): #38BDF8
- Paper: #FFFFFF   Muted: #5C6B63`

const FONTS = `Choose ONE futuristic-but-legible Google font for the wordmark from: "Space Grotesk", "Sora", "Chakra Petch", "Michroma", "Exo 2", "Rajdhani", "Sarpanch", "Orbitron". Prefer intelligent/geometric over gimmicky. Set "Pulso" bold and "LEGISLATIVO" as tracked small-caps beneath or beside it.`

const RULES = `You are a senior brand designer. Design a logo for "Pulso Legislativo" — a Dominican Republic legislative/regulatory/social INTELLIGENCE product. The established concept is a Capitol DOME + a PULSE / EKG heartbeat line (the "pulso"). Keep that meaning but make it sharper, more intelligent and more futuristic than the current version.

Deliver clean, VALID, self-contained SVG (no external refs, no <image>, no scripts). Use stroke-linecap="round", stroke-linejoin="round". ${PALETTE}

Return TWO SVGs:
1) iconSvg — the mark ONLY, square, viewBox="0 0 64 64", crisp at 16px (favicon-safe: no hairlines thinner than 2 units, no tiny detail).
2) lockupSvg — horizontal lockup, viewBox="0 0 340 96": the icon at left (~72px) + the wordmark using <text> with your chosen font-family. "Pulso" ~34px bold ink; "LEGISLATIVO" ~13px letter-spacing ~4, brand blue.
${FONTS}
Both SVGs must include width/height attributes and render standalone. Do NOT wrap in markdown fences.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'fontFamily', 'iconSvg', 'lockupSvg', 'rationale'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string', description: 'Concept name (Spanish, short)' },
    fontFamily: { type: 'string', description: 'The Google font family chosen' },
    iconSvg: { type: 'string', description: 'Complete <svg>…</svg>, viewBox 0 0 64 64' },
    lockupSvg: { type: 'string', description: 'Complete <svg>…</svg>, viewBox 0 0 340 96' },
    rationale: { type: 'string', description: 'One or two lines: idea + why it fits' },
  },
}

const CONCEPTS = [
  { id: 'A', dir: 'EVOLUCIÓN CÚPULA+PULSO: refine the classic dome+portico with an integrated EKG line running through the steps. Cleaner geometry, subtle futuristic bevel, confident.' },
  { id: 'B', dir: 'HEMICICLO: use the semicircular congressional SEATING (hemiciclo) — concentric arc segments forming a half-dome — with the pulse as the speaker’s-podium baseline. Distinctive and unmistakably legislative.' },
  { id: 'C', dir: 'MONOGRAMA P·PULSO: a bold geometric letter "P" whose stem or counter IS the heartbeat pulse line. Modern monogram that works tiny.' },
  { id: 'D', dir: 'SEÑAL / CÚPULA RADIANTE: dome rendered as radiating concentric signal arcs (broadcast/intelligence/data), pulse along the base. Tech-forward, evokes "inteligencia".' },
  { id: 'E', dir: 'MÍNIMA GEOMÉTRICA: single consistent stroke weight, favicon-first, reduced to the essential dome + one step + a clean pulse. Swiss/precise/futuristic restraint.' },
  { id: 'F', dir: 'EMBLEMA CONTENIDO: dome+pulse inside a rounded-square (squircle) or subtle shield token — an authoritative app-icon style emblem with a modern gradient-free duotone.' },
]

phase('Design')
const designs = (
  await parallel(
    CONCEPTS.map((c) => () =>
      agent(`${RULES}\n\nYOUR ASSIGNED DIRECTION (${c.id}): ${c.dir}\nSet id="${c.id}".`, {
        label: `design:${c.id}`,
        phase: 'Design',
        schema: SCHEMA,
      }),
    ),
  )
).filter(Boolean)
log(`Got ${designs.length} logo concepts`)

phase('Judge')
const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'bestId', 'summary'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'distinctiveness', 'legislativeClarity', 'futurism', 'scalability', 'timelessness', 'wordmarkHarmony', 'total', 'improvement'],
        properties: {
          id: { type: 'string' },
          distinctiveness: { type: 'number' },
          legislativeClarity: { type: 'number' },
          futurism: { type: 'number' },
          scalability: { type: 'number' },
          timelessness: { type: 'number' },
          wordmarkHarmony: { type: 'number' },
          total: { type: 'number' },
          improvement: { type: 'string', description: 'One concrete fix' },
        },
      },
    },
    bestId: { type: 'string' },
    summary: { type: 'string', description: '2-3 lines: which wins and why, plus what to graft from runners-up' },
  },
}
const panel = await parallel(
  ['A', 'B', 'C'].map((lens) => () =>
    agent(
      `You are logo judge #${lens}. Score EACH concept 0–10 on: distinctiveness, legislativeClarity, futurism, scalability (favicon/tiny), timelessness, wordmarkHarmony. total = sum. Be critical and decisive; pick a single bestId.\n\nConcepts (id · name · rationale · icon svg):\n${designs
        .map((d) => `#${d.id} ${d.name} — ${d.rationale}\nfont: ${d.fontFamily}\nicon: ${d.iconSvg}`)
        .join('\n\n')}`,
      { label: `judge:${lens}`, phase: 'Judge', schema: JUDGE_SCHEMA },
    ),
  ),
).then((r) => r.filter(Boolean))

// Tally total scores across judges.
const tally = {}
for (const j of panel) for (const s of j.scores ?? []) tally[s.id] = (tally[s.id] ?? 0) + (s.total ?? 0)
const ranking = Object.entries(tally).sort((a, b) => b[1] - a[1])
log(`Ranking: ${ranking.map(([id, t]) => `${id}:${t}`).join('  ')}`)

return { designs, panel, ranking }
