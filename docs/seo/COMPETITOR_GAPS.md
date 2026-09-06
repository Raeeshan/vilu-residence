# Vilu Residence — Competitor Gap Analysis (Phase 23)

Real evidence only. See `SEARCH_INTELLIGENCE.md` §17 for full data-limitation notes (no backlink/authority tool was used; competitor strength here is assessed only from what's directly visible in real SERPs and Google Trends).

---

## 1. Competitor set, by category (real, observed this pass)

**DIRECT ACCOMMODATION (Maamigili island, same-island competitors)** — **FACT**, from the Google Business Profile "Similar to Vilu Residence" carousel and the "Maamigili hotel" SERP: Koimala Maldives/Koimala Inn (0.4 km away, has its own ranking website), White Sand Inn (0.1 km), White Tern Maldives (5.9 km), La Cabana Maldives (0.4 km), Dravida Hotels Diving & Spa (0.5 km), Shamar Guesthouse & Dive (PADI dive center on-site), Wish Maamigili, Whale Shark Inn Maldives, Oren Hotel Maldives, Maaniya Palace, MAANIYA, Blue Village, Moodhu Residence, Rincodon Hotel Maldives.

**LOCAL ISLAND (destination-level, competing island brands)** — **FACT**, from Google Trends: Maafushi (dominant, 5-15x Maamigili's own search volume), Dhigurah (2nd, and directly whale-shark-associated — see §2), Thulusdhoo (3rd, more surf-associated). **This is a destination-name competition problem, not just a property-name one** — Vilu competes with Maamigili's own weak name-recognition before it even competes with other guesthouses.

**SOUTH ARI TRAVEL / WHALE SHARK CONTENT AUTHORITY** — **FACT**, from the "whale shark Maldives where to see" SERP: Vilamendhoo Maldives Resort Island (resort-owned content), Maldives Secrets (independent editorial site), Euro-Divers (dive operator), Visit Maldives (official tourism authority site), resortlife.travel (independent editorial, close topical match), mvhotels.travel (forum/community), Facebook "Visit Maldives: Tips & Advice" group, Reddit r/maldives, YouTube creators (Melsquare, Living The Globe).

**MALDIVES PACKAGE SELLERS** — not directly SERP-checked this pass (see `SEARCH_INTELLIGENCE.md` §17); known to include large OTAs (Booking.com, Agoda, Traveloka) and package aggregators referenced in the Russia/China market research (Level.Travel, Travelata, Trip.com/Ctrip).

**TRANSPORT** — not directly researched this pass; flagged as a content gap in `SEARCH_INTELLIGENCE.md` §9.

**CONTENT AUTHORITY (non-competing but SERP-dominant)** — Tripadvisor, Booking.com, HotelsOne, Traveloka, Myboutiquehotel.com, resortlife.travel, maldiveshotel24.com, HOPATO — all rank ahead of individual property websites for generic "Maamigili hotel"-type queries, which is expected OTA/aggregator SERP behavior, not a Vilu-specific weakness.

## 2. The Dhigurah signal (the clearest single competitive finding this pass)

**FACT (Google Trends, worldwide, past 12 months):** "dhigurah" appears as a **rising related query** for both "Maamigili" (+90%) and "South Ari Atoll" (+110%) — independently, in two different query contexts. **FACT (Trends, direct comparison):** in a four-way comparison of Maamigili vs. Maafushi vs. Dhigurah vs. Thulusdhoo, Maamigili has the lowest search volume of the four by a wide margin throughout the full 12-month window. **FACT (Trends, Dhigurah's own related queries):** "whale shark" appears as a rising related query for "Dhigurah" specifically (+90%).

**FACT (SERP, "whale shark Maldives where to see"):** a Facebook community thread's top answer explicitly recommends Dhigurah by name for whale-shark local-island stays ("If you like to go a local Island, then definitely Dhigurah in South-Ari-Atoll"); a YouTube video is titled "WHALE SHARK DHIGURAH MALDIVES"; a travel forum's top answer references "the stretch between Dhigurah and Maamigili" — Maamigili is mentioned, but only as a geographic reference point, not as the place being recommended to stay.

**INFERENCE:** Dhigurah has captured more of the "where should I stay to see whale sharks on a local island" narrative than Maamigili currently has, despite both islands being part of the same real whale-shark region. This is not a claim that Dhigurah is a "better" destination — only that it currently has stronger search/content association with the exact intent Vilu Residence is built to serve.

**RECOMMENDATION (not implemented — research only):** any future whale-shark content Vilu builds should explicitly and honestly position Maamigili within the same South Ari whale-shark region Dhigurah content already references, rather than assuming searchers already know Maamigili's name. This does not mean disparaging or comparing unfavorably to Dhigurah — only ensuring Maamigili appears in the same conversation.

## 3. The viluresidence.com finding — expanded legacy-domain audit (flagged for owner attention — not a Phase 23 action item; NO redirect, DNS, or domain change authorized or performed)

**FACT:** navigating directly to `https://www.viluresidence.com` (note: `.com`, not the canonical `.net`) returns a live, real, separate website titled "Best Budget Guesthouse in Maamigili Island, Maldives," using the same phone number (+960-9903339), the same address (Rahdhebai mahu A.dh maamigili), the same contact email (viluresidence@gmail.com), and containing a real guest testimonial mentioning "Raj, the manager." The page footer reads "© Copyright 2024 Vilu Residence Maamigili | All rights reserved. Designed & Developed By Infos Global." This is **not** a domain squatter or an unrelated business — it is a genuine, older website for the same real property, structurally and stylistically different from the current `viluresidence.net` (a simpler, dated PHP-based template).

**Corrected classification, per explicit owner instruction:** this is the **OLD/LEGACY WEBSITE**. `viluresidence.net` is the current production site. Nothing about `.com`'s design, content quality, architecture, or metadata was used to assess `.net` anywhere in this research — the two were always kept as separate findings; this section documents the dedicated legacy-only audit requested.

### 3a. What old pages still exist (real, from `.com`'s own sitemap.xml)

**FACT:** `https://www.viluresidence.com/robots.txt` allows all crawling (`Allow: /`) and references its own sitemap. That sitemap (auto-generated by a third-party tool, all entries dated 2025-01-27 — i.e. generated once and apparently never refreshed) lists exactly **9 URLs**: `/` (home), `/about-us.php`, `/holiday-packages.php`, `/rooms.php`, `/activities.php`, `/transportation.php`, `/deluxe-family-room-with-open-deck.php`, `/deluxe-double-room.php`, `/deluxe-family-room.php`.

### 3b. Which are indexed by Google, and do they rank

**FACT (`site:viluresidence.com` search):** at least 6 of the 9 sitemap URLs are confirmed indexed by Google: the homepage, `/deluxe-double-room`, `/transportation`, `/activities`, `/rooms`, `/holiday-packages`. **This means the legacy `.com` site currently has more pages indexed by Google (≥6) than the current `.net` site (1) — a real, direct, and significant finding, not just a "duplicate/confusing" concern.**

**FACT (real, non-branded SERP check):** `.com`'s `/transportation` page **ranks organically** for the real, non-branded query "Maamigili speedboat transportation" — appearing alongside dedicated transport-booking sites (atolltransfer.com, halamaldif.com) with real pricing detail ("$45 USD per person, one way, ~1h45m"). **This is a direct, evidenced case of the legacy site currently capturing real search visibility for a commercial-adjacent query that `.net` cannot currently capture at all, since `.net` has no equivalent dedicated transport page** (see §3e and `SEARCH_INTELLIGENCE.md` §9 correction).

**FACT (branded query, confirmed earlier this phase):** `.com`'s homepage also ranks organically for the branded query "Vilu Residence Maamigili," positioned above some of the property's own OTA listings.

### 3c. Whether backlinks point to them / whether they duplicate or compete with .net

**Not verified — no backlink tool was available this pass** (consistent with `SEARCH_INTELLIGENCE.md` §17's stated limitation). What is directly confirmed: `.com` and `.net` both describe the same real six-room property with overlapping page concepts (rooms, holiday packages, activities/experiences, transportation/getting-there) — a real, direct **content and query overlap**, meaning the two sites are structurally positioned to compete with each other in search results for at least the accommodation, packages, and transport clusters, not merely to "look similar" to a visitor.

### 3d. Whether useful historical SEO equity exists

**OBSERVATION:** given `.com` has more real indexed pages and at least one confirmed organic ranking for a genuinely valuable non-branded query, it is reasonable to infer some real, if unquantified, historical search equity exists on this domain (age since at least early 2025, real indexation, a real ranking position) — **INFERENCE**, not proven without a backlink/authority tool.

### 3e. URLs that would eventually need exact 301 mappings (inventory only — no redirects implemented)

If a future, separately-authorized, controlled migration is undertaken, the following real old→new candidate mappings exist based on genuine content overlap observed this pass — **this is an inventory for planning purposes only, not an executed or proposed redirect**:

| Old URL (.com) | Content overlap observed | Nearest current .net equivalent |
|---|---|---|
| `/` | Homepage, guesthouse overview | `/` (homepage) |
| `/holiday-packages.php` | Package listings | `/holiday-packages.html` |
| `/rooms.php` | Room types overview | Homepage Rooms section (no standalone rooms.html confirmed this pass) |
| `/deluxe-double-room.php`, `/deluxe-family-room.php`, `/deluxe-family-room-with-open-deck.php` | Individual room-type pages | No individual room-type pages confirmed on `.net` this pass — would need verification before mapping |
| `/activities.php` | Excursions overview | Homepage Experiences section, plus `whale-shark-snorkeling.html` / `manta-ray-snorkeling.html` and other guide pages |
| `/transportation.php` | Speedboat/flight transfer info, real pricing | **No equivalent exists on `.net`** — only a non-indexable FAQ-accordion line ("Questions about transfers or timing? Getting Here...") confirmed this pass, not a real page |
| `/about-us.php` | Business/property description | Homepage "Who We Are" section |

**The `/transportation.php` → (no current equivalent) gap is the single most important entry in this table** — it is real, currently-ranking content with no destination to redirect to yet, meaning any future migration must create the missing content before or as part of redirecting, not simply point the old URL at the homepage.

No redirects, DNS changes, or domain modifications were made or proposed as an implemented action this pass.

## 4. What competitors have that Vilu does not (evidence-based only)

- **Destination-name recognition:** Maafushi and Dhigurah both have dramatically higher real search volume than Maamigili (§2) — an awareness gap Vilu's own content can't fully close alone, since it's about the island name, not the property.
- **First-party whale-shark content authority:** Vilamendhoo Resort, Euro-Divers, Maldives Secrets, and Visit Maldives all have dedicated, well-ranking whale-shark content; Vilu's whale-shark content is currently a homepage section, not an independently-ranking page (`SEARCH_INTELLIGENCE.md` §2, §9).
- **On-property specialization signals:** Shamar Guesthouse & Dive has an on-site PADI dive center as a distinct differentiator visible in its own listing; Whale Shark Inn Maldives has the term baked into its literal business name.

## 5. What Vilu has that competitors may not (only claims supported by actual evidence found this pass)

- **FACT:** Real, populated third-party trust signals already exist and were found this pass without being previously tracked: a Tripadvisor listing (Vilu named directly, #3 on the Maamigili list), a HotelsOne listing (also named directly), a Google Business Profile with a 5.0 rating, and a real Instagram account with **22.5K+ followers** (`@vilu_residence`) — a genuinely substantial audience relative to the site's current tiny measured search footprint. **RECOMMENDATION:** this existing Instagram audience is a real, underleveraged asset worth cross-promoting toward the website/whale-shark content, rather than something that needs to be built from scratch.
- **FACT:** the existing site already has real, correctly-architected multilingual coverage (11 languages, confirmed in Phase 21/22 audits) — most of the individual same-island competitor sites found in this pass's SERP checks did not show multilingual variants.
- **INFERENCE (not directly measured, but consistent with the project's own known architecture):** Vilu is one of the few properties in the competitor set combining direct accommodation booking with a real, separate holiday-package sales system on one platform — most competitors found in this pass appear to be single-purpose (room booking only, via OTA listings).

Claims not included above (e.g., "best local photography," "most authentic experience") were not independently verified against competitor content this pass and are therefore not asserted as competitive advantages here.
