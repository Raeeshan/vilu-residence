# Phase 41 — Original Data / Vilu South Ari Travel Report (private, strategy + draft)

**PRIVATE — internal use only, never published as-is.** Excluded from hosting via `firebase.json`'s `docs/**` ignore rule. Matrix Phase 41 ("Original data / Vilu South Ari Travel Report").

**Critical constraint, stated up front and never violated below**: as of the last direct check (2026-07-20), all 46 of Vilu's Firestore `reservations` documents are Cancelled test data — there are **zero real guest bookings** to draw first-party statistics from. No sample size, percentage, or guest-behavior statistic is fabricated anywhere in this document. Every claim is labeled **VERIFIED FIRST-PARTY DATA** (none exists yet), **OPERATIONAL OBSERVATION** (general, non-statistical), **EXTERNAL AUTHORITATIVE DATA** (a real, citable source), or **INFERENCE**.

---

## Draft: Vilu South Ari Travel Report (internal evidence draft, not yet public copy)

### 1. Why travelers choose South Ari

**EXTERNAL AUTHORITATIVE DATA**: Harvey-Carroll et al., *Scientific Reports* 2021 (nature.com/articles/s41598-020-79101-8) documents South Ari Marine Protected Area (SAMPA) as "one of few locations globally where year-long residency of individuals occurs" for whale sharks — a claim about individual residency patterns, never to be broadened to "non-migratory" or "permanently resident population."

**EXTERNAL AUTHORITATIVE DATA**: PADI's own dive-site listing (padi.com/dive-site/maldives/maamigili-beyru/) names the site "Maamigili Beyru (Whale Shark Marine Protected Area)," with whale sharks "spotted year-round, especially on sunny days with calm seas," and manta rays/reef sharks/reef fish as frequent secondary species.

**OPERATIONAL OBSERVATION**: Whale-shark snorkeling doesn't require dive certification, unlike much of the atoll's other marine tourism — a structural, category-wide feature of the destination, not a Vilu-specific claim.

**INFERENCE**: Because South Ari's draw is tied to a geographically bounded MPA rather than any single resort or operator, travelers are choosing the region and its ecosystem first, and a place to stay second — favoring destination-first content over hotel-first content as a discovery strategy. This is the same conclusion the website's own architecture already reflects (South Ari platform → holiday packages → accommodation).

No sighting-probability percentage is used anywhere in this report, and sightings are never described as guaranteed.

### 2. Maamigili access patterns

**EXTERNAL AUTHORITATIVE DATA**: Maamigili is home to Villa International Airport (VAM), the only airport in South Ari Atoll.

**OPERATIONAL OBSERVATION**: Because it's the only atoll airport, travelers headed anywhere in South Ari — not just Maamigili — typically arrive by air at Maamigili first, then continue by boat. This is atoll geography, not a competitive claim about any other island.

**VERIFIED PROJECT FACT** (protected contract, unchanged): Vilu's holiday packages include round-trip speedboat transfer only. Domestic flights to Maamigili are never included in any package — airport access is a separate travel-planning fact, never merged with package-inclusion language.

**INFERENCE**: This creates a real, correctable point of confusion for travelers used to Maldives resort packages elsewhere that bundle domestic/seaplane transfers (see §4). Clearly separating "how you reach Maamigili" from "what a Vilu package includes" has genuine planning utility beyond Vilu's own marketing interest.

### 3. The whale-shark travel-planning angle

Restating §1's sources: this is one of a small number of places worldwide with documented year-long individual residency (a citable scientific fact), sightings are reported year-round but conditions-dependent (per PADI's own listing), and no operator — Vilu included — can or should promise a sighting on a specific trip. This is a stronger, more durable claim than an internal probability statistic, because it rests on citable science rather than a number that doesn't yet exist.

### 4. Common planning misconceptions worth correcting

**OPERATIONAL OBSERVATION**: Many Maldives resort/holiday packages elsewhere in the country bundle domestic seaplane or airport transfers into the headline price — a general market pattern, not a claim about any specific competitor.

**INFERENCE**: A traveler shopping across multiple Maldives listings can reasonably default to assuming "package = flight included." Applied to Vilu, that assumption is incorrect — stating this plainly, as a corrected misconception rather than a hidden exclusion, is both more accurate and more trustworthy than silence.

**OPERATIONAL OBSERVATION**: A second common confusion conflates "South Ari Atoll" (a large area, many islands) with a single island or resort — travelers researching "South Ari" are often making an atoll-level decision (which island, which access route, which style of stay) before a property-level one.

### 5. Local-island vs. private-resort South Ari experiences

**OPERATIONAL OBSERVATION**: Maldives accommodation broadly divides into private single-island resorts and inhabited "local islands" with guesthouses — local islands have resident communities, shops, cafés, a mosque, and local social norms; resorts do not have a resident population outside staff. On local islands, swimwear/dress norms commonly differ by location on the same island — a designated "bikini beach" area (Maamigili's own, by name) permits resort-style swimwear, while the rest of the island follows more conservative local norms — a structural feature of local-island tourism across the Maldives, not specific to Vilu.

**INFERENCE**: This is a genuine planning input, not a marketing angle — travelers wanting a private-resort-style stay with no local-norm considerations are looking for a different product than travelers open to real village life alongside their beach time. Helping readers self-select accurately reduces mismatched expectations rather than manufacturing demand.

### 6. Responsible wildlife-tourism travel planning

**EXTERNAL AUTHORITATIVE DATA**: SAMPA's protected-area status exists specifically because the area supports a documented, scientifically studied whale-shark population — the protection status itself is citable, not inferred.

**OPERATIONAL OBSERVATION**: Responsible in-water conduct (distance, no touching/chasing, limited group/boat numbers near an animal, following guide instructions) is standard guidance across whale-shark tourism sites globally.

**INFERENCE**: Responsible-tourism guidance belongs in this report as context for why the area is protected and what protects the experience for future visitors — this also reinforces §3's residency framing, since continued sightings depend on the animals' welfare.

### 7. Methodology / data statement (must remain in any future public version)

**INTERNAL DATA STATUS (verified 2026-07-20)**: Vilu's Firestore reservation system contains 46 documents, all Cancelled test data. **Zero live guest bookings exist.** This report therefore contains no first-party statistics of any kind — no enquiry volumes, no repeat-visitor rates, no length-of-stay averages, no nationality breakdowns, no sighting-rate percentages. It is built entirely from external, citable sources and general operational observation, with inferences clearly flagged.

**What would need to happen before a future edition could add first-party data**: real guest bookings accumulating over one or more full booking cycles; any resulting statistic carrying a stated, real sample size and time window; any guest-behavior claim drawn from actual guest communications, never projected from assumption.

---

## Genuine first-party and operational evidence available beyond the reservations system (added 2026-09-08 closure pass)

The reservations system itself has zero usable data (§7), but a fresh search of this project's own already-completed, already-verified research found real, citable evidence beyond it — none of it a fabricated statistic, all of it either directly measured or a real operational fact:

**VERIFIED FIRST-PARTY MEASURED DATA** (Google Search Console, window 2026-08-02 to 2026-09-04, `docs/seo/GSC_BASELINE.md`): 36 clicks, 1,720 impressions, 2.1% CTR, average position 5.9, across 158 real queries and 63 countries. Real per-country rows exist (Czechia 14 clicks/138 impressions; Italy 8/256; Germany 1/247; Turkey 0/226). Mobile-dominant device split (24 clicks/1,388 impressions vs. desktop 12/318). A genuine, load-bearing finding: whale-shark/manta/snorkeling terms — Vilu's own core differentiator — do not yet appear in its own top-158 query list, even though third parties (Tripadvisor, HotelsOne) already rank for "Maamigili hotel"-type queries Vilu itself doesn't yet capture (`docs/seo/SEARCH_INTELLIGENCE.md`).

**OPERATIONAL OBSERVATION** (the site's own live guest FAQ, `vilu-website.html`): real, currently-published guest questions cover Malé→Maamigili transport options, how to get back to Malé, what's included in a package, activities, booking/payment terms (explicitly cash-only in person, no online deposit), Wi-Fi, and dietary accommodation — a genuine, non-statistical signal of what travelers researching this trip actually want answered, safe to cite as "the property's own FAQ already addresses X," never as a measured percentage of anything.

**OPERATIONAL OBSERVATION, caveated** (`docs/seo/PHASE42_REPUTATION_SEO_STRATEGY.md`, `PHASE34_LOCAL_SEO_GBP_STRATEGY.md`): real, directly-reconfirmed Google Business Profile stats (5.0 rating, 81 reviews) and small-sample, explicitly-caveated recurring themes from retrievable OTA review snippets (staff hospitality, cleanliness, breakfast quality, fair-priced excursion arranging, value versus resort pricing). OTA-side rating/review-count figures beyond GBP are labeled APPROXIMATE in their source document and are not restated here as precise.

**EXTERNAL AUTHORITATIVE DATA** (`docs/seo/MARKET_INTELLIGENCE.md`, each independently sourced): Russian Maldives arrivals reached 278,760 in 2025 (~12.4% of all arrivals) and 195,973 in Jan–Aug 2026 (+20% YoY, sourced atorus.ru/interfax.ru/ria.ru); China is the Maldives' #1 source market (~13% of arrivals), with 29.6% of Chinese arrivals (~53,100 people) choosing guesthouses — the highest guesthouse share of any top-10 source market; a real, seasonal Tashkent–Malé flight route exists for the Uzbek market. Google Trends data (already verified in Phase 9) independently confirms "South Ari Atoll" as the dominant regional search term, with whale-shark search interest flatter/more year-round than winter-peaked package-search seasonality.

None of the above is a Vilu-specific guest-behavior statistic — it is real search-demand, review, and regional-market evidence that legitimately strengthens the report's "why South Ari, why now" authority narrative without ever implying a first-party booking sample that doesn't exist.

## Assessment of the private "Why Maamigili" draft (`docs/seo/DRAFT_WHY_MAAMIGILI_PAGE.md`) — re-reviewed 2026-09-08

A full fresh re-read of the entire draft (all 23 sections) against every protected positioning rule found **no factual, safety, or positioning defect**: every wildlife claim is precisely hedged (year-long *individual* residency, never "non-migratory" or "guaranteed"); the Dhigurah/Maafushi/Ukulhas/Thoddoo passages name competitors only to pivot back to a real, evidenced Maamigili advantage (its airport) with zero inferiority claim about any of them; transport wording correctly and repeatedly separates "round-trip speedboat included" from "domestic flight is a separate arrangement"; the package section describes inclusions generically without quoting a specific package's price, so it won't drift out of sync with the locked catalog; the public-humanization review found zero AI-tool exposure and zero templated/mechanical phrasing patterns; sourcing is entirely primary/authoritative (Harvey-Carroll et al. 2021, PADI's own dive-site listing, the Ministry of Environment's SAMPA designation, Visit Maldives' own equal-listing page).

**Upgraded assessment: PUBLICATION-READY, pending the owner's own go/no-go — not a further revision requirement.** The original §23 "REVISE (light touch)" recommendation flagged two passages for the owner's *tone* preference, not a factual or safety problem — re-reading them this pass, both read as measured and non-disparaging as written. This document therefore does not request further edits on Claude's own initiative; it upgrades the draft from "needs revision" to "ready to publish as-is, if the owner is comfortable with the Dhigurah-pivot paragraph and the Maafushi/Ukulhas/Thoddoo one-liners exactly as written."

**Publishing itself remains a separate, owner-gated action, not performed here** — per this project's own standing rule that new public content requires explicit owner review before going live, and per this phase's own definition (`VILU_ROADMAP.md` Phase 27: "Owner approval required: NO (compilation), YES (publication)"). The decision is surfaced here, clearly, for the owner: **read `docs/seo/DRAFT_WHY_MAAMIGILI_PAGE.md` in full, then approve as-is, request specific edits, or reject.** No HTML page was created, linked, or added to the sitemap/navigation/schema this pass.

## Linkable-asset coordination with Phase 36

The travel report above, once the owner has reviewed and approved any public-facing version, is exactly the kind of asset Phase 36's outreach targets (ZuBlu, aMaldives, Divernet, Save Our Seas Foundation) would be more likely to link to than a generic page — see `docs/seo/PHASE36_BACKLINKS_DIGITAL_PR_STRATEGY.md` §21/§22 for the outreach templates already prepared. No outreach was sent this pass; this report remains a private draft awaiting owner review before any public version is built or pitched.

## Phase 41 status

**COMPLETE (2026-09-08).** This phase's own definition (`VILU_ROADMAP.md` Phase 27) requires no owner approval for compilation, only for publication — and the compilation itself is now genuinely finished: an evidence-labeled travel report with real GSC/market/FAQ/review evidence layered in (above), and the Why Maamigili draft fully re-verified and upgraded to publication-ready. Zero fabrication anywhere (true first-party booking data remains structurally unavailable until real reservations exist — a standing, honestly-stated external limitation, not a gap in this phase's own work). What correctly stays outside this phase's own scope, per its own owner-approval split: converting the report into a live public page, and publishing the Why Maamigili page — both are separate, owner-gated publication decisions, not unfinished compilation work.

## Files changed

New: `docs/business/PHASE41_SOUTH_ARI_TRAVEL_REPORT.md` (this file). No public site file changed. No HTML page created or published.
