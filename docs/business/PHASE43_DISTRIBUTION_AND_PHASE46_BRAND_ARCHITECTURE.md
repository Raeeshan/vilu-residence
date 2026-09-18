# Phase 43 — Multi-Channel Distribution & Phase 46 — Other Vilu Brand Architecture (private)

> **Current authoritative domain state (2026-09-18):** Primary canonical domain is `https://viluresidence.com`; legacy `https://viluresidence.net` now 301-redirects to it; Search Console Change of Address is active. Domain references below reflect this document's own point in time and are preserved as historical record — see `docs/ai/VILU_CURRENT_STATE.md` for current state.


**PRIVATE — internal use only, never published.** Excluded from hosting via `firebase.json`'s `docs/**` ignore rule. Matrix Phase 43 ("Multi-channel distribution") and Phase 46 ("Other Vilu brand architecture").

---

# PART A — Phase 43: Multi-Channel Distribution

## 1. Current channel audit (already confirmed live)

Booking.com, TripAdvisor, Agoda, Expedia, Hotels.com (multiple locale subdomains), Trivago, Trip.com, Planet of Hotels, Google Hotels/Google Travel, plus Vilu's own direct booking engine (Cloudbeds widget) on `viluresidence.net`. Commercial priority remains, unchanged: Holiday Packages → Direct Accommodation → Individual Experiences by enquiry.

## 2. Commission / parity / quality assessment, per existing channel

All figures below are **APPROXIMATE / general industry standard** — Vilu's actual contracted rates should be confirmed in each channel's own partner extranet, since real rates are negotiated per property.

| Channel | Typical commission | Rate-parity exposure | Booking-quality reputation (general industry) |
|---|---|---|---|
| Booking.com | ~15% base, up to ~28% effective with visibility programs + payment fees | Real, long-documented parity practice; Maldives is outside the EEA (unlike EU properties, whose contractual parity was removed Nov 2024), so parity clauses likely remain enforceable for Vilu | Generous free-cancellation defaults drive volume but also higher cancellation/no-show rates industry-wide |
| Expedia / Hotels.com | ~15–30%, headline ~18% (Hotels.com inherits Expedia Group's structure) | Real parity exposure, general industry standard | Skews toward more prepaid/non-refundable inventory |
| Agoda | ~15–20%, varies by market | General industry parity expectation, not independently confirmed for Maldives specifically | Strong Asian-origin demand; higher share of prepaid, price-sensitive bookers |
| TripAdvisor | "Pay for Stays" — property chooses 12% or 15% (higher = more visibility), charged only on completed stays | Not a classic parity contract; metasearch price comparison creates similar pressure | Generally low booking volume relative to the "Big 3" |
| Trivago | Historically CPC ($0.30–$5/click); reporting indicates a shift toward a CPA-only model with a ~10% minimum commission | N/A — referral channel, not a parity-bound OTA | Sends clicks only, not a direct booking-quality signal |
| Trip.com | ~10–25%, commonly 15–20% for non-China properties | General industry parity expectation | Strong Asian-origin demand, similar profile to Agoda |

## 3. Real, currently-active channels Vilu is not yet on

- **Traveloka** — confirmed real and active, with real Maldives guesthouse listings; serves Southeast Asian markets (Indonesia, Malaysia, Thailand, Vietnam).
- **MakeMyTrip** — confirmed real and active, 130+ Maldives guesthouses listed including local-island packages; dominant for Indian-origin travelers, a fast-growing Maldives source market.
- **Ostrovok.ru** — confirmed real and active, ~1,600+ Maldives properties, official Aeroflot/Pobeda booking partner; relevant given Russian-market demand (Vilu already has a Russian locale).
- No dedicated, genuinely transacting Maldives-only local-island marketplace was found — sites like "Budget Maldives" appear to be curated blogs/affiliate directories, not real independent booking engines. **Not recommended** until independently re-verified as a real OTA.

## 4. Operational risk assessment for a 6-room property

Each additional channel adds real inventory/rate-sync risk unless run entirely through the existing channel manager (Cloudbeds). With only 6 rooms, oversell risk from any manually-updated calendar is high — a single missed sync can double-book a room. Each new OTA also multiplies parity-monitoring burden and diffuses focus away from the stated commercial priority (Packages → Direct → Experiences).

## 5. Recommendation (no contract entered, no channel joined this pass)

If the owner wants to pursue Traveloka, MakeMyTrip, or Ostrovok, the only operationally safe path is through the existing Cloudbeds channel-manager connection (if it supports these channels) — never a manually-managed parallel calendar. This is a genuine commercial decision requiring owner authorization (a new distribution contract) and is not executed here, per the standing "no new commercial agreements" boundary. Private B2B/agency net rates are not exposed anywhere in this assessment, and no protected PMS booking logic was touched.

## 6. Final classification (2026-09-08 closure pass)

Every channel and candidate this phase could realistically evaluate is classified below. Nothing in the CURRENT/OPTIMIZE row requires a new contract; everything requiring one is OWNER-GATED FUTURE OPTION, not left open-ended.

| Channel | Classification | Basis |
|---|---|---|
| Booking.com, TripAdvisor, Agoda, Expedia, Hotels.com, Trivago, Trip.com, Google Hotels, direct Cloudbeds engine | **CURRENT / OPTIMIZE** | Already live; no new contract needed. Optimization (listing content, photos, parity) is the same work already tracked under Phase 34 (GBP/local SEO) and Phase 42 (reputation) — not duplicated here to avoid the same action appearing owner-gated twice. |
| Traveloka | **OWNER-GATED FUTURE OPTION** | Real, active, relevant to Southeast Asian demand — but joining requires a new distributor agreement, which this session cannot and must not sign. |
| MakeMyTrip | **OWNER-GATED FUTURE OPTION** | Real, active, relevant to India (a growing source market) — same contract boundary. |
| Ostrovok.ru | **OWNER-GATED FUTURE OPTION** | Real, active, relevant given Vilu's existing Russian locale — same contract boundary. |
| "Budget Maldives" / unverified local-island marketplace sites | **REJECT** | Could not be independently confirmed as a real, transacting OTA rather than a curated affiliate blog — do not pursue without independent re-verification first. |

## Phase 43 status

**COMPLETE.** Every action within this phase's own scope that does not require signing a new third-party contract is finished: the current-channel audit, the commission/parity/quality assessment, the real-candidate research, the operational-risk assessment, and the explicit CURRENT/OWNER-GATED/REJECT classification above. The three remaining channel-join decisions are correctly owner-gated commercial contracts, not unfinished research — per this project's own completion standard, an owner-gated *future growth* option does not keep an otherwise-finished phase open.

---

# PART B — Phase 46: Other Vilu Brand Architecture

## 1. Current reality (must not be misrepresented)

Only **Vilu Residence** actually operates today. Vilu Voyager (Phase 45, a post-arrival Guest Guide PDF), Vilu Ari Dive, Vilu Spice, and Vilu Griffin are not current operating businesses and must never be presented as if they were — in any document, any public copy, or any future asset.

## 2. Proposed brand hierarchy (documentation only — no renaming executed)

```
VILU (master brand, future-facing, not yet publicly emphasized)
└── Vilu Residence (the current, real, operating accommodation entity — keeps its own
    established name, Google/OTA/review equity, and public-facing identity unchanged)
    └── Vilu Voyager (Phase 45 — a private, post-arrival Guest Guide PDF, not a
        separate public brand, not a company, not a booking platform)
```

Any future concept (Vilu Ari Dive, Vilu Spice, Vilu Griffin, or others named only in `VILU_IDEA_BACKLOG.md`) would, if it ever becomes a real operating business, slot in at the same level as Vilu Voyager — a sub-brand under the Vilu master brand, introduced only once it genuinely exists, never described publicly before that point.

## 3. Naming, logo, domain, and social considerations (internal guidance, not implemented)

- **Master-brand usage**: "Vilu" alone should not appear in public copy as if it were the current operating entity's name — "Vilu Residence" remains the real, registered, reviewed business name everywhere it currently appears (GBP, OTAs, the website's own schema).
- **Vilu Residence naming**: unchanged. No prematurely renaming the current public business to plain "Vilu" anywhere — this would directly conflict with the real, hard-won Google/OTA/review equity already built around "Vilu Residence" (5.0 rating, 81 Google reviews, real OTA listings under that exact name).
- **Logo relationship**: the existing Vilu Residence logo/wordmark (confirmed real, already live on GBP — "Vilu Residence · @maamigili" palm-tree mark) should remain the primary public mark. A future master "Vilu" mark, if ever developed, should visually relate to it (shared typography/palette) rather than replace it.
- **Future naming rule**: any future Vilu sub-brand's name should include enough of its own descriptive context (e.g., "Vilu Voyager" clearly reads as a guide/companion product, not a dive operator) to avoid entity confusion with Vilu Residence itself, especially in structured data/schema, where entity conflation is a real, previously-encountered risk class in this project (see Phase 37's entity-graph work).
- **Domain considerations**: no new domain is registered or proposed by this document. If a future sub-brand ever needs its own domain, it should be a clear owner decision at that time, informed by the same domain-safety discipline already applied to `.net`/`.com`.
- **Social naming**: any future sub-brand's social handles should avoid duplicating or destabilizing the existing `@vilu_residence` (Instagram), `facebook.com/ViluResidence`, and `@maldivesvilu` (X) identities — a new handle, not a rename of the existing ones.
- **Entity hierarchy for schema/structured data**: Vilu Residence's `LodgingBusiness`/`Organization` JSON-LD (Phase 37, confirmed intact) should remain the canonical entity. A future "Vilu" master-brand entity, if ever added to schema, should be a parent `Organization` referencing Vilu Residence via `subOrganization` or an equivalent real, standard schema.org relationship — never a duplicate or competing entity for the same real-world business.
- **Brand-protection consideration**: no trademark filing, domain purchase, or legal registration is proposed or executed here — this section is architecture guidance only, not a legal action.

## 4. What this document explicitly does NOT do

It does not rename Vilu Residence. It does not create a public "Vilu" master-brand page, logo, or domain. It does not imply Vilu Ari Dive, Vilu Spice, or Vilu Griffin currently operate. It does not alter any existing schema, navigation, or public copy.

## Phase 46 status

**COMPLETE.** This phase's own scope (define a safe brand architecture for future expansion, without inventing businesses or renaming the current one) is fully satisfied by the hierarchy and guidance above — there is no further research or owner-gated implementation required to close it; any future sub-brand launch would be its own, separately-scoped decision at that time.

## Files changed

New: `docs/business/PHASE43_DISTRIBUTION_AND_PHASE46_BRAND_ARCHITECTURE.md` (this file). No public site file changed. No third-party contract entered, no channel joined, no brand renamed.
