---
name: MRM (working name)
description: India-only sync-licensing storefront, seller portal and admin console in one warm-charcoal world where the track's own sound is the cover.
world: "Night Session"
colors:
  # Night theme (.dark): storefront, track pages, checkout, buyer dashboard, /verify
  night-ground: "#141311"
  night-surface: "#1C1A17"
  night-popover: "#221F1C"
  night-secondary: "#262421"
  night-accent: "#302D29"
  night-border: "#2B2825"
  night-input: "#3A3631"
  night-ink: "#F2F0EB"
  night-ink-2: "#CDC8BF"
  night-ink-muted: "#9C968D"
  night-ink-faint: "#6F6A62"
  night-wave-idle: "#47423C"
  night-stage-glow: "rgba(255, 106, 43, 0.26)"
  night-ok: "#3DD68C"
  night-attention: "#F5B83D"
  night-blocked: "#FF6B6B"
  night-info: "#7AB0FF"
  # Daylight theme (:root / .light): seller portal and admin console
  daylight-ground: "#F5F7F9"
  daylight-shell: "#EEF1F4"
  daylight-nav-active: "#E2E7EC"
  daylight-surface: "#FFFFFF"
  daylight-secondary: "#EEF1F4"
  daylight-accent: "#E7EBEF"
  daylight-border: "#E0E5EA"
  daylight-input: "#CDD5DC"
  daylight-ink: "#1E2B35"
  daylight-ink-2: "#33404C"
  daylight-ink-muted: "#58626D"
  daylight-ink-faint: "#9AA4AE"
  daylight-wave-idle: "#CDD5DC"
  daylight-wave-played: "#F05A1C"
  daylight-stage-glow: "rgba(255, 106, 43, 0.14)"
  daylight-ok: "#05704F"
  daylight-attention: "#8F4D08"
  daylight-blocked: "#B4123A"
  daylight-info: "#1E4FD0"
  daylight-ok-soft: "#DCF5EA"
  daylight-attention-soft: "#FDF1DA"
  daylight-blocked-soft: "#FFE6EB"
  daylight-info-soft: "#E3EBFD"
  daylight-muted-soft: "#EEF1F4"
  # Shared by both themes: sound only
  tape-orange: "#FF6A2B"
  tape-orange-ink: "#160A03"
  # Overlay only, never a ground (mobile license sheet)
  scrim: "rgba(0, 0, 0, 0.55)"
typography:
  display:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  display-laptop:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  display-tablet:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  display-mobile:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline-mobile:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline-detail:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-0.015em"
  title-row:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.45
  body-console:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  body-table:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
  body-small:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  button:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  button-console:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
  mono-measure:
    fontFamily: "Red Hat Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
  mono-small:
    fontFamily: "Red Hat Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
  mono-price:
    fontFamily: "Red Hat Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 500
rounded:
  bar-fine: "1px"
  bar: "2px"
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "18px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  4xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.daylight-ink}"
    textColor: "{colors.daylight-ground}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 16px"
  button-primary-night:
    backgroundColor: "{colors.night-ink}"
    textColor: "{colors.night-ground}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 16px"
  button-primary-pay:
    backgroundColor: "{colors.night-ink}"
    textColor: "{colors.night-ground}"
    rounded: "{rounded.sm}"
    height: "46px"
    width: "100%"
  button-secondary-night:
    backgroundColor: "{colors.night-secondary}"
    textColor: "{colors.night-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 16px"
  button-ghost-night:
    textColor: "{colors.night-ink-2}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 16px"
  button-console:
    backgroundColor: "{colors.daylight-ink}"
    textColor: "{colors.daylight-ground}"
    typography: "{typography.button-console}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  button-console-outline:
    backgroundColor: "{colors.daylight-surface}"
    textColor: "{colors.daylight-ink}"
    typography: "{typography.button-console}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  button-console-reject:
    backgroundColor: "{colors.daylight-surface}"
    textColor: "{colors.daylight-blocked}"
    typography: "{typography.button-console}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  play-button-idle:
    backgroundColor: "{colors.night-secondary}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.full}"
    size: "40px"
  play-button-playing:
    backgroundColor: "{colors.tape-orange}"
    textColor: "{colors.tape-orange-ink}"
    rounded: "{rounded.full}"
    size: "40px"
  play-button-stage:
    backgroundColor: "{colors.tape-orange}"
    textColor: "{colors.tape-orange-ink}"
    rounded: "{rounded.full}"
    size: "56px"
  search-field-night:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "0 14px"
  input-field-night:
    backgroundColor: "{colors.night-ground}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 12px"
  select-console:
    backgroundColor: "{colors.daylight-surface}"
    textColor: "{colors.daylight-ink}"
    typography: "{typography.body-table}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 10px"
  chip-filter:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-ink-2}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 12px"
  chip-filter-selected:
    backgroundColor: "{colors.night-ink}"
    textColor: "{colors.night-ground}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 12px"
  stage-card:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.lg}"
    padding: "24px 24px 20px"
  receipt-card:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.lg}"
    padding: "18px 18px 16px"
    width: "360px"
  queue-row-selected:
    backgroundColor: "{colors.daylight-secondary}"
    textColor: "{colors.daylight-ink}"
    typography: "{typography.body-table}"
    padding: "10px 12px"
  detail-pane:
    backgroundColor: "{colors.daylight-ground}"
    width: "540px"
  decision-bar:
    backgroundColor: "{colors.daylight-surface}"
    padding: "12px 20px 14px"
  sample-marker:
    textColor: "{colors.daylight-attention}"
    typography: "{typography.label}"
    height: "20px"
    padding: "0 6px"
---

# Design System: MRM (working name)

**Status: locked 2026-11-13 by the owner** (decision recorded in `docs/STATE.md`). Changes to the rules below go back to the owner.

**Amended 2026-11-14 by the owner:** the daylight console (seller portal, admin console) aligns with the team's BigSocials app: cool-grey daylight palette, a sidebar shell, tinted status pills and notice bands. The night storefront, the sound-only orange, mono for measurements and every other rule are unchanged. `docs/design/admin-verification.html` predates this amendment; for console chrome and status, `components/console/shell.tsx`, `components/ui/status.tsx` and `Notice` in `app/seller/ui.tsx` are the reference.

## Overview

**Creative North Star: "Night Session"**

The track's own sound is the cover. Every surface is a warm charcoal (or, for operators, warm daylight) room in which the loudest, brightest object is the playing track's waveform. There is no catalogue imagery and none is needed: a title set large and tight, a line of measured facts in mono, and a bar waveform that fills with tape orange as it plays carry the whole storefront. The same session continues into the seller portal and admin console with the house lights up: identical type, radii and single accent, on a cool-grey daylight console aligned with the team's BigSocials app (owner decision 2026-11-14) and built for eight-hour queue work.

Density follows the job. The storefront is Persuade mode: one stage hero, a scannable results list, and a sticky license receipt that states the exact price with GST. The console is Operate mode: a queue table, a detail pane and a sticky decision bar, at 13 to 14px, where status, age and the next action read in one glance. Proof over promise governs both: the record, the tax lines, the status and the process are shown exactly, never dressed up.

Confirmed rejections: the category's look (hoopr.ai: pure black, hot-pink pills, AI cover art on every row, gradient subscription cards, sale banners, "no copyright claims" promises), the cover-art grid, the streaming-app clone, and the generic SaaS dashboard of KPI tiles and coloured sidebars.

World provenance: Night Session, grounded candidate from the safer re-roll, `seed:c71607a50c192dcb`. Reference build: `docs/design/tokens.css`, `docs/design/discovery.html` (storefront, 390 to 1440), `docs/design/admin-verification.html` (admin queue, 1440, daylight plus night).

**Key Characteristics:**
- Night: warm charcoal ground in stacked tonal steps (R >= G > B, never blue-black, never #000); warm off-white ink. Daylight (seller, admin): BigSocials' cool greys, a sidebar shell and tinted status.
- A named four-step ink ramp: ink, ink-2, ink-muted, ink-faint.
- Neutral ink is the primary colour: every default button, checked control and focus ring is ink.
- Tape orange belongs to sound alone, plus one sanctioned non-sound use: the wordmark's on-air light.
- One clock: the playing waveform and beat dot pulse at the track's own tempo; silence is stillness.
- Hanken Grotesk for all words, tight negative tracking at display size; Red Hat Mono only for measurements.
- Flat, hairline-divided, softly rounded (6 to 18px); depth by tonal step, not shadow.

## Colors

A warm, near-monochrome ink-on-charcoal palette with one hot accent that only ever means "sound".

### Primary
- **Warm Ink** (night-ink / daylight-ink): shadcn `--primary` and `--ring` in both themes. License, Approve and publish, every default Button, checked Radio/Checkbox/Switch, Slider and Progress fills, the selected filter chip, the range-slider fill and knobs, focus outlines, text selection (ink background, ground text). Its job is decision and selection, quietly.

### Secondary
- **Tape Orange** (tape-orange, with tape-orange-ink text on it): the sound accent. The play button while playing, the stage play button, the played portion of every waveform (daylight-wave-played on light grounds for contrast), the playhead and progress bar, the beat dot, and the stage glow (night-stage-glow / daylight-stage-glow radial wash at the stage's lower left). The wordmark dot is its one non-sound use.

### Tertiary (status set)
- **Clear Green** (night-ok / daylight-ok): ready, clear, approved, MFA active.
- **Amber Pending** (night-attention / daylight-attention): unavailable, needs attention, and the sample-data marker.
- **Blocked Red** (night-blocked / daylight-blocked, equal to `--destructive`): failed, matched, overdue ages, Reject text, overdue area counts.
- **Info Blue** (night-info / daylight-info): processing and in-flight states.
**The Status Rule.** In daylight (seller portal, admin console) status is a pill: a 7px dot plus the word in the status colour on its `-soft` tint (`StatusLabel`), and a message is a tinted band with a 25% status-coloured border (`Notice`). At night (storefront) the same components drop the fill and show dot plus word on the surface. Status colours never fill buttons, cards or whole rows.

### Neutral
- **Charcoal Ground** (night-ground): the storefront page.
- **Stage Surface** (night-surface): cards, the stage, the receipt, search fields, hovered and selected rows.
- **Raised Surface** (night-popover): popovers, the mobile mini player.
- **Daylight Ground** (daylight-ground), **Shell** (daylight-shell) and **Paper White** (daylight-surface): the raised content panel, the frame behind the sidebar, and work surfaces (table, cards, decision bar, documents). **Nav Active** (daylight-nav-active) fills the current and hovered sidebar item.
- **Secondary / Accent** (night-secondary, night-accent, daylight-secondary, daylight-accent): idle play buttons, secondary buttons, hover fills, the segmented control track, the selected queue row.
- **Hairline** (night-border / daylight-border, also `--surface-3` on light): every divider and card edge. **Input Stroke** (night-input / daylight-input, also `--surface-3` on dark): field and outline-button borders, the receipt's dashed rule, scrollbars, range track.
- **Ink-2** (night-ink-2 / daylight-ink-2): secondary prose, artist line, ghost-button text, receipt line items.
- **Ink-Muted** (night-ink-muted / daylight-ink-muted): labels, column headers, timecodes, counts, placeholders.
- **Ink-Faint** (night-ink-faint / daylight-ink-faint): the selected tier's border and decorative steps only; never text.
- **Wave Idle** (night-wave-idle / daylight-wave-idle): unplayed waveform bars.

### Named Rules
**The Sound-Only Rule.** Tape orange marks sound and nothing else: play while playing, played waveform, playhead or progress, beat dot, stage glow. The single exception is the wordmark's on-air light (the 8 to 9px dot beside the name). It never colours selection, links, primary actions, badges, focus or hover. A `signal` Button variant may be added only where sound is controlled.

**The Ink-Is-Primary Rule.** `--primary` and `--ring` are neutral ink, so every shadcn default renders ink, never orange. Test: put any shadcn primitive on the page with no variant; if it shows orange, the tokens are wrong.

**The Warm-Dark Rule.** Every dark value keeps R >= G > B. No #000 grounds, no blue-black, no cool greys. (A translucent black scrim over content is allowed; it is a shadow, not a ground.)

## Typography

**Display Font:** Hanken Grotesk (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Hanken Grotesk (same stack)
**Label/Mono Font:** Red Hat Mono (with ui-monospace, monospace)

**Character:** One warm grotesk does every word, from a tightly tracked 44px track title down to 12px column labels; the base weight is 500, so text reads solid on charcoal. Red Hat Mono is the measuring instrument: it appears only where a number is a measurement, and tabular figures are on everywhere (`font-variant-numeric: tabular-nums` on the root).

### Hierarchy
- **Display** (display; 40px at <=1366px, 36px at <=1180px, display-mobile at <=900px): the stage track title. One per screen.
- **Headline** (headline): page titles such as "Romantic, in Hindi" and "Verification queue" (20px on mobile). **Headline-detail** (headline-detail): the title atop a console detail pane.
- **Title** (title): the receipt heading. **Title-row** (title-row): track titles in result rows; table titles use body-table at 600, 700 when selected.
- **Body** (body): storefront base. **Body-console** (body-console): console base. **Body-table** (body-table): queue tables, console selects and textareas. **Body-small** (body-small): artist/seller sub-lines, notes, receipt lines, sort and hint text; receipt fine print at 12px.
- **Label** (label): field labels, column headers, filter-group headings and fact terms, in ink-muted, sentence case, no letter-spacing, never uppercase.
- **Mono-measure** (mono-measure): timecode, BPM, duration, receipt amounts. **Mono-small** (mono-small): counts, IDs, file sizes, hash fragments, waiting ages, keyboard hints. **Mono-price** (mono-price): tier prices.

### Named Rules
**The Measurements-Only Mono Rule.** Red Hat Mono sets timecode, BPM, durations, prices and tax amounts, counts, IDs, hashes, sizes and ages, and nothing else. Words, names, statuses and labels stay in Hanken Grotesk.

**The No-Eyebrow Rule.** No small uppercase or tracked kicker above a heading, anywhere. A heading stands alone; context goes in the sub-line beneath it.

## Layout

**Storefront (desktop, max 1440px, 24px padding, 64px bottom):** a three-column grid of a 220px sticky filter rail, a fluid centre and a 360px sticky receipt, with 32px column gaps and 28px row gaps. The centre opens with the stage card as the hero, then the results list. Rail and receipt stick at 88px (below the 64px blurred top bar).

**Breakpoints:** at 1366px the stage controls wrap below the title; at 1180px the rail disappears and the grid becomes fluid plus a 340px receipt; at 900px the page becomes one column (16px side gutter, 14px gaps, 120px bottom padding for the mini player): the top bar drops to 56px with wordmark and menu only, a full-width search and a horizontally scrolling chip row appear, result rows reflow to play, title and duration with the waveform on a second line, the receipt becomes a bottom sheet (88vh max, handle, close, scrim), and a floating mini player appears once the stage scrolls out of view.

**Result rows:** a six-column grid (44px play, 1.1fr title, 2fr waveform, 64px tempo, 48px time, 36px menu) with 16px gaps, 10px by 12px padding and hairline separators.

**Console shell (seller portal and admin console, `components/console/shell.tsx`):** a 240px sidebar on the shell grey (wordmark with the on-air dot and the product label, icon links 36px high with the current item filled nav-active, identity and MFA state at the foot) beside a raised content panel (ground, hairline border, 16px radius, 8px inset from the window edge). Below 768px the sidebar becomes a sticky white top bar with the wordmark and a scrolling tab row.

**Admin queue (desktop 1440, full-height, no page scroll):** inside the shell, a filter bar (headline, segmented filter, sample marker, 280px search), then a split of a fluid queue table and a 540px detail pane. The table and the detail body scroll independently; the decision bar is pinned to the pane's bottom. Cells are 10px by 12px with 20px first-column inset.

**Rhythm:** spacing steps of 4, 8, 12, 16, 20, 24 and 32px, with 6, 10 and 14px used as tight intra-component gaps. Control heights: 46px pay button, 44px storefront search, 40px storefront buttons and play, 38px fields, 36px console buttons and selects, 34px chips and console search.

### Named Rules
**The Stage-First Rule.** On any storefront listing, the selected track's stage card (title, facts, play, License, full-width waveform, beat dot, timecode) is the first and largest object in the content column, above the list it belongs to.

**The One-Viewport Decision Rule.** The decision is reachable without scrolling: the receipt with its total and License action fits inside 1440x900; the console's decision bar is always pinned and visible.

## Elevation & Depth

Flat by default. Depth comes from tonal steps (ground, then surface, then popover; on light, ground then white) and 1px hairlines, never from drop shadows at rest. The stage carries a warm radial glow (tape orange at 14% light, 26% dark) as its only atmospheric depth, because it is where sound lives. The top bar is translucent (88% ground) with a 12px backdrop blur.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 28px -10px rgba(0,0,0,.6)`): the mobile mini player, the only element floating over content.
- **Segment thumb** (`box-shadow: 0 1px 2px rgba(26,24,21,.1)`): the pressed button in a daylight segmented control.
- **Knob halo** (`box-shadow: 0 0 0 4px var(--background)`): range-slider knobs, to cut them out of the track.
- **Scrim** (`background: rgba(0,0,0,.55)`): behind the mobile receipt sheet.

### Named Rules
**The Flat-At-Rest Rule.** Cards, rows, tables and panels never cast shadows. Only an element that physically floats over scrolling content (mini player, sheet, popover, toast) may lift.

## Shapes

Soft, consistent rounding on a four-step scale: 6px for small controls (filter options, the sort select, menu buttons, focus outline), 10px for buttons, fields, chips, tier rows, documents and the match card (the shadcn `--radius` base), 14px for hovered or selected result rows and the mini player, 18px for the stage and receipt (and the bottom sheet's top corners). Play buttons, beat dots, status dots and the wordmark dot are full circles. Waveform bars are 1px-rounded slivers (2px on the stage) with 2 to 3px gaps. Borders are always 1px hairlines; the one dashed line is the receipt's rule above the tax lines, the visual cue of a till slip.

## Components

### Buttons
Quiet, dense and ink-led; the press gives a small physical give.
- **Shape:** gently rounded (10px), 40px storefront, 36px console, 46px full-width pay.
- **Primary:** ink background, ground-coloured text (button-primary, button-primary-night). Labels state the outcome and, where money moves, the amount: "License for ₹1,178.82", "Approve and publish".
- **Hover / Active / Focus:** hover mixes primary 88% toward the ground; active scales to 0.97 over 120ms ease-out; focus is a 2px ink outline at 2px offset. Disabled is 40% opacity with a not-allowed cursor, and always comes with a visible reason beside it.
- **Secondary / Ghost / Outline:** secondary is a secondary-fill button (Sign in); ghost is ink-2 text that fills on hover (Similar); outline is a white button with an input-stroke border (console Reject, whose text is blocked red).
- **Signal (sound only):** not a shadcn variant yet. Add `signal` (tape-orange background, tape-orange-ink text) only to controls that start or stop sound.

### Play Buttons
- **Row play:** 40px circle, secondary fill and ink glyph at idle; tape orange with tape-orange-ink while playing; scales to 0.92 on press. Console variant is 36px.
- **Stage play:** 56px tape-orange circle with a 20px filled glyph, scales to 0.93 on press.

### Chips and Filter Options
- **Chips (mobile):** 34px, 10px rounded, surface fill, hairline border, ink-2 text at 13px/600. Selected inverts to ink fill with ground text.
- **Rail options (desktop):** full-width rows with label and a mono count; selected gets a secondary fill, 600 weight and a 6px ink dot before the label.
- **Segmented control (console):** a secondary track holding 28px buttons with mono counts; the pressed button is a white thumb.

### Cards / Containers
- **Corner Style:** 18px for the stage and receipt; 10px for inner items (tiers, documents, match card).
- **Background:** surface on ground; the stage adds the stage glow.
- **Shadow Strategy:** none (see Flat-At-Rest).
- **Border:** 1px hairline; a screening match tints its border 30% toward blocked red.
- **Internal Padding:** stage 24px (16px mobile); receipt 18px (16px mobile sheet); console sections 14px by 20px.

### Inputs / Fields
- **Style:** 1px input-stroke border, 10px rounded, ground fill in the storefront receipt (38px), white in the console; label above in the label style. Search fields are 44px (storefront, with a `/` key hint) or 34px (console).
- **Focus:** the border shifts to ink-2; no glow. Keyboard focus on non-fields shows the 2px ink outline.
- **Error / Disabled:** not yet built. Inferred: error text in blocked red as a dot-plus-label line beneath the field; never a filled field.

### Navigation
- **Storefront top bar:** sticky, 64px (56px mobile), translucent blurred ground with a hairline bottom. Wordmark (20px/700, -0.035em, with the on-air dot), a search field, then muted 14px/600 links that turn ink with a secondary fill on hover, and Sign in as a secondary button. Mobile collapses to wordmark plus menu.
- **Console sidebar:** see the console shell under Layout. Links are 14px, ink-2 at rest and ink/600 when current, with 16px 1.8-stroke icons from `components/console/icons.tsx` (no icon package). The admin's email and an ok-soft "MFA on" pill sit at the foot.

### Waveform (signature)
Bars drawn from the track's peaks: wave-idle at rest, wave-played for the played portion, the last played bar marked as the head. Row strips are 28px (20px mobile), console strips 34px, the stage 112px (64px mobile). Hovering a row lifts idle bars toward ink-muted. Clicking or pressing Left/Right (5s steps) seeks; the stage strip is a `role="slider"`.

**The One-Clock Rule.** All motion while a track plays runs on a single beat, `--beat = 60 / BPM` seconds, set once on the root when a track is selected. On each beat, played bars breathe from scaleY 1.12 to 1, the head bar from scaleY 1.5 to 1, and the beat dot from scale 1.7 to 1, all on the ease-out curve. Nothing else on the page pulses. When nothing plays, nothing moves; the beat dot rests at 35% opacity.

Motion tokens: ease-out `cubic-bezier(0.16, 1, 0.3, 1)`; 120ms for hover fills and press scales, 200ms for waveform colour, 320ms for the sheet, scrim, mini player and toast. Under `prefers-reduced-motion: reduce`, every animation and transition is off: no pulse, no beat, no slide; the playhead and time readout still update as plain state.

### Stage
The hero of every storefront listing and track page: display title, an artist line in ink-2 with language, BPM and mood, then stage play, Similar (ghost) and License (primary), the full-width waveform, and a beat-dot plus mono timecode row.

### License Receipt
A sticky card titled "License “Track”" with tier radios (title, one-line terms, mono price; the checked tier gets an ink-faint border and secondary fill, the radio an ink centre dot), an enquiry link for TV/OTT/cinema, client name (non-Creator tiers), billing state, then the dashed rule and exact lines: license fee, then CGST 9% and SGST 9% (same state as supplier) or IGST 18%, then a bold total, then the full-width primary button carrying the total, then one line of plain fine print about the certificate, verify link, invoice and the clearance process.

### Queue Table, Detail Pane and Decision Bar
A sticky-header table sorted oldest first: title with a muted sub-line, mono waiting age (overdue in blocked red), status-pill columns, mono counts. Selected row is secondary-filled with 700 titles. The 540px detail pane shows the title, a muted meta line with mono ID, version and age, a small player, a four-fact row, then hairline-separated sections (screening, rights and documents, ingest) whose headings carry their status on the right. The pinned decision bar holds the assignment selects, the reason an action is blocked (with a link to fix it) or the keyboard hint, then the destructive outline action and the primary action. J/K move, Space plays, approve advances to the next row; outcomes report in a bottom-centre ink toast.

### Status Label
A 7px circle in the status hue followed by the label in ink at 13px. Waiting ages use mono with blocked red when overdue. The sample-data marker is an amber 11px/600 label in a 20px outlined pill with a 40% amber border.

### Document Row
A 10px-rounded white row: document glyph, filename, mono size on the right, and a text Download button. Rights documents always download as attachments; there is no inline preview.

## Applying to the app

`app/globals.css` on the main branch defines only `--background` and `--foreground`, while the shadcn components already in `components/ui` (button, card, badge, input, label, textarea; new-york, CSS variables, lucide) reference `bg-primary`, `border-input`, `ring-ring` and the rest. To apply this system:

1. Replace `app/globals.css` with the values from `docs/design/tokens.css` (the `:root, .light` and `.dark` blocks), after `@import "tailwindcss";`.
2. Add `@custom-variant dark (&:is(.dark *));`.
3. Add a `@theme inline` block mapping every colour to its variable: `--color-background: var(--background)` through `--color-ring: var(--ring)` for the shadcn set, plus `--color-fg-2`, `--color-fg-4`, `--color-surface-3`, `--color-signal`, `--color-signal-foreground`, `--color-wave-idle`, `--color-wave-played`, `--color-stage-glow`, `--color-ok`, `--color-attention`, `--color-blocked`, `--color-info`. Map the radii onto Tailwind's own scale so shadcn's classes land on the design values: `--radius-sm: 6px` (xs), `--radius-md: 10px` (sm: buttons, inputs), `--radius-lg: 14px` (md: cards, rows), `--radius-xl: 18px` (lg: stage, receipt); keep `--radius: 10px` and override `--ease-out` with the token curve. (Done on main: `app/globals.css`.)
4. Load Hanken Grotesk (400 to 700) and Red Hat Mono (400, 500) with `next/font/google`, exposing them as `--font-sans` and `--font-mono` on `<html>`; drop the literal font stacks from the copied `:root`. Set the root to weight 500 with tabular numerals.
5. Theme by surface with next-themes (`attribute="class"`, `suppressHydrationWarning` on `<html>`). Because a nested ThemeProvider is ignored, place one provider per route-group layout rather than in the root layout:
   - **Storefront group** (discovery, track pages, enquiry, checkout, buyer dashboard, public `/verify/{id}`): `forcedTheme="dark"`. Buyers audition music; a dark room keeps the waveform the brightest object, matches the late-night phone session in which creators publish, and lets the verify page look the same as the certificate's world.
   - **Seller portal and admin console:** `defaultTheme="light"`, `enableSystem={false}`, with a theme switch. Operators read tables, documents and money all day at a desk, often in daylit rooms; light paper is the legible default, and dark stays one click away.
6. Keep shadcn's defaults: with ink as `--primary` and `--ring`, Button, Badge, Checkbox, Radio, Switch, Slider, Progress and focus rings come out ink with no per-component edits. Add a `signal` variant only on audio controls.
7. Copy the look of the comps, not their scripts. The comps compute tier prices and GST in the browser and render rows with `innerHTML` purely as illustration. In the app the receipt displays amounts from the server (the pricing slice's quote, then the order's price/tax snapshot, integer paise); the browser never computes or submits a price. Render with React, never `innerHTML` or `dangerouslySetInnerHTML` on catalog or user text.

## Screen map (Session 4)

Patterns proven in the comps: **[A] queue table, detail pane and pinned decision bar** (admin verification); **[B] stage and waveform** (discovery stage, row strips, console player); **[C] receipt with exact GST lines** (discovery receipt and mobile sheet); **[D] dot-plus-label status** (admin); **[E] document row** (admin). **[F] gated linear sequence** is inferred, not yet built: one step visible at a time, each step's primary action disabled with its reason stated beside it (as the decision bar does), a plain step count ("Step 2 of 5") in body-small, never a progress-bar hero.

| Screen family | Theme | Patterns | Status |
|---|---|---|---|
| **S4-M7 Seller portal** | | | |
| Onboarding: profile, KYC docs, PAN, bank (TOTP), seller agreement, Class B release commitment | light | F; E for uploaded KYC docs; PAN and bank masked in mono | inferred |
| Upload form | light | F; D for ingest; B (console player) once the preview exists | inferred |
| Track list | light | A table half, D for listing status, mono ages | inferred from built |
| Track detail, versions, delist | light | A detail pane and decision bar (Delist as destructive outline) | inferred from built |
| Rejection reason and resubmit | light | A: reason as a note section; Resubmit as the decision-bar primary | inferred |
| Sales table and CSV export | light | A table with mono amounts; totals as C lines under the table; no KPI tiles | inferred |
| Payout statements | light | C lines (gross, TDS, net) plus E for the statement PDF | inferred |
| Clearance-request inbox | light | A with due date as the age column (overdue red) and D | inferred from built |
| **S4-M8 Discovery** | | | |
| Browse and faceted search | dark | B stage, rail and chips, result rows, C receipt | built |
| Track page (SEO) | dark | B stage as hero, C receipt sticky right (sheet on mobile), similar tracks as result rows below | inferred from built |
| Commercial/Broadcast enquiry | dark | F (short), fields in the receipt style | inferred |
| Checkout | dark | C carried forward unchanged as the order summary, F for billing and GSTIN, Razorpay hand-off | inferred |
| **S4-M9 Buyer dashboard** | | | |
| Licenses list (client-name filter) | dark | A table half on night tokens, segmented or search filter for client | inferred |
| License detail | dark | A detail pane: C for the order snapshot, D for live status, mono public ID and record hash | inferred |
| Channel verification (bio-code) | dark | F: code in mono with copy, then check; D for result | inferred |
| Video registration | dark | A table with a mono cap count ("2 of 3"); the blocked state as a D line with message | inferred |
| Downloads | dark | E rows (certificate, master, dispute kit) | inferred from built |
| Invoices and credit notes | dark | A table, C lines on open, E for the PDF | inferred |
| Disputes | dark | A with first-action and resolution due dates, D, event log as a hairline list | inferred |
| Public `/verify/{id}` | dark | C-style record card with D live status; hashed fields and live fields visibly separated | inferred |
| **S4-M10 Admin console (PLAN §9)** | | | |
| Verification queue | light | A, B, D, E | built |
| Concierge import | light | F (CSV and masters prefix, dry run, report) plus A table for the report | inferred |
| Clearance, disputes, copyright complaints, enquiries | light | A, D, due-date ages | inferred from built |
| Refunds, reconciliation | light | A with C lines in the detail pane | inferred |
| Payouts | light | A with C lines; approve in the decision bar requires TOTP | inferred |
| Catalog admin, legal documents, users and orgs | light | A; publish/suspend in the decision bar | inferred |
| Impersonation banner | light | an attention `Notice` band pinned to the top of the content panel | inferred |
| Audit log | light | A table only, read-only, mono IDs and timestamps | inferred |

## Do's and Don'ts

### Do:
- **Do** keep every default control ink: shadcn Button, Badge, Checkbox, Radio, Switch, Slider, Progress and the focus ring take `--primary`/`--ring`, never tape orange.
- **Do** reserve tape orange for sound (play while playing, played waveform, playhead, progress, beat dot, stage glow) plus the wordmark's on-air dot.
- **Do** lead every storefront listing and track page with the stage: display title, facts, play, License and a full-width waveform.
- **Do** run all playback motion on one clock (`--beat = 60/BPM`): played bars breathe at scaleY 1.12, the head bar at 1.5, and stop completely when audio stops or reduced motion is on.
- **Do** show money exactly: license fee, CGST + SGST or IGST, total, all in Red Hat Mono from integer paise, and put the total in the button label.
- **Do** show status with `StatusLabel` (a tinted pill in daylight, dot plus word at night), and ages and due dates in mono, red when overdue.
- **Do** state why an action is disabled, next to the disabled action, with a link to fix it.
- **Do** mark every sample screen with the amber "Sample data" (or "Sample prices") marker and use fictional names for artists, sellers, rightsholders and admins.
- **Do** describe clearance as a process ("our clearance desk takes it up with the rightsholder").
- **Do** force the storefront route group dark and default seller and admin surfaces to light.

### Don't:
- **Don't** copy the category look of hoopr.ai: pure #000 grounds, hot-pink pills, AI cover art on every row, gradient subscription cards, sale banners.
- **Don't** promise "no copyright claims", "zero strikes", "instant protection" or any guaranteed outcome.
- **Don't** use eyebrow labels or uppercase tracked kickers above headings.
- **Don't** build cover-art grids or album-tile layouts; there is no catalogue imagery, and the waveform is the cover.
- **Don't** build KPI-tile dashboards or stat cards on seller or admin screens, or colour the sidebar; use tables, receipt lines and status pills.
- **Don't** set words, names or statuses in Red Hat Mono; mono is for measurements only.
- **Don't** fill buttons, cards or rows with status colour, or use saturated status fills; status tints are the `-soft` values only, and only in daylight.
- **Don't** add drop shadows to cards, rows or panels at rest.
- **Don't** use #000, blue-black or cool greys for any ground or surface.
- **Don't** fabricate artists, testimonials, customer logos, sales numbers or press.

## Open decisions (owner)

- **Name and logo.** "MRM" is a working name. The wordmark is set type plus the on-air dot; a real name and logo replace it without changing any other rule.
- **Catalogue imagery.** No cover art or artist photos exist. The system is built to stand on waveforms and metadata alone; if labels later supply art, it appears only on the track page beside the stage, never as a grid or as row thumbnails.
- **Buyer dashboard theme.** It is in the storefront route group and therefore dark. If buyers who manage invoices and channel verification push back, move it to the light theme; tokens already support both.
- **Prices.** Every amount in the comps is sample data. Real amounts come from the platform price book (price level × tier).
- **Gated linear sequence (pattern F).** Seller onboarding and checkout as block-stepped sequences are specified but not yet built as a reference comp; validate the first one built before reusing it.
