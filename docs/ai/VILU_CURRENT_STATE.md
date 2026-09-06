# VILU — Current State

**Every future Vilu session must read this file FIRST**, then `VILU_ROADMAP.md`, `VILU_DECISIONS.md`, `VILU_PROTECTED_CONTRACTS.md`, `VILU_MASTER_CONTEXT.md`, and `VILU_COMPLETION_MATRIX.md` — in that order — before substantial work. Then state explicitly: CURRENT PHASE / CURRENT STATUS / LAST COMPLETED PHASE / NEXT PLANNED PHASE / BLOCKERS / OWNER APPROVAL REQUIRED? / PRODUCTION IMPACT? Never rely only on conversational memory — this file is the source of truth and must be re-verified against actual repository/git state (branches, SHAs, and file contents drift; this document is a snapshot, not a live query).

**For the full phase-by-phase status of the entire 56-phase project (not just the current one), see [`VILU_COMPLETION_MATRIX.md`](VILU_COMPLETION_MATRIX.md).** This file covers only the currently-active phase in detail.

**Snapshot date: 2026-09-06 (updated same day after the full master-project audit — see below).**

---

## Master project audit + Phase 47 security hardening — both complete and deployed (2026-09-06)

Same-day sequence: a full 56-phase repository/production/roadmap audit, a deep-dive Phase 47 security architecture/risk audit, minimal verified-safe security cleanup, an owner-performed agency Firebase Auth migration, retirement of the two named default credentials, and a production hosting deployment of the combined security fix. **Current counts: 19 COMPLETE / 15 PARTIAL / 22 PENDING / 0 CURRENT / 0 BLOCKED — see `VILU_COMPLETION_MATRIX.md` for the full table and evidence.** What matters most for any future session:
1. **Phase 14 (Accessibility) was corrected from COMPLETE to PARTIAL** — the prior status wasn't evidence-backed; real gaps exist (no skip-link, incomplete form labeling, zero Lighthouse/axe ever run). Don't re-mark it COMPLETE without an actual audit run.
2. **Phase 47 (Security Hardening) is now COMPLETE WITH DOCUMENTED RESIDUAL LEGACY COMPATIBILITY, deployed to production.** Commit `080874b`: removed the fully dead login-lockout/session-timeout system, a dead unauthenticated agency-session-restore path, and a fully dead embedded legacy agency mini-login; closed a login-form enumeration signal. The owner then completed a real agency login that self-migrated `agency@viluresidence.com` into Firebase Auth (confirmed via Firebase Console, alongside `viluresidence@gmail.com` which already existed). Commit `6e64c68`: with both named bootstrap accounts confirmed migrated, removed their hardcoded/base64 passwords from `loadUsers()`'s `DEFAULTS` entries, added a narrow scrub for stale leftovers on those two specific emails, and fixed a real gap in `migrateLegacyAgency()` (it never scrubbed the plaintext password post-migration, unlike the PMS's own `migrateLegacyUser()`). **Both commits deployed to production hosting 2026-09-06** and verified live: credential strings confirmed absent from the deployed file, fix comments confirmed present, both login pages confirmed loading cleanly with zero new console errors, public website confirmed visually unaffected. `migrateLegacyUser()`/`migrateLegacyAgency()` themselves remain **intentionally, permanently retained by design** — not unfinished work, but what a self-healing migration path is *for*; a full inventory of every real account beyond the two named defaults was never possible from this environment. Full detail in `VILU_COMPLETION_MATRIX.md` Phase 47.
3. **No PMS/booking/pricing/Firestore-rules/UI logic was ever changed** across either commit — only confirmed-dead code removed, one error string normalized, and password material scrubbed for the two now-confirmed accounts.

## Current phase

Both major workstreams that were active this session are now **COMPLETE and deployed to production**: Phase 15 (cinematic visual redesign) and Phase 47 (minimal security hardening). See `VILU_COMPLETION_MATRIX.md` for the full 56-phase picture and the recommended next phase.

**PHASE 15 — CINEMATIC VISUAL REDESIGN — COMPLETE, deployed 2026-09-06** (commit `dcfe40b`). All previously-pending visual defects (property white-fade, availability, packages, gallery, hero video/brightness, Below South Ari curved panel) fixed, deployed, and verified live on `viluresidence.net`.

**PHASE 47 — SECURITY HARDENING — COMPLETE WITH DOCUMENTED RESIDUAL LEGACY COMPATIBILITY, deployed 2026-09-06** (commits `080874b` + `6e64c68`, combined into one production release). See above for detail.

Owner approval: **YES for both — explicit production deployment authorizations, 2026-09-06**
Production impact: **YES for both — hosting-only, verified live the same day**

## Branch / commit state

- Feature branch: `feat/vilu-reference-design-system`
- Latest pushed commit as of this snapshot: `92a9f35` (history since the visual-redesign deploy: `dcfe40b` full-duration hero/Below South Ari [deployed] → `c6e7d48` docs → `7d607ee` master audit docs → `bb1d399` Phase 47 audit docs → `080874b` Phase 47 minimal security cleanup → `ea98059` docs → `69ae0a9` docs → `6e64c68` Phase 47 default-credential retirement → `92a9f35` docs)
- **Deployed to production, in two separate releases**: `dcfe40b` (2026-09-06, cinematic redesign) and the combined `080874b`+`6e64c68` (2026-09-06, security hardening) — both hosting-only (`firebase deploy --only hosting`), site `viluresidence`. Pre-redesign production baseline was `1130e1e328ac8ac0df88f26b5523ff34201c80c0`; that commit remains `origin/main`'s HEAD — both releases were hosting content releases, not git merges to `main`.
- **Always re-verify both SHAs with `git fetch && git rev-parse origin/main` and `git log` on the feature branch before relying on them — do not trust this file's numbers if the repository shows otherwise.**
- Primary worktree (`C:\Users\hp\vilu-residence`) is intentionally dirty (~199 pre-existing uncommitted legal/privacy files) and must never be used as a build/deploy source or touched/reset. All work happens in the dedicated worktree `C:\Users\hp\vilu-residence-reference-design`.
- Live preview channel: `https://viluresidence--vilu-reference-design-system-bgmh161r.web.app/` (Firebase Hosting preview channel on the `viluresidence` site) — remains available for any future round of changes on this branch.
- Live production domain: `https://viluresidence.net/` — serving the cinematic redesign since 2026-09-06, and the security-hardened PMS/Agency Portal since the same day's second deploy.

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

- **Final exhaustive Dark/Light/mobile/desktop/multilingual QA** — a solid verification pass was done this session (overflow-checked at all 9 required widths, spot-checked ar/ru/zh/de/ja + Arabic RTL at 390/1440, screenshotted the 4 fixed sections in both themes, plus a full live-production sweep after deploy), but a full page-by-page sweep of every guide page, the full Packages page, and Rooms has not been repeated this session — folded into `VILU_COMPLETION_MATRIX.md` Phase 51 (Final Technical QA) rather than kept open indefinitely against this phase.
- Weather/time visual prototype — not started (see below), correctly not blocking this phase.

## Live Destination Experience (weather/time) — status

**PLANNED, design-prototype stage not yet started.** No API has been chosen, no code written. See `VILU_ROADMAP.md` Phase 2 and `VILU_IDEA_BACKLOG.md`. Explicitly: do not connect any live weather API before the hero/visual-correction phase is owner-approved, and do not let this feature block or delay the current hero work.

## Immediate next action

**Phase 21 (Performance) continuation done for now** — commits `2aa4d04` (reflow fix), `4605344`+`f264aa3` (image work: 1 real fix shipped, 1 unsafe approach tried-and-reverted), all preview only, not deployed. See `VILU_COMPLETION_MATRIX.md` Phase 21 for full detail, including a real, newly-discovered bottleneck (continuous Firestore WebChannel long-polling, inherent SDK behavior) that's documented but deliberately not fixed — it touches the protected Firebase-loading architecture and needs its own dedicated, carefully-tested investigation. **Important lesson from this pass, worth remembering**: an automated test suite passing is not the same as verified-safe — the `srcset` image approach passed `phase12-preservation.test.js` but still had a real browser bug only live-browser testing caught; always verify a "safe-looking" performance change in an actual browser before trusting it. Two other active workstreams (visual redesign, security hardening) remain shipped and verified from earlier sessions. Retiring `migrateLegacyUser()`/`migrateLegacyAgency()` themselves is **not** on the todo list — they're intentionally permanent by design. Phase 17 (weather visual prototype) remains next in the roadmap's own numeric sequence and fully unblocked whenever the owner wants it. Phases 48/49 (PMS/Agency Portal hardening) have precisely-itemized remaining scope (monitoring, rate-limiting, auditability, lifecycle) in `VILU_COMPLETION_MATRIX.md` if the owner wants to pursue them next.

## Hard blockers

- **Phase 21 performance fixes (commits `2aa4d04`, `4605344`, `f264aa3`) are not deployed to production** — currently on the preview channel only, awaiting owner review before any deployment.
- No further production deploy without a fresh, explicit owner authorization for that specific deploy — each of the 2026-09-06 authorizations covered exactly one hosting release, not standing permission for future ones.
- No live weather/time API connection until a provider is chosen per `VILU_ROADMAP.md` Phase 2/6's own gating steps, and the phase is separately authorized.
- No merge of this feature branch into `main` has occurred or is authorized — production was updated via `firebase deploy --only hosting` (content releases), not a git merge; `origin/main` is still at the pre-existing baseline `1130e1e3`.
