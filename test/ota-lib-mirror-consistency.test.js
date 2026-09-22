// D1, Section 11 — functions-ota/lib and functions/lib carry two physical
// copies of the same inbound-ingestion modules (the "ota" deployment
// codebase vs. the canonical copy the test harness imports -- see every
// affected file's own header comment). Nothing enforces that they stay
// identical; this test does, for exactly the files this task touched plus
// the two files the deployment copy's header comments already declare are
// mirrored.
//   node test/ota-lib-mirror-consistency.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } }

// Strips the deployment copy's own "// Deployment copy for the "ota"
// Functions codebase -- kept in sync with ..." banner (the ONE deliberate,
// documented difference between the two copies -- the canonical
// functions/lib/*.js copies never carry this banner at all, so stripping it
// from the deployment copy is the only normalization needed) before
// comparing. Anything else differing is real drift. Tolerant of CRLF and of
// the banner spanning 2 or 3 comment lines (beds24-inbound.js's banner
// wraps onto a 3rd line to credit its one direct caller).
function stripBanner(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  if (!/^\/\/ Deployment copy for the "ota" Functions codebase/.test(lines[1] || '')) return lines.join('\n'); // canonical copy: no banner to strip
  let i = 1; // lines[0] is 'use strict'; lines[1] is the banner's first line
  while (i < lines.length && !/\)\.$/.test(lines[i])) i++; // advance to the line that closes the banner sentence (ends in ").")
  i++; // and skip past it
  return [lines[0]].concat(lines.slice(i)).join('\n');
}

const MIRRORED_FILES = ['beds24-inbound.js', 'ingest.js', 'adapters.js', 'ota-booking-identity.js'];

for (const name of MIRRORED_FILES) {
  test('functions/lib/' + name + ' and functions-ota/lib/' + name + ' are identical apart from the banner comment', () => {
    const a = stripBanner(fs.readFileSync(path.join(__dirname, '..', 'functions', 'lib', name), 'utf8'));
    const b = stripBanner(fs.readFileSync(path.join(__dirname, '..', 'functions-ota', 'lib', name), 'utf8'));
    assert.strictEqual(a, b, name + ' has drifted between functions/lib and functions-ota/lib -- update both together');
  });
}

test('functions-ota/lib/ota-booking-identity.js exists (the deployment codebase must actually ship the new identity module, not just the canonical copy the tests import)', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'functions-ota', 'lib', 'ota-booking-identity.js')));
});

console.log('\n' + passed + '/' + (passed + failed) + ' ota-lib-mirror-consistency assertions passed');
process.exit(failed ? 1 : 0);
