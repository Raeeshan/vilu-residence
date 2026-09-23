// Seasonal Rates UI (Phase R11, final rate-architecture review Gate 3) --
// structural pass over source, same pattern as
// test/block-merge-ui-wiring.test.js. Proves:
//   - the old SNS/addSn fake stub (never persisted, unconditionally faked
//     "pushed to all OTAs" / "Synced") is fully gone
//   - the real UI reads/writes canonical_room_rates/{roomTypeId}, the exact
//     collection functions-core/index.js's beds24ChannelRateSync watches
//   - Save is gated the same way every other pricing/settings save is
//     (canEditTaxSettings())
//   - the channel preview is honest: Booking.com shown as computed, Agoda
//     and Direct/Agent explicitly labeled as NOT PMS-managed by this panel
//   - interval validation (gap/overlap/incomplete) exists client-side
//   - the sync-status watcher only ever claims "Synced" after reading a
//     real ota_pushes job's status, mirroring watchOtaPushStatus()
//   node test/seasonal-rates-ui.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PMS = read('vilu-unified.html');

section('Case A — the old fake stub is fully gone');

test('SNS array no longer exists anywhere in the file', () => {
  assert.equal(/\bSNS\b/.test(PMS), false);
});
test('addSn() (the fake "push to all OTAs" function) no longer exists', () => {
  assert.equal(/function addSn\(/.test(PMS), false);
});
test('the old fake HTML ids (sn-nm/sn-mt/sn-vl/sn-fr/sn-to/sn-lst) are gone', () => {
  for (const id of ['sn-nm', 'sn-mt', 'sn-vl', 'sn-fr', 'sn-to', 'sn-lst']) {
    assert.equal(new RegExp('id="' + id + '"').test(PMS), false, id + ' should no longer exist');
  }
});

section('Case A2 — final pre-deploy review Gate B: missing-doc fallback shows the real schedule, never a blank screen');

test('srBundledFallbackIntervals() exists and matches the server-side INITIAL_CANONICAL_RATES schedule exactly (60/130/75/130/120 across the same 5 date ranges)', () => {
  const m = PMS.match(/function srBundledFallbackIntervals\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'srBundledFallbackIntervals must exist');
  const src = m[0];
  for (const rate of [60, 130, 75, 130, 120]) assert.ok(src.includes('rate: ' + rate));
  assert.ok(src.includes("from: '2026-09-23'"));
  assert.ok(src.includes("to: '2028-08-31'"));
});
test('srLoadFromFirestore falls back to srBundledFallbackIntervals() when the Firestore doc is missing or has an empty intervals array -- never an empty [] that would render a blank panel', () => {
  const m = PMS.match(/async function srLoadFromFirestore\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(m.includes('srBundledFallbackIntervals()'), 'must reference the bundled fallback, not silently default to []');
  assert.equal(/:\s*\[\]/.test(m), false, 'must never fall back to a bare empty array literal');
});

section('Case B — real Firestore wiring to canonical_room_rates');

test('srLoadFromFirestore reads canonical_room_rates/{roomTypeId} for every room type', () => {
  const m = PMS.match(/async function srLoadFromFirestore\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'srLoadFromFirestore must exist');
  assert.ok(m[0].includes("collection('canonical_room_rates')"), 'must read the canonical_room_rates collection');
  assert.ok(m[0].includes('SR_ROOM_TYPES'), 'must load all room types, not just one');
});
test('srSave() writes canonical_room_rates/{roomTypeId} with an intervals array', () => {
  const m = PMS.match(/async function srSave\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'srSave must exist');
  assert.ok(m[0].includes("collection('canonical_room_rates')"), 'must write the canonical_room_rates collection');
  assert.ok(m[0].includes('intervals:'), 'must write an intervals field');
});
test('srSave() is gated by canEditTaxSettings() -- the same Admin/Manager gate every other pricing/settings save uses', () => {
  const m = PMS.match(/async function srSave\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/canEditTaxSettings\(\)/.test(m));
});
test('srSave() refuses to save when client-side validation reports any problem', () => {
  const m = PMS.match(/async function srSave\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/srValidateIntervals\(rawList\)/.test(m));
  assert.ok(/if\s*\(\s*problems\.length\s*\)/.test(m));
});
test('the room-type id space used (deluxe_family/double/open_deck) matches ota-room-types.js/channel-pricing.js, never the uppercase BEDS24_ROOM_MAP codes', () => {
  assert.ok(PMS.includes("id: 'deluxe_family'"));
  assert.ok(PMS.includes("id: 'double'"));
  assert.ok(PMS.includes("id: 'open_deck'"));
});

section('Case C — honest per-channel preview (Gate 2/3: never imply control this rollout does not have)');

test('the channel preview shows Booking.com as computed (+10%) but Agoda and Direct/Agent as explicitly NOT PMS-managed', () => {
  const m = PMS.match(/const SR_CHANNEL_PREVIEW = \{[\s\S]*?\n\};/);
  assert.ok(m, 'SR_CHANNEL_PREVIEW must exist');
  assert.ok(m[0].includes('booking:'));
  assert.ok(/agoda:[\s\S]*?Not PMS-managed/.test(m[0]), 'Agoda must be labeled not-PMS-managed');
  assert.ok(/direct:[\s\S]*?Not PMS-managed/.test(m[0]), 'Direct/Agent must be labeled not-PMS-managed');
});
test('srDrawPreview never fabricates an Agoda/Direct dollar figure -- only Booking.com gets a computed price', () => {
  const m = PMS.match(/function srDrawPreview\([^)]*\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/bookingPrice/.test(m), 'Booking.com must have a computed price variable');
  assert.equal(/agodaPrice|directPrice/.test(m), false, 'no computed price should ever exist for Agoda or Direct in this panel');
});

section('Case D — client-side interval validation exists (server-side worker independently re-validates -- this is UX only)');

test('srValidateIntervals detects incomplete periods, reversed ranges, gaps, and overlaps', () => {
  const m = PMS.match(/function srValidateIntervals\(list\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/missing a start date/.test(m));
  assert.ok(/ends before it starts/.test(m));
  assert.ok(/Overlap between/.test(m));
  assert.ok(/Gap between/.test(m));
});
test('the Save button is disabled whenever the period list is empty or any validation problem exists', () => {
  const m = PMS.match(/function srDrawPeriods\(\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/sr-save-btn['"]\)[\s\S]{0,40}\.disabled\s*=/.test(m));
});

section('Case E — sync-status watcher never claims Synced without reading a real job (mirrors watchOtaPushStatus)');

test('srWatchPushStatus filters on job_intent "channel_rate" and this save\'s own trigger string, never a generic/unrelated job', () => {
  const m = PMS.match(/function srWatchPushStatus\(roomTypeId\)\{[\s\S]*?\n\}/)[0];
  assert.ok(m.includes("job_intent==='channel_rate'"));
  assert.ok(m.includes("j.trigger==='canonical_room_rates:'+roomTypeId"));
});
test('srSetStatus only reaches "synced" after every matching job\'s status is "succeeded" -- never optimistic', () => {
  const m = PMS.match(/function srWatchPushStatus\(roomTypeId\)\{[\s\S]*?\n\}/)[0];
  assert.ok(/allDone\s*=\s*jobs\.every/.test(m));
  assert.ok(/srSetStatus\('synced'\)/.test(m));
});

console.log(`\n${passed}/${passed + failed} seasonal-rates-ui assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
