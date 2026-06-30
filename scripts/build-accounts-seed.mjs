// Rank verified accounts by relevance (role base + follower reach) and emit the
// top-N as TypeScript SeedAccount entries to splice into feed-accounts.seed.ts.
//
// Usage: node scripts/build-accounts-seed.mjs <verified.json> [limit=100] [startRank=50]
import { readFileSync } from 'node:fs'

const inPath = process.argv[2]
const LIMIT = Number(process.argv[3] ?? 100)
const START_RANK = Number(process.argv[4] ?? 50)
const excludePath = process.argv[5] // optional JSON array of existing "@handle" to skip
if (!inPath) {
  console.error('usage: node build-accounts-seed.mjs <verified.json> [limit] [startRank] [excludeHandles.json]')
  process.exit(1)
}
const EXCLUDE = new Set(
  (excludePath ? JSON.parse(readFileSync(excludePath, 'utf8')) : []).map((h) =>
    String(h).replace(/^@/, '').toLowerCase(),
  ),
)

// Handles that verified as REAL but resolve to the WRONG entity (a different
// person/brand than intended) — found during name-match review.
const BLOCK = new Set(['escupolara01', 'teleantillas', 'brendaogando'])
const rows = JSON.parse(readFileSync(inPath, 'utf8')).filter(
  (r) =>
    r.found &&
    !BLOCK.has(String(r.handle).toLowerCase()) &&
    !EXCLUDE.has(String(r.handle).toLowerCase()), // already in the curated seed
)

// Relevance = role weight + reach (log10 followers). Legislators/state bodies are
// inherently relevant to Congress monitoring; reach breaks ties and lets a very
// influential journalist/outlet outrank a low-profile back-bencher.
const ROLE_BASE = {
  SENADO_OFFICIAL: 7,
  SENATOR: 6,
  INSTITUTION: 5.5,
  DEPUTY: 5,
  JOURNALIST: 4.5,
  NEWSPAPER: 4,
}
const score = (r) => (ROLE_BASE[r.kind] ?? 4) + Math.log10((r.followers ?? 0) + 1)

// Selection: sitting legislators + the Senate official account are the CORE
// subject of a Congress monitor — always include them. Fill the rest of the
// LIMIT with the highest-relevance institutions / press / analysts by score.
const scored = rows.map((r) => ({ ...r, _score: score(r) })).sort((a, b) => b._score - a._score)
const CORE_KINDS = new Set(['SENATOR', 'DEPUTY', 'SENADO_OFFICIAL'])
const core = scored.filter((r) => CORE_KINDS.has(r.kind))
const rest = scored.filter((r) => !CORE_KINDS.has(r.kind))
const ranked = [...core, ...rest.slice(0, Math.max(0, LIMIT - core.length))].sort(
  (a, b) => b._score - a._score,
)

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const chamberOf = (r) =>
  r.chamber === 'SENADO' || r.kind === 'SENATOR'
    ? 'SENADO'
    : r.chamber === 'DIPUTADOS' || r.kind === 'DEPUTY'
      ? 'DIPUTADOS'
      : null

const lines = ranked.map((r, i) => {
  const rank = START_RANK + i
  const ch = chamberOf(r)
  const chamber = ch ? `, chamber: "${ch}"` : ''
  return `  { name: "${esc(r.name)}", handle: "@${r.handle}", platform: "X", url: x("${r.handle}"), kind: "${r.kind}"${chamber}, rank: ${rank} },`
})

// Summary to stderr; TS array body to stdout.
const byKind = {}
for (const r of ranked) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
console.error(`Selected ${ranked.length} of ${rows.length} verified accounts.`)
console.error('By kind:', JSON.stringify(byKind))
console.error('Top 10:', ranked.slice(0, 10).map((r) => `@${r.handle}(${Math.round(r.followers / 1000)}k)`).join(', '))
console.log(lines.join('\n'))
