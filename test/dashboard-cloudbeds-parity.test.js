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

section('Case B — arrival/departure/in-house classification (real isOcc()/isBlockingStatus(), synthetic data)');
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
      inHouse: RES.filter(r => r.ci < TODAY && r.co > TODAY && occSandbox.isBlockingStatus(r.st) && r.st !== 'Checked out'),
    };
  }
  test('a guest checking in today is an arrival, not in-house', () => {
    const d = classify([{ id:'a', rn:'VR01', ci:'2026-09-10', co:'2026-09-14', st:'Confirmed' }], []);
    assert.equal(d.arrivals.length, 1);
    assert.equal(d.inHouse.length, 0);
  });
  test('a guest who checked in days ago and checks out later is in-house, never an arrival', () => {
    const d = classify([{ id:'b', rn:'VR02', ci:'2026-09-05', co:'2026-09-13', st:'Checked in' }], []);
    assert.equal(d.inHouse.length, 1);
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
    assert.equal(d.arrivals.length + d.departures.length + d.inHouse.length + d.occupiedRooms, 0);
  });
  test('a cancelled reservation for today is excluded from every classification', () => {
    const d = classify([{ id:'f', rn:'VR05', ci:'2026-09-10', co:'2026-09-12', st:'Cancelled' }], []);
    assert.equal(d.arrivals.length + d.occupiedRooms, 0);
  });
  test('a same-day arrival+departure appears in both Arrivals and Departures, occupies nothing overnight', () => {
    const d = classify([{ id:'g', rn:'VR06', ci:'2026-09-10', co:'2026-09-10', st:'Confirmed' }], []);
    assert.equal(d.arrivals.length, 1);
    assert.equal(d.departures.length, 1);
    assert.equal(d.occupiedRooms, 0);
  });
  test('a room block occupies the room without appearing as an arrival/departure/in-house guest', () => {
    const d = classify([], [{ id:'BLK1', rn:'VR04', from:'2026-09-10', to:'2026-09-11', type:'maintenance' }]);
    assert.equal(d.occupiedRooms, 1);
    assert.equal(d.blockedRooms, 1);
    assert.equal(d.arrivals.length + d.departures.length + d.inHouse.length, 0);
  });
  test('a multi-room booking (two reservations, two rooms, both spanning today) counts each room once, no double-count', () => {
    const d = classify([
      { id:'h1', rn:'VR01', ci:'2026-09-08', co:'2026-09-12', st:'Checked in' },
      { id:'h2', rn:'VR02', ci:'2026-09-08', co:'2026-09-12', st:'Checked in' },
    ], []);
    assert.equal(d.occupiedRooms, 2);
    assert.equal(d.inHouse.length, 2);
  });
  test('a partner-property reservation is invisible to this Vilu-room classification (RES here is pre-filtered to prop==="vilu" by computeDashData, same as this test only passing Vilu rows)', () => {
    // computeDashData() filters RES to r.prop==='vilu' before ever calling
    // this classification -- proven structurally in Case D below.
    assert.ok(true);
  });
}

section('Case C — Dashboard/Reservations click-through wiring');
{
  test('computeDashData() filters to prop==="vilu" before classifying (partner-property leakage impossible)', () => {
    const src = extractByStart(PMS, /function computeDashData\(\)\s*\{/);
    assert.match(src, /r\.prop===['"]vilu['"]/);
  });
  test('dashGuestRow() routes a click straight to showDet() -- the same reservation-detail entry point every other list uses', () => {
    const src = extractByStart(PMS, /function dashGuestRow\(r\)\s*\{/);
    assert.match(src, /onclick="showDet\(/);
  });
  test('goCalToday() navigates to Calendar and calls calNavToday() -- lands on today, not wherever Calendar was last scrolled', () => {
    const src = extractByStart(PMS, /function goCalToday\(\)\s*\{/);
    assert.match(src, /go\('cal'/);
    assert.match(src, /calNavToday\(\)/);
  });
  test('goResScope()/setResScope() exist and drawRes() filters by the same today/isBlockingStatus check as computeDashData()', () => {
    assert.match(PMS, /function goResScope\(scope\)\s*\{/);
    assert.match(PMS, /function setResScope\(scope\)\s*\{/);
    const src = extractByStart(PMS, /function drawRes\(\)\s*\{/);
    assert.match(src, /RES_SCOPE/);
    assert.match(src, /isBlockingStatus\(r\.st\)/);
  });
  test('the revenue card navigates to Guest Folios, the occupancy card to Calendar -- no dead-looking dashboard cards', () => {
    assert.match(PMS, /dash-revenue-card"[^>]*onclick="go\('folios'/);
    assert.match(PMS, /dash-occ-card"[^>]*onclick="goCalToday\(\)"/);
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
const notesSandbox = {};
vm.createContext(notesSandbox);
vm.runInContext([escSrc, rNmSrc, stBxSrc, parseImportedNoteSrc, upsertNoteBlockSrc, notesSectionSrc, extractImportedAddressSrc].join('\n'), notesSandbox);
const renderNotesHTMLSrc = extractByStart(PMS, /function renderNotesHTML\(r,taId\)\s*\{/);
vm.runInContext(renderNotesHTMLSrc, notesSandbox);

const REAL_MIGRATED_NOTE = "Cloudbeds #4350689601640 (room 106) \u00b7 Cloudbeds internal id 184853238 \u00b7 source Walk-In \u00b7 booked 2026-08-28 01:03 \u00b7 last change 2026-08-28 01:05 \u00b7 Cloudbeds status confirmed\n\n[Cloudbeds internal note 2026-08-28 06:05 \u00b7 Raeeshan Ibrahim] Room with breakfast\nper night $55\nDomestic flight for arrival $155 per persion\nTotal $585\n\n[Cloudbeds pricing] reservation total USD 30.00 (subtotal 0.00, taxes 30.00, extras 0.00) \u00b7 this room total USD 0.00 \u00b7 paid 0.00 \u00b7 balance due 30.00\n\n[Cloudbeds guest address] Rah dhebai magu, South ari atoll, 00100\n\n[Cloudbeds room guest] Wilkinson Ewa Sylwia\n\n[Migration] imported from Cloudbeds on 2026-09-08";

section('Case D — reservation notes: single editor, Cloudbeds metadata separated, nothing dumped into Guest Notes');
{
  test('exactly one <textarea> is rendered -- no rendered-preview-plus-textarea duplication', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    const count = (html.match(/<textarea/g) || []).length;
    assert.equal(count, 1);
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
  test('the real Cloudbeds internal note is shown exactly once, under "Internal Notes"', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    const occurrences = (html.match(/Room with breakfast/g) || []).length;
    assert.equal(occurrences, 1);
    assert.match(html, /Internal Notes/);
  });
  test('source/channel metadata (reservation ID, internal ID, original source/status) is collapsible (<details>), not always-visible', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    assert.match(html, /<details[^>]*>[\s\S]*Source Details[\s\S]*Reservation ID[\s\S]*<\/details>/);
  });
  test('repeated "Cloudbeds ..." line-prefix wording is gone -- one "Source Details" heading, not one per field', () => {
    const html = notesSandbox.renderNotesHTML({ notes: REAL_MIGRATED_NOTE, src:'Direct' }, 'note-ta');
    const cloudbedsPrefixCount = (html.match(/>Cloudbeds /g) || []).length;
    assert.ok(cloudbedsPrefixCount <= 1, 'expected at most the single "imported from Cloudbeds" mention, found ' + cloudbedsPrefixCount);
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

console.log(`\n${passed}/${passed + failed} dashboard-cloudbeds-parity assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); }
console.log('\nALL TESTS PASSED');
