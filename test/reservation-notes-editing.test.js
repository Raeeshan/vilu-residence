// Reservation Notes editing fix — 2026-09-10.
//
// Owner report: "existing notes cannot be properly edited if something
// changes." Root cause found by tracing the actual load path (not patched
// blindly): loadResFromSupabase()'s reservation mapper merged
// `r.notes||local.notes||''` -- Supabase's own notes column is NEVER
// written back to by this app (no PATCH/POST path exists), so for any
// migrated (Cloudbeds-imported) reservation -- virtually every real one --
// that column is a permanently stale snapshot. Because it's truthy, it
// always won the `||` chain over the freshly-edited, Firestore-synced
// local cache, so an edited note visibly saved and then silently reverted
// on the very next page load.
//
// Covers: the root-cause load-priority fix; Guest Notes (unchanged,
// already editable) vs the new Internal Notes field (Admin/Manager,
// completely separate from the Cloudbeds-imported internal note, which
// stays read-only under Source Details); the new append-only
// reservation_note_history audit trail; Calendar/Reservations/Dashboard
// parity (one shared renderNotesHTML()); Maldives-time display.
//
// Same technique as the rest of this suite: brace-match real functions out
// of vilu-unified.html, regex-check source directly for wiring/structural
// checks. No Firestore, no browser, no live reservation.
//   node test/reservation-notes-editing.test.js
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
const RULES = read('firestore.rules');

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
function ruleBlock(src, matchStr) {
  const idx = src.indexOf(matchStr);
  if (idx === -1) throw new Error('rule block not found: ' + matchStr);
  return src.slice(idx, src.indexOf('\n    }', idx));
}

section('Case A — root cause: the Supabase/local merge priority that reverted every edited note');
{
  test('loadResFromSupabase() now prefers the locally-cached (Firestore-synced) notes over the permanently-stale Supabase snapshot', () => {
    const src = extractByStart(PMS, /async function loadResFromSupabase\(\)\s*\{/);
    assert.match(src, /notes:local\.notes\|\|r\.notes\|\|''/);
    assert.doesNotMatch(src, /notes:r\.notes\|\|local\.notes/);
  });
  test('internalNote is mapped through the same loader with the same local-first priority', () => {
    const src = extractByStart(PMS, /async function loadResFromSupabase\(\)\s*\{/);
    assert.match(src, /internalNote:local\.internalNote\|\|r\.internal_note\|\|''/);
  });
  test('inlog (Internal Notes\' history cache) is loaded from local storage, mirroring the existing nlog pattern', () => {
    const src = extractByStart(PMS, /async function loadResFromSupabase\(\)\s*\{/);
    assert.match(src, /inlog:local\.inlog\|\|\[\]/);
  });
  test('resToFirestoreFields() actually persists internal_note, so an edit reaches Firestore, not just localStorage', () => {
    const src = extractByStart(PMS, /function resToFirestoreFields\(r\)\s*\{/);
    assert.match(src, /internal_note:r\.internalNote\|\|''/);
  });
}

section('Case B — Guest Notes stays editable (unchanged) and Internal Notes is a genuinely new, separate field');
{
  test('saveNoteFor() still writes r.notes in place (upsert, never append a duplicate visible block) and still persists via saveRES()', () => {
    const src = extractByStart(PMS, /function saveNoteFor\(r,taId\)\s*\{/);
    assert.match(src, /upsertNoteBlock\(r\.notes,'Staff note',txt\)/);
    assert.match(src, /saveRES\(r\)/);
  });
  test('saveInternalNoteFor() never writes into r.notes or touches upsertNoteBlock() -- completely separate storage from Guest Notes and from the original Cloudbeds internal note', () => {
    const src = extractByStart(PMS, /function saveInternalNoteFor\(r,taId\)\s*\{/);
    assert.doesNotMatch(src, /r\.notes\s*=/);
    assert.doesNotMatch(src, /upsertNoteBlock/);
    assert.match(src, /r\.internalNote\s*=\s*txt/);
  });
  test('saveInternalNoteFor() is gated by canEditInternalNotes(), rejecting an unauthorized save before it ever touches r.internalNote', () => {
    const src = extractByStart(PMS, /function saveInternalNoteFor\(r,taId\)\s*\{/);
    const gateIdx = src.indexOf('canEditInternalNotes()');
    const writeIdx = src.indexOf('r.internalNote=txt');
    assert.ok(gateIdx !== -1 && writeIdx !== -1 && gateIdx < writeIdx, 'permission check must precede the write');
  });
  test('canEditInternalNotes() = Admin/Manager only, per the task\'s "safest existing role rule" fallback -- Staff is not silently granted a brand-new write capability', () => {
    const src = extractByStart(PMS, /function canEditInternalNotes\(\)\s*\{/);
    assert.match(src, /role === 'admin'/);
    assert.match(src, /role === 'manager'/);
    assert.doesNotMatch(src, /role === 'staff'/);
  });
}

section('Case C — durable note-edit history (reservation_note_history), append-only, server timestamp');
{
  test('logNoteHistory() writes with FieldValue.serverTimestamp(), never a client Date -- matches the reservation_price_adjustments/invoice_payment_audit precedent', () => {
    const src = extractByStart(PMS, /async function logNoteHistory\([^)]*\)\s*\{/);
    assert.match(src, /changedAt: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
    assert.match(src, /reservation_note_history/);
  });
  test('both saveNoteFor() and saveInternalNoteFor() call logNoteHistory() with old and new text, tagged by noteType', () => {
    const guestSrc = extractByStart(PMS, /function saveNoteFor\(r,taId\)\s*\{/);
    assert.match(guestSrc, /logNoteHistory\(r\.id,'guest',oldTxt,txt\)/);
    const internalSrc = extractByStart(PMS, /function saveInternalNoteFor\(r,taId\)\s*\{/);
    assert.match(internalSrc, /logNoteHistory\(r\.id,'internal',oldTxt,txt\)/);
  });
  test('reservation_note_history is genuinely append-only at the rules level (update and delete both denied)', () => {
    const block = ruleBlock(RULES, 'match /reservation_note_history/{id}');
    assert.match(block, /allow update, delete:\s*if\s*false/);
  });
  test('the create rule requires the full Step-5 schema and a real, unspoofable server timestamp/actor', () => {
    const block = ruleBlock(RULES, 'match /reservation_note_history/{id}');
    assert.match(block, /request\.resource\.data\.reservationId is string/);
    assert.match(block, /request\.resource\.data\.noteType in \['guest','internal'\]/);
    assert.match(block, /request\.resource\.data\.oldText is string/);
    assert.match(block, /request\.resource\.data\.newText is string/);
    assert.match(block, /request\.resource\.data\.changedByUid == request\.auth\.uid/);
    assert.match(block, /request\.resource\.data\.changedAt == request\.time/);
  });
  test('the create rule denies a Staff session from forging an "internal" noteType entry even if it hand-crafts the write -- Admin/Manager only for that type', () => {
    const block = ruleBlock(RULES, 'match /reservation_note_history/{id}');
    assert.match(block, /noteType == 'internal' && \(isAdmin\(\) \|\| isManagerRole\(\)\)/);
  });
}

section('Case D — Calendar/Reservations/Dashboard parity: ONE shared notes component (Step 9)');
{
  test('_showDetLegacy() (what Calendar bar clicks / Dashboard rows / Reservations table View all open) renders via renderNotesHTML() -- no separate note-editing logic of its own', () => {
    const src = extractByStart(PMS, /function _showDetLegacy\(id\)\s*\{/);
    assert.match(src, /renderNotesHTML\(r,'note-ta'\)/);
  });
  test('rdRenderTab()\'s Notes tab (the Calendar side-drawer) renders via the SAME renderNotesHTML() function, not a duplicate implementation', () => {
    const idx = PMS.indexOf("} else if(n===1){");
    const src = PMS.slice(idx, idx + 900);
    assert.match(src, /renderNotesHTML\(r,'rd-note-ta'\)/);
  });
  test('neither call site duplicates a second "Save note" button/history block outside renderNotesHTML() anymore -- both are now embedded inside it once', () => {
    const legacySrc = extractByStart(PMS, /function _showDetLegacy\(id\)\s*\{/);
    assert.doesNotMatch(legacySrc, /onclick="saveNote\(/); // old wrapper, removed
    const idx = PMS.indexOf("} else if(n===1){");
    const rdSrc = PMS.slice(idx, idx + 900);
    assert.doesNotMatch(rdSrc, /'<i class="ti ti-device-floppy"><\/i> Save note'/); // old footer button, removed
  });
}

section('Case E — Source Details stays read-only, Cloudbeds import never becomes an editable note (Step 7)');
{
  test('parseImportedNote()/upsertNoteBlock() never touch the "Cloudbeds internal note" block -- only ever upsert the separate "Staff note" block', () => {
    const upsertSrc = extractByStart(PMS, /function upsertNoteBlock\(rawNotes,label,newText\)\s*\{/);
    assert.doesNotMatch(upsertSrc, /Cloudbeds internal note/);
  });
  test('the relocated Cloudbeds-internal-note display inside Source Details renders through esc(), read-only div -- no textarea, no save wiring', () => {
    const src = extractByStart(PMS, /function renderNotesHTML\(r,taId\)\s*\{/);
    const idx = src.indexOf('cloudbedsInternalHTML');
    const block = src.slice(idx, idx + 700);
    assert.doesNotMatch(block, /<textarea/);
    assert.match(block, /esc\(parsed\.internal\.text\)/);
  });
}

section('Case F — Maldives time on every note-edit timestamp');
{
  test('saveNoteFor() and saveInternalNoteFor() both stamp their quick-history entry via formatMaldivesDateTime(), never a raw Date/toISOString', () => {
    const guestSrc = extractByStart(PMS, /function saveNoteFor\(r,taId\)\s*\{/);
    assert.match(guestSrc, /formatMaldivesDateTime\(new Date\(\)\)/);
    const internalSrc = extractByStart(PMS, /function saveInternalNoteFor\(r,taId\)\s*\{/);
    assert.match(internalSrc, /formatMaldivesDateTime\(new Date\(\)\)/);
  });
  test('formatMaldivesDateTime() renders in the Indian/Maldives timezone specifically', () => {
    const src = extractByStart(PMS, /function formatMaldivesDateTime\(isoOrDate\)\s*\{/);
    assert.match(src, /timeZone:'Indian\/Maldives'/);
  });
}

section('Case G — Post-completion hardening, item 2: Guest Notes display stays clean for OTA-managed reservations too (parseImportedNote() widened beyond "Cloudbeds #")');
{
  const vm = require('node:vm');
  const parseImportedNoteSrc = extractByStart(PMS, /function parseImportedNote\(raw\)\{/);
  const upsertNoteBlockSrc = extractByStart(PMS, /function upsertNoteBlock\(rawNotes,label,newText\)\{/);
  function sandbox() {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext([parseImportedNoteSrc, upsertNoteBlockSrc].join('\n'), ctx);
    return ctx;
  }

  test('a Cloudbeds-imported note still parses exactly as before (header captured, [Staff note] found) -- this fix never changes existing Cloudbeds behavior', () => {
    const ctx = sandbox();
    const raw = "Cloudbeds #123 booked 2026-01-01\n\n[Staff note] VIP guest\n\n[Cloudbeds internal note] balance due 200";
    const r = vm.runInContext(`parseImportedNote(${JSON.stringify(raw)})`, ctx);
    assert.ok(r);
    assert.match(r.header, /^Cloudbeds #123/);
    assert.strictEqual(r.staff.text, 'VIP guest');
  });

  test('an OTA-managed reservation\'s notes (functions/lib/ingest.js\'s buildFields() shape: no bare header, every block already [Label] text) now ALSO parses, header empty, staff block isolated', () => {
    const ctx = sandbox();
    const raw = '[mock] external id N1 · revision 1\n\n[Special requests] quiet room\n\n[Staff note] Vegetarian breakfast requested';
    const r = vm.runInContext(`parseImportedNote(${JSON.stringify(raw)})`, ctx);
    assert.ok(r, 'a note containing a [Staff note] block must now parse even without a Cloudbeds header');
    assert.strictEqual(r.header, '', 'an OTA note has no bare Cloudbeds-style header line');
    assert.strictEqual(r.staff.text, 'Vegetarian breakfast requested', 'Guest Notes must show ONLY the staff text, never the raw channel blob');
  });

  test('plain text with no [Staff note] block anywhere and no Cloudbeds header still returns null (unchanged: a brand-new, never-synced reservation\'s note stays a plain editable string)', () => {
    const ctx = sandbox();
    const r = vm.runInContext(`parseImportedNote(${JSON.stringify('Just a plain note, never touched by OTA or Cloudbeds')})`, ctx);
    assert.strictEqual(r, null);
  });

  test('upsertNoteBlock() on an OTA-shaped note (empty header) never introduces a stray leading blank block', () => {
    const ctx = sandbox();
    const raw = '[mock] external id N1 · revision 1\n\n[Staff note] old text';
    const updated = vm.runInContext(`upsertNoteBlock(${JSON.stringify(raw)}, 'Staff note', 'new text')`, ctx);
    assert.ok(!updated.startsWith('\n\n'), 'must not leave a leading blank block when there is no Cloudbeds header to keep');
    assert.match(updated, /\[Staff note\] new text/);
  });

  test('Source Details subtitle only claims "imported from Cloudbeds" when there really is a Cloudbeds header -- an OTA-managed reservation gets a channel-neutral label instead', () => {
    const src = extractByStart(PMS, /function renderNotesHTML\(r,taId\)\{/);
    assert.match(src, /parsed\.header\?'imported from Cloudbeds':'synced from channel manager'/);
  });
}

console.log(`\n${passed}/${passed + failed} reservation-notes-editing assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); } else { console.log('\nALL TESTS PASSED'); }
