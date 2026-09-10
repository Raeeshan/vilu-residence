'use strict';
// Deployment copy for the "ota" Functions codebase -- kept in sync with
// functions/lib/beds24-bridge.js (the canonical copy the test harness
// imports). Required by ./adapters.js (outbound pushAvailability) and
// ./beds24-inbound.js (inbound room-id reverse mapping).
// Vilu PMS <-> Beds24 API v2 transport bridge.
//
// Architecture (owner-locked): Vilu PMS is the sole PMS / source of truth for
// rooms, availability, rates, taxes, child pricing, and cancellation policy.
// Beds24 is used ONLY as an API/channel transport bridge to Booking.com,
// Expedia and Agoda -- it must never calculate anything Vilu already
// calculates. This module therefore contains NO pricing/availability logic
// of its own: every function here either (a) reuses the already-existing,
// already-tested canonical engines in inventory.js and ota-room-types.js, or
// (b) translates their already-canonical output into Beds24's specific wire
// field names. See docs/ai/BEDS24_PRE_INTEGRATION_STAGE.md for the primary-
// source research this is built on.
//
// No network call anywhere in this file.
const crypto = require('crypto');
const { buildRoomTypes, computeSellable, addDays, dateRange, ROOM_TYPE_CODES } = require('./inventory');
const { INITIAL_OTA_ROOM_TYPES, CODE_TO_ROOM_TYPE_ID, computeOtaTypePayload } = require('./ota-room-types');

// ---------------------------------------------------------------------------
// Canonical Vilu room-type <-> Beds24 identity map (Step 2). One immutable
// module-level constant -- every other function in this file, and any future
// caller, reads room/property identity from here only. Never hard-code these
// IDs anywhere else. Confirmed live 2026-09-10 via an authenticated
// GET /properties?id=352964&includeAllRooms=true call against the real
// Beds24 trial account (property + room ids + quantities + unit names all
// matched exactly) -- see the session's own verification pass, not guessed.
const BEDS24_PROPERTY_ID = 352964;
const BEDS24_ROOM_MAP = Object.freeze({
  DELUXE_FAMILY: Object.freeze({
    beds24_property_id: BEDS24_PROPERTY_ID,
    beds24_room_id: 727992,
    vilu_rooms: Object.freeze(['VR01', 'VR02']),
    quantity: 2,
  }),
  DOUBLE: Object.freeze({
    beds24_property_id: BEDS24_PROPERTY_ID,
    beds24_room_id: 728133,
    vilu_rooms: Object.freeze(['VR03', 'VR04', 'VR05']),
    quantity: 3,
  }),
  DELUXE_FAMILY_OPEN_DECK: Object.freeze({
    beds24_property_id: BEDS24_PROPERTY_ID,
    beds24_room_id: 728134,
    vilu_rooms: Object.freeze(['VR06']),
    quantity: 1,
  }),
});

function beds24RoomIdentity(roomTypeCode) {
  const identity = BEDS24_ROOM_MAP[roomTypeCode];
  if (!identity) throw new Error('beds24-bridge: unknown room type code ' + roomTypeCode);
  return identity;
}

// ---------------------------------------------------------------------------
// Inbound direction (Beds24 -> Vilu, continuous-sync pass): the reverse of
// beds24RoomIdentity(). Given a real Beds24 roomId from an inbound booking,
// resolves it back to the exact Vilu display-name string that
// inventory.js's buildRoomTypes()/freeRoomsForStay() key their lookups on
// ("Deluxe Family Room", "Double Room", "Deluxe Family Room with Open Deck")
// -- never the room-type code, never the roomId itself. Returns null for an
// unmapped roomId (a Beds24 room this Vilu integration doesn't recognize) --
// the caller must treat that as "unknown room type", never guess a mapping.
const BEDS24_ROOM_ID_TO_CODE = Object.freeze(
  Object.fromEntries(Object.entries(BEDS24_ROOM_MAP).map(([code, identity]) => [identity.beds24_room_id, code]))
);
const CODE_TO_VILU_DISPLAY_NAME = Object.freeze(
  Object.fromEntries(Object.entries(ROOM_TYPE_CODES).map(([displayName, code]) => [code, displayName]))
);

function viluRoomTypeForBeds24RoomId(beds24RoomId) {
  const code = BEDS24_ROOM_ID_TO_CODE[beds24RoomId];
  if (!code) return null;
  return CODE_TO_VILU_DISPLAY_NAME[code] || null;
}

// ---------------------------------------------------------------------------
// Step 4: override precedence. Confirmed exact enum 2026-09-10 from Beds24's
// own live OpenAPI v2 schema (https://beds24.com/api/v2/apiV2.yaml -- this
// spec file is publicly readable without a token, re-checked via a plain
// curl with no auth header): the `calendar` schema's `override` property is
// `enum: [none, blackout, exception, noCheckIn, noCheckOut,
// noCheckInOrCheckOut]`. "none" is the documented neutral/normal value --
// not guessed, not inferred from wiki text.
const BEDS24_OVERRIDE = Object.freeze({
  NORMAL: 'none',
  BLACKOUT: 'blackout',
  CTA: 'noCheckIn',
  CTD: 'noCheckOut',
  CTA_CTD: 'noCheckInOrCheckOut',
});

// stopSell takes precedence over CTA/CTD (a blacked-out date has no arrival
// or departure semantics left to express); CTA and CTD combine into the one
// documented combined enum value rather than being lossy (picking only one).
function computeOverride({ stopSell, cta, ctd }) {
  if (stopSell) return BEDS24_OVERRIDE.BLACKOUT;
  if (cta && ctd) return BEDS24_OVERRIDE.CTA_CTD;
  if (cta) return BEDS24_OVERRIDE.CTA;
  if (ctd) return BEDS24_OVERRIDE.CTD;
  return BEDS24_OVERRIDE.NORMAL;
}

// ---------------------------------------------------------------------------
// Step 3: pure outbound payload generator. Only emits fields confirmed to
// exist on Beds24's own `calendar` schema (price1, numAvail, minStay,
// maxStay, override, from, to) -- never invents a field. Throws rather than
// silently clamping if availability is out of the physical 0..quantity
// range, since that would indicate a bug upstream in Vilu's own sellable
// calculation, not something this transport layer should paper over.
function buildBeds24CalendarPayload({ roomTypeCode, from, to, rate, availability, minStay, maxStay, cta, ctd, stopSell }) {
  const identity = beds24RoomIdentity(roomTypeCode);
  if (availability != null && (availability < 0 || availability > identity.quantity)) {
    throw new Error('beds24-bridge: availability ' + availability + ' out of range 0..' + identity.quantity + ' for ' + roomTypeCode + ' on ' + from);
  }
  const entry = { from, to };
  if (rate != null) entry.price1 = rate;
  if (availability != null) entry.numAvail = availability;
  if (minStay != null) entry.minStay = minStay;
  if (maxStay != null) entry.maxStay = maxStay;
  entry.override = computeOverride({ stopSell: !!stopSell, cta: !!cta, ctd: !!ctd });
  return { roomId: identity.beds24_room_id, calendar: [entry] };
}

// ---------------------------------------------------------------------------
// Step 1: availability derivation. Reuses inventory.js's computeSellable()
// exactly as-is -- this function adds zero new counting logic, it only
// reshapes the existing per-(type,date) result into a room-type-code-keyed
// lookup so the Beds24 payload builder can address it by date. This is the
// "existing authoritative sellable counts must be reused" requirement.
function deriveSellableByRoomTypeCode({ roomsDocs, reservations, blocks, from, to }) {
  const roomTypes = buildRoomTypes(roomsDocs);
  const sellable = computeSellable({ roomTypes, reservations, blocks, from, to });
  const byCodeDate = {};
  for (const s of sellable) {
    const forCode = byCodeDate[s.room_type_code] || (byCodeDate[s.room_type_code] = {});
    forCode[s.date] = { available: s.available, total: s.total };
  }
  return { byCodeDate, errors: roomTypes.errors };
}

// ---------------------------------------------------------------------------
// Same-day cutoff (owner-locked policy, 2026-09-10 pass): a deterministic
// Indian/Maldives "now", independent of the server's or browser's own
// default timezone. Always converts an explicit instant (a Date, an ISO
// string, or the real current time when `now` is omitted) into Maldives
// wall-clock date+time via Intl with an explicit `timeZone` -- never reads
// process.env.TZ, Date.prototype.getHours(), or any other locale-dependent
// API. Maldives is UTC+5 year-round (no DST), so this conversion never
// drifts across a DST boundary the way a naive fixed +5h offset could if
// applied to a zone that actually observes DST.
const MALDIVES_TZ = 'Indian/Maldives';
const MALDIVES_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: MALDIVES_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const MALDIVES_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', { timeZone: MALDIVES_TZ, hour: '2-digit', minute: '2-digit', hour12: false });

function maldivesNow(now) {
  const instant = now instanceof Date ? now : new Date(now || Date.now());
  return { date: MALDIVES_DATE_FORMATTER.format(instant), time: MALDIVES_TIME_FORMATTER.format(instant) };
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Reads the existing, already-approved ota_room_types.same_day_cutoff field
// -- no second hard-coded policy source. Only ever affects TODAY (Maldives-
// local calendar date): any other date, past or future, is always false,
// regardless of what time it is right now. At or after the cutoff time,
// today's arrival eligibility closes; before it, today is unaffected. This
// answers only "is same-day arrival closed", never availability -- the
// caller folds this into the existing CTA input, so numAvail is never
// touched and the existing manual-stop-sell/CTA/CTD precedence in
// computeOverride is reused unchanged, not reimplemented.
function isSameDayCutoffActive({ date, config, now }) {
  if (!config || !config.same_day_cutoff) return false;
  const { date: todayMaldives, time: nowTime } = maldivesNow(now);
  if (date !== todayMaldives) return false;
  return timeToMinutes(nowTime) >= timeToMinutes(config.same_day_cutoff.time);
}

// ---------------------------------------------------------------------------
// Step 5: rate source. Vilu PMS's ota_room_types.base_rate is the default;
// an explicit per-date override (if the caller supplies one) supersedes it.
// No persisted rate-override-by-date store exists anywhere in this codebase
// yet (confirmed absent from firestore.rules and every test file this pass)
// -- `dateOverrides` is therefore an optional plain {date: rate} map the
// caller resolves from wherever that eventually lives, keeping this function
// pure and not inventing a persistence layer that wasn't asked for.
function resolveRate({ config, date, dateOverrides }) {
  if (dateOverrides && Object.prototype.hasOwnProperty.call(dateOverrides, date) && dateOverrides[date] != null) {
    return { rate: dateOverrides[date], overridden: true };
  }
  return { rate: config.base_rate, overridden: false };
}

// Builds one full translated Beds24 entry for one room type on one single
// date. Delegates ALL restriction/stop-sell/rate-precedence logic to
// ota-room-types.js's already-existing, already-tested computeOtaTypePayload
// -- this function's only job is translating that canonical, channel-
// agnostic shape into Beds24's specific wire field names via
// buildBeds24CalendarPayload. It never recomputes pricing or availability.
function buildDatePayload({ roomTypeCode, date, config, sellableAvailable, sellableTotal, dateOverrides, now }) {
  const { rate, overridden } = resolveRate({ config, date, dateOverrides });
  const generic = computeOtaTypePayload({
    config,
    override: overridden ? { rate } : null,
    sellableAvailable,
    sellableTotal,
  });
  // Beds24-specific stop-sell/blackout semantics (owner policy, confirmed in
  // the 2026-09-10 production-data validation pass): computeOtaTypePayload's
  // own `stopSell` is a GENERIC ARI flag that deliberately conflates three
  // causes -- config.manual_stop_sell, a caller override, and simply running
  // out of physical rooms (bufferedAvailable<=0) -- because a generic
  // channel-agnostic feed only needs "is this sellable" as one bit. Beds24's
  // `override` enum is not that generic bit: `blackout` is a strictly
  // stronger, explicit "we refuse to sell this, regardless of numAvail"
  // signal, and must be reserved for an actual manual stop-sell. A date that
  // is merely fully booked already communicates "0 available" via numAvail
  // alone -- exactly like every other date with 0 sellable rooms -- and must
  // NOT also be flagged blackout, or Beds24/an OTA could treat an ordinary
  // sold-out night as a deliberate, stronger closure. Only config's own
  // explicit manual_stop_sell flag drives override=blackout here.
  const manualStopSell = !!config.manual_stop_sell;
  // Same-day cutoff (2026-09-10 pass): folded straight into the CTA input --
  // never a new override branch -- so the existing, already-tested
  // precedence in computeOverride (manual stop-sell > CTA+CTD combo > CTA >
  // CTD > none) handles every combination automatically: a cutoff-closed
  // today that also has CTD already set correctly becomes
  // noCheckInOrCheckOut, and a cutoff-closed today under manual_stop_sell
  // correctly stays blackout. numAvail is completely untouched by this --
  // closing arrival is not the same fact as having no rooms.
  const cutoffActive = isSameDayCutoffActive({ date, config, now });
  const cta = !!generic.closedToArrival || cutoffActive;
  const ctd = !!generic.closedToDeparture;
  const payload = buildBeds24CalendarPayload({
    roomTypeCode,
    from: date,
    to: date,
    rate: generic.rate,
    availability: generic.numAvail,
    minStay: generic.minStay,
    maxStay: generic.maxStay,
    cta,
    ctd,
    stopSell: manualStopSell,
  });
  return { roomTypeCode, date, rate: generic.rate, rateOverridden: overridden, numAvail: generic.numAvail, stopSell: manualStopSell, cta, ctd, cutoffActive, payload };
}

// ---------------------------------------------------------------------------
// Steps 7-8: initial seed generator + validation, in one pass (dry run only
// -- this function never calls the network, it only ever returns data for
// the caller to inspect/push). `dateOverrides` is optional and keyed
// {[roomTypeCode]: {[date]: rate}}.
function generateInventorySeed({ roomsDocs, reservations, blocks, from, days, dateOverrides, now }) {
  if (!from) throw new Error('generateInventorySeed: from is required');
  const horizonDays = days || 365;
  const to = addDays(from, horizonDays);
  const { byCodeDate, errors } = deriveSellableByRoomTypeCode({ roomsDocs, reservations, blocks, from, to });
  const dates = dateRange(from, to);
  const codes = Object.keys(BEDS24_ROOM_MAP);

  const entries = [];
  const invalid = [];
  const seenKeys = new Set();
  let minAvailability = Infinity;
  let maxAvailability = -Infinity;
  let stopSellDates = 0;
  let ctaDates = 0;
  let ctdDates = 0;
  let rateOverrideDates = 0;
  let missingRateDates = 0;
  let cutoffAppliedDates = 0;

  for (const code of codes) {
    const roomTypeId = CODE_TO_ROOM_TYPE_ID[code];
    const config = roomTypeId ? INITIAL_OTA_ROOM_TYPES[roomTypeId] : null;
    if (!config) { invalid.push({ code, reason: 'no ota_room_types config for ' + code }); continue; }
    const identity = BEDS24_ROOM_MAP[code];
    const overridesForCode = (dateOverrides && dateOverrides[code]) || null;
    for (const date of dates) {
      const key = code + '|' + date;
      if (seenKeys.has(key)) { invalid.push({ code, date, reason: 'duplicate room/date entry' }); continue; }
      seenKeys.add(key);
      const sellDay = (byCodeDate[code] || {})[date];
      if (!sellDay) { invalid.push({ code, date, reason: 'missing sellable data' }); missingRateDates++; continue; }
      if (sellDay.total !== identity.quantity) {
        invalid.push({ code, date, reason: 'sellable total ' + sellDay.total + ' does not match canonical quantity ' + identity.quantity });
      }
      let built;
      try {
        built = buildDatePayload({ roomTypeCode: code, date, config, sellableAvailable: sellDay.available, sellableTotal: sellDay.total, dateOverrides: overridesForCode, now });
      } catch (e) {
        invalid.push({ code, date, reason: e.message });
        continue;
      }
      if (built.rate == null) { invalid.push({ code, date, reason: 'no rate resolved' }); missingRateDates++; continue; }
      if (built.numAvail < 0 || built.numAvail > identity.quantity) {
        invalid.push({ code, date, reason: 'numAvail ' + built.numAvail + ' out of range 0..' + identity.quantity });
      }
      entries.push(built);
      if (built.numAvail < minAvailability) minAvailability = built.numAvail;
      if (built.numAvail > maxAvailability) maxAvailability = built.numAvail;
      if (built.stopSell) stopSellDates++;
      if (built.cta) ctaDates++;
      if (built.ctd) ctdDates++;
      if (built.rateOverridden) rateOverrideDates++;
      if (built.cutoffActive) cutoffAppliedDates++;
    }
  }

  const expectedRecords = codes.length * dates.length;
  const stats = {
    date_range: { from, to },
    days_generated: dates.length,
    room_types: codes.length,
    total_calendar_records: entries.length,
    expected_records: expectedRecords,
    minimum_availability: entries.length ? minAvailability : null,
    maximum_availability: entries.length ? maxAvailability : null,
    stop_sell_dates: stopSellDates,
    cta_dates: ctaDates,
    ctd_dates: ctdDates,
    same_day_cutoff_dates: cutoffAppliedDates,
    rate_override_dates: rateOverrideDates,
    missing_rate_dates: missingRateDates,
    invalid_entries: invalid.length,
    inventory_errors: errors,
    generated_at: now || new Date().toISOString(),
  };
  return { entries, invalid, stats };
}

// ---------------------------------------------------------------------------
// Step 7 (continuous differential sync pass): pure range compression for one
// room's chronologically-ordered, single-date calendar entries (the exact
// shape buildBeds24CalendarPayload emits: {from, to, price1, numAvail,
// minStay, maxStay, override}, with from===to per entry). Only merges
// adjacent dates when EVERY relevant field is identical -- price1, numAvail,
// minStay, maxStay, override -- never across any value change. This mirrors
// the ad hoc compression proven against the real 365-day production dry run
// (1095 raw dates -> 33 ranges across the 3 real room types), now promoted
// into the committed, tested module instead of a one-off script.
function compressBeds24CalendarRanges(calendar) {
  if (!calendar || !calendar.length) return [];
  const key = (e) => JSON.stringify([e.price1 ?? null, e.numAvail ?? null, e.minStay ?? null, e.maxStay ?? null, e.override ?? null]);
  const out = [];
  let cur = null;
  let curKey = null;
  for (const entry of calendar) {
    const k = key(entry);
    if (cur && curKey === k && entry.from === addDays(cur.to, 1)) {
      cur.to = entry.to;
    } else {
      if (cur) out.push(cur);
      cur = Object.assign({}, entry);
      curKey = k;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Reverse of compressBeds24CalendarRanges(): expands a (possibly
// range-compressed) calendar array back into one entry per date, for
// round-trip testing and for semantically comparing a compressed source
// payload against Beds24's own independently-compressed readback (Beds24's
// internal range boundaries do not have to match ours to be correct -- see
// the real production readback pass, where Beds24 returned 15/11/10 ranges
// against our 14/10/9, yet every one of the 1095 underlying dates matched
// exactly once expanded).
function expandBeds24CalendarRanges(calendar) {
  const map = {};
  for (const entry of calendar || []) {
    for (const date of dateRange(entry.from, addDays(entry.to, 1))) {
      map[date] = { price1: entry.price1, numAvail: entry.numAvail, minStay: entry.minStay, maxStay: entry.maxStay, override: entry.override };
    }
  }
  return map;
}

// Groups generateInventorySeed()/buildDifferentialPayload()-style flat
// entries (one per {roomTypeCode, date}, each carrying its own
// single-date .payload.roomId/.payload.calendar[0]) into the POST-ready
// Beds24 request body shape, compressing each room's date run before
// returning. This is the one place raw per-date entries become the actual
// wire payload -- never constructed ad hoc at a call site.
function groupEntriesByRoom(entries) {
  const byRoom = {};
  for (const e of entries) {
    const roomId = e.payload.roomId;
    (byRoom[roomId] = byRoom[roomId] || []).push(e.payload.calendar[0]);
  }
  return Object.keys(byRoom).map((roomId) => ({ roomId: Number(roomId), calendar: compressBeds24CalendarRanges(byRoom[roomId]) }));
}

// ---------------------------------------------------------------------------
// Steps 2-6 (continuous differential sync): builds the payload for ONLY the
// affected room-type+date set (as produced by computeAffectedDates()), never
// the full horizon. Every date's state is recomputed from current Vilu PMS
// truth via the exact same deriveSellableByRoomTypeCode/buildDatePayload
// path generateInventorySeed uses -- absolute state every time, never a
// previous-value increment/decrement (so a missed or duplicate trigger can
// never drift Beds24 away from Vilu's real state).
// `affectedDates` shape: { [roomTypeCode]: ['2026-11-15', ...] } (from
// computeAffectedDates(), or hand-built for a rate/restriction-change path).
// `configs` shape: { [roomTypeCode]: otaRoomTypeConfig } -- the caller's own
// current ota_room_types read, never the bundled INITIAL_OTA_ROOM_TYPES
// constant, so a live rate/restriction edit is always reflected.
function buildDifferentialPayload({ roomsDocs, reservations, blocks, affectedDates, configs, dateOverrides, now }) {
  const codes = Object.keys(affectedDates || {});
  if (!codes.length) return { entries: [], invalid: [], grouped: [] };
  let minDate = null, maxDate = null;
  for (const code of codes) {
    for (const date of affectedDates[code]) {
      if (minDate === null || date < minDate) minDate = date;
      if (maxDate === null || date > maxDate) maxDate = date;
    }
  }
  const { byCodeDate, errors } = deriveSellableByRoomTypeCode({ roomsDocs, reservations, blocks, from: minDate, to: addDays(maxDate, 1) });
  const entries = [];
  const invalid = [];
  for (const code of codes) {
    const identity = BEDS24_ROOM_MAP[code];
    if (!identity) { invalid.push({ code, reason: 'unknown Beds24 room type code ' + code }); continue; }
    const config = configs && configs[code];
    if (!config) { invalid.push({ code, reason: 'no ota_room_types config supplied for ' + code }); continue; }
    const overridesForCode = (dateOverrides && dateOverrides[code]) || null;
    for (const date of affectedDates[code]) {
      const sellDay = (byCodeDate[code] || {})[date];
      if (!sellDay) { invalid.push({ code, date, reason: 'missing sellable data' }); continue; }
      try {
        const built = buildDatePayload({ roomTypeCode: code, date, config, sellableAvailable: sellDay.available, sellableTotal: sellDay.total, dateOverrides: overridesForCode, now });
        entries.push(built);
      } catch (e) {
        invalid.push({ code, date, reason: e.message });
      }
    }
  }
  return { entries, invalid, grouped: groupEntriesByRoom(entries), inventory_errors: errors };
}

// ---------------------------------------------------------------------------
// Step 9: differential sync design. Given a reservation's room/date footprint
// before and after a change (create/modify/cancel a reservation, or a block
// being added/removed), returns the minimal {roomTypeCode, dates[]} set that
// actually needs re-pushing -- never the full horizon. Pure: takes plain
// {room_id, check_in, check_out} shapes (or null for "did not exist before"/
// "no longer exists after"), returns which room-type+dates are affected.
function computeAffectedDates({ roomsDocs, before, after }) {
  const roomTypes = buildRoomTypes(roomsDocs);
  const codeForRoom = {};
  for (const type of Object.keys(roomTypes.types)) {
    for (const roomId of roomTypes.types[type]) codeForRoom[roomId] = roomTypes.codes[type] || type;
  }
  const affected = {}; // { [code]: Set<date> }
  function mark(stayLike) {
    if (!stayLike || !stayLike.room_id) return;
    const code = codeForRoom[stayLike.room_id];
    if (!code) return;
    const set = affected[code] || (affected[code] = new Set());
    for (const date of dateRange(stayLike.check_in, stayLike.check_out)) set.add(date);
  }
  mark(before);
  mark(after);
  const out = {};
  for (const code of Object.keys(affected)) out[code] = Array.from(affected[code]).sort();
  return out;
}

// ---------------------------------------------------------------------------
// Step 10: idempotent push-record builder. Reuses the EXISTING ota_pushes
// collection and its collision-proof doc-ID scheme from availability.js
// (timestamp digits + random suffix -- never a second queue/collection).
// Adds the additive fields Step 10 asked for (operation_id, status,
// attempt_count, last_error, updated_at) that the current audit-only
// records don't carry, without changing anything about the existing
// records' shape (every existing field is still present).
function buildBeds24PushRecord({ roomTypeCode, dateRange: range, payload, status, attemptCount, lastError, trigger, now }) {
  const nowIso = now || new Date().toISOString();
  const operationId = 'beds24_' + nowIso.replace(/[^0-9]/g, '') + '_' + crypto.randomBytes(9).toString('base64url');
  // Audit-safe payload hash (Step 8, continuous-sync pass): lets a caller or
  // reviewer confirm two pushes carried identical content, or spot a change,
  // WITHOUT storing the (potentially large) payload verbatim being the only
  // way to compare -- never a credential, never PII, just a content digest.
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload || null)).digest('hex');
  const identity = BEDS24_ROOM_MAP[roomTypeCode];
  return {
    id: operationId,
    record: {
      type: 'beds24_calendar_push',
      provider: 'beds24',
      operation_id: operationId,
      trigger: trigger || 'manual',
      room_type_code: roomTypeCode,
      beds24_room_id: identity ? identity.beds24_room_id : null,
      window: range,
      payload,
      payload_hash: payloadHash,
      status: status || 'pending', // pending | in_flight | succeeded | failed | review_required
      attempt_count: attemptCount || 0,
      last_error: lastError || null,
      created_at: nowIso,
      updated_at: nowIso,
      // Existing ota_pushes audit fields kept for continuity with the
      // availability.js writer -- never a second, differently-shaped queue.
      at: nowIso,
      result: status === 'succeeded' ? 'pushed' : status === 'failed' ? 'push_failed: ' + (lastError && lastError.message) : 'not_connected',
      error_reason: lastError ? (lastError.message || String(lastError)) : null,
      retry_count: attemptCount || 0,
    },
  };
}

module.exports = {
  BEDS24_PROPERTY_ID,
  BEDS24_ROOM_MAP,
  BEDS24_OVERRIDE,
  MALDIVES_TZ,
  beds24RoomIdentity,
  viluRoomTypeForBeds24RoomId,
  computeOverride,
  buildBeds24CalendarPayload,
  deriveSellableByRoomTypeCode,
  resolveRate,
  maldivesNow,
  isSameDayCutoffActive,
  buildDatePayload,
  generateInventorySeed,
  compressBeds24CalendarRanges,
  expandBeds24CalendarRanges,
  groupEntriesByRoom,
  buildDifferentialPayload,
  computeAffectedDates,
  buildBeds24PushRecord,
};
