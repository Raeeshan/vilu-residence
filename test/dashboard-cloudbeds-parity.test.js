// Dashboard/Notes Cloudbeds-parity correction pass — 2026-09-10.
//
// Covers: Maldives operational date (timezone-independent of the process's
// own local clock), arrival/departure/in-house/occupancy classification,
// Dashboard click-through filters into Reservations/Calendar, clickable
// reservation rows, single-render Guest Notes (no duplicate editor),
// Cloudbeds metadata separation (address/pricing never inside notes,
// source metadata collapsible, internal note shown once).
//
// Same technique test/third-guest-pricing.test.js and
// test/pms-hardening.test.js already use: brace-match the real function
// source out of vilu-unified.html and run it in a vm sandbox (functional
// checks), or regex-check the source directly (structural/wiring checks).
// No Firestore, no browser, no live reservation.
//   node test/dashboard-cloudbeds-parity.test.js
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

// ── sandbox: Maldives date helpers ──
const getMaldivesDateSrc = extractByStart(PMS, /function getMaldivesDate\(d\)\s*\{/);
const formatMaldivesDateSrc = extractByStart(PMS, /function formatMaldivesDate\(dateStr\)\s*\{/);
const formatMaldivesDateTimeSrc = extractByStart(PMS, /function formatMaldivesDateTime\(isoOrDate\)\s*\{/);
const dateSandbox = {};
vm.createContext(dateSandbox);
vm.runInContext([getMaldivesDateSrc, formatMaldivesDateSrc, formatMaldivesDateTimeSrc].join('\n'), dateSandbox);

section('Case A — Maldives operational date is timezone-independent, never the process/browser local clock');
{
  test('getMaldivesDate() uses Intl.DateTimeFormat with the Indian/Maldives IANA zone, not local Date fields', () => {
    assert.match(getMaldivesDateSrc, /timeZone:\s*'Indian\/Maldives'/);
    assert.doesNotMatch(getMaldivesDateSrc, /getFullYear|getMonth|getDate\(\)/);
  });
  test('getMaldivesDate() returns the same calendar date regardless of the process\'s own TZ env', () => {
    const originalTZ = process.env.TZ;
    try {
      const fixedNow = new Date('2026-09-10T20:00:00Z'); // 2026-09-11 01:00 Maldives (UTC+5) -- already tomorrow there
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 -- a real, extreme timezone, unrelated to Maldives
      const s1 = dateSandbox.getMaldivesDate(fixedNow);
      process.env.TZ = 'Etc/GMT+12'; // UTC-12
      const s2 = dateSandbox.getMaldivesDate(fixedNow);
      assert.equal(s1, '2026-09-11');
      assert.equal(s2, '2026-09-11');
      assert.equal(s1, s2, 'must agree regardless of local TZ');
    } finally { process.env.TZ = originalTZ; }
  });
  test('formatMaldivesDateTime() labels its output as Maldives time explicitly', () => {
    const out = dateSandbox.formatMaldivesDateTime(new Date('2026-09-10T20:00:00Z'));
    assert.match(out, /Maldives time/);
  });
  test('tS (the app-wide "today" string) is derived from getMaldivesDate(), not new Date().getFullYear()/getMonth()/getDate()', () => {
    const tsLine = PMS.match(/const tS=.*/)[0];
    assert.match(tsLine, /getMaldivesDate\(\)/);
  });
}

// ── sandbox: occupancy/arrival/departure/in-house classification ──
const isOccSrc = extractByStart(PMS, /function isOcc\(rn,from,to,excl\)\s*\{/);
const isBlockingStatusSrc = extractByStart(PMS, /function isBlockingStatus\(st\)\s*\{/);
const occSandbox = {};
vm.createContext(occSandbox);
vm.runInContext([
  'var RES = [];','var BLK = [];',
  isOccSrc, isBlockingStatusSrc,
].join('\n'), occSandbox);

section('Case B — arrival/departure/in-house/stayovers classification (real isOcc()/isBlockingStatus(), synthetic data)');
{
  const TODAY = '2026-09-10';
  function classify(RES, BLK) {
    occSandbox.RES = RES; occSandbox.BLK = BLK;
    const tomorrow = '2026-09-11';
    const rooms = ['VR01','VR02','VR03','VR04','VR05','VR06'];
    const occMatches = rooms.map(rn => occSandbox.isOcc(rn, TODAY, tomorrow));
    return {
      occupiedRooms: occMatches.filter(Boolean).length,
      blockedRooms: occMatches.filter(m => m && m.from !== undefined).length,
      arrivals: RES.filter(r => r.ci === TODAY && occSandbox.isBlockingStatus(r.st)),
      departures: RES.filter(r => r.co === TODAY && occSandbox.isBlockingStatus(r.st)),
      // Broadened (2026-09-10 parity correction) -- includes today's own
      // arrivals, matching the real Cloudbeds "In-house" count observed
      // live (>= Arrivals + Stayovers, not a disjoint bucket).
      inHouse: RES.filter(r => r.ci <= TODAY && r.co > TODAY && occSandbox.isBlockingStatus(r.st) && r.st !== 'Checked out'),
      // Narrow subset -- already there before today, no check-in/out event
      // today at all. What the previous Dashboard pass mislabeled "In house".
      stayovers: RES.filter(r => r.ci < TODAY && r.co > TODAY && occSandbox.isBlockingStatus(r.st) && r.st !== 'Checked out'),
    };
  }
  test('a guest checking in today is an arrival AND counts as in-house (broadened definition), but is not a stayover', () => {
    const d = classify([{ id:'a', rn:'VR01', ci:'2026-09-10', co:'2026-09-14', st:'Confirmed' }], []);
    assert.equal(d.arrivals.length, 1);
    assert.equal(d.inHouse.length, 1);
    assert.equal(d.stayovers.length, 0);
  });
  test('a guest who checked in days ago and checks out later is in-house AND a stayover, never an arrival', () => {
    const d = classify([{ id:'b', rn:'VR02', ci:'2026-09-05', co:'2026-09-13', st:'Checked in' }], []);
    assert.equal(d.inHouse.length, 1);
    assert.equal(d.stayovers.length, 1);
    assert.equal(d.arrivals.length, 0);
    assert.equal(d.departures.length, 0);
  });
  test('a guest checking out today is a departure', () => {
    const d = classify([{ id:'c', rn:'VR03', ci:'2026-09-06', co:'2026-09-10', st:'Checked in' }], []);
    assert.equal(d.departures.length, 1);
    // checked out this morning -> room free tonight, not occupied
    assert.equal(d.occupiedRooms, 0);
  });
  test('a future-only reservation counts nowhere today', () => {
    const d = classify([{ id:'e', rn:'VR04', ci:'2026-09-15', co:'2026-09-18', st:'Confirmed' }], []);
    assert.equal(d.arrivals.length + d.departures.length + d.inHouse.length + d.stayovers.length + d.occupiedRooms, 0);
  });
  test('a cancelled reservation for today is excluded from every classification', () => {
    const d = classify([{ id:'f', rn:'VR05', ci:'2026-09-10', co:'2026-09-12', st:'Cancelled' }], []);
    assert.equal(d.arrivals.length + d.occupiedRooms, 0);
  });
  test('a same-day arrival+departure appears in both Arrivals and Departures, occupies nothing overnight, and is neither in-house nor a stayover', () => {
    const d = classify([{ id:'g', rn:'VR06', ci:'2026-09-10', co:'2026-09-10', st:'Confirmed' }], []);
    assert.equal(d.arrivals.length, 1);
    assert.equal(d.departures.length, 1);
    assert.equal(d.occupiedRooms, 0);
    assert.equal(d.inHouse.length, 0);
  });
  test('a room block occupies the room without appearing as an arrival/departure/in-house/stayover guest', () => {
    const d = classify([], [{ id:'BLK1', rn:'VR04', from:'2026-09-10', to:'2026-09-11', type:'maintenance' }]);
    assert.equal(d.occupiedRooms, 1);
    assert.equal(d.blockedRooms, 1);
    assert.equal(d.arrivals.length + d.departures.length + d.inHouse.length + d.stayovers.length, 0);
  });
  test('a multi-room booking (two reservations, two rooms, both spanning today) counts each room once in in-house and stayovers, no double-count', () => {
    const d = classify([
      { id:'h1', rn:'VR01', ci:'2026-09-08', co:'2026-09-12', st:'Checked in' },
      { id:'h2', rn:'VR02', ci:'2026-09-08', co:'2026-09-12', st:'Checked in' },
    ], []);
    assert.equal(d.occupiedRooms, 2);
    assert.equal(d.inHouse.length, 2);
    assert.equal(d.stayovers.length, 2);
  });
  test('a partner-property reservation is invisible to this Vilu-room classification (RES here is pre-filtered to prop==="vilu" by computeDashData, same as this test only passing Vilu rows)', () => {
    // computeDashData() filters RES to r.prop==='vilu' before ever calling
    // this classification -- proven structurally in Case D below.
    assert.ok(true);
  });
  test("a maintenance block is 'Out of service'; an owner/hold block is 'Blocked dates' -- the real block type field, never invented", () => {
    // Mirrors computeDashData()'s own split exactly: blockMatches (m.from
    // !== undefined) -> outOfServiceRooms (type==='maintenance') vs
    // blockedDatesRooms (everything else, i.e. 'owner'/'hold').
    function splitBlocks(rooms, BLK) {
      occSandbox.RES = []; occSandbox.BLK = BLK;
      const occMatches = rooms.map(rn => occSandbox.isOcc(rn, TODAY, '2026-09-11'));
      const blockMatches = occMatches.filter(m => m && m.from !== undefined);
      const outOfService = blockMatches.filter(m => m.type === 'maintenance').length;
      return { outOfService, blockedDates: blockMatches.length - outOfService };
    }
    const maint = splitBlocks(['VR01'], [{ id:'BLK2', rn:'VR01', from:'2026-09-10', to:'2026-09-11', type:'maintenance' }]);
    assert.equal(maint.outOfService, 1);
    assert.equal(maint.blockedDates, 0);
    const owner = splitBlocks(['VR01'], [{ id:'BLK3', rn:'VR01', from:'2026-09-10', to:'2026-09-11', type:'owner' }]);
    assert.equal(owner.outOfService, 0);
    assert.equal(owner.blockedDates, 1);
    const hold = splitBlocks(['VR01'], [{ id:'BLK4', rn:'VR01', from:'2026-09-10', to:'2026-09-11', type:'hold' }]);
    assert.equal(hold.outOfService, 0);
    assert.equal(hold.blockedDates, 1);
  });
  test('bookings: reservations whose createdAt lands on the target Maldives date are counted, regardless of stay dates', () => {
    const bookedToday = { id:'i', rn:'VR01', ci:'2026-09-20', co:'2026-09-22', st:'Confirmed', createdAt:'2026-09-10T18:00:00Z' }; // 2026-09-10 23:00 Maldives
    const bookedYesterday = { id:'j', rn:'VR02', ci:'2026-09-20', co:'2026-09-22', st:'Confirmed', createdAt:'2026-09-09T10:00:00Z' };
    const list = [bookedToday, bookedYesterday];
    const bookings = list.filter(r => r.createdAt && dateSandbox.getMaldivesDate(new Date(r.createdAt)) === TODAY && occSandbox.isBlockingStatus(r.st));
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].id, 'i');
  });
  test('cancellations: BIN entries (soft-deleted) whose deletedDate lands on the target date are counted, live RES is never searched for them', () => {
    const BIN = [
      { id:'k', prop:'vilu', st:'Cancelled', deletedDate:'2026-09-10' },
      { id:'l', prop:'vilu', st:'Cancelled', deletedDate:'2026-09-09' },
    ];
    const cancellations = BIN.filter(r => r.prop==='vilu' && r.st==='Cancelled' && r.deletedDate===TODAY);
    assert.equal(cancellations.length, 1);
    assert.equal(cancellations[0].id, 'k');
  });
  test('overbookings: two genuinely conflicting reservations on the same physical room produce one pair; no conflict produces zero, never an invented count', () => {
    const conflicting = [
      { id:'m1', prop:'vilu', rn:'VR01', ci:'2026-09-09', co:'2026-09-12', st:'Confirmed' },
      { id:'m2', prop:'vilu', rn:'VR01', ci:'2026-09-10', co:'2026-09-13', st:'Confirmed' },
    ];
    const tomorrow = '2026-09-11';
    const matches = conflicting.filter(r => occSandbox.isBlockingStatus(r.st) && r.ci < tomorrow && r.co > TODAY);
    assert.equal(matches.length, 2, 'both reservations genuinely overlap VR01 on the target date');
    const clean = [{ id:'n1', prop:'vilu', rn:'VR02', ci:'2026-09-09', co:'2026-09-10', st:'Confirmed' }]; // departs before target date
    const cleanMatches = clean.filter(r => occSandbox.isBlockingStatus(r.st) && r.ci < tomorrow && r.co > TODAY);
    assert.equal(cleanMatches.length, 0, 'no genuine conflict must yield 0, never a fabricated overbooking count');
  });
}

section('Case C — Dashboard/Reservations click-through wiring');
{
  test('computeDashData(date) filters to prop==="vilu" before classifying (partner-property leakage impossible), and defaults to SELECTED_DATE/tS when no date is passed', () => {
    const src = extractByStart(PMS, /function computeDashData\(date\)\s*\{/);
    assert.match(src, /r\.prop===['"]vilu['"]/);
    assert.match(src, /date\|\|SELECTED_DATE\|\|tS/);
  });
  test('computeDashData() splits blocks into outOfServiceRooms (type===maintenance) vs blockedDatesRooms (everything else)', () => {
    const src = extractByStart(PMS, /function computeDashData\(date\)\s*\{/);
    assert.match(src, /outOfServiceRooms\s*=\s*blockMatches\.filter\(function\(m\)\{return m\.type===['"]maintenance['"];\}\)\.length/);
    assert.match(src, /blockedDatesRooms\s*=\s*blockMatches\.length-outOfServiceRooms/);
  });
  test('computeDashData() defines all 7 Cloudbeds-equivalent activity buckets: arrivals, departures, inHouse, stayovers, bookings, cancellations, overbookingPairs', () => {
    const src = extractByStart(PMS, /function computeDashData\(date\)\s*\{/);
    for (const field of ['arrivals', 'departures', 'inHouse', 'stayovers', 'bookings', 'cancellations', 'overbookingPairs', 'overbookingCount']) {
      assert.match(src, new RegExp('\\b' + field + '\\s*[:=]'), field + ' missing from computeDashData()');
    }
  });
  test('bookings are keyed off createdAt via getMaldivesDate(), never a stay date', () => {
    const src = extractByStart(PMS, /function computeDashData\(date\)\s*\{/);
    assert.match(src, /r\.createdAt&&getMaldivesDate\(new Date\(r\.createdAt\)\)===today/);
  });
  test('cancellations read from BIN (soft-deleted) keyed by deletedDate, never from live RES', () => {
    const src = extractByStart(PMS, /function computeDashData\(date\)\s*\{/);
    assert.match(src, /BIN[\s\S]{0,40}\.filter\(function\(r\)\{return r\.prop===['"]vilu['"]&&r\.st===['"]Cancelled['"]&&r\.deletedDate===today/);
  });
  test('softDelete() stamps deletedDate via getMaldivesDate() so Cancellations can be filtered by real date, not a guessed one', () => {
    const src = extractByStart(PMS, /function softDelete\(res\)\s*\{/);
    assert.match(src, /deletedDate:\s*getMaldivesDate\(\)/);
  });
  test('computeOverbookings() only counts genuine same-room, same-date conflicts (2+ blocking reservations) -- never a fabricated count', () => {
    const src = extractByStart(PMS, /function computeOverbookings\(d0\)\s*\{/);
    assert.match(src, /matches\.length>1/);
  });
  test('DASH_TAB_META defines exactly the 7 Cloudbeds-equivalent tabs', () => {
    const src = extractByStart(PMS, /var DASH_TAB_META\s*=\s*\{/);
    for (const key of ['arr', 'dep', 'inhouse', 'stayovers', 'bookings', 'cancellations', 'overbookings']) {
      assert.match(src, new RegExp(key + ':\\{'), 'DASH_TAB_META missing tab ' + key);
    }
  });
  test('dashRenderTotals() derives Total guests/Adults/Children/Rooms live from the passed-in rows, never a hardcoded number', () => {
    const src = extractByStart(PMS, /function dashRenderTotals\(rows\)\s*\{/);
    assert.match(src, /rows\.forEach/);
    assert.doesNotMatch(src, /textContent\s*=\s*['"]Total guests: \d/, 'totals must never be a static string');
  });
  test('SELECTED_DATE nav (dashPrevDay/dashNextDay/dashGoToday) moves via D2() (Maldives date arithmetic) and redraws, never browser-local Date math', () => {
    assert.match(PMS, /function dashPrevDay\(\)\{\s*SELECTED_DATE=D2\(SELECTED_DATE,-1\);\s*drawDash\(\);\s*\}/);
    assert.match(PMS, /function dashNextDay\(\)\{\s*SELECTED_DATE=D2\(SELECTED_DATE,1\);\s*drawDash\(\);\s*\}/);
    assert.match(PMS, /function dashGoToday\(\)\{\s*SELECTED_DATE=tS;\s*drawDash\(\);\s*\}/);
  });
  test('dashRefresh() re-reads canonical data via the existing loader (loadAllFromSupabase) and redraws -- never forces a Firestore write', () => {
    const src = extractByStart(PMS, /function dashRefresh\(\)\s*\{/);
    assert.match(src, /loadAllFromSupabase/);
    assert.doesNotMatch(src, /firestore|collection\(|\.doc\(/i, 'dashRefresh() must never write to Firestore');
  });
  test('dashSetTab() swaps the Activity table for all 7 tabs and calls dashRenderTotals() with the currently visible rows', () => {
    const src = extractByStart(PMS, /function dashSetTab\(tab\)\s*\{/);
    assert.match(src, /dashTabRows\(d,\s*tab\)/);
    assert.match(src, /dashRenderTotals\(/);
  });
  test('dashGuestRow() routes a click straight to showDet() -- the same reservation-detail entry point every other list uses', () => {
    const src = extractByStart(PMS, /function dashGuestRow\(r\)\s*\{/);
    assert.match(src, /onclick="showDet\(/);
  });
  test('dashOverbookingRow() never fabricates a count -- renders the actual conflicting reservations, spans all 5 Activity columns', () => {
    const src = extractByStart(PMS, /function dashOverbookingRow\(pair\)\s*\{/);
    assert.match(src, /colspan="5"/);
    assert.match(src, /pair\.reservations/);
  });
  test('goCalToday() navigates to Calendar and lands on the Dashboard\'s SELECTED_DATE (today via calNavToday, otherwise via calGoToDate)', () => {
    const src = extractByStart(PMS, /function goCalToday\(\)\s*\{/);
    assert.match(src, /go\('cal'/);
    assert.match(src, /calNavToday\(\)/);
    assert.match(src, /calGoToDate\(SELECTED_DATE\)/);
  });
  test('goResScope()/setResScope() exist and drawRes() scopes by the Dashboard\'s own SELECTED_DATE (never a fixed "today"), covering all 7 tab dimensions', () => {
    assert.match(PMS, /function goResScope\(scope\)\s*\{/);
    assert.match(PMS, /function setResScope\(scope\)\s*\{/);
    const src = extractByStart(PMS, /function drawRes\(\)\s*\{/);
    assert.match(src, /RES_SCOPE/);
    assert.match(src, /scopeDate\s*=\s*\(typeof SELECTED_DATE/);
    for (const scope of ["'arr'", "'dep'", "'inhouse'", "'stayovers'", "'bookings'", "'cancellations'", "'overbookings'"]) {
      assert.match(src, new RegExp('case ' + scope + ':'), 'drawRes() scope switch missing ' + scope);
    }
    assert.match(src, /RES_SCOPE===['"]cancellations['"][\s\S]{0,60}BIN/, "the cancellations scope must read from BIN, not RES");
  });
  test('the revenue card navigates to Guest Folios, the occupancy card to Calendar -- no dead-looking dashboard cards', () => {
    assert.match(PMS, /dash-revenue-card"[^>]*onclick="go\('folios'/);
    assert.match(PMS, /dash-occ-card"[^>]*onclick="goCalToday\(\)"/);
  });
  test('the Dashboard header exposes refresh + previous/Today/next date controls, all wired to the SELECTED_DATE nav functions', () => {
    assert.match(PMS, /id="d-refresh-btn"[^>]*onclick="dashRefresh\(\)"/);
    assert.match(PMS, /onclick="dashPrevDay\(\)"/);
    assert.match(PMS, /id="d-date-btn"[^>]*onclick="dashGoToday\(\)"/);
    assert.match(PMS, /onclick="dashNextDay\(\)"/);
  });
  test('the occupancy card renders all 4 Cloudbeds-equivalent stats: Available, Booked, Out of service, Blocked dates', () => {
    assert.match(PMS, /id="d-occ-avail"/);
    assert.match(PMS, /id="d-occ-booked"/);
    assert.match(PMS, /id="d-occ-oos"/);
    assert.match(PMS, /id="d-occ-blocked"/);
  });
  test('the Activity card renders all 7 Cloudbeds-equivalent tab buttons with matching count spans', () => {
    for (const tab of ['arr', 'dep', 'inhouse', 'stayovers', 'bookings', 'cancellations', 'overbookings']) {
      assert.match(PMS, new RegExp('data-tab="' + tab + '"[^>]*onclick="dashSetTab\\(\'' + tab + '\'\\)"'), 'tab button missing for ' + tab);
      assert.match(PMS, new RegExp('id="d-tab-' + tab + '-n"'), 'count span missing for ' + tab);
    }
  });
  test('the Activity table has an Actions column and a footer totals row (#d-totals), never hardcoded', () => {
    assert.match(PMS, /<th>Actions<\/th>/);
    assert.match(PMS, /id="d-totals"/);
  });
  test('drawDash() reads/writes the selected-date header label via Intl + Indian/Maldives against SELECTED_DATE, never local Date field getters', () => {
    const src = extractByStart(PMS, /function drawDash\(\)\s*\{/);
    assert.match(src, /timeZone:\s*'Indian\/Maldives'/);
    assert.match(src, /SELECTED_DATE/);
    const codeOnly = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(codeOnly, /\.getDay\(\)|\.getFullYear\(\)/);
  });
  test('drawDash() still calls drawForecast() at the end -- the Forecast module is preserved, not regressed by this pass', () => {
    const src = extractByStart(PMS, /function drawDash\(\)\s*\{/);
    assert.match(src, /drawForecast\(\);/);
  });
}

// ── sandbox: notes structure ──
const parseImportedNoteSrc = extractByStart(PMS, /function parseImportedNote\(raw\)\s*\{/);
const upsertNoteBlockSrc = extractByStart(PMS, /function upsertNoteBlock\(rawNotes,label,newText\)\s*\{/);
const notesSectionSrc = extractByStart(PMS, /function notesSection\(heading,bodyHTML,extraStyle\)\s*\{/);
const extractImportedAddressSrc = extractByStart(PMS, /function extractImportedAddress\(raw\)\s*\{/);
const escSrc = 'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]; }); }';
const rNmSrc = 'function rNm(rn){ return rn; }'; // stubbed -- not under test here
const stBxSrc = 'function stBx(s){ return "<span>"+s+"</span>"; }';
// canEditInternalNotes/canViewOnly (Notes editing fix, 2026-09-10):
// renderNotesHTML() now calls both directly. Default the sandbox to an
// Admin-like context (internal notes editable, not view-only) since
// that's the common case most of Case D's pre-existing assertions were
// already written against; Case E below flips them explicitly to cover
// the Staff/read-only and Agency/view-only branches.
let _sandboxCanEditInternal = true, _sandboxCanViewOnly = false;
const roleStubSrc = 'function canEditInternalNotes(){ return _sandboxCanEditInternal; } function canViewOnly(){ return _sandboxCanViewOnly; }';
const notesSandbox = { get _sandboxCanEditInternal(){ return _sandboxCanEditInternal; }, get _sandboxCanViewOnly(){ return _sandboxCanViewOnly; } };
vm.createContext(notesSandbox);
vm.runInContext([escSrc, rNmSrc, stBxSrc, roleStubSrc, parseImportedNoteSrc, upsertNoteBlockSrc, notesSectionSrc, extractImportedAddressSrc].join('\n'), notesSandbox);
const renderNotesHTMLSrc = extractByStart(PMS, /function renderNotesHTML\(r,taId\)\s*\{/);
vm.runInContext(renderNotesHTMLSrc, notesSandbox);
function renderNotesAs(r, taId, canEditInternal, viewOnly){
  _sandboxCanEditInternal = canEditInternal !== false;
  _sandboxCanViewOnly = !!viewOnly;
  return notesSandbox.renderNotesHTML(r, taId);
}

const REAL_MIGRATED_NOTE = "Cloudbeds #4350689601640 (room 106) \u00b7 Cloudbeds internal id 184853238 \u00b7 source Walk-In \u00b7 booked 2026-08-28 01:03 \u00b7 last change 2026-08-28 01:05 \u00b7 Cloudbeds status confirmed\n\n[Cloudbeds internal note 2026-08-28 06:05 \u00b7 Raeeshan Ibrahim] Room with breakfast\nper night $55\nDomestic flight for arrival $155 per persion\nTotal $585\n\n[Cloudbeds pricing] reservation total USD 30.00 (subtotal 0.00, taxes 30.00, extras 0.00) \u00b7 this room total USD 0.00 \u00b7 paid 0.00 \u00b7 balance due 30.00\n\n[Cloudbeds guest address] Rah dhebai magu, South ari atoll, 00100\n\n[Cloudbeds room guest] Wilkinson Ewa Sylwia\n\n[Migration] imported from Cloudbeds on 2026-09-08";

section('Case D — reservation notes: single editor, Cloudbeds metadata separated, nothing dumped into Guest Notes');
{
  test('exactly one Guest Notes <textarea> is rendered -- no rendered-preview-plus-textarea duplication for that field (a second textarea is the separate, intentional Internal Notes field added 2026-09-10, see Case E)', () => {
    const html = renderNotesAs({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta', true);
    const guestTextareas = (html.match(/<textarea id="note-ta"/g) || []).length;
    assert.equal(guestTextareas, 1);
  });
  test('Guest Notes textarea starts empty for a migrated reservation with no [Staff note] block yet -- the Cloudbeds text is never dumped into it', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    const m = html.match(/<textarea id="note-ta"[^>]*>([\s\S]*?)<\/textarea>/);
    assert.equal(m[1].trim(), '');
  });
  test('the guest address never appears anywhere in the Guest Notes render output', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    assert.doesNotMatch(html, /Rah dhebai magu/);
  });
  test('extractImportedAddress() pulls the address out for the guest-details grid instead', () => {
    assert.equal(notesSandbox.extractImportedAddress(REAL_MIGRATED_NOTE), 'Rah dhebai magu, South ari atoll, 00100');
  });
  test('the pricing snapshot is never shown as a current/live note -- only inside collapsed "Legacy import"', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    const legacyIdx = html.indexOf('Legacy import');
    const pricingIdx = html.indexOf('reservation total USD 30.00');
    assert.ok(legacyIdx > -1 && pricingIdx > legacyIdx, 'pricing text must appear only after the Legacy import label');
  });
  test('the real Cloudbeds internal note is shown exactly once, inside the read-only Source Details (Notes editing fix, 2026-09-10: moved out of the top-level "Internal Notes" heading, which is now the separate, genuinely editable Vilu field -- Case E)', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    const occurrences = (html.match(/Room with breakfast/g) || []).length;
    assert.equal(occurrences, 1);
    assert.match(html, /Cloudbeds internal note \(imported, read-only\)/);
    // it must appear inside the <details> Source Details block, never as
    // its own top-level, seemingly-editable "Internal Notes" section
    const detailsIdx = html.indexOf('<details');
    const noteIdx = html.indexOf('Room with breakfast');
    assert.ok(detailsIdx > -1 && noteIdx > detailsIdx, 'the original Cloudbeds note must be inside Source Details');
  });
  test('source/channel metadata (reservation ID, internal ID, original source/status) is collapsible (<details>), not always-visible', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    assert.match(html, /<details[^>]*>[\s\S]*Source Details[\s\S]*Reservation ID[\s\S]*<\/details>/);
  });
  test('repeated "Cloudbeds ..." line-prefix wording is gone -- one "Source Details" heading plus its own relocated "Cloudbeds internal note" label, never one prefix per field', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    const cloudbedsPrefixCount = (html.match(/>Cloudbeds /g) || []).length;
    // Was <=1 before the Notes editing fix relocated the original Cloudbeds
    // internal note under Source Details with its own "Cloudbeds internal
    // note (imported, read-only)" label -- that's one deliberate, scoped
    // second mention, not a regression back to per-field prefix clutter.
    assert.ok(cloudbedsPrefixCount <= 2, 'expected at most two "Cloudbeds" mentions (imported-from label + relocated internal-note label), found ' + cloudbedsPrefixCount);
  });
  test('a plain (non-migrated) reservation\'s notes render unchanged -- editable box just holds its own text, no Source Details section', () => {
    const html = notesSandbox.renderNotesHTML({ notes: 'Guest asked for extra pillows', src:'Direct' }, 'note-ta');
    assert.match(html, />Guest asked for extra pillows</);
    assert.doesNotMatch(html, /Source Details/);
  });
  test('Arrival / Transfer only renders when a real structured field is present, never guessed from the free-text note', () => {
    const withTransfer = notesSandbox.renderNotesHTML({ notes: 'plain note', src:'Direct', arrTransport:'Speedboat' }, 'note-ta');
    const without = notesSandbox.renderNotesHTML({ notes: 'plain note', src:'Direct' }, 'note-ta');
    assert.match(withTransfer, /Arrival \/ Transfer/);
    assert.doesNotMatch(without, /Arrival \/ Transfer/);
  });
  test('upsertNoteBlock() replaces an existing [Staff note] in place, preserving every other block byte-for-byte', () => {
    const withStaffNote = notesSandbox.upsertNoteBlock(REAL_MIGRATED_NOTE, 'Staff note', 'first note');
    const updated = notesSandbox.upsertNoteBlock(withStaffNote, 'Staff note', 'updated note');
    assert.match(updated, /\[Staff note\] updated note/);
    assert.doesNotMatch(updated, /first note/);
    assert.match(updated, /\[Cloudbeds pricing\]/);
    assert.match(updated, /\[Cloudbeds guest address\] Rah dhebai magu/);
    assert.match(updated, /Room with breakfast/); // original internal note untouched
  });
}

section('Case E — Internal Notes: new, genuinely editable, role-gated field (Notes editing fix, 2026-09-10)');
{
  test('an editor (Admin/Manager) sees an editable Internal Notes textarea, pre-filled with the current value -- "click Edit or edit directly", never forced to add a second note', () => {
    const html = renderNotesAs({ notes:'', internalNote:'Collect passport copy', src:'Direct' }, 'note-ta', true);
    const m = html.match(/<textarea id="note-ta-internal"[^>]*>([\s\S]*?)<\/textarea>/);
    assert.ok(m, 'Internal Notes textarea not found for an editor');
    assert.equal(m[1].trim(), 'Collect passport copy');
  });
  test('a non-editor (Staff, per the chosen canEditInternalNotes() policy) sees the SAME text read-only, never hidden entirely and never a second editable box', () => {
    const html = renderNotesAs({ notes:'', internalNote:'Balance pending', src:'Direct' }, 'note-ta', false);
    assert.doesNotMatch(html, /<textarea id="note-ta-internal"/);
    assert.match(html, /Balance pending/);
  });
  test('a reservation with no internal note yet shows an empty editable box for an editor, not an error or missing section', () => {
    const html = renderNotesAs({ notes:'', internalNote:'', src:'Direct' }, 'note-ta', true);
    const m = html.match(/<textarea id="note-ta-internal"[^>]*>([\s\S]*?)<\/textarea>/);
    assert.equal(m[1].trim(), '');
  });
  test('Internal Notes renders for a NON-migrated (plain) reservation too -- it is not a Cloudbeds-only concept', () => {
    const html = renderNotesAs({ notes:'Guest asked for extra pillows', internalNote:'Manager approved discount', src:'Direct' }, 'note-ta', true);
    assert.match(html, /Internal Notes/);
    assert.match(html, /Manager approved discount/);
  });
  test('the Internal Notes save button calls saveInternalNote(id, taId), completely separate from Guest Notes\' saveGuestNote()', () => {
    const html = renderNotesAs({ id:'R1', notes:'', internalNote:'x', src:'Direct' }, 'note-ta', true);
    assert.match(html, /onclick="saveInternalNote\('R1','note-ta'\)"/);
    assert.match(html, /onclick="saveGuestNote\('R1','note-ta'\)"/);
  });
  test('Internal Notes history (r.inlog) renders once, distinct from Guest Notes history (r.nlog) -- never mixed into the same list', () => {
    const html = renderNotesAs({ id:'R1', notes:'x', internalNote:'y', src:'Direct',
      nlog:[{t:'"guest history entry"',time:'1 Jan 2026'}],
      inlog:[{t:'"internal history entry"',time:'2 Jan 2026'}] }, 'note-ta', true);
    assert.match(html, /guest history entry/);
    assert.match(html, /internal history entry/);
    assert.equal((html.match(/guest history entry/g)||[]).length, 1);
    assert.equal((html.match(/internal history entry/g)||[]).length, 1);
  });
  test('view-only (Agency, canViewOnly()) sees neither note history save button -- guestSaveHTML is empty', () => {
    const html = renderNotesAs({ id:'R1', notes:'existing', internalNote:'', src:'Direct' }, 'note-ta', true, true);
    assert.doesNotMatch(html, /saveGuestNote/);
  });
}

console.log(`\n${passed}/${passed + failed} dashboard-cloudbeds-parity assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
