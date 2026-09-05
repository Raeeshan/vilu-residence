# VILU — Decisions Log

Owner-approved design/business/technical decisions. These are settled — don't re-litigate them without a new, explicit owner instruction. Dated where the date is known; several predate this documentation system and are recorded from established project history.

---

## Standing workflow

**ChatGPT ↔ Claude permanent workflow:** ChatGPT is the architecture/strategy/review gate; the owner relays ChatGPT's instructions to Claude Code verbatim; Claude executes exactly one approved stage at a time, verifies, reports in the exact required format, then stops for review. Claude must never autonomously advance phases, commit, push, deploy, or touch business/pricing/backend data without current, explicit authorization for that specific action. This applies to every phase in `VILU_ROADMAP.md`, not just the current one.

## Identity and positioning

- Vilu Residence is a real six-room local-island guesthouse — never presented as a resort, never implied to have resort facilities or a private island. (Standing.)
- Vilu (the brand) is broader than Vilu Residence (the property) — the long-term platform vision spans destination content, packages, and eventually other Vilu-branded concepts (Voyager, Ari Dive, Spice, Griffin), all currently unlaunched. (2026-09-06, `VILU_MASTER_CONTEXT.md` §7.)
- Wildlife sightings (whale sharks, mantas, turtles) are never guaranteed, in any copy, in any language. (Standing — enforced repeatedly across FAQ/JSON-LD parity work.)
- Whale-shark positioning must stay factual: South Ari is a year-round whale-shark hotspot and Maamigili is one of its local-island gateways — never an absolute claim like "Maamigili is THE Whale Shark Island." Preferred framing: *"Maamigili — A Gateway to the Maldives' Year-Round Whale Shark Region."* (Standing.)

## Design system

- First-ever visit = Cinematic Dark theme; the OS `prefers-color-scheme` is deliberately **not** consulted for the first-visit default (an explicit approved decision, not an oversight). Manual theme choice then persists per the existing consent/session-aware mechanism. (Phase 12B-B decision 3, carried forward.)
- Motion philosophy: photography first, motion second. No floating-animal cutouts, no ambient bubble/particle fields, no WebGL-for-decoration, no scroll-jacking, no cursor gimmicks, no multiple autoplay videos. **Confirmed the hard way**: the floating whale-shark/manta/turtle cutout system and sitewide bubble field were shipped once, then explicitly flagged by the owner as "damaged... artificial... cheap" and removed (2026-09-05/06, see `VILU_CHANGELOG.md`). Do not reintroduce this pattern anywhere on the site.
- Reveal-on-scroll animations over real photography must never be able to render as fully blank — a full clip-path mask gated purely on an IntersectionObserver trigger can finish "revealing" before a `loading="lazy"` image has actually downloaded. Fixed pattern going forward: don't lazy-load images that are gated behind a scroll-reveal, and use an opacity fade (never below ~40-45%) rather than a 0%-to-100% mask, so the image is always at least dimly present. (2026-09-06, applied to Below South Ari + Homecoming.)
- The Dark/Light reference screenshots the owner supplied are art-direction references only — never source real package names, prices, or business copy from them. (Standing, repeated explicitly across multiple phases.)
- Existing protected accent tokens (amber "Coconut Amber" family, deep navy) must not be replaced with new, un-related colors. Contrast must remain WCAG-compliant in both themes.

## Homepage architecture

- The 18-section homepage sequence (Hero → What Is Vilu → Holiday Packages → Above South Ari → Descent → Below South Ari → Homecoming → Experiences → Accommodation/Booking → Rooms → Live Availability → South Ari Expertise → Trust/Reviews → FAQ → Gallery → Closing → Contact → Footer) is the approved architecture — see `VILU_MASTER_CONTEXT.md` §8. Preserve unless the owner explicitly changes it.
- Hero must not lead with a package price. Primary CTAs stay "Explore Holiday Packages" / "Check Availability."
- Closing section direction is fixed: *"Your South Ari story starts here."*
- The homepage's accommodation-adjacent Live Availability widget is deliberately a "single quiet instrument," not a two-column marketing split (Phase 12B-E2B decision, carried forward) — refine its visual composition, but don't turn it back into a bigger marketing block.

## Package/accommodation funnels

- Package-selling and accommodation-booking are two separate systems and funnels. Do not route package enquiries through the accommodation PMS unless a future phase explicitly redesigns this. (`VILU_MASTER_CONTEXT.md` §3.)
- Preferred bridging copy when a visitor might want accommodation only: *"Prefer to arrange accommodation separately? Check live availability →"*

## Hero video

- The ~5-second original hero derivative was **not** treated as the final answer once a genuinely better, previously-unaudited real source (`videos/Island beach.mov`, 31s of real drone footage) was found in the repository. Decision: always audit for better real source material before accepting a technical limitation as final — don't just patch around a bad asset (e.g., an artificial `playbackRate` slowdown) when real footage might exist. (2026-09-06.)
- No audio on the hero video. No fabricated/AI-generated hero footage — real property/location footage only.
- A stripped local ffmpeg build (bundled with BlueStacks) has no webp encoder — new hero posters are legitimately `.jpg`, not `.webp`. This is an accepted, documented substitution, not a regression; don't "fix" it back to `.webp` without a real webp encoder available.

## Deployment / release discipline

- Every production release in this project's history has followed: verify exact SHAs → pre-integration tests → fast-forward-only merge (no squash/rebase/cherry-pick/force) → post-integration re-test → fresh detached exact-commit worktree as the *only* deploy source → Hosting-only deploy → live verification across dark/light/mobile/desktop/multilingual/booking/consent/SEO → rollback readiness noted → worktree cleanup. See `VILU_PROTECTED_CONTRACTS.md` §"Deployment safety rules" for the full checklist. This is not optional process — it has prevented at least one real incident (see next line).
- **Incident on record:** a prior scratch Firebase config / wrong public-root deploy caused a production 404. Never create a scratch `firebase.json`, never change the Hosting public path, never deploy from anywhere but the legitimate repository configuration at the exact approved commit. (Recorded permanently — see `feedback_deploy_public_dir_resolution` in the assistant's own cross-session memory, and now here for repository-level permanence.)
- The primary/dirty worktree (`C:\Users\hp\vilu-residence`, ~199 pre-existing uncommitted files) must never be used as a build or deploy source, and must never be reset or cleaned.

## Guest Account / CRM (Phase 26, added 2026-09-06)

- Marketing consent is a separate decision from account creation — creating a Vilu account never auto-subscribes a guest to marketing. Clear, explicit opt-in required, with working subscribe/unsubscribe/change-preferences at all times.
- Newsletter signup must work *without* requiring a full account — the two systems (Guest Account, Newsletter Subscriber) must coexist architecturally, not be forced into one.
- Booking/stay history in a future guest account is only ever built if it can be linked *securely* to the existing PMS — and even then, never exposes other guests' bookings, internal notes, staff information, or payment-sensitive data.
- No loyalty discounts, rates, or rules are to be invented without explicit, separate owner approval — loyalty is recorded as `FUTURE / NOT DEFINED`, distinct from the rest of the CRM phase.
- Full sub-phase ordering and detail: `VILU_ROADMAP.md` Phase 26.
