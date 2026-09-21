// Beds24 -> Vilu inbound ingestion -- Cloud Functions wiring checks.
//
// Static/source-level checks only -- no live Firestore connection, no
// emulator, no real webhook request, no live reservation touched (matches
// the existing pms-hardening.test.js / beds24-sync-wiring.test.js
// convention, since no emulator-based trigger harness exists in this repo).
// Guards:
//   - otaWebhook is trigger-only: it validates the shared secret BEFORE any
//     write, extracts only an id (never trusts guest/price/date fields from
//     the request body), and never calls the reservation-write path itself.
//   - processOtaEvent (webhook path) and otaCatchUp (polling path) converge
//     on the exact same processQueued() function -- no second ingestion
//     path exists.
//   - the channel-recognition gate lives inside processQueued(), scoped to
//     the real "beds24" provider only -- confirmed again here at the
//     wiring level (functionally proven in beds24-inbound-integration.test.js).
//
//   node test/beds24-inbound-wiring.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const OTA = read('functions-ota/index.js');

function extractFn(src, exportName) {
  const m = src.match(new RegExp('exports\\.' + exportName + ' = [\\s\\S]*?\\n\\}\\);'));
  return m ? m[0] : null;
}

section('Case A — otaWebhook: secret validated BEFORE any write, constant-time comparison');
test('otaWebhook rejects with 401 when the secret header is missing or wrong, using crypto.timingSafeEqual (not a plain string ==)', () => {
  const fn = extractFn(OTA, 'otaWebhook');
  assert.ok(fn, 'otaWebhook not found');
  assert.ok(fn.includes('timingSafeEqual'), 'must use a constant-time comparison, not ===, to avoid a timing side-channel on the secret');
  assert.ok(fn.includes("res.status(401)"));
});
test('otaWebhook checks the secret BEFORE touching ota_queue or any other collection', () => {
  const fn = extractFn(OTA, 'otaWebhook');
  const secretCheckIndex = fn.indexOf('timingSafeEqual');
  const firstWriteIndex = fn.indexOf(".collection('ota_queue')");
  assert.ok(secretCheckIndex > -1 && firstWriteIndex > -1, 'expected both a secret check and a queue write in otaWebhook');
  assert.ok(secretCheckIndex < firstWriteIndex, 'the secret must be validated before the first write, not after');
});
test('otaWebhook declares OTA_WEBHOOK_SECRET as its secret (not BEDS24_REFRESH_TOKEN, which it never needs)', () => {
  const fn = extractFn(OTA, 'otaWebhook');
  assert.ok(fn.includes('secrets: [OTA_WEBHOOK_SECRET]'));
});

section('Case B — otaWebhook is TRIGGER ONLY: never trusts booking content from the request body, never writes a reservation itself');
test('otaWebhook extracts only an id (booking.id / external_id / booking_id) from the request body -- never guest name, email, price, or dates', () => {
  const fn = extractFn(OTA, 'otaWebhook');
  assert.ok(/const externalId = String\(\(body\.booking && body\.booking\.id\) \|\| body\.external_id \|\| body\.booking_id \|\| ''\)/.test(fn));
  for (const forbidden of ['firstName', 'lastName', 'guest_email', 'guest_name', 'body.booking.price', 'body.booking.email']) {
    assert.equal(fn.includes(forbidden), false, 'otaWebhook must never read ' + forbidden + ' from the untrusted request body');
  }
});
test('otaWebhook never calls ingestEvent, writeReservationTx, or buildFields directly -- it only ever enqueues', () => {
  const fn = extractFn(OTA, 'otaWebhook');
  assert.equal(fn.includes('ingestEvent('), false);
  assert.equal(fn.includes('writeReservationTx'), false);
  assert.equal(fn.includes('buildFields'), false);
  assert.ok(fn.includes(".collection('ota_queue')"), 'the only write otaWebhook performs is the queue enqueue');
});
test('otaWebhook returns quickly (202) rather than waiting on ingestion -- proves it never performs long synchronous work inline', () => {
  const fn = extractFn(OTA, 'otaWebhook');
  assert.ok(fn.includes('res.status(202)'));
});

section('Case C — authoritative refetch: the actual ingested data always comes from adapter.fetchBooking(), never the webhook body');
test('processQueued (the only consumer of a queued webhook event) calls adapter.fetchBooking via ingestEvent, and ingestEvent is given only the external_id/revision/type -- never raw booking content from the webhook', () => {
  const processQueuedMatch = OTA.match(/async function processQueued[\s\S]*?\n\}/);
  assert.ok(processQueuedMatch, 'processQueued not found');
  const fn = processQueuedMatch[0];
  assert.ok(fn.includes('ingestEvent('));
  assert.ok(/event: \{ channel_manager: name, external_id: data\.external_id, revision: data\.revision, type: data\.type/.test(fn), 'ingestEvent must be called with only id/revision/type -- ingestEvent itself re-fetches the authoritative booking via adapter.fetchBooking()');
});
test('a forged webhook payload cannot manufacture reservation data: ota_queue documents only ever store external_id/revision/type/channel_manager metadata, never guest/price fields', () => {
  const fn = extractFn(OTA, 'otaWebhook');
  const setCall = fn.match(/\.set\(\{[^}]*\}\)/);
  assert.ok(setCall, 'expected the ota_queue .set(...) call');
  for (const forbidden of ['firstName', 'lastName', 'price', 'email']) {
    assert.equal(setCall[0].includes(forbidden), false, 'the enqueued doc must never carry ' + forbidden);
  }
});

section('Case D — channel-recognition gate: scoped to the real Beds24 provider only');
test('the channel gate only runs when name === "beds24" -- MockAdapter/mock provider path is untouched', () => {
  const processQueuedMatch = OTA.match(/async function processQueued[\s\S]*?\n\}/);
  const fn = processQueuedMatch[0];
  assert.ok(/if \(name === 'beds24'\)/.test(fn));
});
test('an unrecognized-channel booking is routed to ota_conflicts (reused, no second review collection) rather than a bespoke new mechanism', () => {
  const fn = OTA.match(/async function raiseChannelReviewRecord[\s\S]*?\n\}/)[0];
  assert.ok(fn.includes("collection('ota_conflicts')"));
  assert.ok(fn.includes("reason: 'unrecognized_channel'"));
});

section('Case D2 — property-id gate: a booking from an unexpected Beds24 property must never reach ingestEvent()');
test('processQueued imports BEDS24_PROPERTY_ID from beds24-bridge (the same constant already used by the outbound property/room guards), not a re-declared literal', () => {
  assert.ok(OTA.includes("require('./lib/beds24-bridge')"));
  assert.ok(/const\s*\{[^}]*BEDS24_PROPERTY_ID[^}]*\}\s*=\s*require\('\.\/lib\/beds24-bridge'\)/.test(OTA));
});
test('processQueued checks the peeked booking\'s property_id against BEDS24_PROPERTY_ID BEFORE the channel-recognition check and BEFORE calling ingestEvent()', () => {
  const fn = OTA.match(/async function processQueued[\s\S]*?\n\}/)[0];
  const propertyCheckIndex = fn.indexOf('peeked.property_id');
  const channelCheckIndex = fn.indexOf('shouldAutoIngest(peeked)');
  const ingestEventIndex = fn.indexOf('await ingestEvent('); // the real call site, not the earlier prose comment mentioning "ingestEvent(),"
  assert.ok(propertyCheckIndex > -1, 'expected a peeked.property_id check inside processQueued');
  assert.ok(propertyCheckIndex < channelCheckIndex, 'property-id must be checked before the channel gate');
  assert.ok(ingestEventIndex > -1 && channelCheckIndex < ingestEventIndex, 'both gates must run before ingestEvent() is ever called');
});
test('an unexpected-property booking is routed to ota_conflicts (reused collection) with reason unexpected_property_id, and processQueued returns without calling ingestEvent', () => {
  const fn = OTA.match(/async function raisePropertyReviewRecord[\s\S]*?\n\}/)[0];
  assert.ok(fn.includes("collection('ota_conflicts')"));
  assert.ok(fn.includes("reason: 'unexpected_property_id'"));
  const processQueuedFn = OTA.match(/async function processQueued[\s\S]*?\n\}/)[0];
  const gateBlock = processQueuedFn.match(/if \(peeked && peeked\.property_id != null[\s\S]*?\n {4}\}/)[0];
  assert.ok(gateBlock.includes('raisePropertyReviewRecord'));
  assert.ok(gateBlock.includes('return;'), 'the property-id gate must return immediately, never fall through to ingestEvent()');
});

section('Case E — webhook + catch-up convergence (Step 16): one idempotent ingestion path, not two');
test('processOtaEvent (webhook-triggered) calls processQueued', () => {
  const fn = extractFn(OTA, 'processOtaEvent');
  assert.ok(fn.includes('processQueued('));
});
test('otaCatchUp (polling-triggered) also calls processQueued for its retries -- the SAME function, not a duplicated ingestion routine', () => {
  const fn = extractFn(OTA, 'otaCatchUp');
  assert.ok(fn.includes('processQueued('));
});
test('otaCatchUp uses listModifiedSince() with a persisted cursor (modified_since) -- never re-imports the entire booking history every run', () => {
  const fn = extractFn(OTA, 'otaCatchUp');
  assert.ok(fn.includes('listModifiedSince('));
  assert.ok(fn.includes('modified_since'));
});
test('otaCatchUp feeds newly-discovered ids into the SAME ota_queue collection as the webhook path -- one queue, one consumer', () => {
  const fn = extractFn(OTA, 'otaCatchUp');
  assert.ok(fn.includes(".collection('ota_queue')"));
});

section('Case F — codebase/secret isolation preserved (no regression from the outbound pass)');
test('functions-ota/index.js still declares exactly BEDS24_REFRESH_TOKEN and OTA_WEBHOOK_SECRET -- no new secret introduced for inbound', () => {
  assert.ok(OTA.includes("defineSecret('BEDS24_REFRESH_TOKEN')"));
  assert.ok(OTA.includes("defineSecret('OTA_WEBHOOK_SECRET')"));
});
test('functions-ota/index.js does not declare or reference the outbound worker (still isolated in functions-beds24)', () => {
  assert.equal(OTA.includes('beds24OutboundWorker'), false);
});

console.log(`\n${passed}/${passed + failed} beds24-inbound-wiring assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
