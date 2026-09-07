# Vilu — Search & Conversion Monitoring Framework

A documented operating model for tracking search performance and booking-path conversion across **every market the site reaches, evaluated dynamically** — not a fixed priority list of named countries. Russia, China, Spain, Germany, etc. are current examples surfaced by real data, not hardcoded categories this framework depends on. Any market can rise or fall in priority as the data changes.

This is a documentation deliverable only — no automation, dashboard, or scheduled job was built as part of writing this. It defines what to look at, how often, and how to decide what matters next.

---

## Current known access gap (as of 2026-09-07)

Yandex Webmaster (`https://viluresidence.net/`, verified, HTML-file method, owner as verified owner, sitemap submitted) could not be independently re-checked this session — the browser session had been signed out, and re-authentication required an email verification code sent to `viluresidence@gmail.com` that this environment has no way to retrieve. **Action needed from the owner**: either provide that code when next requesting a Yandex check, or open Yandex Webmaster themselves and relay what Summary/Diagnostics/Indexing/Search queries show. Until then, Yandex data in any report should say "not yet available this session," never an invented number.

---

## E1 — Global market scorecard

Tracked **monthly, per country**, for every country with measurable traffic (not just a preset list):

| Metric | Source |
|---|---|
| Users / sessions | GA4 |
| Organic impressions | GSC (+ Yandex Webmaster for Russian traffic, Baidu Webmaster if ever set up for Chinese traffic — GSC alone under-measures both) |
| Organic clicks | GSC / Yandex |
| CTR | GSC / Yandex |
| Average position | GSC / Yandex |
| Package views | GA4 event (`package_view` or equivalent — confirm exact event name in `analytics.js` before relying on it) |
| Package enquiries (WhatsApp/email clicks from a package context) | GA4 events already wired: `package_enquire`, `contact_click`, WhatsApp `wa.me` link clicks |
| Availability-widget clicks | GA4 event on the Check Availability / Quick Reservation interactions |
| WhatsApp clicks (site-wide, not just package context) | GA4 |
| Email/contact-form clicks | GA4 |
| Booking starts (a real `submitBooking`/`submitNB` invocation, not just an open widget) | Firestore `reservations` collection, filtered by `source` and a country signal (guest_country field, imperfect but real) if this is ever built as a scheduled export; not currently automated |
| Completed direct bookings | Firestore `reservations` where `status != Cancelled` and `source` indicates direct (not OTA) |
| Direct-booking revenue | Derived from reservation records — same caveats as the Owner Analytics Dashboard plan already drafted (`calcTax()` + extra-bed charge, never `calcTax().total` alone) |
| Conversion rate | Completed bookings ÷ sessions, per country |
| Average booking value | Direct-booking revenue ÷ completed bookings, per country |

**Ranking**: recompute monthly, rank countries by (a) absolute traffic, (b) conversion rate, (c) revenue, (d) month-over-month growth in each. A country with low absolute volume but high growth or high conversion is a genuine signal to investigate, not noise to ignore — this is exactly how Spain (a symbolic PR mention, thin GSC data) and the Kazakhstan/Uzbekistan/Tajikistan candidates were originally surfaced as worth a look. **The ranking output is what should drive "which market next," not a fixed roadmap order.**

## E2 — Page scorecard

Tracked monthly for: homepage, Holiday Packages, Maamigili guide, whale-shark guide, manta guide, South Ari Atoll guide, Getting to Maamigili (transport), rooms/accommodation section, and every other guide as it accumulates enough impressions to be worth reading (a brand-new guide with 20 impressions this month isn't yet a data point).

For each page, track: impressions, clicks, CTR, average position, and — where the page is a conversion-relevant page (Packages, rooms, any guide with a clear next-step CTA) — the same package-view/enquiry/availability-click events as E1, scoped to that page.

**Flags to look for every month**:
- **High impressions + low CTR** → title/meta-description problem, not a ranking problem. Fix copy, don't chase rank.
- **High traffic + low conversion** → the page attracts the wrong intent, or its CTA/next-step is weak/missing. Look at the actual page before assuming the traffic is "bad."
- **Positions 4–10** → the single most actionable bucket: real ranking, real visibility, but not enough to reliably win clicks. These are the pages worth a content/backlink push before anything ranked >20.
- **Declining pages** (impressions or clicks trending down 2+ consecutive months) → check for a real regression first (broken link, removed content, a competitor overtaking) before assuming algorithmic drift.
- **Growing pages** → identify what changed (new content, new backlink, seasonal query) so the same lever can be pulled elsewhere.
- **New query clusters** (queries appearing in Performance that weren't there last month) → early signal of a content gap or an emerging market/intent worth a dedicated page, the same way "dhigurah" surfaced as a rising related query worth tracking during Search Intelligence.

## E3 — Operating cadence

**WEEKLY** — technical/search/conversion health check, ~15–30 minutes:
- GSC: any new "why pages aren't indexed" reason, any new manual action or security issue, any sitemap processing error.
- Live spot-check: homepage + 1–2 other key pages still return 200, correct `lang`, self-canonical, no console errors — the same class of check this session ran after Phase 30.
- Conversion: WhatsApp/email/availability click volume roughly in line with recent weeks (a sudden drop is worth same-week investigation, not waiting for month-end).
- No content/strategy decisions made at this cadence — just "is anything broken."

**MONTHLY** — growth diagnosis + prioritized improvements, ~1–2 hours:
- Run E1 (market scorecard) and E2 (page scorecard) in full.
- Produce a short prioritized list: 2–4 specific, scoped recommendations (a title rewrite, a new internal link, a candidate market worth a research pass) — never a blanket "improve SEO" item, matching the standing GSC-workflow discipline already documented above.
- Reconcile against `VILU_COMPLETION_MATRIX.md` — does anything found this month change a phase's status (a new market's evidence reaching the bar Russia/China/Spain did; a technical regression reopening a phase marked COMPLETE)?
- Owner approval before any implementation, per the project's standing workflow — this cadence produces recommendations, not changes.

**QUARTERLY** — market/channel/content strategy review, ~half a day:
- Re-run the full market ranking (E1) over the quarter, not just the latest month, to separate real trend from noise.
- Revisit which markets deserve their own dedicated locale/content investment next — using the same evidence bar already established (a real, cited demand signal; a real positioning risk or white-space opportunity; not "it would be nice to have this language too").
- Revisit whether any PARTIAL-status phase (see `VILU_COMPLETION_MATRIX.md`) now has enough evidence to justify finishing it, or should stay deferred.
- Off-page/distribution/backlink posture review — this is the one lever none of the completed market phases (Russia, China, Spain) have executed yet; worth a dedicated quarterly look rather than folding into monthly.

---

## What this framework deliberately does not do

- It does not hardcode Russia/China/Spain/Germany (or any market) as permanently prioritized — they're current leaders because of real data, and the ranking step in E1 is what should promote or demote any market, including new ones with no history yet.
- It does not propose new automation, a new dashboard, or a new Firestore collection — it's a description of what to look at and when, using data sources that already exist (GSC, Yandex, GA4, Firestore).
- It does not authorize any of the weekly/monthly/quarterly checks to make production changes on their own — every cadence above ends in a recommendation, not an implementation, consistent with the project's standing owner-approval workflow.
