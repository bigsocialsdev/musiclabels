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

OWN-WORLD: Night Session. Warm charcoal ground (not #000) in three stacked surface steps, warm off-white ink, a four-step grey ramp for hierarchy, tape orange as the single accent reserved for play, playhead and the license action. Hanken Grotesk for all text, tight negative tracking on display; Geist Mono only for measurements (timecode, BPM, prices, IDs). Bar waveforms: unplayed bars in a grey step, played bars in tape orange. Soft 12–18px radii, hairline dividers, no shadows on dark except the stage glow.

STORY: A creator lands, types or taps a mood, hears a track within one tap, sees exactly what a license costs with GST, and licenses it; a brand sees the same with tiers and client name.

FIRST VIEWPORT: Phone: wordmark and sign-in; search field at full width; mood/language/BPM filter chips; then the stage card (now playing: title at display size, artist and meta, 70px waveform with orange played portion, play button and License) above the results list. Desktop: left filter rail, results list centre, stage plus license-tier receipt in a right column; search in the top bar.

FORM: Night Session, grounded candidate from the safer re-roll (user-picked; position 3 of the minimal lineup). seed:c71607a50c192dcb

SIGNATURE INTERACTION: One clock. The playing row and stage waveform pulse at the track's BPM; the playhead sweeps; hovering a row previews its waveform brightening; silence means stillness. Reduced-motion: no pulse, static playhead.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
