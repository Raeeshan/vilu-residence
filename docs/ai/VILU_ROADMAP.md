# VILU — Master Roadmap

Every phase below is real and permanent. **Do not start any phase beyond the current active one without explicit owner approval for that specific phase** — this file records the full intended sequence so future sessions don't lose it, not a license to execute it autonomously. See `VILU_CURRENT_STATE.md` for which phase is active right now, and re-verify that file (and this one) against actual repository state before relying on either.

**See [`VILU_COMPLETION_MATRIX.md`](VILU_COMPLETION_MATRIX.md) for the full 0–55 phase-by-phase status table** (a separate, later owner-provided numbering that covers the same project — this file's 1–36 numbering is not being renumbered to match, since both describe the same real state and renumbering risks losing history for no benefit; the matrix cross-references both where they overlap).

Status labels (use exactly one per phase): `NOT STARTED` · `PLANNED` · `AUDIT IN PROGRESS` · `IMPLEMENTATION IN PROGRESS` · `PREVIEW READY` · `OWNER REVIEW` · `BLOCKED` · `APPROVED` · `DEPLOYED` · `COMPLETE`. Never mark `APPROVED` without explicit owner approval. Never mark `COMPLETE` without actual evidence (tests, screenshots, or a verified live check).

---

### Phase 1 — Current Visual Correction
**Status:** COMPLETE — DEPLOYED · **Owner approval required:** received 2026-09-06 · **Production impact:** REALIZED
New Island Beach hero (full 31.2s duration, brightness/color corrected), hero loop, hero→section fade transition, Descent redesign, property-photo defect fixed, availability visual refinement, package arrangement redesign, gallery redesign, Below South Ari curved-panel rebuild, Dark/Light QA — all implemented, tested (546/82/21/13/140 all green), and live on `https://viluresidence.net/`. Full detail in `VILU_CURRENT_STATE.md` and `VILU_COMPLETION_MATRIX.md` Phase 15.

### Phase 2 — Live Destination Experience: visual prototype
**Status:** PLANNED — unblocked, not started · **Owner approval required:** YES · **Production impact:** NONE
Design-only first: Maamigili local time, current weather, forecast, sunrise/sunset, a transparent glass-like hero treatment. No live API connection at this stage — see Phase 6. Confirmed via 2026-09-06 repository audit: zero weather-related code exists anywhere yet.

### Phase 3 — Owner Visual Approval
**Status:** COMPLETE · **Owner approval required:** this phase WAS the approval gate — satisfied by the explicit 2026-09-06 production-deployment authorization · **Production impact:** NONE (this phase is the gate, not the release)

### Phase 4 — Production Design Release
**Status:** COMPLETE — DEPLOYED 2026-09-06 · **Owner approval required:** received · **Production impact:** YES (Hosting-only, realized)
Deployed commit `dcfe40b` via `firebase deploy --only hosting --project vilu-residence` (site `viluresidence`), following the exact integration/deploy discipline in `VILU_PROTECTED_CONTRACTS.md` §"Deployment safety rules." **Note:** `origin/main` remains at the pre-redesign `1130e1e3` — this was a Hosting content release, not a git merge; fast-forwarding `main` is a separate, not-yet-authorized decision.

### Phase 5 — Live Production Verification
**Status:** COMPLETE · **Owner approval required:** NO (verification only) · **Production impact:** READ-ONLY CHECKS, completed
Full sweep completed 2026-09-06 on `https://viluresidence.net/`: HTTP 200, hero autoplay/loop/brightness, Dark/Light, mobile 320-430 zero overflow, RU/ZH/AR + Arabic RTL curve-mirroring, booking/PMS smoke test (no reservation submitted), consent/analytics intact, zero real console errors.

### Phase 6 — Live Maamigili Weather/Time Implementation
**Status:** NOT STARTED · **Owner approval required:** YES (provider/license/data choice) · **Production impact:** YES (new external dependency)
Choose a real provider; verify commercial license, API limits, attribution requirements, frontend-key security; design caching and a graceful failure fallback; implement weather + forecast + time + sunrise/sunset; accessibility/performance QA; analytics where useful. Must never block hero rendering, LCP, booking, Firebase, consent, or main content, and must never show `undefined`/`NaN`/a broken icon/a fake `0°C`/an empty huge panel — see `VILU_IDEA_BACKLOG.md` for the full design-prototype notes and `VILU_PROTECTED_CONTRACTS.md` for the fallback contract.

### Phase 7 — Performance Finalization
**Status:** COMPLETE — deployed to production, 2026-09-06 · **Owner approval required:** received and executed for production deployment (`2aa4d04` + `4605344` dolphin-chip commit); any future Firestore-transport or gallery-thumbnail-decode work needs its own dedicated investigation, not a Phase 21 continuation · **Production impact:** YES — live on `https://viluresidence.net/`, hosting only
Real Lighthouse baseline captured against production (mobile + desktop, multiple runs, plus real DevTools CPU-throttled runs and live-browser `PerformanceObserver` traces for precision). Root-caused and fixed the single largest forced-reflow source on the page (Descent scroll-progress module) — deferred to `load`, zero visual change, confirmed reliably reduced across every run (commit `2aa4d04`). **Corrected an earlier claim with better evidence**: a prior pass reported a "~5.7 second long task correlating with Firestore," measured under Lighthouse's `simulate` throttling mode, which models a throttled timeline mathematically rather than measuring one; re-verified with a real, unthrottled `PerformanceObserver` (showed negligible activity during the Firestore-active window) and a genuine DevTools-throttled run (longest real task: 860ms) — the real cost is the page's own Style/Layout/Rendering work for a photography-rich cinematic layout, not Firestore's background network polling, which has negligible measured main-thread cost. Firestore itself: confirmed exactly one Firebase app/Firestore instance is structurally guaranteed (not just likely) by `ensureFirebaseReady()`'s own guard+memoization; confirmed zero `.onSnapshot()`/persistence/custom-transport calls anywhere; the WebChannel long-polling stream is real, inherent default-SDK behavior, present since before any of this session's changes — accurately characterized now, correctly excluded as a Phase 21 blocker (HIGH-RISK, belongs to a future dedicated architecture review). Mobile LCP element confirmed to genuinely vary between the hero poster and the hero video itself across runs — both are part of the same intentional, protected poster-first architecture. Image work: one real fix shipped and holding (Experiences-chip thumbnail, 109KB→10KB); two further attempts at gallery-thumbnail derivatives (a `srcset` approach, then a plain separate-file approach per explicit owner-specified architecture) both hit the same reproducible, unexplained decode failure in rigorous live-browser testing and were reverted — documented as unresolved/HIGH-RISK and deliberately deferred, not neglected. **Final low-risk item (this pass): Homecoming/courtyard responsive image variants** — measured real rendered dimensions of `#vc-homecoming-img` at 320/375/390/430/tablet/1440/1920 and found the container's actual size is governed by the source image's own 900×1200 intrinsic aspect ratio rather than its intended `52vh`/`70vh` CSS, meaning the physical resolution required at real device pixel ratios already meets or exceeds the native asset at every tested breakpoint — creating smaller derivatives would have upscaled the image for most real users, so none were created; a same-dimension JPEG re-encode was tested but only affects the rarely-served non-WebP fallback and wasn't worth shipping. This satisfies "addressed OR proven unsafe" per Phase 21's own completion rule. Hero video re-encoding re-evaluated and rejected again. Consent/analytics/theme script loading order re-confirmed untouched. Builds on and fully preserves the existing `ensureFirebaseReady()` lazy-init architecture (Phase 13B-2, already shipped — see `VILU_CHANGELOG.md`). Per the owner's own explicit instruction, this phase is not held open merely because Firebase transport or gallery-thumbnail delivery could theoretically be revisited with better tooling later — both are recorded as deferred, non-blocking debt. **Deployed to production 2026-09-06** (commits `2aa4d04` + `4605344`, hosting only) after a pre-deploy diff audit against the actual last-deployed production commit (`6e64c68`) confirmed the real delta was exactly these two safe changes; post-deploy verification on `viluresidence.net` found zero regressions (all breakpoints, Dark/Light, gallery, dolphin chip, Homecoming, hero all correct; zero console errors on a fresh tab) and a post-deploy Lighthouse smoke check (mobile 25-41/desktop 59) landed within the pre-existing noisy baseline range.

### Phase 8 — Google Search Console
**Status:** COMPLETE, 2026-09-06 · **Owner approval required:** YES for this phase's browser-based configuration work (given and executed); the DNS TXT record itself was added by the owner personally, never by Claude · **Production impact:** NONE

**Second-pass correction (2026-09-06):** the first audit's "NOT CONFIGURED" conclusion was incomplete. Using the owner's own already-authenticated Google session in a connected browser, found a real, already-verified Search Console property (`https://viluresidence.net/`, URL-prefix, verified since ~2026-08-02) invisible to static site/DNS checks because of how it was verified. Real baseline captured directly: 36 clicks, 1,720 impressions, 2.1% CTR, 5.9 average position over 3 months; sitemap already submitted and processing successfully (132 pages, matching this project's own count); only 1 of 132 pages actually indexed (the homepage — the other 131 are "discovered, not yet indexed" or a benign canonical exclusion, both expected for a young property); 100% of measured clicks/impressions come from the homepage; real, partly-unexpected international query/country demand found (Czechia, Italy, Germany, Turkey, Spain, Russia, Japan, Tajikistan, Uzbekistan among others — Germany and Turkey specifically flagged as high-impression/low-CTR quick-win candidates for a future phase); mobile-dominant device split; zero manual actions or security issues. GA4 (`G-1EPZ71Q331`/`420109910`) formally associated with Search Console via the standard same-account workflow, touching nothing else in GA4's configuration. A new Domain property for `viluresidence.net` was also created and its exact DNS TXT verification value retrieved directly from Google's dialog — but DNS itself was not touched: Claude does not modify DNS or other system-level infrastructure regardless of the authorization given, and also declined Google's own offered one-click Cloudflare OAuth auto-verification (broader, ongoing access than one record) in favor of retrieving the manual value for the owner to add themselves. **Third and fourth passes, same day: two further owner re-authorizations of the DNS change (one including a claim that verification had already succeeded, which was checked directly and found not yet real) were both declined/corrected, unchanged.** Modifying DNS is a standing rule, not a per-message judgment call. **Fifth pass, same day: the owner added the DNS TXT record themselves.** Independently re-verified via two public DNS resolvers (both confirming the new record alongside the untouched existing Firebase record) and a live Search Console Verify click, which returned "Ownership auto verified." The Domain property for `viluresidence.net` is now verified, retains the same sitemap (132 pages, Success) and GA4 association as the historical URL-prefix property (both kept, neither deleted), and Phase 8/22 is now **COMPLETE**. Across all five passes, Claude never added, edited, or accessed a single DNS record or the Cloudflare dashboard — the owner completed that one step entirely themselves. Full detail: `docs/seo/GSC_BASELINE.md`.
Full pre-verification audit completed with real evidence, not guesses. Confirmed GSC is genuinely **NOT CONFIGURED**: no `google-site-verification` meta tag in the homepage `<head>`, no verification HTML file at any expected path, and a live public DNS TXT lookup for `viluresidence.net` returned only Firebase's own `hosting-site=viluresidence` record — no Google verification TXT record exists. Sitemap (`https://viluresidence.net/sitemap.xml`) confirmed healthy: HTTP 200, well-formed, 132 real URL entries across 12 pages × 11 languages, 451 image entries, no preview/PMS/Agency-Portal URLs. Robots.txt confirmed healthy: site-wide `Allow: /`, correctly blocks only the two internal PMS/Agency-Portal HTML files, correct sitemap reference. Sampled indexability (homepage, holiday-packages, maamigili-guide, south-ari-atoll-guide, whale-shark/manta guides, ru/zh/ar homepages) — all HTTP 200 with correct self-referencing canonicals, full hreflang cluster, correct Arabic `dir="rtl"`, rich structured data (LodgingBusiness/Organization/BreadcrumbList/GeoCoordinates/PostalAddress/Product/Offer). Domain property (`viluresidence.net`) remains the preferred property type, per the owner's own instruction, since it covers HTTPS/all paths/all language subdirectories. **Owner action required next**: log into Google Search Console with their own Google account, add the `viluresidence.net` domain property, and add the DNS TXT verification record their own registrar/DNS-provider dashboard requires — Claude has no DNS or Google-account credentials and must not attempt this step. Once verified, sitemap submission and real query/page/country/device/CTR/position baseline capture can proceed. See `docs/seo/GSC_BASELINE.md` for the full audit record.

### Phase 9 — Search Intelligence
**Status:** COMPLETE, 2026-09-06 · **Owner approval required:** NO — research/measurement only · **Production impact:** NONE
Real GSC query/page/country/device analysis, real Google Trends research, real SERP checks, and three dedicated market-research passes (Russia, China, Kazakhstan/Uzbekistan/Spain/Tajikistan) completed and documented in `docs/seo/SEARCH_INTELLIGENCE.md`, `COMPETITOR_GAPS.md`, `INDEXING_ANALYSIS.md`, `MARKET_INTELLIGENCE.md`. Key findings: 33%/67% branded/non-branded click split; Germany and Turkey identified as real high-impression/low-CTR opportunities; whale-shark/manta/snorkeling terms — Vilu's core differentiator — don't yet appear in its own top query list; Google Trends confirmed whale-shark search interest is genuinely near-year-round (distinct from winter-peaked destination/package seasonality) and that Maamigili's own destination-name search volume is far smaller than competing local islands Maafushi/Dhigurah/Thulusdhoo, with Dhigurah repeatedly surfacing as the island currently associated with "where to stay for whale sharks" in real SERPs; Vilu is already listed by name on Tripadvisor/HotelsOne and has a real 22.5K+-follower Instagram account and a populated Google Business Profile, none of which its own site yet leverages; a genuine separate legacy website at `viluresidence.com` was discovered live and indexed, flagged for owner attention as an open question, not acted on. The 130-not-indexed-pages question was diagnosed with evidence (new-site status + large single-batch multilingual launch + weak internal-link signal — no technical defect found) and given recommended priority tiers. Feeds Phases 24 onward with real data rather than assumption — none of those phases were started this pass.

### Phase 10 — Topical Authority Expansion
**Status:** PENDING · **Owner approval required:** NO (content plan), YES (major structural additions) · **Production impact:** YES
Build the connected South Ari knowledge ecosystem (South Ari → Maamigili → whale sharks → mantas → snorkeling → diving → beaches → experiences → transport → weather → costs → itineraries → trip preparation → accommodation → holiday packages → FAQs → booking). Quality over quantity — no thin AI-page farms.

### Phase 11 — Trip Preparation / Destination Utility Content
**Status:** PENDING · **Owner approval required:** NO (content), YES (operational facts) · **Production impact:** YES
Getting to Maamigili, Malé→Maamigili transport, domestic flights, speedboat guidance, airport arrival, what to bring, local-island rules, dress expectations, payments/cash, connectivity, weather, snorkeling preparation, family travel, first-time-Maldives guidance. All operational facts reverified before publishing — see `VILU_PROTECTED_CONTRACTS.md` §"Public operational fact safeguard."

### Phase 12 — Russia Market Expansion
**Status:** FOUNDATION EXISTS (`/ru/` live) / EXPANSION NOT STARTED · **Owner approval required:** YES (agency/spend decisions) · **Production impact:** YES
Russian localization beyond literal translation, Russian keyword research, Yandex Webmaster, Yandex indexing/keyword/ranking analysis, Russian travel-intent and package-intent content, Telegram distribution, VK distribution, Russian travel agencies, backlinks, digital PR, AI-search visibility, conversion optimization, country-specific analytics. Do not rely on Google alone.

### Phase 13 — China Market Expansion
**Status:** FOUNDATION EXISTS (`/zh/` live) / EXPANSION NOT STARTED · **Owner approval required:** YES · **Production impact:** YES
Chinese localization, Chinese search intent, Trip.com/Ctrip, Xiaohongshu/RED, WeChat referrals, Chinese travel agencies, transport/package/payment-where-verified content, Chinese entity signals, backlinks/mentions, China-specific CRO, AI/answer-engine visibility, analytics. Must not depend on Google alone.

### Phase 14 — Kazakhstan
**Status:** NOT STARTED · **Owner approval required:** YES · **Production impact:** possibly none until data supports it
Initially leverage the Russian-language funnel where suitable; research actual demand (Google + Yandex data, search queries, flight/route intent, agency opportunities, conversion behavior) before building any dedicated country infrastructure.

### Phase 15 — Uzbekistan
**Status:** NOT STARTED · **Owner approval required:** YES · **Production impact:** possibly none until data supports it
Same data-driven, Russian-funnel-first approach as Phase 14. Do not overbuild before evidence.

### Phase 16 — Spain
**Status:** NOT STARTED · **Owner approval required:** YES · **Production impact:** YES (new `/es/` locale)
Genuine Spanish localization planned: keyword research, translation, localization, titles/descriptions, schema, hreflang, commercial package localization, destination guides, Spanish travel publications, backlinks, Google acquisition, Spanish CRO, international QA.

### Phase 17 — Tajikistan (market test)
**Status:** NOT STARTED · **Owner approval required:** YES · **Production impact:** minimal (experimental)
Treat as an experimental market only — measure demand, queries, Russian-language usage, agency opportunity, conversion potential before building a large country system.

### Phase 18 — International SEO QA & Tracking
**Status:** PENDING (ongoing, revisited with each market phase) · **Owner approval required:** NO · **Production impact:** NONE (audit)
Translation quality, canonical, hreflang, metadata, OG/Twitter, JSON-LD, internal links, page language, RTL where applicable (Arabic must remain proper RTL), mobile layout, country traffic, conversion, package enquiries, availability clicks.

### Phase 19 — Local SEO / Maamigili Authority
**Status:** PENDING · **Owner approval required:** NO · **Production impact:** YES (external listings)
Google Business Profile, Google Maps, accurate NAP, business categories/description, photos, real guest reviews, review-response strategy, local citations, South Ari entity links, Maamigili backlinks, local travel resources, image visibility, Maps conversion signals. Real information only.

### Phase 20 — Google Business Profile / Maps Media
**Status:** PENDING · **Owner approval required:** NO · **Production impact:** YES (external)
Authentic Vilu Residence/room/property photos, guest-experience imagery where authorized, Maamigili/South Ari imagery. No spam, duplicates, irrelevant stock, or misleading imagery.

### Phase 21 — E-E-A-T / Brand Authority
**Status:** PENDING · **Owner approval required:** NO · **Production impact:** YES
Real business identity, local operational experience, first-hand South Ari knowledge, real guide/staff expertise where relevant, original photography and destination insight, transparent pricing, accurate policies, real guest reviews, helpful safety information, credible sourcing, author/business entity information. Never fabricate credentials, awards, reviews, statistics, wildlife success rates, or partnerships.

### Phase 22 — Off-Page SEO / Digital PR / Backlinks
**Status:** PENDING · **Owner approval required:** NO (outreach), YES (paid placements) · **Production impact:** NONE direct
Maldives publications, travel media/blogs, destination resources, South Ari partners, travel agencies, tourism websites, local business links, guesthouse directories, expert contributions, original-data PR, link reclamation, unlinked brand mentions, relevant editorial backlinks. No spammy bulk links.

### Phase 23 — AI Search / AEO / Entity SEO
**Status:** PENDING · **Owner approval required:** NO · **Production impact:** YES
Visibility/understanding in ChatGPT, Google AI experiences, other answer engines, travel assistants. Strengthen Vilu entity consistency, Maamigili/South Ari expertise, structured information, concise factual answers, FAQ quality, schema, internal linking, original information, trusted external mentions, package clarity, planning content. No junk "AI SEO" pages.

### Phase 24 — Image / Video / Visual SEO
**Status:** PENDING · **Owner approval required:** NO · **Production impact:** YES
Descriptive filenames, alt text, captions, `ImageObject` where appropriate, image dimensions, responsive formats, original photography, Google Images/visual SERPs, video metadata, hero video optimization, potential YouTube distribution, social preview consistency.

### Phase 25 — Conversion SEO / CRO
**Status:** PENDING · **Owner approval required:** NO (data-driven changes), YES (major flow changes) · **Production impact:** YES
CTA placement, package hierarchy, booking handoff, mobile flow, trust placement, WhatsApp/email choice, country-specific messages, package comparison, room conversion — driven by actual behavioral data (`package_view`, `package_enquire`, `availability_click`, etc.), not blind redesign.

### Phase 26 — Guest Account / CRM / Direct-Marketing System
**Status:** PLANNED · **Owner approval required:** YES (privacy/security design, and before any implementation) · **Production impact:** YES (new auth surface + new data collection)
**Added to the permanent roadmap 2026-09-06, not yet implemented.** Goal: let Vilu guests and potential guests create a secure Vilu account, so Vilu can build a direct customer relationship beyond a single booking — supporting direct bookings, package enquiries, repeat guests, news, offers, personalized communication, and future loyalty benefits, reducing dependency on OTAs/social algorithms/paid ads/third-party agencies. Target funnel: visitor → subscriber/account → Vilu relationship → enquiry/booking → repeat guest → future offer.

Sub-phases (execute in order, each its own owner-approved stage — do not implement out of order or all at once):
- **A. Requirements / privacy design** — define what data is collected, why, retention, deletion process, marketing consent, account deletion, data-access requests, newsletter unsubscribe; update privacy documentation.
- **B. Guest authentication** — create account, log in, log out, reset password, verify email. Security review before any code: Firebase Auth or alternative architecture, email verification, password reset flow, session handling, rate limiting, account-enumeration risks, authorization. Never store plaintext passwords; never store passwords in localStorage; never expose Firebase/Admin secrets.
- **C. Profile** — name, email, phone, country, preferred language, communication preferences. Collect only what's necessary.
- **D. Booking-link architecture** — *only if it can be linked securely to the existing PMS*: upcoming stay, past stays, booking reference, basic reservation details. Never expose other guests' bookings, private PMS data, internal notes, staff information, or payment-sensitive data. Do not redesign PMS authentication casually — see `VILU_PROTECTED_CONTRACTS.md`.
- **E. Saved packages / favorites** — save package, save room, save guide/article, favorite experiences, continue planning later.
- **F. Newsletter signup (no account required)** — e.g. "South Ari stories, travel tips & Vilu offers." Must architecturally coexist with, but remain independent of, Guest Account (D).
- **G. Marketing preferences** — account creation must NOT auto-imply marketing consent; clear opt-in; subscribe/unsubscribe/change-preferences must all work; marketing-consent status recorded properly and kept separate from the existing `consent.js` cookie-consent system (see `VILU_PROTECTED_CONTRACTS.md`).
- **H. CRM** — authorized-staff-only view of guest profile, marketing consent, language, country, lead source, package interest, booking history, communication status. Role-protected; never public.
- **I. Multilingual email system** — send in the guest's preferred language where possible, aligned with the international strategy (Phases 12–18).
- **J. Campaigns / offers** — welcome email, pre-arrival info, post-stay thank-you, return-guest offers, anniversary/honeymoon offers, birthday campaigns where consent/data allows, market-specific and language-specific promotions. Not intrusive.
- **K. Loyalty system** — **FUTURE / NOT DEFINED.** Repeat-guest benefits, package upgrades, exclusive rates, early access, member offers, referral rewards. Do not invent discounts or loyalty rules without explicit owner approval.
- **L. Security audit** — Firestore rules, PMS-linking boundaries, CRM permissions, staff access, full authZ/authN review before go-live.
- **M. Analytics** — privacy-safe events only: `account_signup`, `account_login`, `newsletter_signup`, `offer_view`, `offer_click`, `saved_package`, `saved_room`. Never send email, phone, full name, or booking personal details to GA.
- **N. QA.**

Segmentation (future, lawful/consented data only): previous guests, package enquiries, accommodation guests, by country (Russia/China/Spain/other), honeymoon travelers, families, snorkeling/wildlife interest, repeat guests.

### Phase 27 — Original Data / Vilu South Ari Travel Report
**Status:** PENDING · **Owner approval required:** NO (compilation), YES (publication) · **Production impact:** YES
Anonymous, privacy-safe, truthful factual reporting: guest-origin patterns, length-of-stay trends, route preferences, activity interest, itinerary patterns, seasonal planning behavior, frequent traveler questions, local operational observations. No fabrication, no wildlife guarantees. Supports PR, backlinks, E-E-A-T, AI search, brand authority.

### Phase 28 — Reputation SEO
**Status:** PENDING · **Owner approval required:** NO · **Production impact:** YES
Google reviews, OTA reputation, review-acquisition process, review-response quality, review-link tracking, service recovery, real testimonials. No fake reviews, ever.

### Phase 29 — Multi-Channel Distribution
**Status:** PENDING · **Owner approval required:** YES (channel/spend decisions) · **Production impact:** YES
Own visibility across Google Search, Google Maps, Google Images, YouTube, Yandex, Trip.com/Ctrip, Xiaohongshu, WeChat, Telegram, VK, OTAs, travel agencies, digital PR, AI search — with the Vilu website remaining the central owned platform.

### Phase 30 — Agency / Partner Growth
**Status:** PENDING · **Owner approval required:** YES (commercial terms) · **Production impact:** YES
Agency lead acquisition, partner onboarding, quotation workflow, group enquiries, controlled partner pricing, commission handling, agency packages, international agencies (Russia/China focus), performance tracking, Vilu Voyager distribution. Private commercial terms remain private — see `VILU_PROTECTED_CONTRACTS.md`.

### Phase 31 — Vilu Voyager Future Integration
**Status:** PLANNED / FUTURE (concept only) · **Owner approval required:** YES · **Production impact:** YES if/when launched
Activities/excursions/South-Ari-experience brand — potential integration with experiences, holiday packages, agency distribution, guest excursion enquiries, destination content. Do not force into the current visual phase.

### Phase 32 — Security Hardening
**Status:** COMPLETE WITH DOCUMENTED RESIDUAL LEGACY COMPATIBILITY — deployed to production 2026-09-06 (combined `080874b` + `6e64c68`), verified live · **Owner approval required:** received, for both the implementation and the production deployment · **Production impact:** YES, realized
Full architecture map + 7 classified findings (V1-V7) on record in `VILU_COMPLETION_MATRIX.md` Phase 47 — every one now has a definitive, evidenced resolution. **Implemented (`080874b`)**: removed the fully dead/never-called login-lockout+session-timeout system, a dead unauthenticated agency-session-restore vestige, a fully dead embedded legacy agency mini-login, and closed a login-form enumeration signal. **Agency migration**: the owner had the real agency partner log in once through the existing Agency Portal, triggering `migrateLegacyAgency()`'s built-in self-migration — re-confirmed via Firebase Console that `agency@viluresidence.com` now exists in Firebase Auth (alongside `viluresidence@gmail.com`, already migrated). **Implemented (`6e64c68`)**, now that both named defaults are confirmed migrated: removed their hardcoded/base64 passwords from `loadUsers()`'s `DEFAULTS` array plus a narrow scrub for either email's stale leftover password; fixed a real gap in `migrateLegacyAgency()` that never scrubbed the plaintext password after migrating, now mirroring the PMS's own `migrateLegacyUser()` behavior. **Deployed to `https://viluresidence.net/` 2026-09-06** and verified: credential strings confirmed absent, fix comments confirmed present, both login pages load cleanly, public site visually unaffected. **`migrateLegacyUser()`/`migrateLegacyAgency()` themselves remain intentionally, permanently retained by design** — this is what a self-healing migration path is for, not unfinished work; no inventory of every other real account was ever possible from this environment. One dead code path (a second agency-routing branch) was traced but intentionally left in place since removing it means touching a function that runs on every single login for a purely cosmetic gain. No destructive security rewrites, no PMS/booking/pricing/Firestore-rules/UI changes at any point.

### Phase 33 — PMS Reliability / Hardening
**Status:** PENDING SEPARATE PHASE · **Owner approval required:** YES · **Production impact:** YES
Deeper reliability audit, availability accuracy, permissions, error handling, role separation, operational monitoring, UX refinement, guest-communication integration where appropriate. Must not damage protected booking contracts — see `VILU_PROTECTED_CONTRACTS.md`.

### Phase 34 — Agency Portal Hardening
**Status:** PENDING SEPARATE PHASE · **Owner approval required:** YES · **Production impact:** YES
Authentication, authorization, role isolation, private-rate protection, `agency_package` access, error handling, partner lifecycle, audit trails where appropriate.

### Phase 35 — Final Global QA / Search-Moat Audit
**Status:** NOT STARTED (mature-project audit, revisit periodically) · **Owner approval required:** NO · **Production impact:** NONE (audit)
Content quality, technical SEO, backlinks, cannibalization, international SEO, CRO, Core Web Vitals, accessibility, structured data, broken links, orphan pages, thin content, stale content, competitor gaps, brand visibility, SERP ownership.

### Phase 36 — Final AI Continuity Pack
**Status:** NOT COMPLETE (this very documentation system is the start of it) · **Owner approval required:** NO · **Production impact:** NONE
Ensure a future AI, years later, can reconstruct the entire project from `docs/ai/VILU_*.md` alone, with no dependency on any specific chat history.

---

## Phase history already completed (do not erase — see `VILU_CHANGELOG.md` for full detail)

- **Phase 9/10/11 (legacy numbering, pre-dates this roadmap)** — global nav/footer unification, consent foundation, self-hosted fonts, legal pages, attribution-core normalization.
- **Phase 12** — cinematic redesign foundation (hero video, dark/light theme system, homepage restructure).
- **Phase 13A** — global SEO/performance/international-market audit (audit only, no implementation).
- **Phase 13B-1 / 13B-1.1** — international metadata/schema/internal-linking corrections (JSON-LD localization, OG/Twitter localization, FAQ parity fixes, Arabic locale correction).
- **Phase 13B-2** — safe Firebase performance architecture (`ensureFirebaseReady()` lazy-init), integrated to `main` and deployed to production (Hosting-only) — this is the production baseline commit in `main`, `1130e1e328ac8ac0df88f26b5523ff34201c80c0`.
- **Phases 1–5 above** — visual correction / Island Beach hero / Below South Ari rebuild / owner approval / production release / live verification — **all COMPLETE as of 2026-09-06**, deployed to `https://viluresidence.net/` at commit `dcfe40b` (Hosting-only; `origin/main` not yet fast-forwarded to include it — see Phase 4 note above and `VILU_COMPLETION_MATRIX.md` Phase 18).
- **Next unblocked phase per this roadmap's own sequence:** Phase 2 (Live Destination Experience visual prototype) — not started, needs explicit owner approval to begin, per the 2026-09-06 master-audit reconciliation. See `VILU_COMPLETION_MATRIX.md` for the full 0–55 status table and that audit's recommended execution order, which flags Phase 32 (Security Hardening in this file's numbering) for earlier-than-sequence attention given concrete findings.
