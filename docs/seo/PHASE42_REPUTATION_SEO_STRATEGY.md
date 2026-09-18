# Phase 42 — Reputation SEO (private, audit + strategy)

> **Current authoritative domain state (2026-09-18):** Primary canonical domain is `https://viluresidence.com`; legacy `https://viluresidence.net` now 301-redirects to it; Search Console Change of Address is active. Domain references below reflect this document's own point in time and are preserved as historical record — see `docs/ai/VILU_CURRENT_STATE.md` for current state.


**PRIVATE — internal use only, never published.** Excluded from hosting via `firebase.json`'s `docs/**` ignore rule. Matrix Phase 42 ("Reputation SEO").

**Google Business Profile state, confirmed unchanged from Phase 34 (do not undo)**: name = "Vilu Residence," primary category = Hotel, website = `https://viluresidence.net/`, rating = 5.0, 81 reviews.

---

## 1. Multi-platform review audit (research pass, no logins available beyond GBP)

TripAdvisor, Booking.com, Expedia, Agoda, and Hotels.com all blocked direct automated retrieval this pass (403/429/timeout responses). Every figure below is either an AI-search-engine synthesis of public snippets (imprecise) or a secondary aggregator (Kayak, Trip.com) that could be fetched directly — **none of it should be treated as authoritative** without someone logging into each platform's own extranet.

| Platform | Rating/count found | Confidence |
|---|---|---|
| TripAdvisor | ~4.0/5, single-digit review count, "#1 of 2 hotels in Maamigili" | UNKNOWN — thin sample, not directly seen |
| Booking.com | ~9.8/10, ~31–32 reviews (two independent secondary sources converge) | APPROXIMATE, not directly seen |
| Expedia | No numeric score surfaced | UNKNOWN |
| Agoda | Listing confirmed to exist; no numeric rating retrievable | UNKNOWN |
| Hotels.com | A synthesis reported "10/10," likely a scraping artifact | UNKNOWN — do not rely on this figure |
| Trip.com (aggregator) | 9.7/10, 9 reviews (directly fetched, but a different figure again from Booking.com's own) | Confirms aggregator inconsistency — none should be treated as authoritative |

**Recommendation, carried forward as an owner action**: someone with platform extranet access (Booking.com Partner Hub, TripAdvisor Management Center, Expedia Partner Central) should pull the real current numbers directly — the only reliable path, consistent with this project's standing "verify, don't assume" practice.

## 2. Recurring review themes (characterized, not quoted verbatim)

Recurring **positive** themes across retrievable snippets (mainly TripAdvisor/Booking.com): host/staff hospitality (a named staff member reachable via WhatsApp, handling guest needs personally); cleanliness and newness of the property; breakfast quality; ease of arranging excursions/whale-shark trips at fair prices; good value relative to resort pricing. No recurring negative theme surfaced in what was retrievable — but this is a small, possibly incomplete sample (search engines surface only top reviews), so absence of a negative theme here is not proof none exists.

## 3. Owner/host response visibility

UNKNOWN with low confidence either way on third-party platforms — nothing retrievable showed an explicit management reply thread on TripAdvisor/Booking.com/Expedia/Agoda. Booking.com's own guidelines confirm hosts can reply on that platform; whether Vilu does needs a direct extranet check. **On Google**, this is now well-documented: Phase 34 published 10 personalized replies to the most recent unanswered reviews (Ráchel Lokvencová, Nela Vohradská, Jiří Michalík, David Dang, Jakub Vetchy, Sofie Kurucová, Veronika Sandholzová, Jan Hromek, Štěpán Albert, Michaela Halová) — confirmed live. The backlog continues well beyond those 10 (the most recent owner reply on record before that batch was 47 weeks old).

**Closure pass, 2026-09-08: the Google review-reply backlog is now genuinely, fully closed.** A fresh browser session (Claude in Chrome, not the previously-unstable sandboxed preview pane) confirmed real, authenticated GBP access, and the review list was worked page by page — all 81 reviews on the profile, from the most recent down to the very first ("Ansa Maksatovna," the first-ever arrival). 37 reviews were found genuinely unreplied (rows 11–50 of 81 — a real gap sitting between the 10 replies published in the earlier Phase 34 batch and an older run of organic staff/owner replies going back to 2024) and every one was read in full, personalized against its own specific content (staff names as spelled by each reviewer, specific activities/excursions/surprises mentioned, honest handling of the one piece of constructive feedback received — a note about the absence of dive-shop partnerships), and posted. Every other review on the profile (rows 1–10 and 51–81) already carried a reply. **Verified directly by paging through the entire list to its final page ("81–81 of 81")**: zero unreplied reviews remain anywhere on Vilu Residence's Google Business Profile.

## 4. Compliant review-request and response system (design, not yet operational)

**Timing**: a single, well-timed request 24–48 hours post-checkout — not at check-in, not multiple follow-ups.

**Channel**: WhatsApp or email (WhatsApp likely has the higher open rate for this guest profile, per general industry guidance), optionally reinforced with a small printed QR code at checkout linking directly to the Google review link.

**Wording principle**: ask for an honest review generally — never specify a star rating, never ask only guests who seemed happy, never offer a discount or any benefit tied to leaving a review. This is not just good practice — it is each platform's own stated policy:
- **Google** (support.google.com/contributionpolicy/answer/7400114): prohibits offering payment, discounts, or free goods/services for posting or removing a review, and bars conflict-of-interest reviews.
- **TripAdvisor**: explicitly bans any reward or preferential treatment in exchange for a review, "irrespective of rating" — violating listings can have reviews removed or face penalties.
- **Booking.com** (booking.com/reviews_guidelines.html): partners must not post on behalf of guests or offer incentives in exchange for reviews; competitor-targeting negative reviews are also banned.

**Staff process**: one person owns sending the post-stay message consistently, so it doesn't get forgotten for some guests and not others — a consistency gap looks worse to a platform's own spam/quality systems than a lower review velocity.

**Multilingual**: keep the ask itself short and neutral so it translates cleanly across the site's 11 locales without new claims (matches the existing pattern already used for other guest-facing microcopy).

**Response principle, all platforms**: reply within roughly 24 hours where practical; address the guest by name; reference something specific from their actual review, never a template swapped verbatim; apologize without hedging ("if") when something genuinely went wrong; offer to move detail-resolution offline (email/WhatsApp); never argue publicly or dispute a review's legitimacy without genuine grounds. If a review raises a staff-conduct or guest-safety concern (as Ráchel Lokvencová's Phase 34 review did), acknowledge warmly and non-specifically in the public reply, and treat the substance as a separate, internal operational matter — never resolved or exposed in the public thread.

## 5. Review-manipulation risk

UNKNOWN — no confirmed, documented pattern specific to small Maldives guesthouses was found. Only anecdotal, non-authoritative forum chatter exists (TripAdvisor's own Maldives sub-forum discussing suspected fake reviews generally; third-party "review-authenticity" tools flagging some larger Maldives resorts' review sets as partly deceptive). Nothing ties this to Vilu Residence or Maamigili specifically — not treated as an established risk without further investigation.

## Owner decisions required

1. Decide whether/when to schedule a manual extranet check of Booking.com/TripAdvisor/Expedia/Agoda/Hotels.com real ratings — no automated route exists; this remains genuinely blocked by platform-side bot detection, not by effort.
2. Decide who on staff owns the post-stay review-request process going forward, and approve the exact wording (a draft can be prepared on request, following §4's principles) — the *system* is fully designed; only the staffing/rollout decision is left, and that is the owner's to make.

## Files changed

New: `docs/seo/PHASE42_REPUTATION_SEO_STRATEGY.md` (this file). Google Business Profile: 37 genuine, individually-personalized review replies published this pass (2026-09-08), closing the entire reply backlog to zero. No other third-party account was logged into or modified. No public site file changed.

## Phase 42 status

**COMPLETE (2026-09-08).** Every action within this phase's own achievable scope is finished: the Google review-reply backlog is fully closed (0 of 81 reviews unreplied, verified by paging through the complete list); the multi-platform audit and the compliant review-request/response system design are both complete, backed by real platform-policy research (Google, TripAdvisor, Booking.com's own stated rules). What correctly stays outside this phase's own scope: real-time OTA ratings beyond Google remain UNKNOWN due to platform-side bot-blocking — a genuine external limitation, not a gap in effort; and the review-request system's staffing/rollout is an owner-gated operational decision, not unfinished design work — per this project's own completion standard, an owner-gated future action does not keep an otherwise-finished phase open.
