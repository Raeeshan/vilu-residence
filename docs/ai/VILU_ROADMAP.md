# VILU — Master Roadmap

Every phase below is real and permanent. **Do not start any phase beyond the current active one without explicit owner approval for that specific phase** — this file records the full intended sequence so future sessions don't lose it, not a license to execute it autonomously. See `VILU_CURRENT_STATE.md` for which phase is active right now, and re-verify that file (and this one) against actual repository state before relying on either.

Status labels (use exactly one per phase): `NOT STARTED` · `PLANNED` · `AUDIT IN PROGRESS` · `IMPLEMENTATION IN PROGRESS` · `PREVIEW READY` · `OWNER REVIEW` · `BLOCKED` · `APPROVED` · `DEPLOYED` · `COMPLETE`. Never mark `APPROVED` without explicit owner approval. Never mark `COMPLETE` without actual evidence (tests, screenshots, or a verified live check).

---

### Phase 1 — Current Visual Correction
**Status:** IMPLEMENTATION IN PROGRESS · **Owner approval required:** YES (to merge/deploy) · **Production impact:** NONE YET
New Island Beach hero, hero brightness, hero loop, hero→section fade transition, Descent redesign, property-photo defect investigation, availability visual refinement, package arrangement redesign, gallery redesign, Dark/Light QA. Full detail in `VILU_CURRENT_STATE.md`.

### Phase 2 — Live Destination Experience: visual prototype
**Status:** PLANNED · **Owner approval required:** YES · **Production impact:** NONE
Design-only first: Maamigili local time, current weather, forecast, sunrise/sunset, a transparent glass-like hero treatment. Must not delay or block Phase 1. No live API connection at this stage — see Phase 6.

### Phase 3 — Owner Visual Approval
**Status:** NOT STARTED (blocked on Phase 1) · **Owner approval required:** this phase IS the approval gate · **Production impact:** NONE
Owner personally reviews desktop/mobile, Dark/Light, hero, packages, gallery, weather prototype, availability, property section, rooms, guides, booking — across everything touched in Phases 1–2.

### Phase 4 — Production Design Release
**Status:** BLOCKED BY OWNER APPROVAL · **Owner approval required:** YES · **Production impact:** YES (Hosting-only)
Controlled Hosting-only release of the approved design, following the exact integration/deploy discipline in `VILU_PROTECTED_CONTRACTS.md` §"Deployment safety rules."

### Phase 5 — Live Production Verification
**Status:** NOT STARTED · **Owner approval required:** NO (verification only) · **Production impact:** READ-ONLY CHECKS
Visual, booking/PMS boundary, analytics, consent, SEO, international, accessibility, performance — all re-verified on the live domain after Phase 4.

### Phase 6 — Live Maamigili Weather/Time Implementation
**Status:** NOT STARTED · **Owner approval required:** YES (provider/license/data choice) · **Production impact:** YES (new external dependency)
Choose a real provider; verify commercial license, API limits, attribution requirements, frontend-key security; design caching and a graceful failure fallback; implement weather + forecast + time + sunrise/sunset; accessibility/performance QA; analytics where useful. Must never block hero rendering, LCP, booking, Firebase, consent, or main content, and must never show `undefined`/`NaN`/a broken icon/a fake `0°C`/an empty huge panel — see `VILU_IDEA_BACKLOG.md` for the full design-prototype notes and `VILU_PROTECTED_CONTRACTS.md` for the fallback contract.

### Phase 7 — Performance Finalization
**Status:** NOT STARTED · **Owner approval required:** NO · **Production impact:** YES
Core Web Vitals (LCP/TBT/CLS), hero media, image formats, preloads, lazy loading, Firebase boot, analytics boot, consent boot, theme initialization, cache strategy, mobile performance. Must not sacrifice booking reliability, consent, analytics correctness, accessibility, or cinematic visual quality. Builds on the existing `ensureFirebaseReady()` lazy-init architecture (Phase 13B-2, already shipped — see `VILU_CHANGELOG.md`), preserved unless a tested superior replacement is explicitly approved.

### Phase 8 — Google Search Console
**Status:** NOT STARTED / OWNER SETUP REQUIRED · **Owner approval required:** YES (account access) · **Production impact:** NONE
Connect GSC (domain property `viluresidence.net`), DNS verification, sitemap validation, indexing review.

### Phase 9 — Search Intelligence
**Status:** NOT STARTED · **Owner approval required:** NO · **Production impact:** NONE
Query data, page data, country data, device data, impressions, CTR, average positions, high-impression/low-CTR opportunities, content-gap opportunities, market opportunities, baseline reporting. Feeds Phases 12–17's country decisions with real data rather than assumption.

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
**Status:** PENDING SEPARATE PHASE · **Owner approval required:** YES · **Production impact:** YES
Historical concerns on record: hardcoded default accounts, base64 password patterns, legacy plaintext storage, localStorage credential behavior, legacy agency login, old BroadcastChannel paths, internal-page exposure, role separation. Full audit: Auth, Firestore, rules, Storage, PMS, Agency Portal, password handling, staff accounts, sessions, internal pages, permissions. No destructive security rewrites during design work.

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
- **Phase 13B-2** — safe Firebase performance architecture (`ensureFirebaseReady()` lazy-init), integrated to `main` and deployed to production (Hosting-only) — this is the current production baseline, `1130e1e328ac8ac0df88f26b5523ff34201c80c0`.
- **Current: Phase 1 above** — visual correction / Island Beach hero, in progress on `feat/vilu-reference-design-system`, not yet merged or deployed.
