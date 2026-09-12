// Post-completion hardening, item 4: nightlyReconcile previously logged
// NOTHING -- a Cloud Scheduler cold start only proves the container
// booted, never that the reconciliation logic inside actually completed.
// This proves the new nightlyReconcile.start/complete/failed structured
// logs actually fire (against the real function, via the Firestore
// emulator + firebase-functions-test, same pattern as the other -rules
// suites), and that nothing guest-identifying ever reaches them.
//
// Run via:
//   firebase emulators:exec --only firestore "node test/nightly-reconcile-observability-rules.test.js"
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}

(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = 'vilu-residence';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'vilu-residence' });

  const functionsTest = require('firebase-functions-test')({ projectId: 'vilu-residence' });
  const myFunctions = require('../functions-core/index.js');
  const loggerPath = require.resolve('firebase-functions/logger', { paths: [path.join(__dirname, '..', 'functions-core')] });
  const logger = require(loggerPath);

  const src = fs.readFileSync(path.join(__dirname, '..', 'functions-core', 'index.js'), 'utf8');
  const fnStart = src.indexOf('exports.nightlyReconcile');
  const fnSlice = src.slice(fnStart, src.indexOf('\n});', fnStart) + 4);

  section('Structural: logging shape');

  await test('logs nightlyReconcile.start before doing any work', () => {
    assert.match(fnSlice, /logger\.info\(\s*'nightlyReconcile\.start'/);
  });

  await test('logs nightlyReconcile.complete with recordsChecked/differencesFound/changesApplied', () => {
    assert.match(fnSlice, /logger\.info\(\s*'nightlyReconcile\.complete'/);
    assert.match(fnSlice, /recordsChecked/);
    assert.match(fnSlice, /differencesFound/);
    assert.match(fnSlice, /changesApplied/);
  });

  await test('logs nightlyReconcile.failed and RE-THROWS (never silently swallows a failure)', () => {
    assert.match(fnSlice, /catch\s*\(e\)\s*\{[\s\S]*logger\.error\(\s*'nightlyReconcile\.failed'[\s\S]*throw e;/);
  });

  await test('never logs a guest-identifying field (guest_name/email/notes/internal_note/reservation id list)', () => {
    // The whole point of these logs is room-type-level counts -- if a
    // future edit starts interpolating reservation/guest data into them,
    // this must fail loudly rather than quietly leaking guest data into
    // Cloud Logging (which has far broader read access than Firestore).
    assert.doesNotMatch(fnSlice, /guest_name|guest_email|\.notes\b|internal_note|guestName|guestEmail/);
  });

  section('Functional: the wrapped function actually runs and emits the logs');

  const calls = { info: [], error: [] };
  const origInfo = logger.info, origError = logger.error;
  logger.info = (...args) => { calls.info.push(args); };
  logger.error = (...args) => { calls.error.push(args); };

  try {
    const wrapped = functionsTest.wrap(myFunctions.nightlyReconcile);
    await test('runs to completion against the emulator with no seeded data (empty-inventory happy path)', async () => {
      await wrapped();
      const events = calls.info.map((a) => a[0]);
      assert.ok(events.includes('nightlyReconcile.start'), 'expected a nightlyReconcile.start log, got: ' + JSON.stringify(events));
      assert.ok(events.includes('nightlyReconcile.complete'), 'expected a nightlyReconcile.complete log, got: ' + JSON.stringify(events));
      assert.equal(calls.error.length, 0, 'expected no nightlyReconcile.failed log on the happy path');
      const completeCall = calls.info.find((a) => a[0] === 'nightlyReconcile.complete');
      const fields = completeCall[1];
      assert.equal(typeof fields.recordsChecked, 'number');
      assert.equal(typeof fields.differencesFound, 'number');
      assert.equal(typeof fields.changesApplied, 'number');
      assert.equal(typeof fields.durationMs, 'number');
      assert.ok(fields.startedAt && fields.completedAt, 'expected startedAt/completedAt timestamps');
    });
  } finally {
    logger.info = origInfo;
    logger.error = origError;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
