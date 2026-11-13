---
version: 1
slug: "docs-design-discovery-html"
primary_target: "docs/design/discovery.html"
related_targets: []
---

# Discovery storefront (reference comp)

Scope: catalog discovery, mobile-first (390) and desktop (1440); includes the selected-track panel with license tiers. Mode: Persuade (storefront: the visitor decides and buys). Reference artifact for the S4-M8 build; not app code.

Audience/job: creators first (phone, search then hear a track immediately), brands and agencies on desktop needing tiers, GST and client name. Proof: screened catalog, exact per-track license receipt, verifiable record. No real catalog: all tracks, artists and prices are labelled sample data. Must avoid: static lifeless pages, no music vibe, streaming-app clone, generic SaaS, over-legal tone; never "no copyright claims" promises. Competitor anti-reference: hoopr.ai (pure black, hot-pink pills, AI cover art, subscription gradient cards, sale banners).

## Direction contract

THESIS: The track's own sound is the cover. A dark stage where the playing track's waveform is the largest, brightest thing on screen; refuses the category's cover-art grid, pink-pill rows and subscription cards.

OWN-WORLD: Night Session. Warm charcoal ground (R >= G > B, never blue-black, never #000) in three stacked surface steps, warm off-white ink, a named four-step ink ramp (foreground, fg-2, muted-foreground, fg-4), neutral ink as shadcn --primary (License and every default button), and tape orange (--signal) reserved for sound only: play, playhead, played waveform, beat. Hanken Grotesk for all text, tight negative tracking on display; Red Hat Mono only for measurements (timecode, BPM, prices, IDs). Bar waveforms: idle bars in a warm grey step, played bars in tape orange. Soft 10-18px radii, hairline dividers, no shadows on dark except the stage glow. No eyebrow labels. The only non-sound use of tape orange is the wordmark on-air light (the dot beside MRM).

STORY: A creator lands, types or taps a mood, hears a track within one tap, sees exactly what a license costs with GST, and licenses it; a brand sees the same with tiers and client name.

FIRST VIEWPORT: Phone: wordmark and menu; search at full width; mood/language/BPM chips; then the stage card (title at display size, artist, language, BPM and mood beneath, play, Similar, License, a 64px waveform with orange played portion, beat dot and timecode) above the results list. Desktop: left filter rail; centre column opens with the stage as the hero (44px title, 112px full-width waveform) over the results list; right column is the sticky license receipt with tiers, billing state, GST lines, total and the License CTA all inside 1440x900.

FORM: Night Session, grounded candidate from the safer re-roll (user-picked; position 3 of the minimal lineup). seed:c71607a50c192dcb

SIGNATURE INTERACTION: One clock. The playing row and stage waveform pulse at the track's BPM; the playhead sweeps; hovering a row previews its waveform brightening; silence means stillness. Reduced-motion: no pulse, static playhead.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
