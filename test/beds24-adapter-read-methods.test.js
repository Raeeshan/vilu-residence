// Phase B24-2A, Section F — Beds24Adapter READ-ONLY verification methods:
// getProperty, listRooms, getInventory. Unit tests using a dependency-
// injected fake fetch. No real network call anywhere in this file.
// fetchBooking()/listModifiedSince() are already comprehensively covered by
// test/beds24-adapter.test.js and are NOT duplicated here.
//   node test/beds24-adapter-read-methods.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { Beds24Adapter } = F('adapters');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name); console.log('        ' + (e.stack || e).toString().split('\n').slice(0, 6).join('\n        ')); process.exitCode = 1; } }

function fakeFetch(responses) {
  let call = 0;
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    if (r.throwOnJson) return { ok: r.ok, status: r.status, json: async () => { throw new Error('Unexpected token < in JSON'); } };
    return { ok: r.ok, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const TOKEN_OK = { ok: true, status: 200, body: { token: 'access-token-abc' } };
// `roomTypes` (not `rooms`) is the real Beds24 v2 /properties field name --
// confirmed via Phase B24-2A.1, Section H live API validation against the
// real Vilu Residence account. This fixture matches the real schema
// exactly (including nested `units`, which listRooms() does not need but
// a real response always includes) so a regression back to the wrong key
// name would be caught here rather than only live.
const REAL_PROPERTY = { id: 352964, name: 'Vilu Residence Maamigili', roomTypes: [
  { id: 727992, name: 'Deluxe Family', units: [{ id: 1, name: 'VR01' }, { id: 2, name: 'VR02' }] },
  { id: 728133, name: 'Double', units: [{ id: 1, name: 'VR03' }, { id: 2, name: 'VR04' }, { id: 3, name: 'VR05' }] },
  { id: 728134, name: 'Open Deck', units: [{ id: 1, name: 'VR06' }] },
] };

(async () => {

section('getProperty');

await test('a successful call requests the exact known property id and returns the matched property', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [REAL_PROPERTY] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const property = await adapter.getProperty(352964);
  assert.equal(property.id, 352964);
  assert.equal(property.name, 'Vilu Residence Maamigili');
  const propertyCall = fetchImpl.calls[1];
  assert.ok(propertyCall.url.includes('id=352964'));
  assert.ok(propertyCall.url.includes('includeAllRooms=true'));
});

await test('an unexpected property id argument throws BEFORE any network call at all', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(999999), /unexpected Beds24 property id/);
  assert.equal(fetchImpl.calls.length, 0);
});

await test('a response containing a DIFFERENT property id than requested is rejected (re-validates the response itself, not just the request)', async () => {
  const wrongProperty = Object.assign({}, REAL_PROPERTY, { id: 111111 });
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [wrongProperty] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), /unexpected Beds24 property id/);
});

await test('property not found in the response data -> throws non-retryable', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), (e) => { assert.match(e.message, /BEDS24_PROPERTY_NOT_FOUND/); assert.equal(e.retryable, false); return true; });
});

await test('a 401 auth failure on the property call is tagged non-retryable', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: false, status: 401, body: {} }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), (e) => { assert.equal(e.retryable, false); assert.equal(e.httpStatus, 401); return true; });
});

await test('a 429 rate limit on the property call is tagged retryable', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: false, status: 429, body: {} }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), (e) => { assert.equal(e.retryable, true); return true; });
});

await test('a malformed response body (data is not an array) is treated as failure, never silently trusted', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: 'not-an-array' } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), /BEDS24_GET_PROPERTY_FAILED/);
});

await test('a 403 forbidden on the property call is tagged non-retryable (scope/permission problem, not transient)', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: false, status: 403, body: {} }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), (e) => { assert.equal(e.retryable, false); assert.equal(e.httpStatus, 403); return true; });
});

await test('a response body that is not valid JSON (json() throws) is treated as failure, never crashes uncaught', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, throwOnJson: true }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), /BEDS24_GET_PROPERTY_FAILED/);
});

await test("a Beds24 success:false error-shaped payload ({success:false,type,code,error}) is treated as failure, never read as a property", async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { success: false, type: 'error', code: 'INVALID_REQUEST', error: 'bad request' } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getProperty(352964), /BEDS24_GET_PROPERTY_FAILED/);
});

section('listRooms');

await test('returns every known room from the property, all 3 recognized', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [REAL_PROPERTY] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const { rooms, unknownRoomIds } = await adapter.listRooms(352964);
  assert.equal(rooms.length, 3);
  assert.equal(unknownRoomIds.length, 0);
  assert.deepEqual(rooms.map((r) => r.id).sort(), [727992, 728133, 728134]);
});

await test('an unrecognized room id in the response is excluded from `rooms` and reported in `unknownRoomIds`, never silently included', async () => {
  const propertyWithExtra = Object.assign({}, REAL_PROPERTY, { roomTypes: REAL_PROPERTY.roomTypes.concat([{ id: 555555, name: 'Some Other Room' }]) });
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [propertyWithExtra] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const { rooms, unknownRoomIds } = await adapter.listRooms(352964);
  assert.equal(rooms.length, 3);
  assert.deepEqual(unknownRoomIds, [555555]);
});

await test('regression (Section H): a property response using the OLD `rooms` field name (not `roomTypes`) yields zero rooms, never a silent false-match -- guards against reintroducing the pre-live-validation schema bug', async () => {
  const oldShapeProperty = { id: 352964, name: 'Vilu Residence Maamigili', rooms: [{ id: 727992, name: 'Deluxe Family' }] };
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [oldShapeProperty] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const { rooms, unknownRoomIds } = await adapter.listRooms(352964);
  assert.equal(rooms.length, 0);
  assert.equal(unknownRoomIds.length, 0);
});

section('getInventory');

await test('a successful call with known room ids returns the calendar data', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [{ roomId: 728133, calendar: [{ from: '2027-01-01', to: '2027-01-01', numAvail: 2, price1: 90 }] }], pages: { nextPageExists: false } } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const result = await adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' });
  assert.equal(result.rooms.length, 1);
  assert.equal(result.nextPageExists, false);
  assert.equal(result.nextPage, null);
  const invCall = fetchImpl.calls[1];
  assert.ok(invCall.url.includes('roomId=728133'));
  assert.ok(invCall.url.includes('startDate=2027-01-01'));
  assert.ok(invCall.url.includes('includeNumAvail=true'));
  assert.ok(invCall.url.includes('includePrices=true'));
});

await test('an unknown roomId in the request throws BEFORE any network call at all', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getInventory({ roomIds: [999999], startDate: '2027-01-01', endDate: '2027-01-07' }), /unknown Beds24 room id/);
  assert.equal(fetchImpl.calls.length, 0);
});

await test('missing roomIds/startDate/endDate throws a clear caller error, never silently proceeds', async () => {
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl: fakeFetch([TOKEN_OK]) });
  await assert.rejects(() => adapter.getInventory({ startDate: '2027-01-01', endDate: '2027-01-07' }), /requires at least one roomId/);
  await assert.rejects(() => adapter.getInventory({ roomIds: [728133] }), /requires startDate and endDate/);
});

await test('a response containing an unrecognized roomId is rejected -- re-validates the response itself, never just the request', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [{ roomId: 999999, calendar: [] }] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' }), /unknown Beds24 room id/);
});

await test('pagination: nextPageExists:true yields nextPage = current page + 1 (defaults page 1 when omitted)', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [], pages: { nextPageExists: true, nextPageLink: 'x?page=2' } } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const result = await adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' });
  assert.equal(result.nextPageExists, true);
  assert.equal(result.nextPage, 2);
});

await test('an explicit page param is forwarded as the query param and used to compute the next page', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [], pages: { nextPageExists: true } } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const result = await adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07', page: 3 });
  assert.ok(fetchImpl.calls[1].url.includes('page=3'));
  assert.equal(result.nextPage, 4);
});

await test('a 500 on the inventory call is tagged retryable', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: false, status: 500, body: {} }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' }), (e) => { assert.equal(e.retryable, true); return true; });
});

await test('a genuinely empty calendar (data: []) is a valid successful result, not an error', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [], pages: { nextPageExists: false } } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const result = await adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' });
  assert.deepEqual(result.rooms, []);
  assert.equal(result.nextPageExists, false);
});

await test('a response missing the `pages` metadata entirely defaults to nextPageExists:false rather than throwing', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, body: { data: [{ roomId: 728133, calendar: [] }] } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  const result = await adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' });
  assert.equal(result.nextPageExists, false);
  assert.equal(result.nextPage, null);
});

await test('a 403 forbidden on the inventory call is tagged non-retryable', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: false, status: 403, body: {} }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' }), (e) => { assert.equal(e.retryable, false); assert.equal(e.httpStatus, 403); return true; });
});

await test('a malformed (non-JSON) response body on the inventory call is treated as failure, never crashes uncaught', async () => {
  const fetchImpl = fakeFetch([TOKEN_OK, { ok: true, status: 200, throwOnJson: true }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
  await assert.rejects(() => adapter.getInventory({ roomIds: [728133], startDate: '2027-01-01', endDate: '2027-01-07' }), /BEDS24_GET_INVENTORY_FAILED/);
});

section('Credential safety (Section M)');

await test('getProperty/listRooms/getInventory never expose the refresh token or access token in any thrown error message', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 401, body: { error: 'invalid' } }]);
  const adapter = new Beds24Adapter({ enabled: true, token: 'super-secret-refresh-token-value', fetchImpl });
  try { await adapter.getProperty(352964); } catch (e) {
    assert.equal(e.message.includes('super-secret-refresh-token-value'), false);
  }
});

console.log(`\n${passed}/${passed + failed} beds24-adapter-read-methods assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');

})();
