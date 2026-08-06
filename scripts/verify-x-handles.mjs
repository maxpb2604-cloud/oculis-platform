// Check whether supplied X handles resolve through the live X API and copy the
// API-reported metadata. Reachability does not prove the identity of an account;
// seed inclusion separately requires a primary-source evidence URL.
//
// Usage: node scripts/verify-x-handles.mjs <candidates.json> <out.json>
//   candidates.json: [{ name, handle, ... }, ...]
//   out.json: same objects + { found, xId, xName, followers, xVerified }
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')

function loadToken() {
  if (process.env.X_BEARER_TOKEN) return process.env.X_BEARER_TOKEN
  const env = resolve(ROOT, '.env')
  if (existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split('\n')) {
      const m = line.match(/^X_BEARER_TOKEN=(.*)$/)
      if (m) return m[1].trim()
    }
  }
  throw new Error('X_BEARER_TOKEN not found in env or app/.env')
}

const TOKEN = loadToken()
const inPath = process.argv[2]
const outPath = process.argv[3]
if (!inPath || !outPath) {
  console.error('usage: node verify-x-handles.mjs <candidates.json> <out.json>')
  process.exit(1)
}

const cands = JSON.parse(readFileSync(inPath, 'utf8'))
// Dedupe by lowercased handle, keep first.
const byHandle = new Map()
for (const c of cands) {
  const h = String(c.handle ?? '').replace(/^@/, '').trim()
  if (!h) continue
  const k = h.toLowerCase()
  if (!byHandle.has(k)) byHandle.set(k, { ...c, handle: h })
}
const all = [...byHandle.values()]
// X handles are 1–15 chars of [A-Za-z0-9_]. A single malformed handle 400s the
// whole batch, so set invalid ones aside (they're never real anyway).
const VALID = /^[A-Za-z0-9_]{1,15}$/
const list = all.filter((c) => VALID.test(c.handle))
const invalid = all.filter((c) => !VALID.test(c.handle))
console.error(`Checking ${list.length} valid handles (${invalid.length} skipped as malformed)…`)

async function api(usernames) {
  const url = `https://api.twitter.com/2/users/by?usernames=${usernames.join(',')}&user.fields=public_metrics,verified,name,username`
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    if (res.ok) return res.json()
    if (res.status === 429 && attempt < 4) {
      const reset = Number(res.headers.get('x-rate-limit-reset')) * 1000
      const wait = Math.min(Math.max(reset - Date.now(), 2000), 90_000) || 5000
      console.error(`  429 — waiting ${Math.round(wait / 1000)}s…`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    const body = await res.text()
    throw new Error(`X API ${res.status}: ${body.slice(0, 200)}`)
  }
}

const found = new Map() // lower handle -> data
for (let i = 0; i < list.length; i += 100) {
  const batch = list.slice(i, i + 100)
  const data = await api(batch.map((c) => c.handle))
  for (const u of data?.data ?? []) {
    found.set(String(u.username).toLowerCase(), {
      xId: u.id,
      xName: u.name,
      username: u.username,
      followers: u.public_metrics?.followers_count ?? 0,
      xVerified: !!u.verified,
    })
  }
  console.error(`  batch ${i / 100 + 1}: ${data?.data?.length ?? 0} found, ${data?.errors?.length ?? 0} missing`)
}

const enrich = (c) => {
  const f = found.get(c.handle.toLowerCase())
  return {
    ...c,
    handle: f?.username ?? c.handle, // normalize to the real casing
    found: !!f,
    xId: f?.xId ?? null,
    xName: f?.xName ?? null,
    followers: f?.followers ?? 0,
    xVerified: f?.xVerified ?? false,
  }
}
const out = [...list.map(enrich), ...invalid.map((c) => ({ ...c, found: false, xId: null, xName: null, followers: 0, xVerified: false }))]
const real = out.filter((c) => c.found)
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.error(`\n✔ ${real.length}/${list.length} handles resolved through the API. Wrote ${outPath}`)
// Quick summary to stdout.
console.log(JSON.stringify({ total: list.length, real: real.length, missing: list.length - real.length }))
