// Firestore rules verification for the new ota_room_types /
// ota_room_type_overrides collections (Beds24 pre-integration stage).
// Emulator only -- never touches production. Run:
//   firebase emulators:exec --only firestore --project vilu-residence "node test/ota/ota-room-types-rules-repro.js"
//
// Proves, per collection, all six required cases rather than assuming safety
// because the rules follow the room_prices/room_details pattern:
//   1. anonymous read     -> DENIED
//   2. anonymous write    -> DENIED
//   3. authenticated non-staff guest read  -> DENIED
//   4. authenticated non-staff guest write -> DENIED
//   5. authorized staff/admin read  -> ALLOWED
//   6. authorized staff/admin write -> ALLOWED
const host = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const project = 'vilu-residence';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner' }; // emulator: bypasses rules, used only to seed fixtures

// Firestore emulator decodes JWT claims without verifying the signature, so a
// locally-built, unsigned token is sufficient to simulate a given auth.uid /
// auth.token.email for rules testing -- this never touches real Firebase Auth
// or production data.
function fakeIdToken(payload) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = { alg: 'none', typ: 'JWT' };
  const full = Object.assign({ iss: `https://securetoken.google.com/${project}`, aud: project, auth_time: Math.floor(Date.now() / 1000), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, payload);
  return `${b64url(header)}.${b64url(full)}.`;
}
const ADMIN_UID = 'admin-test-uid';
const STAFF_UID = 'staff-test-uid';
const GUEST_UID = 'guest-test-uid';
const ADMIN = { Authorization: 'Bearer ' + fakeIdToken({ sub: ADMIN_UID, user_id: ADMIN_UID, email: 'viluresidence@gmail.com', email_verified: true }) };
const STAFF = { Authorization: 'Bearer ' + fakeIdToken({ sub: STAFF_UID, user_id: STAFF_UID, email: 'staffer@example.com', email_verified: true }) };
const GUEST = { Authorization: 'Bearer ' + fakeIdToken({ sub: GUEST_UID, user_id: GUEST_UID, email: 'randomguest@example.com', email_verified: true }) };

function fullName(path) { return `projects/${project}/databases/(default)/documents/${path}`; }
const str = (v) => ({ stringValue: v });

async function commit(writes, headers) {
  const r = await fetch(`${base}:commit`, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify({ writes }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function get(path, headers) {
  const r = await fetch(`${base}/${path}`, { headers: headers || {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('ok   ' + label); }
  else { failed++; console.log('FAIL ' + label + (detail ? '\n     ' + detail : '')); }
}

(async () => {
  // seed: staff_permissions doc for STAFF_UID (as isStaff() requires), and one
  // fixture doc in each of the two new collections, all via the OWNER bypass.
  await commit([{ update: { name: fullName('staff_permissions/' + STAFF_UID), fields: { role: str('staff') } } }], OWNER);
  await commit([{ update: { name: fullName('ota_room_types/double'), fields: { room_type_id: str('double'), base_rate: { integerValue: '90' } } } }], OWNER);
  await commit([{ update: { name: fullName('ota_room_type_overrides/double'), fields: { room_type_id: str('double') } } }], OWNER);

  for (const [collection, seededDoc] of [['ota_room_types', 'double'], ['ota_room_type_overrides', 'double']]) {
    const path = `${collection}/${seededDoc}`;
    const writePath = `${collection}/repro-write-${Date.now()}`;

    const anonRead = await get(path);
    check(`${collection}: anonymous read DENIED`, anonRead.status === 403, 'status=' + anonRead.status);

    const anonWrite = await commit([{ update: { name: fullName(writePath), fields: { probe: str('x') } } }]);
    check(`${collection}: anonymous write DENIED`, anonWrite.status === 403, 'status=' + anonWrite.status);

    const guestRead = await get(path, GUEST);
    check(`${collection}: authenticated non-staff guest read DENIED`, guestRead.status === 403, 'status=' + guestRead.status);

    const guestWrite = await commit([{ update: { name: fullName(writePath), fields: { probe: str('x') } } }], GUEST);
    check(`${collection}: authenticated non-staff guest write DENIED`, guestWrite.status === 403, 'status=' + guestWrite.status);

    const staffRead = await get(path, STAFF);
    check(`${collection}: authorized staff read ALLOWED`, staffRead.status === 200, 'status=' + staffRead.status + ' body=' + JSON.stringify(staffRead.body).slice(0, 200));

    const adminWrite = await commit([{ update: { name: fullName(writePath), fields: { probe: str('x') } } }], ADMIN);
    check(`${collection}: authorized admin write ALLOWED`, adminWrite.status === 200, 'status=' + adminWrite.status + ' body=' + JSON.stringify(adminWrite.body).slice(0, 200));

    const staffWrite = await commit([{ update: { name: fullName(writePath + '-staff'), fields: { probe: str('x') } } }], STAFF);
    check(`${collection}: authorized staff write ALLOWED`, staffWrite.status === 200, 'status=' + staffWrite.status + ' body=' + JSON.stringify(staffWrite.body).slice(0, 200));

    const adminRead = await get(path, ADMIN);
    check(`${collection}: authorized admin read ALLOWED`, adminRead.status === 200, 'status=' + adminRead.status);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' ota-room-types rules assertions passed');
  process.exit(failed ? 1 : 0);
})();
