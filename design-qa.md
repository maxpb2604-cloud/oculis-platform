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

Final result: passed
