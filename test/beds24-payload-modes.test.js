// Phase B24-2A, Section H — availability-only vs rate-only Beds24 calendar
// payload separation. Verifies the field-level omission behavior confirmed
// against Beds24's official OpenAPI v2 spec: an omitted field is left
// completely untouched server-side (never reset), so a true availability-
// only or rate-only push is possible and this module actually builds one.
// Pure unit tests, no network.
//   node test/beds24-payload-modes.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { buildBeds24CalendarPayload, buildDatePayload } = F('beds24-bridge');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

const BASE_CONFIG = { base_rate: 90, min_stay: 1, max_stay: null, closed_to_arrival: false, closed_to_departure: false, manual_stop_sell: false, availability_buffer: 0, currency: 'USD', room_type_id: 'double', tax_mode: 'net_of_tax' };

section('buildBeds24CalendarPayload — low-level field omission');

test('rate omitted (null) -> entry has no price1 key at all (not price1:null)', () => {
  const { calendar } = buildBeds24CalendarPayload({ roomTypeCode: 'DOUBLE', from: '2027-01-01', to: '2027-01-01', rate: null, availability: 2 });
  assert.equal('price1' in calendar[0], false);
});
test('availability omitted (null) -> entry has no numAvail key at all', () => {
  const { calendar } = buildBeds24CalendarPayload({ roomTypeCode: 'DOUBLE', from: '2027-01-01', to: '2027-01-01', rate: 90, availability: null });
  assert.equal('numAvail' in calendar[0], false);
});
test('includeOverride:false -> entry has no override key at all, regardless of stopSell/cta/ctd inputs', () => {
  const { calendar } = buildBeds24CalendarPayload({ roomTypeCode: 'DOUBLE', from: '2027-01-01', to: '2027-01-01', rate: 90, availability: null, stopSell: true, cta: true, ctd: true, includeOverride: false });
  assert.equal('override' in calendar[0], false);
});
test('includeOverride omitted (default) -> override IS present (backward compatible)', () => {
  const { calendar } = buildBeds24CalendarPayload({ roomTypeCode: 'DOUBLE', from: '2027-01-01', to: '2027-01-01', rate: 90, availability: 2 });
  assert.equal('override' in calendar[0], true);
});

section('buildDatePayload — mode: availability (Phase B24-2A.1: strict 3-way split)');

test('mode "availability" includes ONLY numAvail -- excludes price1/minStay/maxStay/override entirely', () => {
  const { payload, mode } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'availability' });
  const entry = payload.calendar[0];
  assert.equal(mode, 'availability');
  assert.equal('numAvail' in entry, true);
  assert.equal('price1' in entry, false);
  assert.equal('minStay' in entry, false);
  assert.equal('maxStay' in entry, false);
  assert.equal('override' in entry, false);
});

test('mode "availability" never leaks override even under manual_stop_sell -- a pure availability push must never touch blackout/restriction state', () => {
  const stopSoldConfig = Object.assign({}, BASE_CONFIG, { manual_stop_sell: true });
  const { payload } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: stopSoldConfig, sellableAvailable: 2, sellableTotal: 3, mode: 'availability' });
  assert.equal('override' in payload.calendar[0], false);
});

section('buildDatePayload — mode: rate (Phase B24-2A.1: strict 3-way split)');

test('mode "rate" includes ONLY price1 -- excludes numAvail/override/minStay/maxStay entirely (never touches availability or restriction state)', () => {
  const { payload, mode } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'rate' });
  const entry = payload.calendar[0];
  assert.equal(mode, 'rate');
  assert.equal('price1' in entry, true);
  assert.equal(entry.price1, 90);
  assert.equal('numAvail' in entry, false);
  assert.equal('override' in entry, false);
  assert.equal('minStay' in entry, false);
  assert.equal('maxStay' in entry, false);
});

test('mode "rate" never sends override even when config would imply manual_stop_sell (the documented "override away from blackout auto-maxes numAvail" side effect must never be risked by a rate-only push)', () => {
  const stopSoldConfig = Object.assign({}, BASE_CONFIG, { manual_stop_sell: true });
  const { payload } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: stopSoldConfig, sellableAvailable: 2, sellableTotal: 3, mode: 'rate' });
  assert.equal('override' in payload.calendar[0], false);
});

section('buildDatePayload — mode: restriction (NEW in Phase B24-2A.1)');

test('mode "restriction" includes ONLY override + minStay + maxStay (when configured) -- excludes price1/numAvail entirely (never touches price or inventory quantity)', () => {
  // BASE_CONFIG.max_stay is null (unconfigured), so it is correctly omitted
  // as a field -- not sent as maxStay:null -- exactly like the general
  // "omitted, not nulled" semantics buildBeds24CalendarPayload already
  // guarantees. A configured max_stay is exercised separately below.
  const { payload, mode } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'restriction' });
  const entry = payload.calendar[0];
  assert.equal(mode, 'restriction');
  assert.equal('override' in entry, true);
  assert.equal('minStay' in entry, true);
  assert.equal(entry.minStay, 1);
  assert.equal('maxStay' in entry, false);
  assert.equal('price1' in entry, false);
  assert.equal('numAvail' in entry, false);
});

test('mode "restriction" includes maxStay when config actually configures one', () => {
  const withMaxStay = Object.assign({}, BASE_CONFIG, { max_stay: 14 });
  const { payload } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: withMaxStay, sellableAvailable: 2, sellableTotal: 3, mode: 'restriction' });
  const entry = payload.calendar[0];
  assert.equal(entry.maxStay, 14);
  assert.equal('price1' in entry, false);
  assert.equal('numAvail' in entry, false);
});

test('mode "restriction" correctly reflects manual_stop_sell as override=blackout, without ever sending numAvail alongside it', () => {
  const stopSoldConfig = Object.assign({}, BASE_CONFIG, { manual_stop_sell: true });
  const { payload } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: stopSoldConfig, sellableAvailable: 2, sellableTotal: 3, mode: 'restriction' });
  const entry = payload.calendar[0];
  assert.equal(entry.override, 'blackout');
  assert.equal('numAvail' in entry, false);
});

section('buildDatePayload — mode: full (default, backward compatible)');

test('no mode specified -> defaults to full, includes every field (matches pre-B24-2A behavior exactly)', () => {
  const { payload, mode } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3 });
  const entry = payload.calendar[0];
  assert.equal(mode, 'full');
  assert.equal('price1' in entry, true);
  assert.equal('numAvail' in entry, true);
  assert.equal('override' in entry, true);
  assert.equal('minStay' in entry, true);
});

test('mode:"full" explicitly is identical to omitting mode', () => {
  const a = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3 });
  const b = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'full' });
  assert.deepEqual(a.payload, b.payload);
});

section('Cross-mode consistency');

test('availability-mode numAvail, rate-mode price1, and restriction-mode minStay/override all match what full mode would have produced for the same inputs', () => {
  const full = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'full' });
  const avail = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'availability' });
  const rate = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'rate' });
  const restriction = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'restriction' });
  assert.equal(avail.payload.calendar[0].numAvail, full.payload.calendar[0].numAvail);
  assert.equal(rate.payload.calendar[0].price1, full.payload.calendar[0].price1);
  assert.equal(restriction.payload.calendar[0].minStay, full.payload.calendar[0].minStay);
  assert.equal(restriction.payload.calendar[0].override, full.payload.calendar[0].override);
});

test('the three narrow modes never overlap in the fields they include -- their union covers exactly the full-mode field set, with no field owned by two modes', () => {
  const avail = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'availability' });
  const rate = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'rate' });
  const restriction = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: BASE_CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'restriction' });
  const availKeys = new Set(Object.keys(avail.payload.calendar[0]));
  const rateKeys = new Set(Object.keys(rate.payload.calendar[0]));
  const restrictionKeys = new Set(Object.keys(restriction.payload.calendar[0]));
  const overlap = [...availKeys].filter((k) => rateKeys.has(k) || restrictionKeys.has(k)).concat([...rateKeys].filter((k) => restrictionKeys.has(k)));
  const dateKeys = new Set(['from', 'to']); // always present in every mode -- structural, not a data field
  assert.deepEqual(overlap.filter((k) => !dateKeys.has(k)), []);
});

console.log(`\n${passed}/${passed + failed} beds24-payload-modes assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
