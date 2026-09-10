// Vilu PMS -> Beds24 API v2 transport bridge -- unit tests (pre-connection
// stage). Pure logic only, no network, no live Beds24 write, no live
// reservation touched.
//   node test/beds24-bridge.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const {
  BEDS24_ROOM_MAP,
  BEDS24_OVERRIDE,
  beds24RoomIdentity,
  computeOverride,
  buildBeds24CalendarPayload,
  deriveSellableByRoomTypeCode,
  resolveRate,
  buildDatePayload,
  generateInventorySeed,
  computeAffectedDates,
  buildBeds24PushRecord,
} = F('beds24-bridge');
const { INITIAL_OTA_ROOM_TYPES } = F('ota-room-types');
const { PHYSICAL_ROOMS } = F('inventory');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

function reservation(id, room_id, check_in, check_out, status) {
  return { id, room_id, check_in, check_out, status: status || 'Confirmed' };
}
function block(id, room_id, from_date, to_date, kind) {
  return { id, room_id, from_date, to_date, kind: kind || 'maintenance' };
}

(async () => {
  // --- Room mapping -------------------------------------------------------
  await test('BEDS24_ROOM_MAP has exactly the three owner-confirmed room types with exact ids/rooms/quantity', () => {
    assert.deepStrictEqual(Object.keys(BEDS24_ROOM_MAP).sort(), ['DELUXE_FAMILY', 'DELUXE_FAMILY_OPEN_DECK', 'DOUBLE']);
    assert.deepStrictEqual(BEDS24_ROOM_MAP.DELUXE_FAMILY, { beds24_property_id: 352964, beds24_room_id: 727992, vilu_rooms: ['VR01', 'VR02'], quantity: 2 });
    assert.deepStrictEqual(BEDS24_ROOM_MAP.DOUBLE, { beds24_property_id: 352964, beds24_room_id: 728133, vilu_rooms: ['VR03', 'VR04', 'VR05'], quantity: 3 });
    assert.deepStrictEqual(BEDS24_ROOM_MAP.DELUXE_FAMILY_OPEN_DECK, { beds24_property_id: 352964, beds24_room_id: 728134, vilu_rooms: ['VR06'], quantity: 1 });
  });

  await test('BEDS24_ROOM_MAP quantities match the physical room count per type in inventory.js (single source of truth)', () => {
    for (const code of Object.keys(BEDS24_ROOM_MAP)) {
      const typeName = Object.keys(require(path.join(__dirname, '..', 'functions', 'lib', 'inventory')).ROOM_TYPE_CODES).find((t) => require(path.join(__dirname, '..', 'functions', 'lib', 'inventory')).ROOM_TYPE_CODES[t] === code);
      const physicalCount = PHYSICAL_ROOMS.filter((r) => r.type === typeName).length;
      assert.strictEqual(BEDS24_ROOM_MAP[code].quantity, physicalCount, code);
    }
  });

  await test('BEDS24_ROOM_MAP is frozen (immutable) at every level', () => {
    assert.ok(Object.isFrozen(BEDS24_ROOM_MAP));
    assert.ok(Object.isFrozen(BEDS24_ROOM_MAP.DOUBLE));
    assert.ok(Object.isFrozen(BEDS24_ROOM_MAP.DOUBLE.vilu_rooms));
  });

  await test('beds24RoomIdentity throws on an unknown room type code rather than returning undefined', () => {
    assert.throws(() => beds24RoomIdentity('NOT_A_ROOM_TYPE'), /unknown room type code/);
  });

  // --- Override precedence (Step 4) --------------------------------------
  await test('computeOverride: normal/open with no flags returns the documented neutral enum "none"', () => {
    assert.strictEqual(computeOverride({ stopSell: false, cta: false, ctd: false }), 'none');
    assert.strictEqual(BEDS24_OVERRIDE.NORMAL, 'none');
  });
  await test('computeOverride: CTA alone -> noCheckIn', () => {
    assert.strictEqual(computeOverride({ stopSell: false, cta: true, ctd: false }), 'noCheckIn');
  });
  await test('computeOverride: CTD alone -> noCheckOut', () => {
    assert.strictEqual(computeOverride({ stopSell: false, cta: false, ctd: true }), 'noCheckOut');
  });
  await test('computeOverride: CTA+CTD together -> noCheckInOrCheckOut (not lossy, not just one)', () => {
    assert.strictEqual(computeOverride({ stopSell: false, cta: true, ctd: true }), 'noCheckInOrCheckOut');
  });
  await test('computeOverride: stopSell -> blackout, and takes precedence over CTA/CTD even if both set', () => {
    assert.strictEqual(computeOverride({ stopSell: true, cta: false, ctd: false }), 'blackout');
    assert.strictEqual(computeOverride({ stopSell: true, cta: true, ctd: true }), 'blackout');
  });

  // --- Pure payload builder (Step 3) --------------------------------------
  await test('buildBeds24CalendarPayload emits only confirmed Beds24 calendar fields for the correct roomId', () => {
    const p = buildBeds24CalendarPayload({ roomTypeCode: 'DOUBLE', from: '2026-11-15', to: '2026-11-16', rate: 90, availability: 2, minStay: 1, maxStay: 30, cta: false, ctd: false, stopSell: false });
    assert.strictEqual(p.roomId, 728133);
    assert.deepStrictEqual(p.calendar, [{ from: '2026-11-15', to: '2026-11-16', price1: 90, numAvail: 2, minStay: 1, maxStay: 30, override: 'none' }]);
  });
  await test('buildBeds24CalendarPayload throws when availability is above the room type quantity', () => {
    assert.throws(() => buildBeds24CalendarPayload({ roomTypeCode: 'DELUXE_FAMILY_OPEN_DECK', from: '2026-11-15', to: '2026-11-16', availability: 2 }), /out of range 0\.\.1/);
  });
  await test('buildBeds24CalendarPayload throws when availability is negative', () => {
    assert.throws(() => buildBeds24CalendarPayload({ roomTypeCode: 'DOUBLE', from: '2026-11-15', to: '2026-11-16', availability: -1 }), /out of range/);
  });
  await test('buildBeds24CalendarPayload omits a field entirely rather than emitting null when not supplied', () => {
    const p = buildBeds24CalendarPayload({ roomTypeCode: 'DOUBLE', from: '2026-11-15', to: '2026-11-16', cta: false, ctd: false, stopSell: false });
    assert.strictEqual('price1' in p.calendar[0], false);
    assert.strictEqual('numAvail' in p.calendar[0], false);
  });

  // --- Inventory aggregation reuse (Step 1) -------------------------------
  await test('deriveSellableByRoomTypeCode: Deluxe Family both free -> available 2', () => {
    const { byCodeDate } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations: [], blocks: [], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(byCodeDate.DELUXE_FAMILY['2026-11-15'].available, 2);
    assert.strictEqual(byCodeDate.DELUXE_FAMILY['2026-11-15'].total, 2);
  });
  await test('deriveSellableByRoomTypeCode: Deluxe Family one booked -> available 1', () => {
    const reservations = [reservation('r1', 'VR01', '2026-11-15', '2026-11-16')];
    const { byCodeDate } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations, blocks: [], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(byCodeDate.DELUXE_FAMILY['2026-11-15'].available, 1);
  });
  await test('deriveSellableByRoomTypeCode: Deluxe Family both booked -> available 0', () => {
    const reservations = [reservation('r1', 'VR01', '2026-11-15', '2026-11-16'), reservation('r2', 'VR02', '2026-11-15', '2026-11-16')];
    const { byCodeDate } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations, blocks: [], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(byCodeDate.DELUXE_FAMILY['2026-11-15'].available, 0);
  });
  await test('deriveSellableByRoomTypeCode: Double 3/2/1/0 across four independent scenarios', () => {
    const base = { roomsDocs: [], blocks: [], from: '2026-11-15', to: '2026-11-16' };
    assert.strictEqual(deriveSellableByRoomTypeCode(Object.assign({ reservations: [] }, base)).byCodeDate.DOUBLE['2026-11-15'].available, 3);
    assert.strictEqual(deriveSellableByRoomTypeCode(Object.assign({ reservations: [reservation('r1', 'VR03', '2026-11-15', '2026-11-16')] }, base)).byCodeDate.DOUBLE['2026-11-15'].available, 2);
    assert.strictEqual(deriveSellableByRoomTypeCode(Object.assign({ reservations: [reservation('r1', 'VR03', '2026-11-15', '2026-11-16'), reservation('r2', 'VR04', '2026-11-15', '2026-11-16')] }, base)).byCodeDate.DOUBLE['2026-11-15'].available, 1);
    assert.strictEqual(deriveSellableByRoomTypeCode(Object.assign({ reservations: [reservation('r1', 'VR03', '2026-11-15', '2026-11-16'), reservation('r2', 'VR04', '2026-11-15', '2026-11-16'), reservation('r3', 'VR05', '2026-11-15', '2026-11-16')] }, base)).byCodeDate.DOUBLE['2026-11-15'].available, 0);
  });
  await test('deriveSellableByRoomTypeCode: Open Deck 1/0', () => {
    const { byCodeDate: free } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations: [], blocks: [], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(free.DELUXE_FAMILY_OPEN_DECK['2026-11-15'].available, 1);
    const { byCodeDate: booked } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations: [reservation('r1', 'VR06', '2026-11-15', '2026-11-16')], blocks: [], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(booked.DELUXE_FAMILY_OPEN_DECK['2026-11-15'].available, 0);
  });
  await test('deriveSellableByRoomTypeCode: a maintenance block occupies a room exactly like a reservation', () => {
    const { byCodeDate } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations: [], blocks: [block('b1', 'VR06', '2026-11-15', '2026-11-16')], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(byCodeDate.DELUXE_FAMILY_OPEN_DECK['2026-11-15'].available, 0);
  });
  await test('deriveSellableByRoomTypeCode: a Cancelled reservation does not occupy the room', () => {
    const { byCodeDate } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations: [reservation('r1', 'VR06', '2026-11-15', '2026-11-16', 'Cancelled')], blocks: [], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(byCodeDate.DELUXE_FAMILY_OPEN_DECK['2026-11-15'].available, 1);
  });
  await test('deriveSellableByRoomTypeCode: two overlapping reservations on the same room still only remove it once', () => {
    const reservations = [reservation('r1', 'VR06', '2026-11-15', '2026-11-17'), reservation('r2', 'VR06', '2026-11-16', '2026-11-18')];
    const { byCodeDate } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations, blocks: [], from: '2026-11-16', to: '2026-11-17' });
    assert.strictEqual(byCodeDate.DELUXE_FAMILY_OPEN_DECK['2026-11-16'].available, 0);
  });
  await test('deriveSellableByRoomTypeCode: boundary check-out/check-in on the same date do not conflict (half-open interval)', () => {
    const reservations = [reservation('r1', 'VR06', '2026-11-10', '2026-11-15'), reservation('r2', 'VR06', '2026-11-15', '2026-11-20')];
    const { byCodeDate } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations, blocks: [], from: '2026-11-15', to: '2026-11-16' });
    assert.strictEqual(byCodeDate.DELUXE_FAMILY_OPEN_DECK['2026-11-15'].available, 0, 'the arriving guest occupies the night of the 15th');
    const { byCodeDate: prevNight } = deriveSellableByRoomTypeCode({ roomsDocs: [], reservations, blocks: [], from: '2026-11-14', to: '2026-11-15' });
    assert.strictEqual(prevNight.DELUXE_FAMILY_OPEN_DECK['2026-11-14'].available, 0, 'the departing guest still occupies the night of the 14th');
  });

  // --- Rate resolution (Step 5) -------------------------------------------
  await test('resolveRate: falls back to config.base_rate when no date override supplied', () => {
    const { rate, overridden } = resolveRate({ config: INITIAL_OTA_ROOM_TYPES.double, date: '2026-11-15', dateOverrides: null });
    assert.strictEqual(rate, 90);
    assert.strictEqual(overridden, false);
  });
  await test('resolveRate: an explicit date override supersedes the base rate', () => {
    const { rate, overridden } = resolveRate({ config: INITIAL_OTA_ROOM_TYPES.double, date: '2026-12-31', dateOverrides: { '2026-12-31': 150 } });
    assert.strictEqual(rate, 150);
    assert.strictEqual(overridden, true);
  });
  await test('resolveRate: an override map that does not include this date falls through to base rate', () => {
    const { rate, overridden } = resolveRate({ config: INITIAL_OTA_ROOM_TYPES.double, date: '2026-11-15', dateOverrides: { '2026-12-31': 150 } });
    assert.strictEqual(rate, 90);
    assert.strictEqual(overridden, false);
  });

  // --- buildDatePayload combining computeOtaTypePayload + Beds24 translation
  await test('buildDatePayload: base rate, full availability, no restrictions -> override none', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.rate, 90);
    assert.strictEqual(d.numAvail, 3);
    assert.strictEqual(d.stopSell, false);
    assert.strictEqual(d.payload.roomId, 728133);
    assert.strictEqual(d.payload.calendar[0].override, 'none');
  });
  await test('buildDatePayload: zero sellable availability forces stopSell/blackout regardless of manual flags', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 0, sellableTotal: 3 });
    assert.strictEqual(d.stopSell, true);
    assert.strictEqual(d.numAvail, 0);
    assert.strictEqual(d.payload.calendar[0].override, 'blackout');
  });
  await test('buildDatePayload: config.manual_stop_sell forces stop-sell even with availability remaining', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { manual_stop_sell: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.stopSell, true);
    assert.strictEqual(d.payload.calendar[0].override, 'blackout');
  });
  await test('buildDatePayload: config.closed_to_arrival maps through to CTA override', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { closed_to_arrival: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.cta, true);
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckIn');
  });
  await test('buildDatePayload: config.closed_to_departure maps through to CTD override', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { closed_to_departure: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.ctd, true);
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckOut');
  });
  await test('buildDatePayload: CTA + CTD together map to the combined override', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { closed_to_arrival: true, closed_to_departure: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckInOrCheckOut');
  });
  await test('buildDatePayload: min_stay/max_stay pass through unchanged from config', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { min_stay: 2, max_stay: 14 });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.payload.calendar[0].minStay, 2);
    assert.strictEqual(d.payload.calendar[0].maxStay, 14);
  });
  await test('buildDatePayload: an availability_buffer reduces numAvail below the raw sellable count', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { availability_buffer: 1 });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.numAvail, 2);
  });
  await test('buildDatePayload: a date-specific rate override changes the rate but not availability/restrictions', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-12-31', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 3, sellableTotal: 3, dateOverrides: { '2026-12-31': 200 } });
    assert.strictEqual(d.rate, 200);
    assert.strictEqual(d.rateOverridden, true);
    assert.strictEqual(d.numAvail, 3);
  });

  // --- 365-day inventory seed generation (Steps 7-8) ----------------------
  await test('generateInventorySeed: default 365-day horizon over an empty PMS produces zero invalid entries and full availability', () => {
    const { entries, invalid, stats } = generateInventorySeed({ roomsDocs: [], reservations: [], blocks: [], from: '2026-11-15' });
    assert.strictEqual(stats.days_generated, 365);
    assert.strictEqual(stats.room_types, 3);
    assert.strictEqual(entries.length, 365 * 3);
    assert.strictEqual(stats.total_calendar_records, 365 * 3);
    assert.strictEqual(stats.expected_records, 365 * 3);
    assert.strictEqual(invalid.length, 0);
    assert.strictEqual(stats.invalid_entries, 0);
    assert.strictEqual(stats.missing_rate_dates, 0);
  });
  await test('generateInventorySeed: no entry ever reports availability above its room type quantity or below zero', () => {
    const reservations = [reservation('r1', 'VR03', '2026-11-20', '2026-11-25')];
    const { entries } = generateInventorySeed({ roomsDocs: [], reservations, blocks: [], from: '2026-11-15', days: 30 });
    for (const e of entries) {
      const q = BEDS24_ROOM_MAP[e.roomTypeCode].quantity;
      assert.ok(e.numAvail >= 0 && e.numAvail <= q, JSON.stringify(e));
    }
  });
  await test('generateInventorySeed: no missing dates and no duplicate room/date entries across the horizon', () => {
    const { entries, stats } = generateInventorySeed({ roomsDocs: [], reservations: [], blocks: [], from: '2026-11-15', days: 30 });
    const seen = new Set();
    for (const e of entries) {
      const key = e.roomTypeCode + '|' + e.date;
      assert.strictEqual(seen.has(key), false, 'duplicate ' + key);
      seen.add(key);
    }
    assert.strictEqual(stats.days_generated, 30);
    assert.strictEqual(entries.length, 30 * 3);
  });
  await test('generateInventorySeed: a fully-booked room type shows numAvail 0 / stop-sell on the affected date, others unaffected', () => {
    const reservations = [reservation('r1', 'VR06', '2026-11-16', '2026-11-17')];
    const { entries } = generateInventorySeed({ roomsDocs: [], reservations, blocks: [], from: '2026-11-15', days: 5 });
    const openDeckDay = entries.find((e) => e.roomTypeCode === 'DELUXE_FAMILY_OPEN_DECK' && e.date === '2026-11-16');
    assert.strictEqual(openDeckDay.numAvail, 0);
    assert.strictEqual(openDeckDay.stopSell, true);
    const doubleDay = entries.find((e) => e.roomTypeCode === 'DOUBLE' && e.date === '2026-11-16');
    assert.strictEqual(doubleDay.numAvail, 3);
  });
  await test('generateInventorySeed: per-room-type date overrides apply only to that room type', () => {
    const { entries } = generateInventorySeed({ roomsDocs: [], reservations: [], blocks: [], from: '2026-11-15', days: 3, dateOverrides: { DOUBLE: { '2026-11-16': 250 } } });
    const doubleOverridden = entries.find((e) => e.roomTypeCode === 'DOUBLE' && e.date === '2026-11-16');
    const openDeckSameDate = entries.find((e) => e.roomTypeCode === 'DELUXE_FAMILY_OPEN_DECK' && e.date === '2026-11-16');
    assert.strictEqual(doubleOverridden.rate, 250);
    assert.strictEqual(openDeckSameDate.rate, 90);
  });

  // --- Differential sync (Step 9) -----------------------------------------
  await test('computeAffectedDates: a new reservation marks only its own room type and stay nights', () => {
    const affected = computeAffectedDates({ roomsDocs: [], before: null, after: { room_id: 'VR03', check_in: '2026-11-15', check_out: '2026-11-18' } });
    assert.deepStrictEqual(affected, { DOUBLE: ['2026-11-15', '2026-11-16', '2026-11-17'] });
  });
  await test('computeAffectedDates: a cancellation (after=null) still marks the vacated dates for re-push', () => {
    const affected = computeAffectedDates({ roomsDocs: [], before: { room_id: 'VR06', check_in: '2026-11-15', check_out: '2026-11-16' }, after: null });
    assert.deepStrictEqual(affected, { DELUXE_FAMILY_OPEN_DECK: ['2026-11-15'] });
  });
  await test('computeAffectedDates: a modification that changes dates marks the UNION of the old and new ranges, not just the new one', () => {
    const affected = computeAffectedDates({ roomsDocs: [], before: { room_id: 'VR03', check_in: '2026-11-15', check_out: '2026-11-17' }, after: { room_id: 'VR03', check_in: '2026-11-16', check_out: '2026-11-18' } });
    assert.deepStrictEqual(affected.DOUBLE, ['2026-11-15', '2026-11-16', '2026-11-17']);
  });
  await test('computeAffectedDates: a block placed on a room affects only that room type', () => {
    const affected = computeAffectedDates({ roomsDocs: [], before: null, after: { room_id: 'VR01', check_in: '2026-11-15', check_out: '2026-11-16' } });
    assert.deepStrictEqual(affected, { DELUXE_FAMILY: ['2026-11-15'] });
  });
  await test('computeAffectedDates: never touches the full 365-day horizon for a single-night change', () => {
    const affected = computeAffectedDates({ roomsDocs: [], before: null, after: { room_id: 'VR03', check_in: '2026-11-15', check_out: '2026-11-16' } });
    assert.strictEqual(affected.DOUBLE.length, 1);
  });

  // --- Idempotent push record (Step 10, reusing ota_pushes) ---------------
  await test('buildBeds24PushRecord: generates a unique, collision-safe operation id even for calls in the same millisecond', () => {
    const now = '2026-11-15T00:00:00.000Z';
    const a = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: {}, now });
    const b = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: {}, now });
    assert.notStrictEqual(a.id, b.id);
  });
  await test('buildBeds24PushRecord: defaults to status "pending" / attempt_count 0 / result "not_connected" when not yet attempted', () => {
    const { record } = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: { roomId: 728133 } });
    assert.strictEqual(record.status, 'pending');
    assert.strictEqual(record.attempt_count, 0);
    assert.strictEqual(record.last_error, null);
    assert.strictEqual(record.result, 'not_connected');
    assert.strictEqual(record.type, 'beds24_calendar_push');
  });
  await test('buildBeds24PushRecord: a failed attempt never claims "pushed" -- API failure must not look like success', () => {
    const err = new Error('ECONNRESET');
    const { record } = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: {}, status: 'failed', attemptCount: 2, lastError: err });
    assert.strictEqual(record.status, 'failed');
    assert.strictEqual(record.attempt_count, 2);
    assert.strictEqual(record.last_error, err);
    assert.ok(record.result.startsWith('push_failed'));
    assert.strictEqual(record.error_reason, 'ECONNRESET');
  });
  await test('buildBeds24PushRecord: a succeeded attempt reports result "pushed"', () => {
    const { record } = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: {}, status: 'succeeded', attemptCount: 1 });
    assert.strictEqual(record.result, 'pushed');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
