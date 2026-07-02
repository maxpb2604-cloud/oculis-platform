// Assemble a live logo gallery (public/brand/logos.html) from the design-workflow
// result plus a hand-crafted "house" concept. Shows every lockup + icon on light
// and dark, favicon sizes, the futuristic wordmark, rationale and judge score.
//
// Usage: node scripts/build-logo-gallery.mjs <workflow-result.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const OUT = resolve(ROOT, 'apps/web/public/brand/logos.html')

const resPath = process.argv[2]
let designs = [], ranking = [], _panel = []
if (resPath) {
  const d = JSON.parse(readFileSync(resPath, 'utf8'))
  const r = d.result ?? d
  designs = r.designs ?? []
  ranking = r.ranking ?? []
  _panel = r.panel ?? []
}
const scoreOf = (id) => (ranking.find(([rid]) => rid === id) ?? [undefined, null])[1]
const bestId = ranking[0]?.[0]

// ---- Hand-crafted "house" concept: refined dome + integrated pulse ----
const HOUSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <circle cx="32" cy="9" r="2.2" fill="#0E2A47"/>
  <g stroke="#0E2A47" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="32" y1="11.2" x2="32" y2="15"/>
    <path d="M17 31 A15 15 0 0 1 47 31"/>
    <path d="M25.5 31 A8 12 0 0 1 38.5 31" opacity="0.5"/>
    <line x1="15" y1="34.5" x2="49" y2="34.5"/>
    <line x1="21" y1="37" x2="21" y2="45"/>
    <line x1="26.5" y1="37" x2="26.5" y2="45"/>
    <line x1="37.5" y1="37" x2="37.5" y2="45"/>
    <line x1="43" y1="37" x2="43" y2="45"/>
  </g>
  <path d="M11 49 H24 l3 -7 4 15 3.2 -8 H53" fill="none" stroke="#1E7FC0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="31" cy="42" r="1.7" fill="#38BDF8"/>
</svg>`
const HOUSE_LOCKUP = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="96" viewBox="0 0 340 96" fill="none">
  <g transform="translate(6,16)">
    <circle cx="32" cy="9" r="2.2" fill="var(--ink)"/>
    <g stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <line x1="32" y1="11.2" x2="32" y2="15"/>
      <path d="M17 31 A15 15 0 0 1 47 31"/>
      <path d="M25.5 31 A8 12 0 0 1 38.5 31" opacity="0.5"/>
      <line x1="15" y1="34.5" x2="49" y2="34.5"/>
      <line x1="21" y1="37" x2="21" y2="45"/><line x1="26.5" y1="37" x2="26.5" y2="45"/>
      <line x1="37.5" y1="37" x2="37.5" y2="45"/><line x1="43" y1="37" x2="43" y2="45"/>
    </g>
    <path d="M11 49 H24 l3 -7 4 15 3.2 -8 H53" fill="none" stroke="#1E7FC0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="31" cy="42" r="1.7" fill="#38BDF8"/>
  </g>
  <text x="92" y="50" font-family="'Space Grotesk',sans-serif" font-size="35" font-weight="600" letter-spacing="-1" fill="var(--ink)">Pulso</text>
  <text x="93" y="70" font-family="'Space Grotesk',sans-serif" font-size="13.5" font-weight="500" letter-spacing="5.5" fill="#1565A8">LEGISLATIVO</text>
</svg>`

const HOUSE = {
  id: 'H',
  name: 'Cúpula + pulso (casa)',
  fontFamily: 'Space Grotesk',
  iconSvg: HOUSE_ICON,
  lockupSvg: HOUSE_LOCKUP,
  rationale: 'Versión clásica afinada: cúpula y pórtico legibles, el pulso corre como línea base y un punto cian aporta el acento "inteligencia". Wordmark geométrico Space Grotesk.',
  house: true,
}

// ---- Recommended SYNTHESIS: the panel winner (D "Cúpula Radiante") refined by
//      grafting F's explicit dome+colonnade (fixes the "rainbow/wifi" read) and
//      E's clean Space Grotesk wordmark. Radiating signal-arc dome = intelligence,
//      colonnade = Congress, pulse baseline = "pulso". Self-contained badge = favicon-safe.
const WIN_MARK = `
  <rect x="4" y="4" width="56" height="56" rx="15" fill="#0E2A47"/>
  <circle cx="32" cy="12.5" r="2.4" fill="#38BDF8"/>
  <g stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="32" y1="15" x2="32" y2="20" stroke="#FFFFFF" stroke-width="3"/>
    <path d="M14 39 A18 18 0 0 1 50 39" stroke="#FFFFFF" stroke-width="3.2"/>
    <path d="M20 39 A12 12 0 0 1 44 39" stroke="#1E7FC0" stroke-width="3.2"/>
    <path d="M26 39 A6 6 0 0 1 38 39" stroke="#38BDF8" stroke-width="3"/>
  </g>
  <rect x="12" y="39" width="40" height="3" rx="1.5" fill="#FFFFFF"/>
  <g stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round">
    <line x1="17.5" y1="44" x2="17.5" y2="49"/><line x1="24.75" y1="44" x2="24.75" y2="49"/>
    <line x1="32" y1="44" x2="32" y2="49"/><line x1="39.25" y1="44" x2="39.25" y2="49"/>
    <line x1="46.5" y1="44" x2="46.5" y2="49"/>
  </g>
  <path d="M8 52 H24 l2.5 -4 l3 8 l2.5 -5 H56" fill="none" stroke="#1E7FC0" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="26.5" cy="48" r="1.5" fill="#38BDF8"/>`
const WINNER = {
  id: '★',
  name: 'Cúpula Radiante+ (síntesis recomendada)',
  fontFamily: 'Space Grotesk',
  iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">${WIN_MARK}</svg>`,
  lockupSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="96" viewBox="0 0 340 96" fill="none">
    <g transform="translate(8,16)">${WIN_MARK}</g>
    <text x="96" y="52" font-family="'Space Grotesk',sans-serif" font-size="35" font-weight="700" letter-spacing="-0.5" fill="var(--ink)">Pulso</text>
    <text x="97" y="72" font-family="'Space Grotesk',sans-serif" font-size="13" font-weight="600" letter-spacing="5" fill="#1E7FC0">LEGISLATIVO</text>
  </svg>`,
  rationale: 'Ganador del panel (D) refinado: cúpula de arcos-señal (inteligencia/datos) + faro cian, columnata explícita (Congreso, corrige el "arcoíris/wifi") y pulso EKG como cimiento. Placa navy autocontenida → nítida de favicon a app-icon. Wordmark Space Grotesk.',
  recommended: true,
}

const all = [WINNER, HOUSE, ...designs]
// Agent wordmarks hardcode ink fill; remap <text> ink to a theme var so it flips on dark.
const themeText = (svg) => svg.replace(/(<text\b[^>]*?)fill="#0E2A47"/g, '$1fill="var(--ink)"')

// Inject a theme var so lockup <text>/ink flips on dark cards. Each design's ink
// is remapped to currentColor-like via a wrapping .swatch that sets --ink.
const card = (d) => {
  const score = scoreOf(d.id)
  const panelWin = d.id === bestId
  const lock = themeText(d.lockupSvg)
  return `
  <section class="card ${d.recommended ? 'recommended' : ''} ${panelWin ? 'winner' : ''} ${d.house ? 'house' : ''}">
    <header>
      <span class="tag">${d.recommended ? '★' : d.house ? 'CASA' : d.id}</span>
      <h2>${d.name}</h2>
      ${d.recommended ? '<span class="badge rec">Recomendado · síntesis D+F+E</span>' : ''}
      ${panelWin ? '<span class="badge">★ Ganador del panel</span>' : ''}
      ${score != null ? `<span class="score">${score} pts</span>` : ''}
      <span class="font">${d.fontFamily}</span>
    </header>
    <div class="grid">
      <div class="swatch light lock">${lock}</div>
      <div class="swatch light ico">${d.iconSvg}</div>
      <div class="swatch dark lock">${lock}</div>
      <div class="swatch dark ico">${d.iconSvg}</div>
    </div>
    <div class="favrow">
      <span>favicon:</span>
      <div class="fav" style="width:48px;height:48px">${d.iconSvg}</div>
      <div class="fav" style="width:32px;height:32px">${d.iconSvg}</div>
      <div class="fav" style="width:16px;height:16px">${d.iconSvg}</div>
    </div>
    <p class="rat">${d.rationale ?? ''}</p>
  </section>`
}

const html = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulso Legislativo — conceptos de logo</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Sora:wght@400;600;700&family=Chakra+Petch:wght@500;600;700&family=Michroma&family=Exo+2:wght@500;600;700&family=Rajdhani:wght@500;600;700&family=Sarpanch:wght@600;700&family=Orbitron:wght@600;700&display=swap" rel="stylesheet">
<style>
  :root{--ink:#0E2A47;--paper:#fff;--navy:#0A1F36;--blue:#1565A8;}
  *{box-sizing:border-box}
  body{margin:0;background:#eef1f4;color:#0E2A47;font-family:'Space Grotesk',system-ui,sans-serif;padding:32px}
  .head{max-width:1100px;margin:0 auto 28px}
  .head h1{font-size:30px;margin:0 0 4px;letter-spacing:-.5px}
  .head p{margin:0;color:#5C6B63;font-size:14px}
  .wrap{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:22px}
  .card{background:#fff;border:1px solid #dde3ea;border-radius:16px;padding:18px;box-shadow:0 6px 24px -18px rgba(16,32,26,.35)}
  .card.winner{border-color:#9fc4e4}
  .card.recommended{border-color:#1E7FC0;box-shadow:0 0 0 2px #1E7FC0, 0 10px 34px -14px rgba(30,127,192,.55);grid-column:1/-1}
  .card.recommended .grid{grid-auto-rows:120px}
  .card.house{background:linear-gradient(180deg,#fff,#f7fbff)}
  .badge.rec{background:#1E7FC0;color:#fff}
  header{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
  .tag{background:#0E2A47;color:#fff;font-size:12px;font-weight:700;border-radius:7px;padding:3px 9px}
  header h2{font-size:17px;margin:0;flex:0 1 auto}
  .badge{background:#e7f1fa;color:#1565A8;font-size:11px;font-weight:700;border-radius:20px;padding:3px 10px}
  .score{margin-left:auto;font-size:12px;color:#5C6B63;font-weight:600}
  .font{font-size:11px;color:#8a988f;width:100%;}
  .grid{display:grid;grid-template-columns:1fr 88px;grid-auto-rows:96px;gap:10px}
  .swatch{border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px}
  .swatch.light{background:#fff;border:1px solid #e6eaef;--ink:#0E2A47}
  .swatch.dark{background:#0A1F36;--ink:#eaf1f8}
  .swatch svg{max-width:100%;max-height:100%;height:auto}
  .favrow{display:flex;align-items:center;gap:12px;margin-top:14px;color:#5C6B63;font-size:12px}
  .favrow .fav{--ink:#0E2A47;display:flex;align-items:center;justify-content:center}
  .favrow .fav svg{width:100%;height:100%}
  .rat{margin:12px 0 0;font-size:12.5px;line-height:1.5;color:#43515a}
  @media(max-width:820px){.wrap{grid-template-columns:1fr}}
</style></head>
<body>
  <div class="head">
    <h1>Pulso Legislativo — conceptos de logo</h1>
    <p>Cúpula + pulso, más inteligente y futurista. ${designs.length} conceptos de agentes + 1 versión casa, evaluados por un panel. Cada tarjeta: lockup y símbolo en claro/oscuro, tamaños favicon (48/32/16), y tipografía.</p>
  </div>
  <div class="wrap">
    ${all.map(card).join('\n')}
  </div>
</body></html>`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, html)
console.log('wrote', OUT, '—', all.length, 'concepts; winner:', bestId ?? '(n/a)')
