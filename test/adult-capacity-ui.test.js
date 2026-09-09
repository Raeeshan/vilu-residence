// Edit-reservation Adult-count capacity guard — 2026-09-09 fix.
//
// The PMS third-guest pricing audit (commit ea921eb) found the edit-
// reservation modal's #ed-ad dropdown hardcoded to 1-6 adults, even though
// every current room caps at 3 guests. edRebuildAdOptions() now rebuilds
// that dropdown from the SELECTED room's own real cap (getR(rn).cap)
// whenever the modal opens or the room changes, instead of a hardcoded
// ceiling -- so 4+ can never even be selected for a room capped at 3, while
// a pre-existing historical reservation whose stored ad already exceeds
// today's cap is still shown correctly rather than silently rewritten.
//
// Extracts the real function out of vilu-unified.html via brace-matching
// (same technique as test/third-guest-pricing.test.js) and runs it against
// a minimal fake <select> — no real DOM/browser, no Firestore.
//   node test/adult-capacity-ui.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PMS = read('vilu-unified.html');

function extractByStart(src, startRegex) {
  const m = src.match(startRegex);
  if (!m) throw new Error('pattern not found: ' + startRegex);
  let i = src.indexOf('{', m.index) + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

const edRebuildAdOptionsSrc = extractByStart(PMS, /function edRebuildAdOptions\(rn, forceValue\)\s*\{/);

// Minimal fake <select>: value + an options array built via
// innerHTML='' (clear) then N appendChild(<option>) calls, exactly the
// sequence the real function performs.
function makeFakeSelect(initialValue) {
  const el = { _options: [], value: initialValue || '' };
  Object.defineProperty(el, 'innerHTML', { set() { el._options = []; }, get() { return ''; } });
  el.appendChild = (opt) => el._options.push(opt);
  return el;
}
function makeSandbox(rooms, selectEl) {
  const document = {
    getElementById: (id) => (id === 'ed-ad' ? selectEl : null),
    createElement: () => ({ value: '', textContent: '' }),
  };
  const sandbox = { document, getR: (n) => rooms.find((r) => r.n === n) };
  vm.createContext(sandbox);
  vm.runInContext(edRebuildAdOptionsSrc, sandbox);
  return sandbox;
}

const ROOMS = [
  { n: 'VR03', cap: 3 },
  { n: 'VR99', cap: 5 }, // hypothetical differently-capped room, proves the fix reads cap dynamically rather than hardcoding 3
];

section('Step 5 — dynamic capacity, not a hardcoded ceiling');
{
  test('a 3-cap room offers exactly options 1, 2, 3 -- never 4+', () => {
    const sel = makeFakeSelect('2');
    const sb = makeSandbox(ROOMS, sel);
    sb.edRebuildAdOptions('VR03', 2);
    assert.deepStrictEqual(sel._options.map((o) => o.value), ['1', '2', '3']);
  });

  test('1 guest is allowed for a 3-cap room', () => {
    const sel = makeFakeSelect();
    const sb = makeSandbox(ROOMS, sel);
    sb.edRebuildAdOptions('VR03', 1);
    assert.strictEqual(sel.value, '1');
    assert.ok(sel._options.some((o) => o.value === '1'));
  });

  test('2 guests is allowed for a 3-cap room', () => {
    const sel = makeFakeSelect();
    const sb = makeSandbox(ROOMS, sel);
    sb.edRebuildAdOptions('VR03', 2);
    assert.strictEqual(sel.value, '2');
    assert.ok(sel._options.some((o) => o.value === '2'));
  });

  test('3 guests is allowed for a 3-cap room', () => {
    const sel = makeFakeSelect();
    const sb = makeSandbox(ROOMS, sel);
    sb.edRebuildAdOptions('VR03', 3);
    assert.strictEqual(sel.value, '3');
    assert.ok(sel._options.some((o) => o.value === '3'));
  });

  test('4+ is rejected/prevented for a 3-cap room: switching rooms mid-edit clamps an existing 4 down to 3', () => {
    const sel = makeFakeSelect('4'); // staff had 4 selected (e.g. from a differently-capped room)
    const sb = makeSandbox(ROOMS, sel);
    sb.edRebuildAdOptions('VR03'); // no forceValue -- re-cap to the new room, matching edSelectRoom()'s call
    assert.ok(!sel._options.some((o) => o.value === '4'), '4 must not even be a selectable option for a 3-cap room');
    assert.strictEqual(sel.value, '3', 'an out-of-range selection clamps down to the room\'s real cap, not silently to 1');
  });

  test('the fix reads each room\'s own cap, not a hardcoded 3 -- a 5-cap room offers up to 5', () => {
    const sel = makeFakeSelect('4');
    const sb = makeSandbox(ROOMS, sel);
    sb.edRebuildAdOptions('VR99', 4);
    assert.deepStrictEqual(sel._options.map((o) => o.value), ['1', '2', '3', '4', '5']);
    assert.strictEqual(sel.value, '4');
  });
}

section('Step 5 — opening the modal never silently rewrites a historical over-cap reservation');
{
  test('a stored ad=4 on a room that now caps at 3 is preserved (option range extends), not clamped away on open', () => {
    const sel = makeFakeSelect();
    const sb = makeSandbox(ROOMS, sel);
    sb.edRebuildAdOptions('VR03', 4); // openEdit()'s call shape: forceValue = the real stored r.ad
    assert.strictEqual(sel.value, '4', 'opening the modal must show the reservation\'s real guest count, not silently change it');
    assert.ok(sel._options.some((o) => o.value === '4'), 'the true stored value must remain a visible, selected option');
  });
}

console.log(`\n${passed}/${passed + failed} adult-capacity-ui assertions passed`);
if (failed) process.exit(1);
