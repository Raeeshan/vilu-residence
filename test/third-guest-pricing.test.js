// Third-guest / extra-bed pricing consistency — 2026-09-09 fix.
//
// Verifies the single canonical $20/night 3rd-guest supplement (TAX.thirdGuest
// / BE_TAX.thirdGuest) used by calcTax() (PMS/staff paths) and calcPrice()
// (guest-facing booking widget), and that extraBeds/anExtraBedCharge() no
// longer adds a second, room-rate-based charge for the same person.
//
// Extracts the real functions out of vilu-unified.html via brace-matching
// (same technique already used by test/pms-hardening.test.js's extractFn) and
// runs them in a vm sandbox — no Firestore, no browser, no live reservation.
//   node test/third-guest-pricing.test.js
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

// Brace-matches from a regex match's end through the function's closing '}'.
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

const ntSrc = 'const nt=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5);';
const beNtSrc = extractByStart(PMS, /function be_nt\(ci,co\)\s*\{/);
const taxDefaultSrc = extractByStart(PMS, /let TAX=\{tgst:17/).replace(/^let TAX=/, 'var TAX=');
const calcTaxSrc = extractByStart(PMS, /function calcTax\(r\)\s*\{/);
const calcPriceSrc = extractByStart(PMS, /function calcPrice\(rate, ci, co, ad, ch\)\s*\{/);
const anExtraBedChargeSrc = extractByStart(PMS, /function anExtraBedCharge\(r\)\s*\{/);

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  [ntSrc, beNtSrc, taxDefaultSrc, 'var BE_TAX = Object.assign({}, TAX);', calcTaxSrc, calcPriceSrc, anExtraBedChargeSrc].join('\n'),
  sandbox
);
const { calcTax, calcPrice, anExtraBedCharge, TAX } = sandbox;

function mkRes(rate, ci, co, ad, ch, extra) {
  return Object.assign({ ci, co, rate, ad, ch }, extra || {});
}

section('Case A — canonical rate is exactly $20, single source of truth');
{
  test('TAX.thirdGuest defaults to 20', () => {
    assert.equal(TAX.thirdGuest, 20);
  });
}

section('Case B — 1 night boundary cases, all three room rates ($80/$90/$90)');
{
  for (const [label, rate] of [['Deluxe Family $80', 80], ['Double $90', 90], ['Open Deck $90', 90]]) {
    test(`${label}: 1 night, 1 guest -> base room rate only`, () => {
      const x = calcTax(mkRes(rate, '2026-12-01', '2026-12-02', 1, 0));
      assert.equal(x.thirdGuest, 0);
      assert.equal(x.base, rate);
    });
    test(`${label}: 1 night, 2 guests -> base room rate only`, () => {
      const x = calcTax(mkRes(rate, '2026-12-01', '2026-12-02', 2, 0));
      assert.equal(x.thirdGuest, 0);
      assert.equal(x.base, rate);
    });
    test(`${label}: 1 night, 3 guests -> base + $20`, () => {
      const x = calcTax(mkRes(rate, '2026-12-01', '2026-12-02', 3, 0));
      assert.equal(x.thirdGuest, 20);
      assert.equal(x.base, rate + 20);
    });
  }
}

section('Case C — the owner\'s exact worked examples');
{
  test('Double / 1 night / 2 guests: $90 base', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 2, 0));
    assert.equal(x.base, 90);
  });
  test('Double / 1 night / 3 guests: $110 before taxes/fees', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0));
    assert.equal(x.base, 110);
  });
  test('Double / 5 nights / 3 guests: $550 before taxes/fees', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-06', 3, 0));
    assert.equal(x.n, 5);
    assert.equal(x.base, 550);
  });
}

section('Case D — extra_bed_requested true/false must produce the SAME $20 supplement, never a second charge');
{
  test('extraBeds=0 (not requested), 3 guests -> still $20 (charge is for the 3rd person)', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 0 }));
    assert.equal(x.thirdGuest, 20);
  });
  test('extraBeds=1 (requested), 3 guests -> still exactly $20, not $20+another bed fee', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 1 }));
    assert.equal(x.thirdGuest, 20);
  });
  test('anExtraBedCharge() always returns 0 -- extraBeds carries no price of its own', () => {
    assert.equal(anExtraBedCharge(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 1 })), 0);
    assert.equal(anExtraBedCharge(mkRes(90, '2026-12-01', '2026-12-02', 2, 0, { extraBeds: 3 })), 0);
  });
  test('anResTotal-equivalent (calcTax(r).total + anExtraBedCharge(r)) never double-counts the 3rd guest', () => {
    const withBed = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 1 }));
    const withoutBed = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 0 }));
    const totalWithBed = withBed.total + anExtraBedCharge(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 1 }));
    const totalWithoutBed = withoutBed.total + anExtraBedCharge(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 0 }));
    assert.equal(totalWithBed, totalWithoutBed);
  });
  test('never charges the room\'s own full nightly rate for an extra bed (the historical bug)', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { extraBeds: 1 }));
    assert.notEqual(x.base, 90 + 90); // must not be base + full room rate
    assert.equal(x.base, 90 + 20);
  });
}

section('Case E — occupancy guards: capped at exactly one $20 supplement regardless of over-capacity input');
{
  test('4 guests (beyond the 3-guest room cap) still charges only one $20, not $40', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 4, 0));
    assert.equal(x.thirdGuest, 20);
  });
  test('gp=5 still charges only one $20', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 2));
    assert.equal(x.thirdGuest, 20);
  });
}

section('Case F — infants never trigger the 3rd-guest supplement (matches existing Green Tax gp=ad+ch exclusion)');
{
  test('2 adults + 1 infant (inf, not ch) -> no 3rd-guest charge', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 2, 0, { inf: 1 }));
    assert.equal(x.thirdGuest, 0);
  });
  test('2 adults + 1 child (ch, counted) -> 3rd-guest charge applies', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 2, 1));
    assert.equal(x.thirdGuest, 20);
  });
}

section('Case G — agency/B2B bookings are excluded (public/direct = $20, agency rate stays owner-pending)');
{
  test('src:"Agency", 3 guests -> $0 supplement (not silently set to $20)', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { src: 'Agency' }));
    assert.equal(x.thirdGuest, 0);
    assert.equal(x.base, 90);
  });
  test('src:"Direct", 3 guests -> $20 applies normally', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0, { src: 'Direct' }));
    assert.equal(x.thirdGuest, 20);
  });
}

section('Case H — reservation edits 2<->3 guests recompute correctly (no stale persisted charge)');
{
  test('editing ad 2 -> 3 on the same reservation increases base by exactly $20/night', () => {
    const before = calcTax(mkRes(90, '2026-12-01', '2026-12-03', 2, 0));
    const after = calcTax(mkRes(90, '2026-12-01', '2026-12-03', 3, 0));
    assert.equal(after.base - before.base, 40); // $20 x 2 nights
  });
  test('editing ad 3 -> 2 on the same reservation removes the supplement entirely', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-03', 2, 0));
    assert.equal(x.thirdGuest, 0);
  });
}

section('Case I — tax follows the same rules as other taxable room revenue (folded into base before svc/TGST)');
{
  test('service charge and TGST are computed on (room + 3rd-guest supplement), not on room alone', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0));
    const expectedSvc = +((110) * TAX.svc / 100).toFixed(2);
    const expectedTgst = +(((110) + expectedSvc) * TAX.tgst / 100).toFixed(2);
    assert.equal(x.svc, expectedSvc);
    assert.equal(x.tgst, expectedTgst);
  });
  test('Green Tax is unaffected by the 3rd-guest fix -- still $TAX.green x gp x nights', () => {
    const x = calcTax(mkRes(90, '2026-12-01', '2026-12-02', 3, 0));
    assert.equal(x.green, +(TAX.green * 3 * 1).toFixed(2));
  });
}

section('Case J — guest-facing calcPrice() (booking-engine widget) matches calcTax() exactly');
{
  test('calcPrice mirrors calcTax for 2 guests (no supplement)', () => {
    const p = calcPrice(90, '2026-12-01', '2026-12-02', 2, 0);
    assert.equal(p.thirdGuest, 0);
    assert.equal(p.base, 90);
  });
  test('calcPrice mirrors calcTax for 3 guests ($20 supplement)', () => {
    const p = calcPrice(90, '2026-12-01', '2026-12-02', 3, 0);
    assert.equal(p.thirdGuest, 20);
    assert.equal(p.base, 110);
  });
  test('calcPrice 5 nights / 3 guests matches the owner\'s $550 pre-tax example', () => {
    const p = calcPrice(90, '2026-12-01', '2026-12-06', 3, 0);
    assert.equal(p.n, 5);
    assert.equal(p.base, 550);
  });
}

console.log(`\n${passed}/${passed + failed} third-guest-pricing assertions passed`);
if (failed) process.exit(1);
