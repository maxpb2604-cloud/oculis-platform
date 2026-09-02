# Oculis reconstruction — design QA

## Outcome

The selected editorial-intelligence direction has been implemented across the customer experience without modifying either Oculis logo asset.

- Reference: `work/design-reconstruction/selected-editorial-briefing.png` (1487 × 1058).
- Implementation comparison: `work/design-reconstruction/design-comparison-integrated-pass2.png`.
- Focused comparison: `work/design-reconstruction/design-comparison-integrated-pass2-focus.png`.
- Visual state: Spanish, light theme, 28 August 2026, local production data.
- Reference normalization: the 1487 × 1058 source was resampled to the 1472 × 1047 captured implementation before side-by-side review.

## Visual comparison history

1. Pass 1 found one P2 mismatch: the implementation heading wrapped to two lines while the selected direction held it on one.
2. The display scale and title measure were tightened without altering the content hierarchy.
3. Pass 2 aligned the headline, lead evidence, next-agenda rail, recent-change rhythm, navy navigation rail, hairlines, typography and spacing. The exact Oculis logo intentionally differs from the generated reference's approximation because the production brand asset was preserved as explicitly required.
4. No P0, P1 or P2 visual mismatch remained after the second comparison.

## Customer journey QA

The following production routes returned HTTP 200 and were inspected in desktop and/or 390 × 844 mobile states:

- Inicio: `/`
- Cambios oficiales: `/feed`
- Agenda: `/hoy`
- Agenda exacta: `/agenda/4`
- Investigación: `/initiatives`
- Ficha de iniciativa: `/initiatives/3364`
- Actores: `/congreso`
- Cámaras: `/diputados`, `/senado`
- Regulación: `/regulatorio`
- Consultas: `/regulatorio/consultas`
- Fuentes y actualización: `/estado-fuentes`

Verified interactions include global initiative search, chamber and date persistence in URLs, agenda back-navigation, initiative filters and reset, copy feedback, mobile navigation, exact commission-to-agenda links, exact guarded official PDFs and external evidence links.

## Link integrity

- Agenda 4 resolves to the exact daily official file: WPFD category 2245, file 28988; the underlying source returned `application/pdf`.
- The Contratos meeting resolves to `/agenda/627` and exact WPFD file 28997.
- A verified initiative document resolves through the guarded route and opens official `documentoId=240150`.
- 129 external-link instances / 87 unique URLs across Regulation, Consultations and Sources returned HTTP 200 or 206.
- Every customer-facing external link announces that it opens in a new tab.
- Contextual media are labelled as context, never as official legislative evidence.

## Responsive and accessibility QA

- No horizontal overflow remained on the audited desktop or 390 × 844 routes.
- Each route has one `h1` and coherent section headings.
- The skip link now transfers keyboard focus to `main#main-content`.
- Tabs, filters, pagination, copy feedback, disclosures and mobile navigation expose their state.
- Regulatory document actions and source disclosures have 44 px physical targets.
- Repeated actions use contextual accessible names.
- Extension-injected Grammarly attributes caused the only observed development hydration notice; production logs showed no Oculis error.

## Code and release QA

- Production build: Next.js 15.5.24 — passed.
- Tests: 322 passed; 6 live tests intentionally skipped.
  - Core 12
  - Database 61
  - Scrapers 116
  - Web 74
  - Worker 59
- Typecheck, ESLint, factual-data policy and `git diff --check`: passed.
- Production dependency audit: 0 vulnerabilities.
- Shared first-load JavaScript: 104 kB.
- Main production route first-load JavaScript: 129–142 kB, except the analytics-rich home route at 228 kB.
- Initiative catalog HTML was reduced from approximately 1.17 MB in development to a single responsive result tree; compressed production transfer measured approximately 79 kB.

## Data refresh completed

- 75 regulatory instruments and 17 deduplicated public consultations are present locally.
- 2,658 of 2,660 Senate initiatives retain a verified official Ficha snapshot.
- 2,683 official document-content snapshots are stored for exact availability checks.
- Three Senate titles remain literal/incomplete because the upstream evidence is unavailable, conflicting or itself truncated; Oculis does not invent the missing text.
- MISPAS remains an explicit known TLS source gap.

## Brand lock

- `oculis-lockup.png`: `47250c7c39fc314373bed8a57a8197fb2ddfde4bb3281e493542ba32b14c6703`
- `oculis-mark.png`: `3175f8ff1445f5c2a8ae24dca171b564bc7e41135e392458baace59d80cd3a8e`

Both hashes match the pre-reconstruction assets.

## HOME — Congreso por provincia

This pass implements only the first user-approved HOME observation. The Oculis logo and the remaining HOME briefing were left intact.

- Canonical source: Montalvo `origin/main` at commit `7e1d5dbefe9bb4bc219a7ddb1c47b9858795a040`.
- Reference state: Puerto Plata selected in `work/montalvo-reference/montalvo-landing-prototype/design-sources/qa/province-glass-desktop-1439x876-final.jpg`.
- Implementation state: Puerto Plata selected in Chrome at 1728 × 958.
- Same-state side-by-side comparison: `work/home-map-qa/comparison-desktop-final.jpg`.
- Chrome mobile captures: `work/home-map-qa/home-map-mobile-390x844-cropped.jpg` and `work/home-map-qa/home-map-mobile-panel-390x844-cropped.jpg`.

### Visual and interaction result

- The 32 source province polygons render as real extruded Three.js geometry; the selected province rises physically and receives the Oculis blue accent, while hover remains subordinate.
- The Montalvo interaction grammar is preserved: map selection, synchronized province caption, province rail and a persistent glass detail surface beneath the map.
- The detail surface uses Oculis data instead of Montalvo projects: bounded recent initiative links, the complete source-backed senator/deputy roster and explicit initiative/legislator counts.
- Desktop selection was verified on Puerto Plata (`150` initiatives, `1` senator, `6` deputies), and each visible initiative resolves to an internal `/initiatives/:id` route.
- Chrome responsive mode at 390 × 844 showed the intended mobile stack, compact map, horizontally scrollable province rail, two-column metrics and one-column initiative list without visible horizontal page overflow.
- Chrome DevTools reported `0 messages in console` after desktop and mobile interaction.
- Accessible names expose all 32 province choices and their counts; the selected tab, controlled panel and live province content remain synchronized.

### Factual safeguards

- Initiatives are attributed only when the official record publishes the represented province of the principal sponsor; the interface explicitly says this is not the territorial scope of the bill.
- Missing province data is never inferred from a name, title or legislator match.
- The HOME query is bounded per province and excludes initiatives with no published province.
- The official `Montecristi` spelling is reconciled with the map label `Monte Cristi`.
- National representation remains outside the territorial map instead of being attributed to Distrito Nacional.

### Verification

- Web typecheck: passed.
- Database typecheck: passed.
- Web tests: 75/75 passed.
- Database tests: 62/62 passed.
- ESLint, factual-policy check, targeted Prettier check and `git diff --check`: passed.
- Production build had already passed with Next.js 15.5.24 after this implementation.

No P0 or P1 issue remains in this scoped HOME map pass. The bubble intentionally shows the six most recent initiatives while the province total visualizes the complete observed corpus; a full province-filtered catalog can be considered as a later, separately approved HOME observation.

## Tablero inicial — annotated map corrections

This pass implements only the four screenshot-scoped corrections received on 28 August 2026.

### Visual truth and normalization

- Source 1: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_QKy6Kr/Screenshot 2026-08-28 at 3.19.10 PM.png` (`650 × 186` px), identifying the legend to remove.
- Source 2: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_WaQQeX/Screenshot 2026-08-28 at 3.20.12 PM.png` (`2356 × 594` px), identifying province enumeration and ambiguous counts.
- Source 3: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_9Fb7hj/Screenshot 2026-08-28 at 3.22.07 PM.png` (`1124 × 274` px), identifying the map title to replace.
- Desktop implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/home-scoped-qa/01-desktop-updated.png` (`1713 × 894` px), Chrome CSS viewport `1728 × 894`, device density `1`.
- Focused province implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/home-scoped-qa/02-province-counts-updated.png` (`1713 × 894` px), same viewport/state.
- Mobile implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/home-scoped-qa/03-mobile-updated.png`, Chrome CSS viewport `390 × 844`, device density `1`.
- Combined comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/home-scoped-qa/comparison-scoped-final.png` (`1440 × 800` px). Source and implementation regions were scaled proportionally into equal-width comparison cells; no design judgment relies on browser chrome.
- State: Spanish, light theme, Santo Domingo selected, local production data.

### Findings and comparison result

- No P0, P1 or P2 mismatch remains.
- The “Menos iniciativas / Más iniciativas” legend is absent from the map and the DOM.
- The 01–32 circular enumeration is absent; all 32 province tabs remain keyboard-operable.
- Every province tab now spells out total initiatives, source-literal active initiatives and members of Congress. Santo Domingo renders `640 iniciativas · 251 vigentes · 43 congresistas`.
- “Vigentes” is calculated only when the source's official `condition` field equals `VIGENTE` after whitespace/case normalization. It is not inferred from procedural status, activity or missing data.
- The section title is “Mapa Oculis”. The route title, `h1`, sidebar item and browser metadata are “Tablero inicial” in Spanish and “Main Dashboard” in English.

### Required fidelity surfaces

- Typography: existing Oculis serif/sans hierarchy, optical weights and line heights remain intact; the longer explicit counts wrap inside the province cards without truncation.
- Spacing and layout: removing the number badge gives the province names and counts the full card width; desktop remains an eight-column rail and mobile remains a horizontal rail. No horizontal page overflow was measured at `390 × 844`.
- Colors and tokens: the Oculis palette, selected state, shadows and glass surface are unchanged; only the requested legend was removed.
- Image and asset fidelity: the original Oculis logo and the canonical Montalvo-derived province geometry remain unchanged and sharp. No replacement or generated approximation was introduced.
- Copy and content: labels are explicit in Spanish and English; the visible methodology defines the factual meaning and limitations of “vigentes”.

### Interaction and release verification

- Chrome: 32 province tabs, synchronized selected state, zero console errors.
- Desktop: title, map, province counts and selected-province metrics render without overflow.
- Mobile: `390 × 844`, no horizontal page overflow; two-column metrics and one-column initiative results remain readable.
- Web typecheck: passed.
- Database typecheck: passed.
- Web tests: 75/75 passed.
- Database tests: 63/63 passed.
- ESLint, Prettier and `git diff --check`: passed.
- Production build: Next.js 15.5.24 passed.

## Tablero inicial — últimas iniciativas depositadas por provincia

This pass implements only the screenshot-scoped initiative-list correction received on 28 August 2026.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_8qyHLA/Screenshot 2026-08-28 at 3.26.35 PM.png` (`910 × 1536` px), a focused crop of the province initiative column.
- Browser-rendered implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-deposited-qa/santo-domingo-five-and-cta-light.png` (`1713 × 1289` px), Chrome CSS viewport `1728 × 1300`, device density `1`.
- Focused side-by-side comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-deposited-qa/source-vs-implementation.png` (`1000 × 1120` px). Both initiative columns were normalized to equal width before comparison.
- Mobile browser evidence: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-deposited-qa/home-mobile-full.png` (`375 × 6964` px), Chrome CSS viewport `390 × 844`; focused crop at `santo-domingo-five-mobile-crop.png`.
- State: Spanish, light theme, Santo Domingo selected, local production data.
- The provided source is a component crop rather than a complete page. Full-view comparison therefore verifies preservation through the implementation screenshot; focused fidelity is judged from the combined source/implementation input.

### Findings and comparison history

- The first post-build comparison found no actionable P0, P1 or P2 mismatch in the preserved typography, list rhythm, metadata, dividers, numbering or internal arrow affordances.
- The requested product changes are intentional differences: the heading now identifies the five latest deposited initiatives, the counter uses the deposited subset (`5 de 42` for Santo Domingo), and a full-width destination appears after the fifth row.
- The new destination uses the existing Oculis control language and does not alter the Senate or Chamber roster columns.
- No corrective visual loop was required after the first comparison.

### Required fidelity surfaces

- Typography: the existing Oculis sans hierarchy, uppercase section label, code styling, weights, line heights and title wrapping remain consistent with the source.
- Spacing and layout: five rows preserve the original grid and divider rhythm; the new 44 px-minimum CTA follows the list with the same card radius and border system. Desktop and mobile have no horizontal page overflow.
- Colors and tokens: the CTA uses existing accent, accent-soft, border and focus tokens in both light and dark themes.
- Image and asset fidelity: this block has no raster content; the original Oculis logo and province-map assets are unchanged.
- Copy and content: every visible row is source-reported `Depositado`; copy names the subset and province plainly in Spanish and English.

### Data, interaction and release verification

- Santo Domingo renders exactly five rows, ordered by `filedAt DESC NULLS LAST, id DESC`; all five visible metadata lines say `Depositado`.
- The visible count is `Mostrando las últimas 5 de 42 depositadas`.
- `Ver todas las iniciativas depositadas de Santo Domingo` opens `/initiatives?province=Santo+Domingo&status=Depositado`.
- The destination renders `42 iniciativas`, shows both removable filters, preserves them through reload/pagination and keeps `Nacional` separate from Distrito Nacional.
- Known source spellings for Baoruco/Bahoruco, Monte Cristi/Montecristi and Distrito Nacional/Santo Domingo de Guzmán are reconciled without broader geographic inference.
- Mobile CTA measured `253 × 50.375` CSS px; document width measured `375` within a `390` px viewport.
- Chrome rendered both routes without an application error alert or Next error overlay; the production server emitted no runtime error during the interaction.
- Production build: passed on Next.js `15.5.24`.
- Tests: `333` passed (`12` core, `66` database, `116` scrapers, `80` web, `59` worker); `6` live scraper tests intentionally skipped.
- Workspace typecheck, ESLint, factual-policy check and `git diff --check`: passed.

## Tablero inicial — columnas provinciales desplegables

This pass implements only the interaction correction received on 28 August 2026: the three existing province-detail columns now begin title-only and reveal their original content on demand.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_MgXIAT/Screenshot 2026-08-28 at 3.28.17 PM.png` (`2266 × 376` px), showing the exact three-column region before the requested collapsed interaction.
- Desktop collapsed implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-detail-accordion-qa/01-columnas-cerradas-1440x1000.png` (`1425 × 990` px), Chrome CSS viewport `1440 × 1000`, density `1`.
- Desktop expanded implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-detail-accordion-qa/02-iniciativas-abiertas-1440x1000.png` (`1425 × 990` px), same viewport and state with initiatives expanded.
- Mobile collapsed implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-detail-accordion-qa/03-columnas-cerradas-390x844.png` (`375 × 812` px), Chrome CSS viewport `390 × 844`, density `1`.
- Mobile expanded implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-detail-accordion-qa/04-iniciativas-abiertas-390x844.png` (`375 × 812` px), same viewport with initiatives expanded.
- Combined focused comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-detail-accordion-qa/05-comparacion-fuente-implementacion.png` (`1424 × 472` px). The `2266 × 376` source was proportionally normalized to `1424` px wide; the implementation region was cropped from the browser evidence and centered without stretching.
- State: Spanish, light theme, Santo Domingo selected, local production data. The source intentionally shows the prior expanded state; the implementation comparison shows the new user-requested title-only default directly below it.

### Findings and comparison history

- The first combined comparison found no actionable P0, P1 or P2 difference outside the intentional interaction change.
- The three existing column tracks, card radii, borders, uppercase title treatment, counters and Oculis color system are preserved.
- All three cards now begin closed and show only title, count and a Phosphor caret. Opening one reveals its content inside that same column and closes any previously opened card; selecting it again closes it.
- No visual correction loop was required after the first comparison.

### Required fidelity surfaces

- Typography: the existing Oculis sans hierarchy, uppercase labels, weights, letter spacing and line heights remain intact; long labels wrap without truncation.
- Spacing and layout: desktop retains the original three-column footprint with top-aligned collapsed cards; tablet retains the existing two-column breakpoint and mobile stacks the three 44 px-minimum controls. No horizontal overflow was measured at `390 × 844` (`375` px document width inside a `390` px viewport).
- Colors and visual tokens: hover, expanded, focus, borders and caret use the existing Oculis accent and surface tokens in place of new styling.
- Image quality and asset fidelity: no raster, map or logo asset was changed; the original Oculis logo and Montalvo-derived province geometry remain untouched.
- Copy and content: titles and counts are unchanged in meaning; verbose initiative metadata moved inside the expanded body, while all five deposited initiatives and the complete-list CTA remain available.

### Interaction, accessibility and release verification

- Initial state: all three `aria-expanded=false`; collapsed links are absent from the accessible/keyboard-visible content.
- Single-select disclosure: state sequence verified as initiatives `[true,false,false]`, Senate `[false,true,false]`, deputies `[false,false,true]`, then `[false,false,false]` on second click.
- Content checks: initiatives exposes exactly five initiative links plus the province-specific “Ver todas” destination; Senate and Chamber expose their expected people.
- Keyboard: Enter opens and Space closes; native button behavior is retained. Each control has `aria-expanded`, `aria-controls`, a labeled region, visible focus and at least 44 px height.
- Province change: switching from Santo Domingo to Azua resets all three controls to closed without carrying or flashing old content.
- English: “Latest filed initiatives”, “Senate of the Republic” and “Chamber of Deputies” render closed with their correct counts.
- Production build: passed on Next.js `15.5.24`.
- Web typecheck, ESLint, Prettier and all `80` web tests passed for the implementation files.

## Tablero inicial — burbuja de perfil de congresista

This pass implements only the interaction requested on 28 August 2026: each senator or deputy name in the province columns now opens that exact person's public profile in an Oculis dialog.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_WXDQ1F/Screenshot 2026-08-28 at 3.30.19 PM.png` (`1310 × 1432` px), showing the exact Senate and Chamber name lists before they became interactive.
- Desktop profile implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-legislator-profile-qa/06-perfil-brailyn-santiago-final.png` (`1440 × 1000` px), Chrome CSS viewport `1440 × 1000`, device density `1`.
- Desktop clickable-name implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-legislator-profile-qa/07-nombres-clicables-santiago.png` (`1440 × 1000` px), same viewport with Santiago selected and the Chamber column expanded.
- Mobile profile implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-legislator-profile-qa/03-perfil-diputado-390x844-final.png` (`390 × 844` px), Chrome CSS viewport `390 × 844`, device density `1`.
- Full comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-legislator-profile-qa/08-comparacion-fuente-perfil.png` (`2000 × 1000` px), with the source crop and rendered profile placed together and proportionally scaled without stretching.
- Focused comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-legislator-profile-qa/09-comparacion-nombres-clicables.png` (`1400 × 900` px), comparing the source name treatment with the implemented clickable-name affordance.
- Revised factual-empty-state implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-legislator-profile-qa/10-perfil-sin-comisiones-copy-corregida.png` (`1440 × 752` px), Chrome CSS viewport `1440 × 752`, density `1`, showing Antonio Taveras Guzmán's profile after the copy correction.
- Post-fix comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-legislator-profile-qa/11-comparacion-copy-factual-corregida.png` (`2000 × 1000` px), placing the original roster source and revised dialog together without stretching.
- State: Spanish, light theme, Santiago selected, Chamber of Deputies expanded, Brailyn Miguel Vargas Núñez profile open, local production data.

### Findings and comparison history

- The first visual comparison found no layout, typography, token, imagery or interaction mismatch at P0/P1/P2.
- The source's name, role, party, two-column rhythm and dividers remain visually recognizable. The only deliberate addition is a restrained blue profile icon and interactive hover/focus treatment that communicates clickability without making the list visually noisy.
- The profile dialog reuses Oculis's existing Congress profile experience rather than introducing a second visual language or an unstable narrow popover.
- A subsequent factual-state audit found one P1 copy issue: an empty committee list said that the source did not report committees, although the same state can also mean that Oculis could not establish an exact identifier-based link. The copy was changed to “Oculis no tiene comisiones vinculadas mediante un identificador oficial para este perfil.”
- The revised Antonio Taveras profile was rebuilt, recaptured and compared in evidence `10` and `11`. The corrected statement is visible, fits the dialog without layout drift and introduces no new P0/P1/P2 issue.

### Required fidelity surfaces

- Typography: the existing Oculis sans hierarchy, weights, line height and wrapping are preserved in the roster. The dialog uses the established serif profile heading and readable factual labels; long names, emails and committee names wrap without truncation.
- Spacing and layout: the list keeps its original desktop columns and divider rhythm. Name buttons provide a minimum 44 px target without increasing visual density. The dialog is centered at a `560` px maximum width, uses `16` px mobile gutters, one-column mobile facts and an internally scrollable `88dvh` maximum height.
- Colors and visual tokens: buttons, focus rings, borders, chips, dialog surface and profile-icon affordance use existing Oculis accent, border and surface tokens. No new palette was introduced.
- Image quality and asset fidelity: public photographs use their source image when valid and fall back to styled initials. Brailyn's and Abelardo's photographs loaded at natural resolution in Chrome; the Oculis logo and map assets were not modified.
- Copy and content: the dialog says “Perfil del congresista” and reserves “oficial” for the validated outbound profile. It displays only source-backed facts; missing secondary values are omitted and no biography, political characterization or committee membership is inferred.

### Interaction, accessibility, data integrity and release verification

- Identity: every trigger and profile uses the stable composite key `source:sourceId`; names are never used to identify or join a person.
- Data: HOME now receives the complete active public roster record plus committee memberships joined only by exact chamber and source ID. Both HOME and `/congreso` consume the same shared profile component.
- Trigger: the complete name/role/party area is a native button with a minimum 44 px target, `aria-haspopup="dialog"` and an exact accessible label. Click, Enter and Space all work.
- Dialog: `role="dialog"`, `aria-modal="true"`, a unique labelled heading, visible close control, backdrop close, Escape close, focus trap and body scroll lock were verified.
- Focus restoration: Escape returns focus to the exact legislator button that opened the profile.
- Coverage: one senator and multiple deputies were tested, including the screenshot-specific Brailyn Miguel Vargas Núñez. Switching provinces closes a stale profile.
- Official evidence: each outbound profile is passed through the source-specific official-URL validator; for example, Abelardo resolves to `https://www.diputadosrd.gob.do/sil/legislador/3680` and Brailyn to `https://www.diputadosrd.gob.do/sil/legislador/3703`.
- English: labels, close action and official-profile action render in English while the source-published proper nouns remain unchanged.
- Mobile: at `390 × 844`, the dialog measured `360` px wide with `15` px side gutters, produced no horizontal overflow and retained internal scroll and the visible close action.
- Console/runtime: no application error or Next error overlay appeared during the tested profile interactions.
- Production build: passed on Next.js `15.5.24`.
- Web typecheck, targeted ESLint, Prettier and all `80` web tests passed.

## Navegación principal — menú plano sin categorías

This pass implements only the screenshot-scoped correction received on 28 August 2026: the visible category labels and section dividers were removed from the persistent navigation while preserving every destination and interaction.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_ozxgT3/Screenshot 2026-08-28 at 3.31.21 PM.png` (`516 × 1580` px), showing the category labels “INICIO”, “ACTIVIDAD”, “INVESTIGACIÓN”, “ACTORES” and “CONFIANZA” plus their separators.
- Desktop implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/sidebar-flat-qa/01-menu-plano-desktop.png` (`1713 × 894` px), Chrome CSS viewport `1728 × 902`, density `1`.
- Mobile-drawer implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/sidebar-flat-qa/02-menu-plano-mobile-390x844.png` (`390 × 844` px), Chrome CSS viewport `390 × 844`, density `1`.
- Combined comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/sidebar-flat-qa/03-comparacion-categorias-eliminadas.png` (`1400 × 1000` px). The source and rendered mobile drawer were placed side by side in equal `700 × 1000` cells, each scaled proportionally and padded without stretching.
- State: Spanish, light content theme, HOME active, production build and local production data. The source crop is a desktop sidebar, while the focused implementation uses the mobile drawer because both surfaces share the same `Navigation` component and the complete flattened list is legible at once.

### Findings and comparison history

- The first combined comparison found no actionable P0, P1 or P2 difference outside the intentional simplification.
- All five category labels and their four internal separators are absent. The menu is now one continuous list of ten destinations.
- The Oculis logo, product descriptor, endorsement, icons, link labels, order and selected-state treatment remain unchanged.
- No corrective visual loop was required after the first comparison.

### Required fidelity surfaces

- Typography: destination labels retain the existing Oculis family, size, weight and line height. Long items still wrap naturally without truncation; only the uppercase category typography was intentionally removed.
- Spacing and layout: the unexplained section gaps and dividers are gone. The list uses a consistent `0.5` vertical gap and preserves 44 px-minimum link targets. Desktop and `390 × 844` mobile views show no horizontal overflow.
- Colors and visual tokens: the navy navigation surface, muted link color, blue active rail, active background, border around the endorsement and focus behavior remain unchanged.
- Image quality and asset fidelity: the supplied Oculis lockup is untouched, retains its original proportions and remains sharp in desktop and mobile navigation. No image or icon asset was replaced.
- Copy and content: no destination was renamed, removed or added. Only the requested organizational labels were removed in Spanish and English.

### Interaction, accessibility and release verification

- Desktop and mobile both render exactly ten navigation links from the same shared component.
- HOME remains the sole `aria-current="page"` destination on `/`.
- The mobile menu retains `role="dialog"`, focus management, Escape/backdrop/close behavior and closes after navigating.
- Selecting “Agenda” from the mobile drawer navigated to `/hoy`, closed the drawer and correctly moved `aria-current="page"` to Agenda.
- The mobile document measured `390` px wide in a `390` px viewport with no horizontal overflow.
- No application error or Next error overlay appeared during navigation or capture.
- Production build passed on Next.js `15.5.24`.
- Web typecheck, targeted ESLint, Prettier, `git diff --check` and all `80` web tests passed.

## Tipografía principal — referencia “Horizon”

This pass evaluates only the screenshot-scoped request received on 28 August 2026: use the shown display face for primary page titles such as “Tablero inicial” and “Mapa Oculis”.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_HDPW3O/Screenshot 2026-08-28 at 3.38.05 PM.png` (`1766 × 698` px), showing Canva's “Horizon” selection and the complete uppercase alphabet.
- State: a typography reference rather than a complete Oculis screen; the requested scope is the primary page-title treatment and the “Mapa Oculis” display heading.
- Implementation screenshot: unavailable because the repository contains no licensed webfont asset for this typeface. No density normalization or combined source/implementation comparison can be produced until that asset exists.
- Focused comparison evidence: blocked for the same reason. The source itself is already a focused glyph specimen, so no further crop is required.

### Findings and blocker

- [P0] The exact font asset is unavailable for a lawful web implementation. The visual glyphs correspond to Hanson Bold, but the project contains no `.woff2`, `.woff`, `.otf` or `.ttf` for it.
- The creator's free Hanson Bold edition is CC BY-NC 4.0 and therefore cannot be used for this commercial consulting platform. Canva's content license also prohibits extracting or installing Canva font software outside Canva.
- Substituting a merely similar font would violate the selected visual reference and create avoidable design drift; no approximation was introduced.
- No source code, Oculis logo, existing font token or rendered page was changed during this blocked pass.

### Identified implementation scope after licensing

- Load the independently licensed webfont through `next/font/local` and expose a dedicated `--font-display` token, preserving the existing reading fonts.
- Apply it to `apps/web/src/app/globals.css` `.page-title` for primary AppShell page titles.
- Apply it only to `apps/web/src/components/home-province-dashboard.module.css` `.title` for “Mapa Oculis”; keep provincial captions, cards, navigation and body copy in their current readable families.
- Verify Spanish accents and `ñ`, avoid synthetic weight, and capture desktop plus `390 × 844` mobile evidence before acceptance.

### Required fidelity surfaces

- Fonts and typography: blocked; exact family bytes and licensed embedding rights are missing.
- Spacing and layout rhythm: unchanged because no implementation was made.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: the supplied screenshot remains the sole source truth; no replacement asset was generated.
- Copy and content: unchanged.

### Comparison history and next gate

- Initial preflight identified the font, audited the title selectors and stopped before inserting an unlicensed or approximate typeface.
- Required unblocker: a Hanson Bold/Horizon font file licensed for website/web-app embedding, supplied as `.woff2`, `.woff`, `.otf` or `.ttf`.
- After the asset is supplied, render both named title surfaces, capture them at matching desktop and mobile states, assemble a combined comparison and repeat this QA gate.

## Sistema tipográfico — Garet para toda la interfaz restante

This pass extends the approved typography direction: Horizon/Hanson Bold remains reserved for primary display titles, while every other visible prose and interface role uses Garet. True technical identifiers remain IBM Plex Mono.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_UFVstJ/Screenshot 2026-08-28 at 3.41.48 PM.png` (`942 × 528` px), showing Canva's “Garet” selection and a mixed-case specimen at 18 px.
- State: a focused typography specimen rather than a complete Oculis screen.
- Implementation screenshot: unavailable because no licensed Garet webfont file exists in the repository or on the development Mac.
- Full-view and focused comparison evidence: blocked. A visible implementation cannot be rendered faithfully from a font name alone, and the source is already the focused glyph specimen.

### Findings and blocker

- [P0] The exact webfont asset is absent. The family is Garet by Type Forward, but Oculis has no licensed `.woff2`/`.woff`, variable font or static Regular/Medium/Bold files.
- Type Forward offers Garet Book and Garet Heavy as a free desktop-and-web pair through its official checkout. That pair can support a two-weight system, but it cannot reproduce the requested professional Regular/Medium/Bold hierarchy without synthetic intermediate weights.
- A full or variable Garet Web License is the fidelity-safe option for body copy, controls, section headings and long legal titles. The current foundry license requires the licensed domain/pageview tier and self-hosted webfont files.
- No source code, existing typography token, page layout or Oculis logo was changed during this blocked pass.

### Approved hierarchy after licensing

- Horizon/Hanson Bold: primary page titles and “Mapa Oculis” only.
- Garet Regular 400: paragraphs, descriptions, metadata and factual values.
- Garet Medium 500: navigation, controls, names, links and content titles.
- Garet Bold 600–700: section, card, modal, empty-state and error headings.
- IBM Plex Mono 400/500: initiative codes, source/event/API identifiers, hashes, raw URLs, JSON and preformatted diagnostics.
- Source Serif 4 and Inter are removed from visible product prose; the original Oculis logo remains untouched.

### Required fidelity surfaces

- Fonts and typography: blocked pending exact licensed Garet and Horizon/Hanson webfont assets. Spanish accents, `ñ`, all requested weights, wrapping, synthesis and tabular numerals must be verified after loading.
- Spacing and layout rhythm: unchanged; no font was substituted, so no misleading reflow comparison was produced.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: no image or logo asset changed.
- Copy and content: unchanged.

### Comparison history and next gate

- Preflight identified the exact family, audited the complete typography surface and stopped before hotlinking, extracting Canva files or using an approximate font.
- Required unblocker: licensed Garet webfont files—preferably the variable/full family—and the separately licensed Horizon/Hanson display file.
- After both assets are supplied, the implementation must be rendered and compared at desktop, `390 × 844`, a 320–360 px narrow state, both themes and representative Spanish/English content before this gate can pass.

final result: blocked

## Tablero inicial — legibilidad del nombre en la columna del Senado

This pass implements only the screenshot-scoped correction received on 28 August 2026: give the senator's name enough usable width without changing the other HOME columns or interactions.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_Dl5XBB/Screenshot 2026-08-28 at 4.38.28 PM.png` (`456 × 422` px), showing the cramped La Altagracia senator row before the correction.
- Browser-rendered full implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/design-reconstruction/qa/home-senate-name-after-full.png` (`1039 × 900` capture), CSS viewport `1280 × 900` in the Codex in-app browser.
- Focused implementation crop: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/design-reconstruction/qa/home-senate-name-after-focus.png` (`215 × 225` px).
- Combined focused comparison input: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/design-reconstruction/qa/home-senate-name-comparison.png` (`460 × 225` px). Source and implementation were proportionally normalized to the same 225 px height; neither side was stretched.
- State: Spanish, light theme, La Altagracia selected, “Senado de la República” expanded, Rafael Barón Duluc Rijo visible.

### Findings and comparison history

1. The initial measurement confirmed a P1 layout defect: the 148 px Senate list inherited the two-column deputies grid, so its only row received 67.5 px. After the number, gaps, padding and 18 px profile icon, the name wrapper measured 0 px and wrapped almost one word per line.
2. The correction applies a semantic single-column variant only to the Senate `PersonList`. It does not change the shared three-column layout, deputies grid, initiatives, accordion, map or profile dialog.
3. The post-fix 1280 px measurement gives the row the complete 148 px list width, the button 114 px and the name 74 px. The name now uses two balanced lines; the 18 px profile icon remains separate with the existing 8 px gap.
4. The focused combined comparison shows that the overlap and excessive wrapping are gone. No actionable P0, P1 or P2 finding remains in this scoped correction.

### Required fidelity surfaces

- Fonts and typography: family, weight, size and line height are unchanged. Only the available text measure changed, reducing the name from four cramped lines to two readable lines without truncation.
- Spacing and layout rhythm: the Senate roster alone moves from a two-column to a one-column list. Card padding, number column, button target, section spacing, radii and the neighboring initiative/deputies columns are unchanged.
- Colors and visual tokens: no color, surface, border, focus or accent token changed.
- Image quality and asset fidelity: no raster, map, logo or profile asset changed. The existing Phosphor profile icon remains 18 px and is no longer visually crowded.
- Copy and content: the senator's exact public name, party and all labels remain unchanged.

### Responsive, interaction and release verification

- `1280 × 720`: Senate row 148 px, button `114 × 56.7` px, two-line name, no overlap.
- `2048 × 1200`: Senate row 200.1 px, button `166.1 × 56.7` px and 126.1 px name measure.
- `390 × 844`: Senate card 279 px, row 253 px, button `219 × 44` px, one-line name and no horizontal overflow.
- Deputies retain their two-column desktop grid; this was measured as a regression control.
- Clicking the corrected name still opens the exact Rafael Barón Duluc Rijo profile dialog; closing it works normally.
- Browser console: zero warnings or errors during province selection, disclosure, profile open/close and responsive checks.
- Web typecheck: passed.
- Web tests: `93/93` passed.
- ESLint, Prettier and `git diff --check`: passed.

final result: passed

## Movimientos del Congreso — disponibilidad y apertura del PDF

### Resultado visual y contrato

- Cada movimiento muestra únicamente uno de dos estados compactos: `PDF disponible` o `PDF no disponible` (`PDF available` / `PDF unavailable` en inglés).
- `PDF disponible` es un enlace de al menos `44px`, abre una pestaña nueva mediante la ruta interna `/api/document/open` y nunca expone directamente la URL externa del archivo.
- El enlace solo se construye cuando el documento oficial actual está marcado `PUBLISHED_VERIFIED`, tiene disponibilidad vigente y posee identificadores internos válidos. Los demás casos fallan cerrados como una etiqueta no interactiva.
- El endpoint vuelve a validar la pertenencia documento–iniciativa, la política de URL oficial, la firma PDF, la disponibilidad y el mismo snapshot inmediatamente antes de redirigir. Una revocación concurrente responde sin abrir el archivo.
- Se eliminó el bloque agregado de monitoreo documental. La iniciativa conserva un único enlace principal y el enlace PDF es un control hermano; no existen enlaces anidados.

### Evidencia y comparación

- Referencia anterior: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/pdf-status-qa/reference-before.png`.
- Implementación final: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/pdf-status-qa/implementation-final-desktop.png`.
- Navegador real en `2026-08-31`, Cámara de Diputados: `8` movimientos, `8` etiquetas no disponibles, `0` enlaces anidados y ausencia total del bloque agregado.
- El documento no presenta desbordamiento horizontal (`scrollWidth === clientWidth === 1265`).
- El día auditado no contiene un PDF disponible en los datos locales; la variante clicable quedó validada mediante render SSR, contrato de href y pruebas adversariales.

### Verificación técnica

- Suite completa: `613` pruebas pasaron, `6` se omitieron y `0` fallaron.
- Typecheck de los cinco workspaces: passed.
- Factual-policy check: passed.
- ESLint focalizado: passed.
- Prettier focalizado y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## Ficha de iniciativa — cámara actual y vencimiento normativo

### Referencia y resultado

- Referencia recibida: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/initiative-procedural-facts-qa/reference-missing-fields.png`. El estado anterior mostraba “No informado por la fuente” tanto para Cámara actual como para Vencimiento.
- Implementación final: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/initiative-procedural-facts-qa/implementation-final-desktop.png`.
- La comparación conjunta referencia/implementación confirmó que la ficha `06229-2024-2028-CD` ahora presenta “Cámara de Diputados” con la etiqueta “Última cámara oficial observada” y “Cómputo aún no iniciado” con la etiqueta “Dato publicado”.
- Ambos datos ocupan la franja principal de la ficha, junto al estado, y ya no quedan relegados a la ficha completa ni aparecen como ausencias genéricas.

### Contrato factual y normativo

- El campo canónico publicado por la fuente permanece separado del valor de presentación. Si no existe un campo literal de cámara actual, Oculis usa únicamente el último movimiento oficial cuya fuente identifica inequívocamente la cámara y lo etiqueta como observado.
- Un movimiento de despacho sin destino publicado se muestra como “en tránsito”; un estado terminal se muestra como trámite concluido. Nunca se deduce un traslado a partir del código, el título o un estado ambiguo.
- Una fecha publicada de vencimiento o un evento oficial de perención prevalecen sobre cualquier cálculo.
- La regla general de dos legislaturas se aplica solo a proyectos de ley. El depósito no inicia el cómputo: la fuente debe publicar que comenzó la toma en consideración/admisión y la legislatura ordinaria correspondiente.
- Las legislaturas extraordinarias no cuentan. Los períodos con excepción normativa, los expedientes bicamerales sin vínculo oficial y la evidencia contradictoria fallan cerrados con un estado de revisión; no producen una fecha inventada.
- Las fechas calculadas se identifican como “Cálculo de Oculis”, conservan la legislatura inicial/final, la evidencia de inicio, la versión del método y la base jurídica `CRD-89`, `CRD-100` y `CRD-104`.
- Mientras una fila histórica del Senado espera su próxima sincronización, el adaptador puede recuperar exclusivamente los campos literales `Conteo de Legislaturas Iniciado`, su fecha, legislatura y vencimiento desde la Ficha oficial ya archivada. No usa estado, título ni depósito como sustitutos.
- Para tipos no cubiertos por la regla general, la interfaz muestra “No aplica la regla de dos legislaturas” en lugar de extrapolar una fecha.

### Presentación, accesibilidad e interacción

- El bloque usa la cuadrícula y los tokens visuales existentes; no introduce una tarjeta o paleta paralela. La franja pasa de una a dos y tres columnas según el ancho disponible.
- Cada dato incluye valor, procedencia y explicación textual; el color no es el único portador de significado.
- Las fechas usan `<time datetime>`, los textos auxiliares están conectados con `aria-describedby` y los enlaces a la Constitución y al Manual legislativo mantienen un objetivo mínimo de 44px.
- El disclosure “Cómo se determinan cámara actual y vencimiento” explica la metodología sin recargar la vista inicial.
- Español e inglés tienen copy completo; las etiquetas institucionales y los estados publicados se localizan sin alterar los valores canónicos.
- Validación en navegador de la ficha real: URL correcta, ambos campos y sus bases visibles, cero errores de aplicación en consola.

### Verificación técnica

- API local validada para iniciativa `27236`: `currentLocation=CHAMBER/OBSERVED/DIPUTADOS` y `expiration=COUNT_NOT_STARTED/OFFICIAL`, mientras `currentChamber` y `expiresAt` canónicos permanecen `null`.
- Pruebas focalizadas cubren fuente publicada, observación de cámara, depósito sin inicio, cálculo PLO/SLO, año bisiesto, perención, tipos no aplicables, traslado sin vínculo, legislatura extraordinaria y evidencia contradictoria.
- Web/worker typecheck, suites focalizadas, ESLint, Prettier, política factual y `git diff --check`: verificados en la entrega.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## Movimientos del Congreso — estado documental por iniciativa

### Resultado y contrato factual

- Cada movimiento muestra ahora un indicador documental compacto inmediatamente después de la evidencia oficial, sin añadir otro enlace ni alterar el destino clickeable de la iniciativa.
- Los estados visibles son: “Documento publicado”, “Documento registrado · sin verificar”, “No publicado en la última verificación”, “Publicación sin confirmar” y “Verificación no disponible”, con equivalentes completos en inglés.
- “Documento publicado” exige metadatos de la iniciativa exacta y bytes del PDF verificados contra una instantánea oficial vigente de menos de 24 horas.
- “No publicado en la última verificación” solo aparece cuando el endpoint oficial de documentos respondió correctamente, la colección fue observada explícitamente, estaba vacía o no contenía un texto de proyecto depositado y la comprobación tiene menos de 24 horas.
- Una observación vencida, ausente o retenida después de un fallo nunca produce un “no publicado”: se degrada a “Publicación sin confirmar”. El Senado permanece en “Verificación no disponible” porque el portal no ofrece el mismo contrato verificable.
- El backend consulta los estados en lote por los identificadores internos exactos de las iniciativas; no hace coincidencias por título ni solicitudes N+1.

### Evidencia y comparación visual

- Referencia recibida: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_mZe0M5/Screenshot 2026-09-01 at 11.28.08 AM.png` (`1368 × 332`).
- Implementación final en contexto: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/movement-document-row-final-1368x720.jpg` (`1353 × 712`, viewport CSS solicitado `1368 × 720`, DPR `1`).
- Estado desktop completo: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/movement-document-final-1368x720.jpg`.
- Estado móvil: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/movement-document-mobile.png` (`375 × 812`).
- Comparación referencia/implementación: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/movement-document-comparison.png` (`1368 × 567`).
- Estado validado: español, tema oscuro, Cámara de Diputados, fecha oficial `2026-08-31`; ocho movimientos y ocho indicadores `NOT_PUBLISHED_LATEST_CHECK` respaldados por respuestas oficiales exitosas y vacías.

### Superficies de fidelidad y accesibilidad

- Tipografía: el indicador usa `0.74rem` (11.1px en el viewport móvil medido), peso `680` y una sola línea; permanece secundario frente al titular y legible junto a los metadatos.
- Espaciado: altura mínima `23px`, padding compacto y `flex-wrap` heredado del renglón; a `320px` mide `234.16px`, queda dentro de los `305px` útiles y no genera desbordamiento material.
- Color: verde para evidencia publicada, ámbar para una comprobación negativa reciente y neutral para estados no concluyentes; el texto completo siempre acompaña el color y el modo `forced-colors` conserva borde.
- Iconografía: iconos de 12px, decorativos y ocultos a lectores de pantalla. El nombre accesible del enlace sigue siendo su contenido visible natural.
- Interacción: toda la fila continúa siendo un único enlace a la ficha completa; el indicador es un dato estático y no crea enlaces o botones anidados.
- Responsive: ocho indicadores visibles en desktop y a `320 × 844`; `white-space: nowrap`, sin recorte, y el diseño conserva la lectura código → cámara → evidencia → estado documental.

### Verificación técnica

- Suite completa: `576` pruebas pasaron, `6` pruebas live se omitieron y no hubo fallos.
- DB: `73/73`; web: `286/286`; worker: `83/83`; scrapers: `124/124` con `6` live omitidas; core: `10/10`.
- Typecheck DB, web y worker: pasó.
- ESLint focalizado, política factual, Prettier y `git diff --check`: pasaron.
- Consola: cero errores de aplicación; solo apareció el aviso esperado de Fast Refresh durante la edición en desarrollo.
- Revisión independiente: no quedan hallazgos P0, P1 o P2.

final result: passed

## Movimientos del Congreso — archivo diario

### Resultado y alcance

- La antigua ventanilla “Cambios oficiales” se presenta ahora como “Movimientos del Congreso” / “Congressional movements” sin cambiar la ruta estable `/feed`.
- La vista se organiza por fecha oficial y cámara. El selector liquid-glass permite alternar entre Cámara de Diputados y Senado, mientras las flechas, el calendario, “Hoy” y “Última fecha con registros” producen URLs compartibles.
- Cada fila usa el tratamiento editorial solicitado: acción procesal destacada en azul y asunto legal resumido en la misma oración. La fila completa abre la ficha interna de la iniciativa; la prueba de navegador llegó correctamente a `/initiatives/27107?lang=en`.
- La lista principal aparece antes del detalle documental para que el movimiento diario sea la tarea dominante. El bloque posterior distingue textos depositados verificados y publicaciones almacenadas en los catálogos oficiales monitoreados.
- Los conteos documentales son fail-closed: Diputados muestra `PDF verificado / depósitos registrados`; Senado explica que esa verificación equivalente todavía no está disponible. Cero se describe como ausencia de registros en el alcance monitoreado, nunca como prueba de que la cámara no publicó.
- La versión inglesa usa títulos revisados cuando existen. Si falta una traducción, conserva el título oficial con `lang="es"` y muestra “translation pending”; si falta una traducción procesal, usa una acción inglesa neutral y revela el estado oficial español.

### Fuente visual y evidencia

- Fuente visual recibida: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/congress-movements-qa/reference-editorial-movements.png`.
- Estado anterior del feed: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/congress-movements-qa/before-feed-full.png`.
- Cabecera, fecha y controles finales: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/congress-movements-qa/final-dark-header-controls-1100x994.png`.
- Titulares y monitoreo final: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/congress-movements-qa/definitive-dark-movements-documents-1100x994.png`.
- Estado principal comparado: español, tema oscuro, Cámara de Diputados, `2026-08-31`, viewport CSS `1100 × 994`; el documento midió `1100px` y no presentó overflow horizontal.
- La referencia y el resultado definitivo se abrieron juntos en la misma comparación. El resultado conserva el ritmo editorial de la referencia —fondo azul marino, verbo azul, asunto blanco, metadatos discretos y divisores finos— y añade controles, evidencia y accesos sin debilitar el titular.
- Historial de comparación: el primer pase encontró controles susceptibles de comprimirse en contenedores estrechos, cronología demasiado tardía, microtexto claro de bajo contraste y una separación inferior incorrecta. Se corrigieron con container queries, formulario móvil en una columna, lista antes del monitor, `--text-muted`, reglas de color forzado separadas y borde superior del bloque documental. El segundo pase no encontró desajustes visuales P0, P1 ni P2.

### Fidelidad y responsive

- Tipografía: se mantienen las fuentes/tokens del producto; el h1 de sección usa el display Oculis y los titulares el sans editorial existente.
- Espaciado y layout: a `1100px` con sidebar abierto, los selectores se apilan sin solaparse (`693.5px` de ancho cada uno). Las reglas de contenedor cubren los estados `1280`, `1024`, `768`, `390` y `320`; bajo `360px`, input y acción de fecha se apilan.
- Color: acción en `--accent`, texto principal en `--text`, evidencia en `--verified`; light y dark conservan contraste. El microtexto documental usa `--text-muted` y no depende solo del color.
- Activos: se reutilizan exclusivamente los iconos Phosphor y el logo existente; no se introdujeron imágenes, SVG o activos aproximados.
- Copy: “Movimientos del día” evita prometer un orden cronológico que la fuente no publica. “Documentos almacenados” evita presentar el catálogo como un snapshot activo.
- Accesibilidad: controles de 44px, `<time>`, navegación con `aria-current`, `<progress>`, jerarquía h1→h2→h3, fragmentos `lang` correctos, nombre accesible derivado del titular visible y fallbacks para transparencia reducida/forced colors.

### Interacción y verificación

- Cámara de Diputados y Senado: verificados; el cambio conserva fecha e idioma.
- Fecha anterior, calendario, Hoy y última fecha: verificados con rutas canónicas.
- Senado sin movimientos: estado vacío honesto y PDF sin proporción inventada.
- Inglés: `<html lang="en">`, acción inglesa, título revisado o aviso explícito de traducción pendiente.
- Iniciativa: clic verificado hasta su ficha completa interna.
- Consola final: 0 errores y 0 advertencias.
- Web tests: `284/284` pasaron en `42` archivos.
- DB tests: `71/71` pasaron en `4` archivos.
- Pruebas focalizadas finales de Movimientos: `14/14` pasaron; los componentes suman `9/9`.
- Web y DB typecheck: passed.
- ESLint focalizado, Prettier, factual-policy check y `git diff --check`: passed.
- Production build aislado: passed; `/feed` se generó como ruta dinámica sin errores.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — constelación de 13 retratos del Congreso

### Resultado visual

- El bloque conserva su jerarquía original, pero pasa de `5` a `13` retratos oficiales únicos: ocho fotografías adicionales.
- La selección presenta `7` integrantes de la Cámara de Diputados y `6` del Senado, intercalados sin sugerir una jerarquía política.
- La constelación usa cuatro retratos pequeños, cuatro medianos, cuatro grandes y un retrato protagonista; la diferencia de escala se mantiene en escritorio y se adapta a tamaños táctiles seguros en pantallas estrechas.
- Los retratos permanecen en flujo normal, sin animación ni transición de posición. No hay temblor, salto de hidratación ni solapamiento con el título, la nota o el anuncio del directorio.
- Cada recarga completa conserva `13` perfiles distintos entre sí y renueva el conjunto. En la comparación de dos recargas se mantuvieron solo `5` identidades de `13`.

### Evidencia y comparación

- Referencia preservada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-portraits-qa/reference-5-portraits.png`.
- Implementación final enfocada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-portraits-qa/implementation-final-1440x1000.jpg`.
- La comparación conjunta confirma la diferencia intencional: el amplio espacio vacío de la referencia se convierte en una constelación equilibrada de trece rostros, mientras título, ayuda, nota y anuncio inferior mantienen su orden y lenguaje visual.
- Después del primer pase se corrigió un P2 en el umbral de escritorio: se redujeron ligeramente los retratos sexto y séptimo para que ni sus cajas ni sus anillos de enfoque se crucen alrededor de `963–1001px` de ancho del componente.
- El segundo pase no encontró ningún P0, P1 o P2 visual pendiente.

### Responsive, interacción y accesibilidad

- `1440 × 1000`: `13/13` botones, `13` identidades únicas, objetivo mínimo `46px`, cero solapamientos y cero desbordamiento horizontal.
- `768 × 900`: reflow `7 + 6`, objetivo mínimo `48px`, cero solapamientos y todos los retratos dentro del bloque.
- `390 × 844`: reflow `4 + 4 + 4 + 1`, objetivo mínimo `44px`, cero solapamientos y sin scroll horizontal.
- Los trece controles exponen `aria-haspopup="dialog"`; la prueba abrió una ficha Oculis, cargó el perfil completo y mantuvo la URL `/` sin navegación externa.
- Las fotografías oficiales cargan de forma diferida y asíncrona; una falla mantiene el mismo botón y muestra iniciales sin cambiar su geometría.
- Todos los retratos reportaron `animation-name: none` y `transition-duration: 0s`. La consola terminó sin errores ni advertencias.

### Verificación técnica

- Pruebas focalizadas: `11/11` pasaron.
- Web typecheck: pasó.
- Validación de geometría en navegador: pasó en `1302 × 900`, `768 × 900` y `390 × 844`.
- Revisión independiente: sin P0 ni P1; el único P2 geométrico detectado fue corregido y revalidado.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — composición partidaria por cámara

### Referencias y decisión visual

- Referencias entregadas por el usuario: `codex-clipboard-ee76ce62-5701-496a-92f9-f27c7ac17246.png` (hemiciclo de la Cámara de Diputados), `codex-clipboard-63dd2245-21da-4333-92ee-18996e208dc2.png` (hemiciclo del Senado) y el boceto `Screenshot 2026-08-31 at 8.35.37 PM.png`.
- Comparación conjunta fuente/implementación abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-qa/comparison-references-vs-implementation.png`.
- El bloque inferior respeta la composición 50/50 del boceto: directorio y retratos a la izquierda; composición partidaria interactiva a la derecha. El selector usa una superficie liquid-glass sin gradientes.

### Datos y representación factual

- La composición proviene de un agregado estrecho del directorio oficial activo y exige pares exactos fuente/cámara: `roster-diputados + DIPUTADOS` y `roster-senado + SENADO`.
- La instantánea local verificada muestra 32 senadores y 189 diputados activos. No se fuerza la cifra constitucional de 190 que aparece en la referencia; cada punto corresponde a un registro activo realmente observado.
- Senado: PRM 27, FP 3, PPG 1 y PRSC 1. Cámara de Diputados: PRM 140, FP 28, PLD 12, DXC 2, PRSC 2 y cinco partidos con un integrante cada uno.
- La leyenda expande cada sigla a `SIGLA (Nombre completo)`, muestra cantidad y porcentaje, y conserva PRM azul, FP verde y PLD morado mediante el sistema partidario central.
- Los partidos menores usan colores categóricos neutrales y estables; no se les inventa una identidad cromática oficial. Una eventual ausencia de partido se conserva como categoría independiente.
- La posición de los sectores solo agrupa la lectura por cantidad y etiqueta; la nota visible aclara que no representa ideología.

### Interacción, accesibilidad y responsive

- La barra Senado/Cámara funciona como `tablist` con `tab`, `tabpanel`, `aria-selected`, `aria-controls`, foco roving, objetivos de 44 px y navegación Left/Right/Up/Down/Home/End.
- El gráfico utiliza Recharts con un punto no animado por congresista. El Senado renderiza exactamente 32 puntos y la Cámara exactamente 189.
- El gráfico tiene nombre accesible completo; cantidades y porcentajes permanecen visibles en un `dl`, por lo que el color nunca es el único canal de información.
- La región de estado anuncia el cambio de cámara. Se verificaron IDs únicos, jerarquía de encabezados, cinco disparadores de perfiles y apertura de la burbuja sin cambiar la URL.
- El diseño responde al ancho real del contenedor: cabecera, gráfico y leyenda se reorganizan antes de comprimirse; el módulo mantiene cero overflow horizontal. Incluye fallbacks para transparencia reducida y colores forzados.
- ES y EN fueron validados; los nombres oficiales de los partidos permanecen en español en ambos idiomas. Tema claro y oscuro conservan contraste y jerarquía.

### Evidencia visual y técnica

- Implementación final, Senado, español: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-qa/implementation-band-final-es.png`.
- Implementación final, Cámara de Diputados: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-qa/implementation-1280-deputies.png`.
- Tema claro: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-qa/implementation-1280-light.png`.
- Carga limpia del navegador: cero errores y cero advertencias de aplicación.
- Web typecheck: passed.
- Web tests: `254/254` passed.
- DB tests: `62/62` passed.
- Root ESLint: passed.
- Factual-policy check: passed.
- Production build: passed.
- Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## Sistema global de siglas y colores partidarios

### Regla de presentación

1. Toda sigla partidaria visible se presenta como `SIGLA (nombre oficial completo)`. La capa central reconoce las 19 siglas o valores institucionales publicados actualmente y normaliza mayúsculas, espacios, diacríticos y los dos órdenes parentéticos sin alterar el valor fuente usado por filtros o URLs.
2. Las denominaciones oficiales permanecen en español tanto en la interfaz ES como EN; solo se localiza el texto de interfaz alrededor. Un valor desconocido no recibe un nombre inventado: se muestra con una aclaración localizada de que el nombre completo no fue informado.
3. Los colores permanentes son PRM azul, FP verde y PLD morado. Instituciones, independientes, valores ausentes y los demás partidos usan una rampa neutral determinista. El texto completo y los conteos siempre acompañan el color.

### Superficies cubiertas

- HOME: promoción del directorio, listas provinciales, nombres accesibles y gráfico de congresistas por partido.
- Directorio del Congreso: selector de partido, tarjetas de legisladores, integrantes de comisiones y sus burbujas de perfil.
- Instituciones y vistas reutilizables: burbujas de comisiones y mapa provincial legado, para evitar reintroducir siglas crudas en futuras superficies.
- Investigación y actividad: filtros y chips de iniciativas, catálogo, depósitos de agenda y ficha completa de cada iniciativa.
- Perfil global: ficha verificada y ficha mínima muestran el mismo formato canónico; la URL y la identidad del legislador siguen usando los valores fuente exactos.

### Evidencia visual y responsive

- Tema oscuro, HOME `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/party-presentation-qa/home-party-chart-dark-1280x720.png`.
- Tema claro, HOME `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/party-presentation-qa/home-party-chart-light-1280x720.png`.
- Móvil, HOME `390 × 844`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/party-presentation-qa/home-party-chart-mobile-390x844.png`.
- En oscuro se midió PRM `rgb(134, 173, 255)`, FP `rgb(102, 212, 147)` y PLD `rgb(195, 154, 239)`; en claro, PRM `rgb(31, 91, 216)`, FP `rgb(24, 119, 68)` y PLD `rgb(111, 44, 145)`.
- La vista móvil conserva los tres nombres completos y los conteos sin desbordamiento horizontal (`scrollWidth = innerWidth = 390`). Desktop tampoco presenta overflow a `1280px`.
- La selección PRM en `/initiatives?party=PRM` conservó el valor técnico `PRM` en la URL, mientras el selector y el chip visible mostraron `PRM (Partido Revolucionario Moderno)`.
- En `/congreso`, los nombres expandidos aparecen en selector, tarjetas y nombres accesibles. El clic en un nombre abrió primero la burbuja de Oculis, mantuvo la URL y mostró dentro `PRM (Partido Revolucionario Moderno)`.
- La pestaña final limpia de localhost no registró errores ni advertencias de la aplicación.

### Verificación técnica

- Web typecheck: passed.
- Web tests: `230/230` passed across 34 files.
- Producción web build: passed.
- Root ESLint: passed.
- Factual-policy check: passed.
- Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## Tablero inicial — eliminación del selector provincial expandido

### Verdad visual y estado comparado

- Referencia del usuario: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_rsl3v3/Screenshot 2026-08-31 at 4.05.56 PM.png` (`2422 × 794` px).
- Captura de implementación: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-box-removal-qa/implementation-dark-1211x800.png`, tomada en HOME, tema oscuro y provincia Hato Mayor.
- Comparación conjunta inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-box-removal-qa/source-vs-implementation.png` (`1196 × 1182` px).
- La revisión se concentró en el bloque señalado por el usuario y su continuidad inmediata con el mapa y el panel de detalle.

### Resultado visual y funcional

1. Se eliminó por completo el recuadro grande que enumeraba las 32 provincias debajo del mapa.
2. El mapa, el estado de provincia seleccionada, los contadores y las tres secciones de detalle permanecen intactos.
3. Para no perder acceso por teclado o móvil, las 32 provincias siguen disponibles mediante un selector compacto de 44 px integrado en el pie del mapa; ya no ocupan un panel completo.
4. El panel de detalle sube inmediatamente después del mapa y mantiene la misma superficie, color, borde y jerarquía visual de Oculis.
5. En móvil `390 × 844`, no hay desbordamiento horizontal; seleccionar La Romana actualizó el detalle y la región viva a `La Romana: 93 iniciativas; 25 vigentes; 5 congresistas.`
6. No se modificaron la tipografía, el logo, la geometría del mapa, los datos provinciales ni los enlaces de iniciativas y congresistas.
7. Consola del navegador: cero errores y cero advertencias de la aplicación durante la selección y el cambio de viewport.

### Verificación de entrega

- Web typecheck: passed.
- Web tests: `183/183` passed across 29 files.
- Prettier and `git diff --check`: passed.
- Selector expandido anterior ausente del DOM; selector compacto con 32 opciones presente; región de detalle accesible presente.

final result: passed

## HOME — titulares editoriales de Últimos movimientos

This pass implements only the user-approved HOME correction: the compact list formerly labeled “Cambios recientes” now presents each initiative movement as a serious action-first headline, while every row opens the canonical initiative detail with its complete title.

### Visual truth, rendered evidence and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_KELFTM/Screenshot 2026-08-28 at 11.05.59 PM.png` (`1910 × 168` px), dark Spanish state. It shows the previous hierarchy: a nearly complete legal title, a small truncated status column, code/chamber, date and arrow.
- Browser-rendered desktop implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-latest-movements-qa/implementation-desktop-1280x720.png` (`1280 × 720` px from a `1280 × 720` CSS viewport, density `1`).
- Browser-rendered mobile implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-latest-movements-qa/implementation-mobile-390x844.png` (`390 × 844` px from a `390 × 844` CSS viewport, density `1`).
- Focused implementation row: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-latest-movements-qa/implementation-first-row-normalized.png` (`1910 × 182` px). The `944 × 90` rendered row was Lanczos-scaled to the source width without changing its aspect ratio.
- Combined focused comparison: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-latest-movements-qa/source-vs-implementation.png` (`1910 × 350` px), containing source and implementation in one comparison input.
- State: Spanish, dark theme. The source and implementation contain different live initiatives because the official data advanced between captures; comparison is therefore limited to hierarchy, typography, spacing, metadata and interaction structure rather than literal copy matching.

### Comparison history and findings

1. The source exposed a P1 reading problem named by the user: the long official title dominated the row, while the actual movement was small, truncated and visually disconnected.
2. First implementation pass moved the movement into the headline and removed the secondary status column. Runtime review then found two P2 editorial issues in current Senate data: `Depositada` was not normalized, and generic legal wrappers still produced overly long subjects.
3. The second pass added a closed, deterministic presentation grammar for the current source-literal statuses and legal wrappers. It removes only known opening formulas or selects a source clause; it never persists the short form, changes the official title, or creates a lifecycle inference.
4. A focused review found one additional P2: a resolution about glucose monitors initially stopped at the public official’s name, hiding the policy object. The final pass extracts the literal requested object (“LA INCORPORACIÓN DE MEDIDORES CONTINUOS DE GLUCOSA” / its independently reviewed English equivalent).
5. Final comparison: no actionable P0, P1 or P2 finding remains. The movement is the first and accented phrase, the subject is materially shorter, code/chamber/date remain secondary, and the arrow remains the clear navigation affordance.

### Required fidelity surfaces

- Fonts and typography: Manrope remains the interface family. The headline is `17 px` mobile / `18 px` desktop, semibold with a compact `1.35` line height; the movement uses the Oculis accent without reducing its size. Source-uppercase titles remain uppercase rather than silently changing names or acronyms.
- Spacing and layout rhythm: rows are at least `88 px` on desktop and measured `96.5–142.4 px` on mobile according to content. The redundant icon/status columns are removed, leaving a stable subject/date/arrow grid and consistent hairline dividers.
- Colors and visual tokens: existing `--accent`, `--text`, `--text-muted`, `--surface-2` and `--border` tokens are preserved. No new one-off palette was introduced.
- Image quality and asset fidelity: this component contains no raster imagery. The Oculis logo, map, icons and all other assets are unchanged.
- Copy and content: “Últimos movimientos” / “Latest movements” and their CTA are localized. Five current Senate titles received independently reviewed English translations. Unknown procedural values fail closed to the literal Spanish headline rather than producing a mixed or invented English statement.

### Data, interaction, responsive and release verification

- HOME now reads structured initiative status events ordered by effective event time. Agendas cannot enter this list; HOME already presents them in “Agenda próxima”.
- Every movement row has exactly one internal destination: `/initiatives/{id}` with `?lang=en` preserved. There is no external-source fallback in this block.
- Browser click test: the first shortened row opened `/initiatives/27037`; the destination showed the complete official title `PROYECTO DE LEY GENERAL DE ALIANZAS PÚBLICO-PRIVADA, MEDIANTE LA CUAL SE DEROGA LA LEY NÚM 47-20.`
- Desktop `1280 × 720`: five rows, exact dates, no error overlay and `scrollWidth = innerWidth = 1280`.
- Mobile `390 × 844`: `scrollWidth = innerWidth = 390`; every row link measured above `96 px` high and no headline or persistent control overflowed horizontally.
- English runtime: `Latest movements`; the five current rows use reviewed English action and title copy with canonical `?lang=en` destinations.
- Development server log: all inspected HOME and initiative-detail requests returned HTTP `200`; no application error was emitted.
- Web tests: `179/179` passed. Database tests: `60/60` passed.
- Web and database typechecks, ESLint, factual-policy check, Prettier, `git diff --check`, and the Next.js `15.5.24` production build passed.

final result: passed

## HOME — separación entre la lupa y el texto de búsqueda

This pass implements only the screenshot-scoped correction received on 28 August 2026: keep the search placeholder and entered text out from behind the magnifying-glass icon, without changing the topbar dimensions or the rest of HOME.

### Visual truth, state and normalization

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_uNyFrj/Screenshot 2026-08-28 at 5.35.01 PM.png` (`1198 × 134` px), Spanish dark-theme search before the correction.
- Browser-rendered desktop implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/search-spacing-qa/search-after-full.png` (`1039 × 720` capture from a `1280 × 720` CSS viewport in the Codex in-app browser).
- Browser-rendered mobile implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/search-spacing-qa/search-after-mobile-390x844.png` (`390 × 844` px).
- Source-versus-implementation comparison: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/search-spacing-qa/search-source-after.png` (`2086 × 88` px). Both focused search crops were proportionally normalized to the same 88 px height; neither side was stretched.
- Before-versus-after implementation comparison: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/search-spacing-qa/search-before-after.png` (`2088 × 88` px), also normalized to equal 88 px height.
- State: HOME topbar, Spanish, dark theme, empty global initiative search. The English and mobile states were verified separately.

### Findings and comparison history

1. The initial measurement confirmed a P1 legibility defect. The shared `.ui-input` padding shorthand won the cascade over the topbar's non-important spacing utilities, leaving only 12 px of left padding while the 18 px icon occupied the same text area.
2. The correction is isolated to the topbar search input: important left and right spacing utilities now override only that field. No shared form-control token or unrelated input was changed.
3. Desktop after-state: left padding is 37.5 px, the icon ends at 29.25 px relative to the input, and the text begins with an 8.25 px clear gap. Right padding is 60 px, so entered text also remains clear of the overlaid “Buscar” action.
4. Mobile after-state: left padding remains 37.5 px, right padding becomes 41.25 px for the icon-only action, the icon-to-text gap remains 8.25 px, and the page has zero horizontal overflow.
5. The mobile submit action now has the localized accessible name “Buscar iniciativas”; English exposes “Search initiatives”. No actionable P0, P1 or P2 finding remains in this scoped correction.

### Required fidelity surfaces

- Fonts and typography: Archivo, Manrope, sizes, weights and line heights are unchanged. Only the text's internal starting position changed.
- Spacing and layout rhythm: the input's outer box, topbar height, search width, surrounding controls and responsive shell are unchanged. Only safe internal space was added around the existing absolute icon and submit action.
- Colors and visual tokens: no color, border, radius, focus or surface token changed.
- Image quality and asset fidelity: no logo, map, image or raster asset changed. The existing Phosphor search icon remains the same size and position.
- Copy and content: placeholder and visible action copy are unchanged; only an equivalent localized accessible label was added to the submit button.

### Responsive, language and release verification

- Desktop `1280 × 720`: the combined visual comparison confirms the placeholder no longer sits behind the icon; document width equals viewport width.
- Mobile `390 × 844`: the text starts after the icon, the icon-only submit control remains usable and `scrollWidth = clientWidth = 390`.
- English mobile: `<html lang="en">`, placeholder “Search initiatives by code or title”, accessible action “Search initiatives”, 8.25 px icon gap and zero overflow.
- Web typecheck: passed.
- Web tests: `93/93` passed.
- ESLint, Prettier and `git diff --check`: passed.

final result: passed

## Sistema tipográfico ejecutado — Archivo Expanded Black + Manrope

This pass implements the user's 28 August 2026 instruction to make the requested font change visible now, using lawful web-embeddable substitutes because the exact Canva/foundry files are not available in the project.

### Visual truth, implementation and normalization

- Display source truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_HDPW3O/Screenshot 2026-08-28 at 3.38.05 PM.png` (`1766 × 698` px), Canva “Horizon” uppercase specimen.
- Interface source truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_UFVstJ/Screenshot 2026-08-28 at 3.41.48 PM.png` (`942 × 528` px), Canva “Garet” mixed-case specimen.
- Browser-rendered desktop implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/typography-qa/home-fonts-final-desktop-1280x720.png` (`1039 × 720` rendered pixels from a `1280 × 720` CSS viewport in the Codex in-app browser).
- Browser-rendered mobile implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/typography-qa/home-fonts-mobile-390x844.png` (`390 × 844` px at a `390 × 844` CSS viewport).
- Narrow regression capture: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/typography-qa/home-fonts-narrow-320x844.png` (`320 × 844` px).
- Focused display comparison: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/typography-qa/display-font-comparison-final.png` (`1735 × 360` px). The source and implementation title crop were normalized to the same 360 px height and placed in one image.
- Focused interface comparison: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/typography-qa/interface-font-comparison-final.png` (`1906 × 330` px). The source specimen and implementation shell crop were normalized to the same 330 px height and placed in one image.
- State: Spanish, light theme, HOME at the top of “Mapa Oculis”; English was also checked at the same mobile width.

### Typography decision and comparison history

1. Earlier font QA was correctly blocked because no licensed Horizon/Hanson or Garet webfont files existed and the code still loaded Source Serif 4 and Inter. The user then explicitly requested the best executable result available.
2. Exact Garet Book/Heavy requires the official Type Forward email/license flow, the complete weight family requires a Web License, and Canva Horizon/Hanson cannot be extracted for use in this web app. No proprietary font bytes were copied, converted, hotlinked or redistributed.
3. The lawful substitutes are self-hosted by Next at build time:
   - Archivo variable, `900` weight and `125%` width, only for primary AppShell titles and “Mapa Oculis”.
   - Manrope variable for body copy, navigation, controls, cards, names and secondary headings.
   - IBM Plex Mono `400/500` only for technical identifiers.
4. The focused comparison confirms the intended hierarchy: the primary titles are expanded, very black geometric display text, while the rest of the interface is a clean rounded geometric sans close to the Garet specimen. Archivo does not reproduce every proprietary Horizon glyph cut; that is an accepted P3 licensing constraint, not an actionable implementation defect in this approved fallback.
5. The implementation removes the former runtime Google stylesheet and uses `next/font/google`, so all three families are packaged with the application and do not depend on a font request after deployment.

### Required fidelity surfaces

- Fonts and typography: computed desktop styles are Archivo at weight `900`, stretch `125%` for “TABLERO INICIAL” and “MAPA OCULIS”; body computed style is Manrope. `document.fonts.check` returned true for both families. Spanish extended-Latin and English surfaces render without fallback warnings. Long English titles were checked on every principal route; wrapping remains readable.
- Spacing and layout rhythm: no structural dimensions, grids, paddings, radii or component order changed. At `390` px “Mapa Oculis” wraps intentionally into two balanced lines. At `320` px the page title may wrap, but the document width remains exactly the viewport width.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: the Oculis logo, map geometry, images and icons are untouched. The logo remains an image asset and is not affected by typography tokens.
- Copy and content: no label, title, official fact or translation was changed; display text is visually uppercase through CSS only.

### Responsive, language and release verification

- Desktop `1280 × 720`: document `scrollWidth = clientWidth = 1280`; both requested title surfaces fit without collision.
- Mobile `390 × 844`: document `scrollWidth = innerWidth = 390`; the page title and “Mapa Oculis” retain the display face and all body copy uses Manrope.
- Narrow `320 × 844`: document `scrollWidth = innerWidth = 320`; no horizontal overflow.
- English `390 × 844`: `<html lang="en">`, “Main Dashboard” uses Archivo and body uses Manrope, with no horizontal overflow.
- Long-title smoke: Official changes, Agenda, Initiatives, People and bodies in Congress, Regulatory monitoring, and Sources and freshness all use Archivo and remain within the 390 px viewport.
- Browser error overlay after the clean server restart: absent.
- Production build: passed on Next.js `15.5.24`.
- Web typecheck: passed.
- Web tests: `93/93` passed.
- ESLint, Prettier and `git diff --check`: passed.

### Findings

- No actionable P0, P1 or P2 issue remains in this typography scope.
- P3 accepted constraint: Archivo Expanded Black is intentionally a lawful approximation, not an exact copy of the unavailable proprietary Horizon/Hanson glyph design. Manrope is likewise the approved lawful Garet-like substitute until licensed Garet webfont files are supplied.

final result: passed

## HOME — paridad completa de la interfaz ES/EN

This pass implements the 28 August 2026 requirement that changing the interface language translate the complete Oculis presentation layer, including the explicit `Mapa Oculis` → `Oculis Map` correction.

### Rendered evidence and state

- English desktop implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/locale-qa/home-en-desktop.png`, captured from the running HOME in the Codex in-app browser.
- English mobile implementation: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/locale-qa/home-en-mobile-390x844.png` (`390 × 844` px).
- State: `/?lang=en`, dark theme, HOME at the top of the Oculis province map. Initiative, deputies and profile disclosures were also opened and inspected interactively.

### Translation boundary

- Oculis interface copy and structured public values are localized: titles, instructions, counters, navigation, chambers, filed/active labels, legislator roles, constituencies, representation levels, committee offices and the current procedural-status labels.
- Stored values, filters and source provenance remain untouched. Translation happens only in the display layer.
- Proper names and exact public-source content remain source-original: initiative titles, agenda descriptions, legislators, parties, provinces and official committee names. In English mode, Spanish official text is marked with `lang="es"` where it appears in the HOME presentation so assistive technology announces the language change correctly.

### Runtime findings and verification

1. `<html lang="en">`, browser title `Main Dashboard`, visible `MAIN DASHBOARD` and `OCULIS MAP` were confirmed. `Mapa Oculis` is absent from the English DOM.
2. The English methodology contains no untranslated `DEPOSITADO` or `VIGENTE` interface terminology.
3. Expanded initiative rows display `Chamber of Deputies · Filed · Aug 27, 2026`; the earlier `DIPUTADOS · Depositado` mix is absent.
4. The member profile displays `Deputy`, `Constituency 1`, `Chamber of Deputies` and English profile controls. Raw `Diputado` and `Circunscripción 1` no longer appear as interface values.
5. Current HOME procedural statuses display in English, including `Tabled for single reading`, `Audited in single reading`, `Certified in single reading`, `Dispatched after single reading`, `Signed by the President and Secretaries after single reading`, and `Filed`. The original value remains available as non-destructive source provenance.
6. The language-switch accessible label is `Switch to Spanish` in English and `Cambiar a inglés` in Spanish.
7. Spanish regression check: `<html lang="es">`, `Mapa Oculis`, `Cámara de Diputados · Depositado` and Spanish navigation remain correct.
8. Mobile `390 × 844`: `Oculis Map`, English instructions and counters render without horizontal overflow; search and language controls retain English accessible names.

### Release verification

- Production build: passed on Next.js `15.5.24`.
- Web typecheck: passed.
- Web tests: `144/144` passed across 19 files, including the new display-translation contract.
- ESLint, Prettier and `git diff --check`: passed.
- Running preview: HTTP 200 after the production-build check.

final result: passed

## HOME — mapa compacto con detalle provincial lateral

### Verdad visual y estado comparado

- Referencia del usuario: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_rebmoO/Screenshot 2026-08-31 at 4.12.49 PM.png` (`2416 × 892` px, captura Retina del panel provincial completo).
- Implementación desktop: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-side-layout-qa/implementation-final-dark-1280x720.jpg` (`1265 × 712` px capturados; viewport CSS `1280 × 720`).
- Implementación móvil: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-side-layout-qa/implementation-mobile-390x844.jpg` (viewport CSS `390 × 844`).
- Comparación conjunta abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-side-layout-qa/source-vs-implementation.jpg` (`1265 × 1180` px). La referencia se normalizó a `1265px` de ancho y se apiló sobre la implementación.
- Estado desktop comparado: tema oscuro, español, provincia Santiago, sidebar abierto, secciones de detalle cerradas.

### Hallazgos, iteración y correcciones

1. Primera implementación: la información ya estaba al lado del mapa, pero la cuadrícula estadística de tres columnas dejaba una sexta celda visual vacía. Se cambió a una cuadrícula interna de seis pistas: los primeros tres datos ocupan dos pistas y los últimos dos ocupan tres, eliminando el hueco sin alterar los cinco valores.
2. Versión final: mapa compacto de `280 × 320px` dentro de una columna de `280px`; panel de información de `542px`, ambos con el mismo origen vertical. No hay desbordamiento horizontal.
3. El panel conserva encabezado, cinco estadísticas, los tres disclosures y metodología. Ningún dato ni interacción fue eliminado.
4. Al abrir una sección en el modo lateral, esa sección utiliza el ancho completo del panel; los demás encabezados permanecen disponibles.
5. El selector mantiene las 32 provincias y se apila bajo el caption del mapa reducido. “María Trinidad Sánchez” fue verificada en español e inglés sin colisión.
6. El botón del Senado abre su contenido, el nombre del senador abre la burbuja de perfil y el cierre del diálogo funciona. La consola del navegador devolvió cero advertencias y cero errores.
7. Móvil `390 × 844`: mapa y detalle vuelven a apilarse, el selector conserva la provincia larga y `scrollWidth === clientWidth`.

### Superficies de fidelidad

- Tipografía: no se modificaron Archivo, Manrope ni la jerarquía existente.
- Espaciado: composición desktop aproximada `34% / 66%`, con separación responsive de `16–28px`; el panel sigue creciendo naturalmente al desplegar contenido.
- Colores: se conservaron íntegramente los tokens, gradientes, bordes y glass surface de Oculis.
- Imágenes: el mapa Three.js y su fallback permanecen intactos; `ResizeObserver` reajusta cámara y canvas al nuevo contenedor.
- Contenido: Santiago conserva exactamente `502` iniciativas, `208` vigentes, `19` congresistas, `1` senador y `18` diputados.

### Verificación de entrega

- Web typecheck: passed.
- Web tests: `183/183` passed across 29 files.
- ESLint focalizado, Prettier and `git diff --check`: passed.
- Preview local: HTTP 200.

final result: passed

## HOME — composición provincial con gráficos circulares

Esta pasada sustituye exclusivamente los cinco KPI grandes del panel provincial por dos gráficos circulares compactos y conserva todos los valores exactos en texto visible.

### Verdad visual, implementación y normalización

- Referencia del usuario: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_5AmJQw/Screenshot 2026-08-31 at 4.14.17 PM.png` (`882 × 390` px), tema oscuro, español, San Juan. La captura muestra la jerarquía anterior de celdas KPI con `114` iniciativas y `30` vigentes.
- Implementación desktop: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-charts-qa/implementation-desktop-final-1280x720.jpg` (`1265 × 712` px desde un viewport CSS de `1280 × 720`).
- Implementación móvil: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-charts-qa/implementation-mobile-first-390x844.jpg` (viewport CSS `390 × 844`).
- Comparación conjunta abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-province-charts-qa/source-vs-implementation-comparison.jpg` (`1402 × 390` px). La referencia conserva sus `882 × 390` px; la implementación se recortó a `520 × 390` px sin estiramiento.
- Estado de comparación: la referencia muestra San Juan y la captura final del runtime muestra Santo Domingo, porque la provincia inicial de producción sigue siendo Santo Domingo. La comparación se limita por ello a jerarquía, densidad, tamaños, títulos, exactitud part-to-whole y legibilidad; no se afirma equivalencia literal de cifras entre provincias.

### Hallazgos, decisiones y correcciones

1. La referencia presentaba cinco números grandes y separados, pero no hacía visible la relación entre `vigentes` y el total ni la composición de la representación. Se reemplazó la cuadrícula por dos donuts reales de Recharts.
2. El primer donut muestra `vigentes de total` y conserva el denominador en el centro. Su segundo segmento se llama `Otras registradas`, nunca `inactivas`; la aclaración visible explica que puede incluir otra condición oficial o una condición no publicada.
3. El segundo donut muestra la composición exacta entre Senado y Cámara de Diputados, con el total en el centro y ambos conteos en una leyenda permanente.
4. Los números centrales bajaron a `0.96rem` y los valores de leyenda a `0.78rem`, cumpliendo la solicitud de una lectura numérica más pequeña sin ocultar exactitud.
5. Los gráficos son informativos, no botones. No usan tooltip como única evidencia, no tienen animación y no exageran segmentos mediante `minAngle`.
6. El primer render móvil mostró las dos tarjetas apiladas, con `279px` de ancho cada una, cero desbordamiento horizontal y ambas leyendas completas. No fue necesaria una iteración visual adicional: no se detectó ningún P0, P1 o P2.

### Superficies de fidelidad

- Tipografía: se conservan Archivo para los títulos principales y Manrope para el panel. Los títulos de gráfico usan `0.73rem`; las cifras son deliberadamente más pequeñas y tabulares.
- Espaciado y ritmo: los dos gráficos ocupan una cuadrícula de dos columnas en el panel lateral; bajo `420px` internos se apilan. El mapa, selector, disclosures y metodología permanecen en el mismo orden y tamaño.
- Colores: los donuts reutilizan `--accent`, tonos derivados del mismo acento y neutrales de los tokens existentes. No se añadieron gradientes en las marcas ni colores categóricos arbitrarios.
- Imágenes y activos: no se sustituyó ningún activo. El mapa Three.js, su geometría, el logo y los iconos de Oculis permanecen intactos; los círculos son gráficos Recharts reales.
- Copy y contenido: ES muestra `Condición oficial de las iniciativas` y `Representación por cámara`; EN muestra `Official initiative condition` y `Representation by chamber`. La nota evita inferir que todo lo que no tenga condición literal `VIGENTE` está inactivo.

### Datos, accesibilidad, interacción y release

- Cada gráfico tiene un nombre accesible completo con provincia, total y composición; los valores también permanecen en texto visible, por lo que la lectura no depende del color.
- Datos defensivos: conteos negativos o no finitos se normalizan a cero y los fraccionarios se truncan. Si `vigentes` supera el total publicado, el donut falla cerrado, conserva ambos números en texto y explica la inconsistencia sin inventar una proporción.
- Español desktop: ambos SVG de Recharts renderizados, denominadores visibles y `scrollWidth === clientWidth`.
- Inglés desktop: `<html lang="en">`, títulos y explicación completamente traducidos; los nombres accesibles anuncian `641 recorded initiatives` y `43 reported members of Congress` en el estado verificado.
- Móvil `390 × 844`: dos tarjetas apiladas, gráficos de `108 × 108px`, sin colisiones ni overflow.
- Interacción de regresión: los disclosures provinciales siguen abriendo/cerrando; el selector conserva sus 32 opciones y el mapa sigue siendo seleccionable.
- Consola: no apareció un error nuevo de la aplicación en la recarga final. El historial conservó dos mensajes antiguos del reemplazo CSS en caliente, ambos con la misma marca de tiempo anterior a la validación final.
- Web typecheck: passed.
- Web tests: `189/189` passed across 30 files.
- ESLint focalizado, Prettier y `git diff --check`: passed.

final result: passed

## HOME — composición partidaria de la representación provincial

Esta pasada cambia exclusivamente el segundo gráfico circular del detalle provincial: deja de dividir la representación entre Senado y Cámara de Diputados y muestra cuántos congresistas corresponden a cada partido publicado por la fuente.

### Verdad visual, implementación y normalización

- Referencia del usuario: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_ZivbBK/Screenshot 2026-08-31 at 4.53.59 PM.png` (`682 × 372` px, captura Retina del gráfico anterior “Representación por cámara”).
- Implementación desktop completa: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-party-chart-qa/home-desktop-2048-final.png` (`2048 × 1200` px; viewport CSS `2048 × 1200`, densidad 1).
- Implementación móvil ES: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-party-chart-qa/home-mobile-390-final.png` (viewport CSS `390 × 844`).
- Implementación móvil EN: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-party-chart-qa/home-mobile-390-en-final.png` (viewport CSS `390 × 844`).
- Comparación conjunta abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-party-chart-qa/source-vs-party-chart.png` (`694 × 186` px). La referencia Retina se normalizó de `682 × 372` a `341 × 186`; el recorte de implementación de `340 × 178` se centró sin estirarlo en un marco de `341 × 186`.
- Estado comparado: tema oscuro, español, Santo Domingo, tarjetas provinciales cerradas. A la izquierda aparece el gráfico anterior por cámara; a la derecha, el gráfico final por partido.

### Hallazgos, iteración y correcciones

1. La primera captura a `1280px` mostraba correctamente PRM `28`, FP `12` y PLD `3`, pero la palabra “Congresistas” dentro del anillo era demasiado ancha. Se mantuvo el número `43` y se cambió la etiqueta central a `Total`, eliminando la colisión sin agrandar el gráfico.
2. La versión final conserva el mismo contenedor, borde, radio, tamaño del anillo y jerarquía de la referencia. Solo cambia la dimensión analítica solicitada.
3. Cada partido conserva su etiqueta literal publicada y un conteo visible. Los colores son categorías estables de Oculis, no colores oficiales de partidos, y la lectura no depende de ellos.
4. Los registros sin partido se agrupan únicamente como `Partido no informado` / `Party not reported`; no se infiere afiliación ni se eliminan del denominador.
5. En el snapshot actual, Santo Domingo reconcilia `28 + 12 + 3 = 43`; Santiago reconcilia `12 + 3 + 2 + 2 = 19`; Hato Mayor muestra PRM `3` de un total de `3`.

### Superficies de fidelidad

- Tipografía: título a `0.73rem`, valores de leyenda a `0.78rem` y total central a `0.96rem`; se preservan Archivo y Manrope del sistema existente.
- Espaciado y ritmo: el gráfico y su leyenda siguen en dos columnas dentro de la tarjeta desktop. A `390px`, las dos tarjetas de composición se apilan y los nombres/valores no se recortan.
- Colores y tokens: siete posiciones categóricas derivadas de los tokens Oculis, con una categoría neutral reservada para partido no informado. No se usan colores semánticos de éxito, alerta o error.
- Imágenes y activos: no se sustituyó ni añadió ningún activo raster. Logo, mapa Three.js, geometría e iconos quedan intactos; el anillo sigue siendo un gráfico Recharts real.
- Copy y contenido: ES muestra `Congresistas por partido`; EN muestra `Members of Congress by party`. La nota visible aclara que los conteos usan el partido publicado por la fuente.

### Datos, accesibilidad, interacción y release

- La agrupación solo elimina espacios exteriores y conserva etiquetas distintas sin coincidencias por nombre, alias ni inferencias. Ordena por cantidad descendente y luego por etiqueta; la categoría no informada permanece al final.
- El gráfico final anuncia: `Santo Domingo: 43 congresistas reportados por partido. PRM: 28; FP: 12; PLD: 3.` En inglés anuncia el equivalente completo.
- Los valores exactos permanecen en un `<dl>` visible. No hay tooltip obligatorio, animación ni dependencia exclusiva del color.
- Desktop `1280 × 720` y `2048 × 1200`: sin desbordamiento horizontal.
- Móvil `390 × 844`: sin overflow; anillo, leyenda, total y nota completos.
- Idioma inglés: `<html lang="en">`, título, total, nota y nombre accesible traducidos; las siglas partidarias permanecen como datos propios de la fuente.
- Consola de la recarga final: cero advertencias y cero errores.
- Web typecheck: passed.
- Web tests: `192/192` passed across 30 files.
- ESLint focalizado, Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — mapa territorial ampliado 30%

Esta pasada aplica el boceto entregado por el usuario al bloque territorial: el mapa continúa a la izquierda, la provincia y sus gráficos permanecen a la derecha y la geometría visible del mapa aumenta 30% en escritorio sin alterar datos, interacciones ni el comportamiento móvil.

### Fuente visual y comparación

- Referencia original: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/codex-clipboard-147446fd-018e-48ed-a37f-bde02c7d75b6.png`.
- Referencia normalizada y orientada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-map-30pct-qa/source-upright-1400.png` (`1400 × 787` px).
- Estado anterior medido: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-map-30pct-qa/before-1280x720.png`; el mapa ocupaba `280 × 322px` dentro de un workspace de `847.2px`.
- Implementación final desktop `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-map-30pct-qa/after-1280x720-final.png`; mapa `364 × 322px`, panel derecho `472.6px` y cero overflow horizontal.
- Implementación final desktop `2048 × 1200`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-map-30pct-qa/after-2048x1200-final.png`; mapa `489.6 × 382px`, panel derecho `645.4px` y cero overflow horizontal.
- Implementación móvil `390 × 844`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-map-30pct-qa/after-390x844.png`; mapa y panel apilados, ancho útil `330px` y `scrollWidth === clientWidth`.
- Comparación conjunta abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-map-30pct-qa/source-vs-implementation.png` (`2560 × 720` px). El boceto normalizado y la implementación final se colocaron lado a lado a la misma altura.

### Medición y decisión de layout

1. La distribución anterior era `0.72fr / 1.45fr`: el mapa recibía `33.18%` del ancho disponible. El nuevo reparto es `0.936fr / 1.234fr`, equivalente a `43.13%`; `43.13 / 33.18 = 1.30`.
2. El mínimo desktop del mapa pasó de `280px` a `364px`, exactamente `+30%`. A `1440px` pasa aproximadamente de `328.8px` a `427.5px`, y a `2048px` de `376.6px` a `489.6px`.
3. La altura del canvas conserva `clamp(280px, 25vw, 380px)`. Esto evita alargar artificialmente la tarjeta: la cámara ortográfica fija el ancho de diseño y, por tanto, el modelo 3D crece 30% tanto horizontal como verticalmente al crecer la columna.
4. No se modificaron cámara, proyección, geometría, escalas, elevación de provincia, raycasting ni activos. `ResizeObserver` actualiza automáticamente el renderer y mantiene alineados hover y selección.
5. Para proteger el panel derecho más estrecho, hasta `1500px` las últimas iniciativas ocupan la primera fila completa y Senado/Diputados comparten la segunda. Por encima de ese ancho se conservan las tres columnas.

### Fidelidad, responsive e interacción

- El orden del boceto se conserva: mapa grande a la izquierda; provincia, composición de iniciativas, partidos y accesos de iniciativas/Senado/Diputados a la derecha.
- No se modificaron logo, tipografías, colores, glass surface, gráficos, textos, metodología ni datos.
- Sidebar abierto: verificado sin overflow a `2048`, `1440`, `1280`, `1180`, `1100`, `900`, `860` y `390px`. Sidebar cerrado a `1280px`: mapa `474.7px`, panel `625.9px`, sin overflow.
- Móvil conserva el breakpoint apilado y el mapa de `330 × 247px`; la ampliación se limita a la composición lateral de escritorio.
- El selector cambió correctamente de Santo Domingo a Santiago; el encabezado, los dos gráficos y sus datos se actualizaron de forma sincronizada.
- Los tres disclosures conservaron sus estados `aria-expanded`, abrieron una sola región a la vez y no alteraron el ancho del documento.
- Inglés: `<html lang="en">`, título `Oculis Map`, títulos de ambos gráficos y accesos completamente localizados; sin pérdida de layout.
- HOME respondió HTTP `200` tanto en español como en inglés; no apareció overlay de error durante las recargas e interacciones finales.

### Verificación técnica

- Web typecheck: passed.
- Web tests: `192/192` passed across 30 files.
- Root ESLint: passed.
- Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — eliminación de la tarjeta “Cambio verificado”

### Referencia y evidencia visual

- Referencia entregada por el usuario: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_muChBU/Screenshot 2026-08-31 at 4.20.43 PM.png` (`1636 × 886` px). El objetivo era retirar por completo la tarjeta editorial grande “Cambio verificado”.
- Estado anterior capturado en `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-verified-card-removal-qa/before-1280x720.png`.
- Implementación final desktop `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-verified-card-removal-qa/after-1280x720.png`.
- Implementación final móvil `390 × 844`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-verified-card-removal-qa/after-390x844.png`.
- Comparación conjunta abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-verified-card-removal-qa/source-vs-implementation.png` (`2610 × 720` px) y su versión normalizada `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-verified-card-removal-qa/source-vs-implementation-1600.png` (`1600 × 441` px).

### Alcance y resultado

1. La tarjeta completa “Cambio verificado” fue retirada de HOME, incluidos el título destacado, estado, código, cámara, fecha y sus dos acciones.
2. Se eliminó la consulta de feed que HOME ejecutaba exclusivamente para construir esa tarjeta y también el código de presentación que quedó sin consumidores.
3. “Agenda próxima” y “Últimos movimientos” permanecen en el mismo orden. La agenda ahora ocupa el ancho completo para evitar un espacio vacío, sin alterar todavía sus filas, texto, enlaces, jerarquía ni interacciones; su rediseño queda deliberadamente reservado para la próxima revisión con el usuario.
4. “Últimos movimientos” conserva sus cinco filas y el primer movimiento real ya no se pierde por la deduplicación que dependía de la tarjeta eliminada.
5. No se modificaron el Mapa Oculis, el logo, la navegación, tipografías, colores ni la experiencia del feed en otras rutas.

### Responsive, idioma y navegación

- Desktop `1280 × 720`: agenda de `941px` de ancho, seguida inmediatamente por “Últimos movimientos”; no hay columna ni hueco residual.
- Móvil `390 × 844`: agenda de `360px` de ancho, sin desbordamiento horizontal; eliminar el hero reduce el desplazamiento necesario para llegar a la agenda.
- Español e inglés: no aparecen “Cambio verificado”, “Verified change” ni sus estados vacíos anteriores. Se conservan `Agenda próxima` / `Upcoming agenda` y `Últimos movimientos` / `Latest movements`.
- Los enlaces exactos de agenda y el acceso a la agenda completa permanecen activos y conservan `lang=en` en inglés.
- Jerarquía visible verificada: `Mapa Oculis` → `Agenda próxima` → `Últimos movimientos`.

### Verificación técnica

- Web typecheck: passed.
- Web tests: `192/192` passed across 30 files.
- Root ESLint: passed.
- Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — invitación al Directorio de Congresistas

### Referencia e intención

- Boceto entregado por el usuario: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/codex-clipboard-19cd0654-ac77-4c2c-9c3f-5c25446d236c.png` (`1600 × 1322` px).
- El requerimiento principal se interpretó como un módulo nuevo inmediatamente debajo del Mapa Oculis: la mitad izquierda funciona como un anuncio/botón grande hacia el directorio y la mitad derecha presenta retratos oficiales interactivos.
- Comparación normalizada del boceto y la implementación, abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-promo-qa/source-vs-implementation.png` (`1874 × 720` px).

### Evidencia visual

- Tema oscuro, español, `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-promo-qa/desktop-1280x720-final.png`.
- Tema claro, español, `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-promo-qa/light-1280x720-final.png`.
- Tema claro, español, `2048 × 1200`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-promo-qa/light-2048x1200.png`.
- Móvil final, español, `390 × 844`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-promo-qa/mobile-390x844-final.png`.
- Se inspeccionaron visualmente la comparación, el estado oscuro final, el estado claro final y el estado móvil final.

### Resultado de diseño

1. En escritorio el módulo usa dos columnas exactamente iguales. A `1280px`, el contenedor mide `941px` y cada mitad `469.5px`; a `2048px`, mide `1245px` y cada mitad `621.5px`.
2. La mitad izquierda completa es un único enlace interno grande, no un botón pequeño dentro de una tarjeta. Su titular es “Visita el Directorio de Congresistas” y conserva una jerarquía editorial de anuncio con descripción, acción y movimiento de flecha al pasar el puntero.
3. La mitad derecha muestra cinco retratos oficiales en un arco visual. La selección es estable y neutral: combina ambas cámaras y procura variedad de partidos/provincias publicados sin usar aleatoriedad ni establecer una clasificación política.
4. Los retratos provienen de los dominios oficiales de la Cámara de Diputados y el Senado. Los cinco cargaron correctamente en QA con dimensiones naturales reales; si una fuente deja de servir una imagen, el componente falla de forma segura a iniciales.
5. Cada retrato es un botón de perfil de Oculis. El clic probado en HOME no cambió la URL, abrió un diálogo accesible, trasladó el foco a “Cerrar” y, al cerrarlo, devolvió el foco al retrato. El único acceso al perfil oficial permanece dentro de esa burbuja.
6. El anuncio navega correctamente a `/congreso` en español y a `/congreso?lang=en` en inglés. La versión inglesa usa copy completamente localizado y mantiene `<html lang="en">`.
7. En móvil, la galería de retratos aparece antes del anuncio para seguir la lectura del boceto. El primer pase detectó un recorte del titular; se redujo de forma localizada su escala tipográfica y el estado final a `390 × 844` conserva el texto completo, los cinco retratos y cero desbordamiento horizontal.
8. Animaciones y transiciones se desactivan con `prefers-reduced-motion`. Los retratos tienen nombres accesibles completos, controles de al menos 44px y estados visibles de foco.
9. No se modificaron el logo de Oculis, el mapa, la agenda ni “Últimos movimientos”. La nueva sección queda entre el mapa y la agenda, como solicitó el usuario.

### Datos, rendimiento y seguridad factual

- El repositorio incorpora una consulta estrecha que selecciona únicamente `profileId`, fuente, nombre, cámara, rol, partido, provincia y URL de foto de legisladores activos.
- Antes de cruzar al cliente, las fotografías se validan contra el dominio oficial correspondiente. No se serializan contactos, profesión ni la URL del perfil oficial en esta vista previa.
- Se solicitan candidatos por cámara y se envían solo cinco retratos al componente; no se cargan perfiles completos ni se hacen cinco consultas individuales al montar HOME.
- La selección de retratos es determinista, no muta sus entradas y tiene cobertura específica de deduplicación, diversidad y límites inválidos.

### Responsive, interacción y consola

- Verificado en `2048 × 1200`, `1280 × 720` y `390 × 844`, además de temas claro/oscuro e idiomas ES/EN.
- Cero desbordamiento horizontal en todos los estados finales medidos.
- Los retratos cargaron desde `www.diputadosrd.gob.do` y `www.senadord.gob.do` sin fallos.
- La consola final no contiene errores ni advertencias de la aplicación; solo mensajes informativos estándar de React DevTools/Fast Refresh del entorno de desarrollo.
- La vista final se dejó abierta en HOME, tema oscuro, con el nuevo módulo centrado.

### Verificación técnica

- DB typecheck: passed.
- Web typecheck: passed.
- DB tests: `60/60` passed.
- Web tests: `198/198` passed across 32 files.
- Root ESLint: passed.
- Factual-policy check: passed.
- Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — perfiles legislativos, cifras vinculadas y retratos rotativos

### Referencia e intención

- Referencia entregada por el usuario: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_9qshZE/Screenshot 2026-08-31 at 6.54.57 PM.png` (`1220 × 880` px).
- El alcance fue ajustar la promesa editorial del módulo, ampliar la ficha del legislador con hechos públicos y conteos de iniciativas defendibles, detener el movimiento continuo de los retratos y variar las cinco personas en cada recarga completa.
- Comparación conjunta fuente/implementación abierta e inspeccionada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-profile-qa/comparison-source-vs-implementation.jpg` (`1630 × 650` px).

### Evidencia visual

- Implementación final desktop, español, `1280 × 720`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-profile-qa/implementation-desktop-final-1280x720.jpg`.
- Perfil completo desktop con retrato cargado: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-profile-qa/profile-desktop-loaded-1280x900.jpg`.
- Módulo final móvil, `390 × 844`: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-profile-qa/implementation-mobile-390x844-final.jpg`.
- Perfil móvil, cabecera y datos públicos: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-profile-qa/profile-mobile-390x844.jpg`.
- Perfil móvil desplazado hasta cifras y comisiones: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-directory-profile-qa/profile-mobile-stats-390x844.jpg`.

### Copy, perfiles e integridad factual

1. El titular derecho cambió de “Conoce a quienes te representan” a “Todo lo que necesitas saber de los legisladores”; en inglés usa “Everything you need to know about legislators”. El anuncio izquierdo conserva “Visita el Directorio de Congresistas”.
2. La descripción del anuncio ahora anticipa exactamente partido, cargos en comisiones, contacto público disponible e iniciativas depositadas vinculadas por Oculis.
3. La burbuja conserva cámara, provincia, partido expandido, período, circunscripción, nivel de representación, profesión, correo público, teléfono público, comisiones y cargo dentro de cada comisión.
4. Para diputados, la sección “Iniciativas depositadas” presenta tres cifras del mismo universo verificable: depositadas vinculadas, vigentes y no marcadas vigentes. La suma de las dos últimas siempre coincide con el total.
5. El vínculo se hace exclusivamente mediante el identificador oficial de persona publicado por el SIL, incluyendo proponentes principales y coproponentes, y cada iniciativa se cuenta una sola vez. Nunca se empata por nombre.
6. La cobertura histórica de proponentes no es completa, por lo que el texto visible identifica las cifras como un mínimo verificable. “No marcadas vigentes” reúne otras condiciones oficiales o ausencia de condición publicada y no significa “archivadas”.
7. El Senado no publica un identificador de persona compatible con el de su ficha de iniciativas. En esos perfiles la interfaz explica la limitación y no presenta ceros falsos.
8. En inglés se verificaron `Filed initiatives`, `Linked filed`, `Active` y `Not marked active`, junto con la nota metodológica localizada. Los nombres propios, siglas y denominaciones partidarias oficiales permanecen intactos.

### Retratos, interacción y responsive

- Se eliminó la animación infinita que modificaba el margen vertical de los retratos. Durante una medición superior a `5.2s`, los cinco rectángulos conservaron exactamente sus coordenadas y `animation-name` fue `none`.
- Hover y foco conservan una respuesta breve y controlada; `prefers-reduced-motion` continúa desactivando transiciones decorativas.
- Dos recargas consecutivas produjeron conjuntos distintos: `141,212,145,204,23` y `23,200,22,203,16`. La selección ocurre en el servidor por petición, evita saltos de hidratación, elimina duplicados y conserva la composición tres diputados/dos senadores.
- Cada retrato sigue siendo un botón de perfil: el clic no modifica la URL, abre una sola burbuja, lleva el foco a “Cerrar” y mantiene el enlace oficial únicamente dentro del diálogo.
- Desktop y móvil conservan cinco retratos, nombres accesibles completos y expansión partidaria `SIGLA (Nombre completo)`.
- A `390 × 844`, el diálogo mide `360px`, usa scroll interno, conserva controles de al menos 44px y el documento mantiene `scrollWidth === clientWidth === 390`.
- La versión inglesa entrega `<html lang="en">`, `Main Dashboard`, el nuevo titular traducido y la ficha completa localizada sin desbordamiento horizontal.
- Consola final: cero errores y cero advertencias.

### Verificación técnica

- DB typecheck: passed.
- Web typecheck: passed.
- DB tests: `60/60` passed.
- Web tests: `234/234` passed across 35 files.
- Root ESLint: passed.
- Factual-policy check: passed.
- Production build: passed.
- `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## Burbuja del congresista — acceso a iniciativas depositadas

### Resultado y contrato factual

- La burbuja de un diputado con identidad oficial exacta incorpora la acción interna “Ver iniciativas depositadas”; en inglés usa “View filed initiatives”.
- La acción abre `/initiatives?legislator=<profileId>` y conserva `lang=en` cuando corresponde. El identificador específico de la fuente permanece exclusivamente en el servidor.
- El catálogo incluye iniciativas con fecha de depósito publicada en las que la persona figure como proponente o coproponente mediante su `legisladorId` oficial. No se empata por nombre y cada iniciativa se cuenta una sola vez.
- El destino no añade `status=Depositado`: una iniciativa depositada puede tener hoy otro estado oficial. El total de la ficha y el total del catálogo usan el mismo universo y el mismo criterio de precedencia de datos.
- La cabecera del filtro explica el alcance de proponente/coproponente y muestra un chip removible “Proponente: …” / “Sponsor: …”. Búsqueda, filtros, paginación e idioma conservan el perfil seleccionado.
- Los perfiles del Senado no muestran la acción porque la fuente no publica un identificador de persona compatible; la burbuja explica la limitación y no presenta ceros falsos.
- Parámetros vacíos, no canónicos o manipulados, como `legislator=` y `legislator=0001`, fallan cerrados en la página de no encontrado.

### Evidencia visual y responsive

- Perfil desktop con la nueva acción: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/legislator-initiatives-cta-qa/profile-cta-desktop-1280x720.png`.
- Catálogo filtrado desktop: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/legislator-initiatives-cta-qa/catalog-filtered-desktop-1280x720.png`.
- Perfil móvil con la acción visible: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/legislator-initiatives-cta-qa/profile-cta-mobile-390x844.png`.
- Catálogo filtrado móvil: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/legislator-initiatives-cta-qa/catalog-filtered-mobile-390x844.png`.
- A `390 × 844`, la acción mide exactamente `44px` de alto, el diálogo conserva scroll interno y `scrollWidth === innerWidth === 390`.
- En la validación desktop de Fiordaliza Estévez Castillo, la burbuja mostró `39` depositadas vinculadas y el catálogo filtrado mostró exactamente `39` resultados.
- En inglés se verificaron el nombre accesible, la URL con `lang=en`, la explicación, el chip y `<html lang="en">`.

### Verificación técnica

- DB typecheck: passed.
- Web typecheck: passed.
- DB tests: `61/61` passed.
- Web tests: `240/240` passed across 36 files.
- Root ESLint: passed.
- Factual-policy check: passed.
- Production build: passed.
- Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — composición y directorio apilados

### Resultado visual

- La composición partidaria ocupa ahora la primera fila completa y el Directorio del Congreso aparece inmediatamente debajo, también a ancho completo.
- A `1280 × 720` con la barra lateral abierta, ambos módulos miden exactamente `941px`; no queda una columna vacía ni se comprime el hemiciclo, la leyenda o el contenido del directorio.
- El selector liquid-glass conserva Senado y Cámara de Diputados. La prueba en navegador cambió correctamente de `32` a `189` integrantes y mantuvo el tab seleccionado.
- Los cinco retratos continúan abriendo primero la burbuja de Oculis sin cambiar la URL. El logo y los demás bloques de HOME permanecen intactos.
- El documento no presenta desbordamiento horizontal y la consola limpia no registró errores ni advertencias de la aplicación.

### Evidencia

- Composición a ancho completo: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-stacked-qa/stacked-desktop-1280x720.png`.
- Directorio a ancho completo: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-stacked-qa/directory-stacked-desktop-1280x720.png`.
- Banda completa, en el nuevo orden: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-stacked-qa/stacked-band-full.png`.
- Comparación entre la referencia recibida y el resultado: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/chamber-composition-stacked-qa/comparison-reference-vs-stacked.png`.

### Verificación técnica

- Web typecheck: passed.
- Web tests: `254/254` passed across 39 files.
- Root ESLint: passed.
- Factual-policy check: passed.
- Production build: passed.
- Prettier y `git diff --check`: passed.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed

## HOME — eliminación de “Agenda próxima”

### Resultado visual y alcance

- Se eliminó por completo de HOME el cuadro “Agenda próxima”, incluidas sus tres filas, sus accesos “Abrir agenda” y “Ver toda la agenda” y el espacio interno que lo separaba de “Últimos movimientos”.
- El bloque “Últimos movimientos” ocupa ahora directamente la siguiente posición después del Directorio del Congreso, conservando el margen normal de sección y su divisor superior.
- No se modificaron la ruta `/hoy`, las fichas `/agenda/:id`, la navegación lateral ni ningún origen de datos compartido por esas páginas.
- HOME dejó de consultar y ordenar la ventana de actividad de veintiún días que solo alimentaba el cuadro eliminado.

### Evidencia y comparación

- Referencia preservada: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-agenda-removal-qa/reference-agenda-proxima.png` (`2606 × 962`).
- Implementación final: `/Users/maxpena/Documents/Codex/2026-08-27/a/work/oculis-platform/work/home-agenda-removal-qa/implementation-final-1440x1000.jpg` (`1440 × 1000`, viewport CSS `1440 × 1000`, densidad `1`).
- Estado: español, tema oscuro, HOME con datos locales del 1 de septiembre de 2026.
- La comparación conjunta verifica la ausencia total del cuadro y muestra el nuevo encuentro entre Directorio y Últimos movimientos. No fue necesario un recorte adicional: el screenshot final hace legibles el borde inferior del Directorio, el espaciado resultante y el encabezado/listado de movimientos.
- No se detectó ningún P0, P1 o P2 en el primer pase; no fue necesario un ciclo de corrección visual.

### Superficies de fidelidad

- Tipografía: no cambió ninguna familia, peso, tamaño, interlineado ni tratamiento de títulos en los bloques conservados.
- Espaciado: el wrapper de sección mantiene `45px` en móvil y `60px` desde `sm`; no queda `min-height`, track de grid, `aside` vacío ni separación residual de la agenda.
- Colores y tokens: las superficies, bordes, contraste, estados y temas de Directorio y Últimos movimientos permanecen intactos.
- Imágenes y activos: no se sustituyó ni alteró ningún retrato, logo, icono o activo de HOME.
- Copy: desapareció únicamente el copy de Agenda próxima; “Últimos movimientos” y sus destinos canónicos siguen presentes en español e inglés.

### Responsive, interacción y verificación

- Español `390 × 844`: Agenda próxima ausente, Últimos movimientos presente y sin desbordamiento horizontal.
- Inglés `1280 × 900`: Upcoming agenda ausente, Latest movements presente y `<html lang="en">` correcto.
- `/hoy?lang=en` conserva su `h1` “Agenda”, no presenta alerta de error y mantiene la navegación funcional.
- La consola terminó sin errores ni advertencias.
- Prueba focalizada: `2/2` pasó.
- Suite web completa: `270/270` pruebas pasaron en `40` archivos.
- Web typecheck: pasó.
- ESLint focalizado, Prettier y `git diff --check`: pasaron.

No queda ningún hallazgo P0, P1 o P2 dentro de este alcance.

final result: passed
