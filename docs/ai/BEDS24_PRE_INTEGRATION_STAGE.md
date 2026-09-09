# Vilu PMS — Beds24 Pre-Integration Stage

Date: 2026-09-09 · Preparation only · No OTA connected · No secret created · No external call made.
Builds on `OTA_READINESS_AUDIT_2026-09-09.md` (Part 10-12 hold the original Beds24/Booking.com/Expedia/Agoda research this doc doesn't repeat). Room-allocation reconciliation against Cloudbeds (same day) found 0 mismatches across 29 records / 48 room-level allocations — see that session's report; not restated here.

## 1. OTA room-type commercial model — what was built

New, undeployed, pure-function module `functions/lib/ota-room-types.js` (18/18 tests, `test/ota-room-types.test.js`), plus two new additive Firestore collections (`ota_room_types`, `ota_room_type_overrides`; staff/admin read+write, deployed, and re-verified with a dedicated 16/16 Firestore-emulator rules test — `test/ota/ota-room-types-rules-repro.js`) initialized with exactly the owner-locked values below. Nothing reads or writes these collections in production yet — `enabled: false` on all three, and no Cloud Function references this module.

| room_type_id | physical_rooms | base_rate | currency |
|---|---|---|---|
| `deluxe_family` | VR01, VR02 | $80 | USD |
| `double` | VR03, VR04, VR05 | **$90** | USD |
| `open_deck` | VR06 | $90 | USD |

The Double OTA rate ($90) is deliberately **not** VR03/VR04's physical PMS rate ($85) — this is the owner's resolution of the VR03/VR04-vs-VR05 rate split raised in the earlier preparation pass (option B: publish VR05's rate for the pooled type). Physical PMS rates are unchanged: VR01/VR02 $80, VR03/VR04 $85, VR05/VR06 $90.

Restrictions: `min_stay=1`, `max_stay=null` (no cap), `closed_to_arrival=false`, `closed_to_departure=false`, `availability_buffer=0`, all three types. **Updated 2026-09-09 (Steps 3-7 of the gap-closure pass)**: `booking_window_days=365` and `same_day_cutoff={time:'12:00', timezone:'Indian/Maldives'}` are now owner-locked (were `null`); `tax_mode=net_of_tax` is owner-locked. `occupancy_model`/`child_pricing_model` are now structured (`status:'owner_pending'` with every leaf value still `null`) rather than bare `null`, so the schema can express base/single/extra-adult occupancy pricing and child age-band supplements once the owner decides, without inventing values now. `cancellation_policy_status='owner_pending'` (renamed from the old bare `cancellation_policy: null` field). `meal_plan_mapping={intent:'breakfast_included', ota_mapping:null}` (see §5). Still fully unresolved, explicit `null`: `commission`. All three live Firestore docs were re-written and read back to confirm these values (Step 7) — see the final report for the confirmed field-by-field readout.

`computeOtaTypePayload()` derives the outbound record from (config, an optional date-level override, and the real physical `numAvail` already computed by the existing, untouched `availability.js`) — it never recomputes occupancy itself, so the physical-room lock stays the only conflict authority. `stopSell` is always derived (real inventory reaching 0, or a `manual_stop_sell` staff override), never a value trusted from storage as-is.

## 2. Tax mapping — corrected 2026-09-09, verified against current official documentation

**This section replaces an earlier (2026-09-09, same-day) finding that inferred "no field exists" from the Beds24 ARI endpoint alone.** The owner explicitly required that conclusion be re-verified against current official Beds24 and Booking.com documentation before anything is implemented or published — not inferred from the ARI rate endpoint alone. It has now been re-verified directly against the live Beds24 Wiki (`wiki.beds24.com/index.php/Upsell_Items`, revision `oldid=26099`, fetched and read in full 2026-09-09) and Booking.com's official Connectivity/Demand API docs (`developers.booking.com`, fetched 2026-09-09). The conclusion changes materially — see below. **Nothing has been implemented, configured, or published anywhere as a result of this research; it is a documentation finding only, per Step 2's explicit instruction not to silently gross-up the room rate or connect anything.**

Owner-locked: OTA base rates are **net-of-tax**; the live PMS still applies 10% service charge + 17% TGST + $6 Green Tax per adult/child per night on top for direct/agency bookings. Green Tax must stay a separate line, never folded into the base rate.

### 2.1 Beds24 — CAN represent a per-adult/per-night obligatory tax, but only for its own direct booking engine

Beds24's Wiki documents an **Obligatory Tax** Upsell Item type (`SETTINGS > BOOKING ENGINE > UPSELL ITEMS`) with a `Per` field that includes `Booking`, `Room`, `Person`, and `Adult`, and a `Period` field that includes `One time` and `Daily`. The wiki's own worked example ("City Tax charged for first 7 nights only") configures exactly this shape:
> "Type = Obligatory Tax", "Amount = (enter per person/adult/day) value", "Per = Adult", "Period = Daily", "Description = City Tax"

This is structurally identical to Vilu's Green Tax ($6/adult/night, occupancy-dependent, mandatory). **So the earlier finding that "Beds24 has no per-guest tax field" was wrong** — it does, via Upsell Items, not via the ARI push API.

**But this only applies to bookings made through Beds24's own hosted direct-booking page.** The same Wiki page states, in its own header banner:
> "Upsell Items can not be exported to OTAs. If required you can set them up directly in the channel."

And Beds24's own Booking.com integration documentation states specifically:
> "For Booking.com specifically, extras taxes and fees will not automatically send or update. Set/change these in your Booking.com Extranet unless you want to manage your full Booking.com content from Beds24."

Vilu does not sell through Beds24's own booking page (Vilu's direct channel stays on `viluresidence.web.app`/the existing PMS) — so this Beds24-side mechanism, while technically capable, is **not the path an OTA-sourced (Booking.com) guest's Green Tax would travel through**.

### 2.2 Booking.com — has its own native per-person-per-night charge mechanism, independent of Beds24

Booking.com's Connectivity API documentation (`developers.booking.com/connectivity/docs/charges-api/manage-property-room-charges`) — distinct from the read-only Demand API `charge-calculation` docs consulted in the earlier pass — describes a **Charges API** (`POST https://supply-xml.booking.com/charges-api/properties/{property_id}/charges`) with an explicit `PER_PERSON_PER_NIGHT` charge mode:
> "Applies a charge that is effective per person per night. For example, for a 2-person on a 3-night stay, the charge is applied 6 times."

and an `excluded` field: "Specifies if the charge is included or excluded from the room rate" — i.e. Booking.com's own charge model natively supports keeping a per-person-per-night fee as a separate line, matching Vilu's net-of-tax requirement, rather than forcing it into the base rate.

This Charges API sits alongside Booking.com's Connectivity/Provider-Portal ecosystem — the same family of API a channel manager (like Beds24) integrates with — rather than something an individual property calls directly. **Whether Beds24 has actually implemented a call to Booking.com's Charges API on a property's behalf is not stated anywhere in Beds24's own documentation**, and Beds24's explicit guidance above ("extras taxes and fees will not automatically send or update... set/change these in your Booking.com Extranet") is strong evidence it does not today — if it did, Beds24's own docs would say the tax syncs automatically.

### 2.3 What this means, verified rather than guessed

- Beds24 **cannot** be relied on to push Vilu's $6/adult/night Green Tax through to Booking.com automatically — confirmed directly from Beds24's own documentation, not inferred.
- Booking.com **does** have a native mechanism (`PER_PERSON_PER_NIGHT` Charges API, or the equivalent Extranet UI under Property → Policies/Taxes & Fees) capable of representing this fee correctly and keeping it excluded from the base rate — confirmed directly from Booking.com's own documentation.
- The two systems are **independently configured**. The correct, verified architecture is: configure Green Tax directly on the Booking.com Extranet (or via Booking.com's Accommodation Services team if the Maldives government-fee category requires their review — this is exactly what Beds24's own docs point to), not through Beds24. Beds24 remains the channel for rate/availability sync only; tax-line configuration for Booking.com happens on Booking.com's own side, matching how Beds24 itself describes the relationship.
- **Genuine open question, not resolved from documentation alone and not guessed here**: whether Booking.com's self-service Extranet UI actually exposes `PER_PERSON_PER_NIGHT` fee creation for a Maldives-based property, or whether it requires a request to Booking.com's Accommodation Services/support team. This can only be confirmed once the owner has trial/live Booking.com Extranet access — flagged as a remaining owner-facing step, not assumed either way.
- TGST (17%) and service charge (10%) remain simple percentages, which every OTA and Beds24 itself handle cleanly (Beds24: `Obligatory Percentage Tax` Upsell Item type, `Per = Room`; Booking.com: percentage-mode Charges API entry) — no gap there, unchanged from the earlier pass.

No live rate, tax, or fee configuration has been created anywhere — Beds24, Booking.com, or Vilu's own PMS. This section documents the verified representability of the fee; it does not decide which of Beds24-direct vs Booking.com-native the owner ultimately wants configured, since Beds24-direct doesn't apply to OTA-sourced Booking.com guests at all per §2.1.

Sources consulted (fetched 2026-09-09): [Upsell Items — Beds24 Wiki](https://wiki.beds24.com/index.php/Upsell_Items), [Managing Charges — Booking.com Connectivity API docs](https://developers.booking.com/connectivity/docs/charges-api/manage-property-room-charges), [Extra charges calculation and conditions — Booking.com Demand API docs](https://developers.booking.com/demand/docs/accommodations/charge-calculation).

## 3. Beds24 API v2 — field-mapping validation

Cross-checked the new schema against the Beds24 API v2 details already researched (audit Part 11, official docs, seen 2026-09-09 — not re-fetched here since that research is same-day and unchanged):

| Our field | Beds24 `/inventory/rooms/calendar` field | Fit |
|---|---|---|
| `numAvail` | `numAvail` | direct |
| `rate` | `price1` (or `price1`-`price16` for rate plans) | direct |
| `minStay` | `minStay` | direct |
| `maxStay` | `maxStay` | direct |
| `closedToArrival` / `closedToDeparture` | `override.noCheckIn` / `override.noCheckOut` (Beds24's naming) | direct, rename only |
| `stopSell` | `override.stopSell` (or `numAvail:0`, Beds24 accepts either) | direct |
| Green Tax / TGST / service | *(no ARI field — the periodic push endpoint has no tax field at all)* | see §2 and the Step 8 matrix in §6 — TGST/service map to Beds24's `Obligatory Percentage Tax` Upsell Item (direct-booking only); Green Tax to OTA guests routes through Booking.com's own Charges API / Extranet, not through Beds24 |

Beds24 room mapping (which physical Beds24 "room" = which Vilu OTA type) happens once in the Beds24 control panel after account creation, not via API — matches our 3-type model exactly (3 Beds24 rooms, quantities 2/3/1), no code change needed there. Everything else in the audit's Part 6/7/8 (idempotency, revision handling, deterministic room assignment, conflict quarantine, re-pull-on-webhook) remains architecturally current in `functions-ota/` — reviewed today, no code changes required by anything Beds24-specific found in this pass.

## 4. Real-Beds24 test plan (prepared, not run — no Beds24 account exists yet)

Extends the existing 15-scenario `MockAdapter`-based suite (`test/ota-core.test.js`, still 20/20) with Beds24's real payload shape once a trial account exists:

| # | Test | Beds24-specific detail |
|---|---|---|
| 1 | New reservation | verify `booking.id` → our `external_id`, `modifiedTime` → our revision |
| 2 | Duplicate webhook | Beds24 webhooks are undocumented for retry/ordering — must be harmless regardless |
| 3 | Duplicate re-pull (`GET /bookings/{id}`) | confirms re-pull-not-trust-payload design holds against real API shape |
| 4 | Stale revision | older `modifiedTime` arriving after a newer one is ignored |
| 5 | Modification | date change, room re-assignment, lock moved |
| 6 | Date extension | availability recompute both old and new ranges |
| 7 | Date shortening | same |
| 8 | Room-type change | e.g. Double → Deluxe Family mid-modification |
| 9 | Cancellation | idempotent, lock released |
| 10 | Duplicate cancellation | no-op, no error |
| 11 | Physical-room conflict | Beds24 booking arrives for a type with 0 sellable rooms left |
| 12 | No free physical room | quarantined to `ota_conflicts`, never forced |
| 13 | Out-of-order events | cancel arriving before its own modify |
| 14 | Beds24 API failure (timeout/5xx) | retry queue, exponential backoff, no crash-loop |
| 15 | Reconciliation recovery | `otaCatchUp` poll closes a gap after a missed webhook |
| 16 | Rate limit (100 credits/5 min) | confirm our push batching respects Beds24's own limit header |

Pass criteria unchanged from the original plan: zero duplicate reservations, zero oversell, across all scenarios.

## 5. Meal plan — "Room + Breakfast" (Step 4, 2026-09-09)

Vilu's current product is room rate inclusive of breakfast. The OTA schema now carries this as intent only: `meal_plan_mapping: { intent: 'breakfast_included', ota_mapping: null }` on all three `ota_room_types` docs — no live OTA rate-plan mapping has been created, matching the owner's instruction not to create extra meal plans or a live mapping this pass.

What will eventually be required, documented for when the owner is ready (not done here):
- **Beds24 side**: a channel manager rate plan needs a `Board`/meal-plan code set on the room/rate the ARI push targets. Beds24's rate-plan configuration (`SETTINGS > PRICES`) supports assigning a board basis per rate plan; for a single always-included breakfast (not an optional add-on), the simplest mapping is one rate plan per OTA room type with board = "Breakfast Included", rather than a second, breakfast-excluded rate plan — matching that Vilu sells one product, not a room-only vs room+breakfast choice.
- **Booking.com side**: board type is a property/room-level setting under the Extranet's "Rates & Availability → Policies" (or the equivalent Connectivity API rate-plan `board` field once available via Beds24), separate from the pricing sync itself — Booking.com needs to know the published rate already includes breakfast so it doesn't double-list it as a paid extra.
- No code change is needed for this now: `meal_plan_mapping.ota_mapping` stays `null` until the owner confirms the Beds24 rate-plan board configuration during/after trial signup.

## 6. Beds24/Booking.com tax & fee technical matrix (Step 8, 2026-09-09)

Concise summary of §2-§3's findings, for the owner to review before any Beds24 trial signup. "Supported?" reflects what is verified from official documentation today, not what's configured — nothing below has been implemented or connected.

| Setting | Beds24 field/control | Booking.com equivalent | Where configured | API or extranet | Supported? | Risk |
|---|---|---|---|---|---|---|
| Room rate ($80/$90/$90, net-of-tax) | `price1` via `/inventory/rooms/calendar` | Room rate field, Connectivity/Demand API | Beds24 control panel → pushed via ARI sync | API (periodic push) | Yes | None — already the model built in `functions/lib/ota-room-types.js` |
| Service charge (10%, %-based) | `Obligatory Percentage Tax` Upsell Item, `Per = Room` | Percentage-mode charge, Charges API/Extranet | Beds24 direct-booking only; Booking.com side configured independently | Beds24: control panel only (not pushed). Booking.com: Charges API or Extranet | Supported on each side independently; **not synced between them** | Must be configured twice (Beds24 for direct, Booking.com for OTA) or accepted as Beds24-direct-only |
| TGST (17%, %-based) | Same as service charge, separate Upsell Item | Same as service charge | Same as service charge | Same as service charge | Supported on each side independently; **not synced** | Same as service charge |
| Green Tax ($6/adult/night, occupancy-dependent) | `Obligatory Tax` Upsell Item, `Per = Adult`, `Period = Daily` | `PER_PERSON_PER_NIGHT` charge mode, Charges API (`excluded: true` keeps it a separate line) | Beds24: direct-booking only (never exported to OTAs — confirmed, §2.1). Booking.com: Extranet "Policies → Taxes & Fees" or Accommodation Services team | Beds24: control panel only. Booking.com: Charges API (channel-manager-side) or Extranet (self-service, scope unconfirmed for Maldives govt fees) | Representable on each side individually; **cross-platform sync from Beds24 to Booking.com is NOT supported** (verified, not inferred) | Highest risk item — if configured only in Beds24, a Booking.com-sourced guest never sees Green Tax disclosed pre-booking; must be configured directly on Booking.com's side, independent of Beds24 |
| Tax included/excluded flag | `tax_mode` field on `ota_room_types` (owner-locked `net_of_tax`) | `excluded` boolean on each Charges API entry | Both sides need the flag set consistently to `excluded: true` / net | Beds24: n/a (Beds24 doesn't push tax). Booking.com: Charges API/Extranet | Supported | If Booking.com's flag is ever set to "included", the $80/$90 rate would silently absorb Green Tax — must be explicitly checked at Booking.com setup time |
| Breakfast included | Rate-plan board basis (see §5) | Extranet "Policies" board type | Beds24 rate-plan config; Booking.com Extranet | Both extranet/control-panel, not the periodic ARI push | Supported | Low — a mislabeled board just shows as a paid extra on the OTA side until corrected, no under/over-collection |
| Commission | *(not modelled — `commission: null`)* | Standard OTA commission, deducted at OTA level, not a Vilu-configured field | Booking.com Extranet contract terms | n/a — OTA-side accounting, not pushed by Beds24 | Out of scope for this schema | None — commission never touches the published rate or tax lines |
| Child/infant tax handling | No native age-band logic; the wiki's only example is a *display-label* substitution ("Children" → "Children under 10"), not a computed exemption | Not yet researched — Booking.com Charges API doc excerpts consulted here didn't cover age-based exemptions | Would need further research before this is relied on | Unconfirmed | **Not verified — do not assume supported.** Matches the owner's Step 6 instruction to keep `child_pricing_model` fully pending | If ever implemented without real per-platform verification, risks over/under-charging exempt infants — flagged, not solved, here |

**Bottom line proving (or not) that $80/$90 base OTA rates + Vilu's taxes/fees reach the guest correctly**: the room rate itself is provably correct (direct pass-through, already tested in `ota-room-types.test.js`). Service charge and TGST are provably representable on each platform, but require separate one-time configuration per platform — no code risk, a pure setup task. **Green Tax is the one item that cannot be pushed automatically from Beds24 to Booking.com and must be configured directly on Booking.com's own side before go-live**, or guests booking via Booking.com will not see it disclosed and Vilu will need to collect it at check-in instead (a real but bounded, and now explicitly flagged, gap — not a silent one).

## 7. Beds24 trial account — signup steps (Step 9, prepared, not performed)

**Not started — no account created, no identity or payment information submitted, nothing accepted on the owner's behalf.** These are the exact steps for the owner to perform themselves when ready:

1. Go to `beds24.com` and select "Start Free Trial" (or the equivalent current signup CTA on Beds24's own site — verify the exact button text at signup time, since marketing pages change).
2. Enter the property's own business/contact details (property name, owner's own email, phone, country = Maldives) — the owner's identity, not this session's.
3. Complete Beds24's email verification step.
4. Inside the new Beds24 control panel, create the property profile: property name, address, room types (map to the 3 Vilu OTA types — `deluxe_family`/`double`/`open_deck`, quantities 2/3/1) and base currency USD.
5. Generate an API v2 authentication setup: Beds24 control panel → account/API settings → generate an invite code, then exchange it for a refresh token via `POST /authentication/setup` (per Beds24 API v2 docs already reviewed in §3/earlier audit).
6. Hand the resulting refresh token to this session (or store it directly) **only when the owner is ready to proceed past this pre-integration stage** — it becomes `BEDS24_REFRESH_TOKEN` in Secret Manager. Not created, not requested, not stored anywhere in this pass.
7. Billing: Beds24 trials run free for an initial period; the owner will need to enter payment details directly with Beds24 only if/when they choose to continue past the trial — this session will not do this step under any circumstance.
8. Only after steps 1-6 above **and** the owner's own explicit decisions on the fields still marked `owner_pending`/`null` in `ota_room_types` — `cancellation_policy_status` (free-cancellation window, late-cancellation charge, no-show charge, prepayment/deposit, pay-at-property behavior), `occupancy_model`, `child_pricing_model`, and `commission` — would the next session be authorized to deploy `otaWebhook`/`processOtaEvent`/`otaCatchUp` and begin a real, sandboxed Beds24 connection. Not authorized by this task.

VILU BEDS24 PRE-INTEGRATION STAGE — PREPARATION DOCUMENTED — NO LIVE OTA CONNECTION MADE
