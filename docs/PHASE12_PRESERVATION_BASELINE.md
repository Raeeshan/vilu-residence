# Phase 12 Preservation Baseline — Vilu Residence public website

**Baseline commit:** `87a640351e8b4753987fea0a2c851ffecf725196` (production / `origin/main`)
**Baseline date:** 2026-09-04
**Status:** human-readable preservation contract for the Phase 12 cinematic redesign. Machine-checkable invariants live in `test/phase12-preservation-manifest.json` and are enforced by `node test/phase12-preservation.test.js`. Anything in this document that the harness cannot check is marked **manual**.

Rule of Phase 12: **keep the existing booking/PMS engine, analytics, consent, SEO and multilingual routing — redesign their presentation.** Nothing classified P0 below may change without explicit owner approval.

---

## 1. Priority classification

| Level | Meaning | Examples |
|---|---|---|
| **P0 — must preserve exactly** | Accidental change can break production URLs, indexing/canonical/hreflang, package commercial data, PMS/booking integration, reservation writes, analytics taxonomy, attribution, consent, multilingual routing, legal/privacy behaviour, GA measurement identity. | canonical URL set and sitemap; title/meta/H1/JSON-LD per page; nine-package contract; Firestore collections, `writeReservation()`, `submitDirectBooking()`; `consent.js`, `analytics.js` semantics; `G-1EPZ71Q331`; `<body data-page-type data-page-slug>`; `/xx/` routing and `dir="rtl"`; noindex on legal pages; robots exclusions for internal tools. |
| **P1 — must preserve function, may redesign visually** | May improve, must not regress. | navigation, footer, booking UI, availability UI, package-card behaviour, consent UI presentation, mobile usability, responsive behaviour, LCP sensitivity, image optimisation, lazy loading, video performance and responsive art direction, reduced-motion, accessibility behaviour, focus traps, no unnecessary blocking resources, **zero external Google Fonts**, consent-gated GA loading. |
| **P2 — content may be restructured but not lost** | Search/traveller content may be repositioned, redesigned, split into storytelling sections or progressively revealed — never silently removed. | all guide prose, 99 FAQ pairs, transport guidance, room information, trust and booking-terms copy, legal pages. |
| **P3 — safe design replacement area** | Purely presentational, no SEO/business/system dependency. | decorative backgrounds, visual framing, ornamental dividers, textures, presentational wrappers, non-semantic animation, cosmetic card styling. |
| **P4 — known issue / candidate improvement** | Pre-existing weaknesses; improve later only with explicit approval. Listed in §17. | |

---

## 2. Canonical URL inventory (P0)

**Canonical English pages (12, all in sitemap):**

| Canonical URL | Source file | `data-page-type` / `data-page-slug` |
|---|---|---|
| `https://viluresidence.net/` | `vilu-website.html` (rewrite from `/`) | home / home |
| `/holiday-packages.html` | same | package / holiday-packages |
| `/maamigili-guide.html` | same | guide / maamigili-guide |
| `/south-ari-atoll-guide.html` | same | guide / south-ari-atoll-guide |
| `/whale-shark-snorkeling.html` | same | guide / whale-shark-snorkeling |
| `/manta-ray-snorkeling.html` | same | guide / manta-ray-snorkeling |
| `/things-to-do-maamigili.html` | same | guide / things-to-do-maamigili |
| `/best-time-to-visit.html` | same | guide / best-time-to-visit |
| `/guesthouse-vs-resort.html` | same | guide / guesthouse-vs-resort |
| `/maldives-holiday-cost.html` | same | guide / maldives-holiday-cost |
| `/best-local-islands-snorkeling.html` | same | guide / best-local-islands-snorkeling |
| `/south-ari-vs-other-regions.html` | same | guide / south-ari-vs-other-regions |

**Translated canonical URLs (120):** `/{ar,cs,de,fr,it,ja,ko,ru,sk,zh}/` for the homepage and `/xx/<page>.html` for the other 11 pages. `firebase.json` rewrites `/` → `/vilu-website.html` and `/xx`, `/xx/` → `/xx/index.html`.

**Reachable, deliberately not in the sitemap:** `privacy-policy.html`, `cookies.html` (+ 10 localized copies each, `noindex, follow`), `404.html` (English only, `noindex, follow`, no canonical/hreflang).

**Sitemap state:** `sitemap.xml` contains exactly **132** URLs = 12 pages × (English + 10 languages); no physical-file aliases, no legal pages, no internal tools. `robots.txt` allows `/`, disallows the two internal tools, and advertises the sitemap.

### 2.1 Reachable aliases (live HTTP audit, 2026-09-04)

| URL | Status | Behaviour | Canonical in response | Sitemap | Indexability | Classification |
|---|---|---|---|---|---|---|
| `/` | 200 | rewrite → `vilu-website.html` | `https://viluresidence.net/` | yes | index | canonical |
| `/vilu-website.html` | 200 | physical file served directly (no redirect) | `https://viluresidence.net/` | no | index, canonical points at `/` | **P4 SEO cleanup candidate** — duplicate content technically reachable, mitigated by canonical |
| `/de/` | 200 | rewrite → `de/index.html` | `https://viluresidence.net/de/` | yes | index | canonical |
| `/de/index.html` | 200 | physical file served directly | `https://viluresidence.net/de/` | no | index, canonical points at `/de/` | **P4 SEO cleanup candidate** (same pattern for all 10 languages, e.g. `/ar/index.html`, `/zh/index.html` verified 200) |
| `/ar` (no slash) | 301 | Firebase trailing-slash redirect → `/ar/` | — | — | — | acceptable |
| `/index.html` | 404 | no such physical file | — | — | — | acceptable (custom 404 page served) |
| `/holiday-packages` (no extension) | 404 | no clean-URL rewrite configured | — | — | — | note: only `.html` URLs are canonical |
| `/privacy-policy.html`, `/de/privacy-policy.html` | 200 | physical | self | no | `noindex, follow` | intended |
| `/404.html` | 200 (direct) / 404 (as error page) | Firebase custom 404 | none | no | `noindex, follow` | intended |
| `/vilu-unified.html` | 200 | physical, `Cache-Control: no-cache` | none | no | `noindex, nofollow` + robots Disallow | **P4 security residual** (see §12) |
| `/vilu-agency-portal.html` | 200 | physical | none | no | `noindex, nofollow` + robots Disallow | **P4 security residual** (see §12) |

No immediate functional risk was found. Do not change redirects/routing in Phase 12 without approval.

---

## 3. SEO contracts per English page (P0 — machine-checked)

For every page the harness checks: `<title>`, meta description, canonical, robots directive, hreflang set (`en zh ru de it fr ar ja ko sk cs x-default` = 12 tags; absent on `404.html`), exactly one `<h1>` with the baseline text, JSON-LD `@type` multiset, and FAQPage Q&A count. Exact strings are in the manifest `pages[]` section; summary:

| Page | Title | JSON-LD | FAQ |
|---|---|---|---|
| vilu-website.html | Vilu Residence — Guesthouse in Maamigili, South Ari Atoll | LodgingBusiness, Organization, BreadcrumbList (+ JS-injected Product/Offer at runtime — **manual**) | 15 homepage FAQs are JS-rendered (`#faq-list`), not FAQPage JSON-LD |
| holiday-packages.html | Maldives Holiday Packages — Whale Sharks & Manta Rays | BreadcrumbList, 9 × Product/Offer, FAQPage | 7 |
| maamigili-guide.html | Maamigili Travel Guide — The Island Vilu Residence Calls Home | TouristDestination, BreadcrumbList, Article, FAQPage | 42 |
| south-ari-atoll-guide.html | South Ari Atoll Travel Guide, Maldives — Whale Sharks, Manta Rays & Local Islands | TouristDestination, BreadcrumbList, FAQPage | 11 |
| whale-shark-snorkeling.html | Whale Shark Snorkeling in Maamigili, South Ari Atoll — What to Expect | Product ($85), BreadcrumbList, FAQPage | 12 |
| manta-ray-snorkeling.html | Manta Ray Snorkeling in Maamigili, South Ari Atoll — What to Expect | Product ($85), BreadcrumbList, FAQPage | 12 |
| things-to-do-maamigili.html | Things to Do in Maamigili — Excursions & Activities Guide | Article, BreadcrumbList, FAQPage | 8 |
| best-time-to-visit.html | Best Time to Visit the Maldives — A Season-by-Season Guide | Article, BreadcrumbList | — |
| guesthouse-vs-resort.html | Maldives Guesthouse vs Resort: Which Is Better? | Article, BreadcrumbList | — |
| maldives-holiday-cost.html | How Much Does a Maldives Holiday Cost? — 2026 Price Guide | Article, BreadcrumbList | — |
| best-local-islands-snorkeling.html | Best Local Islands in the Maldives for Snorkeling | Article, BreadcrumbList | — |
| south-ari-vs-other-regions.html | South Ari Atoll vs Other Maldives Regions | Article, BreadcrumbList | — |
| privacy-policy.html / cookies.html | Privacy Policy — Vilu Residence / Cookies & Technology — Vilu Residence | none; `noindex, follow` | — |
| 404.html | Page Not Found — Vilu Residence | none; `noindex, follow`; no canonical/hreflang | — |

Classification of SEO elements: **PRESERVE EXACTLY** title, description, canonical, robots, hreflang set, H1 text, JSON-LD blocks (types, names, prices, FAQ Q/A text, geo), descriptive `alt` text on hero/product images, cross-guide internal links, `og:*` on content pages. **PRESERVE SEMANTIC MEANING** H2/H3 wording and section identity (TOC anchors), body prose. **MAY BE IMPROVED ONLY AFTER APPROVAL** items listed in §17.

---

## 4. Content preservation (P2 — manual)

Sixteen content domains verified present and substantive at the baseline: Maamigili island (`maamigili-guide.html`, ~2,800 words, 18 sections), South Ari Atoll (~1,600 words), whale-shark excursion (incl. regulation 2024/R-96 distances, no-sighting fallback, $85 pp), manta-ray excursion ($85 pp), local-island snorkeling checklist, transport/transfers (split between maamigili-guide table, south-ari guide, and the **JS-rendered homepage "Getting Here" tab** — speedboat $55 pp, flight $155 pp, schedules; the most fragile content on the site because it depends on JS + Firestore `website_content`), FAQ content (15 homepage JS + 7 packages + 92 guide pairs), packages (§5), rooms (Double $85 / Deluxe Family $80 / Deluxe Family with Open Deck $90, "6 rooms"), contact (§8), trust perks (best rate, instant email confirmation, TGST 17% & Green Tax included, Google/TripAdvisor review links), booking terms (free cancellation on direct bookings, no deposit/card, cash USD/EUR on arrival, 24 h reply), seasonality, guesthouse-vs-resort and 2026 cost ranges, South Ari vs North Malé/Baa, legal pages (last updated 3 September 2026, operator "Mexiczone").

Crawler-visibility fact: on the homepage the package grid (`#hp-grid`), experiences grid (`#exp-grid`), Getting Here tab, FAQ tab and their Product JSON-LD are **JS-only**. `holiday-packages.html` is the canonical static, crawlable source of package data.

---

## 5. Locked nine-package commercial contract (P0 — machine-checked)

Source of truth in code: `PACKAGES` array in `holiday-packages.html` (prerendered identically into `#pkg-grid`), `PACKAGE_NAME_TO_ID` in `analytics.js`, and the 9 Product/Offer JSON-LD blocks. Locked fields: name, price, nights, approved badge, inclusions (round-trip speedboat transfer, accommodation line, daily breakfast), activity set, optional add-ons, order, canonical analytics ID, package-specific WhatsApp/email enquiry text, `/#booking` availability entry point per card, deep-link anchor `id="<analytics id>"`.

| # | Package | Price pp | Nights | Badge | Activities | Add-ons |
|---|---|---|---|---|---|---|
| 1 | Island Explorer Getaway `island-explorer-getaway` | $450 | 4 (Double Room) | — | Whale Shark, Manta, Turtle | HB $25/day, FB $40/day, Photography $25/hr |
| 2 | Reef & Sunset Adventure `reef-sunset-adventure` | $550 | 5 | — | Whale Shark, Manta, Sunset Cruise, Turtle | HB, FB, Private Island Picnic $51/person |
| 3 | Island Serenity Escape `island-serenity-escape` | $650 | 6 | — | Whale Shark, Manta, Turtle, Sunset Cruise, Private Island Picnic | HB, FB, Photography |
| 4 | Maldives Dream Bliss `maldives-dream-bliss` | $700 | 7 | Most Popular | Whale Shark, Manta, Turtle, Sandbank Trip, Dolphin Cruise | HB, FB, Photography |
| 5 | Ultimate Island Relaxation `ultimate-island-relaxation` | $790 | 8 | — | Whale Shark, Manta, Turtle, Sunset Cruise, Sandbank Trip, Private Island Picnic | HB, FB, Photography |
| 6 | Grand Maldives Escape `grand-maldives-escape` | $880 | 9 | — | Whale Shark, Manta, Turtle, Dolphin Cruise, Sunset Cruise, Sandbank Trip, Private Island Picnic | HB, FB, Photography |
| 7 | Ultimate Maldives Odyssey `ultimate-maldives-odyssey` | $940 | 10 | Best Value | Whale Shark, Manta, Turtle, Sandbank Trip, Private Island Picnic, Sunset Cruise, Dolphin Cruise | HB, FB, Photography |
| 8 | Ultimate Resort & Island Odyssey `ultimate-resort-island-odyssey` | $1300 | 11 | Most Complete | all of #7 + Night Fishing, Private Dinner at the Beach, Resort Day Visit | HB, FB, Photography |
| 9 | Honeymoon Dream Escape `honeymoon-dream-escape` | $1100 | 10 (Romantic Bed Décor) | Honeymoon Special | all of #7 + Night Fishing, Private Dinner at the Beach | HB, FB, Photography |

**Save-% presentation values (NOT locked commercial data — baseline awareness only):** currently rendered as "Save 2%" (#2), 4% (#3), 11% (#4), 12% (#5), 13% (#6), 16% (#7); none on #1, #8, #9. These are presentation-derived marketing copy. They must not be changed during Phase 12A-B; they are recorded in the manifest as `save_percent_presentation` so a change is noticed, but they are not part of the owner's immutable ladder.

Known accepted risk: the homepage package grid is fetched live from Firestore `packages` (`active == true`) while `holiday-packages.html` carries a static copy — two sources of truth to keep manually aligned (**manual**).

---

## 6. Booking / PMS dependency map (P0 — structural checks only)

The public website is **already connected to the Vilu PMS** through Firestore. Phase 12 is not authorisation to rebuild the booking engine.

- **Only `vilu-website.html` loads Firebase** (compat SDK 10.13.0: `firebase-app-compat.js`, `firebase-firestore-compat.js`). Packages page and all guides are static.
- **Firebase identity:** project `vilu-residence`, authDomain `vilu-residence.firebaseapp.com`, storageBucket `vilu-residence.appspot.com` (config block at `vilu-website.html` ~:2552; the public web API key is intentionally not asserted).
- **Firestore collections referenced by the public site (7):** `blocks` (read: manual room blocks for conflict check), `packages` (read: `active == true`), `reservations` (**write**), `room_availability` (read + **write**), `room_details` (read), `room_prices` (read), `website_content` (read: `website_content/<id>` documents feeding Getting Here / content). `rooms` is a PMS-side collection and is **not referenced** by the public website code at the baseline (only the `#rooms` section and i18n strings use that word) — the harness therefore asserts the seven above and records `rooms` as PMS-side.
- **Write boundary:** the public reservation flow writes **`reservations` and `room_availability` only**, inside `writeReservation()` via `runTransaction` with `{ merge: true }` and a `ROOM_CONFLICT` guard (room conflict protection, `hasBlockConflict()` for manual blocks). `submitDirectBooking()` builds the record: guest name/email/phone/country, `status: 'Pending'`, `source: 'Website'`, id `WEB<timestamp>`, rooms VR01–VR06.
- **Read/fallback behaviour:** `loadBookedRangesFromSupabase()` loads availability, has no stale-cache fallback, shows an availability warning banner on failure, and re-polls every 5 minutes. `BroadcastChannel('vilu_pms')` lets the PMS trigger a refresh.
- **Entry points:** homepage booking bar (`#bb-*` fields, `.bb-btn`), navigation "Check Availability" (`.js-check-availability` → `openBookingPopup()`, `availability_click` with `source_context: 'navigation'`), "Live Availability" (`.js-live-availability` → `openBookingPage()`), `#booking` section, `#bookingPopupOverlay` popup ("Book Your Stay"), `#booking-full-page` full-page interface (`bfpSearch()`, `confirmGuestBooking()`), package-card "Check live availability" links (`/#booking` ×9), and `initBookingHashHandoff()` in `nav-shell.js` (opens the popup on `/#booking` deep links).
- **Harness coverage (machine-checked):** SDK version and single-page loading; project identity; the 7 collections; write collections + `runTransaction`/`merge`/`ROOM_CONFLICT`; definitions of `hasBlockConflict`, `writeReservation`, `submitDirectBooking`, `loadBookedRangesFromSupabase`, `openBookingPopup`, `openBookingPage`, `bfpSearch`, `confirmGuestBooking`, `initBookingHashHandoff`; `BroadcastChannel('vilu_pms')`; entry-point ids/classes; nav-shell hooks; `source: 'Website'` / `status: 'Pending'`; every content page exposes both navigation entry points. **The harness never contacts Firestore and never creates a reservation.** Any future end-to-end write test needs an explicitly approved test strategy (never against real guest inventory).

**Phase 12B may** visually redesign booking cards, typography, fields, spacing, mobile layout, transitions, and integrate booking into the storytelling. **Phase 12B must not, without separate owner approval,** replace the Firestore architecture, rename collections, rewrite reservation transactions, replace `writeReservation()`/`submitDirectBooking()`, change PMS schemas, statuses, booking IDs, PMS/website synchronisation, or remove existing availability entry paths. Before 12B acceptance the preserved booking flow must be regression-tested against this baseline.

---

## 7. Conversion / contact paths (P0 identity, P1 presentation)

- WhatsApp `https://wa.me/9609903339` on every page (floating button + CTAs); email `Viluresidence@gmail.com` (mailto) and phone `+960 9903339` on every content and legal page. No other phone/email is advertised (machine-checked).
- Tracked conversions: nav availability (`availability_click`), homepage experience CTAs (`experience_enquire`), package WhatsApp/email (`package_enquire`), homepage contact links (`contact_click`), packages FAQ (`faq_expand`), related cards (`related_content_click`), reviews (`review_link_click`).
- **No `<form>` submits anywhere** — the contact form composes a `mailto:`.
- Untracked at baseline (P4, record only): guide floating WhatsApp buttons; guide closing-CTA WhatsApp and "Check Availability" links; `things-to-do-maamigili` CTA uses a generic `wa.me` link without topic text; two package deep links (`guesthouse-vs-resort.html` → `#ultimate-resort-island-odyssey`, `maldives-holiday-cost.html` → `#island-explorer-getaway`) bypass `setGuideHandoff`; homepage `#hp-grid` cards lack a per-card availability link and email.

---

## 8. Phase 11 analytics (P0)

- `analytics.js` — 10 canonical events: `language_change, contact_click, package_view, package_enquire, experience_enquire, availability_click, faq_expand, related_content_click, review_link_click, page_not_found`. Common params `site_language`, `page_type`, `page_slug` come from `<body data-page-type data-page-slug>` — **every page, including redesigned ones, must keep these two body attributes** (P0 code contract). `package_id`/`experience_id` via the locked `PACKAGE_NAME_TO_ID` table; `guide_slug` via sessionStorage `vilu_guide_handoff`; `source_context` per call site; `contact_method` on contact clicks. `trackEvent()` is gated by `window.viluConsent.isAnalyticsAllowed()`.
- **GA measurement identity:** `G-1EPZ71Q331` (defined once in `consent.js`; no other `G-` id anywhere — machine-checked). GA4 property `420109910`, property name `Vilu Residence — viluresidence.net`, single web stream `6467580476`, website URL `https://viluresidence.net` (**manual** — GA4 Admin).

### 8.1 Exact GA4 custom dimensions (11, event-scoped) — corrected

`package_id`, `experience_id`, `guide_slug`, `contact_method`, `source_context`, `first_touch_source`, `first_touch_medium`, `first_touch_campaign`, `landing_page_slug`, `landing_language`, `site_language`.

`page_type` and `page_slug` are **not** GA4 custom dimensions. They remain P0 analytics code/body contracts and must still be preserved.

### 8.2 Exact GA4 Key Event state — corrected

| Event | Key Event |
|---|---|
| `package_enquire` | **ON** |
| `experience_enquire` | **ON** |
| `availability_click` | OFF |
| `package_enquire_click` (legacy) | OFF |
| `experience_enquire_click` (legacy) | OFF |
| `close_convert_lead` (auto-suggested) | removed / unmarked |
| `qualify_lead` (auto-suggested) | removed / unmarked |
| `purchase` (GA4 default) | not part of the Vilu commercial event strategy; left untouched / unmarked |

No statement that "four key events" were registered is valid; the approved final state is the table above (**manual** — GA4 Admin).

### 8.3 Attribution (Phase 11D)

First-touch only, 30-day fixed timestamp, `vilu_attribution` v1 in localStorage, written only with analytics consent, deleted on reject/withdraw, `getAttribution()` read-only and consent-gated. Augments only `package_enquire`, `experience_enquire`, `availability_click` with `first_touch_source`, `first_touch_medium`, `first_touch_campaign` (optional), `landing_page_slug`, `landing_language`. Internal-referrer hard stop for `viluresidence.net`, `viluresidence.web.app`, `viluresidence.firebaseapp.com`, `vilu-residence.web.app`, `vilu-residence.firebaseapp.com`. **Landing-slug allow-list (12):** `home, holiday-packages, best-local-islands-snorkeling, best-time-to-visit, guesthouse-vs-resort, maamigili-guide, maldives-holiday-cost, manta-ray-snorkeling, south-ari-atoll-guide, south-ari-vs-other-regions, things-to-do-maamigili, whale-shark-snorkeling` — equal to the set of sitemap `data-page-slug` values (machine-checked). Permanent tests: `test/attribution-core.test.js` (82), `test/attribution-events.test.js` (21).

---

## 9. Consent (P0 behaviour, P1 presentation)

- `consent.js` — Basic Consent Mode; `gtag('consent','default', …)` all-denied before any GA load; GA (`www.googletagmanager.com/gtag/js`) injected **only** by `loadGA()` after Analytics consent; no page may carry a static googletagmanager script tag (machine-checked). Categories `essential, preferences, analytics, marketing`; marketing drives `ad_storage / ad_user_data / ad_personalization`. Public API `window.viluConsent` (`isAnalyticsAllowed()`, `hasDecision()`).
- **Consent DOM contract (required on every page; `footerPrivacyChoices` exempt on `404.html`):** `consentBar` (`role="region"`), `consentAccept`, `consentReject`, `consentCustomizeOpen`, `consentSave`, `consentPanelOverlay`, `consentPanel` (`role="dialog" aria-modal="true" aria-labelledby="consentPanelTitle"`), `consentPanelClose`, `consentPanelTitle`, `consentTogglePreferences`, `consentToggleAnalytics`, `consentToggleMarketing` (`<button role="switch" aria-checked>`), `footerPrivacyChoices`. Focus trap + Escape + focus return are P1 behaviours.
- **Storage record:** `vilu_consent` = `{version:1, timestamp, method, categories:{essential,preferences,analytics,marketing}}` (verified live).

---

## 10. Storage contracts

| Key | Store | Owner |
|---|---|---|
| `vilu_consent` | localStorage | consent.js |
| `vilu_attribution` | localStorage | analytics.js |
| `vilu_guide_handoff` | sessionStorage | analytics.js (consumed once) |
| `vilu_lang` | localStorage | homepage i18n engine |
| `hp_seen_cards` | localStorage | homepage package UI |
| `vilu_rooms`, `vilu_website` | localStorage | legacy PMS/website cache (`vilu_website` removed on load) |
| `vilu_pms` | BroadcastChannel | website ↔ PMS availability refresh |

---

## 11. Multilingual behaviour (P0 routing, P1 presentation)

- `build-i18n-pages.js` generates 10 languages × 14 pages = **140 files** (12 content + privacy + cookies; `404.html` is English-only). Sets `<html lang="xx" dir="rtl|ltr">` (`ar` = rtl), rewrites canonical to `/xx/…` and keeps the 12-tag hreflang set, keeps `data-page-type/slug` and the consent DOM, keeps legal pages `noindex` (all machine-checked).
- Homepage `?lang=` redirect, `detectInitialLang()`, `setLanguage()`, runtime i18n engine shipped inside each `/xx/index.html`; `data-i18n`, `data-i18n-alt`, `data-i18n-aria-label` attributes; language `<select aria-label="Language">` rendered by `shared-page-i18n.js`; `i18n/<lang>.json` for all 10 languages. 14 `[dir="rtl"]` rules in `shared-page.css` and 36 in the homepage inline CSS (consent-toggle knob flips under RTL).
- Known gap (P4): `og:*` tags are not localized on generated pages.

---

## 12. Internal PMS / Agency routes — security residual (P4, separate project)

`vilu-unified.html` (PMS) and `vilu-agency-portal.html` are physical files served by Hosting (HTTP 200) and rely on `<meta name="robots" content="noindex, nofollow">` plus `robots.txt` `Disallow`. **robots.txt and noindex are search-engine directives, not authentication or access-control mechanisms.** These interfaces must not be described as secured merely because indexing is discouraged. Classification: **P4 — pre-existing PMS/Agency security residual / separate future security project.** Phase 12 must not expose additional public links to them (machine-checked: no public page links to either file), not worsen their discoverability, not modify their authentication/security architecture, and not fold PMS security remediation into the cinematic redesign.

### 12.1 Public Vilu principle (Phase 12B-D1)

**Maximum public discoverability for traveler-facing content. Minimum unnecessary public exposure of internal technical architecture.**

Publicly expose: destinations, guides, holiday packages, Vilu Residence, availability, contact, traveler information, brand information. Do not unnecessarily advertise in public markup: PMS or internal-system naming, the Agency Portal, admin systems, development tooling, build architecture, testing infrastructure, or private Firestore/business implementation details. The former footer line "Managed by Vilu PMS" was removed under this principle (12B-D1); the harness now asserts that the public shell (header, drawer, footer) of every source and generated page contains no such phrases and no internal-tool links. This governs *public display only*: the functional PMS contracts in §6 (including the internal `BroadcastChannel('vilu_pms')` identifier) remain fully protected and unchanged. The full fingerprint/security-hardening project stays a separate later phase.

---

## 13. Navigation / footer IA (P1 function; P0 destinations)

Header (every content page, markup per page, behaviour in `nav-shell.js`): logo → `/` (homepage: `#home`); **Holiday Packages**; **Experiences** ▾ Whale Shark / Manta Ray / Things to Do; **South Ari** ▾ Maamigili Guide / South Ari Atoll Guide / Best Local Islands / South Ari vs Other Regions; **Stay** ▾ Vilu Residence `/#about` / Rooms `/#rooms` / Live Availability `/#booking` (`js-live-availability`) / Gallery `/#gallery`; **Plan Your Trip** ▾ Best Time / Holiday Cost / Guesthouse vs Resort / Travel Info `/#travel-info` / Contact `/#contact`; language select; primary CTA **Plan Your Holiday** → `holiday-packages.html` (`btn-plan-holiday`); secondary **Check Availability** → `/#booking` (`js-check-availability`). Hamburger `#hamburger` (`aria-controls="mobileMenu"`) → `#mobileMenu` dialog with accordion groups, both CTAs, language select, contact block; full focus trap, Escape, focus return, body scroll lock. Desktop dropdowns open on hover/click/focus, close on Escape/outside click.

Footer: brand + phone/email + Instagram/Facebook/TripAdvisor; columns Explore / Stay (homepage shows 3 room links with live prices) / South Ari Guides / Plan (incl. `/privacy-policy.html`, `/cookies.html`); bottom bar "© 2026 Vilu Residence Maamigili", "Managed by Vilu PMS", **Privacy Choices** (`footerPrivacyChoices`). Floating WhatsApp button on every page. `PAGE_GROUP` active-group mapping in `nav-shell.js`.

---

## 14. Accessibility (P1 behaviour; weaknesses P4)

**Must preserve:** mobile-drawer focus trap / Escape / focus return; identical consent-panel trap; `role="switch"` toggles; global `prefers-reduced-motion` CSS override plus the two JS `matchMedia` guards on hero/gallery parallax; single-H1 structure; 100 % non-empty `alt` on static `<img>` (11/11 homepage, 20/20 packages); RTL mirroring; hamburger `aria-label/aria-expanded/aria-controls` with i18n'd labels; `aria-label="Language"` on the select; `:focus-visible` outlines in `shared-page.css`. Weaknesses are listed in §17 (manual).

---

## 15. Performance (P1 — must not regress)

- **Zero external Google Fonts** (machine-checked across all shipped HTML/CSS/JS incl. 140 generated pages). Self-hosted Cormorant Garamond + DM Sans woff2 under `/fonts/webfonts/`, all `font-display: swap`; Tabler icon subset (11.5 KB, 34 glyphs) — the full Tabler set is PMS-only.
- Homepage ≈ 299 KB on disk / ≈ 59 KB brotli; ≈ 2,850 inline JS lines; `consent.js` + `analytics.js` synchronous in `<head>`; Firebase SDK synchronous near `</body>`; no `defer/async`; hero `whale_shark_hd.jpg` ≈ 111 KB with `fetchpriority="high"` but **no LCP preload on the homepage** (packages/guides do preload their hero); IntersectionObserver lazy backgrounds (`rootMargin 300px`) with WebP probe; `package_view` observer at 0.5; Maps iframe `loading="lazy"`. `images/` ≈ 11 MB / 104 files. CDN `Cache-Control: max-age=3600`, brotli, HSTS, no hashed filenames. Third-party hosts: gstatic.com (Firebase), firebasestorage.googleapis.com, google.com (Maps), wa.me, share.google, socials; googletagmanager only post-consent.
- Baseline metrics are **manual** (Lighthouse not run at baseline); Phase 12B must measure before/after LCP/CLS/TBT on homepage, packages and one guide.

---

## 16. Hero video master (document only)

Original master available to Claude at `C:\Users\hp\Downloads\dji_fly_20240503_104338_0027_1715070270010_video.mp4`: ≈ 309 MB, ≈ 35 s, stored frame 3840×2160 with **270° rotation metadata (displayed orientation portrait)**, ≈ 29.97 fps, high-bitrate (~69.5 Mbps) master. Not transcoded, not modified, not committed. Phase 12B will derive: desktop ≈ 16:9 optimized horizontal cinematic render, mobile 9:16 optimized vertical render, optimized poster fallback — **never stretch the portrait source horizontally**. Implementation must consider `object-fit: cover`, muted autoplay, loop, `playsinline`, reduced-motion fallback, poster, bandwidth, LCP and mobile performance.

---

## 17. Current known issues (P4 — do not fix during Phase 12A-B)

1. **Homepage mobile horizontal overflow:** at 390 px (and 375 px) device width the homepage layout viewport widens to ≈ 469 px (404 elements overflow, led by the JS-rendered `#hp-grid` package cards, e.g. `#package-reef-sunset-adventure.hp-card` right edge 595 px). Result: the page renders zoomed-out on phones and the hamburger sits off-frame in captures. `holiday-packages.html` has zero overflow at the same width. Confirmed with two independent tools (headless Chrome CDP; browser pane emulation). Mobile usability is P1 for 12B — this must be fixed or not regressed there, with approval.
2. Homepage `#faq-list` (dynamic FAQ) has no `faq_expand` instrumentation; reconsider in 12B if the FAQ survives.
3. Accessibility: booking-bar/widget/full-page inputs have no accessible name (`<div>` captions); 0 `<label for>` site-wide; `outline:none` without replacement on `.bb-input .bwf-select .bfp-field .tc-input .faq-search`; `role="menu"` dropdowns without arrow-key navigation or `aria-controls`; packages page H2→H4 heading skip; no `width/height` on any `<img>`; text-over-image contrast unmeasured.
4. SEO/content: package names rendered as `<div class="pkg-name">` not headings; `og:*` not localized on generated pages; `og:site_name/og:locale` only on maamigili-guide; static booking-bar `<select>` room names ("Garden Room / Garden Deluxe / Premium Room") contradict the room-card names/prices; privacy policy address says "Alifu Dhaalu Atoll" vs "South Ari Atoll" elsewhere; homepage guide-card title "Best Time to See Whale Sharks in South Ari Atoll" has no matching page; physical-file aliases (`/vilu-website.html`, `/xx/index.html`) reachable (§2.1).
5. Performance: no homepage LCP preload; synchronous `consent.js`/`analytics.js` in `<head>`; no long-lived cache/hashed assets.
6. Untracked conversion links listed in §7.
7. PMS/Agency security residual (§12).
8. Static `PACKAGES` array vs Firestore `packages` drift risk (§5).
9. Stale comment in `build-i18n-pages.js` (~:116-121) claiming legal pages have no per-language copies.

---

## 18. Baseline fingerprints vs semantic contract

`consent.js` sha256 `a3b69fa5c9de7fdb3dfb237fa7aa991d33c35854adc99a6a3db5154ebbaea2f2`; `analytics.js` sha256 `a1394100231b7746523b03c3df31d48927dd5d80a9d85d4818e22cababe7eff1`. These are **baseline fingerprints, not a permanent hash lock**: Phase 12B should normally leave both files unchanged, but an explicitly approved change is acceptable provided the owner approves, the semantic preservation tests (this harness + attribution tests) remain green, consent/analytics behaviour is re-verified, and the manifest fingerprint is updated in the same commit.

---

## 19. Visual baseline (reference only)

`docs/baselines/phase12/` holds ten compressed JPEG references captured from production at the baseline (headless Chrome, 1366×900 desktop / 390×844@2x mobile, ≈ 0.8 MB total): homepage desktop, homepage mobile, packages desktop, Maamigili guide desktop, Arabic RTL homepage, desktop navigation dropdown open, mobile menu open, consent customization panel, booking popup, packages mobile. Phase 12 intentionally changes the visual design; these images document *what existed*, not what must be kept. Limitation: mobile captures of the homepage reflect known issue §17.1 (zoomed-out layout).

---

## 20. How to run the harness

```bash
node test/phase12-preservation.test.js
node test/attribution-core.test.js
node test/attribution-events.test.js
node test/sitemap-lastmod.test.js
node build-i18n-pages.js
git diff --check
```

The preservation harness reads only local files, uses no dependencies, never contacts the network or Firestore, and never creates a reservation. Machine-checkable: everything in the manifest. Manual: GA4 Admin state (§8.1–8.2), Firestore write-path behaviour, content completeness (§4), accessibility behaviour, performance metrics, visual fidelity, video rendering.
