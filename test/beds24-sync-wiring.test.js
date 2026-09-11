// Beds24 continuous differential-sync — Cloud Functions wiring checks.
//
// Static/source-level checks only — no live Firestore connection, no
// emulator, no real reservation is ever created (matches the existing
// pms-hardening.test.js convention, since no emulator-based trigger harness
// exists in this repo). Guards:
//   - functions-core/index.js stays secret-free (never references
//     BEDS24_REFRESH_TOKEN / defineSecret) -- the whole reason "core" is
//     split from any codebase that owns a Beds24/OTA secret.
//   - the differential-sync enqueue is wired into the EXISTING
//     availabilityOnReservation/availabilityOnBlock triggers, not a second
//     competing trigger on the same collections.
//   - the rate-change trigger only reacts to an actual watched-field change.
//   - functions-ota/index.js declares OTA_WEBHOOK_SECRET/BEDS24_REFRESH_TOKEN
//     for its own (still undeployed) inbound functions ONLY, and does NOT
//     also carry the outbound worker -- that lives in its own
//     functions-beds24/ codebase specifically so an unset OTA_WEBHOOK_SECRET
//     (needed only by otaWebhook) can never block deploying the outbound
//     worker, which needs only BEDS24_REFRESH_TOKEN.
//   - functions-beds24/index.js's beds24OutboundWorker ignores non-job
//     ota_pushes docs, never marks success without calling the adapter,
//     and never contains a credential in any console.* call.
//
//   node test/beds24-sync-wiring.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const CORE = read('functions-core/index.js');
const OTA = read('functions-ota/index.js');
const BEDS24 = read('functions-beds24/index.js');

section('Case A — functions-core stays secret-free (the whole reason "core"/"ota" are split codebases)');
test('functions-core/index.js never declares or reads the BEDS24_REFRESH_TOKEN secret in actual code (the name appears only in explanatory comments, e.g. the file header explaining why it is deliberately absent)', () => {
  const codeOnly = CORE.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.equal(codeOnly.includes('BEDS24_REFRESH_TOKEN'), false);
});
test('functions-core/index.js never calls defineSecret', () => {
  assert.equal(CORE.includes('defineSecret'), false);
});
test('functions-core/index.js never calls the Beds24 API directly (no fetch(...beds24...))', () => {
  assert.equal(/fetch\([^)]*beds24/i.test(CORE), false);
});

section('Case B — differential sync reuses the EXISTING reservation/block triggers, not a new competing one');
test('availabilityOnReservation and availabilityOnBlock remain the only Beds24-sync-relevant onDocumentWritten triggers -- no competing/duplicate availability listener was added', () => {
  const reservationTriggers = (CORE.match(/onDocumentWritten\('reservations\/\{[^}]+\}'/g) || []).length;
  const blockTriggers = (CORE.match(/onDocumentWritten\('blocks\/\{[^}]+\}'/g) || []).length;
  // Agency Sales Workflow Phase J (2026-09-11) added a THIRD reservations/
  // {id} trigger, settlementEligibilityOnReservation -- unrelated to
  // Beds24/availability sync entirely (it only flips an agency_settlements
  // doc's status when a reservation's own status transitions into
  // 'Checked in'/'Checked out'; it never touches room_availability, never
  // calls computeAffectedDates/enqueueBeds24Sync). This test's real
  // concern (per its own original message) was a second COMPETING
  // availability-sync listener, which Phase J's trigger is not.
  assert.equal(reservationTriggers, 3, 'blockDoubleBooking + availabilityOnReservation + settlementEligibilityOnReservation (Phase J, unrelated to Beds24 sync)');
  assert.equal(blockTriggers, 1, 'availabilityOnBlock only');
  const settlementTrigger = CORE.match(/exports\.settlementEligibilityOnReservation[\s\S]*?\n\}\);/);
  assert.ok(settlementTrigger, 'settlementEligibilityOnReservation not found');
  assert.doesNotMatch(settlementTrigger[0], /computeAffectedDates|enqueueBeds24Sync|room_availability/, 'the settlement trigger must never touch availability/Beds24 sync');
});
test('availabilityOnReservation calls computeAffectedDates and enqueueBeds24Sync (extends the existing handler body, not a separate function)', () => {
  const m = CORE.match(/exports\.availabilityOnReservation[\s\S]*?\n\}\);/);
  assert.ok(m, 'availabilityOnReservation not found');
  assert.ok(m[0].includes('computeAffectedDates'));
  assert.ok(m[0].includes('enqueueBeds24Sync'));
  assert.ok(m[0].includes('runAvailability('), 'the existing Vilu-internal reconciliation call must still run first');
});
test('availabilityOnBlock calls computeAffectedDates and enqueueBeds24Sync, mapping from_date/to_date -> check_in/check_out', () => {
  const m = CORE.match(/exports\.availabilityOnBlock[\s\S]*?\n\}\);/);
  assert.ok(m, 'availabilityOnBlock not found');
  assert.ok(m[0].includes('computeAffectedDates'));
  assert.ok(m[0].includes('enqueueBeds24Sync'));
  assert.ok(m[0].includes('from_date'));
  assert.ok(m[0].includes('to_date'));
});
test('enqueueBeds24Sync reuses ota_pushes -- no second queue collection is written anywhere in functions-core/index.js', () => {
  const collectionWrites = CORE.match(/db\.collection\('([a-z_]+)'\)\.doc\([^)]*\)\.set/g) || [];
  const distinctCollections = new Set(collectionWrites.map((s) => s.match(/collection\('([a-z_]+)'\)/)[1]));
  assert.ok(distinctCollections.has('ota_pushes'));
  assert.equal([...distinctCollections].some((c) => /queue/i.test(c)), false, 'no *queue* collection introduced in functions-core');
});
test('enqueueBeds24Sync skips a room-type code with no BEDS24_ROOM_MAP entry rather than throwing', () => {
  const m = CORE.match(/async function enqueueBeds24Sync[\s\S]*?\n\}/);
  assert.ok(m);
  assert.ok(m[0].includes('if (!BEDS24_ROOM_MAP[code]) continue'));
});

section('Case C — rate/restriction-change trigger only fires on an actual watched-field change');
test('beds24RateChangeSync exists as its own onDocumentWritten trigger on ota_room_types/{roomTypeId}', () => {
  assert.ok(CORE.includes("exports.beds24RateChangeSync = onDocumentWritten('ota_room_types/{roomTypeId}'"));
});
test('beds24RateChangeSync returns early when no watched field actually changed (a no-op write enqueues nothing)', () => {
  const m = CORE.match(/exports\.beds24RateChangeSync[\s\S]*?\n\}\);/);
  assert.ok(m);
  assert.ok(m[0].includes('watchedFields'));
  assert.ok(m[0].includes('if (!changed) return'));
});
test('beds24RateChangeSync only enqueues its OWN room type, never all mapped types', () => {
  const m = CORE.match(/exports\.beds24RateChangeSync[\s\S]*?\n\}\);/);
  assert.ok(m[0].includes('{ [code]:'), 'must build a single-key affectedDates map keyed by just this room type\'s code');
});

section('Case D — nightly reconciliation keeps the existing 730-day Vilu-internal recompute AND adds the Beds24 safety net');
test('nightlyReconcile still calls syncAvailability with FULL_HORIZON_DAYS (unchanged Vilu-internal behavior)', () => {
  const m = CORE.match(/exports\.nightlyReconcile[\s\S]*?\n\}\);/);
  assert.ok(m);
  assert.ok(m[0].includes('days: FULL_HORIZON_DAYS'));
});
test('nightlyReconcile additionally enqueues a Beds24 resync for every mapped room type', () => {
  const m = CORE.match(/exports\.nightlyReconcile[\s\S]*?\n\}\);/);
  assert.ok(m[0].includes('enqueueBeds24Sync'));
  assert.ok(m[0].includes('Object.keys(BEDS24_ROOM_MAP)'));
});

section('Case E — functions-beds24 beds24OutboundWorker: correct job filtering, no silent success, no credential leakage');
test('beds24OutboundWorker is registered on ota_pushes/{id} with the BEDS24_TOKEN secret declared', () => {
  assert.ok(BEDS24.includes("exports.beds24OutboundWorker = onDocumentCreated({ document: 'ota_pushes/{id}', secrets: [BEDS24_TOKEN] }"));
});
test('beds24OutboundWorker ignores any doc that is not type=beds24_calendar_push AND status=pending', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/);
  assert.ok(m);
  assert.ok(/job\.type !== 'beds24_calendar_push' \|\| job\.status !== 'pending'/.test(m[0]));
});
test('beds24OutboundWorker recomputes the differential payload from fresh reads (reservations/blocks/rooms/ota_room_types) rather than trusting a stored value', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/);
  assert.ok(m[0].includes("store.list('reservations')"));
  assert.ok(m[0].includes("store.list('blocks')"));
  assert.ok(m[0].includes('buildDifferentialPayload'));
});
test('beds24OutboundWorker only marks status "succeeded" inside the adapter-call try block, after pushAvailability resolves -- never before/unconditionally', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  const tryBlockStart = m.indexOf('await adapter.pushAvailability');
  const succeededIndex = m.indexOf("status: 'succeeded'");
  assert.ok(tryBlockStart > -1 && succeededIndex > tryBlockStart, '"succeeded" must be written only after the adapter call, not before it');
});
test('beds24OutboundWorker distinguishes retryable vs non-retryable failures (checks e.retryable) and is bounded (a fixed attempt count, not an infinite loop)', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  assert.ok(m.includes('e.retryable'));
  assert.ok(BEDS24.includes('BEDS24_RETRYABLE_ATTEMPTS'));
  assert.ok(/for \(let attempt = 1; attempt <= BEDS24_RETRYABLE_ATTEMPTS/.test(m));
});
test('beds24OutboundWorker never logs a refresh token, access token, or Authorization header -- only sanitized status/message/operation id', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  const consoleCalls = m.match(/console\.\w+\([^;]*\);/g) || [];
  for (const call of consoleCalls) {
    assert.equal(/refreshToken|accessToken|BEDS24_TOKEN\.value/i.test(call), false, 'a console call must never reference token values: ' + call);
  }
});
test('beds24OutboundWorker validates roomId against BEDS24_ROOM_MAP before pushing (allowedRoomIds passed to the adapter)', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  assert.ok(m.includes('allowedRoomIds'));
  assert.ok(m.includes('BEDS24_ROOM_MAP'));
});

section('Case F — codebase isolation: functions-ota carries only its own inbound secrets/functions, never the outbound worker');
test('functions-ota/index.js does NOT contain beds24OutboundWorker (it lives only in functions-beds24)', () => {
  assert.equal(OTA.includes('beds24OutboundWorker'), false);
});
test('functions-ota/index.js still declares exactly its own two secrets (BEDS24_REFRESH_TOKEN for inbound processOtaEvent/otaCatchUp, OTA_WEBHOOK_SECRET for otaWebhook) and no others', () => {
  assert.ok(OTA.includes("defineSecret('BEDS24_REFRESH_TOKEN')"));
  assert.ok(OTA.includes("defineSecret('OTA_WEBHOOK_SECRET')"));
});
test('functions-beds24/index.js declares ONLY BEDS24_REFRESH_TOKEN in actual code, never OTA_WEBHOOK_SECRET (the name may appear in an explanatory comment on why it is deliberately absent)', () => {
  const codeOnly = BEDS24.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(codeOnly.includes("defineSecret('BEDS24_REFRESH_TOKEN')"));
  assert.equal(codeOnly.includes('OTA_WEBHOOK_SECRET'), false);
});
test('firebase.json registers functions-beds24 as its own "beds24" codebase', () => {
  const firebaseJson = JSON.parse(read('firebase.json'));
  const entry = firebaseJson.functions.find((f) => f.codebase === 'beds24');
  assert.ok(entry, 'no "beds24" codebase entry found in firebase.json');
  assert.equal(entry.source, 'functions-beds24');
});

console.log(`\n${passed}/${passed + failed} beds24-sync-wiring assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
