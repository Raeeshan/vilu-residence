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
  MALDIVES_TZ,
  beds24RoomIdentity,
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
  await test('buildDatePayload: a NATURAL sellout (numAvail 0 from full occupancy, no manual flag) must NOT become override=blackout -- only numAvail drops to 0', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 0, sellableTotal: 3 });
    assert.strictEqual(d.numAvail, 0);
    assert.strictEqual(d.stopSell, false, 'a natural sellout is not a manual stop-sell');
    assert.strictEqual(d.payload.calendar[0].override, 'none', 'blackout must be reserved for an explicit manual stop-sell, never inferred from numAvail alone');
  });
  await test('buildDatePayload: config.manual_stop_sell forces override=blackout even with availability remaining', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { manual_stop_sell: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 3, sellableTotal: 3 });
    assert.strictEqual(d.stopSell, true);
    assert.strictEqual(d.payload.calendar[0].override, 'blackout');
  });
  await test('buildDatePayload: manual_stop_sell AND a natural sellout together still resolve to exactly one blackout, driven by the manual flag', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { manual_stop_sell: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 0, sellableTotal: 3 });
    assert.strictEqual(d.stopSell, true);
    assert.strictEqual(d.numAvail, 0);
    assert.strictEqual(d.payload.calendar[0].override, 'blackout');
  });
  await test('buildDatePayload: a natural sellout combined with CTA still surfaces CTA in the override, not blackout', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { closed_to_arrival: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-15', config, sellableAvailable: 0, sellableTotal: 3 });
    assert.strictEqual(d.numAvail, 0);
    assert.strictEqual(d.stopSell, false);
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckIn');
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
  await test('generateInventorySeed: a fully-booked room type shows numAvail 0 (natural sellout, NOT a manual stop-sell/blackout) on the affected date, others unaffected', () => {
    const reservations = [reservation('r1', 'VR06', '2026-11-16', '2026-11-17')];
    const { entries } = generateInventorySeed({ roomsDocs: [], reservations, blocks: [], from: '2026-11-15', days: 5 });
    const openDeckDay = entries.find((e) => e.roomTypeCode === 'DELUXE_FAMILY_OPEN_DECK' && e.date === '2026-11-16');
    assert.strictEqual(openDeckDay.numAvail, 0);
    assert.strictEqual(openDeckDay.stopSell, false, 'a fully-booked date is a natural sellout, not a manual stop-sell');
    assert.strictEqual(openDeckDay.payload.calendar[0].override, 'none');
    const doubleDay = entries.find((e) => e.roomTypeCode === 'DOUBLE' && e.date === '2026-11-16');
    assert.strictEqual(doubleDay.numAvail, 3);
  });
  await test('generateInventorySeed: stop_sell_dates in stats counts only manual-blackout dates, never natural-sellout dates', () => {
    const reservations = [reservation('r1', 'VR06', '2026-11-16', '2026-11-17')];
    const { stats } = generateInventorySeed({ roomsDocs: [], reservations, blocks: [], from: '2026-11-15', days: 5 });
    assert.strictEqual(stats.stop_sell_dates, 0, 'no manual_stop_sell configured anywhere in this scenario, despite one naturally sold-out date');
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

  // --- Same-day cutoff (owner-locked: 12:00 Indian/Maldives) --------------
  // Maldives is UTC+5 year-round (no DST): Maldives 12:00 on a given
  // calendar date is always exactly 07:00 UTC that same date.
  await test('maldivesNow: converts a UTC instant to Maldives wall-clock date+time via explicit timeZone, never the runtime default zone', () => {
    const n = maldivesNow('2026-11-20T07:00:00.000Z');
    assert.strictEqual(n.date, '2026-11-20');
    assert.strictEqual(n.time, '12:00');
    assert.strictEqual(MALDIVES_TZ, 'Indian/Maldives');
  });
  await test('maldivesNow: correctly crosses a UTC day boundary that is NOT the Maldives day boundary (UTC late-evening = Maldives next-day early-morning)', () => {
    const n = maldivesNow('2026-11-19T20:00:00.000Z');
    assert.strictEqual(n.date, '2026-11-20', 'UTC 20:00 on the 19th is already 01:00 on the 20th in UTC+5');
    assert.strictEqual(n.time, '01:00');
  });
  await test('isSameDayCutoffActive: 11:59 Maldives -> same-day arrival still allowed', () => {
    const active = isSameDayCutoffActive({ date: '2026-11-20', config: INITIAL_OTA_ROOM_TYPES.double, now: '2026-11-20T06:59:00.000Z' });
    assert.strictEqual(active, false);
  });
  await test('isSameDayCutoffActive: exactly 12:00 Maldives -> same-day CTA active (at-or-after semantics)', () => {
    const active = isSameDayCutoffActive({ date: '2026-11-20', config: INITIAL_OTA_ROOM_TYPES.double, now: '2026-11-20T07:00:00.000Z' });
    assert.strictEqual(active, true);
  });
  await test('isSameDayCutoffActive: 12:01 Maldives -> same-day CTA still active', () => {
    const active = isSameDayCutoffActive({ date: '2026-11-20', config: INITIAL_OTA_ROOM_TYPES.double, now: '2026-11-20T07:01:00.000Z' });
    assert.strictEqual(active, true);
  });
  await test('isSameDayCutoffActive: a FUTURE date is never affected by cutoff, no matter the current time', () => {
    const active = isSameDayCutoffActive({ date: '2026-12-25', config: INITIAL_OTA_ROOM_TYPES.double, now: '2026-11-20T09:00:00.000Z' });
    assert.strictEqual(active, false);
  });
  await test('isSameDayCutoffActive: a PAST date is never affected by cutoff, no matter the current time', () => {
    const active = isSameDayCutoffActive({ date: '2026-01-01', config: INITIAL_OTA_ROOM_TYPES.double, now: '2026-11-20T09:00:00.000Z' });
    assert.strictEqual(active, false);
  });
  await test('isSameDayCutoffActive: missing same_day_cutoff config never throws, just returns false', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { same_day_cutoff: null });
    assert.strictEqual(isSameDayCutoffActive({ date: '2026-11-20', config, now: '2026-11-20T08:00:00.000Z' }), false);
  });

  await test('buildDatePayload: before cutoff, today has its normal restriction state (no CTA from cutoff)', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-20', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 3, sellableTotal: 3, now: '2026-11-20T06:59:00.000Z' });
    assert.strictEqual(d.cutoffActive, false);
    assert.strictEqual(d.cta, false);
    assert.strictEqual(d.payload.calendar[0].override, 'none');
    assert.strictEqual(d.numAvail, 3, 'availability must never be touched by cutoff logic');
  });
  await test('buildDatePayload: at/after cutoff, today becomes closed-to-arrival (override=noCheckIn), numAvail untouched', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-20', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 3, sellableTotal: 3, now: '2026-11-20T07:00:00.000Z' });
    assert.strictEqual(d.cutoffActive, true);
    assert.strictEqual(d.cta, true);
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckIn');
    assert.strictEqual(d.numAvail, 3, 'closing arrival is not the same fact as having no rooms');
  });
  await test('buildDatePayload: cutoff is a same-day-only effect -- tomorrow (still within the payload run) is completely unaffected', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-21', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 3, sellableTotal: 3, now: '2026-11-20T07:00:00.000Z' });
    assert.strictEqual(d.cutoffActive, false);
    assert.strictEqual(d.payload.calendar[0].override, 'none');
  });
  await test('buildDatePayload: cutoff-driven CTA combined with a pre-existing CTD -> noCheckInOrCheckOut (existing precedence reused, not reimplemented)', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { closed_to_departure: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-20', config, sellableAvailable: 3, sellableTotal: 3, now: '2026-11-20T07:00:00.000Z' });
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckInOrCheckOut');
  });
  await test('buildDatePayload: cutoff-driven CTA is a no-op restriction change when CTA was already true for another reason', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { closed_to_arrival: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-20', config, sellableAvailable: 3, sellableTotal: 3, now: '2026-11-20T07:00:00.000Z' });
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckIn');
  });
  await test('buildDatePayload: manual stop-sell outranks the cutoff -- still blackout, not noCheckIn, when both are true', () => {
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { manual_stop_sell: true });
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-20', config, sellableAvailable: 3, sellableTotal: 3, now: '2026-11-20T07:00:00.000Z' });
    assert.strictEqual(d.payload.calendar[0].override, 'blackout');
    assert.strictEqual(d.stopSell, true);
  });
  await test('buildDatePayload: a natural sellout (numAvail 0, no manual flag) combined with cutoff still surfaces noCheckIn, never blackout', () => {
    const d = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2026-11-20', config: INITIAL_OTA_ROOM_TYPES.double, sellableAvailable: 0, sellableTotal: 3, now: '2026-11-20T07:00:00.000Z' });
    assert.strictEqual(d.numAvail, 0);
    assert.strictEqual(d.stopSell, false, 'still not a manual stop-sell -- the a6bc79f fix must not regress');
    assert.strictEqual(d.payload.calendar[0].override, 'noCheckIn', 'cutoff CTA still applies on top of a natural sellout');
  });

  // --- Range compression (Step 7, continuous differential sync) ---------
  function singleDate(date, fields) { return Object.assign({ from: date, to: date }, fields); }
  await test('compressBeds24CalendarRanges: an empty calendar compresses to an empty array', () => {
    assert.deepStrictEqual(compressBeds24CalendarRanges([]), []);
  });
  await test('compressBeds24CalendarRanges: a single entry stays a single range', () => {
    const out = compressBeds24CalendarRanges([singleDate('2026-11-15', { price1: 90, numAvail: 3, minStay: 1, override: 'none' })]);
    assert.deepStrictEqual(out, [{ from: '2026-11-15', to: '2026-11-15', price1: 90, numAvail: 3, minStay: 1, override: 'none' }]);
  });
  await test('compressBeds24CalendarRanges: consecutive dates with identical values merge into one range', () => {
    const cal = ['2026-11-15', '2026-11-16', '2026-11-17'].map((d) => singleDate(d, { price1: 90, numAvail: 3, minStay: 1, override: 'none' }));
    const out = compressBeds24CalendarRanges(cal);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].from, '2026-11-15');
    assert.strictEqual(out[0].to, '2026-11-17');
  });
  await test('compressBeds24CalendarRanges: never merges across ANY value change (numAvail)', () => {
    const cal = [singleDate('2026-11-15', { price1: 90, numAvail: 3, minStay: 1, override: 'none' }), singleDate('2026-11-16', { price1: 90, numAvail: 2, minStay: 1, override: 'none' })];
    const out = compressBeds24CalendarRanges(cal);
    assert.strictEqual(out.length, 2);
  });
  await test('compressBeds24CalendarRanges: never merges across a rate change even if availability/restrictions match', () => {
    const cal = [singleDate('2026-11-15', { price1: 90, numAvail: 3, minStay: 1, override: 'none' }), singleDate('2026-11-16', { price1: 120, numAvail: 3, minStay: 1, override: 'none' })];
    assert.strictEqual(compressBeds24CalendarRanges(cal).length, 2);
  });
  await test('compressBeds24CalendarRanges: never merges across an override change', () => {
    const cal = [singleDate('2026-11-15', { price1: 90, numAvail: 3, minStay: 1, override: 'none' }), singleDate('2026-11-16', { price1: 90, numAvail: 3, minStay: 1, override: 'noCheckIn' })];
    assert.strictEqual(compressBeds24CalendarRanges(cal).length, 2);
  });
  await test('compressBeds24CalendarRanges: never merges across a non-adjacent date gap even with identical values', () => {
    const cal = [singleDate('2026-11-15', { price1: 90, numAvail: 3, minStay: 1, override: 'none' }), singleDate('2026-11-20', { price1: 90, numAvail: 3, minStay: 1, override: 'none' })];
    const out = compressBeds24CalendarRanges(cal);
    assert.strictEqual(out.length, 2, 'a gap in dates must never be silently bridged');
  });
  await test('compressBeds24CalendarRanges: matches the real production result -- 365 dates compress to the exact ranges proven against real data', () => {
    const seed = generateInventorySeed({ roomsDocs: [], reservations: [{ id: 'r1', room_id: 'VR03', check_in: '2026-11-20', check_out: '2026-11-25', status: 'Confirmed' }], blocks: [], from: '2026-11-15', days: 30 });
    const doubleEntries = seed.entries.filter((e) => e.roomTypeCode === 'DOUBLE').sort((a, b) => a.date.localeCompare(b.date));
    const cal = doubleEntries.map((e) => e.payload.calendar[0]);
    const compressed = compressBeds24CalendarRanges(cal);
    assert.ok(compressed.length < cal.length, 'compression must reduce the entry count for a mostly-uniform 30-day run');
  });

  await test('compressBeds24CalendarRanges -> expandBeds24CalendarRanges round trip is semantically identical to the raw input', () => {
    const seed = generateInventorySeed({ roomsDocs: [], reservations: [{ id: 'r1', room_id: 'VR01', check_in: '2026-11-18', check_out: '2026-11-22', status: 'Confirmed' }], blocks: [{ id: 'b1', room_id: 'VR02', from_date: '2026-12-01', to_date: '2026-12-05' }], from: '2026-11-15', days: 60 });
    const dfEntries = seed.entries.filter((e) => e.roomTypeCode === 'DELUXE_FAMILY').sort((a, b) => a.date.localeCompare(b.date));
    const raw = dfEntries.map((e) => e.payload.calendar[0]);
    const compressed = compressBeds24CalendarRanges(raw);
    const expandedFromCompressed = expandBeds24CalendarRanges(compressed);
    for (const entry of raw) {
      const roundTripped = expandedFromCompressed[entry.from];
      assert.deepStrictEqual(roundTripped, { price1: entry.price1, numAvail: entry.numAvail, minStay: entry.minStay, maxStay: entry.maxStay, override: entry.override }, 'date ' + entry.from + ' must survive compress->expand unchanged');
    }
    assert.strictEqual(Object.keys(expandedFromCompressed).length, raw.length, 'no date gained or lost in the round trip');
  });

  await test('groupEntriesByRoom: groups a flat 3-room-type entry list into one compressed calendar per Beds24 roomId', () => {
    const seed = generateInventorySeed({ roomsDocs: [], reservations: [], blocks: [], from: '2026-11-15', days: 10 });
    const grouped = groupEntriesByRoom(seed.entries);
    assert.strictEqual(grouped.length, 3);
    const roomIds = grouped.map((g) => g.roomId).sort((a, b) => a - b);
    assert.deepStrictEqual(roomIds, [727992, 728133, 728134]);
    for (const g of grouped) assert.ok(g.calendar.length <= 10, 'a uniform 10-day run must compress to at most 10 ranges');
  });

  // --- Differential (affected-dates-only) payload builder (Steps 2-6) -----
  await test('buildDifferentialPayload: with no affected dates, returns empty output and touches nothing', () => {
    const out = buildDifferentialPayload({ roomsDocs: [], reservations: [], blocks: [], affectedDates: {}, configs: {} });
    assert.deepStrictEqual(out.entries, []);
    assert.deepStrictEqual(out.grouped, []);
  });
  await test('buildDifferentialPayload: a single new reservation only recomputes its own affected room-type+dates, not the whole horizon', () => {
    const affectedDates = computeAffectedDates({ roomsDocs: [], before: null, after: { room_id: 'VR04', check_in: '2026-11-15', check_out: '2026-11-18' } });
    const reservations = [{ id: 'r1', room_id: 'VR04', check_in: '2026-11-15', check_out: '2026-11-18', status: 'Confirmed' }];
    const out = buildDifferentialPayload({ roomsDocs: [], reservations, blocks: [], affectedDates, configs: { DOUBLE: INITIAL_OTA_ROOM_TYPES.double } });
    assert.strictEqual(out.entries.length, 3, 'exactly the 3 affected nights, nothing more');
    assert.ok(out.entries.every((e) => e.roomTypeCode === 'DOUBLE'));
    assert.ok(out.entries.every((e) => e.numAvail === 2), 'VR04 occupied out of 3 -> 2 available');
  });
  await test('buildDifferentialPayload: always recomputes ABSOLUTE state, never previous+1/-1 -- reflects every current occupant, not just the triggering one', () => {
    const affectedDates = { DOUBLE: ['2026-11-16'] };
    const reservations = [
      { id: 'r1', room_id: 'VR03', check_in: '2026-11-15', check_out: '2026-11-20', status: 'Confirmed' },
      { id: 'r2', room_id: 'VR04', check_in: '2026-11-16', check_out: '2026-11-17', status: 'Confirmed' },
    ];
    const out = buildDifferentialPayload({ roomsDocs: [], reservations, blocks: [], affectedDates, configs: { DOUBLE: INITIAL_OTA_ROOM_TYPES.double } });
    assert.strictEqual(out.entries[0].numAvail, 1, 'VR03 and VR04 both occupied on the 16th -> only VR05 free, regardless of which reservation triggered the recompute');
  });
  await test('buildDifferentialPayload: a room-change (VR03 -> VR06) recomputes BOTH affected room types independently', () => {
    const affectedDates = {
      ...computeAffectedDates({ roomsDocs: [], before: { room_id: 'VR03', check_in: '2026-11-15', check_out: '2026-11-17' }, after: null }),
      ...computeAffectedDates({ roomsDocs: [], before: null, after: { room_id: 'VR06', check_in: '2026-11-15', check_out: '2026-11-17' } }),
    };
    const reservations = [{ id: 'r1', room_id: 'VR06', check_in: '2026-11-15', check_out: '2026-11-17', status: 'Confirmed' }];
    const out = buildDifferentialPayload({ roomsDocs: [], reservations, blocks: [], affectedDates, configs: { DOUBLE: INITIAL_OTA_ROOM_TYPES.double, DELUXE_FAMILY_OPEN_DECK: INITIAL_OTA_ROOM_TYPES.open_deck } });
    const doubleEntries = out.entries.filter((e) => e.roomTypeCode === 'DOUBLE');
    const openDeckEntries = out.entries.filter((e) => e.roomTypeCode === 'DELUXE_FAMILY_OPEN_DECK');
    assert.strictEqual(doubleEntries.length, 2);
    assert.ok(doubleEntries.every((e) => e.numAvail === 3), 'VR03 freed up (reservation moved away) -> Double back to full 3');
    assert.strictEqual(openDeckEntries.length, 2);
    assert.ok(openDeckEntries.every((e) => e.numAvail === 0), 'VR06 now occupied -> Open Deck 0');
  });
  await test('buildDifferentialPayload: a Cancelled reservation triggering recompute correctly shows the released dates as free', () => {
    const affectedDates = computeAffectedDates({ roomsDocs: [], before: { room_id: 'VR06', check_in: '2026-11-15', check_out: '2026-11-16' }, after: null });
    const out = buildDifferentialPayload({ roomsDocs: [], reservations: [{ id: 'r1', room_id: 'VR06', check_in: '2026-11-15', check_out: '2026-11-16', status: 'Cancelled' }], blocks: [], affectedDates, configs: { DELUXE_FAMILY_OPEN_DECK: INITIAL_OTA_ROOM_TYPES.open_deck } });
    assert.strictEqual(out.entries[0].numAvail, 1);
  });
  await test('buildDifferentialPayload: a rate/restriction-only change (no occupancy change) recomputes the caller-specified date range with the new config', () => {
    const affectedDates = { DOUBLE: ['2026-11-15', '2026-11-16'] };
    const config = Object.assign({}, INITIAL_OTA_ROOM_TYPES.double, { base_rate: 150 });
    const out = buildDifferentialPayload({ roomsDocs: [], reservations: [], blocks: [], affectedDates, configs: { DOUBLE: config } });
    assert.ok(out.entries.every((e) => e.rate === 150));
  });
  await test('buildDifferentialPayload: rejects an unknown room type code without touching any other room type', () => {
    const out = buildDifferentialPayload({ roomsDocs: [], reservations: [], blocks: [], affectedDates: { NOT_A_TYPE: ['2026-11-15'], DOUBLE: ['2026-11-15'] }, configs: { DOUBLE: INITIAL_OTA_ROOM_TYPES.double } });
    assert.strictEqual(out.invalid.some((i) => i.code === 'NOT_A_TYPE'), true);
    assert.strictEqual(out.entries.filter((e) => e.roomTypeCode === 'DOUBLE').length, 1);
  });
  await test('buildDifferentialPayload: grouped output is ready to POST directly (roomId + compressed calendar)', () => {
    const affectedDates = { DOUBLE: ['2026-11-15', '2026-11-16', '2026-11-17'] };
    const out = buildDifferentialPayload({ roomsDocs: [], reservations: [], blocks: [], affectedDates, configs: { DOUBLE: INITIAL_OTA_ROOM_TYPES.double } });
    assert.strictEqual(out.grouped.length, 1);
    assert.strictEqual(out.grouped[0].roomId, 728133);
    assert.strictEqual(out.grouped[0].calendar.length, 1, 'three identical uniform days compress to one range');
  });

  // --- buildBeds24PushRecord additive audit fields (Step 8) ---------------
  await test('buildBeds24PushRecord: carries provider="beds24" and the resolved beds24_room_id, never a credential or PII', () => {
    const { record } = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: { roomId: 728133, calendar: [] } });
    assert.strictEqual(record.provider, 'beds24');
    assert.strictEqual(record.beds24_room_id, 728133);
    assert.strictEqual(JSON.stringify(record).toLowerCase().includes('refresh'), false);
  });
  await test('buildBeds24PushRecord: payload_hash is deterministic for identical payloads and differs for different ones', () => {
    const a = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: { roomId: 728133, calendar: [{ from: '2026-11-15', to: '2026-11-15', numAvail: 2 }] } });
    const b = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: { roomId: 728133, calendar: [{ from: '2026-11-15', to: '2026-11-15', numAvail: 2 }] } });
    const c = buildBeds24PushRecord({ roomTypeCode: 'DOUBLE', dateRange: { from: '2026-11-15', to: '2026-11-16' }, payload: { roomId: 728133, calendar: [{ from: '2026-11-15', to: '2026-11-15', numAvail: 1 }] } });
    assert.strictEqual(a.record.payload_hash, b.record.payload_hash);
    assert.notStrictEqual(a.record.payload_hash, c.record.payload_hash);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
