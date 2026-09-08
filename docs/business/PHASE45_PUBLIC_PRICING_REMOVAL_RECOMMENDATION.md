# Recommendation: remove all individual public activity prices (private, planning only — not executed)

**PRIVATE — internal use only, never published.** Excluded from hosting via `firebase.json`'s `docs/**` ignore rule. This document is a *plan for the owner to approve, reject, or modify* — no public file has been changed as a result of it. Matrix Phase 45 ("Vilu Voyager").

## 1. What exists publicly today (full audit, 2026-09-08)

| Item | Public location(s) | Current public price | Type |
|---|---|---|---|
| Whale Shark Snorkeling | `whale-shark-snorkeling.html` (quick-facts label, FAQ answer, body copy, JSON-LD `Offer.price`) + all translated locale mirrors | USD 85 pp | Individual excursion |
| Manta Ray Snorkeling | `manta-ray-snorkeling.html` (same 4 touch points) + locale mirrors | USD 85 pp | Individual excursion |
| Half-Board meal upgrade | `holiday-packages.html`, "Optional Add-Ons" on all 9 package cards + `PACKAGES` JS array + locale mirrors | $25/day | Individual add-on |
| Full-Board meal upgrade | same locations as above | $40/day | Individual add-on |
| Professional Photography | same locations (appears on most, not all, package cards) | $25/hour | Individual add-on |
| Private Island Picnic | same locations (appears on some package cards) | $51/person | Individual add-on |
| Domestic flight transfer | Homepage booking widget label ("$110 per person") **and** a separate homepage JS data object (`transport_arrival_flight: price:'$155 / person, one-way'`) | $110 **and** $155 — two different figures already live on the same page | Transport add-on, not an excursion, but flagged for awareness since it's the same public/private inconsistency already flagged in the private Voyager guide |

**Not public anywhere, confirmed by direct audit**: Big Game Fishing, Sandbank Escape, Nurse Shark Snorkeling, Dolphin Cruise (as a standalone-priced item — it appears only as an unpriced package inclusion), Turtle Snorkeling (standalone), Octopus/Lobster Hunting, Sunset Cruise (standalone), Picnic Island Experience (Voyager's $49 version), Night Fishing (standalone), the three named reef-snorkeling sites, Romantic Beach Dinner, Cinema at the Beach. `things-to-do-maamigili.html` already names most of these activities with **no price**, each with a WhatsApp enquiry link — i.e., the enquiry-first pattern this recommendation proposes extending already exists there today.

**Explicitly out of scope, unchanged by this recommendation**: all 9 locked holiday-package total prices ($450–$1300), all locked room rates (Garden Deluxe $85, Garden $80, Premium $90 — as labeled in the live booking widget), and everything about package inclusions/speedboat/flight-exclusion wording.

## 2. Proposed removal plan, if approved

### 2a. Whale Shark & Manta Ray pages
Replace, in English and all translated locales:
- Quick-facts price label ("USD 85 pp") → a non-numeric label, e.g. "Available by enquiry" or "Ask for current pricing."
- FAQ answer stating the price → reworded to direct guests to enquire (e.g., "Pricing is provided directly when you enquire or as part of a holiday package — message us on WhatsApp or by email for current availability and rates.").
- Body-copy sentence ("bookable on its own from USD 85pp") → reworded to an enquiry CTA without a number.
- JSON-LD `Offer.price` → **requires a technical decision, not just a copy edit** (see §3 below).

### 2b. Holiday-packages page add-ons
Replace the four "Optional Add-Ons" price strings (Half-Board, Full-Board, Photography, Private Island Picnic) across all 9 package cards' visible HTML and the `PACKAGES` JS array, in English and all locales, with enquiry-first wording (e.g., "Half-Board — ask us to add this" or a single line under the add-ons list: "Add-on pricing available on request"). The **package totals themselves stay untouched** — only the four add-on line items change.

### 2c. Homepage domestic-flight transfer
Two options, an owner decision either way: (i) fix the $110-vs-$155 inconsistency to one correct figure (a separate, narrower question from "remove all activity prices," since a flight transfer isn't an excursion), or (ii) fold it into the same enquiry-first treatment as the other add-ons if the owner wants zero individual dollar figures on the public site at all, transport included.

## 3. JSON-LD / structured-data consequence — a real technical tradeoff, not just a wording change

`whale-shark-snorkeling.html` and `manta-ray-snorkeling.html` each carry a schema.org `Product`/`Offer` block with `"price": "85"`. This is exactly what Phase 35's own "Google Merchant listings" fix (2026-09-07) added `image` and `brand` to, specifically so these two pages would validate as real Merchant/Product rich results — confirmed live at the time via Google's Rich Results Test with zero critical errors.

Schema.org's `Offer` type has no fully valid way to describe "this item is for sale, price on request" the way a shop listing usually expects — the two realistic options are:
- **Remove the `Product`/`Offer` block entirely** from both pages. This is clean and honest (no misleading structured data) but gives up the Merchant/Product rich-snippet eligibility Phase 35 deliberately built. `test/structured-data-merchant.test.js` (30/30 today) would need its assertions for these two pages updated to expect no Product block, not just a fix.
- **Keep a lighter schema type** (e.g., `TouristAttraction` or a plain `Service` entry, neither of which requires a price) in place of `Product`/`Offer`. This keeps *some* structured-data presence for these pages without a price claim, at the cost of losing the specific Merchant-listing surface.

Either is defensible; this document does not choose one — it is exactly the kind of tradeoff that needs the owner's sign-off before touching schema that's already been through a dedicated SEO fix.

## 4. Test/build impact if approved

- `test/structured-data-merchant.test.js` (30/30) — assertions for the whale-shark/manta Product/Offer blocks would need deliberate updates, not silent breakage.
- `test/cro-conversion.test.js`, `test/china-cta-priority.test.js` — may assert current CTA/price text; would need review.
- `build-i18n-pages.js` — the add-on/price strings live in `i18n/*.json` for every full locale; changing the English source string requires the matching translated string in all 11 locale dictionaries, then a full `node build-i18n-pages.js` rebuild before deploy.
- A scoped Hosting-only deploy (never touching Firestore/Storage rules) would be the deployment path, per the existing deployment-safety rules.

## 5. Why this is a recommendation, not an action

Removing the whale-shark/manta $85 figures reverses a decision the owner separately, explicitly reconfirmed as recently as this same day ("The dedicated public Whale Shark and Manta pages historically showed... Those two pre-existing prices were separately approved to remain public for now"). This document exists so that if/when the owner decides to revisit that specific approval, the exact scope, every touch point, the locale-propagation requirement, and the real JSON-LD tradeoff are already mapped — not so that any of it happens automatically.

## Owner decision needed

1. Approve, reject, or modify removing the Whale Shark/Manta USD 85 prices (§2a) — this is the one item the owner has separately approved to stay public "for now," so it needs its own explicit go-ahead to change, distinct from the rest of this plan.
2. Approve, reject, or modify removing the four package add-on prices (§2b).
3. Choose a JSON-LD approach for §3 if §2a is approved — remove the Product/Offer block, or replace it with a non-priced schema type.
4. Decide on the homepade domestic-flight figure (§2c) — a separate, narrower fix (pick $110 or $155) versus folding it into a no-numbers policy.

## Files changed

New: `docs/business/PHASE45_PUBLIC_PRICING_REMOVAL_RECOMMENDATION.md` (this file). No public file touched.
