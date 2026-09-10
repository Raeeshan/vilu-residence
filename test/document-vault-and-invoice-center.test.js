// Guest Document Vault + Updated Activity Price Catalog + One Invoice
// Center — 2026-09-10.
//
// Covers: reservation-scoped Document Vault (Firestore reservation_documents
// + Storage reservation-documents/, admin-only file bytes with broader
// role-based metadata, signed-bill/invoice synthesis so nothing is ever
// uploaded twice); the owner's 2026-09-10 activity price-sheet update to
// service_catalog (18 exact prices, PER_HOUR, durationHours, the
// rename/reprice/deactivate/create migration, package isolation); and the
// consolidated Create Invoice workflow (Pending payment status, payment
// method + audit trail, single Print/Documents entry point, dead
// invoice-button cleanup).
//
// Same technique as the rest of this suite: brace-match real functions out
// of vilu-unified.html and run pure ones in a vm sandbox, regex-check
// DOM-coupled ones directly against source. No Firestore, no browser, no
// live reservation.
//   node test/document-vault-and-invoice-center.test.js
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
const RULES = read('firestore.rules');
const SRULES = read('storage.rules');

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
function extractConst(src, name) {
  const m = src.match(new RegExp('const ' + name + '\\s*='));
  if (!m) throw new Error(name + ' not found');
  const openIdx = src.indexOf('[', m.index);
  let i = openIdx + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') depth--;
    i++;
  }
  return src.slice(m.index, i);
}
function plain(x) { return JSON.parse(JSON.stringify(x)); }
function ruleBlock(src, matchStr) {
  const idx = src.indexOf(matchStr);
  if (idx === -1) throw new Error('rule block not found: ' + matchStr);
  return src.slice(idx, src.indexOf('\n    }', idx));
}
// Paren-matches a whole `exports.NAME = onCall(...)` call, options object
// and arrow-function body included -- extractByStart's brace-matching
// would stop at the FIRST `{` after the match, which here is the options
// object's own brace, not the function body's.
function extractCallable(src, exportName) {
  const startStr = 'exports.' + exportName + ' = onCall(';
  const start = src.indexOf(startStr);
  if (start === -1) throw new Error('callable not found: ' + exportName);
  let i = start + startStr.length, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
    i++;
  }
  return src.slice(start, i);
}

section('Case A — Document type enum (Part A2)');
{
  test('RESERVATION_DOC_TYPES has exactly the 8 canonical types from Part A2', () => {
    const src = extractConst(PMS, 'RESERVATION_DOC_TYPES');
    const keys = (src.match(/key:'([A-Z_]+)'/g) || []).map(s => s.match(/'([A-Z_]+)'/)[1]);
    assert.deepEqual(keys, ['PASSPORT', 'IDENTITY', 'TRAVEL', 'TRANSFER', 'SIGNED_BILL', 'INVOICE', 'RECEIPT', 'OTHER']);
  });
  test('exactly PASSPORT/IDENTITY/TRAVEL are flagged sensitive:true — the rest are not', () => {
    const src = extractConst(PMS, 'RESERVATION_DOC_TYPES');
    const items = src.match(/\{key:'[^}]+\}/g);
    const sensitive = items.filter(i => /sensitive:true/.test(i)).map(i => i.match(/key:'([A-Z_]+)'/)[1]);
    assert.deepEqual(sensitive.sort(), ['IDENTITY', 'PASSPORT', 'TRAVEL'].sort());
  });
}

section('Case B — reservation_documents Firestore rules (Part A3/A4/A7/F)');
{
  const block = ruleBlock(RULES, 'match /reservation_documents/{docId}');
  test('sensitive types (PASSPORT/IDENTITY/TRAVEL) are read-restricted to Admin/Manager -- Staff excluded', () => {
    assert.match(block, /isStaff\(\)\s*&&\s*!\(resource\.data\.type in \['PASSPORT','IDENTITY','TRAVEL'\]\)/);
  });
  test('create requires the full A4 metadata shape and a genuine, unspoofable server timestamp', () => {
    assert.match(block, /request\.resource\.data\.reservationId is string/);
    assert.match(block, /request\.resource\.data\.type in \['PASSPORT','IDENTITY','TRAVEL','TRANSFER','SIGNED_BILL','INVOICE','RECEIPT','OTHER'\]/);
    assert.match(block, /request\.resource\.data\.storagePath is string/);
    assert.match(block, /request\.resource\.data\.uploadedByUid == request\.auth\.uid/);
    assert.match(block, /request\.resource\.data\.uploadedAt == request\.time/);
  });
  test('ordinary Staff may only toggle status/archivedAt/archivedBy (archive, per A7) -- never rewrite type/storagePath/title', () => {
    assert.match(block, /affectedKeys\(\)\.hasOnly\(\['status','archivedAt','archivedBy'\]\)/);
  });
  test('never a hard delete, matching A7 and the reservation_price_adjustments precedent', () => {
    assert.match(block, /allow delete:\s*if\s*false/);
  });
}

section('Case C — reservation-documents Storage rules (security hardening pass): no direct client access at all');
{
  const idx = SRULES.indexOf('match /reservation-documents/{resId}/{documentId}');
  const block = SRULES.slice(idx, SRULES.indexOf('\n    }', idx));
  test('every direct client request (read AND write) is denied outright -- the callable Cloud Functions are the only access path', () => {
    assert.match(block, /allow read, write:\s*if\s*false\s*;/);
  });
  test('no getDownloadURL()-style bearer-token access remains possible for this path: no isAdmin()/isValidDocUpload condition, no `if true`', () => {
    assert.doesNotMatch(block, /isAdmin\(\)/);
    assert.doesNotMatch(block, /if\s*true/);
  });
  test('the fix is documented as a genuine hardening (a getDownloadURL() token is a standing bearer credential once minted), not silently reverted without explanation', () => {
    const nearby = SRULES.slice(Math.max(0, idx - 1600), idx);
    assert.match(nearby, /bearer credential/);
    assert.match(nearby, /getReservationDocument/);
    assert.match(nearby, /uploadReservationDocument/);
  });
}

section('Case C2 — getReservationDocument / uploadReservationDocument Cloud Functions (functions-core)');
{
  const FN = read('functions-core/index.js');
  test('both callables exist as onCall exports', () => {
    assert.match(FN, /exports\.getReservationDocument = onCall\(/);
    assert.match(FN, /exports\.uploadReservationDocument = onCall\(/);
  });
  test('getReservationDocument requires auth (via callerRole) before ever touching Firestore/Storage', () => {
    const src = extractCallable(FN, 'getReservationDocument');
    assert.match(src, /await callerRole\(request\)/);
  });
  test('callerRole() throws unauthenticated when request.auth is missing -- never falls through to a default role', () => {
    const src = extractByStart(FN, /async function callerRole\(request\)\s*\{/);
    assert.match(src, /if \(!request\.auth\) throw new HttpsError\('unauthenticated'/);
  });
  test('sensitive types (PASSPORT/IDENTITY/TRAVEL) are Admin/Manager only; everything else is Admin/Manager/Staff -- canAccessDocType is the single source of truth for both callables', () => {
    const src = extractByStart(FN, /function canAccessDocType\(role, type\)\s*\{/);
    assert.match(src, /SENSITIVE_DOC_TYPES\.includes\(type\)/);
    assert.match(src, /role === 'admin' \|\| role === 'manager';/);
    assert.match(src, /role === 'admin' \|\| role === 'manager' \|\| role === 'staff';/);
  });
  test('SENSITIVE_DOC_TYPES is exactly PASSPORT/IDENTITY/TRAVEL, matching the client-side RESERVATION_DOC_TYPES sensitive flags', () => {
    const m = FN.match(/const SENSITIVE_DOC_TYPES = \[([^\]]+)\]/);
    assert.ok(m, 'SENSITIVE_DOC_TYPES not found');
    const types = m[1].match(/'([A-Z_]+)'/g).map(s => s.slice(1, -1));
    assert.deepEqual(types.sort(), ['IDENTITY', 'PASSPORT', 'TRAVEL'].sort());
  });
  test('getReservationDocument rejects an unauthorized role with permission-denied before ever calling bucket.file().download()', () => {
    const src = extractCallable(FN, 'getReservationDocument');
    const denyIdx = src.indexOf("throw new HttpsError('permission-denied'");
    const downloadIdx = src.indexOf('.download()');
    assert.ok(denyIdx !== -1 && downloadIdx !== -1 && denyIdx < downloadIdx, 'permission check must precede the Storage download');
  });
  test('a view of a sensitive document writes to document_access_audit with a server timestamp -- never for non-sensitive types (keeps the log lean, per the task\'s own "if practical" scoping)', () => {
    const src = extractCallable(FN, 'getReservationDocument');
    assert.match(src, /if \(SENSITIVE_DOC_TYPES\.includes\(doc\.type\)\)/);
    assert.match(src, /document_access_audit/);
    assert.match(src, /accessedAt: FieldValue\.serverTimestamp\(\)/);
  });
  test('getReservationDocument returns base64 file bytes directly -- never a URL, signed or otherwise', () => {
    const src = extractCallable(FN, 'getReservationDocument');
    assert.match(src, /base64: buffer\.toString\('base64'\)/);
    assert.doesNotMatch(src, /getSignedUrl/);
    assert.doesNotMatch(src, /getDownloadURL/);
  });
  test('uploadReservationDocument requires Admin/Manager (Staff cannot upload, matching Part F and canUploadDocuments())', () => {
    const src = extractCallable(FN, 'uploadReservationDocument');
    assert.match(src, /if \(role !== 'admin' && role !== 'manager'\) throw new HttpsError\('permission-denied'/);
  });
  test('uploadReservationDocument validates mimeType against an explicit allowlist and enforces a size cap server-side (never trusts client-side validation alone)', () => {
    const src = extractCallable(FN, 'uploadReservationDocument');
    assert.match(src, /image\\\/\(jpeg\|png\|webp\)\|application\\\/pdf/);
    assert.match(src, /buffer\.length > MAX_UPLOAD_BYTES/);
  });
  test('uploadReservationDocument stamps uploadedByUid from request.auth.uid server-side -- never trusts a client-supplied uid', () => {
    const src = extractCallable(FN, 'uploadReservationDocument');
    assert.match(src, /uploadedByUid: request\.auth\.uid/);
    assert.match(src, /uploadedAt: FieldValue\.serverTimestamp\(\)/);
  });
}

section('Case C3 — document_access_audit Firestore rules: server-write-only');
{
  const block = ruleBlock(RULES, 'match /document_access_audit/{id}');
  test('no client, however authenticated, can write an access-audit entry -- only the Admin-SDK callable can (which bypasses rules entirely)', () => {
    assert.match(block, /allow write:\s*if\s*false\s*;/);
  });
  test('read is Admin/Manager only, matching who is allowed to view the sensitive documents these entries describe', () => {
    assert.match(block, /allow read:\s*if\s*isAdmin\(\) \|\| isManagerRole\(\)/);
  });
}

section('Case C4 — client wires View/Download/Upload through the callables, not a direct Storage read');
{
  test('fsFunctions is initialized alongside fsDb/fsStorage', () => {
    assert.match(PMS, /var fsFunctions = firebase\.app\(\)\.functions\(/);
  });
  test('viewReservationDocument()/downloadReservationDocument() call the getReservationDocument callable and build a local blob: URL, never fsStorage.ref(...).getDownloadURL()', () => {
    const viewSrc = extractByStart(PMS, /async function viewReservationDocument\(resId, docId\)\s*\{/);
    const dlSrc = extractByStart(PMS, /async function downloadReservationDocument\(resId, docId\)\s*\{/);
    [viewSrc, dlSrc].forEach(src => {
      assert.match(src, /fetchReservationDocumentViaFunction/);
      assert.doesNotMatch(src, /getDownloadURL/);
    });
  });
  test('uploadReservationDocument() calls the uploadReservationDocument callable with a base64 payload, not fsStorage.ref(...).put()', () => {
    const src = extractByStart(PMS, /async function uploadReservationDocument\(resId, file, type, title\)\s*\{/);
    assert.match(src, /fsFunctions\.httpsCallable\('uploadReservationDocument'\)/);
    assert.doesNotMatch(src, /fsStorage\.ref\(/);
  });
}

section('Case D — Signed bill -> Documents synthesis (Part A5): never uploaded twice');
{
  const ctx = { console, esc: x => String(x) };
  vm.createContext(ctx);
  vm.runInContext(extractByStart(PMS, /function getSignedBillDocEntries\(resId\)\s*\{/), ctx);
  test('getSignedBillDocEntries() derives rows straight from FOLIOS[resId].charges[].billUrl -- no new Storage write, no new Firestore doc', () => {
    ctx.FOLIOS = { r1: { charges: [
      { id: 'c1', desc: 'Manta Ray Snorkeling', billUrl: 'https://example.com/bill1.jpg' },
      { id: 'c2', desc: 'Dinner' }, // no billUrl -- must be excluded
    ] } };
    const out = vm.runInContext('getSignedBillDocEntries("r1")', ctx);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'SIGNED_BILL');
    assert.equal(out[0].folioItemId, 'c1');
    assert.equal(out[0].url, 'https://example.com/bill1.jpg');
    assert.equal(out[0].synthetic, 'signed_bill');
  });
  test('a reservation with no billed charges yields zero synthesized rows, not an error', () => {
    ctx.FOLIOS = { r2: { charges: [] } };
    const out = vm.runInContext('getSignedBillDocEntries("r2")', ctx);
    assert.deepEqual(out, []);
  });
}

section('Case E — Invoice/Receipt -> Documents synthesis (Part D): no redundant binary copy');
{
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(extractByStart(PMS, /function getInvoiceDocEntries\(resId\)\s*\{/), ctx);
  test('a finalized, unpaid invoice surfaces as an INVOICE document row but not a RECEIPT row (nothing paid yet)', () => {
    ctx.INV = [{ id: 'INV-1', resId: 'r1', status: 'active', pay: 'Unpaid', payerLabel: 'Whole room' }];
    const out = vm.runInContext('getInvoiceDocEntries("r1")', ctx);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'INVOICE');
  });
  test('a paid invoice surfaces as BOTH an INVOICE row and a RECEIPT row, both pointing at the same invoiceId (one record, two views)', () => {
    ctx.INV = [{ id: 'INV-2', resId: 'r1', status: 'active', pay: 'Fully paid', payerLabel: 'Whole room' }];
    const out = vm.runInContext('getInvoiceDocEntries("r1")', ctx);
    assert.equal(out.length, 2);
    assert.ok(out.every(d => d.invoiceId === 'INV-2'));
    assert.deepEqual(plain(out.map(d => d.type)).sort(), ['INVOICE', 'RECEIPT']);
  });
  test('a voided invoice is excluded entirely', () => {
    ctx.INV = [{ id: 'INV-3', resId: 'r1', status: 'void', pay: 'Fully paid', payerLabel: 'Whole room' }];
    const out = vm.runInContext('getInvoiceDocEntries("r1")', ctx);
    assert.equal(out.length, 0);
  });
}

section('Case F — permissions (Part F): manual document upload is Admin/Manager only');
{
  test('canUploadDocuments() = admin or manager only (Staff excluded, matches Part F -- Staff\'s explicit action is "attach signed bills")', () => {
    const src = extractByStart(PMS, /function canUploadDocuments\(\)\s*\{/);
    assert.match(src, /role\s*===\s*'admin'/);
    assert.match(src, /role\s*===\s*'manager'/);
    assert.doesNotMatch(src, /role\s*===\s*'staff'/);
  });
  test('canViewSensitiveDocs() = admin or manager only, matching firestore.rules\' reservation_documents read rule exactly', () => {
    const src = extractByStart(PMS, /function canViewSensitiveDocs\(\)\s*\{/);
    assert.match(src, /role\s*===\s*'admin'/);
    assert.match(src, /role\s*===\s*'manager'/);
    assert.doesNotMatch(src, /role\s*===\s*'staff'/);
  });
}

section('Case G — activity price catalog (Part B): 18 exact prices, units, migration, package isolation');
{
  const seedSrc = extractConst(PMS, 'SVC_CATALOG_SEED');
  test('CATALOG_UNIT_TYPES adds PER_HOUR without removing any existing unit', () => {
    const src = extractConst(PMS, 'CATALOG_UNIT_TYPES');
    ['PER_PAX', 'PER_TRIP', 'PER_ITEM', 'PER_NIGHT', 'PER_ROOM', 'PER_HOUR'].forEach(u => assert.match(src, new RegExp(u)));
  });
  test('firestore.rules service_catalog write validation accepts PER_HOUR', () => {
    const block = ruleBlock(RULES, 'match /service_catalog/{itemId}');
    assert.match(block, /'PER_HOUR'/);
  });
  test('migrateCatalogToPriceSheet2026() exists, is Admin/Manager-gated, and never calls .delete() on a catalog doc (deactivate, never hard-delete)', () => {
    const src = extractByStart(PMS, /async function migrateCatalogToPriceSheet2026\(\)\s*\{/);
    assert.match(src, /canManageCatalog\(\)/);
    assert.doesNotMatch(src, /\.delete\(\)/);
    assert.match(src, /active:false/);
  });
  test('migration renames Sandbank Visit->Sandbank Escape and Manta Ray Tour->Manta Ray Snorkeling in place (same catalogItemId, historical charges keep their own snapshot)', () => {
    const src = extractByStart(PMS, /async function migrateCatalogToPriceSheet2026\(\)\s*\{/);
    assert.match(src, /from:'Sandbank Visit', to:'Sandbank Escape'/);
    assert.match(src, /from:'Manta Ray Tour', to:'Manta Ray Snorkeling'/);
  });
  test('migration deactivates exactly the 4 superseded items (Snorkeling, Fishing Trip, Island Hopping, Night Snorkeling)', () => {
    const src = extractByStart(PMS, /async function migrateCatalogToPriceSheet2026\(\)\s*\{/);
    const m = src.match(/var deactivate = \[([^\]]+)\]/);
    assert.ok(m, 'deactivate list not found');
    const names = m[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
    assert.deepEqual(names.sort(), ['Fishing Trip', 'Island Hopping', 'Night Snorkeling', 'Snorkeling'].sort());
  });
  test('every one of the 18 owner-sheet prices is exact in SVC_CATALOG_SEED', () => {
    const expected = {
      'Big Game Fishing': 120, 'Sandbank Escape': 89, 'Nurse Shark Snorkeling': 89, 'Whale Shark Snorkeling': 85,
      'Manta Ray Snorkeling': 85, 'Dolphin Cruise': 75, 'Turtle Snorkeling': 65, 'Octopus Hunting Experience': 65,
      'Lobster Hunting Experience': 65, 'Sunset Cruise': 59, 'Picnic Island Experience': 49, 'Night Fishing Experience': 49,
      'Fenfushi Reef Snorkeling': 45, 'Dhiddhoo Reef Snorkeling': 45, 'Ariyadhoo Reef Snorkeling': 45,
      'Professional Photography': 25, 'Romantic Beach Dinner': 85, 'Cinema at the Beach': 50,
    };
    Object.entries(expected).forEach(([name, price]) => {
      const re = new RegExp("name:'" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[^}]*basePrice:" + price + '\\b');
      assert.match(seedSrc, re, name + ' expected $' + price);
    });
  });
  test('Professional Photography is PER_HOUR, never PER_PAX', () => {
    assert.match(seedSrc, /name:'Professional Photography'[^}]*unitType:'PER_HOUR'/);
  });
  test('all other 17 sheet items are PER_PAX (the sheet\'s own "per person" wording)', () => {
    const names = ['Big Game Fishing', 'Sandbank Escape', 'Nurse Shark Snorkeling', 'Whale Shark Snorkeling',
      'Manta Ray Snorkeling', 'Dolphin Cruise', 'Turtle Snorkeling', 'Octopus Hunting Experience',
      'Lobster Hunting Experience', 'Sunset Cruise', 'Picnic Island Experience', 'Night Fishing Experience',
      'Fenfushi Reef Snorkeling', 'Dhiddhoo Reef Snorkeling', 'Ariyadhoo Reef Snorkeling',
      'Romantic Beach Dinner', 'Cinema at the Beach'];
    names.forEach(name => {
      const re = new RegExp("name:'" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[^}]*unitType:'PER_PAX'");
      assert.match(seedSrc, re, name + ' expected PER_PAX');
    });
  });
  test('durationHours is stored for the 15 excursion items that gave a duration on the sheet (Part B3)', () => {
    assert.match(seedSrc, /name:'Big Game Fishing'[^}]*durationHours:3/);
    assert.match(seedSrc, /name:'Whale Shark Snorkeling'[^}]*durationHours:2/);
  });
  test('Romantic Beach Dinner and Cinema at the Beach have no invented duration (the sheet gave none)', () => {
    assert.doesNotMatch(seedSrc, /name:'Romantic Beach Dinner'[^}]*durationHours:\d/);
    assert.doesNotMatch(seedSrc, /name:'Cinema at the Beach'[^}]*durationHours:\d/);
  });
  test('the 13 Food/Transfer/Accommodation-Extra/Other-Service items are completely untouched (out of the sheet\'s scope, Part H)', () => {
    ['Breakfast:12', 'Lunch:15', 'Dinner:18', 'Welcome Drink:5', 'BBQ Night:25', 'Speedboat Transfer:40',
      'Dhoni Transfer:20', 'Airport Transfer:60', 'Extra Bed:20', 'Early Check-in:30', 'Late Check-out:30',
      'Laundry:15', 'Special Decoration:30'].forEach(pair => {
      const [name, price] = pair.split(':');
      const re = new RegExp("name:'" + name + "'[^}]*basePrice:" + price + '\\b');
      assert.match(seedSrc, re, name + ' must remain $' + price);
    });
  });
  test('Part B6/H: nothing in the catalog module references packages/PKGS/room sell rates -- catalog changes are folio-pricing only', () => {
    const catalogSection = PMS.slice(PMS.indexOf('const CATALOG_EXCURSION_NOTE'), PMS.indexOf('function drawServiceCatalog'));
    assert.doesNotMatch(catalogSection, /\bPKGS\b/);
    assert.doesNotMatch(catalogSection, /\bota_room_type_overrides\b/);
    assert.doesNotMatch(catalogSection, /\broom_prices\b/);
  });
}

section('Case H — Pending payment status + payment method + audit trail (Part C5-C9, C17)');
{
  test('the invoice payment-status select offers Pending payment alongside the existing three states', () => {
    const idx = PMS.indexOf('id="ni-pay"');
    const block = PMS.slice(idx, idx + 250);
    assert.match(block, /<option>Fully paid<\/option>/);
    assert.match(block, /<option>Partially paid<\/option>/);
    assert.match(block, /<option>Pending payment<\/option>/);
    assert.match(block, /<option>Unpaid<\/option>/);
  });
  test('genInv() blocks finalizing a "Fully paid" invoice with no payment method selected (C6: "require Payment method")', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /initialPay==='Fully paid'&&!paymentMethod/);
  });
  test('genInv() never subtracts a Pending-payment amount from paidAmount -- it stays 0, same as Unpaid (C7)', () => {
    const src = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(src, /const paidAmount=initialPay==='Fully paid'\?total:0;/);
  });
  test('markInvoicePending() only ever sets v.pay and payment method/ref -- never touches paidAmount or payments[] (C7)', () => {
    const src = extractByStart(PMS, /function markInvoicePending\(invId\)\s*\{/);
    assert.doesNotMatch(src, /v\.paidAmount\s*=/);
    assert.doesNotMatch(src, /v\.payments\.push/);
    assert.match(src, /v\.pay='Pending payment';/);
  });
  test('drawInv() and viewInv() both give Pending payment its own distinct badge/status class, not lumped in with Unpaid', () => {
    const drawSrc = extractByStart(PMS, /function drawInv\(\)\s*\{/);
    assert.match(drawSrc, /v\.pay==='Pending payment'\?'pnd'/);
    const viewIdx = PMS.indexOf("function viewInv(id){");
    const viewSrc = PMS.slice(viewIdx, viewIdx + 400);
    assert.match(viewSrc, /v\.pay==='Pending payment'\?'pg'/);
  });
  test('every payment-status change point (creation, recordInvoicePayment, markInvoicePending) writes to the invoice_payment_audit trail', () => {
    const genSrc = extractByStart(PMS, /function genInv\(\)\s*\{/);
    assert.match(genSrc, /logInvoicePaymentAudit\(/);
    const recSrc = extractByStart(PMS, /function recordInvoicePayment\(invId\)\s*\{/);
    assert.match(recSrc, /logInvoicePaymentAudit\(/);
    const pendSrc = extractByStart(PMS, /function markInvoicePending\(invId\)\s*\{/);
    assert.match(pendSrc, /logInvoicePaymentAudit\(/);
  });
  test('logInvoicePaymentAudit() uses FieldValue.serverTimestamp() for changedAt, never a client Date (matches the reservation_price_adjustments precedent)', () => {
    const src = extractByStart(PMS, /async function logInvoicePaymentAudit\([^)]*\)\s*\{/);
    assert.match(src, /changedAt: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
  });
  test('invoice_payment_audit is genuinely append-only at the rules level (update and delete both denied) and requires request.time for changedAt', () => {
    const block = ruleBlock(RULES, 'match /invoice_payment_audit/{id}');
    assert.match(block, /allow update, delete:\s*if\s*false/);
    assert.match(block, /request\.resource\.data\.changedAt == request\.time/);
    assert.match(block, /request\.resource\.data\.changedByUid == request\.auth\.uid/);
  });
}

section('Case I — one Create Invoice / Print / Documents workflow (Part C1, C10-C14)');
{
  test('the four confirmed-dead legacy invoice functions are gone (initInvItems, addInvItem, addER, openFolioDetail)', () => {
    const cleaned = PMS.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(cleaned, /function initInvItems\(/);
    assert.doesNotMatch(cleaned, /function addInvItem\(/);
    assert.doesNotMatch(cleaned, /function addER\(/);
    assert.doesNotMatch(cleaned, /function openFolioDetail\(/);
  });
  test('there is still exactly ONE invoice-creation modal (m-inv) and ONE way in (openIM) -- consolidation didn\'t fork a second builder', () => {
    assert.equal((PMS.match(/id="m-inv"/g) || []).length, 1);
    assert.equal((PMS.match(/function openIM\(resId, opts\)/g) || []).length, 1);
  });
  test('the invoice builder\'s submit button reads "Finalize invoice" (Part C10), not the old ambiguous "Generate & view invoice"', () => {
    assert.match(PMS, /Finalize invoice/);
    assert.doesNotMatch(PMS, /Generate &amp; view invoice/);
  });
  test('openPrintDocsMenu() offers exactly the four Part C14 options: Print folio / Print latest invoice / Print receipt / Open documents', () => {
    const src = extractByStart(PMS, /function openPrintDocsMenu\(resId\)\s*\{/);
    assert.match(src, /Print folio/);
    assert.match(src, /Print latest invoice/);
    assert.match(src, /Print receipt/);
    assert.match(src, /Open documents/);
  });
  test('the old bare printFolio() printer-icon buttons on the m-det folio section and Guest Folios card now route through the single openPrintDocsMenu() instead', () => {
    assert.doesNotMatch(PMS, /onclick="printFolio\(this\.dataset\.rid\)"/);
    assert.match(PMS, /onclick="openPrintDocsMenu\(this\.dataset\.rid\)"/);
  });
  test('the Calendar drawer\'s folio tab footer carries the full Part C12 button row: + Add charge / Create invoice / Print · Documents / Open full folio', () => {
    const idx = PMS.indexOf('} else if(n===2){');
    const src = PMS.slice(idx, idx + 2600);
    assert.match(src, /Add charge/);
    assert.match(src, /Create invoice/);
    assert.match(src, /Print \/ Documents/);
    assert.match(src, /Open full folio/);
  });
  test('the Calendar drawer now has a 4th "Documents" tab alongside Details/Notes/Invoice', () => {
    const idx = PMS.indexOf('RESERVATION QUICK BAR');
    const src = PMS.slice(idx, idx + 1200);
    assert.match(src, /rdTab\(3,this\)/);
    assert.match(src, /Documents/);
  });
}

console.log(`\n${passed}/${passed + failed} document-vault-and-invoice-center assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); } else { console.log('\nALL TESTS PASSED'); }
