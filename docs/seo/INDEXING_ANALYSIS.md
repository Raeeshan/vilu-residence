# Vilu Residence — Indexing Analysis (Phase 23, Part 6)

Investigation of why Search Console shows 1 indexed / 131 not indexed out of 132 known pages. Real evidence only; no cause is claimed without it.

---

## 1. The real numbers (unchanged from `GSC_BASELINE.md`, re-confirmed this pass)

- 132 known pages (matches the sitemap's own real URL count exactly).
- **1 indexed**: the homepage (`https://viluresidence.net/`), last crawled Aug 29, 2026.
- **130** — "Discovered - currently not indexed" (Google systems reason).
- **1** — "Alternate page with proper canonical tag" (Website reason, benign).

## 2. Sample URL inspection (real, direct URL Inspection tool results)

| URL | Status | Last crawl | Referring page |
|---|---|---|---|
| `https://viluresidence.net/` | Indexed | Aug 29, 2026 | Includes a **Google Travel/Hotels entity URL** — confirmed the property already has a presence in Google's Hotels/Travel database |
| `https://viluresidence.net/holiday-packages.html` | Discovered, not indexed | Never crawled (N/A) | None detected |
| `https://viluresidence.net/ru/` | Discovered, not indexed | Never crawled (N/A) | None detected |

The pattern (never crawled, no referring page detected) was consistent across every non-homepage URL checked this and the prior pass. Further individual URL Inspections across the remaining locales (zh, ar, de, fr, it, cs, sk, ja, ko) were attempted this pass but blocked by a Search Console UI navigation issue in this session (the direct-URL deep link redirected to the property Overview rather than the inspection tool) — given the already-consistent pattern across the samples that did complete, this is not expected to change the diagnosis, but is noted honestly as an incomplete sample rather than claimed as exhaustively verified.

## 3. Possible causes — evaluated against actual evidence

| Cause | Evidence for | Evidence against | Verdict |
|---|---|---|---|
| **New site / low crawl demand** | Property is genuinely young (Search Console history starts ~2026-08-02); homepage itself was only crawled once by Aug 29 despite being live earlier; zero referring pages detected for any non-homepage URL, meaning Google has no external signal urging it to prioritize a deeper crawl | — | **Best-supported cause** |
| **Low authority** | No backlink data was available this pass (`SEARCH_INTELLIGENCE.md` §17); Links report in Search Console showed 0/0 external and internal links as of the last GSC check, which itself may reflect data lag rather than confirmed zero | Cannot be separated from "new site" without a backlink tool | Plausible, unconfirmed |
| **Insufficient external links** | Consistent with the 0/0 Links report | Same caveat — Search Console's link-graph data is known to lag real crawl activity | Plausible, unconfirmed |
| **Too many new URLs launched at once** | 132 URLs across 11 languages were all added to the sitemap together (Aug 3 submission) — a real, large single batch for a brand-new property | — | **Plausible contributor** — a smaller initial batch with the homepage's own internal links prioritized might have crawled faster, though this is inference, not proven |
| **Language-page similarity / template similarity** | Not directly tested this pass (would require comparing rendered HTML similarity across locale pages) | The site's own translation architecture (Phase 12 work) is documented as producing genuinely distinct per-language content, not machine-translated boilerplate | **No direct evidence either way** — flagged for a future, dedicated check, not claimed as a cause here |
| **Weak internal-link prioritization** | The homepage links to the full Packages page and guide pages, but Search Console shows zero referring pages detected for any sampled non-homepage URL, meaning Google's crawler has not yet followed or recorded those internal links | — | **Plausible contributor**, worth a dedicated internal-linking audit before assuming content quality is the issue |
| **Crawl discovery without demand** | The one benign "Alternate page with proper canonical tag" exclusion is consistent with this — Google found the URL but a canonical elsewhere correctly deferred it | — | Confirmed for that one page only, not the other 130 |
| **Content quality / soft duplication** | Not evidenced — no soft-404s, no quality-related exclusion reasons appear anywhere in the real Page Indexing report (`GSC_BASELINE.md`) | The absence of any quality-flagged exclusion reason across 130 pages argues against this | **Not supported by evidence found** |
| **Canonical issue** | Only 1 page shows any canonical-related exclusion, and it's the benign kind | — | **Not a broad problem** |
| **Hreflang issue** | Not evidenced — no hreflang-related exclusion reason appears in the real data | Phase 22's own indexability sample confirmed correct hreflang clusters on every page checked | **Not supported by evidence found** |
| **Technical block (robots/noindex)** | Not evidenced — robots.txt confirmed healthy and permissive multiple times this project; "Discovered - currently not indexed" is explicitly a non-blocking status in Google's own definition (crawl allowed, indexing allowed) | — | **Ruled out** |
| **Rendering / server response / crawl budget / site reputation** | Not evidenced — the one page that was crawled (homepage) fetched successfully with no rendering issues | No broad rendering/server-error exclusion reason appears anywhere in the real data | **Not supported by evidence found** |
| **Lack of query demand** | Some pages (transport, cost, itinerary) genuinely may have limited standalone query demand, per `SEARCH_INTELLIGENCE.md` §6 | Whale-shark/local-island demand IS evidenced (Trends), yet no dedicated page exists to be indexed FOR it — this suggests missing content, not missing demand, for at least that cluster | **Mixed** — real for some clusters, not others |

**Overall diagnosis (evidence-weighted): the dominant, best-supported explanation is a combination of (a) genuine new-site/low-crawl-demand status, (b) a large single-batch sitemap launch across 11 languages with no staged rollout, and (c) weak-to-absent internal-link signal reaching Google for any page beyond the homepage.** No technical defect (blocking, canonical, hreflang, rendering, server error) was found. This is explicitly **not** a case for mass "Request Indexing" — per this phase's own instruction, that was not attempted.

## 4. Recommended indexing priority tiers (derived from evidence, not assumed)

**TIER 1** (highest real evidence of both demand and gap):
- Homepage (already indexed — maintain).
- Holiday Packages page (direct commercial priority; some real GSC/Trends signal).
- A future dedicated whale-shark/South-Ari page (real Trends demand, zero current indexed content for it — see `SEARCH_INTELLIGENCE.md` §9).

**TIER 2:**
- Existing guide pages already covering Maamigili, South Ari Atoll, snorkeling, manta, whale-shark topics as subsections (real but secondary demand evidence).
- Accommodation/rooms content (real impressions in the "Maamigili hotel" cluster — `SEARCH_INTELLIGENCE.md` §11).

**TIER 3:**
- Localized (non-English) variants, prioritized by the real country signal already gathered: Czechia (real clicks), Germany/Turkey (high impressions, CTR gap), then the rest — not all 10 languages at once.

This tiering is a recommendation for future internal-linking and content-refresh priority, not an instruction to mass-request-index — consistent with this phase's explicit "do not request indexing for all 130 pages" instruction.
