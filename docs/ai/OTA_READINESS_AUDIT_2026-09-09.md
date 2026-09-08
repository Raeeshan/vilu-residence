# Vilu PMS — OTA / Channel-Manager Readiness Audit

Date: 2026-09-09 · Read-only · No OTA, Beds24 or Channex connection made · No inventory, reservation, rate or deployment change.
Code audited: `vilu-unified.html` (PMS + staff booking engine), `vilu-website.html` (public booking), `functions/index.js`, `firestore.rules`, `firebase.json` on branch `feat/vilu-reference-design-system` (production line). Research (official sources only, seen 2026-09-09) in §10–12.

## Part 1 — Current inventory model

| Physical room | Vilu id | Type | Base rate | `cap` | Notes |
|---|---|---|---|---|---|
| Room 101 | VR01 | Deluxe Family Room | $80 | 3 | |
| Room 102 | VR02 | Deluxe Family Room | $80 | 3 | |
| Room 103 | VR03 | Double Room | $85 | 3 | |
| Room 104 | VR04 | Double Room | $85 | 3 | |
| Room 105 | VR05 | Double Room | $90 | 3 | rate differs from 103/104 |
| Room 106 | VR06 | Deluxe Family Room with Open Deck | $90 | 3 | single-unit type |

Cloudbeds equivalents (already mapped in the migration): Delux family room = VR01/VR02, Double room = VR03–VR05, Delux family room with open deck 1st floor = VR06.

- **Capacity**: one number `cap:3` per room; no separate max-adults / max-children; children counted in occupancy (`ad`+`ch`) for Green Tax only; infants (`inf`) exempt. Extra bed = `bedCount` × room rate × nights (`bedCharge`), no bed-count limit per room type.
- **Availability representation**: `room_availability/{VRxx}.bookings[] = {id, from, to}` — one cache doc per PHYSICAL room, maintained inside the same Firestore transaction that writes the reservation (`writeReservation()`, `vilu-unified.html:10388`, mirrored in `vilu-website.html:3586`); `reconcileAllRooms()` rebuilds it from `reservations` (source of truth) at most once per 24 h.
- **Blocks**: `blocks/{id} = {room_id, from_date, to_date, reason}` per PHYSICAL room; no type field (reason text only; "Agency:" prefix = hold); no out-of-service flag — maintenance is just a block.
- **Overlap logic** (client `isOcc()` 3190, `hasBlockConflict()` 10262, transaction 10411, Cloud Function `blockDoubleBooking`): half-open interval `ci < other.to && co > other.from` → same-day check-out/check-in is allowed; Cancelled and Checked out never hold a room.
- **Server backstop**: `functions/index.js` `blockDoubleBooking` (onDocumentCreated) auto-cancels the LATER-created overlapping doc and logs to `reconciliation_log` — covers raw writes that bypass the transaction. It only runs on create, not on update (room move / date change on an existing doc has only the client transaction).
- **Architecture verdict**: the PMS models **PHYSICAL ROOM INVENTORY ONLY**. There is no room-type sellable-quantity concept anywhere: every reservation is pinned to a physical room at creation (staff form, agency portal, public website all pick a specific room; the website sells "Room 101", not "Deluxe Family Room"), availability and blocks are per room, and the "OTA channels"/"Sync log"/"Seasonal rates → pushed to all OTAs" screens are **demo data** (`OTAS`, `SL`, `SNS` arrays at 2890/3159/4796; `pushOTA()`/`togOTA()` only toast). Nothing in the codebase talks to any OTA or channel manager; there is no iCal feed either.

## Part 2 — Proposed OTA inventory model (derived, not assumed)

OTA room type → Vilu room type → eligible physical rooms → sellable quantity per date:

| OTA room type (to create on each OTA) | Vilu type | Eligible rooms | Max sellable/day |
|---|---|---|---|
| Deluxe Family Room | Deluxe Family Room | VR01, VR02 | 2 |
| Double Room | Double Room | VR03, VR04, VR05 | 3 |
| Deluxe Family Room with Open Deck | …with Open Deck | VR06 | 1 |

`sellable(type, date) = |eligible rooms| − |rooms with an ACTIVE reservation covering date| − |rooms with a block covering date|` where a room counts once even if it has both, active = status ∉ {Cancelled, Checked out}, and `covering date` uses the same half-open rule (a room checking out on `date` is free for `date`). Out-of-service = a block (add `type:'oos'`/reason prefix so it is never sold and never auto-assigned). Because both reservations and blocks are per physical room, this computation is a pure derivation from existing collections — no double counting is possible as long as an OTA reservation is materialised into ONE physical room in Vilu at ingestion time (auto-assignment, §6), so the physical-room truth stays the only truth. Note: VR05 carries a different base rate ($90) from VR03/VR04 ($85); the Double Room OTA rate must be one figure — decide which (or align the rooms) before publishing.

## Part 3 — Rate model

| Capability | Status | Evidence |
|---|---|---|
| Nightly base rate per room | READY | `VR[].rate`, per-date overrides `room_prices/{VRxx}.prices[date]` via Bulk Price Manager (`pmGetPrice`, `getDateRangeRate`) |
| Room-type rate | PARTIAL | rates are per physical room (VR05 ≠ VR03/04); a type rate would have to be derived (e.g. min or a designated "lead room") |
| Occupancy pricing (1/2/3 pax) | MISSING | single rate regardless of adults |
| Extra adult pricing | PARTIAL | extra bed = +1 × room rate/night (`bedCharge`), not an OTA-style per-person supplement |
| Child pricing | MISSING | children only affect Green Tax; no child rate/age bands |
| Meal plans | MISSING | no field; today meal plan lives in free-text notes (packages exist for the website but are not rate plans) |
| Minimum length of stay | MISSING | no field anywhere |
| Maximum length of stay | NOT REQUIRED (optional) | — |
| Closed to arrival / departure | MISSING | — |
| Stop sell | PARTIAL | achievable only by creating a block per room (no type-level stop-sell) |
| Channel-specific markup | MISSING | — |
| Currency | READY (implicit) | USD everywhere; no currency field |
| Tax configuration | READY | `TAX = {tgst:17, svc:10, green:6, bed:0}` in Settings |
| Seasonal rates | PARTIAL | `SNS` seasons are in-memory demo (not persisted, not applied to `pmGetPrice`) — the working mechanism is the per-date price grid |

## Part 4 — Tax model

`calcTax()` (3168): `base = nights × rate`; `svc = base × 10 %`; `TGST = (base + svc) × 17 %`; `Green Tax = $6 × (adults + children) × nights` (infants exempt); `bed tax` $0; `total = base + svc + TGST + green`. Extra beds add `bedCount × rate × nights` outside the tax base (`anExtraBedCharge`).
- Base room price, service charge, TGST and Green Tax **are** cleanly separated and MIRA-style invoices print them; **commission is not modelled**; **OTA-inclusive pricing is not modelled** (no "rate includes taxes" flag).
- The Cloudbeds records show why this matters: OTA totals arrive tax-inclusive (Booking.com $597.80 = subtotal $433.30 + taxes $164.50); the migration stored OTA `rate` = room subtotal ÷ nights (net of taxes) precisely so `calcTax()` re-adds 10 % + 17 % + Green Tax and lands near the OTA gross. Publishing rates outbound must therefore send the **net base rate** and let each OTA add TGST/service/Green Tax (all three OTAs support tax configuration on the extranet) — OR send gross and mark the rate plan "taxes included"; doing neither consistently double-taxes. Decision needed per channel; the PMS needs a `rate_includes_tax`/`ota_gross` flag or the ingestion must always back out taxes.

## Part 5 — Reservation ingestion (schema)

Persisted Firestore fields (`resToFirestoreFields`, 10354): `id, room_id, guest_name, guest_email, guest_phone, guest_country, check_in, check_out, adults, children, rate, status, source, notes, extra_beds, trips, food_orders, arr_time, arr_transport, arr_from, dep_time, dep_transport, dep_to, pay, created_at, updated_at` (+ migration-added `cb_id, ota_ref, migrated_from, migrated_at`).

| OTA field | Vilu today | Verdict |
|---|---|---|
| external reservation id / OTA reference / channel | `cb_id`, `ota_ref` (Cloudbeds-specific), `source` (free text) | PARTIAL — generalise to `external_id` (channel-manager id), `channel_reservation_id` (OTA confirmation), `channel` (enum: booking_com / expedia / agoda / website / agency / direct / cloudbeds). Keep `cb_id`/`ota_ref` on the 36 migrated docs and backfill `external_id = cb_id`, `channel_reservation_id = ota_ref`, `channel` when the schema step is approved. Loader (`loadResFromSupabase`) must map the new fields or they stay invisible in the UI (they persist because every write is `merge:true`) |
| guest name/email/phone/nationality | `guest_name` (single string, split at first space), email, phone, `guest_country` | READY (first/last name is lossy — consider `guest_first_name`/`guest_last_name`) |
| adults / children / child ages | `adults`, `children`; `inf` not persisted; no ages | PARTIAL — add `child_ages[]`, persist `infants` |
| room type | derived from `room_id` only | PARTIAL — ingestion must auto-assign a physical room of the requested type (§6); store `room_type_requested` |
| check-in / check-out / booking date | READY (`created_at` only written when in-memory record has `createdAt` — the importer sets it explicitly) |
| status | Confirmed / Pending / Checked in / Checked out / Cancelled | READY (map OTA new→Confirmed, cancel→Cancelled, no-show→Cancelled + note) |
| rate / taxes / commission / total / paid / balance | `rate` (nightly), `pay` free text | PARTIAL — add numeric `gross_total`, `net_total`, `tax_total`, `commission`, `paid`, `balance`, `currency`, `rate_includes_tax` |
| notes / special requests / meal plan / arrival info | `notes` free text; `arr_*`/`dep_*` structured | PARTIAL — meal plan needs a field (`meal_plan`); special requests can stay in `notes` with a label |

Recommendation: yes, `external_id` + `channel_reservation_id` + `channel` (+ `channel_manager: 'beds24'`) is the cleaner long-term key; `cb_id/ota_ref` should be treated as the Cloudbeds-era instance of the same idea, not extended. **Schema not migrated in this audit.**

## Part 6 — New / modify / cancel idempotency

Design (server-side, Cloud Function `otaIngest`, never the browser):
1. **Idempotency key** = `channel_manager + ':' + external_id` (Beds24 `booking.id`; Channex `booking_id`); every inbound message also carries a **revision marker** (Beds24 `modifiedTime`, Channex `revision_id`, Cloudbeds `last_change`). Store on the Vilu doc: `external_id`, `external_revision`, `external_last_event_at`, and keep an append-only `ota_events/{key}_{revision}` collection = the raw message + processing result.
2. **Deterministic doc id**: Vilu reservation doc id = `OTA-<channel_manager>-<external_id>` (multi-room bookings → `…-<external_id>-<n>` per room, same convention as the Cloudbeds import). A duplicate NEW message therefore targets an existing doc → treated as an update with identical content → no-op (transaction reads the doc first; if `external_revision` ≥ incoming revision, ACK and stop).
3. **Modification**: same key, newer revision → within the transaction compare dates/room type/pax; if dates or room change, run the same room re-assignment + conflict check as a move (release old lock, acquire new); if it fails → keep the old stay, set `ota_conflict:true`, alert staff, still ACK the message (never crash-loop) and re-raise availability to the channel manager immediately.
4. **Cancellation**: same key → status `Cancelled` (idempotent: already Cancelled = no-op), release lock, log; a cancellation whose revision is OLDER than the stored revision (out-of-order) is ignored except when the stored status is still active and the message is the latest known state after a re-pull — resolve out-of-order by **always re-pulling the current booking state from the channel manager** (`GET /bookings/{id}` / feed) rather than trusting the payload order; webhooks are only triggers.
5. **Duplicates/late/out-of-order**: revision check + re-pull makes duplicates and late deliveries harmless; a **scheduled catch-up** (`GET /bookings?modifiedFrom=<last cursor>` every 15–30 min) closes gaps when a webhook never arrives.
6. All of this runs under the existing `runTransaction` pattern (reservation doc + `room_availability` lock in one commit) so the ROOM_CONFLICT protection is reused, not weakened.

## Part 7 — Conflict management

Existing protection: (a) client transaction throws `ROOM_CONFLICT` when the room's lock doc overlaps; Firestore transactions serialise contending writers on the same lock doc, so two simultaneous website/PMS bookings for the same physical room cannot both commit; (b) `blockDoubleBooking` cancels a later overlapping create; (c) rules validate shape and who may create/update.
Scenarios with OTA in the loop:
- **Booking.com booking and website booking at the same moment for the last room of a type** — today both would succeed on DIFFERENT physical rooms if two rooms of the type were free; if only one is free, the second transaction loses on the lock doc → website guest gets "room no longer available" (fine) or the OTA message fails ingestion → must NOT be dropped: mark `ota_conflict`, alert, and push availability 0 so the OTA stops selling; the OTA guest is still owed a room (relocation/refund is an operational decision, the PMS must surface it loudly).
- **Two OTAs sell the final room** — inevitable in a pull/push channel-manager world for a few minutes; mitigation = sub-minute availability push on every Vilu write + channel manager doing the OTA fan-out; the second booking lands in `ota_conflict` state, never silently overwrites.
- **Modification onto occupied dates** — transaction rejects; keep original stay; flag; push availability.
- **Late cancellation** — idempotent cancel by key; releases lock; triggers availability push (room reopened on all OTAs within the sync interval).
- **Gaps to close**: `blockDoubleBooking` does not cover updates (room move/date change on an existing doc) — extend to `onDocumentWritten` or make the server ingestion the only writer for OTA docs; the public website's unauthenticated write (see §13/§15) needs verification.
Recommended architecture: **one server-side writer** (Cloud Function with Admin SDK) for all OTA traffic; browser clients keep using the transaction; physical-room locks remain the single conflict authority; the channel manager never becomes authoritative for reservations.

## Part 8 — Availability outbound (when to refresh)

Trigger an availability recompute + push for the affected room TYPE and date range on: new direct booking, new OTA booking (after Vilu materialises it), manual booking, modification (old and new ranges/rooms), cancellation/no-show, room move (both rooms), block creation/removal/edit, maintenance/OOS on/off, room reopened, and status changes that free a room (Checked out early). Implementation: Firestore trigger `onDocumentWritten` on `reservations/*` and `blocks/*` → enqueue `{room_type, from, to}` → debounce ~5 s → compute sellable per date (Part 2) → `POST /inventory/rooms/calendar` (Beds24) / `POST /availability` (Channex). Plus **scheduled full reconciliation** (every 30 min for the next 365 days, plus nightly 730 days) that recomputes everything and pushes only differences — event-driven for speed, scheduled for self-healing. Manual "Push rates now" remains a convenience, never the mechanism.

## Part 9 — Rate outbound

Publish per **room type** (never per physical room): `rate_plan × date → base rate (net, see Part 4), min_stay, max_stay (optional), closed_to_arrival, closed_to_departure, stop_sell, availability`. Source of the type rate: a new `room_type_rates/{type}.prices[date]` (or designate a lead room per type and reuse its `room_prices`). Restrictions need new per-type-per-date fields (`min_stay`, `cta`, `ctd`, `stop_sell`) — none exist today. Physical room numbers never leave the PMS; the channel manager only sees the 3 types with quantities 2/3/1.

## Part 10 — Channel-manager options (official pricing, seen 2026-09-09)

| | Beds24 | Smoobu | Channex | SiteMinder |
|---|---|---|---|---|
| Monthly cost, 6 rooms / 3 types / 3 OTAs | **€33.45** (12.90 + 6×2.60 + 9 links×0.55) ≈ US$39 | €95 (Professional, monthly; €85.50 yearly) | US$137 (WhiteLabel $130 + $7/property) | from US$135 ("SiteMinder" plan) |
| Setup fee / contract | none / none, prepaid month-to-month | none / 1-month notice | none / 30-day notice | may apply / Initial Term set in sales order (not public) |
| Booking.com / Expedia / Agoda | ✔ ✔ ✔ (Booking Premier, Expedia Elite) | ✔ ✔ Agoda only on a comparison page | ✔ ✔ ✔ | ✔ ✔ ✔ |
| API for a custom PMS | open to any account; API v2 REST/JSON; refresh-token auth; 100 credits/5 min (+€10 → 200) | open on paid plans; HMAC-signed; 1000 req/min | open with subscription; API key; 20 ARI req/min/property; self-certification (14 tests) | partner programme only (pmsXchange SOAP/OTA XML), agreement + certification + pilot |
| Reservation delivery | booking webhooks (create/modify/cancel) + `GET /bookings?modifiedFrom`; retry/ordering not documented | webhooks (new/update/cancel/delete); retry not documented | pull feed + ack (re-served 30 min) + webhooks with documented backoff; order not guaranteed | push OTA_HotelResNotif with retries, or pull + confirm |
| ARI API | numAvail, price1–16, minStay, maxStay, CTA/CTD/stop-sell, per-channel maxBookings | price + min LOS only; **no CTA/CTD/stop-sell, no numeric availability** | availability + full restrictions | full OTA restriction set |
| Custom PMS allowed | yes, no certification ("channel manager only via API" acknowledged) | yes (written notice required) | yes after self-certification; single hotels discouraged | only as approved partner |
| Complexity (1–5) / bridge while Vilu stays PMS | 2 / yes, documented pattern | 3 / weak | 2–3 / yes (headless by design) | 4–5 / yes if accepted |

## Part 11 — Beds24 deep check

- **Cost for Vilu**: €33.45/month prepaid (account €12.90 + 6 rooms × €2.60 + 3 room types × 3 channels × €0.55); each additional OTA +€1.65; API credit uplift +€10/month if 100 credits/5 min is too low; no setup fee, no contract, 14-day trial, €25 fee only to withdraw unused balance. Per-channel link charging is per room TYPE (3 types), so mapping the 3 types (not 6 rooms) keeps it cheap.
- **API v2**: `/authentication/setup` (invite code → refresh token, never expires while used) → 24 h access token; `/bookings` (filters `modifiedFrom`, `status`, `channel`, `includeGuests`), `/inventory/rooms/calendar` (numAvail, minStay, maxStay, prices, override = blackout/noCheckIn/noCheckOut), `/properties/rooms`, `/channels/booking`; POST arrays ≤ ~1 MB; credits per call with `x-five-min-limit-*` headers.
- **Webhooks**: per-property booking webhook (JSON with status/subStatus, arrival/departure, roomId, channel, apiReference, modifiedTime, cancelTime); create/modify/cancel all arrive as booking events — **retry/idempotency/ordering not documented**, so pair it with `modifiedFrom` polling (Beds24's own guide recommends ~30-min polling backstop).
- **Channels**: Booking.com, Expedia, Agoda, Airbnb, Trip.com, Google Hotel Ads, Traveloka, Hostelworld (75+); OTA certification is Beds24's (Booking.com Premier Partner, Expedia Elite) — Vilu needs only its own extranet accounts. Room mapping to Booking.com is done once in the Beds24 control panel (not via API).
- **Limits/auth/certification**: 100 credits per 5 minutes per account; token header auth; no certification for API use; "channel-manager-only" mode acknowledged via support ticket; white-label optional.
- **Bridge verdict**: practical — keep Vilu authoritative, push `numAvail`/prices per room type from Vilu, receive OTA bookings by webhook + poll, leave OTA bookings in Beds24 so modifications/cancellations keep flowing, never push Vilu-direct bookings to Beds24 as bookings (push availability instead).

## Part 12 — Direct OTA API possibility

- **Booking.com** Connectivity Partner Programme: onboarding of new providers is **paused**; "does not accept direct connections from individual properties"; ongoing minimums (≈250 listings, 3,000 bookings/yr) unreachable for one property; XML/B.XML pull + ACK with 30-min fallback e-mails.
- **Expedia** Connectivity Hub: "not accepting direct connections from individual properties"; software-vendor programme with end-to-end certification; EQC XML / GraphQL.
- **Agoda** YCS: nominally open (questionnaire, no timeline) but certification requires a pilot with 2–3 live properties; XML API, pull every 5 min + booking hints.
- iCal alternatives work only for 1-unit room types (VR06) and are not real-time — unsafe for overbooking on the 2- and 3-unit types.
- **Verdict**: direct connection is not realistic for a single six-room property; a certified channel manager is the only practical bridge.

## Part 13 — Security requirements

- OTA / channel-manager credentials live only in server config (Cloud Functions secrets via Secret Manager, `firebase functions:secrets:set`), never in `vilu-unified.html`/`vilu-website.html`, never in Git (`.gitignore` + a pre-commit secret scan); Firestore rules already restrict `room_availability`/`blocks` writes to admin/staff — keep the OTA writer as an Admin SDK function, not a browser session.
- Webhook endpoint: HTTPS Cloud Function; verify a shared secret in a header or the URL path token (Beds24 does not sign payloads → treat webhook only as a trigger and re-pull the booking by id from the API); reject and log anything else; IP allow-list if the vendor publishes ranges.
- Retry queue: Cloud Tasks / Firestore `ota_queue` with exponential backoff and a dead-letter state; every job idempotent by key + revision.
- Audit log: `ota_events` (raw inbound), `ota_pushes` (outbound ARI with response), `reconciliation_log` (existing) — retained ≥ 12 months.
- Deduplication: idempotency key + revision (Part 6); rate limiting: respect 100 credits/5 min with a token bucket and batching; failure alerts: e-mail/WhatsApp to the owner when a push fails ≥ 3 times, a webhook cannot be matched to a room, or an `ota_conflict` is raised; a daily "sellable vs OTA availability" mismatch report.
- Live-rule finding to verify: the public website has no Firebase auth and its transaction writes `room_availability`, which `firestore.rules:72-74` allows only to admin/staff — if the deployed rules equal the repo, unauthenticated website bookings are rejected at commit; this must be checked (Firebase console rules read, or one throwaway test booking) before OTA work, because "direct booking → inventory reduced" depends on it.

## Part 14 — Failure-mode test plan (sandbox: Beds24 trial property + Firebase emulator or a staging project)

| # | Test | Pass criteria |
|---|---|---|
| 1 | OTA new booking (Deluxe Family, 2 nights) | one Vilu doc `OTA-beds24-<id>`, room auto-assigned VR01/VR02, lock written, availability push shows type −1 |
| 2 | Same NEW webhook replayed twice | still one doc, `ota_events` shows 2 entries / 1 applied |
| 3 | Modification (dates +1) | same doc updated, lock moved, old dates reopened, availability pushed for both ranges |
| 4 | Duplicate modification | no change, revision equal → skipped |
| 5 | Cancellation | status Cancelled, lock released, availability +1 pushed |
| 6 | Duplicate cancellation | no-op, no error |
| 7 | Direct website booking while OTA booking arrives for the last room | exactly one wins the lock; the other is `ota_conflict`/"not available"; alert raised; availability 0 pushed |
| 8 | Final room of a type sold | sellable 0 pushed within the debounce window; OTA shows closed |
| 9 | Block created (VR03 3 nights) | Double Room availability −1 for those dates |
| 10 | Block removed | +1 pushed |
| 11 | Integration offline (function disabled) 30 min, 3 OTA events | catch-up poll ingests all 3, no duplicates |
| 12 | Retry after failure (push returns 500) | backoff retries, eventual success, alert only after threshold |
| 13 | Stale message (older revision after newer) | ignored, doc unchanged |
| 14 | Out-of-order (cancel before its own modify) | final state = latest revision after re-pull |
| 15 | Incorrect room mapping (unknown Beds24 roomId) | quarantined in `ota_conflict`, alert, nothing written to a room |
Success = zero duplicate reservations and zero oversell across all 15.

## Part 15 — Recommendation

- **A. OTA-ready today?** **NO.** Conflict protection and the physical-room lock model are sound, but there is no room-type inventory, no outbound availability/rate mechanism, no inbound ingestion, no restrictions/min-stay, no idempotency layer, and the OTA screens are mock-ups.
- **B. Missing pieces**: (1) room-type inventory derivation + auto-assignment of OTA bookings to physical rooms; (2) server-side ingestion function with idempotency (`external_id`, `channel_reservation_id`, `channel`, revision) and conflict quarantine; (3) event-driven + scheduled availability/rate push; (4) per-type rate/restriction storage (min stay, CTA/CTD, stop-sell) and a tax-inclusive/net flag; (5) numeric commercial fields (total/paid/balance/commission/currency); (6) secrets/webhook/audit infrastructure; (7) `blockDoubleBooking` extended to updates; (8) verification of the public-website write rule.
- **C. Smallest OTA-safe architecture**: Cloud Functions (already provisioned) — `otaWebhook` (trigger) → `otaIngest` (re-pull by id, transaction write to `reservations` + `room_availability`) + `availabilitySync` (Firestore triggers + 30-min cron computing sellable per type and pushing to the channel manager) + `otaCatchUp` (poll `modifiedFrom`); PMS UI changes limited to showing `channel`/external ids and an "OTA conflicts" list. No change to the transaction, rules or the website flow beyond the verification in B(8).
- **D. Cheapest realistic channel manager**: **Beds24**, €33.45/month for this exact configuration (official calculator), no contract, API open without certification.
- **E. First OTA connection**: **Booking.com** (largest existing Vilu channel: 5 of the 7 live OTA bookings; Beds24 Premier Partner; simplest mapping) — after the 15 sandbox tests pass and with initial availability restricted to a short window.
- **F. Sequence**: Booking.com → Expedia (incl. the Hotel Collect/Channel Collect tax handling check) → Agoda → then Airbnb / Trip.com / Google Hotel Ads via the same bridge; one channel at a time, 2 weeks of reconciliation each.
- **G. Recurring cost**: Beds24 €33.45/month (3 OTAs) → €38.40 with 6 channels; +€10/month if API credits are exceeded; ≈ US$39–56/month. Alternatives: Smoobu €95, SiteMinder ≥ US$135, Channex US$137.
- **H. Authority**: reservations — **Vilu PMS** (OTA bookings materialised in Vilu, Beds24 keeps a mirror only for OTA modification flow); inventory — **Vilu** (physical rooms → derived type quantities pushed out); rates — **Vilu** (type rates + restrictions pushed out; OTA extranets receive, never originate); guest operations (check-in, folios, transfers, notes) — **Vilu**.
- **I. Keep Vilu as the staff-facing system?** **Yes** — it already holds the operational model (transfers, folios, packages, agency portal, MIRA taxes); the channel manager should stay invisible to staff except for OTA mapping/setup.

VILU OTA READINESS AUDIT COMPLETE — NO OTA CONNECTIONS MADE — NO RESERVATION OR INVENTORY CHANGES
