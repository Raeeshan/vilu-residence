// Phase B24-2A (updated B24-2A.1) — granular sync control matrix, wiring
// checks.
//
// Static/source-level checks only (matches the existing
// beds24-sync-wiring.test.js / pms-hardening.test.js convention) -- no live
// Firestore connection, no emulator, no real reservation or Beds24 call is
// ever made. Verifies:
//   - every enqueueBeds24Sync call site in functions-core/index.js stamps
//     the correct job_intent ('availability' | 'rate' | 'restriction' --
//     the previous 'override' intent name is RETIRED, see Section B/C of
//     Phase B24-2A.1: beds24OverrideChangeSync is actually a RATE concern
//     despite its name)
//   - beds24OutboundWorker (functions-beds24/index.js) fails closed on a
//     missing/unrecognized job_intent BEFORE checking ota_config at all
//   - beds24OutboundWorker uses otaFeatureEnabled()/OUTBOUND_JOB_INTENT_FLAG
//     (the fail-closed helper), not a raw `cfg.enabled` check
//   - otaWebhook/otaCatchUp/processQueued (functions-ota/index.js) each
//     check their own specific granular flag, not a shared raw `cfg.enabled`
//   - otaCatchUp gates polling and processing independently
//
//   node test/beds24-granular-sync-wiring.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
const CORE_BRIDGE = read('functions-core/lib/beds24-bridge.js');
const BEDS24_BRIDGE = read('functions-beds24/lib/beds24-bridge.js');

section('Case A — every enqueueBeds24Sync call site stamps the correct job_intent');

test('enqueueBeds24Sync itself accepts and forwards a jobIntent third argument into buildBeds24PushRecord', () => {
  const m = CORE.match(/async function enqueueBeds24Sync\(trigger, affectedDates, jobIntent\)[\s\S]*?\n\}/);
  assert.ok(m, 'enqueueBeds24Sync must declare a jobIntent parameter');
  assert.ok(m[0].includes('jobIntent }'), 'jobIntent must be forwarded into buildBeds24PushRecord');
});
test("availabilityOnReservation enqueues with job intent 'availability'", () => {
  const m = CORE.match(/exports\.availabilityOnReservation[\s\S]*?\n\}\);/)[0];
  assert.ok(/enqueueBeds24Sync\([^)]*'availability'\)/.test(m));
});
test("availabilityOnBlock enqueues with job intent 'availability'", () => {
  const m = CORE.match(/exports\.availabilityOnBlock[\s\S]*?\n\}\);/)[0];
  assert.ok(/enqueueBeds24Sync\([^)]*'availability'\)/.test(m));
});
test("beds24RateChangeSync (Phase B24-2A.1: split into two independently-enqueued intents) enqueues a 'rate' job only when base_rate changed, and a separate 'restriction' job only when a restriction field changed", () => {
  const m = CORE.match(/exports\.beds24RateChangeSync[\s\S]*?\n\}\);/)[0];
  assert.match(m, /const RATE_FIELDS = \['base_rate'\];/, 'RATE_FIELDS must be exactly base_rate');
  assert.match(m, /const RESTRICTION_FIELDS = \[[^\]]*'min_stay'[^\]]*'max_stay'[^\]]*'closed_to_arrival'[^\]]*'closed_to_departure'[^\]]*'manual_stop_sell'[^\]]*\];/, 'RESTRICTION_FIELDS must cover the 5 restriction-shaped fields');
  assert.ok(/if \(rateChanged\) await enqueueBeds24Sync\([^)]*'rate'\);/.test(m), "rateChanged must enqueue a 'rate'-intent job");
  assert.ok(/if \(restrictionChanged\) await enqueueBeds24Sync\([^)]*'restriction'\);/.test(m), "restrictionChanged must enqueue a 'restriction'-intent job");
});
test("beds24OverrideChangeSync enqueues with job intent 'rate', NOT 'restriction' or the retired 'override' -- corrected via source audit: it watches a per-date PRICE field (resolveRate() treats overrides[date] as a rate value, never a restriction flag), despite its name and collection name", () => {
  const m = CORE.match(/exports\.beds24OverrideChangeSync[\s\S]*?\n\}\);/)[0];
  assert.ok(m.includes('enqueueBeds24Sync('), 'enqueueBeds24Sync call not found');
  assert.match(m, /enqueueBeds24Sync\(\s*'ota_room_type_overrides:[\s\S]*?, 'rate'\);/, 'expected the enqueue call to end with job intent \'rate\'');
  assert.equal(/enqueueBeds24Sync\([\s\S]*?, 'restriction'\);/.test(m), false, 'must NOT use the phase prompt\'s unverified "expected direction" hint of restriction -- source audit overrides it');
});
test("nightlyReconcile enqueues with job intent 'availability'", () => {
  const m = CORE.match(/exports\.nightlyReconcile[\s\S]*?\n\}\);/)[0];
  assert.ok(/enqueueBeds24Sync\([^)]*'availability'\)/.test(m));
});
test('buildBeds24PushRecord (functions-core copy) writes job_intent into the record, defaulting to null (never a silent guess) when the caller omits it', () => {
  assert.ok(CORE_BRIDGE.includes('job_intent: jobIntent || null'));
});

section('Case B — beds24OutboundWorker fails closed on job_intent BEFORE touching ota_config');

test('beds24OutboundWorker imports otaFeatureEnabled/OUTBOUND_JOB_INTENT_FLAG from ./lib/ota-feature-flags', () => {
  assert.ok(BEDS24.includes("require('./lib/ota-feature-flags')"));
  assert.ok(BEDS24.includes('otaFeatureEnabled'));
  assert.ok(BEDS24.includes('OUTBOUND_JOB_INTENT_FLAG'));
});
test('the job_intent -> requiredFlag lookup happens BEFORE the ota_config read (fail closed on an unknown intent without even needing to read config)', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  const intentCheckIndex = m.indexOf('OUTBOUND_JOB_INTENT_FLAG[job.job_intent]');
  const cfgReadIndex = m.indexOf("store.get('ota_config', 'channel_manager')");
  assert.ok(intentCheckIndex > -1, 'job_intent lookup not found');
  assert.ok(cfgReadIndex > -1, 'ota_config read not found');
  assert.ok(intentCheckIndex < cfgReadIndex, 'job_intent must be validated before reading ota_config');
});
test('a missing/unrecognized requiredFlag marks the job "skipped" and returns -- never proceeds to build/push a payload', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  assert.ok(/if \(!requiredFlag\) \{[\s\S]*?status: 'skipped'[\s\S]*?return;\s*\}/.test(m));
});
test('the ota_config authorization check uses otaFeatureEnabled(cfg, requiredFlag) -- never a raw `cfg.enabled` check alone', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  assert.ok(m.includes('otaFeatureEnabled(cfg, requiredFlag)'));
  assert.ok(!/if \(!cfg\.enabled \|\|/.test(m), 'must not still use the old raw cfg.enabled check');
});
test('buildDifferentialPayload is called with a mode derived from job_intent via JOB_INTENT_TO_PAYLOAD_MODE', () => {
  assert.ok(BEDS24.includes('JOB_INTENT_TO_PAYLOAD_MODE'));
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  assert.ok(/mode: payloadMode/.test(m));
});
test("JOB_INTENT_TO_PAYLOAD_MODE (Phase B24-2A.1) is a strict 1:1 identity map across the 3 final intents -- availability/rate/restriction -- with no 'override' key and no 'full' value anywhere", () => {
  const m = BEDS24.match(/const JOB_INTENT_TO_PAYLOAD_MODE = Object\.freeze\(\{[^}]*\}\);/)[0];
  assert.ok(/availability:\s*'availability'/.test(m));
  assert.ok(/rate:\s*'rate'/.test(m));
  assert.ok(/restriction:\s*'restriction'/.test(m));
  assert.equal(/override/.test(m), false, 'the retired override key must not reappear');
  assert.equal(/'full'/.test(m), false, "no intent may map to 'full' -- a valid production job must map explicitly to availability/rate/restriction");
});
test('no code path in beds24OutboundWorker can ever select mode:\'full\' as a fallback -- payloadMode is only ever set from JOB_INTENT_TO_PAYLOAD_MODE, and an intent absent from OUTBOUND_JOB_INTENT_FLAG already returns before that lookup is reached', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  assert.equal(/'full'/.test(m), false, "the worker body must never reference the string 'full'");
  const payloadModeAssignIndex = m.indexOf('const payloadMode = JOB_INTENT_TO_PAYLOAD_MODE[job.job_intent]');
  const requiredFlagCheckIndex = m.indexOf('if (!requiredFlag)');
  assert.ok(payloadModeAssignIndex > -1 && requiredFlagCheckIndex > -1);
  assert.ok(requiredFlagCheckIndex < payloadModeAssignIndex, 'the fail-closed requiredFlag check must run before payloadMode is ever computed');
});
test('beds24-bridge (functions-beds24 copy) still never logs a credential anywhere in the worker (regression: Section M)', () => {
  const m = BEDS24.match(/exports\.beds24OutboundWorker[\s\S]*?\n\}\);/)[0];
  const consoleCalls = m.match(/console\.\w+\([^;]*\);/g) || [];
  for (const call of consoleCalls) assert.equal(/refreshToken|accessToken|BEDS24_TOKEN\.value/i.test(call), false, call);
});
test('buildBeds24PushRecord (functions-beds24 copy) also carries job_intent (kept in sync with the core copy)', () => {
  assert.ok(BEDS24_BRIDGE.includes('job_intent: jobIntent || null'));
});

section('Case C — otaWebhook checks its own specific flag, not a shared raw enabled');

test('otaWebhook imports otaFeatureEnabled and checks inbound_webhook_enabled specifically', () => {
  assert.ok(OTA.includes("require('./lib/ota-feature-flags')"));
  const m = OTA.match(/exports\.otaWebhook[\s\S]*?\n\}\);/)[0];
  assert.ok(m.includes("otaFeatureEnabled(cfg, 'inbound_webhook_enabled')"));
  assert.ok(!/if \(!cfg\.enabled\) return res\.status\(503\)/.test(m), 'must not still use the old raw cfg.enabled check');
});
test('the secret validation in otaWebhook still runs unconditionally BEFORE the flag check (security check is never itself gated by a feature flag)', () => {
  const m = OTA.match(/exports\.otaWebhook[\s\S]*?\n\}\);/)[0];
  const secretCheckIndex = m.indexOf('timingSafeEqual');
  const flagCheckIndex = m.indexOf("otaFeatureEnabled(cfg, 'inbound_webhook_enabled')");
  assert.ok(secretCheckIndex > -1 && flagCheckIndex > -1);
  assert.ok(secretCheckIndex < flagCheckIndex, 'secret check must run before the feature-flag check');
});

section('Case D — processQueued is the single choke point for inbound_processing_enabled');

test('processQueued checks otaFeatureEnabled(cfg, \'inbound_processing_enabled\') and marks the item "skipped" (not silently dropped, not left ambiguous) when disabled', () => {
  const m = OTA.match(/async function processQueued[\s\S]*?\n\}/)[0];
  assert.ok(m.includes("otaFeatureEnabled(cfg, 'inbound_processing_enabled')"));
  assert.ok(/if \(!otaFeatureEnabled\(cfg, 'inbound_processing_enabled'\)\) \{ await ref\.set\(\{ state: 'skipped'/.test(m));
});
test('processQueued\'s processing-flag check happens BEFORE any Beds24 fetchBooking/ingestEvent call', () => {
  const m = OTA.match(/async function processQueued[\s\S]*?\n\}/)[0];
  const flagCheckIndex = m.indexOf("inbound_processing_enabled");
  const fetchBookingIndex = m.indexOf('adapter.fetchBooking');
  const ingestIndex = m.indexOf('ingestEvent(');
  assert.ok(flagCheckIndex > -1);
  if (fetchBookingIndex > -1) assert.ok(flagCheckIndex < fetchBookingIndex, 'processing flag must be checked before fetchBooking');
  assert.ok(flagCheckIndex < ingestIndex, 'processing flag must be checked before ingestEvent (the only path that can mutate a PMS reservation)');
});
test('channelAdapter() now returns cfg alongside {name, adapter} so processQueued/otaCatchUp share one Firestore read', () => {
  const m = OTA.match(/async function channelAdapter\(\)[\s\S]*?\n\}/)[0];
  assert.ok(/return \{ name: 'beds24'.*cfg \}/.test(m));
  assert.ok(/return \{ name: cfg\.provider \|\| 'none', adapter: null, cfg \}/.test(m));
});

section('Case E — otaCatchUp gates polling and processing independently');

test('otaCatchUp checks inbound_polling_enabled before calling adapter.listModifiedSince', () => {
  const m = OTA.match(/exports\.otaCatchUp[\s\S]*?\n\}\);/)[0];
  const pollFlagIndex = m.indexOf("otaFeatureEnabled(cfg, 'inbound_polling_enabled')");
  const listModifiedIndex = m.indexOf('adapter.listModifiedSince');
  assert.ok(pollFlagIndex > -1 && listModifiedIndex > -1);
  assert.ok(pollFlagIndex < listModifiedIndex, 'inbound_polling_enabled must gate the remote fetch');
});
test('otaCatchUp checks inbound_processing_enabled independently before the retry-reprocessing loop', () => {
  const m = OTA.match(/exports\.otaCatchUp[\s\S]*?\n\}\);/)[0];
  assert.ok(m.includes("otaFeatureEnabled(cfg, 'inbound_processing_enabled')"));
  const processFlagIndex = m.lastIndexOf("otaFeatureEnabled(cfg, 'inbound_processing_enabled')");
  const processQueuedCallIndex = m.indexOf('await processQueued(d.id, x)');
  assert.ok(processFlagIndex < processQueuedCallIndex);
});
test('the master adapter-presence check (`if (!adapter) return;`) still runs first as the backstop under both granular checks', () => {
  const m = OTA.match(/exports\.otaCatchUp[\s\S]*?\n\}\);/)[0];
  const masterIndex = m.indexOf('if (!adapter) return;');
  const pollFlagIndex = m.indexOf("otaFeatureEnabled(cfg, 'inbound_polling_enabled')");
  assert.ok(masterIndex > -1 && masterIndex < pollFlagIndex);
});
test('the cursor doc is only updated inside the polling-enabled branch (never silently advanced while polling is disabled)', () => {
  const m = OTA.match(/exports\.otaCatchUp[\s\S]*?\n\}\);/)[0];
  const pollBlockMatch = m.match(/if \(otaFeatureEnabled\(cfg, 'inbound_polling_enabled'\)\) \{([\s\S]*?)\n  \}/);
  assert.ok(pollBlockMatch, 'polling-enabled block not found');
  assert.ok(pollBlockMatch[1].includes("store.set('ota_config', 'cursor'"), 'cursor update must live inside the polling-enabled block');
});

section('Case F — nightlyReconcile proven safe (Phase B24-2A.1, Section N)');

test('nightlyReconcile enqueues exactly ONE job per mapped room type, always intent \'availability\' -- never rate/restriction, never more than one job per type', () => {
  const m = CORE.match(/exports\.nightlyReconcile[\s\S]*?\n\}\);/)[0];
  const enqueueCalls = m.match(/enqueueBeds24Sync\([^;]*\);/g) || [];
  assert.equal(enqueueCalls.length, 1, 'nightlyReconcile must contain exactly one enqueueBeds24Sync call site');
  assert.ok(/enqueueBeds24Sync\([^)]*'availability'\)/.test(enqueueCalls[0]));
});

test("nightlyReconcile is therefore provably safe: its only possible intent ('availability') maps through JOB_INTENT_TO_PAYLOAD_MODE to payload mode 'availability', and buildDatePayload's 'availability' mode is independently proven (see beds24-payload-modes.test.js) to include ONLY numAvail -- never price1/override/minStay/maxStay. No code path lets nightlyReconcile leak price or restriction data.", () => {
  const { buildDatePayload } = require(path.join(__dirname, '..', 'functions', 'lib', 'beds24-bridge'));
  const CONFIG = { base_rate: 90, min_stay: 3, max_stay: 14, closed_to_arrival: false, closed_to_departure: false, manual_stop_sell: true, availability_buffer: 0, currency: 'USD', room_type_id: 'double', tax_mode: 'net_of_tax' };
  const { payload } = buildDatePayload({ roomTypeCode: 'DOUBLE', date: '2027-01-01', config: CONFIG, sellableAvailable: 2, sellableTotal: 3, mode: 'availability' });
  const entry = payload.calendar[0];
  assert.equal('numAvail' in entry, true);
  assert.equal('price1' in entry, false);
  assert.equal('override' in entry, false);
  assert.equal('minStay' in entry, false);
  assert.equal('maxStay' in entry, false);
});

console.log(`\n${passed}/${passed + failed} beds24-granular-sync-wiring assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
