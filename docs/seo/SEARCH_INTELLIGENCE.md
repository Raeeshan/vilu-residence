# Vilu Residence — Search Intelligence (Phase 23)

Master research document. Real evidence only — every claim below is tagged **FACT** (directly observed in a real tool), **OBSERVATION** (a pattern noticed across multiple facts), **INFERENCE** (a reasoned conclusion not directly measurable), or **RECOMMENDATION** (an action, not a finding). Where volume/statistics could not be verified, this is stated explicitly rather than estimated.

Companion documents: `COMPETITOR_GAPS.md`, `INDEXING_ANALYSIS.md`, `MARKET_INTELLIGENCE.md`. GSC baseline (raw numbers) lives in `GSC_BASELINE.md` and is not repeated in full here.

---

## 1. GSC deep analysis — branded vs non-branded

**FACT** (Search Console, historical URL-prefix property `https://viluresidence.net/`, 3-month window 2026-08-02 to 2026-09-04):

| Segment | Clicks | Impressions | Share of clicks |
|---|---|---|---|
| Branded ("vilu residence", "vilu residence maamigili") | 12 | 152 | **33%** |
| Non-branded (all other 156 queries) | 24 | ~1,568 | **67%** |

**OBSERVATION:** Non-branded clicks are the majority (67%), which is a genuinely healthy signal for a one-month-old, mostly-unindexed property — the site is not merely "showing up when people already know the name." However, average position (5.9) and CTR (2.1%) are dominated by the branded pair's very high CTR (branded queries alone likely carry positions 1-3 and CTR well above 2.1%, while most non-branded impressions convert at 0% CTR — see the Germany/Turkey pattern below). **RECOMMENDATION:** future performance reporting should always split branded/non-branded — a blended "average position 5.9" overstates real non-branded competitiveness.

## 2. Query clusters (real data, `GSC_BASELINE.md` + this pass's spot-checks)

**FACT**, clustered from the real query sample already captured:

| Cluster | Example real queries | Clicks | Impressions | Notes |
|---|---|---|---|---|
| BRAND | vilu residence, vilu residence maamigili | 12 | 152 | Healthy CTR |
| ACCOMMODATION/HOTEL | maldive hotel, maldivler otel(leri/fiyatları), malediwy hotele, ceny, ubytování | 1 | ~194 | High impressions, near-zero clicks — see §4 |
| HOLIDAY PACKAGE | cazare maldive (Romanian: "Maldives accommodation/stay") | 0 | 21 | Thin sample |
| MAAMIGILI/SOUTH ARI (destination name) | — | — | — | Not yet a meaningful independent query cluster (destination-name volume for "Maamigili" is real but small — see `COMPETITOR_GAPS.md` §Trends) |
| WHALE SHARK / MANTA / SNORKELING | — | — | — | **No direct GSC query evidence yet** — these terms don't yet appear in Vilu's own top-158 query list, despite whale sharks being the property's core positioning. This is itself a finding: the site is not yet being found FOR its core differentiator. |
| TRANSPORT / COST / ITINERARY | — | — | — | No GSC query evidence — matches the known content gap (no dedicated transport/cost/itinerary pages exist) |

**OBSERVATION:** The absence of whale-shark/manta/snorkeling queries in Vilu's own Search Console data is a significant, real gap — not an assumption. Combined with the SERP findings in `COMPETITOR_GAPS.md` (Dhigurah, not Maamigili, dominates "whale shark local island" search results), this is the single clearest content/SEO opportunity this research surfaced.

## 3. Country findings — see `GSC_BASELINE.md` for the full table; key opportunities:

- **FACT:** Germany — 247 impressions, 1 click (0.4% CTR). Turkey — 226 impressions, 0 clicks (0% CTR). Both are **HIGH IMPRESSIONS / LOW CTR** quick-win candidates — the site is already being shown to real searchers in these countries but isn't earning the click.
- **INFERENCE:** Low CTR at a reasonable measured average position (5.9 blended) for these two countries most likely reflects a title/snippet that isn't matching what German/Turkish searchers are looking for, rather than a ranking problem — but this needs query-level drill-down (which specific queries drove Germany's 247 impressions) before any title change is made. **Not done this pass** — flagged as a P1 action requiring one more data pull, not a P0 rewrite.
- **FACT:** Czechia leads in actual clicks (14) despite modest impressions (138) — the strongest real CTR performance of any country, on branded-adjacent Czech queries ("ceny," "ubytování").

## 4. Device — see `GSC_BASELINE.md`. **FACT:** mobile dominates (24 clicks/1,388 impressions vs desktop 12/318, tablet 0/9). **OBSERVATION:** this matches expected travel-research behavior and is not itself an issue — no action needed at Phase 23 (any mobile UX concerns belong to the already-closed-out Phase 21 performance work, not here).

## 5. Google Trends research (real data, `trends.google.com`, worldwide, past 12 months)

**FACT — Core destination terms** (compared together): "South Ari Atoll" is the dominant term of the group by a wide margin (peaks at 100 around Jan 11, 2026), "Maldives local island" is second and meaningfully sized (20-58 range), "Maldives holiday packages" is smaller and flatter, and "Maamigili" itself is the smallest and noisiest (single digits to ~30).

**FACT — Seasonality:** "South Ari Atoll" and "Maldives holiday packages" both show clear **higher interest in the Northern Hemisphere winter (roughly late Dec–Feb)**, consistent with the real Maldives dry-season travel calendar. "Whale shark Maldives" (checked separately, worldwide) shows a much flatter, genuinely near-year-round pattern (values in the 23-100 range every month, no single dominant season) — this is an important, real distinction:

- **SEARCH SEASONALITY:** destination/package search interest is seasonal (winter-peaked).
- **TRAVEL SEASONALITY:** matches search seasonality (Maldives dry season is the same window).
- **WILDLIFE AVAILABILITY:** whale sharks are documented as genuinely year-round in South Ari (a protected business fact — see `VILU_PROTECTED_CONTRACTS.md`), and the relatively flat whale-shark search-interest curve is actually consistent with that reality — searchers are not treating whale-shark viewing as a narrow-season activity, which supports (rather than contradicts) Vilu's own honest "year-round" positioning. **Do not let winter-season package-search seasonality be mistaken for a whale-shark viewing season — they are different signals, confirmed distinct.**

**FACT — Rising related queries:** for "whale shark Maldives," the rising query "south ari atoll" (+120%) confirms real, growing destination-level interest. For "Maamigili" and "South Ari Atoll" both, **"dhigurah" appears as a rising related query** (+90% and +110% respectively) — see `COMPETITOR_GAPS.md` for the full competitive implication.

**FACT — Regional interest:** "Maamigili" shows real, if small, relative interest in Sri Lanka, Hungary, Italy, Poland, Germany, France, Switzerland, the US, and India. "Maldives local island" shows notable relative share in South Korea (58%) and Turkey (56%) in the head-to-head regional breakdown — **South Korea shows real Google Trends interest in "local island" search despite showing zero measured GSC impressions for Vilu** — an **INFERENCE** that Korean local-island search demand exists but isn't yet reaching viluresidence.net (consistent with the site's overall shallow indexing — see `INDEXING_ANALYSIS.md`).

## 6. Keyword clusters and intent (evidence-based, no invented volumes)

No third-party keyword-volume tool (Ahrefs/SEMrush/Keyword Planner) was available this pass. Volume signals below come only from real Google Trends relative-interest data and real GSC impression counts — both cited per-line. Where a cluster has no such evidence, it is marked "no volume evidence."

| Cluster | Intent | Business value | Evidence | Current Vilu page | Recommended target |
|---|---|---|---|---|---|
| Whale shark / South Ari | Informational → Commercial investigation | VERY HIGH | Trends: high, year-round (§5); zero GSC clicks yet | **`whale-shark-snorkeling.html` already exists (confirmed this pass — substantial, well-structured), linked from homepage** | Not a new page — get the existing page indexed (see `INDEXING_ANALYSIS.md`); consider strengthening internal links/backlinks pointing to it |
| Maldives local island | Commercial investigation | HIGH | Trends: real volume, routes mostly to "Maafushi" (§5, `COMPETITOR_GAPS.md`) | Homepage "What Is Vilu" section | A page/section explicitly targeting "local island guesthouse" language, since that's the real search term class, not just "Maamigili" |
| Holiday packages | Commercial investigation → Transactional | VERY HIGH (direct package-sales priority per this phase's own instructions) | Existing full Packages page; Trends shows flatter but real volume | Full Packages page (already exists) | No new page needed — a content/CTR pass, not a build |
| Accommodation/hotel (Maamigili/South Ari) | Commercial investigation → Transactional | HIGH | GSC: 194 impressions/1 click across this cluster (§2) | Homepage Rooms section | CTR investigation (title/snippet), not a new page |
| Transport (Male–Maamigili, speedboat, flight) | Informational → Local | HIGH planning/conversion value | Real SERP evidence this pass: the legacy `.com` site's dedicated transport page ranks organically for "Maamigili speedboat transportation" (`COMPETITOR_GAPS.md` §3b) — direct proof this content class has real search value | **Only a non-indexable FAQ-accordion line on `.net`** (confirmed this pass — plain text, no link, no dedicated URL); a full dedicated page exists on the legacy `.com` site | Build a dedicated transport/planning page on `.net` — now the single sharpest, most directly evidenced content gap in this research (P0, see §15) |
| Honeymoon / family | Commercial investigation | MEDIUM | No dedicated Trends/GSC evidence this pass | Package inclusions only | Not yet evidenced enough to prioritize a dedicated page |
| Cost/itinerary/trip-prep | Informational | MEDIUM (assists conversion, low direct value) | No volume evidence gathered this pass | None exists | Known content gap (Phase 24), unchanged by this pass |
| Diving (vs. snorkeling) | Informational → Commercial | LOW-MEDIUM, no volume evidence this pass | Not researched this pass | — | Needs its own Trends check before prioritizing |

**Intent/value classification examples (as instructed):**
- "Maamigili hotel" — Commercial investigation, HIGH (real GSC-adjacent evidence: 3rd-party sites already list Vilu here, own site does not yet rank — `COMPETITOR_GAPS.md`).
- "Maldives whale shark holiday" — Commercial investigation, VERY HIGH (combines the phase's two named commercial priorities).
- "What is a whale shark" — Informational, LOW direct commercial value (no evidence this specific query has any real volume for Vilu; included only as the instructed example of a low-value informational query type).
- "Male to Maamigili speedboat" — Local/Transactional-adjacent, HIGH planning/conversion value (no page exists yet to capture this at all).

## 7. SERP analysis (real, this pass — `google.com` search results, English)

**FACT — "Maamigili hotel":** No AI Overview observed in the extracted result (its absence in a page-text extraction is not fully conclusive — Google's AI Overview can be session/account-dependent — treat as "not observed," not "confirmed absent"). A Google Hotels-style price-comparison widget is present. Organic results are dominated by OTAs and aggregators: Booking.com, Tripadvisor (**lists "Vilu Residence" by name, #3** on its Maamigili list), HotelsOne (**also lists Vilu Residence**), Traveloka, Koimala Hotel (a direct competitor with its own ranking website), Myboutiquehotel.com, resortlife.travel, maldiveshotel24.com, HOPATO. A generic "People also ask" box appears with Maldives-luxury questions unrelated to Maamigili specifically — a weak topical-relevance signal for this exact query. **`viluresidence.net` itself does not appear directly in the organic results for this query** — third parties already vouch for Vilu, but Vilu's own site isn't capturing the search yet.

**FACT — "whale shark Maldives where to see":** A Local Pack ("Local results") appears, showing businesses in Malé, Dhidhdhoo, and Maafushi — **no Maamigili-based business appears in the local map pack for this query**. Organic results are dominated by resort/dive-operator content (Vilamendhoo Resort, Euro-Divers), an editorial site (Maldives Secrets), the official tourism site (visitmaldives.com), a closely-matching third-party editorial page ("Whale Sharks in the Maldives: South Ari, Year-Round" on resortlife.travel), a travel forum (mvhotels.travel, whose top answer explicitly says "the stretch between Dhigurah and Maamigili" — Maamigili is mentioned, but only as a geographic reference, not as the recommended place to stay), a Facebook community thread whose top answer explicitly recommends **Dhigurah by name** for whale-shark local-island stays, and YouTube/Reddit results (one video titled "WHALE SHARK DHIGURAH MALDIVES"). **This is the single clearest, most direct competitive finding in this research pass — see `COMPETITOR_GAPS.md`.**

**Search Appearance / rich results (from GSC, `GSC_BASELINE.md`):** confirmed zero rich-result impressions currently despite LodgingBusiness/Organization/BreadcrumbList structured data being present — consistent with the SERP checks above showing no Vilu-specific rich result appearing anywhere sampled.

## 8. Competitor gap research, indexing diagnosis, and market intelligence

See the three companion documents for full detail:
- `COMPETITOR_GAPS.md` — competitor set, the Maamigili-vs-Maafushi-vs-Dhigurah-vs-Thulusdhoo Trends comparison, the viluresidence.com duplicate-site finding, Vilu's real existing assets (Instagram, Google Business Profile, third-party OTA listings).
- `INDEXING_ANALYSIS.md` — the 130-not-indexed investigation and priority tiers.
- `MARKET_INTELLIGENCE.md` — Russia, China, Kazakhstan, Uzbekistan, Spain, Tajikistan findings (from dedicated research this pass).

## 9. Content gap map — **corrected this pass after a fresh live check of `viluresidence.net`**

**CORRECTION:** an earlier version of this section stated "no dedicated whale-shark/manta/snorkeling landing page exists." This was checked directly against the live current site this pass and found **imprecise** — a real, substantial, well-structured dedicated page exists at `whale-shark-snorkeling.html` (confirmed via a real `href` link from the homepage in multiple places, and by loading the page directly: it has a full table of contents — Quick Facts, What the Excursion Involves, group size, who can join, safety, seasonality, pricing, FAQ — genuinely deep content, not a thin stub). **The real gap is not content existence — it's that this page is not yet indexed by Google** (it is one of the 130 "discovered, currently not indexed" pages — see `INDEXING_ANALYSIS.md`) and has zero measured GSC query/click data as a result. This is a meaningfully different, and more encouraging, finding than "the content doesn't exist": the work has already been done; what's missing is Google actually crawling and indexing it, which is a `INDEXING_ANALYSIS.md`-scoped problem, not a new-content-creation problem.

**FACT (carried forward from the Phase 24 audit, still valid, re-confirmed live this pass):** no dedicated transport/getting-there, trip-preparation/packing, itinerary-planning, or cost-breakdown pages exist on `.net` — the homepage contains only a single non-indexable FAQ-accordion line referencing "Getting Here" (confirmed via direct inspection: it is plain text, not a link, with no dedicated URL). **This pass sharpens this finding considerably**: the legacy `viluresidence.com` site has a real, dedicated `/transportation.php` page that **currently ranks organically** for "Maamigili speedboat transportation" (`COMPETITOR_GAPS.md` §3b) — meaning this specific content gap is not hypothetical, it is actively being filled by the old site instead of the new one. **This is now the single most concrete, evidence-backed content gap in this entire research pass** — more so than the whale-shark page, which already exists and only needs indexing, not creation.

## 10. Package search opportunity (commercial priority #1, per this phase's own instruction)

**FACT:** GSC shows 21 impressions/0 clicks for a Romanian package-adjacent query ("cazare maldive"); Trends shows real, if not dominant, volume for "Maldives holiday packages" with rising related queries "maldives holidays 2026" (+140%) and "maldives travel packages" (+80%), and a rising India-specific variant (+40%) — a real, evidenced early signal for India as a package-intent market not otherwise visible in GSC's country data.
**RECOMMENDATION (not implemented — package names/prices/inclusions are protected and untouched):** map the existing 9-package catalog against "whale shark," "local island," and "honeymoon" query language specifically, since those are the clusters with the strongest evidence in this pass, rather than generic "Maldives package" terms where competition from large OTAs is overwhelming.

## 11. Accommodation/room-booking search opportunity (commercial priority #2)

**FACT:** the "Maamigili hotel"/"maldivler otel" cluster already carries real impressions (194 across the sample in §2) but almost no clicks, and Vilu's own site doesn't yet rank directly for the core "Maamigili hotel" query (§7) despite third-party sites already vouching for the property. **This is the most directly actionable, evidence-backed accommodation opportunity**: closing the gap between "third parties already recommend Vilu" and "Vilu's own site appears in the same search" is lower-effort than building new demand from zero.

## 12. Local SEO / Maps signals

**FACT:** Vilu Residence has a real, populated Google Business Profile / Knowledge Panel (confirmed via a branded search) showing a 5.0 rating (exact review count unclear from text extraction — displayed ambiguously, likely a small number, not thousands; verify directly in Business Profile Manager rather than trust this document's transcription), address, phone, "Website/Directions/Save/Share/Call/Check availability" actions, and a "Similar to" carousel of real nearby competitors (Koimala Maldives, White Sand Inn, White Tern Maldives, La Cabana Maldives, and others, several within 0.1-0.5 km). **FACT:** a real Instagram account, "Vilu Residence Maldives" (@vilu_residence), has **22.5K+ followers** — a substantial, currently under-leveraged real asset relative to the site's own tiny measured search footprint. **FACT:** for the "whale shark Maldives where to see" query, no Maamigili-based business appears in Google's Local Pack (§7) — a real local-SEO gap for wildlife-intent (not brand-intent) local searches specifically.

## 13. Image/video search opportunity

**FACT:** GSC confirms 0 clicks/0 impressions in both Image and Video search types despite 451 image sitemap entries (`GSC_BASELINE.md`). **OBSERVATION:** the SERP check in §7 found a real YouTube video result for "WHALE SHARK DHIGURAH MALDIVES" ranking for a closely-related query — direct evidence that video content for this exact topic area does get surfaced by Google, and that a competitor destination (not Vilu/Maamigili) currently holds that visibility.

## 14. AI/AEO (answer-engine) opportunity

**OBSERVATION, not confirmed FACT:** neither SERP check in §7 showed a clearly-rendered AI Overview in the text extraction used, but this method is not a reliable way to confirm absence (AI Overview rendering can vary by account/session/geography, and a text-only extraction can miss it even when present). **RECOMMENDATION:** re-check with a visual screenshot method in a future pass before drawing conclusions about AI Overview presence; do not treat this pass's "not observed" as "confirmed absent."

## 14b. Current-site reconciliation (this pass) — every prior Phase 23 finding, reclassified

Per explicit owner instruction, `viluresidence.com` is the OLD/LEGACY site and `viluresidence.net` is the CURRENT production site. None of this document's substantive findings were ever derived from `.com`'s design, architecture, or content quality — but a fresh live check of `.net` was still performed to verify (not assume) that every finding above holds against the actual current site. Classification key: **STILL VALID** (directly re-confirmed live this pass or sourced from GSC/Trends data independent of either site), **PARTIALLY VALID** (mostly correct, one detail updated), **OLD-SITE ARTIFACT** (a finding that turned out to describe `.com`, not `.net`), **NEEDS FRESH CRAWL DATA** (correct as stated, but resolution depends on Google re-crawling, not on anything checkable today).

| Finding | Classification | Note |
|---|---|---|
| §1 Branded/non-branded 33%/67% split | **STILL VALID** | Real GSC data, independent of either site's content |
| §2 Whale-shark/manta/snorkeling absent from Vilu's own GSC query data | **STILL VALID** | This is a Search Console *data* finding (what people search and click), not a page-existence claim — remains true regardless of the §9 correction below |
| §3 Germany/Turkey high-impression/low-CTR | **STILL VALID** | Real GSC data |
| §5 Google Trends (seasonality, Maamigili vs. Maafushi/Dhigurah/Thulusdhoo volume, "dhigurah" rising query) | **STILL VALID** | Sourced entirely from Google Trends, unrelated to either website |
| §7 "Maamigili hotel" SERP — Vilu named on Tripadvisor/HotelsOne, `.net` itself absent from organic results | **STILL VALID** | Directly re-confirmed live this pass — `.net` still does not appear in this SERP's organic results |
| §7 "Whale shark Maldives where to see" SERP — Dhigurah dominance | **STILL VALID** | Real SERP data, unrelated to either Vilu website's own content |
| §9 "No dedicated whale-shark/manta/snorkeling landing page exists" | **PARTIALLY VALID → CORRECTED** | The page exists on `.net` (`whale-shark-snorkeling.html`), is substantial, and is properly linked — the real gap is indexing, not content creation. See correction above. |
| §9 "No dedicated transport/getting-there page exists" | **STILL VALID, STRENGTHENED** | Confirmed `.net` has no such page (only a non-linked FAQ line); newly confirmed `.com`'s equivalent page actively ranks for a real query — sharpens this into the top content-gap finding |
| §12 Real Instagram (22.5K+ followers) and Google Business Profile | **STILL VALID** | These are the *business's* real assets (shared across whatever site represents it), not specific to either domain's content |
| `COMPETITOR_GAPS.md` §3 `viluresidence.com` duplicate-site finding | **STILL VALID, SUBSTANTIALLY EXPANDED** | This pass added a full legacy-only audit (sitemap inventory, indexation count, the transportation-page ranking evidence, a 301-mapping inventory) — see `COMPETITOR_GAPS.md` §3a-3e |
| `INDEXING_ANALYSIS.md` 130-not-indexed diagnosis | **STILL VALID, STRENGTHENED** | Confirming `whale-shark-snorkeling.html` is genuinely deep, non-thin content that is still unindexed rules out "the content itself is poor quality" as a cause for at least this page, reinforcing the new-site/crawl-priority explanation over a content-quality explanation |
| Any conclusion about `.net`'s design, architecture, template quality, or internal-linking depth | **N/A — none was ever based on `.com`** | No correction needed; this concern from the owner's instruction did not apply to any finding actually made |

**NEEDS FRESH CRAWL DATA:** whether the indexing-priority-tier recommendations in `INDEXING_ANALYSIS.md` actually improve indexation can only be confirmed once Google re-crawls the site — nothing checkable today resolves this.

## 15. Priority scoring — P0/P1/P2/P3

Scored on: search demand (real evidence only), commercial value, current position/visibility, competition, Vilu's authority fit, content gap size, market priority, conversion potential, indexability, implementation effort.

### P0 (highest value, evidence-backed, low-to-medium effort)
1. **Close the "Maamigili hotel" / accommodation direct-ranking gap** — third parties already vouch for Vilu; the site itself doesn't yet appear (§7, §11).
2. **Investigate the Germany (247 impr/1 click) and Turkey (226 impr/0 clicks) CTR gap** at the specific-query level before any title/snippet change (§3).
3. **Resolve the `viluresidence.com` legacy-domain situation** — confirmed this pass to have ≥6 real indexed pages (more than `.net`'s 1) and at least one page actively ranking for a real, valuable non-branded query (`/transportation.php`) that `.net` has no equivalent for. This is the closest thing to a critical, actionable finding this research produced; a full inventory and candidate 301-mapping table is ready in `COMPETITOR_GAPS.md` §3e for if/when the owner authorizes a controlled migration — **no redirect, DNS, or domain action was taken or proposed as executed this pass.**
4. **Build the missing transport/getting-there page on `.net`** — now the sharpest evidence-backed content gap: the legacy site's equivalent page currently ranks for a real query that the current site cannot capture at all. Independent of any `.com` migration decision, this content should exist on the canonical `.net` site regardless.

### P1 (strong evidence, larger effort)
5. **Get the already-built `whale-shark-snorkeling.html` page indexed** — the content already exists and is substantial (confirmed this pass); the gap is Google's crawl/index priority, not content creation. This is now lower-effort than previously stated, since no new page needs to be written.
6. Investigate why 130/132 pages remain "discovered, not indexed" and execute the evidence-based indexing-priority tiers (`INDEXING_ANALYSIS.md`).

### P2 (real signal, needs more evidence before committing)
7. Russia-specific content/localization work (Yandex visibility, "гестхаус" positioning) — see `MARKET_INTELLIGENCE.md`.
8. China-specific work (Xiaohongshu-native content, 居民岛 terminology) — see `MARKET_INTELLIGENCE.md`.
9. Spain-specific landing content (the only Central-Asia-adjacent market with confirmed country-specific arrival evidence) — see `MARKET_INTELLIGENCE.md`.

### P3 (early-stage signal only, not yet justified)
10. Kazakhstan/Uzbekistan/Tajikistan dedicated localization — evidence found does not yet tie real outbound-travel growth in these markets to the Maldives specifically (`MARKET_INTELLIGENCE.md`).
11. Image/video content investment — real gap exists (§13) but no page-level plan evidenced yet.
12. AI/AEO-specific content — insufficient confirmed evidence this pass (§14).

## 16. Recommended roadmap sequencing

The owner's proposed sequence (24/25 content → 26 Russia → 27 China → 28 Kazakhstan → 29 Uzbekistan → 30 Spain → 31 Tajikistan → 33/34 Local SEO → 35 E-E-A-T → 36 Backlinks → 37 AI/AEO → 38 Media SEO → 39 CRO) is **largely supported by this pass's evidence, with one adjustment worth the owner's attention**: this research found Spain to have a stronger, more concrete evidence base (a confirmed country-specific Maldives arrival milestone) than Kazakhstan, Uzbekistan, or Tajikistan (all three show real outbound-travel growth generally, but no evidence ties that growth to the Maldives specifically). **RECOMMENDATION:** consider whether Spain (Phase 30) could be pulled earlier relative to 28/29/31, or run in parallel — phase numbers are not changed by this document, this is an execution-order observation only, for the owner to decide.

Additionally, the real, repeated "Dhigurah" competitive signal (§5, `COMPETITOR_GAPS.md`) and the "Maamigili hotel" direct-ranking gap (§7, §11) are both P0/P1 findings that predate and are independent of the Russia/China phase sequence — **RECOMMENDATION:** these two items are worth addressing before or alongside Phase 24/25 content work, since they concern the site's own core positioning rather than any specific new market.

## 17. Data limitations (full list)

- No paid keyword-volume tool (Ahrefs, SEMrush, Google Keyword Planner) was available or used — all volume signals come from real Google Trends relative-interest data and real GSC impression/click counts, both cited inline.
- Google Trends "Breakout"/percentage-rise figures on very low absolute volumes can be statistically noisy (a rise from 1 to 3 occurrences can read as "+200%") — treated as directional signal, not precise measurement, and cross-checked against repetition across multiple queries where possible (e.g., "dhigurah" appearing as a rising query for multiple different search terms independently).
- SERP checks were done via page-text extraction, which can miss visually-rendered-only elements (AI Overviews specifically) — findings there are stated as "not observed," never as "confirmed absent."
- Yandex and Baidu were researched via web-search-based sub-agents (general knowledge and cited articles), not by directly querying Yandex/Baidu SERPs in a browser this pass — see `MARKET_INTELLIGENCE.md` for sourcing detail on each claim.
- The full 158-query and 63-country GSC datasets were sampled, not exhaustively re-transcribed in every document — `GSC_BASELINE.md` and this pass's spot-checks are the source; a full CSV export was not performed (Search Console's own Export feature would trigger a file download, which requires separate explicit handling).
- No competitor backlink/authority tool (Ahrefs, Moz, SEMrush) was used — competitor authority in `COMPETITOR_GAPS.md` is assessed only from what's directly observable in real SERPs (ranking presence, content depth as read), not from a backlink index.

## 18. Protected systems — confirmed untouched

No changes were made this pass to: PMS, Agency Portal, Firestore rules, Cloud Functions, Firebase Auth, booking flow, availability, room prices, package prices/IDs, hero, homepage design, Phase 21 performance implementation, Phase 47 security implementation, consent architecture, analytics event schema, canonical domain, DNS, or Cloudflare. This document, its three companions, and the five `docs/ai/*` continuity-doc updates are the only outputs of this phase. No production deployment occurred.
