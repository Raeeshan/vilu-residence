// Phase B24-2A, Section G — property/room safety guards. Fail-closed on any
// unknown Beds24 property id, unknown Beds24 room id, or unknown Vilu PMS
// room id -- never silently proceeds or defaults to "allow".
// Pure unit tests, no network.
//   node test/beds24-property-room-guards.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { assertKnownBeds24Property, assertKnownBeds24RoomId, assertKnownPmsRoom, BEDS24_PROPERTY_ID } = F('beds24-bridge');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

section('assertKnownBeds24Property');

test('the real property id (352964) passes and returns it as a number', () => {
  assert.equal(assertKnownBeds24Property(352964), 352964);
  assert.equal(assertKnownBeds24Property(BEDS24_PROPERTY_ID), BEDS24_PROPERTY_ID);
});
test('the real property id as a string also passes (coerced to number)', () => {
  assert.equal(assertKnownBeds24Property('352964'), 352964);
});
test('a different property id throws -- FAIL CLOSED, never silently accepted', () => {
  assert.throws(() => assertKnownBeds24Property(999999), /unexpected Beds24 property id/);
});
test('null/undefined/non-numeric property id throws', () => {
  assert.throws(() => assertKnownBeds24Property(null));
  assert.throws(() => assertKnownBeds24Property(undefined));
  assert.throws(() => assertKnownBeds24Property('not-a-number'));
});

section('assertKnownBeds24RoomId');

test('each of the 3 known Beds24 room ids passes and returns its room-type code', () => {
  assert.equal(assertKnownBeds24RoomId(727992), 'DELUXE_FAMILY');
  assert.equal(assertKnownBeds24RoomId(728133), 'DOUBLE');
  assert.equal(assertKnownBeds24RoomId(728134), 'DELUXE_FAMILY_OPEN_DECK');
});
test('a string form of a known id also passes (coerced to number)', () => {
  assert.equal(assertKnownBeds24RoomId('728133'), 'DOUBLE');
});
test('an unknown Beds24 room id throws -- FAIL CLOSED', () => {
  assert.throws(() => assertKnownBeds24RoomId(999999), /unknown Beds24 room id/);
});
test('null/undefined room id throws', () => {
  assert.throws(() => assertKnownBeds24RoomId(null));
  assert.throws(() => assertKnownBeds24RoomId(undefined));
});

section('assertKnownPmsRoom');

test('each of the 6 known Vilu PMS rooms passes and returns its Beds24 room-type code', () => {
  assert.equal(assertKnownPmsRoom('VR01'), 'DELUXE_FAMILY');
  assert.equal(assertKnownPmsRoom('VR02'), 'DELUXE_FAMILY');
  assert.equal(assertKnownPmsRoom('VR03'), 'DOUBLE');
  assert.equal(assertKnownPmsRoom('VR04'), 'DOUBLE');
  assert.equal(assertKnownPmsRoom('VR05'), 'DOUBLE');
  assert.equal(assertKnownPmsRoom('VR06'), 'DELUXE_FAMILY_OPEN_DECK');
});
test('an unknown Vilu room id throws -- FAIL CLOSED', () => {
  assert.throws(() => assertKnownPmsRoom('VR07'), /unknown Vilu PMS room id/);
  assert.throws(() => assertKnownPmsRoom('Room 1'), /unknown Vilu PMS room id/); // a Ranfaru/White Sand partner-hotel room, never a Beds24-mapped room
});
test('null/undefined/empty PMS room id throws', () => {
  assert.throws(() => assertKnownPmsRoom(null));
  assert.throws(() => assertKnownPmsRoom(undefined));
  assert.throws(() => assertKnownPmsRoom(''));
});

console.log(`\n${passed}/${passed + failed} beds24-property-room-guards assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
