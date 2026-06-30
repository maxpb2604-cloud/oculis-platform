export const meta = {
  name: 'map-dr-political-accounts',
  description: 'Research the ~100 most relevant DR Congress/politics X accounts to add to the feed directory',
  phases: [
    { title: 'Research', detail: 'fan out candidate-account research by category' },
    { title: 'Critic', detail: 'find important accounts the first pass missed' },
  ],
}

// args: { senatorsA, senatorsB, existingHandles }
const senatorsA = args?.senatorsA ?? []
const senatorsB = args?.senatorsB ?? []
const existing = (args?.existingHandles ?? []).join(', ')

const CAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'handle', 'kind', 'rationale'],
        properties: {
          name: { type: 'string', description: 'Person/org real name' },
          handle: { type: 'string', description: 'Best-known X/Twitter handle WITHOUT the @ (exact spelling)' },
          kind: { type: 'string', enum: ['SENADO_OFFICIAL', 'SENATOR', 'DEPUTY', 'JOURNALIST', 'NEWSPAPER', 'INSTITUTION'] },
          chamber: { type: 'string', enum: ['SENADO', 'DIPUTADOS', ''] },
          rationale: { type: 'string', description: 'One line: who they are + why relevant to DR legislative monitoring' },
        },
      },
    },
  },
}

const RULES = `You are mapping the most relevant X (Twitter) accounts for monitoring the Dominican Republic's Congress (Senado + Cámara de Diputados), legislation, and national politics.
Rules:
- Return ONLY accounts you believe are REAL, currently-active X accounts. Give the EXACT handle spelling (without @). If unsure of the exact handle, give your single best guess — a downstream step verifies every handle against the live X API, so wrong guesses are dropped, but invented names are wasteful.
- Prefer official/verified accounts over fan/parody accounts.
- Use web search to confirm handles when you can.
- Do NOT include these already-present handles: ${existing}.
- DR context: parties are PRM (governing, Abinader), FP (Leonel Fernández), PLD (Danilo Medina), PRSC, PRD, PP (Pueblo Primero), etc.`

const CATEGORIES = [
  {
    key: 'senators-A',
    prompt: `${RULES}

Find the official X handle for EACH of these 16 sitting DR SENATORS (name | party | province). kind="SENATOR", chamber="SENADO". Use the person's real name as "name".
${senatorsA.map((s) => `- ${s}`).join('\n')}`,
  },
  {
    key: 'senators-B',
    prompt: `${RULES}

Find the official X handle for EACH of these 16 sitting DR SENATORS (name | party | province). kind="SENATOR", chamber="SENADO". Use the person's real name as "name".
${senatorsB.map((s) => `- ${s}`).join('\n')}`,
  },
  {
    key: 'deputy-leaders',
    prompt: `${RULES}

List the ~25 most relevant/active members of the Cámara de Diputados on X: the president of the chamber (Alfredo Pacheco), vice-presidents, secretaries, the spokespeople (voceros) of each party bloc (PRM, FP, PLD), commission presidents, and the most media-prominent deputies. kind="DEPUTY", chamber="DIPUTADOS".`,
  },
  {
    key: 'party-figures',
    prompt: `${RULES}

List ~20 top national political figures relevant to legislation who AREN'T already listed: party presidents & secretaries-general (PRM, FP, PLD, PRSC, PRD, PP), former presidents, presidential hopefuls, prominent ministers who drive legislative agendas, and influential party leaders. kind="INSTITUTION" for officials, or "JOURNALIST" only if they are commentators.`,
  },
  {
    key: 'institutions',
    prompt: `${RULES}

List ~22 DR GOVERNMENT/STATE institutions on X relevant to legislation & oversight: ministries (Hacienda, Economía, Interior y Policía, Educación, Salud, Medio Ambiente, Trabajo, Obras Públicas, Energía y Minas, Agricultura), constitutional bodies (Tribunal Constitucional, Suprema Corte, Tribunal Superior Electoral, Cámara de Cuentas, Defensor del Pueblo, Contraloría), and key agencies (DGII, DGA, Pro Consumidor, INDOTEL, Superintendencias). kind="INSTITUTION".`,
  },
  {
    key: 'journalists',
    prompt: `${RULES}

List ~25 prominent DR POLITICAL JOURNALISTS / TV-radio anchors / opinion columnists / investigative reporters active on X who cover Congress & politics (beyond Nuria Piera, Marino Zapete, Altagracia Salazar, Huchi Lora, Edith Febles, Julio Martínez Pozo who are already listed). kind="JOURNALIST".`,
  },
  {
    key: 'media',
    prompt: `${RULES}

List ~25 DR MEDIA accounts on X relevant to politics that AREN'T already listed: TV channels, news programs / political talk shows (e.g. El Sol de la Mañana, Esto No Tiene Nombre, Uno+Uno, Enfoque Matinal), radio stations, and digital news outlets. kind="NEWSPAPER".`,
  },
  {
    key: 'analysts-civil',
    prompt: `${RULES}

List ~20 DR accounts in POLITICAL ANALYSIS & CIVIL SOCIETY relevant to legislation: pollsters (Gallup-Hoy, Greenberg, Mark Penn), think tanks & NGOs (FINJUS, Participación Ciudadana, ANJE, CONEP, OPD-Funglode, Fundación Institucionalidad y Justicia), constitutional/legal analysts, economists, and academics who comment on policy. kind="INSTITUTION" for orgs, "JOURNALIST" for individual analysts.`,
  },
]

phase('Research')
const rounds = await parallel(
  CATEGORIES.map((c) => () =>
    agent(c.prompt, { label: `research:${c.key}`, phase: 'Research', schema: CAND_SCHEMA }).then(
      (r) => (r?.candidates ?? []).map((x) => ({ ...x, _cat: c.key })),
    ),
  ),
)

// Merge + dedupe by handle (case-insensitive), drop empties.
const seen = new Set((args?.existingHandles ?? []).map((h) => h.replace(/^@/, '').toLowerCase()))
const merged = []
for (const list of rounds) {
  if (!list) continue
  for (const c of list) {
    const h = String(c.handle ?? '').replace(/^@/, '').trim()
    if (!h) continue
    const key = h.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ ...c, handle: h })
  }
}
log(`Research produced ${merged.length} unique candidate handles`)

phase('Critic')
const critic = await agent(
  `${RULES}

Here is the candidate list gathered so far (name — handle — category). Identify IMPORTANT, clearly-relevant DR Congress/politics X accounts that are MISSING (any category: senators without a handle yet, major deputies, key institutions, top journalists/media, influential analysts). Return up to 30 ADDITIONAL real accounts not already in this list or these handles: ${existing}.

Current candidates:
${merged.map((c) => `${c.name} — @${c.handle} — ${c._cat}`).join('\n')}`,
  { label: 'critic:gaps', phase: 'Critic', schema: CAND_SCHEMA },
)
for (const c of critic?.candidates ?? []) {
  const h = String(c.handle ?? '').replace(/^@/, '').trim()
  if (!h || seen.has(h.toLowerCase())) continue
  seen.add(h.toLowerCase())
  merged.push({ ...c, handle: h, _cat: 'critic' })
}
log(`After critic: ${merged.length} unique candidates`)

return { candidates: merged }
