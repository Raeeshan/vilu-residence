# VILU — Current State

**Every future Vilu session must read this file FIRST**, then `VILU_ROADMAP.md`, `VILU_DECISIONS.md`, `VILU_PROTECTED_CONTRACTS.md`, `VILU_MASTER_CONTEXT.md` — in that order — before substantial work. Then state explicitly: CURRENT PHASE / CURRENT STATUS / LAST COMPLETED PHASE / NEXT PLANNED PHASE / BLOCKERS / OWNER APPROVAL REQUIRED? / PRODUCTION IMPACT? Never rely only on conversational memory — this file is the source of truth and must be re-verified against actual repository/git state (branches, SHAs, and file contents drift; this document is a snapshot, not a live query).

**Snapshot date: 2026-09-06.**

---

## Current phase

**PHASE 1 — VISUAL CORRECTION (Island Beach Hero + site-wide reference-design pass)**
Status: **IMPLEMENTATION IN PROGRESS**
Owner approval: **NO**
Production impact: **NONE YET — blocked until owner approves the preview**

## Branch / commit state

- Feature branch: `feat/vilu-reference-design-system`
- Latest pushed commit as of this snapshot: `f6d4dba` (history: `1130e1e` prod baseline → `5103850` remove floating wildlife/bubbles → `4402f73` site-wide design completion pass → `ae65663` owner-feedback visual fixes round 1 → `ed9b1ea` playbackRate ordering fix → `f6d4dba` Island Beach hero replacement)
- Production baseline (`origin/main` at the last confirmed check): `1130e1e328ac8ac0df88f26b5523ff34201c80c0`
- **Always re-verify both SHAs with `git fetch && git rev-parse origin/main` and `git log` on the feature branch before relying on them — do not trust this file's numbers if the repository shows otherwise.**
- Primary worktree (`C:\Users\hp\vilu-residence`) is intentionally dirty (~199 pre-existing uncommitted legal/privacy files) and must never be used as a build/deploy source or touched/reset. All design work happens in the dedicated worktree `C:\Users\hp\vilu-residence-reference-design`.
- Live preview channel: `https://viluresidence--vilu-reference-design-system-bgmh161r.web.app/` (Firebase Hosting preview channel on the `viluresidence` site, re-deployed after each round of fixes).
- Live production domain: `https://viluresidence.net/` — unchanged throughout this entire phase.

## What's done in this phase so far

- Removed the floating whale-shark/manta/turtle PNG-cutout animation and the sitewide ambient bubble/particle field (owner-flagged priority defect — "damaged," "artificial," "cheap").
- Replaced Below South Ari's cutout scene with real underwater photography (`whale_shark_2_gallery.jpg`), reveal-on-scroll.
- Added real photography to previously text-only homepage sections: What Is Vilu, the homepage Holiday Packages teaser (featured card + rail), Experiences (per-excursion thumbnails), Closing.
- Fixed a real race condition: Below South Ari and Homecoming images were `loading="lazy"` while gated behind an IntersectionObserver-triggered reveal — the reveal could finish before the image loaded, rendering blank. Fixed (removed lazy-load on those two images, switched the reveal from a full clip-path mask to an opacity fade that's never fully blank).
- Fixed a real CSS bug: the Live Availability widget's 5-column grid had a fixed minimum content width that could exceed its actual container width (which itself shrank as viewport grew, from unbounded `vw` padding fighting a fixed `max-width`) — it visibly overflowed its box on real desktop widths. Converted to `flex-wrap` + fixed padding; verified zero overflow at 320/375/390/430/1000/1100/1280/1353/1440px.
- Fixed a real bug: the booking popup's background was a two-tone gradient with one stop hardcoded to a dark hex, so it rendered as a broken light-to-dark wash in Light theme. Now a solid theme-aware surface.
- Redesigned the Gallery slider: added an edge-fade mask and prev/next arrow controls (was a bare native horizontal scroller with an abruptly cut-off last card).
- Reduced the Descent transition section from `140vh` to `90vh` (owner: "very large empty blue area").
- **Replaced the entire hero video.** Audited the repository's `videos/` folder and found `Island beach.mov` — genuine, previously-unused 31-second real drone footage of the actual Vilu Residence beach (confirmed via direct box-parsing + Chrome playback, NOT the "Format error" it first appeared to have — that was a `data:` URL cross-origin test artifact). Exported the strongest 10-second segment (14.0–24.0s) as new `hero-desktop.mp4` (1240×700) / `hero-mobile.mp4` (1240×2160), with new JPEG posters (the only locally available encoder — ffmpeg bundled with a local BlueStacks install — has no webp encoder, so posters are `.jpg`, not `.webp`; 5 references + 1 test assertion updated accordingly). Added a soft opacity-dip loop-seam transition. Removed the interim `0.88x` playback-rate hack from the previous round (the real, longer footage solves "too short" properly).

## Not yet done in this phase (explicitly deferred to a follow-up turn, per the owner's own scoped instructions)

- Hero → next-section fade/blend transition (owner: "not just a shorter descent — a real faded transition").
- Descent section further redesign (owner: 90vh may still be too large; wants it to feel like a transition, not a destination).
- Property/Homecoming "white fade" — investigated twice, could not reproduce a persistent defect (screenshots showed a clean render both times); owner has explicitly said to keep treating this as a real defect regardless, not dismiss it as a timing artifact. Needs another audit pass, ideally with the owner's own screenshot re-examined pixel-by-pixel or a fresh repro attempt at a different viewport/network condition.
- Live Availability — overflow is fixed, but visual *composition* refinement is still requested (owner: "should not merely fit, it should look premium and balanced").
- Holiday Packages homepage arrangement — real photography was added, but the owner has twice said spacing/photos alone are "not enough" and wants an actual visual hierarchy redesign (e.g., 2 strong photographic cards, or featured+2/3-card grid) rather than one big card + a rail.
- Full Holiday Packages page — not touched this phase; the existing "Featured Journeys" 3-panel grid was independently found to already be excellent, but the owner has not been shown this specific finding yet and it should be re-confirmed against their reference images before being called "done."
- Gallery — arrows/fade shipped, but the owner's most recent instruction says this alone is "not automatically enough" and wants the layout itself reconsidered (asymmetric editorial composition, one strong image + secondary peeks, etc.) — not yet attempted.

## Live Destination Experience (weather/time) — status

**PLANNED, design-prototype stage not yet started.** No API has been chosen, no code written. See `VILU_ROADMAP.md` Phase 2 and `VILU_IDEA_BACKLOG.md`. Explicitly: do not connect any live weather API before the hero/visual-correction phase is owner-approved, and do not let this feature block or delay the current hero work.

## Immediate next action

Continue the visual-correction punch list above (hero-to-section fade, descent, property white-fade re-audit, availability polish, packages redesign, gallery redesign) in whatever order the owner next approves, one stage at a time, per the standing verbatim-relay workflow (see `VILU_DECISIONS.md` §"Standing workflow"). Do not start Phase 2 (weather/time) or any SEO/international/security phase until this phase is owner-approved and released.

## Hard blockers

- No merge to `main` and no production deploy until the owner explicitly says the visual design is approved.
- No live weather/time API connection until the visual phase is approved and a provider is chosen per `VILU_ROADMAP.md` Phase 2/6's own gating steps.
