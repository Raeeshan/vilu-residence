// Beds24Adapter (server-side outbound API client) -- unit tests using a
// dependency-injected fake fetch. No real network call anywhere in this
// file; MockAdapter's own existing behavior is untouched and re-verified by
// test/ota-core.test.js separately.
//   node test/beds24-adapter.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { Beds24Adapter } = F('adapters');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); } }

function fakeFetch(responses) {
  let call = 0;
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

(async () => {
  await test('Beds24Adapter._guard: refuses any call when not enabled/no token, without ever calling fetch', async () => {
    const fetchImpl = fakeFetch([{ ok: true, status: 200, body: { token: 'x', refreshToken: 'y' } }]);
    const adapter = new Beds24Adapter({ enabled: false, token: null, fetchImpl });
    await assert.rejects(() => adapter.pushAvailability([]), /BEDS24_NOT_CONFIGURED/);
    assert.strictEqual(fetchImpl.calls.length, 0);
  });

  await test('_getAccessToken: a successful refresh returns the access token', async () => {
    const fetchImpl = fakeFetch([{ ok: true, status: 200, body: { token: 'real-access-token', expiresIn: 86400 } }]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-token-value', fetchImpl });
    const token = await adapter._getAccessToken();
    assert.strictEqual(token, 'real-access-token');
    assert.strictEqual(fetchImpl.calls[0].opts.headers.refreshToken, 'refresh-token-value');
  });

  await test('_getAccessToken: a 401 (invalid refresh credential) is tagged non-retryable', async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 401, body: { error: 'invalid' } }]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'bad-token', fetchImpl });
    await assert.rejects(() => adapter._getAccessToken(), (e) => { assert.strictEqual(e.retryable, false); assert.strictEqual(e.httpStatus, 401); return true; });
  });

  await test('_getAccessToken: a 429 is tagged retryable', async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 429, body: {} }]);
    const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
    await assert.rejects(() => adapter._getAccessToken(), (e) => { assert.strictEqual(e.retryable, true); return true; });
  });

  await test('_getAccessToken: a 500 is tagged retryable', async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 500, body: {} }]);
    const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
    await assert.rejects(() => adapter._getAccessToken(), (e) => { assert.strictEqual(e.retryable, true); return true; });
  });

  await test('pushAvailability: rejects an unknown roomId BEFORE any network call at all', async () => {
    const fetchImpl = fakeFetch([{ ok: true, status: 200, body: { token: 'x' } }]);
    const adapter = new Beds24Adapter({ enabled: true, token: 't', fetchImpl });
    const allowedRoomIds = new Set([727992, 728133, 728134]);
    await assert.rejects(
      () => adapter.pushAvailability([{ roomId: 999999, calendar: [] }], { allowedRoomIds }),
      (e) => { assert.strictEqual(e.retryable, false); assert.ok(e.message.includes('999999')); return true; }
    );
    assert.strictEqual(fetchImpl.calls.length, 0, 'no network call for a rejected room id');
  });

  await test('pushAvailability: a valid roomId proceeds -- refreshes token then POSTs the exact payload', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 201, body: [{ success: true, modified: { roomId: 728133 } }] },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    const payload = [{ roomId: 728133, calendar: [{ from: '2026-11-15', to: '2026-11-15', numAvail: 2 }] }];
    const result = await adapter.pushAvailability(payload, { allowedRoomIds: new Set([728133]) });
    assert.strictEqual(result.httpStatus, 201);
    assert.strictEqual(fetchImpl.calls.length, 2);
    assert.strictEqual(fetchImpl.calls[1].opts.headers.token, 'access-1');
    assert.deepStrictEqual(JSON.parse(fetchImpl.calls[1].opts.body), payload);
  });

  await test('pushAvailability: HTTP ok but Beds24 body reports success:false is NOT treated as success', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: [{ success: false, error: 'invalid date range' }] },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await assert.rejects(() => adapter.pushAvailability([{ roomId: 727992, calendar: [] }]), /BEDS24_PUSH_NOT_CONFIRMED/);
  });

  await test('pushAvailability: a malformed/non-array response body is NOT treated as success even with HTTP 200', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { unexpected: 'shape' } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await assert.rejects(() => adapter.pushAvailability([{ roomId: 727992, calendar: [] }]), /BEDS24_PUSH_NOT_CONFIRMED/);
  });

  await test('pushAvailability: a network-level 503 during the POST is tagged retryable', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: false, status: 503, body: {} },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await assert.rejects(() => adapter.pushAvailability([{ roomId: 727992, calendar: [] }]), (e) => { assert.strictEqual(e.retryable, true); return true; });
  });

  await test('pushAvailability: a 403 permission error during the POST is tagged non-retryable', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: false, status: 403, body: {} },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await assert.rejects(() => adapter.pushAvailability([{ roomId: 727992, calendar: [] }]), (e) => { assert.strictEqual(e.retryable, false); return true; });
  });

  await test('pushAvailability: never exposes the refresh token or access token in any thrown error', async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 401, body: {} }]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'SUPER-SECRET-REFRESH-VALUE', fetchImpl });
    try {
      await adapter.pushAvailability([{ roomId: 727992, calendar: [] }]);
      assert.fail('expected rejection');
    } catch (e) {
      assert.strictEqual((e.message || '').includes('SUPER-SECRET-REFRESH-VALUE'), false);
      assert.strictEqual(JSON.stringify(e).includes('SUPER-SECRET-REFRESH-VALUE'), false);
    }
  });

  // --- fetchBooking (inbound continuous-sync pass) ------------------------
  await test('fetchBooking: a successful GET returns the normalized canonical booking, keyed correctly by id', async () => {
    const rawBookingObj = { id: 4001, roomId: 728133, status: 'confirmed', channel: 'booking', arrival: '2026-12-01', departure: '2026-12-03', numAdult: 2, firstName: 'A', lastName: 'B', email: 'a@b.com', price: 100, invoiceItems: [] };
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { data: [rawBookingObj] } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    const booking = await adapter.fetchBooking('4001');
    assert.strictEqual(booking.external_id, '4001');
    assert.strictEqual(booking.channel, 'Booking.com');
    assert.strictEqual(booking.units[0].room_type, 'Double Room');
  });
  await test('fetchBooking: requests includeInvoiceItems and includeGuests so financial and PII data come back authoritatively', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { data: [] } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await adapter.fetchBooking('4002');
    const url = fetchImpl.calls[1].url;
    assert.ok(url.includes('includeInvoiceItems=true'));
    assert.ok(url.includes('includeGuests=true'));
    assert.ok(url.includes('id=4002'));
  });
  await test('fetchBooking: Beds24 has no such booking -> returns null (matches ingestEvent\'s "not_found" contract, never throws)', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { data: [] } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    const booking = await adapter.fetchBooking('999999');
    assert.strictEqual(booking, null);
  });
  await test('fetchBooking: a 429 during the GET is tagged retryable', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: false, status: 429, body: {} },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await assert.rejects(() => adapter.fetchBooking('4003'), (e) => { assert.strictEqual(e.retryable, true); return true; });
  });
  await test('fetchBooking: a 401 during the GET is tagged non-retryable', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: false, status: 401, body: {} },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await assert.rejects(() => adapter.fetchBooking('4004'), (e) => { assert.strictEqual(e.retryable, false); return true; });
  });
  await test('fetchBooking: per-invocation cache -- a second fetchBooking() call for the same id never hits the network again', async () => {
    const rawBookingObj = { id: 4005, roomId: 727992, status: 'confirmed', channel: 'agoda', arrival: '2026-12-01', departure: '2026-12-03', invoiceItems: [] };
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { data: [rawBookingObj] } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    const first = await adapter.fetchBooking('4005');
    const callCountAfterFirst = fetchImpl.calls.length;
    const second = await adapter.fetchBooking('4005');
    assert.strictEqual(fetchImpl.calls.length, callCountAfterFirst, 'no new network calls for the cached id');
    assert.deepStrictEqual(second, first);
  });
  await test('fetchBooking: a different id is never served from another id\'s cache entry', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { data: [{ id: 4006, roomId: 728133, status: 'confirmed', channel: 'booking', arrival: '2026-12-01', departure: '2026-12-03', invoiceItems: [] }] } },
      { ok: true, status: 200, body: { token: 'access-2' } },
      { ok: true, status: 200, body: { data: [{ id: 4007, roomId: 728134, status: 'confirmed', channel: 'expedia', arrival: '2026-12-05', departure: '2026-12-07', invoiceItems: [] }] } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    const a = await adapter.fetchBooking('4006');
    const b = await adapter.fetchBooking('4007');
    assert.notStrictEqual(a.external_id, b.external_id);
    assert.strictEqual(fetchImpl.calls.length, 4, 'two distinct ids each cost their own network round trip');
  });

  // --- listModifiedSince (catch-up/reconciliation) -------------------------
  await test('listModifiedSince: requests modifiedFrom plus every booking status including cancelled (default GET /bookings omits cancelled)', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { data: [] } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await adapter.listModifiedSince('2026-11-01T00:00:00');
    const url = fetchImpl.calls[1].url;
    assert.ok(url.includes('modifiedFrom=2026-11-01T00%3A00%3A00') || url.includes('modifiedFrom=2026-11-01'));
    for (const s of ['confirmed', 'request', 'new', 'cancelled', 'black', 'inquiry']) {
      assert.ok(url.includes('status=' + s), 'missing status=' + s + ' in ' + url);
    }
  });
  await test('listModifiedSince: returns the external ids of every modified booking', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: true, status: 200, body: { data: [{ id: 5001 }, { id: 5002 }] } },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    const ids = await adapter.listModifiedSince('2026-11-01T00:00:00');
    assert.deepStrictEqual(ids, ['5001', '5002']);
  });
  await test('listModifiedSince: a 500 is tagged retryable', async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, body: { token: 'access-1' } },
      { ok: false, status: 500, body: {} },
    ]);
    const adapter = new Beds24Adapter({ enabled: true, token: 'refresh-1', fetchImpl });
    await assert.rejects(() => adapter.listModifiedSince('2026-11-01T00:00:00'), (e) => { assert.strictEqual(e.retryable, true); return true; });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
