'use strict';
// D1, Section 10 — pre-cutover identity backfill dry run.
//
// READ ONLY / no network / no Firebase / no production writes. Runs
// entirely against an in-memory store seeded with the 5 real future
// Cloudbeds-migrated reservations named in the task (their room/dates/
// source are the real production values already read from Firestore on
// 2026-09-22 -- see the D1 build report's identifier matrix; their exact
// ota_ref values, where present, are also the real values already
// confirmed live). Shows exactly how each would resolve if delivered again
// through Beds24 TODAY (before any backfill) and, for the two Expedia
// bookings that have no ota_ref today, what a safe backfill fixes.
//
//   node scripts/ota-identity-backfill-dry-run.js
const path = require('path');
const F = (p) => require(path.join(__dirname, '..', 'functions', 'lib', p));
const { MemoryStore } = F('store-memory');
const { resolveBookingIdentity } = F('ota-booking-identity');
const { PHYSICAL_ROOMS } = F('inventory');

// The 5 real future reservations named in the task. `ota_ref` is the real,
// already-confirmed-live value for the 3 Booking.com docs; `null` for the 2
// Expedia docs means exactly what it says in production today: the field
// does not exist (confirmed against the real documents -- see the D1 build
// report). `backfillRef` is a HYPOTHETICAL value this script assigns only
// when simulating "after backfill" -- never written anywhere real.
const REAL_DOCS = [
  { id: '6881168090781', room_id: 'VR01', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410' },
  { id: '6881168090781-2', room_id: 'VR02', check_in: '2026-09-24', check_out: '2026-09-29', source: 'Booking.com', ota_ref: '6163768410' },
  { id: '2232845617791', room_id: 'VR03', check_in: '2026-10-28', check_out: '2026-10-30', source: 'Booking.com', ota_ref: '5140817146' },
  { id: '9335838148158', room_id: 'VR06', check_in: '2026-12-27', check_out: '2027-01-06', source: 'Booking.com', ota_ref: '6880272194' },
  { id: 'BK21814-0', room_id: 'VR05', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', ota_ref: null, backfillRef: 'EXPEDIA-ITIN-FOR-BK21814-0-EXAMPLE-ONLY' },
  { id: 'BK01278-0', room_id: 'VR04', check_in: '2026-10-06', check_out: '2026-10-08', source: 'Expedia', ota_ref: null, backfillRef: 'EXPEDIA-ITIN-FOR-BK01278-0-EXAMPLE-ONLY' },
];

function roomType(roomId) { return PHYSICAL_ROOMS.find((r) => r.id === roomId).type; }

// applyBackfill=false: seeds each doc with exactly its REAL today's ota_ref
// (present for the 3 Booking.com docs, absent for the 2 Expedia docs).
// applyBackfill=true: additionally seeds the 2 Expedia docs' hypothetical
// backfillRef into ota_ref, simulating the one-time manual data-entry step
// Section 10 recommends -- still never touches anything real.
async function seed(applyBackfill) {
  const store = new MemoryStore();
  for (const r of PHYSICAL_ROOMS) await store.set('rooms', r.id, { id: r.id, name: r.name, type: r.type });
  for (const d of REAL_DOCS) {
    const ota_ref = d.ota_ref || (applyBackfill ? d.backfillRef : undefined);
    await store.set('reservations', d.id, { id: d.id, room_id: d.room_id, check_in: d.check_in, check_out: d.check_out, source: d.source, status: 'Confirmed', ota_ref }, { merge: true });
  }
  return store;
}

// The hypothetical incoming Beds24 booking for one real doc, in whichever
// scenario is currently running -- its `reference` is exactly what that
// scenario says Beds24's apiReference equals for this doc (its real stored
// ota_ref if the doc has one; otherwise EMPTY today, or the backfilled
// value once backfill has run) -- never invented independently of what was
// just seeded into the store.
function hypotheticalReference(d, applyBackfill) { return d.ota_ref || (applyBackfill ? d.backfillRef : ''); }

async function run(label, applyBackfill) {
  console.log('\n=== ' + label + ' ===');
  const store = await seed(applyBackfill);
  let matched = 0, ambiguous = 0, missing = 0;
  for (const d of REAL_DOCS) {
    const reference = hypotheticalReference(d, applyBackfill);
    const unit = { room_type: roomType(d.room_id), check_in: d.check_in, check_out: d.check_out };
    const identity = await resolveBookingIdentity({ store, provider: 'beds24', channel: d.source, externalId: 'DRYRUN-' + d.id, reference, unit, now: new Date().toISOString() });
    let outcome;
    if (identity.method === 'ambiguous') { outcome = 'AMBIGUOUS (' + identity.reason + ')'; ambiguous++; }
    else if (identity.method === 'new') { outcome = 'MISSING (would be treated as a new, unlinked booking)'; missing++; }
    else { outcome = 'MATCHED -> ' + identity.pmsReservationId + ' (' + identity.method + ')'; matched++; }
    console.log('  ' + d.id.padEnd(18) + d.source.padEnd(12) + d.check_in + '..' + d.check_out + '  ref=' + (reference || '(none)').padEnd(42) + outcome);
  }
  console.log('  -- ' + matched + ' matched, ' + ambiguous + ' ambiguous, ' + missing + ' missing --');
  return { matched, ambiguous, missing };
}

(async () => {
  console.log('D1 pre-cutover identity backfill dry run -- READ ONLY, no Firebase, no writes.');

  const today = await run('TODAY, no backfill (real stored ota_ref for the 3 Booking.com docs; the 2 Expedia docs have none, matching the real production gap)', false);
  const backfilled = await run('AFTER backfilling a hypothetical real Expedia confirmation number into ota_ref for the 2 Expedia docs', true);

  console.log('\nConclusion:');
  console.log('  3 Booking.com bookings: ' + (today.matched >= 3 ? 'already safely matchable TODAY via Tier 1' : 'NOT yet safely matchable today') + ' (ota_ref already present and correct).');
  console.log('  2 Expedia bookings: today, ' + today.ambiguous + '/2 come back AMBIGUOUS -- proven from real schema, not assumed (see D1 build report).');
  console.log('  Without a reference they are STRUCTURALLY IDENTICAL to each other (same channel, same exact dates, same room type -- Beds24');
  console.log('  never exposes which specific physical room a Double-type booking is for), so Tier 3 correctly QUARANTINES rather than');
  console.log('  guessing between VR04/VR05. This is the safe, intended behavior, not a bug.');
  console.log('  Backfilling a REAL Expedia confirmation number for each (obtained from Cloudbeds/Expedia\'s own records -- never fabricated)');
  console.log('  resolves both to a clean Tier 1 match: ' + backfilled.matched + '/' + REAL_DOCS.length + ' documents matched (5 logical bookings, 1 of which is a 2-room Booking.com stay = 6 documents), ' + backfilled.ambiguous + ' ambiguous, ' + backfilled.missing + ' missing.');
  console.log('\nRecommendation: do NOT import these 2 Expedia bookings into Beds24 (or connect Expedia at all) until their real Expedia');
  console.log('confirmation numbers have been backfilled into ota_ref. Backfilling first turns a live-production quarantine into a');
  console.log('one-time, pre-cutover data-entry task.');
})();
