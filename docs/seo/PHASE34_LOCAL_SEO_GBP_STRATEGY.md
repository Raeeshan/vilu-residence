# Phase 34 — Expanded Local SEO / Google Business Profile / Maps (private, strategy + audit)

**PRIVATE STRATEGIC INTELLIGENCE — internal use only, never published, never exposed on the public site.** Excluded from hosting via `firebase.json`'s `docs/**` ignore rule. Matrix Phase 34 (not to be confused with `VILU_ROADMAP.md`'s own 1–36 numbering, which has no "Phase 34" of its own in this scope).

**Access limitation, stated up front**: Claude-in-Chrome (the owner's authenticated Google session) was unavailable throughout this task — checked directly, confirmed not connected, not assumed. Every GBP field that can only be read from the authenticated dashboard (exact rating/review count, Posts, Q&A, photo inventory, verification state, attributes) is marked **UNKNOWN / REQUIRES OWNER** below, per Task 1's explicit instruction not to guess. Everything else is from live, cited public research (search engines, OTA listings, competitor sites, and this repository's own source code) — three parallel research passes plus a direct read of the site's own schema/NAP signals.

**Update (2026-09-08, authenticated verification)**: Claude-in-Chrome connected successfully this pass and confirmed the owner's own authenticated Google Business Profile Manager session (account `viluresidence@gmail.com`, one verified business, "Vilu Residence - Best Guesthouse in Maamigili Island"). All 20 checklist items from §21a were read directly from the dashboard — see the new §31 for the full, real, verified state. Every "UNKNOWN / REQUIRES OWNER" marking below that §31 now resolves is superseded by §31, not deleted, so the original research trail stays intact. Fields §31 could not reach (none, as it turned out — every item resolved) would remain UNKNOWN.

**Correction notice (2026-09-08, owner correction, applied to §7/§8 below)**: the original version of this document stated "no 'whale shark' anywhere in Vilu's own copy" — **this was wrong and has been corrected**. Direct inspection of `vilu-website.html` (not re-checked before the original claim was written) shows the site is saturated with whale-shark content: the meta description, the hero subtitle ("Whale sharks, manta rays and a warm island home."), a dedicated hero display line ("Whale sharks."), every package hook, a full `whale-shark-snorkeling.html` page, and a dedicated "South Ari is known for whale sharks..." section citing the Harvey-Carroll research directly. The accurate, narrower finding — which the original research genuinely did support — is that Vilu's **GBP self-description and Facebook bio specifically** (not the website) omit the phrase, and the homepage's own "Who We Are" section uses generic "marine experiences" wording rather than naming whale sharks directly, even though it sits one screen below a hero that already does. See §7/§8 for the corrected finding.

**Confirmation, per owner correction**: the public website is confirmed, by its own current copy, to already be positioned as a broader South Ari holiday/travel platform, not a plain accommodation site — the homepage's own "Who We Are" section headline reads *"Vilu is your way into South Ari,"* with body copy *"Holiday planning, marine experiences and local knowledge — with our own six-room home in Maamigili when you need somewhere to stay."* This phase's recommendations are scoped to strengthen the factual accommodation entity in Google Maps/GBP specifically — nothing in this document proposes narrowing the public website itself toward a guesthouse-first framing, and none of Phase 34's findings require that.

---

## 1. Current verified GBP state

| Field | Status | Value / finding |
|---|---|---|
| Business name (as shown via Google Hotels entity snippet) | **CURRENT VERIFIED (public-facing snippet only)** | "Vilu Residence – Best Guesthouse in Maamigili Island" — confirmed via a live Google Hotels search snippet this pass. **Caveat**: this may be Google's own auto-generated Hotels-page title (which can blend the business name with other signals) rather than the literal GBP "name" field — cannot be distinguished without the dashboard. |
| Primary category | **STALE HISTORICAL SNAPSHOT** | Prior research inferred "Guest house" from TripAdvisor cross-reference, not read directly from GBP. |
| Address | **CURRENT VERIFIED (via Google Hotels snippet)** | "Rahdhebai magu, Maamigili, Alif Dhaal Atoll, 00100" — consistent with the site's own schema (see §15). |
| Phone | **UNKNOWN / REQUIRES OWNER** | Not renderable via available tools this pass. |
| Website field | **UNKNOWN / REQUIRES OWNER — real risk flagged** | Could not confirm directly, but see §14: multiple OTA/social checks this pass found the *only* two sources that could be checked split — Instagram's own link field correctly points to `viluresidence.net`; the legacy `viluresidence.com` site (still live) has zero forward link to `.net`. GBP's own website field needs direct confirmation — a real possibility it still points to `.com`. |
| Booking URL | UNKNOWN / REQUIRES OWNER | |
| Description | **STALE HISTORICAL SNAPSHOT** | Prior research found no "whale shark" language in Vilu's self-authored copy generally (Facebook bio, homepage); GBP's own description field specifically was not directly readable this pass. |
| Services / amenities / attributes | UNKNOWN / REQUIRES OWNER | |
| Opening hours / check-in info | UNKNOWN / REQUIRES OWNER | |
| Photos / cover image / logo | UNKNOWN / REQUIRES OWNER | |
| Posts | UNKNOWN / REQUIRES OWNER | |
| Q&A | UNKNOWN / REQUIRES OWNER | |
| Review count / rating (Google's own) | **UNKNOWN / REQUIRES OWNER** | Prior research cited "a 5.0 rating" but could not re-verify this pass; OTA ratings (Booking 9.8/10, TripAdvisor 4/5, Hotels.com 9.7–10/10) are **not** the same figure and must not be conflated with Google's own. |
| Owner responses | UNKNOWN / REQUIRES OWNER | |
| Map pin / coordinates | **CURRENT VERIFIED (cross-checked against site schema)** | The site's own `sameAs` and footer both link the same stable Google Maps CID (`?cid=8624726302398144856`) — a single, consistent, non-fragmented Maps entity reference (see §15). |
| Verification/suspension warnings | UNKNOWN / REQUIRES OWNER | |

**Bottom line for Task 1 — superseded 2026-09-08**: the table above reflects the state before authenticated access was available. Every field it marked UNKNOWN / REQUIRES OWNER has now been read directly — see **§31** for the real, verified values. The remaining reason this phase stays PARTIAL is no longer "data unreadable" but "real owner decisions still open" (see §28).

## 2. Historical-vs-current differences

Prior Phase 33 documentation cited "a real, populated Google Business Profile (5.0 rating)." **Re-confirmed 2026-09-08 via authenticated access (§31.16)**: still accurate — 5.0 rating, 81 reviews. The project's stale-data policy (`VILU_DECISIONS.md`) was correctly applied by treating it as unconfirmed until this direct re-check, even though it turned out to still be true.

## 3. GBP name recommendation

**Confirmed 2026-09-08 (§31.1)**: "Vilu Residence - Best Guesthouse in Maamigili Island" IS the literal `Business name` field in the editor — not a Google-Hotels auto-title. This resolves the open question this section previously carried, and makes the policy question live rather than hypothetical: Google's Business Profile naming policy prohibits adding descriptive/marketing text, keywords, or superlatives ("best," category terms) to the name field beyond the real registered business name. **"Best Guesthouse in Maamigili Island" is exactly that kind of addition, and is a real, confirmed policy-compliance risk** — not a branding preference question. **Still owner-gated**: this document did not change the name field (Task 2's explicit instruction — no automatic change). The owner should decide whether to correct it to the plain "Vilu Residence" to remove the compliance risk, understanding that doing so would also drop the keyword-rich search-snippet text the current name currently provides in organic results.

## 4. Category recommendations

**Correction (2026-09-08, owner correction)**: the original version of this section recommended "Guest house = IMPLEMENT" without weighing a relevant fact the owner then supplied — Google has historically displayed Vilu Residence as a **3-star hotel**, not a guesthouse, in at least some surfaces, and the owner does not want the property's premium positioning weakened by a category change made on this research pass's authority alone. Without direct dashboard access to the current live category, no category change should be presumed correct. Below is a neutral, five-point evaluation of the realistic options — factual fit, Google category availability, local-search effect, perception/positioning effect, and risk — with **no option presumptively marked IMPLEMENT**. No Dive Centre / Tour Operator / Travel Agency option is evaluated, since no such business currently exists (that remains a flat REJECT, not a judgment call).

| Category | Factual fit | Google category availability | Local-search effect | Perception/positioning effect | Risk | Recommendation |
|---|---|---|---|---|---|---|
| Guest house | Matches the real, registered business type; matches how TripAdvisor already classifies it | Real, standard Google Business category | Correct baseline eligibility for "guesthouse"/"guest house" local queries | **Lower-tier framing than "hotel"** — a real concern given Google has historically shown Vilu as a 3-star hotel; switching to Guest House could read as a downgrade to a returning searcher or in comparison snippets | Low factual risk, **real positioning risk** given the owner's stated preference | **Owner decision required — do not implement without confirming current category first and weighing the positioning trade-off below** |
| Hotel | Used loosely/interchangeably with guesthouse in Maldives-market listings; consistent with what Google has apparently already shown historically | Real Google category; some markets restrict it to licensed hotel classifications — unconfirmed for this listing | Broadens eligibility for "hotel" queries, a larger search volume category than "guesthouse" in most Maldives-travel search behavior | **Preserves or matches the existing premium framing the owner wants kept** | Low-moderate — Vilu is a genuine 6-room, family-run guesthouse, not architecturally or operationally styled as a hotel; if Google's classification rules require verifiable hotel-grade amenities/services, this could be a compliance question, not just a branding one | **Owner decision required — closest match to status quo if that status quo is confirmed accurate; verify Google's own classification requirements before treating this as safe** |
| Lodging | Generic fallback Google category | Real, broad category | Broadens generic lodging-search eligibility without a strong positioning signal either way | Neutral — doesn't help or hurt the hotel-vs-guesthouse question | None identified | Safe as a **secondary** category only, regardless of what the primary is decided to be |
| Bed and breakfast | Matches the "rooms include daily breakfast" fact already used in the site's own copy (§5) | Real Google category | Narrower than Guest House or Hotel; unlikely to add meaningful new query eligibility | Similar tier concern to Guest House | Low | Not recommended as primary; not worth pursuing as secondary either unless the owner sees a specific reason to |

**Confirmed 2026-09-08 (§31.2)**: the current live primary category IS "Hotel" (with no secondary category set). This resolves the open question above with a concrete, favorable answer: **the listing already carries the category the owner prefers for premium-positioning reasons — no category change is needed to achieve that goal.** This document still makes no recommendation to switch to Guest House: per the table above, doing so would trade a real (if modest) positioning risk for no clearly compensating local-search benefit. **Recommendation: keep "Hotel" as primary; no action required.** One consequence worth the owner's awareness: staying in the Hotel category is also why no description field is available to fill (§31.4) — switching to a non-hotel category like Guest House would likely unlock a description field, but at the cost of the positioning this section exists to protect. This trade-off is now fully mapped; the decision itself remains the owner's.

## 5. Description audit + proposed copy

**Superseded 2026-09-08 (§31.4)**: this section originally treated the description as "unknown, possibly present." Direct verification found the real situation is different — the current Hotel-category listing has **no description field in the editor at all**, so there is nothing to read and nothing to publish to right now. The draft below therefore has no live field to go into unless the category changes (§4) or Google later exposes one for Hotel-category profiles. It is kept here, reviewed and ready, for whichever of those becomes true — not published, no action pending.

**Proposed factual copy, held in reserve (NOT published — no field currently exists to publish it to):**

> Vilu Residence is a six-room, family-run guesthouse on Maamigili, a local island in South Ari Atoll, Maldives, inside the marine protected area where whale sharks are seen year-round. Guests can also visit Maamigili Beyru, a reef known for manta rays and reef life in season. Maamigili has its own domestic airport, a convenient way to reach the island. Rooms include daily breakfast, and holiday packages combine accommodation, a round-trip speedboat transfer, and South Ari experiences — a genuine local-island stay, not a private resort.

(~490 characters, within Google's ~750-character description limit.) Contains every requested element (Vilu Residence, Maamigili, South Ari Atoll, local-island stay, whale-shark region, Maamigili Beyru, airport as separate access fact, packages, breakfast, six-room scale) and none of the forbidden claims (no guarantee, no "closest/best/number one," no unsupported "Whale Shark Island" official designation, no competitor mention).

## 6. Local Pack findings

**Important caveat, stated by the research itself**: live Google SERP rendering (Local Pack, AI Overview) could not be confirmed this specific pass (both the sandboxed browser and Claude-in-Chrome were unavailable to the research agent) — the prior turn's research (before this phase) DID directly observe live SERPs and found zero Local Pack appearances for Maamigili businesses across whale-shark queries; that finding is not re-verified this pass but also not contradicted. Treat it as still the best available evidence, dated to that session.

This pass's WebSearch-based findings (a proxy, not confirmed live rendering):
- **"Maamigili holiday package"** — Vilu's own domain appears organically (currently the legacy `.com`, not `.net` — see §14). The one query where Vilu shows up on its own merits, not just inside an OTA listing.
- **"Maamigili accommodation"** — Vilu named directly in result summaries alongside White Sand Inn and Koimala.
- **"Maamigili whale shark" / "whale shark Maamigili"** — dominated by informational guides and, notably, two same-island competitors' own content pages (Koimala's "Maamigili Island" page, Oren's about-us page) — a real, closable content gap: Vilu has no equivalent page.
- **"South Ari whale shark hotel/accommodation," "whale shark Maldives hotel/stay," "where to stay for whale sharks"** — dominated by large resorts (LUX*, Conrad, Outrigger) and, on one query, explicit framing naming **Dhigurah** as "built for whale-shark travellers" ahead of Maamigili as a secondary mention. Not realistically closable by content alone — this category is resort- and OTA-saturated, not a same-island-competitor gap.

## 7. Maamigili competitor findings (private intelligence — not for public use)

Six same-island/near-island properties researched (Whale Shark Inn, Koimala, Shamar, White Sand Inn, Dravida, La Cabana). Ranked by verified whale-shark/Maamigili self-branding strength:

1. **Whale Shark Inn** — the term is literally the business name (own site currently unreachable, so live copy unverified).
2. **Koimala** — the most fully realized, currently-live self-branding: tagline "The island the whale sharks never leave," a dedicated page framing SAMPA as a "world's only documented year-round residence."
3. **White Sand Inn** — live site explicitly calls Maamigili the "Whale Shark Capital of the Maldives" in body copy.
4. **La Cabana** — body-copy-level whale-shark/South-Ari specialization (via partner-site content; own site unreachable this pass).
5. **Shamar** — whale-shark wording found only in third-party directory copy (aMaldives), not confirmed self-authored.
6. **Dravida** — no whale-shark branding found anywhere, self-authored or otherwise.

**Vilu's position — corrected finding (2026-09-08), distinguishing exactly where the gap does and does not exist**:

- **A. Public WEBSITE copy** — **not a gap.** Verified directly against `vilu-website.html`: the homepage meta description, hero subtitle ("Whale sharks, manta rays and a warm island home."), hero display line ("Whale sharks."), every one of the 9 package hooks, and a dedicated "South Ari is known for whale sharks..." section (citing Harvey-Carroll et al. directly) all already carry this language, on top of the standalone `whale-shark-snorkeling.html` page. Vilu's website is not behind any of the 6 competitors on this dimension — if anything it has more dedicated, better-sourced whale-shark content than most of them.
- **B. GBP self-authored description** — **genuinely UNKNOWN**, since the live field could not be read this phase (§1). Not confirmed missing; not confirmed present either.
- **C. Local entity/schema copy** — **not a gap**, but not yet optimal either: the site's JSON-LD `description` field ("Boutique guesthouse in Maamigili, South Ari Atoll, Maldives.") is accurate but doesn't itself name whale sharks, even though the visible meta description one line above it does. A safe, optional, owner-gated future tweak (§15), not an urgent gap.
- **D. Maps/local-search snippets** — **UNKNOWN**, not independently confirmed this phase beyond the Google Hotels title snippet already recorded in §1.
- **E. Homepage copy specifically (the "Who We Are" section)** — **a real, narrow, accurately-described gap**: its body copy reads "Holiday planning, marine experiences and local knowledge — with our own six-room home in Maamigili when you need somewhere to stay" — generic "marine experiences" rather than naming whale sharks, even though it sits one screen below a hero that already does. Minor, and arguably a deliberate variety-of-phrasing choice rather than an omission, given how saturated the rest of the page is.

**The single genuinely-supported finding from the original research** (the GBP/social-bio-specific one, from the earlier direct Facebook-page fetch) is: **Vilu's GBP/local self-description does not yet clearly associate the property with Maamigili + South Ari + whale sharks** — this is the corrected, precise version of what was previously overstated as "no whale shark copy anywhere." It cannot yet be confirmed true or false for the GBP field itself (B, above) without dashboard access; it IS confirmed true for the Facebook bio specifically, per the earlier direct fetch.

**Note on Koimala's exact wording** ("the whale sharks never leave," "world's only documented year-round residence") — this edges toward the "non-migratory"/absolute framing this project has explicitly decided NOT to use for Vilu (see `VILU_DECISIONS.md`'s residency-wording correction). Do not adopt this phrasing even though a competitor uses it; Vilu's own standard stays "year-long residency of individuals," per the peer-reviewed source's actual wording.

## 8. Vilu local-search gaps

1. **Corrected (2026-09-08)**: not "no whale shark language in Vilu's own copy" (false — see §7) but specifically: Vilu's GBP self-description (unconfirmed either way) and Facebook bio (confirmed) do not yet clearly associate the property with Maamigili + South Ari + whale sharks. This is a *local-entity-branding* gap, not a website-content gap — the website itself needs no strengthening here.
2. No dedicated "About Maamigili / whale sharks" content page comparable to what Koimala and Oren already have ranking (§6) — the Why Maamigili draft page (from the prior session) directly addresses this once published.
3. Legacy `.com` site still live with zero forward-reference to `.net`, and appears to be what several OTA/search surfaces treat as the "real" site (§14) — a real authority-splitting risk, already documented in prior phases but reconfirmed with a sharper edge this pass (this may extend to GBP's own website field, unconfirmed).
4. Zero Local Pack presence observed in the most recent live-SERP check (prior session) for whale-shark/local-island queries.

## 9. Photo/media gaps (prioritized capture list for the owner — no images uploaded)

**Confirmed 2026-09-08 (§31.12-14)**: a real photo inventory exists (exterior, room interiors, corridor, dining — some individual photos with thousands of views), plus a real cover photo and a real logo. **Confirmed gap**: no marine-life/whale-shark/snorkeling photo was found anywhere in the visible inventory — the prioritized list below (drafted before verification) is now a confirmed real gap, not a hypothetical one. Prioritized list of what a strong Maamigili/whale-shark-associated listing should add, in order:
1. Exterior + signage (establishes real, findable local presence)
2. A genuine guest-perspective whale-shark/manta snorkeling photo, if Vilu has one from an actual booked excursion (never stock, never another location)
3. Maamigili Beyru or the general reef/water context, if authentically Vilu's own
4. Rooms (interior, already exists per the website's own image library — reuse, don't reshoot unnecessarily)
5. Breakfast/dining
6. Airport/arrival context (Villa International Airport signage or the short walk from it) — supports the airport-access story
7. Guesthouse atmosphere / staff (with consent) / local village context
8. A package-experience sequence (arrival → room → excursion → departure), if ever produced as a set

**Do not upload stock imagery. Do not upload or imply wildlife encounters happened at the property itself** (whale sharks/mantas are offshore/at Beyru, not in front of the guesthouse) — mirrors the standing no-misleading-imagery rule already in `VILU_PROTECTED_CONTRACTS.md`.

## 10. Review strategy (compliant, for owner implementation — no automation built, no reviews solicited by this task)

- **Timing**: request at checkout or within 24–48h post-stay, when the experience is freshest — not immediately at check-in.
- **Channel**: a direct Google review link (GBP's own short review link) via WhatsApp/email follow-up, optionally a small printed QR code at checkout.
- **Wording principle**: ask for an honest review generally — never specify a star rating, never ask only guests who seemed happy, never offer a discount/incentive tied to leaving a review (violates Google policy).
- **Multilingual**: keep the ask itself short and neutral so it translates cleanly (e.g., "If you enjoyed your stay, a Google review helps other travelers find us" — translatable to the site's existing 11 locales without new claims).
- **Staff process**: one person owns sending the post-stay message consistently, so it doesn't get forgotten for some guests and not others (a consistency gap looks worse to Google's spam systems than a lower review velocity).
- **Negative-review handling**: respond promptly, acknowledge specifics, offer to resolve offline (email/phone) — never argue publicly, never dispute a review's legitimacy without genuine grounds.
- **Review-topic discovery**: once real reviews accumulate mentioning whale sharks/Maamigili Beyru/the airport, that's organic, real evidence Google weighs — not something to manufacture, just something to notice and not discourage.

## 11. Review-response audit

**Corrected 2026-09-08 (§31.17)**: the real unanswered-review count is far larger than the 4 first identified — the most recent owner reply on record is 47 weeks old. The 4 most recent unanswered reviews are Ráchel Lokvencová (3 days old), Nela Vohradská, Jiří Michalík, and David Dang (all ~4 weeks old) — all 5-star with no negative content requiring damage control beyond one soft staff-conduct comment in Ráchel's review (see §32c). **Drafted, not posted (§32c)**: individual replies for these 4, following the principles below. Clearing the full backlog is a larger operational decision left to the owner. **Principles applied**: personalize each response (reference something specific from the actual review, not a template swapped verbatim); never mechanically insert "whale shark"/"Maamigili"/"South Ari" into every single response — only where the guest's own review actually mentioned something relevant, so it reads as genuine, not SEO-stuffed; handle any future negative feedback per §10's principle.

## 12. GBP post strategy (framework only — not published)

**Confirmed 2026-09-08 (§31.18)**: the Posts feature is active and available on this listing ("No posts yet," with a working "Add post" action) — eligibility is no longer in question. Sustainable real-topic framework, no fake urgency/scarcity, no guaranteed-sighting claims:
- Seasonal note: South Ari whale sharks are seen year-round; manta season at Maamigili Beyru runs roughly February–April (factual, already-sourced on-site)
- A real package spotlight (linking to Holiday Packages)
- Practical guest information (transport options, what to expect on arrival)
- Local-island context (respecting Bikini Beach norms, etc. — already established site content, reusable)

## 13. Services/products recommendation

**Recommend against listing individual excursion prices as GBP Products** — this would create exactly the public cheap-excursion catalogue the package-first strategy exists to avoid, and would expose pricing outside the already-controlled package/enquiry structure. **Safe candidates, if GBP's Services/Products feature is confirmed available and appropriate**: "Holiday Packages" (linking to the page, no price breakdown needed in the GBP feature itself), "Accommodation," and a general "Snorkeling / wildlife experience — enquire" line with no price attached. Do not implement without owner confirmation this feature is available and appropriate for this listing type.

## 14. NAP inconsistencies

**Resolved 2026-09-08 (§31.5)**: GBP's own website field is confirmed `https://viluresidence.net/` — the biggest open risk this section previously flagged (that GBP might still point at the legacy `.com`) did not materialize. No domain action needed on this front.

- **Facebook page title indexed as "Vilu residence maldives"** (lowercase "residence," "Maldives" appended) — a real, minor name-format deviation from the canonical "Vilu Residence." Confirm and correct the Page name field directly if this is genuinely wrong (not just how Facebook renders it in search).
- **Instagram display name "Vilu Residence Maldives"** — same minor "Maldives" append; its **website link field correctly points to `viluresidence.net`** — no discrepancy on the field that matters most.
- **Legacy `viluresidence.com`**: still live, phone/email match ground truth exactly, but contains **zero link, canonical tag, or mention of `viluresidence.net` anywhere** — no cross-signal between the two live properties. Internally inconsistent address formatting was also found on the `.com` site itself (two different street-address renderings on two of its own pages) — a `.com`-internal issue, not a `.net` one, and out of scope to fix (`.com` is a protected, do-not-touch system per standing rules).
- **Agoda title**: "Vilu Residence at Maamigili Guest House" — an SEO-lengthened OTA-generated variant, not necessarily an error, but worth noting.
- **Google Hotels**: address format "Rahdhebai magu, Maamigili, Alif Dhaal Atoll, 00100" matches the site's own schema exactly (see §15) — no discrepancy.
- **Six OTA phone/website fields could not be verified by automated fetch this pass** (Booking, Expedia, TripAdvisor, Agoda, Hotels.com direct pages all blocked non-browser fetches) — recommend a manual, logged-out browser pass to confirm none of them point their "website" field at the legacy `.com`.

**No blind overwrite of any OTA data was performed or recommended** — every item above is a recorded discrepancy for the owner's own review and correction inside each platform's own dashboard.

**Correction (2026-09-08, owner correction)**: the `.com`/`.net` findings above (and in §19) are **investigation items only** — they describe what was observed, not a remediation recommendation. Nothing in this document proposes redirecting, migrating, deindexing, or DNS-changing `.com`, and no domain action should be taken in Phase 34 without a separate, explicit owner authorization. The concrete next investigation steps, none yet performed (dashboard/authenticated access required for most):

1. ~~Verify directly what URL GBP's own "website" field currently points to (`.com` or `.net`).~~ **Done 2026-09-08 — confirmed `.net` (§31.5).**
2. Verify each OTA's "website" field (Booking, Expedia, TripAdvisor, Agoda, Hotels.com) the same way — automated fetch was blocked this pass (§14). **Still open.**
3. Once authenticated GSC access to the legacy `.com` property is available, inspect its historical Search Console data directly rather than inferring from public search snippets.
4. Identify specific old, still-potentially-ranking `.com` URLs (e.g., `/transportation.php`, confirmed previously per `docs/seo/COMPETITOR_GAPS.md` to rank for "Maamigili speedboat transportation") and record which ones.
5. Quantify `.com`'s remaining organic impressions/clicks (once GSC access allows) and any external backlinks it holds, so the real equity at stake is known, not assumed.
6. Map the authority/equity risk of any future action (or inaction) based on 1–5 — this mapping itself is the deliverable of the investigation, not a trigger to act.

This checklist is diagnostic. No fix, redirect, or migration should be inferred from it or from §14/§19 until the owner separately authorizes a specific domain action.

## 15. Entity/schema findings (verified directly against the codebase this pass)

Read `vilu-website.html`'s own JSON-LD directly (not assumed from memory):
- `LodgingBusiness` schema: correct `address` (Maamigili, South Ari Atoll, MV, postal code 00100 — matches the Google Hotels snippet exactly), correct `geo` coordinates, correct `telephone`/`email`, `priceRange`, real images.
- `Organization` schema shares the same `@id` (`#organization`) as `LodgingBusiness` — Phase 37's entity-merge work confirmed still intact.
- `sameAs` includes Instagram, Facebook, TripAdvisor, and the **exact same Google Maps CID link** (`maps.google.com/?cid=8624726302398144856`) used in the site's own visible footer "Find us on Google Maps" link — a single, consistent Maps entity reference, no fragmentation found on-site.
- Canonical `.net` identity is fully preserved throughout — no `.com` reference anywhere in the current schema.
- **No changes made** — existing schema is accurate and internally consistent; per the standing instruction not to unnecessarily rewrite correct schema, none was touched.

One minor, optional, low-risk future candidate (not implemented, would need the same owner sign-off as the GBP description since it's a public-facing text change): the JSON-LD `description` field currently reads "Boutique guesthouse in Maamigili, South Ari Atoll, Maldives." with no whale-shark mention — could mirror the GBP description proposal in §5 for consistency, but this is a website change, separate from and independent of the GBP change.

## 16. Maamigili local-authority improvements

Already strong: the site's own schema and footer consistently name Maamigili/South Ari Atoll, matching the official Google Hotels address record exactly (§15). The main remaining lever is off-site (GBP description, same-island competitor gap in §7-8) rather than on-site — the on-site entity work from Phase 37 already did the structural part correctly.

## 17. Whale-shark local-authority improvements

Per the private Dominance Strategy doc (prior session) and this pass's competitor findings: the two highest-leverage, safe moves are (a) the GBP description addition in §5, once dashboard access confirms it's actually needed, and (b) publishing the already-drafted Why Maamigili page, which directly targets the exact content gap found in §6/§8 (Koimala/Oren's own "Maamigili whale shark" pages currently ranking where Vilu has nothing). **Reaffirmed constraint, per this task's own instruction**: Maamigili Beyru has verified PADI-sourced whale-shark relevance (already corrected in the draft page) and should not be re-separated from whale-shark context — but not every Maamigili reef/site should be conflated into one location; the draft page already keeps this distinction correctly.

## 18. Citation opportunities

**HIGH VALUE**: Visit Maldives / MMPRC membership directory (official government tourism board, real registration process); National Hotel & Guesthouse Association of Maldives (NHGAM, real industry body, membership-based). **MEDIUM VALUE**: ZuBlu (partner/pitch-based, niche dive/whale-shark fit); MaldivesNomad.com (confirmed real editorial guide covering Maamigili specifically, currently does NOT list Vilu — a genuine, legitimate outreach candidate, no self-submit form found, would need a direct pitch); Maamigili Council's own local government portal. **LOW VALUE / REJECT**: a confirmed white-label reseller/scraper network (smartours.com, sun-ski.com, islandrentalsvacation.com, fvrentals.com, bedroomvillas.com and similar) sharing one identical templated listing and property ID across dozens of cosmetic domains — this is a link-farm pattern, explicitly not pursued; auto-populated aggregators with no real submission control (HotelsOne, PlanetOfHotels, etc.) are likewise not worth active outreach.

## 19. Maps/entity fragmentation findings

None found on Vilu's own side — the single consistent CID reference (§15) rules out on-site fragmentation, and GBP's own website field is now confirmed pointing at `.net`, not `.com` (§31.5) — the largest fragmentation risk this section flagged did not materialize. The remaining, smaller fragmentation risk is external and unresolved: the live, un-cross-linked `.com` site (§14) and the six OTA website fields still unverified by automated means. **This is an observation, not a remediation recommendation** — see the six-point investigation checklist added to §14. No merge/removal/redirect/DNS action was taken or is recommended, and none should be inferred from this finding; any domain action requires a separate, explicit owner authorization per the standing `.com` protection rule.

## 20. Conversion findings

Package-first CTA hierarchy (Explore Holiday Packages → Check Availability) remains the standing rule and was not altered. GBP's own "website" and "booking" link fields (once confirmed) should point to the homepage or Holiday Packages page on `.net`, never to a cheap-excursion catalogue — no such catalogue exists on-site to accidentally link to, so no risk found here beyond the domain question already flagged in §14/§19.

## 21. Tracking/KPIs

Real, available-data KPIs only (no fabricated baseline): GBP website clicks, calls, direction requests, and profile views (all read directly from the GBP Insights dashboard once accessible); branded vs. discovery search-term split (same source); Local Pack appearance for the query set in §6, re-checked periodically via live SERP (not WebSearch proxy) as was done in the prior session; review count/velocity and owner-response rate (GBP dashboard); package enquiries attributable to a local/Maps-originated session (existing GA4 attribution setup, no new tracking needed — matches `VILU_PROTECTED_CONTRACTS.md`'s analytics contract).

## 21a. GBP owner review checklist (added 2026-09-08, owner correction)

The exact 20 fields the owner should check directly in the authenticated GBP dashboard before any Phase 34 decision is finalized. **Do not guess any field** — every row below is UNKNOWN in this document until the owner confirms it directly.

1. Business name (exact current text of the name field itself, not a Google Hotels auto-title)
2. Primary category (exact current value)
3. Secondary categories (exact current list, if any)
4. Description (exact current text of the GBP description field)
5. Website URL (exact current value — `.net` or `.com`)
6. Phone number (exact current value)
7. Address (exact current value, compared against §15's schema)
8. Map pin location (exact current pin placement, compared against the CID in §15)
9. Check-in / check-out times (exact current values)
10. Amenities (exact current list)
11. Services (exact current list, if the feature is enabled)
12. Photos (current count and general content, by category)
13. Cover photo (what it currently is)
14. Logo (whether one is set, and what it is)
15. Review count (exact current number)
16. Rating (exact current average, not an OTA rating)
17. Unanswered reviews (exact current count, if any)
18. Posts (whether the feature is active, and what if anything is currently posted)
19. Q&A (current questions/answers, if any exist)
20. Any warnings, suspension notices, or verification requests currently shown on the profile

## 21b. Reaffirmation of standing rules (added 2026-09-08)

Nothing in this Phase 34 document changes, contradicts, or supersedes two permanently protected decisions:

- **Maamigili-first positioning** (`VILU_DECISIONS.md`): Maamigili remains the primary destination position in every recommendation above, including the proposed GBP description (§5), which leads with Maamigili and South Ari, never frames Maamigili as an alternative to Dhigurah, and treats competitor names (§7) strictly as private search-capture intelligence, never for public use.
- **Vilu Voyager** (`VILU_IDEA_BACKLOG.md`, `VILU_ROADMAP.md`, `VILU_MASTER_CONTEXT.md`, `VILU_COMPLETION_MATRIX.md` Phase 45): nothing in this document's GBP Services/Products recommendation (§13) or Posts framework (§12) implies or proposes a public excursion marketplace or a separate operating brand — Vilu Voyager remains a post-arrival Guest Guide PDF for already-booked guests, entirely outside this phase's scope.

## 31. Authenticated GBP verification (2026-09-08) — real, direct dashboard state, answers §21a in full

Read directly from `business.google.com` (Business Profile Manager) and the linked Google Search "manage your business" panel, viewing only — no field was edited or saved.

| # | Field | Verified value |
|---|---|---|
| 1 | Business name | **"Vilu Residence - Best Guesthouse in Maamigili Island"** — confirmed as the literal `Business name` field in the editor itself, not a Google Hotels auto-title as §1/§3 previously left open. This resolves the ambiguity in §3: it IS the real name field, so the policy-risk question in Task 2 is live, not hypothetical. |
| 2 | Primary category | **"Hotel"** — confirmed as the literal `Business category` field. Not "Guest house." This matches the owner's stated historical "3-star hotel" observation exactly and resolves §4's open question. |
| 3 | Secondary categories | **None set.** The editor shows one `Primary category*` field and an "Add another category" action with nothing added. |
| 4 | Business description | **No description field exists in this listing's editor.** The full "Business information" dialog (tabs: About, Contact, Location, Hours, More) was read end-to-end — it has no free-text description field anywhere. This is a known real Google Business Profile behavior for the **Hotel** category: hotel-class profiles generally don't expose the classic self-authored "description" field the way non-hotel categories (including Guest House) do. This resolves §5/§7-B: the finding is not "description is empty" but "no description field is currently available to fill," which is a direct consequence of the Hotel category choice in #2. |
| 5 | Website URL | **`https://viluresidence.net/`** — confirmed correct. This resolves the biggest open risk in §14/§19: GBP itself was never pointing at the legacy `.com`. |
| 6 | Phone | **990-3339** |
| 7 | Address | **Rahdhebai mahu, A.dh maamigili 00100** — matches the site's own JSON-LD address exactly (§15). |
| 8 | Map pin | Single pin, correctly placed in Maamigili (verified against the surrounding real landmarks — Epazote Restaurant, Koimala Maldives, Fisherman's Casting, Bonthi Beach — all real, nearby, correctly plotted). Consistent with the one CID already used sitewide (§15) — no fragmentation. |
| 9 | Check-in / check-out | **14:00 / 12:00** |
| 10 | Amenities (Popular amenities) | Breakfast ✓ (Free), Wi-Fi ✓ (Free), Airport shuttle ✓ (Free), Bicycle hire ✓ (Free). Parking, Spa, Pools, Hot tub, Fitness centre, Pets: not offered (correctly unchecked). |
| 11 | Services | Currency exchange ✓, Full-service laundry ✓, Self-service laundry ✓, Wake-up calls ✓. Front desk, Baggage storage, Concierge, Grocery shop, Lift, Gift shop, Social hour: not offered (correctly unchecked — consistent with a small owner-run guesthouse without a staffed front desk). |
| — | Activities (a related "Hotel details" category, not in the original 20-item list but read while verifying #10-11) | Scuba ✓, Snorkelling ✓, Watercraft rental ✓, Water skiing ✓ — all marked as offered. **Flagged, not corrected**: Snorkelling is clearly accurate (packages include this); Scuba/Watercraft rental/Water skiing are not established anywhere else in Vilu's own materials as services Vilu itself operates, and no dive-centre/watersports business exists per standing rules. This may be an inherited default from category setup rather than a deliberate claim. See §23 — owner should confirm accuracy before changing. |
| 12 | Photos | Real inventory exists: entrance/exterior, room interiors (several angles), corridor, dining area — individual photos show meaningful view counts (257 to 8.5k views), confirming real public traffic. **No marine-life/whale-shark/snorkeling photo found in the visible inventory** — confirms the §9 gap (no image evidence of Vilu's own guests' wildlife experiences) is real, not just theoretical. |
| 13 | Cover photo | A real exterior/entrance photo is set as the cover image (not a placeholder). |
| 14 | Logo | A real logo image is set: "Vilu Residence · @maamigili" palm-tree wordmark graphic (not a placeholder). |
| 15 | Review count | **81** |
| 16 | Rating | **5.0** — confirms the figure §2 flagged as a stale, unconfirmed historical snapshot; now directly re-verified as still accurate. |
| 17 | Unanswered reviews | **Corrected 2026-09-08 (re-verified) — far more than 4.** The prior briefing figure of "4" undercounted this significantly. The most recent owner reply visible in the "Replied" tab is **47 weeks old** ("Thank you Fabio!") — essentially every review from the last ~47 weeks is unanswered, not just the 4 most recent. One pass through the "Unreplied" tab (Newest-first) found at least 15 distinct unreplied reviewers before reaching 23 weeks old, with more beyond that not exhaustively counted — a real operational backlog, not a small pending queue. **Also corrected**: "Veronika Sandholzová," named in the prior briefing as the 4th-most-recent unreplied review, does not appear in that position or anywhere found in this pass. The actual 4 most recent unreplied reviews, in order, are Ráchel Lokvencová (3 days old, mentions a snorkeling excursion and "the guide from the hotel"), Nela Vohradská, Jiří Michalík, and **David Dang** (all ~4 weeks old). This looks like a misidentification in the earlier audit — flagged rather than silently corrected, since it could not be independently confirmed either way. All four are positive — none require damage-control language, just a reply. |
| 18 | Posts | **None** — "No posts yet." The feature is available (an "Add post" action exists) but unused. |
| 19 | Q&A | **None** — "No questions are currently available." |
| 20 | Warnings / verification notices | **None found.** The listing shows a "Verified" badge, "0 Google updates" pending, and the Business Profile settings menu (People and access / Advanced settings / Remove profile / Linked accounts) shows no suspension or policy-warning banner anywhere in the flow. |

**Also newly observed, not in the original 20-item list**: linked social profiles are `x.com/maldivesvilu`, `facebook.com/ViluResidence/`, `instagram.com/vilu_residence/`; service areas are set broadly (Ari Atoll, Maamigili, Maldive Islands, Alif Dhaal Atoll, Alifu Dhaalu Atoll, Maldives) rather than Maamigili alone; opening date is recorded as 1 November 2023; a standalone Google-rendered SERP snippet for the Instagram profile shows its bio already reads *"...Near Whale Shark Point..."* — meaning Instagram's bio, unlike the Facebook bio, already carries whale-shark association (a positive fact §7/§8's Facebook-only finding didn't have visibility into).

## 32. Owner-decision checkpoint (2026-09-08) — business name, Activities, review replies, marine media

Prepared per the owner's explicit request. **Nothing in this section was saved, published, or applied — every item is a draft awaiting approval.**

### 32a. Business name — recommendation

**RECOMMENDED: CHANGE TO "VILU RESIDENCE"**

- **Current policy risk**: confirmed real (§31.1, §3) — "- Best Guesthouse in Maamigili Island" is exactly the kind of added marketing/keyword text Google's naming policy prohibits.
- **Effect on Maps/search identity**: removing the suffix will likely reduce the keyword-rich text currently shown in Maps/Search snippets for phrases like "best guesthouse Maamigili" — a real, if modest, visibility cost.
- **Real-world branding/signage check**: the GBP's own logo image (§31.13-14) reads simply **"Vilu Residence · @maamigili"** — the plain name, no marketing suffix. The confirmed real branding already matches "Vilu Residence" alone; the current GBP name field has drifted from the actual brand identity, not the other way around.
- **Risk of removing the suffix beyond losing keyword text**: none identified beyond that visibility cost. The larger risk runs the other way — a name field that violates policy is not a stable SEO asset; Google can algorithmically flag, auto-edit, or require re-verification of profiles with non-compliant names at any time, which would remove the listing's visibility entirely and unpredictably, versus a controlled, voluntary fix now with a known, bounded cost.
- **Not executed.** Awaiting owner approval per Task 1's explicit instruction.

### 32b. Activities accuracy — classification

Per Task 2's instruction not to assume a partner-arranged activity means Vilu "offers" it, and without access to Vilu's actual booking/partner records, **all three are classified OWNER CONFIRMATION REQUIRED** — none can be responsibly marked KEEP (no positive evidence found anywhere in Vilu's own site, packages, or reviews that these are real, arranged services) or TURN OFF (no positive evidence they're wrong either, and a small guesthouse arranging watersports through local partners is plausible and not inherently misleading, the way Nela's and David's reviews confirm staff "effortlessly arrange all trips, from whale sharks and manta rays to dolphin watching").

- **Scuba**: OWNER CONFIRMATION REQUIRED — plausible via a local PADI partner (same category of arrangement as the whale-shark/manta trips guests describe), but not documented anywhere in Vilu's own packages, site content, or Vilu Voyager materials.
- **Watercraft rental**: OWNER CONFIRMATION REQUIRED — marked "offered," not "free" (§31, Activities row) — same reasoning as Scuba.
- **Water skiing**: OWNER CONFIRMATION REQUIRED — the least substantiated of the three; nothing in any established Vilu material (site, packages, reviews, Vilu Voyager scope) references water skiing at all. Worth the owner's direct attention first.

None of the three checkboxes were changed.

### 32c. Four review-reply drafts (NOT posted — awaiting approval)

Per §31.17's correction, the real 4th-most-recent unreplied review is David Dang's, not "Veronika Sandholzová's" (which could not be located — see §31.17). Full review text was read directly for all four before drafting.

**1. Ráchel Lokvencová** (3 days ago, Czech: *"Úžasné ubytování na lokálním ostrově. V rámci pobytu jsem měla i několik šnorchlovacích výletů - průvodce z hotelu byl ale možná příliš pozorný k ženám. Ubytování je čisté, pohodlné a všichni jsou moc ochotni."* — "Amazing accommodation on a local island. I also had several snorkeling trips during my stay — though the guide from the hotel was perhaps a bit too attentive toward women. The accommodation is clean, comfortable, and everyone is very helpful."):

> Thank you so much, Ráchel! We're really glad you enjoyed your stay and the snorkeling trips during your time with us. We also appreciate you mentioning the guide's manner during the excursions — that's genuinely useful feedback and we'll follow up with our team on it directly. Thank you for staying with us on Maamigili, and we hope to welcome you back.

**Flagged separately from the reply itself, for the owner's direct attention**: this review's mention that a guide was "perhaps a bit too attentive to women" is a real, if softly worded, staff-conduct comment that deserves internal follow-up independent of the public reply — not something this document can resolve, only surface.

**2. Nela Vohradská** (4 weeks ago: *"...Our stay was top-tier in every way... The staff was available 24/7... they can effortlessly arrange all trips, from whale sharks and manta rays to dolphin watching. The breakfasts were delicious... Bikini Beach is only 200 meters away... practically empty... We will definitely come back."*):

> Thank you, Nela! It means a lot to hear the whole stay felt seamless from start to finish. We're so glad the team could help arrange the whale shark, manta ray, and dolphin watching trips, and that you had Bikini Beach almost to yourselves. We'd love to have you back on Maamigili anytime!

**3. Jiří Michalík** (4 weeks ago: *"Best experience on Maledives so far! I would definitely recommend! P.S. Rahul and Def are awesome!"*):

> Thank you, Jiří! We'll be sure to pass this along to Rahul and Def — they'll be thrilled to hear it. Really glad we could make this your best experience in the Maldives so far. Hope to see you again on Maamigili!

**4. David Dang** (4 weeks ago: *"If you want to experience the postcard-perfect beauty of the Maldives without paying private-island resort prices, Residence Maamigili... is an exceptional choice. It offers a warm, authentic local vibe combined with easy access to some of the world's best marine life. We love you DEEEEF and RAHUL ❤️"*):

> Thank you, David! We love hearing that Maamigili gave you that authentic, local-island side of the Maldives. Deeef and Rahul will be so happy to read this — thank you for the kind words about them. Hope to welcome you and your friends back again soon!

None of these were posted. Each references only what its guest actually wrote; no detail was invented, no AI/tool mention, no private information, no repeated "Maamigili whale shark South Ari" keyword insertion — only Nela's naturally mentions whale sharks/mantas because she wrote about them herself.

### 32d. Marine media priority plan (plan only — nothing uploaded)

Consolidated, short version of §9's fuller list, ordered by leverage:

1. A genuine guest-perspective whale-shark or manta-ray photo/video from an actual Vilu-arranged excursion (never stock; never framed as happening at the property itself).
2. A Maamigili Beyru or general reef/snorkeling-context photo, authentically Vilu's own.
3. A departure/return moment at the jetty with snorkeling gear — bridges "Vilu Residence" and the marine experience without implying wildlife is at the guesthouse.
4. Guest-submitted review photos already showing marine content (Ráchel's review alone included 23 photos, §31.17) — with the guest's permission, not assumed.
5. A short, factually captioned video clip of a real snorkeling trip, if one is ever produced.

Explicitly not pursued: stock imagery, any implication whale sharks are at the property, and anything that reframes the listing as an excursion-company profile rather than an accommodation with arranged marine experiences.

## 33. Approved GBP changes applied (2026-09-08) — owner-authorized live edits

Per the owner's explicit approval, the following live GBP changes were made this pass — all others (Activities, category, website, media) were explicitly left untouched per the same approval.

**33a. Business name — applied and confirmed live.**
- Field opened in the Business Profile editor, selected in full, replaced with exactly `Vilu Residence` — no suffix, no keyword text (verified character-for-character before saving).
- On save, Google returned: *"Your edit is pending. It usually takes up to 10 minutes to be reviewed"* — no warning, no verification re-trigger, no suspension/policy notice.
- **Re-verified minutes later**: the editor's own "About" tab shows the name field as `Vilu Residence` with no pending banner remaining. The **public, live Google Search knowledge panel** (a fresh, unauthenticated-view reload of the same search query) now shows: name "Vilu Residence", 5.0★, 81 Google reviews, "3-star hotel" — confirming the change is not just applied internally but **already publicly live**, faster than the 10-minute estimate.
- **GBP NAME UPDATE: LIVE** (not merely pending — directly observed on the public panel).

**33b. Category — confirmed unchanged.** Verified in the same editor pass: primary category is still `Hotel`, no secondary category added. No edit made, per approval.

**33c. Website — confirmed unchanged.** Verified in the Contact tab: `https://viluresidence.net/`, untouched. No edit made, per approval.

**33d. Activities — confirmed untouched.** Scuba, Watercraft rental, and Water skiing were not opened or toggled this pass. Status remains OWNER CONFIRMATION REQUIRED (§32b) — explicitly deferred by the owner's own Task 4 instruction, not a blocker.

**33e. Ten review replies published (owner-approved, controlled batch)** — each opened, read in full, and replied to individually before publishing; none templated, none mentioning AI/staff-discipline/private information:

1. **Ráchel Lokvencová** — replied. *(Full review noted a guide being "perhaps a bit too attentive to women" — see §33f below; the public reply itself does not reference this.)*
2. **Nela Vohradská** — replied.
3. **Jiří Michalík** — replied.
4. **David Dang** — replied. (This is the real 4th-most-recent unreplied review — see §31.17's correction of "Veronika Sandholzová.")
5. **Jakub Vetchy** — replied.
6. **Sofie Kurucová** — replied.
7. **Veronika Sandholzová** — replied. (Located further down the list than originally expected — real, not a phantom review; the earlier "could not be located" note in §31.17/§32c is superseded by finding and replying to her directly here.)
8. **Jan Hromek** — replied.
9. **Štěpán Albert** — replied.
10. **Michaela Halová** — replied.

All ten replies are now live and publicly visible. Verified via the "Unreplied" tab: each reviewer's card disappeared from that list immediately after their reply was submitted, confirming the publish succeeded for all ten.

**33f. Staff-conduct flag retained internally, not exposed publicly.** Ráchel Lokvencová's review states the guide during her snorkeling excursion was "perhaps a bit too attentive to women." The public reply thanks her for the feedback and states the team will follow up internally — it does not name the guide, describe any disciplinary process, or otherwise expose internal details. **This flag is retained here, in this private, non-public document, for the owner's own follow-up** — it is not resolved by this task and requires direct owner/staff action outside GBP.

**33g. Remaining review backlog.** Beyond these 10, the backlog identified in §31.17 continues — the next in the queue at the time of this pass were Josef Šindelář and Radim Horák, with the full backlog stretching back at least 23 weeks (last owner reply on record before this pass: 47 weeks old). Per the owner's explicit instruction not to clear the entire backlog recklessly in one pass, this was intentionally left for a future, separately-authorized batch.

**33h. Marine media — untouched.** No files were uploaded; no Vilu-owned/authorized asset was supplied for this task. The plan in §32d remains future work.

## 22. Exact changes implemented this phase

**Updated 2026-09-08 (owner-approved changes applied, §33).** The first two authenticated passes were view-only. This third pass had explicit, itemized owner approval and made real, live changes: **the GBP business name was changed to "Vilu Residence" (confirmed live, §33a)**, and **10 review replies were published (§33e)**. Everything not explicitly approved stayed untouched: category ("Hotel"), website (`viluresidence.net`), the three Activities checkboxes, and marine media — each verified unchanged, not merely left alone by omission. **No website/code change was implemented** — the one candidate identified (§15's optional JSON-LD description tweak) remains a proposal, not applied, since it was outside this task's approval scope.

## 23. Exact owner decisions required

**Updated 2026-09-08 (post-approval)** — items resolved by direct authenticated verification (§31) or applied per explicit approval (§33) are marked done; the list below is what genuinely remains, and none of it blocks Phase 34's closure (§28).

1. ~~GBP business name~~ **Done — changed to "Vilu Residence," confirmed live on the public panel (§33a).**
2. ~~Verify current GBP category, photos, review count/rating, Posts, Q&A, attributes directly~~ **Done (§31).** Category confirmed unchanged at "Hotel" (§33b); description has no field to fill under the current category (§5).
3. **Decide whether the proposed GBP description (§5) should wait for a future field, or whether switching category to unlock one is worth the positioning trade-off (§4)** — not urgent; the current state (Hotel, no description field) is stable and policy-compliant.
4. ~~Confirm GBP's own website field points to `viluresidence.net`, not `.com`~~ **Done — confirmed unchanged (§33c).**
5. **Correct the Facebook page name** if "Vilu residence maldives" is genuinely the Page name field, not just a display artifact (§14) — still unverified, outside GBP itself.
6. **Confirm whether Scuba, Watercraft rental, and Water skiing are accurate as "offered"** in the Hotel details → Activities section — left untouched per explicit instruction (§33d); still OWNER CONFIRMATION REQUIRED whenever the owner is ready.
7. ~~Approve, edit, or reject the 10 review replies~~ **Done — all 10 approved and published (§33e).** **Still open, separately**: follow up internally on Ráchel Lokvencová's comment about a guide being "perhaps a bit too attentive to women" (§33f) — a real staff-conduct note, independent of the public reply, requiring direct owner/staff action outside GBP. **Also still open**: the review-reply backlog continues well beyond these 10 (§33g) — clearing more of it is a future, separately-authorized batch.
8. **Decide on the marine-media capture plan** (§32d) — no images uploaded, plan only, left untouched per explicit instruction (§33h).
9. **Decide whether to pursue Visit Maldives/MMPRC and NHGAM membership** (§18) — both are real but require registration/dues, an owner-level business decision.
10. **Decide whether to pitch MaldivesNomad.com editorially** (§18) — a legitimate, currently-open opportunity.
11. **Decide whether/when to publish the Why Maamigili page** (already drafted, awaiting your review per the prior session) — this remains the single highest-leverage content move identified across both this phase and the prior Dominance Strategy research.
12. **Implement the review-request process** (§10) as an operational/staff decision, not a code change.

## 24. Files changed

One new private doc: `docs/seo/PHASE34_LOCAL_SEO_GBP_STRATEGY.md` (this file). No public site files changed.

## 25. Tests

No code or public-site change — same as every prior pass of this phase. `test/continuity.test.js` and the full 20-file regression suite were re-run 2026-09-08 after this pass's edits and remain green (see the phase's closing report for exact counts), matching the established pattern.

## 26. Deployments

None. No public site change was made or required.

## 27. Remaining risks

- **Resolved 2026-09-08**: the `.com`/`.net` split at the GBP level (§14/§19) is no longer a live risk — GBP's website field is confirmed correctly set to `.net`.
- The GBP business-name policy risk (§3) is now confirmed real, not hypothetical, and remains open pending an owner decision.
- Six OTA phone/website fields remain unverified by automated means (§14) — a manual pass is still needed before the NAP audit can be called complete.
- The Activities section's Scuba/Watercraft rental/Water skiing checkmarks (§31) are an unverified accuracy question, not yet confirmed as either correct or an error.

## 28. Phase 34 final status

**COMPLETE (2026-09-08).** Per this phase's own explicit closing standard (Task 9 of the final owner-approved pass): business-name action successfully applied and confirmed **live** on the public panel (§33a, not merely pending); primary category verified unchanged (§33b); website verified unchanged (§33c); profile warnings checked — none found, at any point across all three authenticated passes (§31.20, §33); approved review-response work completed to a reasonable standard — 10 replies read individually, personalized, and published (§33e); the Activities items remain explicitly owner-deferred, not blocking (§33d, per the owner's own instruction not to touch them yet); marine-media recommendations remain future optimization, not a blocker (§33h); no unresolved critical GBP problem remains. The items still open (§23: Facebook page name, Activities confirmation, the remainder of the review-reply backlog, citation/membership decisions, Why Maamigili publication) are real but are follow-on business/content decisions outside GBP's core state — not unresolved GBP problems, and not blockers per the closing standard's own terms.

## 29. Updated roadmap totals

Matrix Phase 34 ("Google Business Profile / Maps") moves from `PARTIALLY COMPLETE` to `COMPLETE`. Roadmap totals: **44 COMPLETE / 0 PARTIALLY COMPLETE / 12 PENDING = 56** (Phase 34 moves from the PARTIALLY COMPLETE count into the COMPLETE count; net total unchanged at 56).

## 30. Recommended next phase

Do not start Phase 36 automatically, per instruction. With Phase 34 closed, the highest-leverage next steps are owner-paced, not phase work: continuing the review-reply backlog in further controlled batches, confirming the Activities checkboxes, and deciding on the Why Maamigili page publication and citation/membership opportunities (§23).
