// Phase B24-2A — granular Beds24/OTA feature-flag fail-closed semantics.
// Pure unit tests, no network, no Firestore.
//   node test/ota-feature-flags.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { otaFeatureEnabled, OUTBOUND_JOB_INTENT_FLAG, OTA_CONFIG_DEFAULTS } = F('ota-feature-flags');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

section('MASTER SAFETY');

test('enabled missing entirely -> every feature disabled', () => {
  const cfg = { provider: 'beds24' };
  assert.equal(otaFeatureEnabled(cfg, 'outbound_availability_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_rates_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_restrictions_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_webhook_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_polling_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_processing_enabled'), false);
});

test('enabled:false -> every feature disabled even when the specific flag is true', () => {
  const cfg = { enabled: false, provider: 'beds24', outbound_availability_enabled: true, outbound_rates_enabled: true, outbound_restrictions_enabled: true, inbound_webhook_enabled: true, inbound_polling_enabled: true, inbound_processing_enabled: true };
  assert.equal(otaFeatureEnabled(cfg, 'outbound_availability_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_rates_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_restrictions_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_webhook_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_polling_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_processing_enabled'), false);
});

test('enabled:true with every granular flag missing -> everything still disabled', () => {
  const cfg = { enabled: true, provider: 'beds24' };
  assert.equal(otaFeatureEnabled(cfg, 'outbound_availability_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_rates_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_restrictions_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_webhook_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_polling_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_processing_enabled'), false);
});

test('enabled:true, outbound_rates_enabled:true, but outbound_restrictions_enabled missing -> rate authorized, restriction stays OFF (Phase B24-2A.1, Section C requirement: the two must be independently gated, never coupled)', () => {
  const cfg = { enabled: true, provider: 'beds24', outbound_rates_enabled: true };
  assert.equal(otaFeatureEnabled(cfg, 'outbound_rates_enabled'), true);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_restrictions_enabled'), false);
});

test('enabled:true with every granular flag explicitly false -> everything disabled', () => {
  const cfg = Object.assign({}, OTA_CONFIG_DEFAULTS, { enabled: true, provider: 'beds24' });
  assert.equal(otaFeatureEnabled(cfg, 'outbound_availability_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_rates_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_webhook_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_polling_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_processing_enabled'), false);
});

test('the exact current production doc {enabled:false, provider:"beds24"} remains fully disabled', () => {
  const productionDoc = { enabled: false, provider: 'beds24' };
  for (const flag of Object.keys(OTA_CONFIG_DEFAULTS)) {
    if (flag === 'enabled') continue;
    assert.equal(otaFeatureEnabled(productionDoc, flag), false, flag + ' must be disabled');
  }
});

test('null/undefined cfg -> disabled, never throws', () => {
  assert.equal(otaFeatureEnabled(null, 'outbound_availability_enabled'), false);
  assert.equal(otaFeatureEnabled(undefined, 'outbound_availability_enabled'), false);
});

test('only the strict boolean true authorizes -- truthy non-true values do not', () => {
  const cfg1 = { enabled: true, outbound_availability_enabled: 'true' }; // string, not boolean
  const cfg2 = { enabled: true, outbound_availability_enabled: 1 };
  const cfg3 = { enabled: 'true', outbound_availability_enabled: true }; // master is a string
  assert.equal(otaFeatureEnabled(cfg1, 'outbound_availability_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg2, 'outbound_availability_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg3, 'outbound_availability_enabled'), false);
});

test('the correct positive case: enabled:true AND the specific flag:true authorizes exactly that feature, no others', () => {
  const cfg = { enabled: true, provider: 'beds24', outbound_availability_enabled: true };
  assert.equal(otaFeatureEnabled(cfg, 'outbound_availability_enabled'), true);
  assert.equal(otaFeatureEnabled(cfg, 'outbound_rates_enabled'), false);
  assert.equal(otaFeatureEnabled(cfg, 'inbound_webhook_enabled'), false);
});

section('OUTBOUND JOB INTENT MAPPING (Phase B24-2A.1: corrected 3-intent model)');

test('availability intent maps to outbound_availability_enabled', () => {
  assert.equal(OUTBOUND_JOB_INTENT_FLAG.availability, 'outbound_availability_enabled');
});
test('rate intent maps to outbound_rates_enabled', () => {
  assert.equal(OUTBOUND_JOB_INTENT_FLAG.rate, 'outbound_rates_enabled');
});
test('restriction intent maps to outbound_restrictions_enabled (its own distinct flag, not shared with rate)', () => {
  assert.equal(OUTBOUND_JOB_INTENT_FLAG.restriction, 'outbound_restrictions_enabled');
});
test('the retired "override" intent name has NO entry in the map -- it must never again be treated as a valid intent', () => {
  assert.equal(OUTBOUND_JOB_INTENT_FLAG.override, undefined);
});
test('an unrecognized intent has no entry in the map (undefined, not a fallback)', () => {
  assert.equal(OUTBOUND_JOB_INTENT_FLAG.bogus, undefined);
  assert.equal(OUTBOUND_JOB_INTENT_FLAG[undefined], undefined);
  assert.equal(OUTBOUND_JOB_INTENT_FLAG[''], undefined);
});
test('the map has exactly 3 keys -- availability/rate/restriction, no silent catch-all/default entry, no leftover override key', () => {
  assert.deepEqual(Object.keys(OUTBOUND_JOB_INTENT_FLAG).sort(), ['availability', 'rate', 'restriction']);
});

console.log(`\n${passed}/${passed + failed} ota-feature-flags assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
