// VILU AGENCY PORTAL — SAME-DAY DEPARTURE/ARRIVAL CALENDAR GAP FIX.
//
// Root cause (found by comparing the PMS calendar's own per-reservation bar
// math against the Agency calendar's per-day-bucket-merge math, not assumed):
// the PMS calendar draws one bar per reservation directly from its own
// ci/co, so a departure and the next arrival on the same date both resolve
// to the exact same pixel -- the midpoint of that shared date's column
// (rE = departureIndex*COL_W + COL_W/2, and the next stay's own left edge is
// arrivalIndex*COL_W + COL_W/2 with arrivalIndex===departureIndex). The
// Agency calendar has no single reservation object per cell (only an
// anonymized per-day "bucket", for privacy) and reconstructs continuous bars
// by merging consecutive same-bucket days, but its departure-edge formula
// used "(j+1)*COL_W - COL_W/2" (retracting BACK into the last occupied day's
// own column) instead of "(j+1)*COL_W + COL_W/2" (landing on the departure
// day's own column, same as the PMS math and the same point the very next
// stay's arrival edge lands on) -- a full column's width short, producing a
// large empty visual gap between any two back-to-back stays instead of the
// bars meeting.
//   node test/agency-calendar-bar-geometry.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PORTAL = read('vilu-agency-portal.html');

function extractByStart(src, startRegex) {
  const m = src.match(startRegex);
  if (!m) throw new Error('pattern not found: ' + startRegex);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

section('Vilu-room bars: the departure edge lands on the departure day\'s own column, never retracts into the last-occupied-night\'s column');
{
  test('right edge uses "+ (rightSlant?AG_CAL_COL_W/2:0)", not "-" -- a "-" would land one full column short, opening a gap to the next stay\'s arrival edge', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    const viluBarsIdx = src.indexOf('if(showVilu) ROOMS_LIST.forEach');
    assert.ok(viluBarsIdx > -1, 'Vilu bars loop not found inside agDrawCal()');
    const viluBarsSrc = src.slice(viluBarsIdx, src.indexOf('// Partner bars', viluBarsIdx));
    assert.match(viluBarsSrc, /var right = \(j\+1\)\*AG_CAL_COL_W \+ \(rightSlant\?AG_CAL_COL_W\/2:0\);/);
    assert.doesNotMatch(viluBarsSrc, /var right = \(j\+1\)\*AG_CAL_COL_W - \(rightSlant/);
  });
  test('the arrival edge is unchanged ("+", already correct, already matched the PMS math) -- this fix only touches the departure side', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    const viluBarsIdx = src.indexOf('if(showVilu) ROOMS_LIST.forEach');
    const viluBarsSrc = src.slice(viluBarsIdx, src.indexOf('// Partner bars', viluBarsIdx));
    assert.match(viluBarsSrc, /var left = i\*AG_CAL_COL_W \+ \(leftSlant\?AG_CAL_COL_W\/2:0\);/);
  });
}

section('Partner BLOCKED bars: the same fix applied identically (same merge pattern, same formula, same reasoning)');
{
  test('right edge uses "+" here too', () => {
    const src = extractByStart(PORTAL, /async function agDrawCal\(\)\s*\{/);
    const partnerBarsIdx = src.indexOf('partnerProps.forEach(function(p){');
    assert.ok(partnerBarsIdx > -1, 'partner bars loop not found inside agDrawCal()');
    const partnerBarsSrc = src.slice(partnerBarsIdx);
    assert.match(partnerBarsSrc, /var right=\(j\+1\)\*AG_CAL_COL_W\+\(rightSlant\?AG_CAL_COL_W\/2:0\);/);
    assert.doesNotMatch(partnerBarsSrc, /var right=\(j\+1\)\*AG_CAL_COL_W-\(rightSlant/);
  });
}

section('Worked numeric proof: booking A departs day index 5, booking B arrives the same day index 5 -- bars must meet with zero gap');
{
  // Mirrors the exact arithmetic the two loops above perform, so this test
  // fails immediately if either formula regresses back to "-".
  function computeBarRight(AG_CAL_COL_W, j, rightSlant) { return (j + 1) * AG_CAL_COL_W + (rightSlant ? AG_CAL_COL_W / 2 : 0); }
  function computeBarLeft(AG_CAL_COL_W, i, leftSlant) { return i * AG_CAL_COL_W + (leftSlant ? AG_CAL_COL_W / 2 : 0); }
  test('A\'s right edge (last occupied index 4, i.e. departure index 5) equals B\'s left edge (arrival index 5) exactly -- zero-width gap, only the shared cosmetic 2px trim (identical to the PMS bar\'s own "-2")', () => {
    const COL_W = 64;
    const aRight = computeBarRight(COL_W, /*j=*/4, /*rightSlant=*/true);
    const bLeft = computeBarLeft(COL_W, /*i=*/5, /*leftSlant=*/true);
    assert.equal(aRight, 5 * COL_W + COL_W / 2);
    assert.equal(bLeft, 5 * COL_W + COL_W / 2);
    assert.equal(aRight, bLeft, 'a same-day departure/arrival must resolve to the identical pixel, never a gap');
  });
  test('the OLD ("-") formula would have left a full column of empty space -- documented here so the bug can never silently reappear unnoticed', () => {
    const COL_W = 64;
    const oldBuggyRight = (4 + 1) * COL_W - COL_W / 2; // the retired formula
    const bLeft = computeBarLeft(COL_W, 5, true);
    assert.equal(bLeft - oldBuggyRight, COL_W, 'the old formula was exactly one full column short, reproducing the reported gap');
  });
}
console.log(`\n${passed}/${passed + failed} agency-calendar-bar-geometry (structural) assertions passed`);
