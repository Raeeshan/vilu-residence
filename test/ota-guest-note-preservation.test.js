// Post-completion hardening, item 2 -- OTA modify silently erasing staff
// Guest Notes.
//
// Root cause: buildFields() (functions/lib/ingest.js) reconstructed the
// shared `notes` field wholesale from channel data on every new/modify
// event -- a staff-typed Guest Note living in that same field (there is no
// separate "guest notes" column; vilu-unified.html's saveNoteFor() writes
// straight into `notes`, same as Cloudbeds import ever did) was silently
// discarded on the next OTA sync, the same class of bug already fixed for
// loadResFromSupabase() (2026-09-10), just in this separate, still-live
// pipeline.
//
// The fix extracts whatever staff-authored text already exists (a
// `[Staff note]` block, or -- for content this pipeline never wrote itself
// -- the untouched plain text) and re-emits it as its own `[Staff note]`
// block on every rebuild, so it survives repeated syncs without ever being
// duplicated. Same in-memory harness as test/ota-core.test.js -- no
// Firestore emulator needed.
//
//   node test/ota-guest-note-preservation.test.js
const assert = require('assert');
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { MemoryStore } = F('store-memory');
const { MockAdapter } = F('adapters');
const { ingestEvent, buildFields, extractStaffNote, STAFF_NOTE_LABEL } = F('ingest');
const { PHYSICAL_ROOMS } = F('inventory');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n     ')); process.exitCode = 1; } }

function booking(over) {
  return Object.assign({
    external_id: 'N1', revision: '2026-09-09T10:00:00Z', status: 'confirmed', channel: 'Booking.com',
    channel_reservation_id: 'CR1', booking_date: '2026-09-09T09:00:00Z',
    guest: { first: 'Note', last: 'Guest', email: 'n@example.com', phone: '+000', country: 'DE' },
    notes: '', special_requests: '', meal_plan: '',
    commercial: { currency: 'USD', gross_total: 200, net_total: 150, tax_total: 50, commission: 30, paid: 0, balance: 200, rate_includes_tax: true },
    units: [{ room_type: 'Double Room', check_in: '2026-09-10', check_out: '2026-09-14', adults: 2, children: 0, nightly_rate: 37.5 }],
  }, over || {});
}
async function fresh() { const store = new MemoryStore(); const adapter = new MockAdapter(); for (const r of PHYSICAL_ROOMS) await store.set('rooms', r.id, { id: r.id, name: r.name, type: r.type }); return { store, adapter }; }
function ev(over) { return Object.assign({ channel_manager: 'mock', external_id: 'N1', type: 'new', revision: '2026-09-09T10:00:00Z' }, over || {}); }

(async () => {
  console.log('\n# extractStaffNote() unit behavior');

  await test('unit: plain, untagged staff text (no OTA/Cloudbeds structure at all) is treated as an implicit staff note', () => {
    assert.strictEqual(extractStaffNote('Vegetarian breakfast requested', 'mock'), 'Vegetarian breakfast requested');
  });

  await test('unit: empty/undefined existing notes -> nothing to preserve', () => {
    assert.strictEqual(extractStaffNote('', 'mock'), '');
    assert.strictEqual(extractStaffNote(undefined, 'mock'), '');
  });

  await test('unit: an existing [Staff note] block is extracted directly, channel blocks (this cm\'s own label) ignored', () => {
    const raw = '[mock] external id N1 · revision 1\n\n[Special requests] quiet room\n\n[Staff note] Allergic to nuts';
    assert.strictEqual(extractStaffNote(raw, 'mock'), 'Allergic to nuts');
  });

  await test('unit: a Cloudbeds-imported header + staff block is also recognized (same convention, different origin)', () => {
    const raw = 'Cloudbeds #123 booked 2026-01-01\n\n[Staff note] VIP guest, late checkout agreed';
    assert.strictEqual(extractStaffNote(raw, 'mock'), 'VIP guest, late checkout agreed');
  });

  console.log('\n# ingestEvent(): full new -> modify -> modify sequence, guest-note preservation');

  let ctx = await fresh();
  ctx.adapter.put(booking());
  await test('1. new reservation with no staff note yet -> notes built purely from channel data, no stray [Staff note] block', async () => {
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev() });
    assert.strictEqual(r.result, 'created');
    const d = await ctx.store.get('reservations', 'OTA-mock-N1');
    assert(!new RegExp('\\[' + STAFF_NOTE_LABEL + '\\]').test(d.notes), 'no staff note was ever typed -- none should be fabricated');
  });

  await test('2. staff types a Guest Note directly onto the live reservation (simulates saveNoteFor() writing straight into `notes`)', async () => {
    const d = await ctx.store.get('reservations', 'OTA-mock-N1');
    await ctx.store.set('reservations', 'OTA-mock-N1', Object.assign({}, d, { notes: d.notes + '\n\n[' + STAFF_NOTE_LABEL + '] Vegetarian breakfast requested' }), { merge: true });
  });

  await test('3. CRITICAL: OTA modify arrives (special_requests changed) -> Guest Note "Vegetarian breakfast requested" must still be present', async () => {
    ctx.adapter.put(booking({ revision: '2026-09-09T11:00:00Z', special_requests: 'late check-in', units: booking().units }));
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T11:00:00Z' }) });
    assert.strictEqual(r.result, 'modified');
    const d = await ctx.store.get('reservations', 'OTA-mock-N1');
    assert.match(d.notes, /Vegetarian breakfast requested/, 'staff Guest Note must survive an OTA modify event');
    assert.match(d.notes, /late check-in/, 'the new channel content must also be present (this is a real update, not a no-op)');
  });

  await test('4. repeated IDENTICAL modify (retry/duplicate delivery) does not duplicate the preserved staff note', async () => {
    const before = (await ctx.store.get('reservations', 'OTA-mock-N1')).notes;
    ctx.adapter.put(booking({ revision: '2026-09-09T11:00:00Z', special_requests: 'late check-in', units: booking().units }));
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T11:00:00Z' }) });
    assert.strictEqual(r.result, 'duplicate', 'same revision must be recognized as a duplicate, never reprocessed');
    const after = (await ctx.store.get('reservations', 'OTA-mock-N1')).notes;
    assert.strictEqual(after, before);
    const occurrences = (after.match(/Vegetarian breakfast requested/g) || []).length;
    assert.strictEqual(occurrences, 1, 'the staff note must appear exactly once, never duplicated by repeated syncs');
  });

  await test('5. a THIRD, genuinely new revision (channel notes now empty) still preserves the staff note -- an empty OTA note must never erase existing content', async () => {
    ctx.adapter.put(booking({ revision: '2026-09-09T12:00:00Z', special_requests: '', notes: '', units: booking().units }));
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T12:00:00Z' }) });
    assert.strictEqual(r.result, 'modified');
    const d = await ctx.store.get('reservations', 'OTA-mock-N1');
    assert.match(d.notes, /Vegetarian breakfast requested/, 'an empty incoming channel note must never wipe an existing staff note');
    const occurrences = (d.notes.match(/Vegetarian breakfast requested/g) || []).length;
    assert.strictEqual(occurrences, 1);
  });

  await test('6. internal_note is never touched by any of this -- ingest.js never references it, and writeReservationTx merges (never replaces)', async () => {
    const d0 = await ctx.store.get('reservations', 'OTA-mock-N1');
    await ctx.store.set('reservations', 'OTA-mock-N1', Object.assign({}, d0, { internal_note: 'Balance pending, manager approved discount' }), { merge: true });
    ctx.adapter.put(booking({ revision: '2026-09-09T13:00:00Z', special_requests: 'airport pickup 14:00', units: booking().units }));
    const r = await ingestEvent({ store: ctx.store, adapter: ctx.adapter, event: ev({ type: 'modify', revision: '2026-09-09T13:00:00Z' }) });
    assert.strictEqual(r.result, 'modified');
    const d = await ctx.store.get('reservations', 'OTA-mock-N1');
    assert.strictEqual(d.internal_note, 'Balance pending, manager approved discount', 'internal_note must be completely unaffected by OTA note-preservation logic');
    assert.match(d.notes, /Vegetarian breakfast requested/);
    assert.match(d.notes, /airport pickup 14:00/);
  });

  await test('unit: buildFields() called with no `ex` (a brand-new reservation) never throws and never fabricates a staff note', () => {
    const b = booking();
    const fields = buildFields(b, b.units[0], 0, 'mock', 'VR03', '2026-09-09T10:00:00Z', undefined);
    assert(!new RegExp('\\[' + STAFF_NOTE_LABEL + '\\]').test(fields.notes));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
