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

## Assessment of the private "Why Maamigili" draft (`docs/seo/DRAFT_WHY_MAAMIGILI_PAGE.md`)

Per the draft's own §23 recommendation (unchanged since it was written, and not superseded by anything found this phase): **REVISE (light touch) before publish** — the factual core is solid and fully sourced against already-approved site content. Two things need the owner's own eyes before this goes anywhere near HTML: (1) whether the Maafushi/Ukulhas/Thoddoo one-liners read correctly inside the "Who this suits" framing; (2) the Dhigurah-pivot paragraph's tone specifically — the single highest-stakes sentence on the page for the Maamigili-first rule.

**Material owner claim decision remains open** — per this phase's own instruction ("if material owner claim decisions remain, leave the exact decision clearly surfaced but continue the rest of the program"), this document does **not** finalize or publish the Why Maamigili page. The decision is surfaced here, clearly, for the owner: **read the Dhigurah-pivot paragraph and the Maafushi/Ukulhas/Thoddoo section, then approve, request edits, or reject.** Nothing else in Phase 41 depends on this decision being made first — the travel report above stands on its own.

## Linkable-asset coordination with Phase 36

The travel report above, once the owner has reviewed and approved any public-facing version, is exactly the kind of asset Phase 36's outreach targets (ZuBlu, aMaldives, Divernet, Save Our Seas Foundation) would be more likely to link to than a generic page — see `docs/seo/PHASE36_BACKLINKS_DIGITAL_PR_STRATEGY.md` §21/§22 for the outreach templates already prepared. No outreach was sent this pass; this report remains a private draft awaiting owner review before any public version is built or pitched.

## Phase 41 status

**PARTIAL.** The evidence-backed draft report is complete and internally consistent with every established project fact (no fabrication, precise scientific wording, transport rule preserved, Maamigili-first hierarchy preserved). What keeps this from COMPLETE: (1) the draft above is not yet owner-reviewed or converted into public page copy — no HTML page was created, matching the standing rule that new public content requires explicit review; (2) the Why Maamigili publication decision remains explicitly open, as documented above; (3) true first-party data remains unavailable by definition until real bookings exist — this is a standing, external limitation, not a task failure, and is honestly stated rather than worked around with fabrication.

## Files changed

New: `docs/business/PHASE41_SOUTH_ARI_TRAVEL_REPORT.md` (this file). No public site file changed. No HTML page created or published.
