# Google Search Console — Baseline

Living record of the site's real, verified Google Search Console / production-search state. Update this file whenever new real data is captured — never fill in a section with an estimate or a plausible-looking number. If data isn't available yet, write "not yet available," not a guess.

---

## Verification status (updated 2026-09-06, second pass)

**A real, already-verified property exists: `https://viluresidence.net/` (URL-prefix property), verified since at least early August 2026, with continuous real data.** This was NOT detectable via static site/DNS checks (no `google-site-verification` meta tag, no verification file, no DNS TXT record) because it appears to have been verified via an already-connected Google Analytics/Tag association on the same Google account (`viluresidence@gmail.com`) rather than a site-side artifact — a verification method that leaves no trace in the site's own HTML or DNS. **The first-pass conclusion of "NOT CONFIGURED" was correct about the absence of any Domain-property/DNS-based verification, but incomplete — it missed this existing, working URL-prefix property**, discovered this pass by using the connected, authenticated browser to open Search Console directly.

Confirmed real state of that property:
- Ownership verification: **verified owner** (confirmed in Settings → General settings).
- Sitemap already submitted (Aug 3, 2026) and processing successfully (see Sitemap section below).
- Real Performance/Indexing data exists back to 2026-08-02.

**Additionally, this pass created a new Domain property for `viluresidence.net`** (the architecture Google and this project's own instructions prefer, since it covers HTTPS/all paths/all language subdirectories under one property). It is **not yet verified** — DNS verification was deliberately not completed by Claude (see "Owner action required" below). Recommendation: keep both — the existing URL-prefix property preserves its history; the Domain property becomes primary once verified, without losing anything.

## Owner action required (hard gate — DNS only)

Claude has no DNS credentials and must not add DNS records itself, regardless of authorization given, per a standing rule against modifying system/security-level infrastructure directly. Everything else in Search Console that didn't require touching DNS (creating the property, reading all available data, associating GA4) was completed this pass using the owner's own already-authenticated Google session in the connected browser.

The owner must, using their own DNS registrar/provider access:

1. Add this exact DNS TXT record at the root of `viluresidence.net`:
   ```
   google-site-verification=Zs-AXgzmNp27ERoQjlnHDYpvvuHOUo9eWqZo9k8uJGY
   ```
   (Retrieved directly from Google Search Console's own verification dialog for the pending Domain property — this is the authoritative, exact value, not reconstructed from memory.)
2. Note: Google Search Console detected the DNS provider as **Cloudflare** and offered an OAuth-based "authorize Google to manage your Cloudflare DNS" one-click flow — **this was deliberately declined**, since it grants Google broader, ongoing DNS-management access than adding one TXT record. The manual "Any DNS provider" path was used instead to retrieve the value above; the owner can add it manually in the Cloudflare dashboard, or use Google's one-click Cloudflare flow themselves if they prefer that trade-off — that choice belongs to the owner, not Claude.
3. Return to Search Console (`https://search.google.com/search-console` → property switcher → `viluresidence.net` under "Not verified") and click Verify once the record is live.
4. Existing Firebase-related DNS records (`hosting-site=viluresidence`) were not touched and must remain intact — confirmed present and undisturbed as of this pass.

## Sitemap status (confirmed via the real, verified property)

- `/sitemap.xml` already submitted **2026-08-03**, last read **2026-09-04**, status **Success**.
- **132 discovered pages** (matches this session's own independent static audit exactly), 0 discovered videos.
- Not resubmitted this pass — an existing successful submission should not be resubmitted without reason.

## Robots.txt audit (2026-09-06, static check, still valid)

```
User-agent: *
Allow: /
Disallow: /vilu-unified.html
Disallow: /vilu-agency-portal.html

Sitemap: https://viluresidence.net/sitemap.xml
```

Site-wide `Allow: /`, only the two internal PMS/Agency-Portal HTML files blocked, correct sitemap reference, no accidental blocking, no Firebase-preview artifacts.

## Indexing baseline (real data, from Search Console's Pages report, last update 2026-08-28)

- **131 not indexed, 1 indexed**, out of 132 known pages.
- **The only indexed page is the homepage** (`https://viluresidence.net/`, last crawled Aug 29, 2026).
- Not-indexed breakdown:
  - **130 pages** — "Discovered - currently not indexed" (Google systems reason). **Classification: EXPECTED for a ~1-month-old property**, not a technical defect — Google has the URLs (via the sitemap) but hasn't prioritized crawling/indexing them yet. Worth monitoring, not urgent.
  - **1 page** — "Alternate page with proper canonical tag" (Website reason). **Classification: EXPECTED/benign** — a URL correctly deferring to a canonical elsewhere.
- No blocked/soft-404/server-error/redirect-issue reasons present at all — the *type* of exclusion is healthy; the *volume* (130 undiscovered-for-indexing pages) is the real, actionable signal for future content/internal-linking work (Phase 23+), not a bug to fix in Phase 22.

## URL Inspection samples (real, this pass)

| URL | Status | Last crawl | Canonical | Notes |
|---|---|---|---|---|
| `https://viluresidence.net/` | Indexed | Aug 29, 2026 | self, matches Google-selected | Crawled as Googlebot smartphone; referring page includes a **Google Travel/Hotels entity URL** — the property is already surfaced in Google's Hotels/Travel database |
| `https://viluresidence.net/holiday-packages.html` | Not indexed — Discovered, currently not indexed | Never crawled (N/A) | — | Referring page: none detected |
| `https://viluresidence.net/ru/` | Not indexed — Discovered, currently not indexed | Never crawled (N/A) | — | Same pattern as above; representative of the other sampled pages (south-ari-atoll-guide, whale-shark-snorkeling, manta-ray-snorkeling, zh/, ar/ were not individually re-inspected this pass since the pattern was already confirmed consistent) |

**Request Indexing was deliberately NOT clicked for any page this pass** — Phase 22 is scoped as measurement/baseline, not remediation; requesting indexing is a reasonable future action but wasn't part of this audit's authorized scope.

## Search performance baseline — REAL DATA (3-month view, 2026-08-02 to 2026-09-04)

- **Total clicks: 36. Total impressions: 1,720 (1.72K). Average CTR: 2.1%. Average position: 5.9.**

### Top queries (sample, 158 total queries in the window)
| Query | Clicks | Impressions |
|---|---|---|
| vilu residence | 6 | 90 |
| vilu residence maamigili | 6 | 62 |
| ceny *(Czech: "prices")* | 1 | 1 |
| ubytování *(Czech: "accommodation")* | 1 | 1 |
| maldive hotel | 0 | 58 |
| maldivler otel fiyatları *(Turkish)* | 0 | 47 |
| maldivler otelleri *(Turkish)* | 0 | 40 |
| maldivler otel *(Turkish)* | 0 | 25 |
| malediwy hotele *(Polish)* | 0 | 22 |
| cazare maldive *(Romanian)* | 0 | 21 |

Notable: genuine international query demand already exists in Turkish, Polish, Romanian, and Czech even without any dedicated content for those markets beyond the existing 10 locale mirrors — real signal for Phase 23's market-research input, not yet acted on.

### Top pages
**100% of clicks (36/36) and ~99.7% of impressions (1,715/1,720) come from the homepage alone.** No other page — no guide, no package page, no locale mirror — has any measurable search visibility yet. Directly consistent with the indexing baseline above (only the homepage is indexed).

### Top countries (of 63 total with impressions)
| Country | Clicks | Impressions | Classification |
|---|---|---|---|
| Czechia | 14 | 138 | Traction |
| Italy | 8 | 256 | Traction |
| Maldives | 4 | 142 | Traction (expected — local market) |
| Singapore | 2 | 13 | Early traction |
| **Germany** | 1 | **247** | **Quick-win candidate — high impressions, very low CTR** |
| Spain | 1 | 40 | Early traction |
| United States | 1 | 23 | Early traction |
| United Kingdom | 1 | 22 | Early traction |
| Austria | 1 | 21 | Early traction |
| India | 1 | 12 | Early traction |
| **Turkey** | 0 | **226** | **Quick-win candidate — high impressions, zero clicks yet** |
| France | 0 | 141 | No clicks yet |
| Greece | 0 | 94 | No clicks yet |
| Poland | 0 | 50 | No clicks yet |
| Slovakia | 0 | 28 | No clicks yet |
| Russia | 0 | 8 | Present, very early |
| Japan | 0 | 6 | Present, very early |
| Tajikistan | 0 | 1 | Present, minimal |
| Uzbekistan | 0 | 1 | Present, minimal |

**Explicitly named markets with zero measured impressions this window: China, Kazakhstan, South Korea.** Per instruction, this is NOT overinterpreted as "no demand" — it's a ~1-month sample from a single, mostly-homepage-only-indexed property; absence here just means no measured signal yet, not confirmed absence of demand.

### Device split
| Device | Clicks | Impressions |
|---|---|---|
| Mobile | 24 | 1,388 |
| Desktop | 12 | 318 |
| Tablet | 0 | 9 |

Mobile dominates both clicks (~67%) and impressions (~81%) — consistent with travel-intent search behavior.

### Search appearance / Web vs Image vs Video
- **Web: real data as above.**
- **Image search: 0 clicks, 0 impressions** — despite 451 image sitemap entries, none have surfaced in Google Images yet.
- **Video search: 0 clicks, 0 impressions** — expected, no video content/sitemap exists.
- **Search Appearance (rich results): no data** — no rich-result surface (FAQ, review stars, etc.) is currently active, despite the LodgingBusiness/Organization/BreadcrumbList structured data present on the homepage. Not necessarily a defect — rich-result eligibility and display are at Google's discretion and take time to appear even with correct markup.

### Links report
- External links: 0 reported. Internal links: 0 reported. **This likely reflects Search Console's own link-graph data lagging behind real crawl activity (consistent with the shallow indexing depth found above) rather than a confirmed absence of backlinks — recorded as "no data yet," not "zero backlinks confirmed."**

## GA4 association — COMPLETED this pass

Search Console property `https://viluresidence.net/` is now formally associated with GA4 property **"Vilu Residence — viluresidence.net" (420109910)**, data stream `https://viluresidence.net/` — completed via Search Console's standard, same-account Associations workflow (Settings → Associations → Associate → select property → select data stream → confirm). No GA4 event names, consent settings, audiences, retention, or any other GA4 configuration were touched — only the standard cross-product association handshake. Confirmed showing in Settings → Associations → Associated services after completion.

## Manual actions / security issues

None found. Notification center showed only routine milestone/onboarding messages ("Congrats on reaching 20 clicks in 28 days!", a general "Monitor the Google Search traffic" tip, the original "Get started" welcome message, and this pass's new GA4-association confirmation) — no manual action penalties, no security issues flagged.

## Monitoring process

Once the Domain property is verified (or using the existing verified URL-prefix property in the meantime), the intended recurring review cadence is:

1. **Weekly** (or another cadence the owner prefers): review clicks, impressions, CTR, and average-position trends; note new queries and new countries showing traffic; check the Pages/Indexing report for new errors.
2. **Diagnose** any material change (a page dropping out of the index, a sudden CTR drop, a new error pattern) before assuming a fix is needed.
3. **Prioritize** findings — indexation errors and outright broken pages first, opportunity items (the Germany/Turkey high-impression-low-CTR pattern above) second.
4. **Recommend** specific, scoped changes — never a blanket "improve SEO" action.
5. **Owner approval** for any material change (title/meta/URL/schema edits, new pages, Request Indexing campaigns).
6. **Implement** only the approved change.
7. **Measure again** to confirm the change had the intended effect before moving on.

This mirrors the project's standing measure → diagnose → prioritize → recommend → approve → implement → re-measure discipline already used for performance work (Phase 21) and should not be replaced with automatic, unreviewed SEO edits.

## Data limitations (updated 2026-09-06)

- All data in this document was read directly from the real Google Search Console UI (via the owner's own authenticated browser session, with the owner's explicit authorization for this specific session) — not fabricated, not estimated.
- No Search Console API/OAuth integration exists for ongoing automated data pulls — future updates to this file will require either the owner manually exporting data, or a separately-authorized API integration decided later.
- The 3-month performance window only contains meaningful data from 2026-08-02 onward (when the existing property's data collection began) — earlier dates in that window show zero activity because the property didn't yet exist/wasn't yet collecting data, not because the site had no traffic.
- Query, page, and country tables above are samples (top ~10 each), not exhaustive — 158 total queries and 63 total countries exist in the real data; the full lists were paged through for country data specifically to check the owner's named markets, but not exported/transcribed in full here to keep this document readable. Use Search Console's own Export feature for a complete pull when needed.
