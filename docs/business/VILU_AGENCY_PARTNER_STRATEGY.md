# VILU — Agency / Partner Growth Strategy (Phase 44)

> **Current authoritative domain state (2026-09-18):** Primary canonical domain is `https://viluresidence.com`; legacy `https://viluresidence.net` now 301-redirects to it; Search Console Change of Address is active. Domain references below reflect this document's own point in time and are preserved as historical record — see `docs/ai/VILU_CURRENT_STATE.md` for current state.


**Status: Phase 44 foundation, established 2026-09-07.** This is a strategy and governance document — B2B growth is primarily an operational/process workstream, not a website-code workstream. It does not replace `VILU_COMPLETION_MATRIX.md` (phase status) or `VILU_DECISIONS.md` (binding rules); the governance rules in §8 are also mirrored there as the permanently-binding version. Treat this document as the working reference for actually running agency growth once outreach is owner-authorized.

**Standing principle:** direct demand remains the priority channel. Agencies are an *additional* distribution channel, not a replacement for it — see §12 (Direct vs. Agency Guardrails).

---

## 1. Existing partner-system audit (Task 1)

Classified by access tier:

**PUBLIC (viluresidence.net, no login):** Zero agency-specific content existed before this phase. A single new footer link, "Travel Agents & Partners" (`mailto:Viluresidence@gmail.com?subject=Travel%20Trade%20Enquiry`), was added — see §9. No public rates, no partner claims, no B2B landing page.

**PARTNER-ONLY (`vilu-agency-portal.html`, Firebase-Auth-gated, `agencyId==request.auth.uid` isolation enforced in `firestore.rules`):** A real, functionally mature booking system already exists:
- Agency profile (`company`, `commission`) stored per-account in Firestore.
- Per-package **agency net rate** (`agencyPricePerRoom`), separate from and lower-context than the public `pricePerRoom` — never exposed publicly.
- Admin-settable per-package commission and guest-charge split.
- Child-discount percentage, configurable per package, applied per booking.
- **Group room-block request** ("Blocked rooms are reserved exclusively for your agency and will appear as unavailable to others," subject to Vilu confirmation) — real, working group-handling capability.
- Transport labels (arrival/departure) captured per booking, same schema as direct PMS bookings.
- Booking write path goes through the same protected `writeReservation()`/`ROOM_CONFLICT` engine as direct bookings — no parallel, less-safe write path exists for agencies.

**PRIVATE INTERNAL:** Commission values, net rates, and any specific partner's terms live only in Firestore, visible only to that agency's own authenticated session and to PMS admin/staff. No commission structure, net rate, or partner name is ever rendered into public HTML, sitemap, or JSON-LD — confirmed by direct source audit this phase.

**The real gap is not the transactional system — it's everything upstream of it.** There is no self-registration (accounts are created manually by staff only — confirmed by absence of any sign-up/apply flow in `vilu-agency-portal.html`), no fact sheet, no B2B-specific trust materials, and — until this phase — no public indication that Vilu works with travel trade at all. Phase 44's real scope is this upstream layer: discovery, qualification, and the decision to onboard — not the portal itself (that's Phase 49's hardening scope, explicitly out of bounds here).

## 2. Existing relationships (Task 2)

**No confirmed active real-world agency partner relationship was found in this repository's records.** The only agency account referenced anywhere is `agency@viluresidence.com` — a bootstrap/test account (confirmed migrated to real Firebase Auth during Phase 47's security work, per `VILU_PROTECTED_CONTRACTS.md`), not evidence of a real onboarded external partner. No agency name, no specific partnership, no historical outreach record exists in any continuity doc.

**Classification: none active. None prospective (no contact has been made). None historical.** This is stated plainly rather than invented — per the phase's own explicit instruction not to guess partner status. Any future real relationship should be added to this section by name, with a status (active/prospective/historical) and a one-line factual basis, the next time this document is updated.

## 3. Global agency market map (Task 3)

Research this phase deliberately went beyond Vilu's existing direct-traffic locale list (Russia/China/Uzbekistan/Kazakhstan/Spain/Tajikistan were built for SEO purposes, not agency distribution, and are not a B2B ceiling).

**Verified, real markets/channels, roughly in order of realistic near-term fit:**

| Market/channel | Evidence | Fit for Vilu specifically |
|---|---|---|
| **Dive/wildlife wholesalers (global)** | ZuBlu and Dive Adventures (Australia) already commercially distribute near-identical small South Ari guesthouses — Bliss Dhigurah (15 rooms), Cozy Art Dhangethi (12 rooms) — bundled with whale-shark/manta product, through formal partner arrangements | **Strongest evidence found in this entire research pass.** Same atoll, same product, comparable room count already proven to work with a wholesaler |
| **India** | MakeMyTrip, Yatra, SOTC actively package Maldives local-island guesthouse stays (Maafushi, Guraidhoo) as a mainstream budget category, not a niche | Real, large, guesthouse-native market |
| **China** | #1 source market overall; Chinese travelers have the *highest* guesthouse-usage share (29.6%) of any top-10 nationality; Vilu already has live Trip.com (9.7/10) and Ctrip (维鲁公寓, 4.5/5) listings | Largest headline opportunity, but the precise agency-sourcing mechanism (do agencies book straight off Ctrip, or need a separate B2B relationship?) could not be confirmed — flagged as the single most important open question, not assumed either way |
| **Italy** | Second-highest guesthouse-usage rate (28.5%) of any source market, just behind China | Real, under-leveraged given Vilu already has full Italian localization |
| **GCC / Qatar specifically** | Visit Maldives has an explicit stated policy to grow GCC arrivals *and* spread tourism benefit into local-island communities (i.e., guesthouses); Qatar arrivals +64% | Real, policy-aligned tailwind |
| **Russia/CIS** | Named real operators exist (Level Travel, Coral Travel, Russian Express, Maldiviana); a general guesthouse+excursions budget framing exists in Russian travel media | No direct evidence any named operator currently sells *guesthouse* product specifically (vs. resort) — real channel, unconfirmed current guesthouse fit |
| **Germany / UK / Poland (charter/wholesaler tier)** | Real, large operators confirmed active in Maldives generally (FTI Group, ITAKA charter to Malé, a UK Visit-Maldives/Gold Medal B2B campaign) | Evidence found was resort/luxury-angled, not guesthouse-specific — plausible but unconfirmed for a 6-room property |
| **Honeymoon specialists** | Narrower than hoped: Secret Paradise (a real, Travelife-certified DMC built around local-island honeymoons) + Responsible Travel (UK) is a real, working example — but most named UK honeymoon specialists checked (Purely Maldives etc.) are resort-only | Real but narrow — closer to one proof-of-concept than a broad category |

**Not pursued as a priority, with reason:** GDS codes, IATA-agent commission infrastructure, FAM trip programs, and international trade-show exhibiting (ITB Berlin) are all real but resort-tier infrastructure — no direct Maamigili competitor operates at this level either, and it would be disproportionate to a six-room property's scale. Confirmed no competitor gap is being missed by skipping this tier (§14).

## 4. Agency segmentation (Task 4)

In priority order, based on the evidence in §3 and the competitor findings in §14:

1. **Wildlife/dive/adventure wholesalers** — highest-confidence fit, direct comparables already proven in South Ari Atoll.
2. **Maldives-specialist DMCs/aggregators** (e.g. Resortlife.travel-type platforms) — passive, low-effort distribution; two direct competitors (Koimala, Shamar) are already listed with one such aggregator and Vilu currently is not (§14).
3. **India-market OTAs/operators** — guesthouse product is already their mainstream category, not a hard sell.
4. **Chinese outbound agencies** — largest headline volume, but the sourcing mechanism needs direct clarification before investing effort (see open question in §3).
5. **Honeymoon specialists** — narrow but real; approach opportunistically (Secret Paradise-style DMCs), not as a broad campaign.
6. **Russian/CIS agencies** — real channel, but guesthouse-product fit with any specific named operator is unconfirmed; verify before investing outreach effort.
7. **European wholesalers (Germany/UK/Poland)** — lowest near-term confidence; resort-angled evidence only. Revisit if/when direct evidence of guesthouse-specific interest appears.

**Not pursued:** large B2B wholesalers requiring GDS/IATA infrastructure; luxury-travel specialists (positioning mismatch — Vilu is a boutique guesthouse, not a luxury product, and claiming otherwise would violate the standing no-resort-misrepresentation rule).

## 5. Ideal-partner profile (Task 5)

An attractive partner is one that:
- Already sells (or credibly could sell) local-island/guesthouse-category Maldives product, not only resorts — evidenced by their own existing catalogue, not just an assurance.
- Serves a customer segment realistic for a six-room, breakfast-included, direct-cash-payment guesthouse (wildlife travelers, budget-to-mid travelers, honeymooners seeking an authentic-not-luxury experience) — not five-star/ultra-luxury seekers.
- Communicates clearly and promptly, in a language Vilu can actually correspond in.
- Represents realistic volume for six rooms — a handful of confirmed bookings a year from a well-matched partner is more valuable than nominal "many partners, no bookings."
- Has a track record (however small) of Maldives sales, reducing the risk of a partner who doesn't understand realistic local-island logistics (speedboat transfer, no resort facilities, local dress norms) and mis-sets guest expectations.

**Volume alone is never the deciding factor** — a large agency demanding unrealistic terms or misrepresenting the product is a worse partner than a small one that sells the real product honestly (see §6).

## 6. Partner risk model / rejection criteria (Task 6)

Reject or decline to onboard a prospective partner if they:
- Demand rates below what Vilu's real cost/margin structure can sustain.
- Market or intend to market Vilu as a resort, or imply resort facilities/private-island exclusivity that don't exist.
- Promise guests a *guaranteed* wildlife sighting (whale shark/manta) — violates the standing no-guarantee rule and sets guests up for a bad experience Vilu will absorb the fallout from.
- Ask Vilu to obscure or omit real local-island rules (dress norms, no-alcohol policy, Bikini Beach designation) to make the product seem more resort-like than it is.
- Show unreliable payment history or unreasonably high chargeback/dispute risk.
- Demand exclusivity that would cut off direct bookings or other channels without commensurate guaranteed volume.
- Communicate poorly or unprofessionally in a way that would likely translate into poor guest experience.
- Require misleading imagery (retouched/staged photos implying facilities Vilu doesn't have) or fabricated claims (fake awards, invented "official partner" status without a real relationship).
- Request private operational data beyond what's needed for a booking (internal cost breakdowns, other partners' rates, PMS access beyond their own agency scope).

## 7. Partner value proposition (Task 7)

Real, factual strengths to lead with — never exclusivity or guaranteed wildlife:
- Real accommodation in Maamigili, South Ari Atoll — the guesthouse *is* the base, not a separate booking.
- Direct access to the South Ari Marine Protected Area — one of the few places worldwide with genuinely year-round whale shark presence (MWSRP-documented), plus manta ray season.
- A structured, ready-made 9-package product line (already built, already priced, already includes transfer + accommodation + breakfast + snorkeling) — an agency doesn't have to assemble a Maldives itinerary from scratch.
- A small, personally-run six-room property — genuine local-island experience, not a templated resort product.
- An already-live, multilingual (11-locale) direct booking/enquiry platform an agency's own clients can also verify independently.
- Clear, transparent public pricing and inclusions — nothing hidden, easy for an agency to explain to their own client.
- Responsive direct contact (WhatsApp/email/phone all live and monitored).

## 8. Commission governance (Task 23) — mirrored as binding in `VILU_DECISIONS.md`

- Commission and net-rate figures are **never** published publicly, in any language, on any page. They exist only inside the authenticated Agency Portal, scoped per-account.
- Only accounts explicitly created by Vilu staff/admin in the PMS may access agency rates — no self-registration exists today, and none should be added without a separate, explicit decision (that itself would be Phase 49 scope).
- Commission-eligible products are the same public 9-package catalogue plus standard room types — never a shadow/parallel product invented for agencies only.
- Transport exclusions and meal-plan terms for agency bookings follow the exact same structure already public on `holiday-packages.html` (round-trip speedboat transfer included; Half-Board/Full-Board as paid add-ons) — an agency's product is not quietly different from the public one.
- Special rates or group exceptions require explicit owner approval before being set in a partner's account — this document does not pre-authorize any specific number.
- This governance section documents *process*, not *values* — no commission percentage, rate, or specific partner term is recorded in this document or committed to the repository anywhere.

## 9. B2B product architecture / fact sheet / partner landing decision (Tasks 8–11)

**Fact sheet (Task 9):** No fact sheet or B2B PDF collateral exists yet. Not created this phase — drafting one is better done once real partner conversations are underway and the owner can confirm which facts to lead with, rather than speculatively building collateral for zero current partners. Documented as ready-to-build backlog.

**Partner landing page (Task 10) — decision: not built.** Weighed SEO value (near-zero — travel agents don't discover suppliers via public SEO the way consumers discover destinations), commercial value (low until real partners exist to reference), and privacy risk (a detailed public page invites exactly the kind of rate/term exposure the commercial rules prohibit). A full page was judged premature and not justified. Revisit once at least one or two real relationships exist and there's real content to put on such a page.

**Lead-capture (Task 11) — implemented, minimally.** Added a single footer link, "Travel Agents & Partners," to `vilu-website.html` (English + all 10 full locales + Spanish-partial), linking to a pre-filled `mailto:` enquiry (`subject=Travel Trade Enquiry`) — no form, no field collection beyond what an email naturally carries, matching the task's own preference ("a simple enquiry surface may be better than a detailed public rates page") and the site's own established convention (the same pre-filled-mailto pattern already used for package enquiries). This closes the one genuine gap found: previously there was **no way at all** for a prospective agency to know Vilu welcomes trade contact.

**B2B funnel coherence (Task 12, for Phase 49's benefit):** prospect (now has an entry point) → qualification (currently informal/manual, no defined criteria beyond this document's §5/§6) → approval (manual, staff creates the account) → portal access (works, tested, functional) → product usage (works: rates, group blocks, child discounts, booking). The weakest links for Phase 49 to eventually harden: no formal qualification checklist tool (this document is the closest thing that exists), no account lifecycle/offboarding process beyond manual `deleteUser()` (already flagged in Phase 49's own completion-matrix row), no activity/audit log for agency actions.

## 10. Outreach intelligence & message architecture (Tasks 13–14) — frameworks only, nothing sent

**No outreach has been sent.** Per explicit instruction, this section prepares reusable structures for **owner-approved future use**, not immediate execution.

**Per-segment lead-with logic:**

| Segment | Lead with | Language | Proof to offer | CTA |
|---|---|---|---|---|
| Dive/wildlife wholesaler | Year-round whale shark access, existing proven comparables (Bliss Dhigurah/Cozy Art Dhangethi model) | English | Real Google/Tripadvisor rating, package page link | Ask for their partner-onboarding process |
| Maldives DMC/aggregator | Simple property listing, real photos, real reviews | English | Same as above + property fact basics | Ask to be listed/considered |
| India OTA/operator | Ready-made, priced package line; direct transfer+stay+breakfast+snorkeling bundle | English | Package page link, reviews | Ask for their supplier-onboarding contact |
| Chinese agency | Already-live Trip.com/Ctrip presence as a trust anchor | English (per research; WeChat-as-B2B-channel unconfirmed) | Ctrip/Trip.com listing + rating | Email, not WhatsApp (blocked in mainland China) |
| Honeymoon DMC | Genuine local-island romance positioning, Honeymoon Dream Escape package | English | Package page, real photos | Package page link + enquiry |

**Message architecture (template shape, not filled-in copy to send):**
- **Email**: short subject naming the property + location + product ("Vilu Residence — Maamigili, South Ari Atoll — whale shark packages"); 3–4 sentences: who Vilu is, the one most relevant fact for that segment, a link to the real package page, an invitation to ask questions or request more detail. No attachment until a fact sheet exists.
- **WhatsApp** (only for markets where it's a normal trade channel — not China): shorter than email, same core fact + link, explicit ask ("Would this be useful for [segment] travelers you work with?").
- **LinkedIn** (where relevant, e.g. reaching a named individual at a dive wholesaler): a short connection note referencing the specific, real reason for reaching out — never a mass templated blast.

Every message must be specific, factual, and non-spammy — never a generic mass-send. **No message from these templates should be sent without separate, explicit owner authorization for that specific outreach.**

## 11. Discovery sources (Task 15)

Verified, real, accessible sources, in order of realistic near-term value:
1. **ZuBlu / Dive Adventures-style dive-travel wholesalers** — direct outreach to the same wholesalers already distributing comparable South Ari guesthouses.
2. **MATATO** (Maldives Association of Travel Agents and Tour Operators) — real, open-membership local trade body; a legitimate networking entry point into the *Maldivian* trade side.
3. **Travel Trade Maldives (TTM)** — a real, Visit-Maldives-endorsed, in-country annual B2B trade show with open exhibitor registration and a pre-scheduled-meetings platform ("TTM Connect"). The single most concrete, locally-accessible discovery mechanism found, since it doesn't require Vilu to travel internationally.
4. **Direct search** (Google, and for Russian-market prospects, Yandex) for named Maldives-specialist agencies in target segments.
5. **LinkedIn**, for reaching specific named individuals at wholesalers/DMCs once identified elsewhere — not as a cold-blast channel.

**Deliberately not pursued, with reason:** ITB Berlin (real, but international-travel-cost-heavy for a six-room property, disproportionate to scale); generic B2B travel marketplaces (TBOHolidays-type — plausible but unverified fit for a Maldives guesthouse specifically, lower priority than the four above).

## 12. Country/language fit (Task 16)

No new localization is proposed for B2B prospecting. Existing locales cover every market segment identified as realistic in §3/§4: English (dive wholesalers, India operators, most DMCs), Chinese (already live, matches Trip.com/Ctrip presence), Russian (already live), German/Italian/French (already live, covers the European wholesaler tier if pursued later), Arabic (covers GCC outreach if pursued). Spanish remains partial by design — no new Spanish B2B content proposed.

## 13. Market-specific findings (Tasks 17–21)

- **China (Task 17):** Builds on Phase 27. Do not assume WhatsApp — it's blocked in mainland China; email is the correct default B2B channel, consistent with Phase 27's public-facing email-primary CTA decision. Real open question, not resolved this phase: whether Chinese agencies typically source guesthouse inventory directly off Ctrip/Trip.com listings (which Vilu already has) versus requiring a separate B2B relationship. Recommend clarifying this directly (e.g. via Ctrip's own supplier support) before investing outreach effort here.
- **Russia/CIS (Task 18):** Builds on Phases 26/28/29/31. Real named operators exist, but no direct evidence any currently sells guesthouse-category product — verify fit with a specific operator before broad outreach. No new country-specific pages proposed; the existing country-neutral Russian locale remains adequate (consistent with Phase 31's own conclusion).
- **Europe (Task 19):** Real large-scale operators exist (Germany, UK, Poland) but evidence found skews resort/luxury, not guesthouse. Lower near-term priority than dive wholesalers or India operators; do not over-invest here without a confirmed guesthouse-fit signal.
- **Honeymoon (Task 20):** Real but narrow — Secret Paradise/Responsible Travel is close to a category of one. Approach opportunistically if a similar operator surfaces; do not overstate Vilu's romantic/luxury positioning to fit a resort-oriented specialist's usual catalogue.
- **Wildlife/dive/adventure (Task 21):** The strongest, best-evidenced channel in this entire research pass — real wholesalers already distribute near-identical South Ari guesthouses. Vilu's own excursions (whale shark/manta snorkeling, run directly, not via a third-party dive center) must be clearly distinguished from any third-party dive operation a wholesaler might otherwise assume — never imply a dive-center certification or affiliation Vilu doesn't have.

## 14. Competitor B2B intelligence (Task 28)

Real, sourced findings — not speculation:
- **No direct Maamigili competitor (Whale Shark Inn, Shamar, Koimala, La Cabana) has built agency-facing materials or a trade portal of their own.** Vilu's existing (if empty-of-partners) Agency Portal already exceeds this baseline.
- **However, two competitors — Koimala Inn and Shamar Guest House & Dive — are already listed with a real Maldives DMC/aggregator (Resortlife.travel), giving real agents access to net rates for those two properties today, with zero apparent active marketing effort by either guesthouse.** Vilu is not currently listed with this or any comparable aggregator — a real, concrete, immediate gap, more specific than "no one does this."
- Resort-tier B2B infrastructure (GDS codes, IATA-agent commissions, FAM trips, PDF fact-sheet catalogues, dedicated sales platforms) is a full ecosystem no local guesthouse-tier competitor operates in — confirmed disproportionate to pursue at Vilu's scale.
- OTA-adjacent "supplier" programs (GetYourGuide, Viator) are experience/activity platforms, not hotel-agency distribution channels — not a relevant B2B layer for accommodation.

**Realistic differentiation, in order:** (1) match Koimala/Shamar's baseline by getting listed with a comparable DMC aggregator — parity, not innovation, and low-effort; (2) build a simple one-page agent fact sheet/property overview — genuinely a first among direct competitors, real differentiation at proportionate cost; (3) do not pursue GDS/FAM/trade-show infrastructure — mismatched to scale, no competitor gap exists there to close.

## 15. Trust/proof for partners (Task 27)

Real assets already available to reference (no fabrication needed): Google Business Profile (5.0★, 81 reviews, verified via live authenticated access in Phase 33), Tripadvisor listing, live Trip.com (9.7/10) and Ctrip (维鲁公寓, 4.5/5) listings, verified Google Maps presence (stable CID link), destination authority content (11 guide pages, Phase 35–38 E-E-A-T/entity work), transparent public package pricing. No fake testimonial or partner-logo wall exists or should be created.

## 16. CRM / performance-tracking handoff (Tasks 24–25)

**Not built this phase — explicitly a Phase 40/41 (or later Growth Operations) implementation, documented here as the handoff spec:**

Prospect stages: `identified → researched → contacted → responded → qualified → approved → active → inactive → high-value`.

Performance metrics once partners are active: enquiries generated, bookings converted, revenue, average stay length, package mix, cancellation rate, payment reliability, guest quality/complaint rate, repeat business. **Avoid vanity metrics** — partner count alone is not a success measure; a small number of high-value, reliable partners outperforms a large number of low-quality ones.

## 17. Direct-vs-agency guardrails (Task 26) — mirrored as binding in `VILU_DECISIONS.md`

- Agency growth must never come at the expense of direct-booking economics — do not set agency terms that make direct guests worse off or create incentive to route guests away from direct booking recklessly.
- No single partner may be given exclusivity over Vilu's own product without a specific, separate owner decision — the guesthouse's own direct channels and multiple agency relationships should coexist.
- Vilu's own brand (name, positioning, real facts) must remain visible in how any partner represents the product — never white-labeled into invisibility.
- Success is measured by net value (bookings, revenue, guest quality) generated per relationship, not gross partner count or gross booking volume alone.

## 18. Commercial-maturity assessment (Task 29)

Scored against a professional small-hotel/travel-platform standard:

| Dimension | State |
|---|---|
| Partner proposition | **Defined this phase** (§7) — real, factual, non-exaggerated |
| Materials | **Gap** — no fact sheet exists yet (documented as backlog, §9) |
| Qualification | **Defined this phase** (§5/§6) — no formal tool, but real criteria now exist |
| Communication | **Adequate** — real, monitored WhatsApp/email/phone already live |
| Portal (transactional) | **Mature** — rates, commission, group blocks, child discounts all working |
| Tracking/CRM | **Gap, handoff documented** (§16) — not built, correctly deferred |
| Performance measurement | **Gap, model documented** (§16) — no data yet since no partners exist |
| Risk controls | **Defined this phase** (§6) |
| Follow-up readiness | **Gap** — no defined process for what happens after a partner enquiry arrives beyond normal staff judgment |

**Overall:** the transactional foundation is genuinely mature; the strategic/governance layer was the real gap and is now filled by this document; physical materials (fact sheet) and tooling (CRM) remain real, correctly-deferred backlog items, not blockers to calling Phase 44 itself complete (per the phase's own completion standard, which explicitly excludes "future agencies haven't replied yet" from PARTIAL status).

## 19. Implementation decision (Task 30)

**Outcome: F — combination of A (documentation/process, this document) and C (a restrained partner enquiry surface, §9).** B (materials/fact sheet) and D (portal entry-path improvement) were considered and correctly deferred — B because there's no real partner yet to justify producing collateral, D because it's explicitly Phase 49's scope. E (outreach templates) was produced as frameworks only, per Task 31's explicit prohibition on actually sending anything.

---

*This document should be revisited and updated (never silently superseded) whenever: a real agency relationship is established (add to §2), new market research changes the picture in §3/§4, or the owner authorizes moving from framework (§10) to actual outreach.*
