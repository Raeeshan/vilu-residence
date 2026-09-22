'use strict';
// Deployment copy for the "ota" Functions codebase -- kept in sync with
// functions/lib/ota-booking-identity.js (the canonical copy the test harness imports).
// Cross-provider OTA booking identity / deduplication layer (D1).
//
// PROBLEM (proven from real Firestore data, not assumed): ingest.js's own
// idempotency key is channel_manager + external_id (see docIdFor() in
// ingest.js), scoped entirely to ONE channel manager's own id space. Vilu's
// PMS already holds real Booking.com/Expedia reservations imported from
// Cloudbeds under Cloudbeds' own doc-id scheme (e.g. "6881168090781",
// "6881168090781-2"), which carry NO channel_manager/external_id field at
// all. When the SAME real-world stay is later re-delivered through Beds24
// (a brand-new Beds24 booking id, since Beds24 never heard of Cloudbeds'
// id), ingest.js's docIdFor() computes a doc id that has never existed
// ("OTA-beds24-<newId>"), so `existing` is empty and the per-unit loop in
// ingest.js proceeds to assign a FREE physical room -- creating a duplicate
// reservation if one exists, or raising a spurious no_physical_room
// conflict if the type is otherwise full.
//
// This module resolves, BEFORE ingest.js ever computes a doc id to write,
// whether an inbound Beds24 booking is actually a channel-manager-mirror of
// a reservation the PMS already has under a different identity -- and if
// so, returns the EXISTING doc id so ingest.js's normal
// revision-compare/merge path treats it as an update, never a create.
//
// Real identifier matrix (confirmed against source + live documents, never
// assumed -- see the D1 build report for the full audit):
//
//   From a Beds24 booking (functions/lib/beds24-inbound.js normalizeBeds24Booking):
//     external_id            <- raw.id                         (Beds24's own booking id)
//     channel                <- RECOGNIZED_CHANNELS[raw.channel] ('Booking.com'|'Expedia'|'Agoda')
//     channel_reservation_id <- raw.apiReference || raw.id      (the UPSTREAM OTA's own reference)
//     property_id            <- raw.propertyId
//     units[0].room_type     <- viluRoomTypeForBeds24RoomId(raw.roomId)  -- ROOM TYPE only,
//                                Beds24's 3 room ids (727992/728133/728134) never distinguish
//                                which specific physical room (VR01 vs VR02, etc.) within a type.
//     units[0].check_in/out  <- raw.arrival / raw.departure
//     units[0].adults/children <- raw.numAdult / raw.numChild
//     status                 <- raw.status
//     NOTE (proven, not assumed): normalizeBeds24Booking always returns
//     exactly ONE unit. Beds24's GET /bookings has no masterId/group field
//     anywhere in this integration's confirmed schema or code (grepped the
//     whole ota/core lib + test tree -- zero references) -- a multi-room
//     stay is several independent Beds24 booking ids, each its own
//     ingestEvent() call, not one multi-unit payload.
//
//   From existing PMS `reservations` docs (checked against real documents,
//   not assumed -- see the 5 real docs below):
//     Cloudbeds-migrated, OTA-sourced docs (6881168090781, 2232845617791,
//     9335838148158 -- all Booking.com) DO carry a real ota_ref field
//     (Cloudbeds' own capture of the upstream Booking.com reference) plus
//     migrated_from:"cloudbeds"/cb_id.
//     The two Expedia docs (BK21814-0, BK01278-0) carry NONE of
//     ota_ref/cb_id/migrated_from -- their only identifier is a Cloudbeds
//     INTERNAL reservation id embedded as free text inside `notes`
//     ("Cloudbeds Reservation ID: 3218915826606 | Cloudbeds Source:
//     Expedia"), which is NOT the same id space as Expedia's own
//     confirmation number and can never be compared against Beds24's
//     apiReference. This is a real, provable gap -- see the D1 build
//     report's backfill section; this module never invents a value to
//     paper over it.
//     ingest.js-created docs (OTA-<cm>-<id>) carry channel_reservation_id
//     (same concept, different field name) instead of ota_ref.
//
// Matching is intentionally conservative (never guesses an identity from
// guest name alone) and layered:
//   TIER 1  exact (channel, upstream reference) match against an EXISTING,
//           not-yet-fully-claimed reservation group -> auto-link.
//   TIER 2  a previously-established alias (ota_booking_aliases) for this
//           exact (provider, external_id) -> use directly, no re-matching.
//           (Checked FIRST in resolveBookingIdentity -- alias lookup always
//           happens before candidate matching, so a linked booking's every
//           later event goes straight to its canonical reservation.)
//   TIER 3  only when no upstream reference is available at all: exact
//           structural match (channel + check_in + check_out + room_type,
//           adults/children as supporting evidence). Exactly one candidate
//           -> auto-link (documented choice, see resolveBookingIdentity's
//           header comment). Zero -> genuinely new. 2+ -> quarantine, never
//           auto-merge.
const { PHYSICAL_ROOMS } = require('./inventory');

const ALIAS_COLLECTION = 'ota_booking_aliases';

function aliasDocId(provider, externalId) { return provider + ':' + String(externalId); }

function normKey(v) { return v == null ? '' : String(v).trim(); }

// Beds24 room ids never carry a specific physical room -- a structural
// candidate is compared by ROOM TYPE, derived from the existing doc's own
// room_id via the same physical-room table ingest.js/inventory.js use.
function roomTypeForRoomId(roomId) {
  const p = PHYSICAL_ROOMS.find((r) => r.id === roomId);
  return p ? p.type : null;
}

// A reservation "family" is one base doc id plus its "-2", "-3", ... unit
// siblings -- the exact convention both the Cloudbeds migration and
// ingest.js's own docIdFor() already use. Never assumes every family member
// is contiguous in the `reservations` list; groups strictly by base id.
function baseIdOf(id) { const m = /^(.*)-(\d+)$/.exec(String(id)); return m ? m[1] : String(id); }

function groupByBaseId(docs) {
  const groups = new Map();
  for (const d of docs) {
    const id = d._id || d.id;
    const base = baseIdOf(id);
    (groups.get(base) || groups.set(base, []).get(base)).push(d);
  }
  return groups;
}

// Every reservation doc that could represent "the upstream OTA's own
// reference" for this exact channel, regardless of which of the two
// existing field names produced it (see the module header's identifier
// matrix). Filters to active reservations and to a matching canonical
// channel -- a reference collision against a Cancelled doc, or against a
// doc from a DIFFERENT channel, is never treated as a real match.
async function findByReference(store, channel, reference) {
  const ref = normKey(reference);
  if (!ref) return [];
  const [byOtaRef, byChannelResId] = await Promise.all([
    store.query('reservations', 'ota_ref', ref),
    store.query('reservations', 'channel_reservation_id', ref),
  ]);
  const seen = new Map();
  for (const d of [...byOtaRef, ...byChannelResId]) seen.set(d._id || d.id, d);
  return [...seen.values()].filter((d) => d.status !== 'Cancelled' && normKey(d.source || d.channel) === normKey(channel));
}

// Groups a set of same-reference docs into coherent multi-room families.
// Real multi-room stays always share IDENTICAL check_in/check_out across
// every unit (confirmed against 6881168090781/-2 and every other migrated
// multi-unit family) -- a reference match whose docs do NOT all share the
// same stay dates is not one booking, it is two different reservations that
// happen to carry the same reference value (a data-entry collision), and
// must never be silently treated as one group.
function coherentFamilies(docs) {
  const byBase = groupByBaseId(docs);
  const stayKey = (fam) => fam.map((d) => d.check_in + '_' + d.check_out).sort().join('|');
  const distinctStays = new Set([...byBase.values()].map(stayKey));
  return { families: [...byBase.values()], coherent: distinctStays.size <= 1 };
}

async function getAlias(store, provider, externalId) {
  return store.get(ALIAS_COLLECTION, aliasDocId(provider, externalId));
}

async function claimedDocIdsForGroup(store, groupKey) {
  const aliases = await store.query(ALIAS_COLLECTION, 'group_key', groupKey);
  return new Set(aliases.map((a) => a.pms_reservation_id));
}

// Persists the mapping once a booking has been safely linked -- no guest
// PII, only identity metadata (Section 3). `groupKey` is set only for
// reference-based links (lets a sibling Beds24 booking for another room in
// the same multi-room stay find which family members are already claimed).
async function recordAlias(store, { provider, externalId, pmsReservationId, channel, reference, groupKey, matchMethod, confidence, reason, now }) {
  const id = aliasDocId(provider, externalId);
  await store.set(ALIAS_COLLECTION, id, {
    provider,
    external_id: String(externalId),
    pms_reservation_id: pmsReservationId,
    upstream_channel: channel || null,
    upstream_reference: reference ? normKey(reference) : null,
    group_key: groupKey || null,
    match_method: matchMethod,
    confidence,
    reason,
    created_at: now,
  });
  return id;
}

// Tier 3: exact structural match, only ever consulted when no upstream
// reference exists at all. `unit` is the single incoming Beds24 unit
// (normalizeBeds24Booking always returns exactly one -- see module header).
async function findStructuralCandidates(store, { channel, checkIn, checkOut, roomType }) {
  const all = await store.list('reservations');
  const active = all.filter((d) => d.status !== 'Cancelled' && normKey(d.source || d.channel) === normKey(channel) && d.check_in === checkIn && d.check_out === checkOut && (d.room_type_requested ? d.room_type_requested === roomType : roomTypeForRoomId(d.room_id) === roomType));
  // Group by base id so a multi-room family already in the PMS counts as
  // ONE structural candidate, not one per unit.
  return [...groupByBaseId(active).values()];
}

// Picks the first not-yet-aliased member of a matched family, in
// deterministic (sorted) doc-id order -- the same family will always
// resolve its rooms in the same order across repeated/out-of-order events,
// so two Beds24 bookings for the same multi-room stay always land on two
// DIFFERENT PMS docs, never the same one twice.
function pickUnclaimedMember(family, claimed) {
  const sorted = family.slice().sort((a, b) => (a._id || a.id).localeCompare(b._id || b.id));
  return sorted.find((d) => !claimed.has(d._id || d.id)) || null;
}

// Resolves the identity of ONE inbound Beds24 booking (one external_id, one
// unit) against the PMS. Returns exactly one of:
//   { method: 'alias',      pmsReservationId, existing }
//   { method: 'ota_reference', pmsReservationId, existing, groupKey, alias:{...} }  (newly linked, alias just persisted)
//   { method: 'structural', pmsReservationId, existing, alias:{...} }               (newly linked, documented below)
//   { method: 'new' }                                          -- no safe match; ingest.js's normal create path applies
//   { method: 'ambiguous', reason: 'upstream_reference_collision' | 'multi_room_match_ambiguous' | 'existing_booking_match_ambiguous', detail }
//
// Design decision (Section 2, test case F): when NO upstream reference is
// available and exactly one structural candidate exists, this module
// AUTO-LINKS (does not quarantine). Rationale: the task's own Tier 3 rule
// is "exactly one high-confidence candidate -> MAY link", and auto-linking
// the unambiguous case is what actually fixes the known dedup bug for the
// two real Expedia reservations already in the PMS today (BK21814-0,
// BK01278-0), which have no reference field to match on (see module
// header). A structural match still requires exact channel + check_in +
// check_out + room_type agreement across the WHOLE existing family -- it is
// never a fuzzy/partial match, and 2+ candidates always quarantine instead
// (test G) rather than guess between them.
async function resolveBookingIdentity({ store, provider, channel, externalId, reference, unit, now }) {
  const existingAlias = await getAlias(store, provider, externalId);
  if (existingAlias) return { method: 'alias', pmsReservationId: existingAlias.pms_reservation_id, existing: existingAlias };

  const ref = normKey(reference);
  if (ref) {
    const matches = await findByReference(store, channel, ref);
    if (matches.length) {
      const { families, coherent } = coherentFamilies(matches);
      if (!coherent) return { method: 'ambiguous', reason: 'upstream_reference_collision', detail: 'reference ' + ref + ' matches reservations with different stay dates -- not one multi-room booking' };
      if (families.length > 1) return { method: 'ambiguous', reason: 'upstream_reference_collision', detail: 'reference ' + ref + ' matches more than one existing reservation family' };
      const family = families[0];
      const groupKey = normKey(channel) + '|' + ref;
      const claimed = await claimedDocIdsForGroup(store, groupKey);
      const target = pickUnclaimedMember(family, claimed);
      if (!target) return { method: 'ambiguous', reason: 'multi_room_match_ambiguous', detail: 'every PMS unit already linked for reference ' + ref + '; this Beds24 booking has no unclaimed unit to attach to (family may be smaller than the number of Beds24 bookings sharing this reference)' };
      const pmsReservationId = target._id || target.id;
      const alias = { id: await recordAlias(store, { provider, externalId, pmsReservationId, channel, reference: ref, groupKey, matchMethod: 'ota_reference', confidence: 'high', reason: 'exact channel + upstream reference match', now }) };
      return { method: 'ota_reference', pmsReservationId, existing: target, groupKey, alias };
    }
    // A reference was supplied but matched nothing -- per Tier ordering,
    // structural matching is only for when NO reference exists at all.
    // A present-but-unmatched reference means this really is new.
    return { method: 'new' };
  }

  const candidates = await findStructuralCandidates(store, { channel, checkIn: unit.check_in, checkOut: unit.check_out, roomType: unit.room_type });
  if (!candidates.length) return { method: 'new' };
  if (candidates.length > 1) return { method: 'ambiguous', reason: 'existing_booking_match_ambiguous', detail: 'no upstream reference available and ' + candidates.length + ' existing reservations match on channel + exact dates + room type -- guest name is never used to break the tie' };
  const family = candidates[0];
  const target = pickUnclaimedMember(family, new Set()); // structural links are one-shot per family; no group_key concept
  const pmsReservationId = target._id || target.id;
  const alias = { id: await recordAlias(store, { provider, externalId, pmsReservationId, channel, reference: null, groupKey: null, matchMethod: 'structural', confidence: 'medium', reason: 'exact structural match: channel + check_in + check_out + room_type, no upstream reference available', now }) };
  return { method: 'structural', pmsReservationId, existing: target, alias };
}

module.exports = { resolveBookingIdentity, getAlias, findByReference, findStructuralCandidates, aliasDocId, ALIAS_COLLECTION };
