# Vilu PMS — Beds24 Pre-Integration Stage

Date: 2026-09-09 · Preparation only · No OTA connected · No secret created · No external call made.
Builds on `OTA_READINESS_AUDIT_2026-09-09.md` (Part 10-12 hold the original Beds24/Booking.com/Expedia/Agoda research this doc doesn't repeat). Room-allocation reconciliation against Cloudbeds (same day) found 0 mismatches across 29 records / 48 room-level allocations — see that session's report; not restated here.

## 1. OTA room-type commercial model — what was built

New, undeployed, pure-function module `functions/lib/ota-room-types.js` (13/13 tests, `test/ota-room-types.test.js`), plus two new additive Firestore collections (`ota_room_types`, `ota_room_type_overrides`; staff/admin read+write, deployed) initialized with exactly the owner-locked values below. Nothing reads or writes these collections in production yet — `enabled: false` on all three, and no Cloud Function references this module.

| room_type_id | physical_rooms | base_rate | currency |
|---|---|---|---|
| `deluxe_family` | VR01, VR02 | $80 | USD |
| `double` | VR03, VR04, VR05 | **$90** | USD |
| `open_deck` | VR06 | $90 | USD |

The Double OTA rate ($90) is deliberately **not** VR03/VR04's physical PMS rate ($85) — this is the owner's resolution of the VR03/VR04-vs-VR05 rate split raised in the earlier preparation pass (option B: publish VR05's rate for the pooled type). Physical PMS rates are unchanged: VR01/VR02 $80, VR03/VR04 $85, VR05/VR06 $90.

Restrictions: `min_stay=1`, `max_stay=null` (no cap), `closed_to_arrival=false`, `closed_to_departure=false`, `availability_buffer=0`, all three types. Still explicitly `null` (owner policy pending, not invented): `booking_window_days`, `same_day_cutoff`, `occupancy_model`, `child_pricing_model`, `commission`, `cancellation_policy`, `meal_plan_mapping`.

`computeOtaTypePayload()` derives the outbound record from (config, an optional date-level override, and the real physical `numAvail` already computed by the existing, untouched `availability.js`) — it never recomputes occupancy itself, so the physical-room lock stays the only conflict authority. `stopSell` is always derived (real inventory reaching 0, or a `manual_stop_sell` staff override), never a value trusted from storage as-is.

## 2. Tax mapping — the open finding

Owner-locked: OTA base rates are **net-of-tax**; the live PMS still applies 10% service charge + 17% TGST + $6 Green Tax per adult/child per night on top for direct/agency bookings.

**The gap**: TGST and service charge are simple percentages — every OTA and Beds24 itself support a percentage-based tax/fee line cleanly. **Green Tax is not.** It's a flat $6 fee *per guest, per night* — occupancy-dependent, not a percentage of the rate and not a flat per-room-night fee either. Reviewing what channel managers and OTA extranets actually expose (Beds24's own ARI API — Part 11 of the earlier audit — has no per-guest tax field; Booking.com/Expedia/Agoda tax configuration is percentage- or flat-fee-based, not occupancy-multiplied), **there is no standard field to publish "$6/guest/night" as a tax line through Beds24 to any of these OTAs.**

Three ways to resolve this, none chosen here — this is the "prove it won't double- or under-charge" gate the owner set in Step 6, and it remains open:
- **A.** Fold an *assumed* occupancy's Green Tax into the published net base rate (e.g. price for 2 adults). Under-collects on 3-adult bookings, over-collects (relative to true cost) on solo travelers — a real but bounded discrepancy, correctable at check-in.
- **B.** Publish gross, tax-inclusive rates on OTAs (skip net-of-tax for Green Tax specifically) and reconcile TGST/service separately. Mixes tax modes within one rate, which is exactly the kind of inconsistency the owner's Step 6 gate is meant to catch before go-live.
- **C.** Treat Green Tax as a Vilu-side-only adjustment applied when an OTA reservation is ingested (never published as an OTA tax line at all), accepting that the OTA-displayed price to the guest won't include it up front.

**Recommendation for the owner to decide, not decided here.** No live rate has been published anywhere; this is a documentation finding only.

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
| Green Tax / TGST / service | *(no field)* | **the open gap in §2** |

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

## 5. Beds24 trial account — status

**Not started.** Creating a Beds24 trial requires the owner's own business identity and, per Beds24's signup flow, eventual billing details once the trial period ends — both are things this session does not enter on the owner's behalf. When the owner is ready: Beds24.com → start trial → invite-code exchange for a refresh token (`/authentication/setup`) → the refresh token becomes `BEDS24_REFRESH_TOKEN` in Secret Manager, still unset today.

VILU BEDS24 PRE-INTEGRATION STAGE — PREPARATION DOCUMENTED — NO LIVE OTA CONNECTION MADE
