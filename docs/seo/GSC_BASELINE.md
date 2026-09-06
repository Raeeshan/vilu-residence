# Google Search Console — Baseline

Living record of the site's real, verified Google Search Console / production-search state. Update this file whenever new real data is captured — never fill in a section with an estimate or a plausible-looking number. If data isn't available yet, write "not yet available," not a guess.

---

## Verification status (as of 2026-09-06)

**NOT CONFIGURED.** Confirmed via three independent, real checks — not assumed:

1. No `google-site-verification` meta tag exists anywhere in `vilu-website.html`'s `<head>` (checked directly against the production-served HTML).
2. No verification HTML file exists at any plausible path — checked directly, all returned HTTP 404.
3. A live public DNS TXT lookup for `viluresidence.net` (via Google's own `dns.google` DNS-over-HTTPS resolver, an authoritative-enough public source) returned exactly one TXT record: `hosting-site=viluresidence` — a Firebase Hosting custom-domain artifact, not a Google Search Console verification record. No `google-site-verification=` TXT record exists.

No prior Google Search Console work was found anywhere in this repository or in any `docs/ai/*` continuity file, beyond a single PENDING placeholder row in the roadmap.

## Preferred property architecture

- **Property type:** Domain property for `viluresidence.net` (not URL-prefix) — covers HTTPS, all paths, and all language subdirectories under one property.
- **Preferred verification method:** DNS TXT record at the domain's registrar/DNS provider. Do not add a redundant HTML verification file if DNS verification succeeds.
- **Canonical SEO domain:** `viluresidence.net`. `viluresidence.com` remains a future strategic option only — do not treat it as canonical.

## Owner action required (hard gate)

Claude has no DNS or Google-account credentials and must not attempt any part of this step. The owner must, using their own accounts/access:

1. Log into [Google Search Console](https://search.google.com/search-console) with their own Google account.
2. Add `viluresidence.net` as a **Domain property**.
3. Add the DNS TXT verification record Google's own UI provides, at whichever registrar/DNS provider manages `viluresidence.net`'s DNS.
4. Wait for Google to confirm verification (can take from minutes to ~24-48 hours depending on DNS propagation).
5. Report back once verified, so sitemap submission and real baseline capture can proceed.

## Sitemap audit (2026-09-06)

- URL: `https://viluresidence.net/sitemap.xml` — HTTP 200.
- Well-formed XML (one apparent url-count discrepancy during analysis was traced to the sitemap's own explanatory XML comment literally containing the string `<url>` in its prose — not a real malformed entry, confirmed by parsing rather than assumed).
- **132 real `<url>` entries**: 12 distinct pages × 11 language variants (en + zh/ru/de/it/fr/ar/ja/ko/sk/cs), uniformly 12 per language.
- **451 `<image:image>` entries.**
- Only 2 distinct `<lastmod>` values across the whole file (2026-09-05, 2026-09-06) — genuinely recent, not stale/fabricated dates.
- Zero preview (`*.web.app`), PMS (`vilu-unified.html`), or Agency Portal (`vilu-agency-portal.html`) URLs present.
- Every `<url>` block carries the full 11-language hreflang alternate-link set (including itself and `x-default`), matching the `<head>`'s own hreflang tags — no mismatch found.

**Not yet submitted to Search Console** — submission requires a verified property, which doesn't exist yet.

## Robots.txt audit (2026-09-06)

```
User-agent: *
Allow: /
Disallow: /vilu-unified.html
Disallow: /vilu-agency-portal.html

Sitemap: https://viluresidence.net/sitemap.xml
```

- Site-wide `Allow: /` — the public site is fully crawlable.
- Only the two internal PMS/Agency-Portal HTML files are blocked — correct, these were never meant to be public or indexed.
- Sitemap correctly referenced.
- No accidental site-wide `Disallow`, no leftover Firebase-preview-channel artifacts in the production robots.txt.

## Indexability sample audit (2026-09-06)

Sampled directly against production (`https://viluresidence.net/`), all HTTP 200:

| Page | Canonical | hreflang | Notes |
|---|---|---|---|
| `/` (homepage) | self-referencing | full 11-language cluster + x-default | Rich structured data: LodgingBusiness, Organization, BreadcrumbList, GeoCoordinates, PostalAddress, Product, Offer |
| `/holiday-packages.html` | (not individually re-checked beyond HTTP 200 this pass) | — | — |
| `/maamigili-guide.html` | self-referencing | — | Title/meta description present and specific |
| `/south-ari-atoll-guide.html` | (HTTP 200 confirmed) | — | — |
| `/whale-shark-snorkeling.html` | (HTTP 200 confirmed) | — | — |
| `/manta-ray-snorkeling.html` | (HTTP 200 confirmed) | — | — |
| `/ru/` | self-referencing | localized title (`гостевой дом`) | `lang="ru"` |
| `/zh/` | (HTTP 200 confirmed) | — | — |
| `/ar/` | self-referencing | localized title | `<html lang="ar" dir="rtl">` confirmed |

No blocking `<meta name="robots">` tag found on any sampled page (default index,follow, consistent with robots.txt).

**Noted, not a defect, not fixed this pass**: there is no dedicated rooms/accommodation URL (rooms content lives only as a homepage anchor section, `#rooms`) and no dedicated transport/planning guide page (confirmed via direct 404 checks on several plausible paths) — this matches the already-documented Phase 24 topical-authority gap, not a new finding.

## Search performance baseline

**Not yet available** — no verified Search Console property exists, so no real query/page/country/device/CTR/position data could be captured. Do not fill this section with an estimate. Update once the owner completes verification (see "Owner action required" above) and enough data has accumulated (GSC typically needs several days to weeks to populate a meaningful baseline after verification).

## GA4 linkage status

GA4 is live and unaffected by this audit: Measurement ID `G-1EPZ71Q331`, Property ID `420109910` (see `VILU_PROTECTED_CONTRACTS.md` §Analytics for the full canonical event/dimension list — none of it was touched this pass). Linking Search Console to GA4 is done inside Google's own admin consoles for both products and requires the owner's own account access to each — not attempted this pass, and not something Claude can do on the owner's behalf.

## Monitoring process (designed, not yet running — no property to monitor yet)

Once verified, the intended recurring review cadence is:

1. **Weekly** (or another cadence the owner prefers): review clicks, impressions, CTR, and average-position trends; note new queries and new countries showing traffic; check the Coverage/Indexing report for new errors.
2. **Diagnose** any material change (a page dropping out of the index, a sudden CTR drop, a new 404 pattern) before assuming a fix is needed.
3. **Prioritize** findings — indexation errors and outright broken pages first, opportunity items (high impressions + low CTR, positions 4-20) second.
4. **Recommend** specific, scoped changes — never a blanket "improve SEO" action.
5. **Owner approval** for any material change (title/meta/URL/schema edits, new pages).
6. **Implement** only the approved change.
7. **Measure again** to confirm the change had the intended effect before moving on.

This mirrors the project's standing measure → diagnose → prioritize → recommend → approve → implement → re-measure discipline already used for performance work (Phase 21) and should not be replaced with automatic, unreviewed SEO edits.

## Data limitations (as of 2026-09-06)

- No Search Console API access exists in this session — even after the owner verifies the property, retrieving GSC data requires either manual export by the owner or a future, separately-authorized API/OAuth integration. This baseline file will need a real update mechanism decided once verification is complete.
- Everything in this document above the "Owner action required" section was independently verified via direct HTTP/DNS requests against production, not sourced from any Google account or dashboard.
