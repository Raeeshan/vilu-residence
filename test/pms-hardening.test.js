// Phase 48 — PMS Hardening regression suite.
//
// Run: node test/pms-hardening.test.js
//
// Static/source-level checks only — no live Firestore connection, no
// emulator, no real reservation is ever created. Guards the protected
// reservation-write contract (writeReservation/hasBlockConflict/ROOM_CONFLICT/
// {merge:true}/Pending+Website defaults) staying identical across the three
// files that share it, the Phase 48 firestore.rules tightening (public
// creates must self-label 'Pending'), and the Phase 48 stored-XSS fix
// (guest-controlled fields escaped before reaching innerHTML in the PMS).

const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const WEBSITE = read('vilu-website.html');
const PMS = read('vilu-unified.html');
const AGENCY = read('vilu-agency-portal.html');
const RULES = read('firestore.rules');
const CORE_FN = read('functions-core/index.js');

function extractFn(src, name) {
  const m = src.match(new RegExp('async function ' + name + '\\([^)]*\\)\\s*\\{'));
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

// Removes an entire brace-matched block whose OPENING line contains
// `marker`, leaving everything else untouched. A plain per-line substring
// filter can't cleanly remove a multi-line block whose own inner lines
// (e.g. `reservationId: docId,`, the closing `});`) don't all repeat the
// marker text -- brace-matching is needed to excise the whole unit as one
// piece. No-op (returns body unchanged) when the marker isn't present at
// all, which is exactly the case for vilu-website.html/vilu-agency-portal.html
// below.
function stripBlockContaining(body, marker) {
  const lines = body.split('\n');
  const startIdx = lines.findIndex(l => l.includes(marker));
  if (startIdx === -1) return body;
  let depth = 0, started = false, endIdx = -1;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth === 0) { endIdx = i; break; }
  }
  if (endIdx === -1) return body;
  return lines.slice(0, startIdx).concat(lines.slice(endIdx + 1)).join('\n');
}

// Normalizes away the known, deliberate divergences plus comment lines and
// blank lines, so the comparison targets the actual reservation-write/
// conflict logic, not file-specific plumbing or comment drift:
//  - the website's extra `await ensureFirebaseReady();` bootstrap call
//    (vilu-website.html is the only one of the three that lazily waits for
//    Firebase init inside these functions)
//  - the PMS-only price-adjustment audit-trail write (Financial integrity
//    correction, 2026-09-10): an Admin/Manager overriding a reservation's
//    rate from the Calendar drawer is a PMS-only capability -- the public
//    website booking flow and the agency portal never construct a
//    priceAdjustment option, so this whole brace-matched block only ever
//    exists in vilu-unified.html's copy. Stripping it (and the one-line
//    `var priceAdjustment = ...` / `var priceAdjRef = ...` declarations
//    that feed it) leaves the CORE conflict-detection logic -- the part
//    this test actually guards -- still compared byte-for-byte across all
//    three files.
function normalizeForCompare(body) {
  body = stripBlockContaining(body, 'priceAdjRef && priceAdjustment');
  return body
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim() !== '' && !/^\s*\/\//.test(l) && !/await ensureFirebaseReady\(\);/.test(l) && !/var priceAdjustment ?=|var priceAdjRef ?=/.test(l))
    .join('\n');
}

section('Case A — writeReservation()/hasBlockConflict() are identical across all three write paths');
{
  test('writeReservation() reservation-write/conflict logic is identical in vilu-website.html, vilu-unified.html, vilu-agency-portal.html', () => {
    const w = normalizeForCompare(extractFn(WEBSITE, 'writeReservation') || '');
    const p = normalizeForCompare(extractFn(PMS, 'writeReservation') || '');
    const a = normalizeForCompare(extractFn(AGENCY, 'writeReservation') || '');
    assert.ok(w && p && a, 'writeReservation() not found in one of the three files');
    assert.equal(w, p, 'website vs PMS writeReservation() diverge');
    assert.equal(p, a, 'PMS vs agency-portal writeReservation() diverge');
  });
  test('hasBlockConflict() logic is identical in all three files', () => {
    const w = normalizeForCompare(extractFn(WEBSITE, 'hasBlockConflict') || '');
    const p = normalizeForCompare(extractFn(PMS, 'hasBlockConflict') || '');
    const a = normalizeForCompare(extractFn(AGENCY, 'hasBlockConflict') || '');
    assert.ok(w && p && a, 'hasBlockConflict() not found in one of the three files');
    assert.equal(w, p, 'website vs PMS hasBlockConflict() diverge');
    assert.equal(p, a, 'PMS vs agency-portal hasBlockConflict() diverge');
  });
  test('writeReservation() still uses runTransaction + {merge:true}, throws ROOM_CONFLICT on overlap, never deletes', () => {
    const body = extractFn(PMS, 'writeReservation');
    assert.ok(/runTransaction/.test(body), 'transaction removed');
    assert.ok(/\{\s*merge:\s*true\s*\}/.test(body), 'merge:true removed');
    assert.ok(/ROOM_CONFLICT/.test(body), 'ROOM_CONFLICT throw removed');
    assert.ok(!/\.delete\(/.test(body), 'writeReservation should never call .delete()');
  });
}

section('Case B — Website/direct-booking defaults are still Pending status, Website source');
{
  test("submitDirectBooking() delegates to the trusted publicBooking function, which hardcodes status:'Pending', source:'Website'", () => {
    // Stage 0 fix (2026-09-09): the client no longer sets status/source
    // itself -- it can't be trusted to, and the direct Firestore transaction
    // this used to run was denied anyway (room_availability write blocked
    // for anonymous clients). Those defaults are now authoritative
    // server-side in functions-core/index.js's publicBooking handler.
    const m = WEBSITE.match(/async function submitDirectBooking[\s\S]{0,700}/);
    assert.ok(m, 'submitDirectBooking() not found');
    assert.ok(/cloudfunctions\.net\/publicBooking/.test(m[0]), 'submitDirectBooking must call the trusted publicBooking function');
    assert.ok(/status:\s*'Pending'/.test(CORE_FN), 'status default is no longer Pending in functions-core/index.js');
    assert.ok(/source:\s*'Website'/.test(CORE_FN), 'source default is no longer Website in functions-core/index.js');
  });
  test('room id filter still restricts direct booking to VR01-VR06', () => {
    const m = WEBSITE.match(/async function submitDirectBooking[\s\S]{0,300}/);
    assert.ok(/\/\^VR0\[1-6\]\$\//.test(m[0]), 'six-room VR01-VR06 safety filter missing');
  });
}

section('Case C — firestore.rules: public reservation creates are Website-sourced, agency-free, and Pending');
{
  test('public (unauthenticated) create branch requires source==Website, no agencyId, and status==Pending', () => {
    const line = RULES.split('\n').find(l => l.includes('request.auth == null'));
    assert.ok(line, 'public create branch line not found');
    assert.ok(/source == 'Website'/.test(line), "public branch no longer pins source to 'Website'");
    assert.ok(/!\('agencyId' in request\.resource\.data\)/.test(line), 'public branch no longer excludes agencyId');
    assert.ok(/status == 'Pending'/.test(line), "Phase 48 fix missing: public branch must pin status to 'Pending'");
  });
  test('agency direct-create branch was intentionally REMOVED by Agency Sales Workflow Phase F -- an agency can no longer write reservations/{id} directly at all, only through confirmAgencyBookingRequest() (see agency-booking-requests-rules.test.js\'s Part 26 attack proof)', () => {
    const resBlock = RULES.slice(RULES.indexOf('match /reservations/{id} {'), RULES.indexOf('match /reservation_price_adjustments/'));
    assert.doesNotMatch(resBlock, /isAgency\(\) && request\.resource\.data\.agencyId == request\.auth\.uid && request\.resource\.data\.source == 'Agency'/);
  });
  test('reservations collection still denies delete entirely', () => {
    assert.ok(/match \/reservations\/\{id\} \{[\s\S]*?allow delete: if false;/.test(RULES), 'reservation delete is no longer denied');
  });
  test('rate is still bounded (0 <= rate < 100000) at the rules level', () => {
    assert.ok(/rate >= 0/.test(RULES) && /rate < 100000/.test(RULES), 'rate bound removed from validReservationShape()');
  });
}

section('Case D — stored-XSS hardening: guest-controlled fields are escaped before reaching innerHTML');
{
  test('vilu-unified.html defines an HTML-escaping helper', () => {
    assert.ok(/function esc\(/.test(PMS), 'esc() helper not found in vilu-unified.html');
  });
  test('vilu-agency-portal.html defines an HTML-escaping helper', () => {
    assert.ok(/function esc\(/.test(AGENCY), 'esc() helper not found in vilu-agency-portal.html');
  });
  test('the known dashboard arrivals/departures/in-house guest-name render site uses esc()', () => {
    // 2026-09-10: drawDash() now shares one dashGuestRow() row-renderer
    // across arrivals/departures/in-house instead of building the
    // arrivals/departures markup inline twice -- check the row-renderer
    // itself, the single place a guest name actually reaches innerHTML.
    const row = PMS.slice(PMS.indexOf('function dashGuestRow'), PMS.indexOf('function dashGuestRow') + 800);
    assert.ok(/esc\(r\.fn\)/.test(row) && /esc\(r\.ln\)/.test(row), 'dashGuestRow() guest name is not escaped');
  });
  test('the reservation-detail edit form (attribute-breakout risk) escapes fn/ln/em/ph/nat/pid in value="..."', () => {
    const tab = PMS.slice(PMS.indexOf('function rdRenderTab'), PMS.indexOf('function rdRenderTab') + 2500);
    for (const field of ['r.fn', 'r.ln', "r.em||''", "r.ph||''", "r.nat||''", "r.pid||''"]) {
      assert.ok(tab.includes('esc(' + field + ')'), `rdRenderTab() guest-editable value="..." field ${field} is not escaped`);
    }
  });
}

section('Case F — calendar drag-to-move: fixed dead call to undefined showMv(), now routes through the existing safe showConfirm() modal');
{
  test('no remaining call to the undefined showMv() function', () => {
    assert.ok(!/\bshowMv\(/.test(PMS), 'a call to undefined showMv() still exists — calendar drag-to-move will throw ReferenceError');
  });
  test('the calendar cell drop handler now confirms the move via showConfirm()', () => {
    const idx = PMS.indexOf("cell.addEventListener('drop'");
    assert.ok(idx !== -1, 'calendar cell drop handler not found');
    const handler = PMS.slice(idx, idx + 500);
    assert.ok(/showConfirm\(\{/.test(handler), 'drop handler no longer shows a move confirmation');
    assert.ok(/onYes:function\(\)\{res\.rn=rn;res\.ci=ds;res\.co=newCo;saveRES\(res\);drawCal\(\);\}/.test(handler), 'drop handler no longer applies the move (room/dates/save/redraw) on confirm');
  });
}

section('Case E — BroadcastChannel reservation sync still dedupes by id');
{
  test("PMS's BroadcastChannel NEW_BOOKING handler still guards against duplicate inserts", () => {
    const idx = PMS.indexOf("NEW_BOOKING");
    assert.ok(idx !== -1, 'NEW_BOOKING handling removed');
    const nearby = PMS.slice(PMS.lastIndexOf('function', idx), idx + 400);
    assert.ok(/RES\.find\(/.test(nearby) || /!RES\.find/.test(PMS.slice(idx - 200, idx + 400)), 'NEW_BOOKING dedup-by-id guard appears to be missing');
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} pms-hardening assertions passed`);
if (failed > 0) process.exitCode = 1;
