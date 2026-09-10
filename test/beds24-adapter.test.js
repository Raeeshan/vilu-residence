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

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
