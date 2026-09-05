# VILU — Protected Contracts

Code, data, and business behavior that future agents (human or AI) must not accidentally break. See also `docs/PHASE12_PRESERVATION_BASELINE.md` for the detailed, machine-checkable P0–P4 classification enforced by `test/phase12-preservation.test.js` — this file summarizes and extends it with business-level contracts that file doesn't cover.

---

## Truthful positioning (hard rule, no exceptions)

Never present Vilu Residence as a resort, or imply resort facilities, a private resort island, facilities that don't exist, wildlife-sighting guarantees, or unverified services. It is a boutique/local-island guesthouse — six rooms. Never fabricate credentials, awards, reviews, statistics, wildlife success rates, or partnerships anywhere on the site (see `VILU_ROADMAP.md` Phase 21, E-E-A-T).

## Locked package data — do not alter without explicit owner approval

Nine packages, each with a fixed `id`, price, night count, and inclusion list. **Never source package names/prices/inclusions from the owner's Dark/Light art-direction reference screenshots — those are visual mockups only, not real data.**

| # | Name | ID | Price pp | Nights | Badge |
|---|---|---|---|---|---|
| 1 | Island Explorer Getaway | `island-explorer-getaway` | $450 | 4 | — |
| 2 | Reef & Sunset Adventure | `reef-sunset-adventure` | $550 | 5 | — |
| 3 | Island Serenity Escape | `island-serenity-escape` | $650 | 6 | — |
| 4 | Maldives Dream Bliss | `maldives-dream-bliss` | $700 | 7 | Most Popular |
| 5 | Ultimate Island Relaxation | `ultimate-island-relaxation` | $790 | 8 | — |
| 6 | Grand Maldives Escape | `grand-maldives-escape` | $880 | 9 | — |
| 7 | Ultimate Maldives Odyssey | `ultimate-maldives-odyssey` | $940 | 10 | Best Value |
| 8 | Ultimate Resort & Island Odyssey | `ultimate-resort-island-odyssey` | $1300 | 11 | Most Complete |
| 9 | Honeymoon Dream Escape | `honeymoon-dream-escape` | $1100 | 10 | Honeymoon Special |

Package 1 includes: round-trip speedboat, Double Room, breakfast, Whale Shark, Manta, Turtle. Add-ons: HB $25/day, FB $40/day, Photography $25/hour. Each package's own activity list (Whale Shark / Manta / Turtle / Sunset / Sandbank / Dolphin / Private Island Picnic / Night Fishing / Private Dinner at Beach / Resort Day Visit / Romantic Bed Décor) is fixed per the table above — do not add or remove activities from a package without owner approval. Never change: package names, IDs, prices, nights, inclusions, activity combinations, deep links, analytics wiring, or enquiry behavior when doing visual/design work.

## Public room data

Six rooms total. Public rates on record: Double $85, Deluxe Family $80, Deluxe Family Open Deck $90 — breakfast included. Do not change rates during visual/design work; reverify operational facts before creating any new indexed commercial content (see §"Public operational fact safeguard" below).

## Private commercial data — never expose publicly

Supplier costs, margins, net rates, private excursion cost structure, agency commissions, agency private pricing, internal PMS rates, staff credentials, passwords. Some dedicated pages may already show owner-approved *public* excursion pricing (e.g. historically approved whale/manta per-person rates) — don't remove or change existing approved public pricing without a separate business decision, and don't turn the whole site into a raw price list.

## PMS / booking protected contracts

Never change the business semantics of: `writeReservation()`, `submitDirectBooking()`, `runTransaction`, the `{merge:true}` write pattern, `ROOM_CONFLICT` handling, `openBookingPopup()`, `openBookingPage()`, `bfpSearch()`, `confirmGuestBooking()`, `initBookingHashHandoff()`, `BroadcastChannel('vilu_pms')`. Reservation status on write: `Pending`. Reservation source: `Website`. **Never create a real reservation during QA/testing** — read-only checks (opening the popup, searching availability, viewing room results) only, never the final confirmation step.

## Firebase / performance protected contract

`ensureFirebaseReady()` — memoized single shared promise, times out, allows retry after failure, loaded via dynamic non-blocking script injection started immediately (not gated on `DOMContentLoaded`). Every Firestore-touching function must `await ensureFirebaseReady()` before its first `fsDb.*` use. Opening the booking UI (popup/full page) must have zero Firebase dependency — both read only the already-loaded `ROOMS` array. Preserve this architecture (Phase 13B-2) unless a tested, explicitly-approved superior replacement is presented.

## Analytics protected contract

GA4 Measurement ID: `G-1EPZ71Q331`. Canonical dimensions: `package_id`, `experience_id`, `guide_slug`, `contact_method`, `source_context`, `first_touch_source`, `first_touch_medium`, `first_touch_campaign`, `landing_page_slug`, `landing_language`, `site_language`. Canonical events: `language_change`, `contact_click`, `package_view`, `package_enquire`, `experience_enquire`, `availability_click`, `faq_expand`, `related_content_click`, `review_link_click`, `page_not_found`. Do not casually rename or remove any of these. Future Guest-Account-phase events (`account_signup`, `account_login`, `newsletter_signup`, `offer_view`, `offer_click`, `saved_package`, `saved_room`) must never carry email, phone, full name, or booking personal details into GA. Do not fire noisy analytics events for automatic background refreshes (e.g. weather auto-refresh must not spam `weather_forecast_open`).

## Consent / privacy protected contract

Consent categories: Essential, Preferences, Analytics, Marketing. GA must never load before Analytics consent is granted (verified repeatedly: 0 GA requests pre-consent, exactly 1 load after Accept All). No session replay currently required. Attribution storage key: `vilu_attribution`. Do not weaken consent to inflate analytics numbers. A future Guest-Account marketing-consent system is a *separate* consent surface from this cookie-consent system — do not conflate the two, and do not let account creation imply marketing opt-in.

## Technical SEO protected contract

Preserve: canonical URLs, hreflang, localized metadata, localized JSON-LD, FAQ schema/visible-text parity, OG/Twitter metadata, sitemap, robots, internal linking, the ~140-page multilingual build (10 languages × the canonical page set, generated by `build-i18n-pages.js`). No valuable URL, internal link, keyword-rich content, schema, translation, hreflang entry, canonical, package deep link, analytics behavior, booking behavior, or indexed guide may disappear simply because a redesign is visually cleaner — restructure/wrap semantic content, never rebuild it from memory. Arabic pages carry no `og:locale`/`og:locale:alternate` at all (not `ar_AR` — AR is Argentina's real ISO code, not generic Arabic) — this was a deliberate, verified fix; don't reintroduce a country-specific Arabic locale value.

Full detailed P0–P4 inventory (canonical URL list, `data-page-type`/`data-page-slug` values, reachable-alias audit, etc.) lives in `docs/PHASE12_PRESERVATION_BASELINE.md` — read it for anything this summary doesn't cover.

## Media / asset safety

Media cleanup or migration must be additive and reversible, and verified before anything is deleted or moved. Before removing/moving any asset, check: Firebase Storage, Firestore references, HTML references (across all 10 language builds), PMS references, Agency Portal references. Never assume an old `photos[]`-style structure is unused just because it looks legacy.

## Deployment safety rules (permanent)

- Never deploy from a scratch/temporary Firebase config.
- Never deploy from the dirty primary worktree (`C:\Users\hp\vilu-residence`).
- Never reset or clean unrelated primary-worktree changes.
- Always use a clean, dedicated, exact-commit worktree as the deploy source — verify `firebase.json`, `.firebaserc`, the Hosting site name, and the deploy source directory every single time, never assume from a prior session.
- Visual/public releases are **Hosting only** unless backend deployment is separately, explicitly authorized. Never let a deploy command accidentally include Firestore rules, Firestore indexes, Storage, or Functions.
- Fast-forward-only integration to `main`: no squash, no rebase, no cherry-pick, no force push. Verify the exact target SHA via a fresh `git fetch` + `git rev-parse`, never trust push output alone.
- A historical incident (scratch Firebase config / wrong public-root → production 404) is the reason this section exists as a hard rule, not a suggestion.

## Public operational fact safeguard

Before publishing any indexed operational/commercial claim, reverify: room rates, room capacities, meal plans, taxes, transport schedules/prices, activity duration/inclusions, check-in/checkout times, child policy, transfer procedures, availability claims, hotel policies. Historical documentation (including this file) can become stale — don't blindly publish stale data into new indexed content.

## Guest Account / CRM security contract (Phase 26 — applies once that phase begins)

Never store plaintext passwords. Never store passwords in localStorage. Never expose Firebase/Admin secrets. Full security review (Firebase Auth or alternative architecture, email verification, password reset, session handling, rate limiting, account-enumeration risk, authorization, Firestore rules, PMS-linking boundaries, CRM permissions, staff access) must happen *before* any implementation, not after.

## Weather/time fallback contract (Phase 6 — applies once that phase begins)

Weather/time data must load asynchronously and must never block hero rendering, LCP, booking, Firebase, consent, or main content. If the weather API fails, the website must remain beautiful with a graceful fallback (e.g. "Maamigili · South Ari — Local Time" only) — never show `undefined`, `NaN`, a broken icon, a fake `0°C`, or an empty large panel.
