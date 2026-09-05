# VILU — Changelog

Dated record of significant completed work. Newest entries at the top. This is a summary log, not a replacement for `git log` — check the actual repository history for exact diffs.

---

## 2026-09-06 — Permanent AI memory system created

Created the seven `docs/ai/VILU_*.md` files (this one included) to make the full Vilu strategy, roadmap, protected contracts, and decision history survive independently of any single chat session. Added Phase 26 (Guest Account / CRM / Direct-Marketing System) to the permanent roadmap at the owner's explicit request — recorded only, not implemented. No code changed in this entry; documentation only, on the same feature branch (`feat/vilu-reference-design-system`) as the active visual-correction work, since main is not yet touched.

## 2026-09-06 — Hero video replaced with real drone footage

Audited the repository's `videos/` folder (previously unexamined this phase) and found `Island beach.mov` — a genuine, 31-second, real drone recording of the actual Vilu Residence beach, confirmed playable and decodable (an earlier "Format error" reading was a `data:` URL cross-origin test-harness artifact, not a real codec problem). Selected and exported the strongest continuous 10-second segment (14.0–24.0s of the source) as the new `hero-desktop.mp4` (1240×700 landscape crop) and `hero-mobile.mp4` (1240×2160, near-full source frame). New JPEG posters extracted from the same opening frame (the only locally available encoder, a stripped ffmpeg build bundled with a local BlueStacks install, has no webp encoder — 5 references + 1 test assertion updated from `.webp` to `.jpg` accordingly). Removed the interim `0.88x` playback-rate hack from the previous entry below (superseded — the real longer footage is the actual fix). Added a soft opacity-dip transition at the loop seam. Branch: `feat/vilu-reference-design-system`, commit `f6d4dba`.

## 2026-09-05/06 — Owner-reported visual defects fixed (round 2)

Root-caused and fixed: Live Availability widget overflow (a fixed-minimum-width grid vs. a container that actually shrank as viewport grew, from `vw`-based padding fighting a fixed `max-width`); a real image-load race condition on Below South Ari / Homecoming (reveal-on-scroll could finish before a `loading="lazy"` image had downloaded, rendering blank); a booking-popup Light-theme rendering bug (hardcoded gradient stop broke in Light theme). Reduced the Descent transition section from 140vh to 90vh. Redesigned the Gallery slider with an edge-fade mask and prev/next controls. Eased the hero scrim and applied a (since-superseded) playback-rate stretch to the old 5-second clip. Branch commits: `ae65663`, `ed9b1ea`.

## 2026-09-05 — Site-wide reference-design completion pass

Added real photography to previously text-only homepage sections: What Is Vilu (was a large empty void), the homepage Holiday Packages teaser (both the featured card and the "More Packages" rail, reusing the same per-package photo mapping already live on the full Packages page), Experiences (per-excursion thumbnails for the 5 excursions with a genuine matching photo), Closing (was plain text on empty navy). Audited all 10 guide pages, the header/footer/theme tokens, and light mode across several pages — found already excellent, no changes needed there. Branch commit: `4402f73`.

## 2026-09-05 — Floating wildlife animation and ambient bubbles removed

Owner-flagged priority defect: removed the floating whale-shark/manta/turtle PNG-cutout animation system in the homepage's Below South Ari section (owner: "looks damaged... artificial... cheap") and the sitewide ambient bubble/particle field. Replaced with real underwater photography (`whale_shark_2_gallery.jpg`) using the existing reveal-on-scroll mask technique already proven on the Homecoming section. Branch: `feat/vilu-reference-design-system` created from `origin/main` at `1130e1e3`, commit `5103850`.

## 2026-09-04/05 — Phase 13B-2 integrated and deployed to production

`feat/phase13-homepage-performance` (the `ensureFirebaseReady()` lazy-init architecture, deferring non-critical Firebase SDK loading on the homepage without changing booking/PMS/room-pricing behavior) fast-forwarded into `main` at exact commit `1130e1e328ac8ac0df88f26b5523ff34201c80c0`, then deployed to production via a fresh exact-commit worktree, **Hosting only**. This is the current production baseline SHA referenced throughout this documentation set. Full 50-item live-verification report completed (dark/light, mobile/desktop, multilingual, Arabic RTL, booking read-only QA, consent/analytics, attribution, SEO, status/redirect checks, production Lighthouse snapshot, rollback readiness). No backend service was touched.

## Earlier (pre-dates this changelog, recorded from established project history)

- **Phase 13B-1 / 13B-1.1** — Global SEO localization: static JSON-LD localized across all 10 languages, OG/Twitter metadata localized with `og:locale`, a confirmed FAQ content-loss bug fixed, 2 Russian/Chinese calques refined, internal linking gaps closed for 2 orphaned guides, a "planning cluster" link triangle completed, hero-poster preload hints added, icon-font `font-display:swap` added. Corrected an Arabic `og:locale` bug (was `ar_AR`, incorrectly implying Argentina — fixed to omit the tag entirely) and a manta-ray-snorkeling FAQ JSON-LD/visible-text mismatch. Integrated to `main` via fast-forward.
- **Phase 13A** — Global SEO + performance + international-market architecture audit (audit and strategy only, no implementation).
- **Phase 12 (and its many lettered sub-stages, 12A–12G)** — the cinematic redesign foundation: dark/light theme system, hero video, homepage restructure into the current 18-section architecture, global nav/footer unification, self-hosted webfonts, consent foundation, legal pages.
- **Phase 9/10/11 (legacy numbering)** — factual corrections, global navigation/footer unification, self-hosted public fonts, consent foundation, attribution-core normalization.

## Template for future entries

```
## YYYY-MM-DD — <short title>

<what changed and why, in 2-5 sentences>. Branch: <branch>, commit(s): <sha(s)>.
Tests: <pass/fail summary>. Build: <N/N>. Preview: <URL if applicable>.
Owner approval: <YES/NO/PENDING>. Production impact: <YES/NO — detail if YES>.
```
