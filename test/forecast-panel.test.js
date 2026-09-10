// Dashboard Forecast panel — 2026-09-10.
//
// Structure/interaction verified directly against the real, authenticated
// Cloudbeds Dashboard (read-only) before implementation: a date-range strip
// whose prev/next arrows shift the WHOLE window by exactly 1 day (not by
// the period length), 5 KPI cards, and two in-place tabs -- "Booked &
// blocked" is a line chart of daily occupancy %, "Availability" is a
// per-accommodation-type TABLE of available-unit counts (not a second
// chart -- confirmed live, memory alone would have gotten this wrong).
//
// Same technique as test/dashboard-cloudbeds-parity.test.js /
// test/third-guest-pricing.test.js: brace-match the real functions out of
// vilu-unified.html and run them in a vm sandbox with their real
// dependency chain (isOcc/isBlockingStatus/anRevenue's whole tax stack),
// so every KPI formula tested is the actual production code, not a
// reimplementation. No Firestore, no browser, no live reservation.
//   node test/forecast-panel.test.js
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

// ── sandbox: fcComputeData() with its real dependency chain ──
const D2Src = "const D2=(b,n)=>{const d=new Date(b+'T12:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};";
const ntSrc = 'const nt=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5);';
const taxSrc = extractByStart(PMS, /let TAX=\{tgst:17/).replace(/^let TAX=/, 'var TAX=');
// USD/MVR billing (2026-09-10): calcTax() now delegates to
// calcTaxGeneral() -- both must be loaded together.
const calcTaxGeneralSrc = extractByStart(PMS, /function calcTaxGeneral\(input\)\s*\{/);
const calcTaxSrc = extractByStart(PMS, /function calcTax\(r\)\s*\{/);
const anExtraBedChargeSrc = extractByStart(PMS, /function anExtraBedCharge\(r\)\s*\{/);
const anVSrc = [
  'function anVilu(r){return (r.prop||propFromRoomId(r.rn))===\'vilu\';}',
  'function propFromRoomId(rn){ return String(rn||\'\').startsWith(\'VR\') ? \'vilu\' : \'partner\'; }',
  'function anActive(r){return r.st!==\'Cancelled\';}',
  'function anOverlaps(r,from,to){return r.ci<to&&r.co>from;}',
  'function anNightsIn(r,from,to){var s=r.ci>from?r.ci:from,e=r.co<to?r.co:to;return Math.max(0,nt(s,e));}',
  'function anViluRes(){return RES.filter(function(r){return anVilu(r)&&anActive(r);});}',
].join('\n');
const anResTotalSrc = extractByStart(PMS, /function anResTotal\(r\)\s*\{/);
const anRevenueSrc = extractByStart(PMS, /function anRevenue\(from,to\)\s*\{/);
const isOccSrc = extractByStart(PMS, /function isOcc\(rn,from,to,excl\)\s*\{/);
const getMaldivesDateSrc = extractByStart(PMS, /function getMaldivesDate\(d\)\s*\{/);
const formatMaldivesDateSrc = extractByStart(PMS, /function formatMaldivesDate\(dateStr\)\s*\{/);
const fcDatesInRangeSrc = extractByStart(PMS, /function fcDatesInRange\(from,to\)\s*\{/);
const fcComputeDataSrc = extractByStart(PMS, /function fcComputeData\(from,to\)\s*\{/);
const fcRangeLabelSrc = extractByStart(PMS, /function fcRangeLabel\(from,to\)\s*\{/);
const fcNiceMaxSrc = extractByStart(PMS, /function fcNiceMax\(v\)\s*\{/);
const fcRenderChartSrc = extractByStart(PMS, /function fcRenderChart\(d\)\s*\{/);
const fcRenderAvailabilityTableSrc = extractByStart(PMS, /function fcRenderAvailabilityTable\(from,to\)\s*\{/);
const fdSrc = "const fd=s=>new Date(s+'T12:00').toLocaleDateString('en-US',{day:'numeric',month:'short'});";
const escSrc = 'function esc(s){ return String(s==null?"":s); }';

const VR = [
  { n:'VR01', nm:'Room 101', type:'Deluxe Family Room', rate:80, cap:3 },
  { n:'VR02', nm:'Room 102', type:'Deluxe Family Room', rate:80, cap:3 },
  { n:'VR03', nm:'Room 103', type:'Double Room', rate:85, cap:3 },
  { n:'VR04', nm:'Room 104', type:'Double Room', rate:85, cap:3 },
  { n:'VR05', nm:'Room 105', type:'Double Room', rate:90, cap:3 },
  { n:'VR06', nm:'Room 106', type:'Deluxe Family Room with Open Deck', rate:90, cap:3 },
];

const sandbox = { VR, RES: [], BLK: [] };
vm.createContext(sandbox);
vm.runInContext([
  D2Src, ntSrc, taxSrc, 'var BE_TAX = Object.assign({}, TAX);', calcTaxGeneralSrc, calcTaxSrc, anExtraBedChargeSrc,
  anVSrc, anResTotalSrc, anRevenueSrc, isOccSrc, getMaldivesDateSrc, formatMaldivesDateSrc,
  fcDatesInRangeSrc, fcComputeDataSrc, fcRangeLabelSrc, fcNiceMaxSrc, fdSrc, escSrc,
  fcRenderChartSrc, fcRenderAvailabilityTableSrc,
].join('\n'), sandbox);

// vm.createContext() objects live in a different realm -- deepStrictEqual
// (what assert/strict's .deepEqual actually calls) checks prototype
// identity, so a structurally-identical cross-realm object/array always
// fails it. Round-trip through JSON to compare plain data instead.
function plain(x) { return JSON.parse(JSON.stringify(x)); }

function mkRes(id, rn, ci, co, st, extra) {
  return Object.assign({ id, rn, prop: 'vilu', ci, co, st, rate: 80, ad: 2, ch: 0 }, extra || {});
}

section('Case A — fcDatesInRange(): inclusive, crosses month/year boundaries correctly');
{
  test('a 14-day range produces exactly 14 dates', () => {
    assert.equal(sandbox.fcDatesInRange('2026-09-10', '2026-09-23').length, 14);
  });
  test('crosses a month boundary (Aug 30 -> Sep 2) with the right calendar dates, no off-by-one', () => {
    const dates = plain(sandbox.fcDatesInRange('2026-08-30', '2026-09-02'));
    assert.deepEqual(dates, ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });
  test('crosses a year boundary (Dec 30 -> Jan 2) correctly', () => {
    const dates = plain(sandbox.fcDatesInRange('2026-12-30', '2027-01-02'));
    assert.deepEqual(dates, ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
}

section('Case B — fcComputeData(): occupied/blocked/available per day, reusing the real isOcc()');
{
  test('no reservations, no blocks -> fully available, 0% occupancy', () => {
    sandbox.RES = []; sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.deepEqual(plain(d.series[0]), { date: '2026-09-10', booked: 0, blocked: 0, available: 6 });
    assert.equal(d.occupancyPct, 0);
  });
  test('a fully-occupied day: 6 rooms booked, 0 available, occupancy 100%', () => {
    sandbox.RES = VR.map((vr, i) => mkRes('F' + i, vr.n, '2026-09-10', '2026-09-11', 'Confirmed'));
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.deepEqual(plain(d.series[0]), { date: '2026-09-10', booked: 6, blocked: 0, available: 0 });
    assert.equal(d.occupancyPct, 100);
  });
  test('same-day check-in/check-out (0 nights) never occupies the room overnight', () => {
    sandbox.RES = [mkRes('S1', 'VR01', '2026-09-10', '2026-09-10', 'Confirmed')];
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.equal(d.series[0].booked, 0);
    assert.equal(d.series[0].available, 6);
  });
  test('a cancelled reservation is excluded entirely', () => {
    sandbox.RES = [mkRes('C1', 'VR01', '2026-09-10', '2026-09-12', 'Cancelled')];
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.equal(d.series[0].booked, 0);
  });
  test('a partner-property reservation (room not in VR) never appears in the series', () => {
    sandbox.RES = [Object.assign(mkRes('P1', 'Room 1', '2026-09-10', '2026-09-12', 'Confirmed'), { prop: 'hb' })];
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.equal(d.series[0].booked, 0);
    assert.equal(d.series[0].available, 6);
  });
  test('a room block counts as blocked, not booked, and reduces available -- never double-counted with a reservation on a different room', () => {
    sandbox.RES = [mkRes('R1', 'VR01', '2026-09-10', '2026-09-13', 'Confirmed')];
    sandbox.BLK = [{ id: 'B1', rn: 'VR02', from: '2026-09-10', to: '2026-09-11' }];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.deepEqual(plain(d.series[0]), { date: '2026-09-10', booked: 1, blocked: 1, available: 4 });
  });
  test('a multi-room booking (two reservations, two rooms, same guest) counts each room independently, no double-count', () => {
    sandbox.RES = [
      mkRes('M1', 'VR01', '2026-09-10', '2026-09-12', 'Confirmed'),
      mkRes('M2', 'VR02', '2026-09-10', '2026-09-12', 'Confirmed'),
    ];
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.equal(d.series[0].booked, 2);
  });
  test('sellable room nights excludes blocked room nights from the occupancy denominator (Step 3 formula)', () => {
    sandbox.RES = [mkRes('R2', 'VR01', '2026-09-10', '2026-09-11', 'Confirmed')];
    sandbox.BLK = [{ id: 'B2', rn: 'VR02', from: '2026-09-10', to: '2026-09-11' }];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    // 6 rooms x 1 night = 6 total; 1 blocked -> 5 sellable; 1 booked -> 1/5 = 20%
    assert.equal(d.sellableRoomNights, 5);
    assert.equal(d.bookedRoomNights, 1);
    assert.equal(Math.round(d.occupancyPct), 20);
  });
}

section('Case C — ADR / RevPAR: room revenue only, never Green Tax/TGST/service (Step 5)');
{
  test('ADR = room revenue / booked room nights, excludes taxes entirely', () => {
    sandbox.RES = [mkRes('A1', 'VR01', '2026-09-10', '2026-09-11', 'Confirmed', { rate: 80, ad: 2 })];
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    // calcTax's base for 1 night @ $80, 2 adults = $80 exactly (no 3rd-guest supplement, no taxes)
    assert.equal(d.roomRevenue, 80);
    assert.equal(d.bookedRoomNights, 1);
    assert.equal(d.adr, 80);
  });
  test('RevPAR = room revenue / sellable room nights = ADR x occupancy fraction', () => {
    sandbox.RES = [mkRes('A2', 'VR01', '2026-09-10', '2026-09-11', 'Confirmed', { rate: 80, ad: 2 })];
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    // 6 sellable room nights, $80 revenue -> revpar = 80/6
    assert.ok(Math.abs(d.revpar - 80 / 6) < 0.001);
    assert.ok(Math.abs(d.revpar - d.adr * (d.occupancyPct / 100)) < 0.01);
  });
  test('zero bookings in range -> ADR/RevPAR/revenue are all 0, never NaN or a crash', () => {
    sandbox.RES = []; sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-10');
    assert.equal(d.adr, 0);
    assert.equal(d.revpar, 0);
    assert.equal(d.roomRevenue, 0);
  });
}

section('Case D — date navigation matches the real Cloudbeds arrows exactly (1-day shift, not a full-period jump)');
{
  test('fcRangeLabel formats a human range using Maldives date formatting', () => {
    assert.match(sandbox.fcRangeLabel('2026-09-10', '2026-09-23'), /Sept?/);
  });
  test('the deployed fcShiftRange() source shifts both FC_FROM and FC_TO by the same delta, not the range length', () => {
    const src = extractByStart(PMS, /function fcShiftRange\(deltaDays\)\s*\{/);
    assert.match(src, /D2\(FC_FROM,deltaDays\)/);
    assert.match(src, /D2\(FC_TO,deltaDays\)/);
  });
}

section('Case E — Booked & blocked is a chart, Availability is a table (matches the real Cloudbeds UI exactly, not a second chart)');
{
  test('fcRenderChart() renders an <svg> line chart', () => {
    sandbox.RES = [mkRes('CH1', 'VR01', '2026-09-10', '2026-09-13', 'Confirmed')];
    sandbox.BLK = [];
    const d = sandbox.fcComputeData('2026-09-10', '2026-09-12');
    const html = sandbox.fcRenderChart(d);
    assert.match(html, /<svg/);
    assert.match(html, /<path/);
  });
  test('the Y axis auto-scales to the data (never hardcoded to a fixed 0-100% range)', () => {
    const src = extractByStart(PMS, /function fcNiceMax\(v\)\s*\{/);
    assert.match(src, /steps/);
    const chartSrc = extractByStart(PMS, /function fcRenderChart\(d\)\s*\{/);
    assert.match(chartSrc, /fcNiceMax\(/);
  });
  test('fcRenderAvailabilityTable() renders a <table>, grouped by accommodation type -- not a chart', () => {
    sandbox.RES = [];
    sandbox.BLK = [];
    const html = sandbox.fcRenderAvailabilityTable('2026-09-10', '2026-09-11');
    assert.match(html, /<table/);
    assert.doesNotMatch(html, /<svg/);
    assert.match(html, /Deluxe Family Room/);
    assert.match(html, /Double Room/);
  });
  test('an availability cell showing 0 is visually flagged (fc-avail-zero), matching Cloudbeds\' red-highlighted zero cells', () => {
    sandbox.RES = VR.filter(vr => vr.type === 'Double Room').map((vr, i) => mkRes('Z' + i, vr.n, '2026-09-10', '2026-09-11', 'Confirmed'));
    const html = sandbox.fcRenderAvailabilityTable('2026-09-10', '2026-09-10');
    assert.match(html, /fc-avail-zero/);
  });
}

section('Case F — Forecast wiring: clickable tabs/nav, in-place (no page reload), Maldives date basis');
{
  test('drawDash() calls drawForecast() -- the Forecast panel refreshes whenever the rest of the Dashboard does', () => {
    const src = extractByStart(PMS, /function drawDash\(\)\s*\{/);
    assert.match(src, /drawForecast\(\)/);
  });
  test('fcSetTab() switches in place (re-renders #fc-body) rather than navigating away', () => {
    const src = extractByStart(PMS, /function fcSetTab\(tab\)\s*\{/);
    assert.match(src, /drawForecast\(\)/);
    assert.doesNotMatch(src, /go\(/);
  });
  test('drawForecast() defaults FC_FROM/FC_TO to tS/D(13) -- the same Maldives-derived "today" the rest of the Dashboard uses, a 14-day default range matching Cloudbeds\' own', () => {
    const src = extractByStart(PMS, /function drawForecast\(\)\s*\{/);
    assert.match(src, /FC_FROM=tS/);
    assert.match(src, /FC_TO=D\(13\)/);
  });
}

console.log(`\n${passed}/${passed + failed} forecast-panel assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
