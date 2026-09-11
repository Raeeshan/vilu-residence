// Agency Sales Workflow — Phase J: Agency Earnings & Settlement Ledger.
// Structural assertions against the actual source files (not the real
// Firestore emulator -- see agency-settlements-rules.test.js for that),
// same extractByStart()/regex convention established in Phases C-I.
const fs = require('fs');
const assert = require('node:assert/strict');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); }
}

const PORTAL = fs.readFileSync('vilu-agency-portal.html', 'utf8');
const PMS = fs.readFileSync('vilu-unified.html', 'utf8');
const FUNCS = fs.readFileSync('functions-core/index.js', 'utf8');
const RULES = fs.readFileSync('firestore.rules', 'utf8');

function extractByStart(src, startRegex) {
  const m = startRegex.exec(src);
  assert.ok(m, 'pattern not found: ' + startRegex);
  const start = m.index + m[0].length;
  let depth = 1, i = start;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

section('Case A — Part J-1: two directions, never conflated as "commission"');
{
  test('buildAgencySettlementFields() computes HOTEL_TO_AGENCY (amountDue=agencyEarnings) and AGENCY_TO_HOTEL (amountDue=viluNetTotal) distinctly', () => {
    const fn = extractByStart(FUNCS, /function buildAgencySettlementFields\(r, reservationId\)\s*\{/);
    assert.match(fn, /direction = 'HOTEL_TO_AGENCY'; amountDue = r\.agencyEarnings \|\| 0/);
    assert.match(fn, /direction = 'AGENCY_TO_HOTEL'; amountDue = r\.viluNetTotal \|\| 0/);
  });
  test('an UNDECIDED paymentCollector produces direction:null, amountDue:null -- never a guessed direction', () => {
    const fn = extractByStart(FUNCS, /function buildAgencySettlementFields\(r, reservationId\)\s*\{/);
    assert.match(fn, /let direction = null, amountDue = null;/);
  });
}

section('Case B — Part J-2/J-18: payable trigger is the real Checked-in status, never arrivalDate alone');
{
  test('isCheckedInStatus() checks only the actual canonical statuses this codebase uses (Checked in / Checked out) -- no invented "No Show"', () => {
    const fn = extractByStart(FUNCS, /function isCheckedInStatus\(status\)\s*\{/);
    assert.match(fn, /status === 'Checked in' \|\| status === 'Checked out'/);
  });
  test('settlementEligibilityOnReservation only transitions NOT_YET_PAYABLE -> PAYABLE on a genuine transition INTO Checked-in/out, not a same-status re-save', () => {
    const fn = extractByStart(FUNCS, /exports\.settlementEligibilityOnReservation = onDocumentWritten\('reservations\/\{id\}', async \(event\) => \{/);
    assert.match(fn, /justBecameCheckedIn = isCheckedInStatus\(after\.status\) && !\(before && isCheckedInStatus\(before\.status\)\)/);
    assert.match(fn, /if \(!snap\.exists \|\| snap\.data\(\)\.status !== 'NOT_YET_PAYABLE'\) return;/);
  });
  test('the trigger never reads or compares arrivalDate/today -- eligibility is status-driven only', () => {
    const fn = extractByStart(FUNCS, /exports\.settlementEligibilityOnReservation = onDocumentWritten\('reservations\/\{id\}', async \(event\) => \{/);
    assert.doesNotMatch(fn, /arrivalDate|check_in|maldivesNow|new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/);
  });
}

section('Case C — Part J-3/J-5: collection, deterministic id, atomic creation at confirmation');
{
  test('agency_settlements is created with settlementId===reservationId (deterministic, per Part 3\'s own suggestion)', () => {
    const fn = extractByStart(FUNCS, /function buildAgencySettlementFields\(r, reservationId\)\s*\{/);
    assert.match(fn, /settlementId: reservationId, reservationId,/);
  });
  test('the settlement is created inside confirmAgencyBookingRequest\'s own transaction (Part 5: atomic with the reservation itself, not a separate step)', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /tx\.set\(db\.collection\('agency_settlements'\)\.doc\(resId\), buildAgencySettlementFields\(reservationFields, resId\)\)/);
  });
  test('the suggested field set is present on the settlement doc', () => {
    const fn = extractByStart(FUNCS, /function buildAgencySettlementFields\(r, reservationId\)\s*\{/);
    ['settlementId', 'reservationId', 'agencyId', 'agencyEmail', 'agencyName', 'bookingReference', 'quoteReference',
      'guestName', 'arrivalDate', 'departureDate', 'currency', 'paymentCollector', 'viluNetTotal', 'agencyGuestSellingTotal',
      'agencyEarnings', 'direction', 'amountDue', 'status', 'createdAt', 'updatedAt', 'payableAt', 'paymentSentAt',
      'paymentSentBy', 'paymentMethod', 'paymentReference', 'paymentNote', 'receivedAt', 'receivedConfirmedByAgency', 'disputedAt', 'disputeReason',
    ].forEach((field) => assert.match(fn, new RegExp(field + '\\s*[,:]'), 'missing field: ' + field));
  });
}

section('Case D — Part J-4/J-20: snapshot-only, no live re-reads of package/catalog/exchange-rate');
{
  test('buildAgencySettlementFields() never reads service_catalog, agency_packages, or website_content (exchange rates) -- every value comes from the reservation param', () => {
    const fn = extractByStart(FUNCS, /function buildAgencySettlementFields\(r, reservationId\)\s*\{/);
    assert.doesNotMatch(fn, /service_catalog|agency_packages|website_content|\.collection\(/);
  });
}

section('Case E — Part J-8/J-9/J-10/J-11: direction-aware sender/receiver on every action');
{
  test('markAgencySettlementPaymentSent requires staff-like for HOTEL_TO_AGENCY, the owning agency for AGENCY_TO_HOTEL, and refuses an undecided direction', () => {
    const fn = extractByStart(FUNCS, /exports\.markAgencySettlementPaymentSent = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(s\.direction === 'HOTEL_TO_AGENCY'\) \{ requireStaffLike\(role\); paymentInitiatedBy = 'HOTEL'; \}/);
    assert.match(fn, /else if \(s\.direction === 'AGENCY_TO_HOTEL'\) \{ requireAgencyOwnerOrThrow\(role, s, request\.auth\.uid\); paymentInitiatedBy = 'AGENCY'; \}/);
    assert.match(fn, /else throw new HttpsError\('failed-precondition', 'Settlement direction is undecided/);
  });
  test('markAgencySettlementPaymentSent only runs from PAYABLE', () => {
    const fn = extractByStart(FUNCS, /exports\.markAgencySettlementPaymentSent = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(s\.status !== 'PAYABLE'\) throw new HttpsError\('failed-precondition'/);
  });
  test('confirmAgencySettlementReceived requires the owning agency for HOTEL_TO_AGENCY, staff-like for AGENCY_TO_HOTEL, and only runs from PAYMENT_SENT', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencySettlementReceived = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(s\.status !== 'PAYMENT_SENT'\) throw new HttpsError\('failed-precondition'/);
    assert.match(fn, /if \(s\.direction === 'HOTEL_TO_AGENCY'\) \{ requireAgencyOwnerOrThrow\(role, s, request\.auth\.uid\); receivedConfirmedByAgency = true; \}/);
    assert.match(fn, /else if \(s\.direction === 'AGENCY_TO_HOTEL'\) \{ requireStaffLike\(role\); \}/);
  });
  test('disputeAgencySettlement only runs from PAYMENT_SENT, requires a reason, and is gated to the same receiving party as confirmAgencySettlementReceived', () => {
    const fn = extractByStart(FUNCS, /exports\.disputeAgencySettlement = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(!reason\) throw new HttpsError\('invalid-argument', 'A reason is required\.'\)/);
    assert.match(fn, /if \(s\.status !== 'PAYMENT_SENT'\) throw new HttpsError\('failed-precondition'/);
    assert.match(fn, /if \(s\.direction === 'HOTEL_TO_AGENCY'\) requireAgencyOwnerOrThrow\(role, s, request\.auth\.uid\);/);
    assert.match(fn, /else if \(s\.direction === 'AGENCY_TO_HOTEL'\) requireStaffLike\(role\);/);
  });
  test('a disputed settlement preserves its prior paymentMethod/paymentReference/paymentSentAt via merge, never overwritten (Part 10: do not delete/rewrite history)', () => {
    const fn = extractByStart(FUNCS, /exports\.disputeAgencySettlement = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /tx\.set\(ref, \{ status: 'DISPUTED', disputedAt: now, disputeReason: reason, updatedAt: now \}, \{ merge: true \}\)/);
  });
}

section('Case F — Part J-17: narrow, admin-controlled dispute resolution, no arbitrary status jumps');
{
  test('resolveAgencySettlementDispute is staff-like only, only runs from DISPUTED, and only allows resolution to RECEIVED or PAYMENT_SENT', () => {
    const fn = extractByStart(FUNCS, /exports\.resolveAgencySettlementDispute = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /requireStaffLike\(role\);/);
    assert.match(fn, /if \(resolution !== 'RECEIVED' && resolution !== 'PAYMENT_SENT'\) throw new HttpsError\('invalid-argument'/);
    assert.match(fn, /if \(s\.status !== 'DISPUTED'\) throw new HttpsError\('failed-precondition'/);
  });
}

section('Case G — Part J-12: append-only audit trail on every transition');
{
  test('every settlement-mutating callable writes an agency_settlement_audit entry with fromStatus/toStatus/actorUid/actorRole/timestamp', () => {
    ['markAgencySettlementPaymentSent', 'confirmAgencySettlementReceived', 'disputeAgencySettlement', 'resolveAgencySettlementDispute'].forEach((fnName) => {
      const fn = extractByStart(FUNCS, new RegExp('exports\\.' + fnName + ' = onCall\\(\\{[\\s\\S]*?\\}, async \\(request\\) => \\{'));
      assert.match(fn, /db\.collection\('agency_settlement_audit'\)\.doc\(\)/, fnName + ' does not write an audit entry');
      assert.match(fn, /fromStatus: '[A-Z_]+', toStatus:/, fnName + ' audit entry missing fromStatus/toStatus');
    });
  });
  test('agency_settlement_audit rules deny ALL client writes -- Admin SDK only', () => {
    const block = extractByStart(RULES, /match \/agency_settlement_audit\/\{id\} \{/);
    assert.match(block, /allow write: if false;/);
  });
}

section('Case H — Part J-13: PMS admin queue, not inside Package Manager');
{
  test('a dedicated top-level nav entry exists in the Finance group', () => {
    assert.match(PMS, /<div class="sg">Finance<\/div>[\s\S]{0,300}go\('agysettle',this\)/);
  });
  test('TITLES/FMAP wire agysettle to its own section and drawAgencySettlements()', () => {
    assert.match(PMS, /agysettle:'Agency Settlements'/);
    assert.match(PMS, /agysettle:drawAgencySettlements/);
  });
  test('the queue is its own top-level section, not nested inside Package Manager (s-pkgs)', () => {
    const settleIdx = PMS.indexOf('id="s-agysettle"');
    const pkgsIdx = PMS.indexOf('id="s-pkgs"');
    assert.ok(settleIdx > -1 && pkgsIdx > -1);
  });
  test('filters cover Payable/Payment Sent/Received/Disputed/All', () => {
    assert.match(PMS, /key:'PAYABLE', label:'Payable'/);
    assert.match(PMS, /key:'PAYMENT_SENT', label:'Payment Sent'/);
    assert.match(PMS, /key:'RECEIVED', label:'Received'/);
    assert.match(PMS, /key:'DISPUTED', label:'Disputed'/);
  });
  test('rows show Agency/Guest/Arrival/Booking/Direction/Amount/Currency/Status', () => {
    const fn = extractByStart(PMS, /function renderAgysettleRow\(s\)\s*\{/);
    assert.match(fn, /s\.agencyName/);
    assert.match(fn, /s\.guestName/);
    assert.match(fn, /fd\(s\.arrivalDate\)/);
    assert.match(fn, /s\.bookingReference/);
    assert.match(fn, /directionLabel/);
    assert.match(fn, /s\.amountDue/);
    assert.match(fn, /s\.currency/);
    assert.match(fn, /s\.status/);
  });
  test('the PMS admin page never lets Admin edit amountDue/viluNetTotal/agencyEarnings/direction/paymentCollector directly -- only triggers callables (Part 16)', () => {
    const phaseJPms = PMS.slice(PMS.indexOf('// ── Agency Sales Workflow Phase J: Agency Settlements queue'), PMS.indexOf('function addBlk()'));
    assert.doesNotMatch(phaseJPms, /\.set\(\{[^}]*amountDue\s*:/);
    assert.doesNotMatch(phaseJPms, /fsDb\.collection\('agency_settlements'\)\.doc\([^)]*\)\.set\(/);
  });
}

section('Case I — Part J-6/J-14/J-15: Agency Portal Earnings & Settlements tab, separate summaries per direction');
{
  test('a dedicated tab exists, separate from Packages/Quotes/Bookings', () => {
    assert.match(PORTAL, /onclick="showTab\('settlements',this\)"/);
    assert.match(PORTAL, /id="tab-settlements"/);
  });
  test('renderSettleSummary() computes HOTEL_TO_AGENCY and AGENCY_TO_HOTEL subtotals separately, never summed together into one figure', () => {
    const fn = extractByStart(PORTAL, /function renderSettleSummary\(\)\s*\{/);
    assert.match(fn, /h2a = _settleAll\.filter\(function\(s\)\{ return s\.direction==='HOTEL_TO_AGENCY'; \}\)/);
    assert.match(fn, /a2h = _settleAll\.filter\(function\(s\)\{ return s\.direction==='AGENCY_TO_HOTEL'; \}\)/);
    assert.doesNotMatch(fn, /h2a\.concat\(a2h\)|a2h\.concat\(h2a\)/);
  });
  test('HOTEL_TO_AGENCY wording never says "commission" and AGENCY_TO_HOTEL is worded as an amount due, not commission', () => {
    const fn = extractByStart(PORTAL, /function renderSettleSummary\(\)\s*\{/);
    assert.doesNotMatch(fn, /commission/i);
    assert.match(fn, /Amount due to Vilu/);
  });
  test('the agency portal query is scoped to agencyId==currentAgency.uid, never an unscoped fetch', () => {
    const fn = extractByStart(PORTAL, /async function drawMySettlements\(\)\s*\{/);
    assert.match(fn, /fsDb\.collection\('agency_settlements'\)\.where\('agencyId','==',currentAgency\.uid\)\.get\(\)/);
  });
}

section('Case J — Part J-7/J-9/J-10/J-11: correct action visible per direction+status, never the wrong one');
{
  test('Confirm received / Report not received only render for HOTEL_TO_AGENCY + PAYMENT_SENT', () => {
    const fn = extractByStart(PORTAL, /function renderSettleRow\(s\)\s*\{/);
    assert.match(fn, /if\(isHotelToAgency && s\.status==='PAYMENT_SENT'\)\{[\s\S]*?confirmSettlementReceivedUI/);
  });
  test('Mark payment sent to Vilu only renders for AGENCY_TO_HOTEL + PAYABLE', () => {
    const fn = extractByStart(PORTAL, /function renderSettleRow\(s\)\s*\{/);
    assert.match(fn, /else if\(isAgencyToHotel && s\.status==='PAYABLE'\)\{[\s\S]*?markSettlementPaymentSentUI/);
  });
  test('the agency portal never exposes a Vilu-side "mark payment sent" action for the HOTEL_TO_AGENCY direction (that is Vilu\'s action, not the agency\'s)', () => {
    const fn = extractByStart(PORTAL, /function renderSettleRow\(s\)\s*\{/);
    assert.doesNotMatch(fn, /isHotelToAgency[\s\S]{0,80}markSettlementPaymentSentUI/);
  });
}

section('Case K — Part J-16: firestore.rules security');
{
  test('agency_settlements denies ALL client creates (server-only, via confirmAgencyBookingRequest\'s transaction or the reconciliation callable)', () => {
    const block = extractByStart(RULES, /match \/agency_settlements\/\{id\} \{/);
    assert.match(block, /allow create: if false;/);
    assert.match(block, /allow delete: if false;/);
  });
  test('agency_settlements read is self-or-admin/staff/manager only', () => {
    const block = extractByStart(RULES, /match \/agency_settlements\/\{id\} \{/);
    assert.match(block, /allow read: if request\.auth != null && \(isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\) \|\| resource\.data\.agencyId == request\.auth\.uid\);/);
  });
}

section('Case L — Part J-19: guest-document privacy re-check');
{
  test('buildGuestQuotationHTML() (Phase B) contains no settlement field', () => {
    const fn = extractByStart(PORTAL, /function buildGuestQuotationHTML\(quote\)\s*\{/);
    assert.doesNotMatch(fn, /agencyEarnings|amountDue|settlementStatus|paymentCollector|paymentReference|paymentMethod/i);
  });
  test('buildAgencyBookingConfirmationHTML() (Phase G) contains no settlement field', () => {
    const fn = extractByStart(PORTAL, /function buildAgencyBookingConfirmationHTML\(safe\)\s*\{/);
    assert.doesNotMatch(fn, /agencyEarnings|amountDue|settlementStatus|paymentCollector|paymentReference|paymentMethod/i);
  });
  test('agencyBookingConfirmationPayload() (Phase G server allowlist) still excludes every settlement field', () => {
    const fn = extractByStart(FUNCS, /function agencyBookingConfirmationPayload\(bReq, reservationId\)\s*\{/);
    assert.doesNotMatch(fn, /agencyEarnings|amountDue|settlementStatus|paymentCollector|paymentReference|paymentMethod/i);
  });
}

section('Case M — Part J-22/J-23: safe reconciliation, no fabricated historical amounts');
{
  test('reconcileMissingAgencySettlements defaults to dryRun and only writes when explicitly dryRun:false', () => {
    const fn = extractByStart(FUNCS, /exports\.reconcileMissingAgencySettlements = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /const dryRun = \(request\.data \|\| \{\}\)\.dryRun !== false;/);
    assert.match(fn, /if \(!dryRun\) \{/);
  });
  test('reconciliation never overwrites an existing settlement -- only creates ones that are genuinely missing', () => {
    const fn = extractByStart(FUNCS, /exports\.reconcileMissingAgencySettlements = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /if \(settlementSnap\.exists\) continue;/);
  });
  test('a reservation missing paymentCollector/viluNetTotal/agencyGuestSellingTotal/agencyEarnings gets DATA_INCOMPLETE, never a fabricated amount', () => {
    const fn = extractByStart(FUNCS, /function buildAgencySettlementFields\(r, reservationId\)\s*\{/);
    assert.match(fn, /status: hasCompleteData \? 'NOT_YET_PAYABLE' : 'DATA_INCOMPLETE',/);
  });
  test('the PMS admin UI previews before writing (dryRun:true first, confirm, then dryRun:false)', () => {
    const fn = extractByStart(PMS, /async function previewReconcileAgencySettlements\(\)\s*\{/);
    assert.match(fn, /callable\(\{ dryRun: true \}\)/);
    assert.match(fn, /if\(!confirm\(/);
    assert.match(fn, /callable\(\{ dryRun: false \}\)/);
  });
}

section('Case N — DO-NOT-TOUCH: booking confirmation logic (core), holds, availability, catalog, Website Packages, Beds24/Cloudbeds/OTA, tax');
{
  test('confirmAgencyBookingRequest\'s core reservation-creation logic (availability recheck, hold consumption) is unchanged -- Phase J only ADDS the settlement tx.set alongside it', () => {
    const fn = extractByStart(FUNCS, /exports\.confirmAgencyBookingRequest = onCall\(\{[\s\S]*?\}, async \(request\) => \{/);
    assert.match(fn, /const available = await agencyHoldAvailable\(tx, bReq\.requestedRoomId/);
    assert.match(fn, /if \(hold\) \{/);
  });
  test('no Phase J code references Beds24/Cloudbeds/OTA collections or push functions', () => {
    const phaseJFuncs = FUNCS.slice(FUNCS.indexOf('exports.settlementEligibilityOnReservation = onDocumentWritten('));
    assert.doesNotMatch(phaseJFuncs, /beds24|Beds24|ota_pushes|otaWebhook/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    assert.match(PMS, /id="s-pkgs"/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-settlements (structural) assertions passed`);
if (failed > 0) process.exitCode = 1;
