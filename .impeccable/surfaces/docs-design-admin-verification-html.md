---
version: 1
slug: "docs-design-admin-verification-html"
primary_target: "docs/design/admin-verification.html"
related_targets: []
---

# Admin verification queue (reference comp)

Scope: admin console, verification queue with the selected submission open (PLAN §9: ingest status, screening matches, rights declaration, documents, claim-probe, class and price-level assignment, approve/reject with reason, ageing). Mode: Operate. Desktop 1440. Reference artifact for S4-M10; not app code. Inherits the Night Session world (see docs/design/discovery.html brief).

Task: an admin clears a queue all day: scan ageing, open a submission, check screening and documents, assign class and price level, approve or reject with a reason. Frequency: hundreds of rows a week. States: ingest pending/failed, screening unavailable, match found (blocks approve without override note), overdue. Constraints: MFA-gated, every action audited, documents open as downloads only.

## Direction contract

THESIS: The same session, house lights up. The console runs on the storefront's type, ramp and single accent, in a light daylight theme built for eight-hour queue work; it refuses the generic SaaS dashboard of cards, KPI tiles and coloured sidebars.

OWN-WORLD: Night Session daylight theme: warm off-white ground, white work surfaces, warm charcoal ink, the same four-step ink ramp, neutral ink primary for Approve; tape orange appears only on sound (the preview play state and played waveform), never on selection or actions. Status uses a small semantic set (ok green, attention amber, blocked red, info blue) as dot plus label, never filled banners. Hanken Grotesk at 13-14px for tables, Red Hat Mono for IDs, ages, sizes and amounts. Track waveforms appear here too, small, so admins hear what they approve. No eyebrow labels; sample data is marked and uses fictional rightsholders. The only non-sound use of tape orange is the wordmark on-air light (the dot beside MRM).

STORY: The admin sees what is oldest and blocked first, opens it, hears it, checks evidence, decides, and the next item loads.

FIRST VIEWPORT: Top bar with area tabs and the admin identity with MFA state; filter segments and a sample-data marker; left: queue table (track, seller, waiting age, ingest, screening, docs, proposed level) sorted by age with overdue ages in red; right: detail pane (title, then seller, ID, version and age, waveform player, facts, screening with the override note directly under a match, rights and documents, ingest) above a sticky decision bar holding clearance class, price level, the reason approve is blocked, Reject and Approve, all inside 1440x900.

FORM: Night Session (daylight), inherited world; Operate surface built code-led. seed:c71607a50c192dcb

SIGNATURE INTERACTION: j/k moves the selection, space plays the selected track's preview, the detail pane swaps without a page change; approve advances to the next row.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
