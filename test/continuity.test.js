// Phase 55 — Final AI Continuity regression suite.
//
// Run: node test/continuity.test.js
//
// Guards the structural integrity of the project's own continuity system:
// the 56-phase completion matrix has no duplicate/missing phase numbers and
// uses only valid status labels, the locked package catalog and protected
// function names are still named exactly as VILU_PROTECTED_CONTRACTS.md
// requires, and the roadmap/protected-contracts/decisions docs still contain
// the cross-references future sessions depend on. Prose-formatting details
// are deliberately not asserted on — only facts a future session would rely
// on to avoid re-discovering or contradicting past decisions.

const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const MATRIX = read('docs/ai/VILU_COMPLETION_MATRIX.md');
const CONTRACTS = read('docs/ai/VILU_PROTECTED_CONTRACTS.md');
const DECISIONS = read('docs/ai/VILU_DECISIONS.md');
const CURRENT_STATE = read('docs/ai/VILU_CURRENT_STATE.md');
const ROADMAP = read('docs/ai/VILU_ROADMAP.md');
const FIREBASE_JSON = JSON.parse(read('firebase.json'));

function matrixRows() {
  return [...MATRIX.matchAll(/^\| (\d+) — [^|]+\|\s*([^|]+)\|/gm)].map(m => ({
    num: parseInt(m[1], 10),
    status: m[2].trim(),
  }));
}

section('Case A — completion matrix structural integrity');
{
  const rows = matrixRows();
  test('the matrix has exactly 56 phase rows', () => {
    assert.equal(rows.length, 56, `found ${rows.length} phase rows, expected 56`);
  });
  test('phase numbers are 0-55 (or 1-56), each appearing exactly once — no duplicates, no gaps', () => {
    const nums = rows.map(r => r.num).sort((a, b) => a - b);
    const seen = new Set();
    const dupes = [];
    for (const n of nums) { if (seen.has(n)) dupes.push(n); seen.add(n); }
    assert.equal(dupes.length, 0, `duplicate phase number(s): ${dupes.join(', ')}`);
    const min = nums[0], max = nums[nums.length - 1];
    assert.equal(max - min + 1, 56, `phase numbers span ${min}-${max}, not a contiguous 56-length range`);
    for (let n = min; n <= max; n++) {
      assert.ok(seen.has(n), `phase number ${n} is missing from the matrix`);
    }
  });
  test('every row uses a recognized status value', () => {
    const VALID = /^(\*\*)?(COMPLETE|PARTIALLY COMPLETE|PARTIAL|PENDING|CURRENT|BLOCKED|OWNER REVIEW)/;
    const bad = rows.filter(r => !VALID.test(r.status));
    assert.equal(bad.length, 0, 'unrecognized status value(s): ' + bad.map(r => `#${r.num}: "${r.status.slice(0, 40)}"`).join('; '));
  });
  test('status counts are internally consistent with a plain count of the rows', () => {
    const complete = rows.filter(r => /^(\*\*)?COMPLETE/.test(r.status)).length;
    const partial = rows.filter(r => /^(\*\*)?PARTIAL/.test(r.status)).length;
    const pending = rows.filter(r => /^(\*\*)?PENDING/.test(r.status)).length;
    assert.equal(complete + partial + pending, 56, `${complete} complete + ${partial} partial + ${pending} pending != 56 (some row has an unaccounted-for status)`);
  });
}

section('Case B — locked package catalog (VILU_PROTECTED_CONTRACTS.md)');
{
  const LOCKED_PACKAGES = [
    ['island-explorer-getaway', '$450', '4'],
    ['reef-sunset-adventure', '$550', '5'],
    ['island-serenity-escape', '$650', '6'],
    ['maldives-dream-bliss', '$700', '7'],
    ['ultimate-island-relaxation', '$790', '8'],
    ['grand-maldives-escape', '$880', '9'],
    ['ultimate-maldives-odyssey', '$940', '10'],
    ['ultimate-resort-island-odyssey', '$1300', '11'],
    ['honeymoon-dream-escape', '$1100', '10'],
  ];
  test('all 9 locked package IDs/prices/nights are still documented exactly', () => {
    for (const [id, price, nights] of LOCKED_PACKAGES) {
      const row = CONTRACTS.split('\n').find(l => l.includes('`' + id + '`'));
      assert.ok(row, `package ${id} missing from VILU_PROTECTED_CONTRACTS.md`);
      assert.ok(row.includes(price), `package ${id} price changed from ${price}: "${row}"`);
      assert.ok(row.includes('| ' + nights + ' |'), `package ${id} nights changed from ${nights}: "${row}"`);
    }
  });
}

section('Case C — protected function/pattern names still named exactly as documented');
{
  const PROTECTED_NAMES = [
    'writeReservation()', 'submitDirectBooking()', 'runTransaction', '{merge:true}',
    'ROOM_CONFLICT', 'openBookingPopup()', 'openBookingPage()', 'bfpSearch()',
    'confirmGuestBooking()', 'initBookingHashHandoff()', "BroadcastChannel('vilu_pms')",
  ];
  test('every Phase 48-listed protected contract name still appears in VILU_PROTECTED_CONTRACTS.md', () => {
    for (const name of PROTECTED_NAMES) {
      assert.ok(CONTRACTS.includes(name), `${name} no longer documented in VILU_PROTECTED_CONTRACTS.md`);
    }
  });
  test('the esc() stored-XSS requirement is documented in both VILU_PROTECTED_CONTRACTS.md and VILU_DECISIONS.md', () => {
    assert.ok(/esc\(\)/.test(CONTRACTS), 'esc() requirement missing from VILU_PROTECTED_CONTRACTS.md');
    assert.ok(/esc\(\)/.test(DECISIONS), 'esc() requirement missing from VILU_DECISIONS.md');
  });
  test('agency isolation (agencyId==auth.uid) is documented in VILU_PROTECTED_CONTRACTS.md', () => {
    assert.ok(/agencyId\s*==\s*(request\.auth\.uid|auth\.uid)/.test(CONTRACTS), 'agency isolation pattern missing from VILU_PROTECTED_CONTRACTS.md');
  });
}

section('Case D — continuity docs cross-reference each other correctly');
{
  test('VILU_CURRENT_STATE.md points to VILU_COMPLETION_MATRIX.md as authoritative', () => {
    assert.ok(/VILU_COMPLETION_MATRIX\.md/.test(CURRENT_STATE), 'VILU_CURRENT_STATE.md no longer references the completion matrix');
  });
  test('VILU_CURRENT_STATE.md stays short (a snapshot, not a re-grown history dump)', () => {
    const lines = CURRENT_STATE.split('\n').length;
    assert.ok(lines < 100, `VILU_CURRENT_STATE.md is ${lines} lines — it has regrown into a history dump; move phase-by-phase detail to VILU_CHANGELOG.md instead`);
  });
  test('VILU_ROADMAP.md defers phase-status authority to the completion matrix', () => {
    assert.ok(/VILU_COMPLETION_MATRIX\.md/.test(ROADMAP), 'VILU_ROADMAP.md no longer references the completion matrix');
  });
  test('the post-56 Growth Operating Model is documented as a permanent decision', () => {
    assert.ok(/post-56-phase Growth Operating Model/.test(DECISIONS), 'post-56 Growth Operating Model section missing from VILU_DECISIONS.md');
  });
}

section('Case E — private/internal artifacts excluded from hosting (firebase.json)');
{
  const ignore = FIREBASE_JSON.hosting.ignore || [];
  test('docs/**, test/**, .claude/**, firestore.rules, functions/** are all excluded from hosting', () => {
    for (const path of ['docs/**', 'test/**', '.claude/**', 'firestore.rules', 'functions/**']) {
      assert.ok(ignore.includes(path), `${path} missing from firebase.json hosting.ignore`);
    }
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} continuity assertions passed`);
if (failed > 0) process.exitCode = 1;
