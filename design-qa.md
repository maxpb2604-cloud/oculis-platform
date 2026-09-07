# Design QA — Comisiones & Agendas

## Comparison

- Reference: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/codex-clipboard-5a7aa9bf-7bfe-41a7-9452-d161462e3d10.png`
- Browser implementation: `http://localhost:3001/hoy?date=2026-09-04&view=week`
- Primary comparison viewport: 2048 × 1128, Spanish, dark theme, Cámara de Diputados.
- Responsive pass: 390 × 844, Spanish, dark theme.
- Agenda-detail reference: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_eDeu5C/Screenshot 2026-09-04 at 9.51.15 AM.png` (3456 × 2234 source pixels, light theme).
- Agenda-detail implementation: `http://localhost:3001/agenda/696?chamber=senado&date=2026-07-23&view=week`, captured in Codex in-app Browser tab 4 at 1979 × 1280 CSS pixels, device scale factor 1, light theme.
- Agenda-detail responsive pass: `http://localhost:3001/agenda/1952?date=2026-09-04&view=day`, 390 × 844 CSS pixels, device scale factor 1, dark theme.

## Results

- Typography and color preserve the existing Oculis display/body hierarchy and design tokens.
- The requested information order is present: chamber selector, calendar controls, selected-period calendar, selected-day agenda, then the full commission directory.
- Month, week, and day are three real calendar views. Their segmented control, natural previous/next navigation, counts, meeting links, selected date, chamber selection, and URL state were exercised in the browser.
- Long official commission names wrap without collision. The three views remain usable at mobile width; the weekly view stacks days and the daily view expands its meeting row to the full available width.
- Agenda-detail navigation preserves the originating month/week/day view when the user returns to the calendar.
- Agenda details now lead with a clearly labelled “Temas pautados” block. Literal source copy, exact initiative links, and bare expediente references are separated so the interface never implies an unsupported relationship.
- The focused agenda-topic region was compared at desktop and mobile sizes because the long initiative title and factual disclaimer are too small to judge from the full-page capture alone. Both wrap without overlap or horizontal overflow.
- The existing fonts, spacing, accent tokens, Phosphor icons, and card radii are preserved. No new image asset was introduced; the supplied logo and existing shell imagery remain unchanged.
- Spanish and English copy explicitly distinguishes what was scheduled in the agenda from what was actually debated or decided.
- Public-agenda styling is only applied when an exact validated official agenda link exists; a published meeting without that link remains visually distinct.
- Keyboard-visible controls use semantic links, buttons, search fields, labelled toggles, and a focus-managed modal. Mobile controls retain practical tap targets.
- No browser console errors were present in the final pass.
- Intentional deviation from the supplied screen: the prior date-strip and two-column activity feed were replaced by the calendar-first and commission-directory structure requested by the user. This iteration adds month/week/day viewing without changing that hierarchy.

## Iteration history

- The initial daily-view screenshot showed a single meeting constrained to half the content area. The daily layout was corrected to one full-width column and rechecked at desktop and mobile sizes.
- Post-fix comparison at 2048 × 1128 confirms the weekly seven-day overview, metrics, selected-day panel, and chamber selector align without clipping or overlap.
- Post-fix responsive comparison at 390 × 844 confirms the view selector and period metrics fit without horizontal overflow, and weekly meeting cards remain legible and clickable.
- The initial agenda-detail screen grouped the official subject under the generic title “Contenido de la reunión”, which did not make the scheduled topics scannable. It was replaced with a dedicated agenda hierarchy: published topic, linked initiatives, literal expediente references, and a provenance caveat.
- Post-fix evidence at 1979 × 1280 confirms the new block aligns with the source page's two-column content/evidence layout. Post-fix evidence at 390 × 844 confirms the topic, long initiative title, notice, copy action, and evidence card stack cleanly.

## Verification

- Web tests: 366 passed across 52 files.
- TypeScript: passed.
- Targeted ESLint: passed.
- Factual-data policy check: passed.
- `git diff --check`: passed.

## Iteration — Directorio de comisiones sin agendas

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_Xx6klJ/Screenshot 2026-09-04 at 3.29.00 PM.png` (2436 × 344 source pixels; displayed at 2048 × 289 after attachment normalization).
- Implementation target: `http://localhost:3001/congreso?view=committees&chamber=diputados`.
- Intended state: Spanish, light theme, one commission expanded so the member list begins immediately below the card header.
- Full-view comparison: blocked because the Codex in-app Browser cannot capture the local implementation while the Mac is locked.
- Focused-region comparison: blocked for the same reason. The source region was opened successfully and shows the agenda heading, explanatory copy, warning state, and divider that must be absent.
- Code and HTTP evidence: the expanded card now renders `Integrantes` directly; the agenda section, linked-agenda count, warning, supporting imports, page subtitle references, and metadata references were removed. The local route returns HTTP 200 and contains none of the removed copy.
- Automated verification: 373 web tests across 56 files passed; TypeScript, targeted ESLint, and `git diff --check` passed.

**Findings**

- [P2] Browser-rendered visual evidence is unavailable until the Mac is unlocked.
  Location: local in-app Browser capture.
  Evidence: repeated Browser connection attempts return `The Mac is locked and automatic unlock could not unlock it.`
  Impact: spacing and the expanded interaction state cannot receive the required visual sign-off.
  Fix: unlock the Mac, open one commission, capture the updated region, check the console, and compare it with the supplied source.

**Open Questions**

- None about scope: the agenda material was removed only from the Congress directory; the dedicated Comisiones & Agendas experience remains intact.

**Implementation Checklist**

- [x] Remove the agenda section from expanded commission cards.
- [x] Remove linked-agenda counts and agenda-specific directory copy.
- [x] Keep member profiles and official composition unchanged.
- [x] Pass automated validation.
- [ ] Complete browser-rendered visual comparison after the Mac is unlocked.

**Follow-up Polish**

- None identified from the source crop.

## Iteration — Selección de fecha abre la vista diaria

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_hkLxP5/Screenshot 2026-09-04 at 3.32.11 PM.png` (1708 × 1048 source pixels).
- Implementation target: `http://localhost:3001/hoy?date=2026-09-04`.
- Intended state: Spanish, light theme, monthly calendar. Selecting a numbered date must navigate to that date with `view=day`; selecting a meeting must continue opening the meeting detail.
- Full-view comparison: blocked because the Codex in-app Browser still reports that the Mac is locked.
- Focused-region comparison: blocked for the same reason. The supplied calendar region was available and required no visual restyling.
- Code and HTTP evidence: month and week date selectors now call `pageHref` with `view: "day"`; the monthly `+N más` link already follows the same daily destination. Local server output contains 30 unique September date links with `view=day`, including `/hoy?date=2026-09-04&view=day`.
- Automated verification: 374 web tests across 57 files passed; TypeScript, targeted ESLint, and `git diff --check` passed.

**Findings**

- [P2] The final browser interaction and console check remain unavailable while the Mac is locked.
  Location: monthly and weekly calendar date selectors.
  Evidence: the Browser connection returns `The Mac is locked and automatic unlock could not unlock it.`
  Impact: the rendered route transition cannot receive the required visual and interaction sign-off.
  Fix: unlock the Mac, click a date in month view and a weekday header in week view, verify the daily view and browser console, then capture the final state.

**Implementation Checklist**

- [x] Route month date selection to `view=day`.
- [x] Route week date selection to `view=day`.
- [x] Preserve direct meeting-detail navigation.
- [x] Add regression coverage and pass the automated suite.
- [ ] Complete in-app Browser interaction verification after unlock.

## Iteration — Nombre del directorio en la navegación

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_yggDXS/Screenshot 2026-09-04 at 3.34.07 PM.png`.
- Implementation target: the `/congreso` item in the shared sidebar at `http://localhost:3001/`.
- Intended state: Spanish sidebar label changed from `Legisladores y comisiones` to `Directorio de Congresistas`, with its existing route, icon, selected state, spacing, and typography preserved.
- Full-view comparison: not required for this text-only scoped change; the supplied focused crop fully contains the edited control.
- Focused-region comparison: blocked because the Codex in-app Browser still reports that the Mac is locked.
- Code evidence: the shared sidebar now renders `Directorio de Congresistas` in Spanish and `Congressional Directory` in English. Regression coverage confirms both labels and the removal of the previous names.
- Automated verification: 375 web tests across 57 files passed; TypeScript, targeted ESLint, and `git diff --check` passed.

**Findings**

- [P2] The browser-rendered label and console check remain unavailable while the Mac is locked.
  Location: shared sidebar `/congreso` navigation item.
  Evidence: the Browser connection returns `The Mac is locked and automatic unlock could not unlock it.`
  Impact: the final focused visual comparison cannot be signed off.
  Fix: unlock the Mac, capture the sidebar, and verify the label at desktop and narrow widths.

**Implementation Checklist**

- [x] Change the Spanish sidebar label.
- [x] Update the English equivalent.
- [x] Preserve route, icon, selected state, and layout classes.
- [x] Add regression coverage and pass the automated suite.
- [ ] Complete in-app Browser visual verification after unlock.

## Iteration — Retiro de Consultas públicas de la navegación

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_l1r5Dg/Screenshot 2026-09-04 at 3.34.34 PM.png`.
- Implementation target: shared desktop and mobile sidebar at `http://localhost:3001/`.
- Intended state: the `Consultas públicas` navigation item and its document-search icon are absent; the underlying route and data are not deleted.
- Full-view comparison: not required for this one-item removal; the supplied crop contains the complete target.
- Focused-region comparison: blocked because the Codex in-app Browser still reports that the Mac is locked.
- Code evidence: the `/regulatorio/consultas` navigation entry, Spanish/English labels, and now-unused icon import were removed from the shared sidebar.
- Automated verification: 376 web tests across 57 files passed; TypeScript, targeted ESLint, and `git diff --check` passed.

**Findings**

- [P2] The final rendered sidebar check is unavailable while the Mac is locked.
  Location: shared desktop/mobile navigation.
  Evidence: the Browser connection reports `The Mac is locked and automatic unlock could not unlock it.`
  Impact: the remaining navigation spacing and console state cannot receive final visual sign-off.
  Fix: unlock the Mac, capture the sidebar at desktop and mobile widths, and check the console.

**Implementation Checklist**

- [x] Remove the sidebar navigation entry.
- [x] Remove the unused icon import.
- [x] Preserve the underlying route and data.
- [x] Add regression coverage and pass the automated suite.
- [ ] Complete in-app Browser visual verification after unlock.

## Iteration — Librería de Iniciativas

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_nkWaoV/Screenshot 2026-09-04 at 3.35.35 PM.png`.
- Implementation target: the `/initiatives` item in the shared sidebar at `http://localhost:3001/`.
- Intended state: Spanish label changed from `Iniciativas` to `Librería de Iniciativas`, with the route, list icon, selected state, spacing, and typography preserved.
- Full-view comparison: not required for this focused text-only change; the supplied crop contains the complete target.
- Focused-region comparison: blocked because the Codex in-app Browser still reports that the Mac is locked.
- Code evidence: the shared sidebar now renders `Librería de Iniciativas` in Spanish and `Initiative Library` in English. Regression coverage confirms both labels and the removal of the prior bare label.
- Automated verification: 377 web tests across 57 files passed; TypeScript, targeted ESLint, and `git diff --check` passed.

**Findings**

- [P2] The browser-rendered label and console check remain unavailable while the Mac is locked.
  Location: shared sidebar `/initiatives` navigation item.
  Evidence: the Browser connection returns `The Mac is locked and automatic unlock could not unlock it.`
  Impact: the final focused visual comparison cannot be signed off.
  Fix: unlock the Mac, capture the sidebar, and verify the label at desktop and narrow widths.

**Implementation Checklist**

- [x] Change the Spanish sidebar label.
- [x] Update the English equivalent.
- [x] Preserve route, icon, selected state, and layout classes.
- [x] Add regression coverage and pass the automated suite.
- [ ] Complete in-app Browser visual verification after unlock.

final result: blocked

## Final browser sign-off — publicación de los cambios del viernes

- Reference inputs: the supplied Friday screenshots for the regulatory page, the shared navigation, the calendar, the agenda detail, the congress directory, and the source-status entry.
- Verified implementation: `http://localhost:3001/regulatorio`, `/feed`, `/hoy`, `/agenda/1952`, `/congreso`, and `/estado-fuentes` in the Codex in-app Browser.
- Desktop comparison: the regulatory page was inspected at 2016 × 1243 in light theme, matching the existing Oculis visual language while adding the six responsive institutional cards, their official logos, deposited/active counts, and the recent-publication feed.
- Mobile comparison: `/regulatorio` was inspected at 390 × 844; KPI blocks, institution cards, copy, and links stack without horizontal overflow.
- Interaction verification: the INDOTEL card opens `?institution=INDOTEL#institution-regulations`; the feed date control updates the URL, heading, counts, and movements; selecting a calendar day opens `view=day`; the agenda detail exposes its literal topic and the exact linked initiative; the commission directory opens directly to its members without an agenda block.
- Navigation verification: `Movimientos legislativos`, `Movimientos regulatorios`, `Directorio de Congresistas`, and `Librería de Iniciativas` render in Spanish; `Consultas públicas` is absent from the shared sidebar.
- Default-state verification: `/hoy?view=month` opened on the current date and highlighted that date.
- Console verification: zero browser warnings and zero browser errors across the checked routes.
- Data presentation verification: explicitly active regulatory counts remain conservative; unknown or missing statuses are not presented as active. `/estado-fuentes` renders the factual source records stored by the selected environment without manufacturing a green state.
- Automated verification: 162 live checks across 15 scraper files passed in 402.62 seconds; the web regression suite, TypeScript, ESLint, the factual-copy check, and the production web build also pass.

**Findings**

- No remaining P0, P1, or P2 visual or interaction defects were found in the Friday scope.

**Implementation Checklist**

- [x] Verify the renamed navigation entries in the browser.
- [x] Verify desktop and mobile regulatory layouts.
- [x] Verify institution filtering and official-document links.
- [x] Verify feed date changes and removed `Hoy` button.
- [x] Verify calendar day navigation and current-date default.
- [x] Verify agenda topics and exact initiative links.
- [x] Verify the commission directory without the removed agenda block.
- [x] Verify source-status rendering and browser console health.
- [x] Pass the full live scraper suite.

final result: passed

## Iteration — Movimientos regulatorios en la navegación

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_DmnSyy/Screenshot 2026-09-04 at 3.36.06 PM.png`.
- Implementation target: the shared `/regulatorio` sidebar item.
- Intended state: Spanish label changed from `Instrumentos regulatorios` to `Movimientos regulatorios`, with the existing route, gavel icon, selected state, spacing, and typography preserved. English uses `Regulatory movements`.
- Focused-region comparison: blocked because the Codex in-app Browser reports that the Mac is locked.
- Automated verification: the focused source-contract test passed; TypeScript, targeted ESLint, and `git diff --check` passed.

**Findings**

- [P2] The browser-rendered navigation label cannot receive final visual sign-off while the Mac is locked.
  Location: shared sidebar `/regulatorio` item.
  Evidence: the Browser connection returns `The Mac is locked and automatic unlock could not unlock it.`
  Impact: implementation evidence is complete, but the final browser comparison remains unavailable.
  Fix: unlock the Mac and capture the selected navigation item once.

**Implementation Checklist**

- [x] Rename the Spanish label to `Movimientos regulatorios`.
- [x] Rename the English label to `Regulatory movements`.
- [x] Preserve the route, icon, selected state, and layout classes.
- [x] Add regression coverage and pass automated validation.
- [ ] Complete in-app Browser visual verification after unlock.

final result: blocked

## Iteration — Monitoreo regulatorio por institución

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_DmnSyy/Screenshot 2026-09-04 at 3.36.06 PM.png` (2016 × 1243 source pixels after capture resizing).
- Implementation target: `http://localhost:3001/regulatorio` and the filtered state `http://localhost:3001/regulatorio?institution=INDOTEL`.
- Intended state: six responsive institution cards using logos retrieved from each official institutional site; each card exposes deposited and explicitly active counts and opens the exact institution-filtered list; a chronological recent-publication feed follows the directory.
- Full-view comparison: blocked because the Codex in-app Browser reports that the Mac is locked.
- Focused-region comparison: blocked for the same reason.
- HTTP evidence: both the unfiltered and INDOTEL-filtered pages return 200 locally; the filtered response contains `Iniciativas regulatorias de INDOTEL · 24`, one selected `aria-current` card, and both tested local logo assets return 200.
- Factual constraint: “Activas” uses a conservative exact allow-list of source-reported active/open/in-force statuses. Missing, closed, expired, and merely published statuses never count as active.
- Automated verification: 396 web tests across 59 files passed; TypeScript, targeted ESLint, and `git diff --check` passed.

**Findings**

- [P2] Browser-rendered layout, responsive behavior, card selection, and console state remain unavailable while the Mac is locked.
  Location: `/regulatorio` institution directory and filtered list.
  Evidence: the Browser connection returns `The Mac is locked and automatic unlock could not unlock it.`
  Impact: the implementation has functional HTTP and automated-test evidence but cannot receive final visual sign-off or be safely pushed for deployment yet.
  Fix: unlock the Mac, capture the full page and institution-card region at the supplied desktop width plus one narrow viewport, click one institution, inspect the filtered section and console, then amend the result.

**Implementation Checklist**

- [x] Add six official institution logo assets with provenance.
- [x] Add deposited and explicitly active counts per institution.
- [x] Make every institution card open its filtered initiative list.
- [x] Add the chronological recent regulatory initiative feed.
- [x] Preserve direct official-document links.
- [x] Add regression coverage and pass automated validation.
- [ ] Complete in-app Browser visual and interaction verification after unlock.

final result: blocked

## Final release override

The earlier blocked entries record intermediate attempts made while the Mac was locked. The completed browser sign-off above supersedes those temporary blockers after desktop, mobile, interaction, and console verification.

final result: passed

## Iteration — Logotipos institucionales faltantes

- Source visual truth: `/var/folders/pq/5j_515ns70x73jzfhtjw3dsr0000gn/T/TemporaryItems/NSIRD_screencaptureui_xcx0se/Screenshot 2026-09-07 at 3.08.25 PM.png` (1454 × 1266 source pixels). The supplied state showed generic document placeholders for SIMV, SB, and SISALRIL; the same fallback also applied to SUPERSEGURO and MIMARENA.
- Implementation target: `https://oculis-auribus.onrender.com/regulatorio` in the institution directory.
- Implementation screenshot evidence: production was inspected in the Codex in-app Browser at 1265 × 712. The browser runtime emitted the full directory and focused card-region captures inline; it does not expose those captures as persistent local paths.
- Full-view comparison: the existing Oculis card grid, spacing, typography, counts, and interaction affordances are unchanged. Five generic placeholders were replaced with proportional official marks.
- Focused-region comparison: the published directory visibly renders the official logos for Superintendencia de Seguros, Medio Ambiente, SIMV, Superintendencia de Bancos, and SISALRIL. No image is stretched or cropped.
- Asset verification: every one of the 11 institution images reports `complete=true` and a positive natural width and height in the production DOM. The five new public asset URLs return HTTP 200.
- Interaction verification: selecting the SIMV card updates the URL to `?institution=SIMV#institution-regulations` and opens `Iniciativas regulatorias de SIMV · 8`.
- Console verification: zero browser warnings and zero browser errors after loading and exercising the production directory.
- Automated verification: the focused institution-logo test passes (13 tests); the full web suite passes (405 tests across 60 files); TypeScript, ESLint, `git diff --check`, the production build, and the GitHub CI workflow all pass.
- Provenance: every new asset is recorded in `apps/web/public/assets/oculis/institutions/README.md` with its official institutional URL.

**Findings**

- No remaining missing-logo placeholder or broken institutional image was found in the production directory.

**Implementation Checklist**

- [x] Add official logos for SUPERSEGURO, MIMARENA, SIMV, SB, and SISALRIL.
- [x] Preserve the existing responsive card layout and accessible image labels.
- [x] Verify all 11 institutional images in the production DOM.
- [x] Verify a newly updated institution card opens its filtered initiative list.
- [x] Verify production console health and CI.

final result: passed
