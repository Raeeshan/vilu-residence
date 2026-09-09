// Stage 0 reproduction: does an UNAUTHENTICATED public-website booking commit
// under the repository firestore.rules? The website's writeReservation()
// commits the reservation doc AND the room_availability lock in ONE
// transaction. Run inside the Firestore emulator only:
//   firebase emulators:exec --only firestore --project vilu-residence "node test/ota/stage0-website-rules-repro.js"
const host = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const project = 'vilu-residence';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner' }; // emulator: bypasses rules

async function commit(writes, headers) {
  const r = await fetch(`${base}:commit`, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify({ writes }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const str = (v) => ({ stringValue: v });
const num = (v) => ({ integerValue: String(v) });
function doc(path, fields) { return { update: { name: `${base.replace('http://' + host + '/v1/', '')}/${path}`.replace(/^projects/, 'projects'), fields } }; }
function fullName(path) { return `projects/${project}/databases/(default)/documents/${path}`; }

(async () => {
  // seed: an existing room_availability doc for VR01 (as production has)
  await commit([{ update: { name: fullName('room_availability/VR01'), fields: { bookings: { arrayValue: { values: [] } } } } }], OWNER);

  const resFields = { id: str('WEBTEST1'), room_id: str('VR01'), guest_name: str('Repro Test'), guest_email: str('repro@example.com'), guest_phone: str(''), guest_country: str(''), check_in: str('2027-08-01'), check_out: str('2027-08-03'), adults: num(2), children: num(0), rate: num(80), status: str('Pending'), source: str('Website') };
  const lockFields = { bookings: { arrayValue: { values: [{ mapValue: { fields: { id: str('WEBTEST1'), from: str('2027-08-01'), to: str('2027-08-03') } } }] } } };

  // 1. exactly what the website does: reservation + lock in one commit, no auth
  const both = await commit([
    { update: { name: fullName('reservations/WEBTEST1'), fields: resFields } },
    { update: { name: fullName('room_availability/VR01'), fields: lockFields } },
  ]);
  // 2. reservation alone, no auth (what the rules intend to allow)
  const resOnly = await commit([{ update: { name: fullName('reservations/WEBTEST2'), fields: Object.assign({}, resFields, { id: str('WEBTEST2') }) } }]);
  // 3. lock alone, no auth
  const lockOnly = await commit([{ update: { name: fullName('room_availability/VR01'), fields: lockFields } }]);

  const verdict = (both.status === 403 && resOnly.status === 200 && lockOnly.status === 403) ? 'CONFIRMED: website transaction (reservation + room_availability) is DENIED for unauthenticated clients because the room_availability write is denied; reservation-only create would be allowed' : 'UNEXPECTED — inspect statuses';
  console.log(JSON.stringify({ both: both.status, bothErr: both.body.error && both.body.error.message, resOnly: resOnly.status, lockOnly: lockOnly.status, lockErr: lockOnly.body.error && lockOnly.body.error.message, verdict }, null, 1));
  process.exit(both.status === 403 && resOnly.status === 200 && lockOnly.status === 403 ? 0 : 2);
})();
