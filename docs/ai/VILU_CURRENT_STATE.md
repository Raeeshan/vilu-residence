# VILU — Current State

**Every future Vilu session must read this file FIRST**, then `VILU_ROADMAP.md`, `VILU_DECISIONS.md`, `VILU_PROTECTED_CONTRACTS.md`, `VILU_MASTER_CONTEXT.md`, and `VILU_COMPLETION_MATRIX.md` — in that order — before substantial work. Then state explicitly: CURRENT PHASE / CURRENT STATUS / LAST COMPLETED PHASE / NEXT PLANNED PHASE / BLOCKERS / OWNER APPROVAL REQUIRED? / PRODUCTION IMPACT? Never rely only on conversational memory — this file is the source of truth and must be re-verified against actual repository/git state (branches, SHAs, and file contents drift; this document is a snapshot, not a live query).

**For the full phase-by-phase status of the entire 56-phase project (not just the current one), see [`VILU_COMPLETION_MATRIX.md`](VILU_COMPLETION_MATRIX.md).** This file covers only the currently-active phase in detail.

**Snapshot date: 2026-09-06.**

---

## Current phase

**PHASE 15 — CURRENT VISUAL CORRECTION** (site-wide reference-design pass; see `VILU_COMPLETION_MATRIX.md` for how this maps to the original `VILU_ROADMAP.md` Phase 1 numbering)
Status: **IMPLEMENTATION IN PROGRESS** — all 4 previously-pending visual defects are now fixed and verified; final exhaustive cross-page/cross-language QA remains open
Owner approval: **NO**
Production impact: **NONE YET — blocked until owner approves the preview**

## Branch / commit state

- Feature branch: `feat/vilu-reference-design-system`
- Latest pushed commit as of this snapshot: `8e4d0a1` (history: `1130e1e` prod baseline → `5103850` remove floating wildlife/bubbles → `4402f73` site-wide design completion pass → `ae65663` owner-feedback visual fixes round 1 → `ed9b1ea` playbackRate ordering fix → `f6d4dba` Island Beach hero replacement → `5a7f5a4` permanent AI memory/roadmap docs → `16dcfaf` hero color-range hardening + hero→section fade + Descent shrink → `8e4d0a1` property white-fade fix + availability/packages/gallery redesign)
- Production baseline (`origin/main` at the last confirmed check): `1130e1e328ac8ac0df88f26b5523ff34201c80c0`
- **Always re-verify both SHAs with `git fetch && git rev-parse origin/main` and `git log` on the feature branch before relying on them — do not trust this file's numbers if the repository shows otherwise.**
- Primary worktree (`C:\Users\hp\vilu-residence`) is intentionally dirty (~199 pre-existing uncommitted legal/privacy files) and must never be used as a build/deploy source or touched/reset. All design work happens in the dedicated worktree `C:\Users\hp\vilu-residence-reference-design`.
- Live preview channel: `https://viluresidence--vilu-reference-design-system-bgmh161r.web.app/` (Firebase Hosting preview channel on the `viluresidence` site, re-deployed after each round of fixes).
- Live production domain: `https://viluresidence.net/` — unchanged throughout this entire phase.

## What's done in this phase so far

- Removed the floating whale-shark/manta/turtle PNG-cutout animation and the sitewide ambient bubble/particle field (owner-flagged priority defect — "damaged," "artificial," "cheap").
- Replaced Below South Ari's cutout scene with real underwater photography (`whale_shark_2_gallery.jpg`), reveal-on-scroll.
- Added real photography to previously text-only homepage sections: What Is Vilu, Experiences (per-excursion thumbnails), Closing.
- Fixed a real race condition: Below South Ari and Homecoming images were `loading="lazy"` while gated behind an IntersectionObserver-triggered reveal — the reveal could finish before the image loaded, rendering blank. Fixed (removed lazy-load, switched from a clip-path mask to an opacity fade).
- Fixed a real bug: the booking popup's background rendered as a broken light-to-dark wash in Light theme (hardcoded dark gradient stop). Now a solid theme-aware surface.
- Reduced the Descent transition section: `140vh` → `90vh` → `56vh` (final pass added a static radial glow for depth; no floating shapes/particles).
- **Replaced the entire hero video** with a genuine 10-second segment of real drone footage (`Island beach.mov`, previously unaudited in the repo), natural 1.0x playback, no audio, new JPEG posters. Commit `16dcfaf` additionally hardened the export's color-range handling as a defensive measure (the originally-suspected "13% darker" reading turned out to be a flawed crop-vs-full-frame comparison, not a real bug — see `VILU_DECISIONS.md`).
- **Hero → next-section hard cut — FIXED** (`16dcfaf`): the hero scrim's final gradient stop only reached .50 opacity, leaving real photography visible right up to the flat section boundary. Extended the last ~20% of the scrim to .94 opacity so the footage visually settles into dark before the boundary.
- **Property/Homecoming white fade — FIXED** (`8e4d0a1`): root-caused to the reveal-on-scroll system being gated on a single IntersectionObserver threshold crossing with no fallback — a direct anchor-link landing, bfcache restore, or fast scroll could leave the pre-reveal 45%-opacity frame stuck indefinitely, reading as a washed-out fog specifically on Homecoming's light cream backdrop (Below South Ari's dark backdrop hid the same latent bug). Raised the pre-reveal floor to .82 and added a first-visibility-scoped 900ms safety-net timer that guarantees the reveal completes.
- **Availability composition — FIXED** (`8e4d0a1`): replaced the single flex row (4 fields + CTA competing for space) with a balanced auto-fit field grid + one full-width, taller CTA button on its own row. Fixed a real 320px overflow this surfaced (the button's own `white-space:nowrap` clipped its label at narrow widths) by scoping the fix to `.la-field`/`.la-btn` only, never the shared `.bwf-*` classes the booking popup/guest-details form also use. Verified zero overflow at 320/375/390/430/768/1024/1280/1440/1920, English and Arabic RTL.
- **Homepage package arrangement — FIXED** (`8e4d0a1`): replaced the 1-giant-card + 8-item horizontal rail with 1 flagship + 2 secondary photographic cards, using the same editorial selection (Most Popular / Best Value / Honeymoon Special) already proven on `holiday-packages.html`'s own "Featured Journeys" panel. The other 6 packages remain real/bookable via "Explore All Packages." `holiday-packages.html` itself was inspected and left unchanged — its Featured Journeys composition and auto-fit Full Collection grid were already strong. A regression this surfaced (the taller new layout made `#hp-grid`'s scroll-reveal threshold geometrically unreachable) was fixed by removing the reveal gate from that element; a protected no-JS contract this also initially broke (all 9 packages must stay crawlable in the static fallback) was restored.
- **Gallery — FIXED** (`8e4d0a1`): replaced the equal-width horizontal scroll rail with one dominant image + a slim thumbnail strip (click-to-swap, counter/caption, arrows), same 6 real photos, no new library.

## Not yet done in this phase

- **Final exhaustive Dark/Light/mobile/desktop/multilingual QA** — a solid verification pass was done this session (overflow-checked at all 9 required widths, spot-checked ar/ru/zh/de/ja + Arabic RTL at 390/1440, screenshotted the 4 fixed sections in both themes), but a full page-by-page sweep of every guide page, the full Packages page, and Rooms has not been repeated this session.
- Weather/time visual prototype — not started (see below), correctly not blocking this phase.

## Live Destination Experience (weather/time) — status

**PLANNED, design-prototype stage not yet started.** No API has been chosen, no code written. See `VILU_ROADMAP.md` Phase 2 and `VILU_IDEA_BACKLOG.md`. Explicitly: do not connect any live weather API before the hero/visual-correction phase is owner-approved, and do not let this feature block or delay the current hero work.

## Immediate next action

Owner review of the current preview. If further corrections come back, address them one stage at a time per the standing verbatim-relay workflow (see `VILU_DECISIONS.md` §"Standing workflow"). Do not start Phase 2 (weather/time) or any SEO/international/security phase until this phase is owner-approved and released.

## Hard blockers

- No merge to `main` and no production deploy until the owner explicitly says the visual design is approved.
- No live weather/time API connection until the visual phase is approved and a provider is chosen per `VILU_ROADMAP.md` Phase 2/6's own gating steps.
