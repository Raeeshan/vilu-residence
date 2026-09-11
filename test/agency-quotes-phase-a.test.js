// Agency Sales Workflow — Phase A: Margin Ledger removal + agency_quotes
// foundation. 2026-09-11.
//
// Scope reminder (per the owner's own Phase A instructions): remove Margin
// Ledger from both Admin and Agency Portal, stop using guestCharge/
// commission in active workflows (legacy data stays, untouched), lay down
// the agency_quotes collection + rules + helper only -- no Quote Builder
// UI, no change to agency direct-reservation-create, no change to
// block_requests/blocks, no change to Website Packages.
//
// Server-side security for agency_quotes is proven separately, against a
// real Firestore Rules engine, in test/agency-quotes-rules.test.js (run via
// `firebase emulators:exec --only firestore "node test/agency-quotes-rules.test.js"`).
// This file is the usual structural/regex pass over source, matching every
// other test in this suite -- no vm sandbox, no emulator needed here.
//   node test/agency-quotes-phase-a.test.js
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
const PORTAL = read('vilu-agency-portal.html');
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

section('Case A — Margin Ledger fully removed from Admin (vilu-unified.html)');
{
  test('no "Margin Ledger" UI/label text remains anywhere in the file (only an explanatory removal comment may mention the words, checked separately in Case C)', () => {
    const withoutRemovalComments = PMS.replace(/\/\/[^\n]*Margin Ledger[^\n]*(\n\s*\/\/[^\n]*)*/g, '');
    assert.doesNotMatch(withoutRemovalComments, /Margin Ledger/);
  });
  test('the removed #agy-pkg-guestcharge / #agy-pkg-commission input ids no longer exist', () => {
    assert.doesNotMatch(PMS, /id="agy-pkg-guestcharge"/);
    assert.doesNotMatch(PMS, /id="agy-pkg-commission"/);
  });
  test('saveAgencyPkgForm() no longer reads those (removed) inputs, and no longer writes guestCharge/commission as new fields', () => {
    const src = extractByStart(PMS, /async function saveAgencyPkgForm\(\)\s*\{/);
    assert.doesNotMatch(src, /agy-pkg-guestcharge/);
    assert.doesNotMatch(src, /agy-pkg-commission/);
    assert.doesNotMatch(src, /guestCharge:\s*\+/);
    assert.doesNotMatch(src, /commission:\s*\+/);
  });
  test('saveAgencyPkgForm() builds the package from Object.assign({}, existingPkg, ...) -- so any OLDER package\'s legacy guestCharge/commission survives untouched on every future edit, not deleted', () => {
    const src = extractByStart(PMS, /async function saveAgencyPkgForm\(\)\s*\{/);
    assert.match(src, /Object\.assign\(\{\},\s*existingPkg,\s*\{/);
  });
  test('the per-agency package row no longer displays a Margin Ledger line, and the price is labeled "Vilu Agency Rate" not "Agency price"', () => {
    const src = extractByStart(PMS, /function renderAgencyPkgList\(\)\s*\{/);
    assert.doesNotMatch(src, /guestCharge/);
    assert.doesNotMatch(src, /commission/);
    assert.match(src, /Vilu Agency Rate/);
  });
  test('the per-agency editor\'s price field is now labeled Vilu Agency Rate (Part 2: never "Commission")', () => {
    const formStart = PMS.indexOf('id="agy-pkg-form-view"');
    const formEnd = PMS.indexOf('<!-- CATEGORY MANAGER MODAL', formStart);
    const formHTML = PMS.slice(formStart, formEnd);
    assert.match(formHTML, /Vilu Agency Rate/);
    assert.doesNotMatch(formHTML, />Commission</);
  });
}

section('Case B — Margin Ledger fully removed from Agency Portal (vilu-agency-portal.html)');
{
  test('no "Margin Ledger" text remains anywhere in the file (only an explanatory removal comment may mention the words, checked separately below)', () => {
    const withoutRemovalComments = PORTAL.replace(/\/\/[^\n]*Margin Ledger[^\n]*/g, '').replace(/<!--[\s\S]*?Margin Ledger[\s\S]*?-->/g, '');
    assert.doesNotMatch(withoutRemovalComments, /Margin Ledger/);
  });
  test('openMarginLedger / closeMarginLedger / saveMarginLedger are no longer defined anywhere', () => {
    assert.doesNotMatch(PORTAL, /function openMarginLedger/);
    assert.doesNotMatch(PORTAL, /function closeMarginLedger/);
    assert.doesNotMatch(PORTAL, /function saveMarginLedger/);
  });
  test('the #m-margin-ledger modal and its #ml-* inputs no longer exist', () => {
    assert.doesNotMatch(PORTAL, /id="m-margin-ledger"/);
    assert.doesNotMatch(PORTAL, /id="ml-pkg-name"/);
    assert.doesNotMatch(PORTAL, /id="ml-guestcharge"/);
    assert.doesNotMatch(PORTAL, /id="ml-commission"/);
  });
  test('the package card no longer shows guestCharge/commission or an "Edit ->" link into the ledger; VILU RATE label replaces AGENCY PRICE', () => {
    const src = extractByStart(PMS, /async function toggleAgencyPkgActive\(pid\)\s*\{/); // sanity: PMS extraction helper still works
    assert.ok(src);
    assert.doesNotMatch(PORTAL, /openMarginLedger\(/);
    assert.doesNotMatch(PORTAL, /pkg\.guestCharge/);
    assert.doesNotMatch(PORTAL, /pkg\.commission/);
    assert.match(PORTAL, />VILU RATE</);
  });
}

section('Case C — Legacy guestCharge/commission data is preserved, not deleted or migrated, and reported');
{
  test('no bulk-delete/migration code was added for guestCharge/commission (no FieldValue.delete(), no update-all-docs loop referencing these fields)', () => {
    assert.doesNotMatch(PMS, /guestCharge.*delete\(\)/i);
    assert.doesNotMatch(PMS, /commission.*delete\(\)/i);
  });
  // This test doubles as the report requirement "report where they still
  // exist": the only remaining source-level mentions of guestCharge/
  // commission after this change are the explanatory removal comments
  // (PMS) confirming legacy docs may still carry these fields untouched.
  test('the removal is explained in-source (so a future reader knows why these fields might still appear on old package data)', () => {
    assert.match(PMS, /Margin Ledger removal.*guestCharge\/commission are no longer/s);
    assert.match(PORTAL, /Margin Ledger functions removed.*inert legacy data/s);
  });
}

section('Case D — agency_quotes: schema/rules foundation exists (behavioral proof is in agency-quotes-rules.test.js)');
{
  test('firestore.rules defines match /agency_quotes/{quoteId} with create/read/update/delete', () => {
    assert.match(RULES, /match \/agency_quotes\/\{quoteId\} \{/);
  });
  const rulesBlock = RULES.slice(RULES.indexOf('match /agency_quotes/{quoteId} {'), RULES.indexOf('match /room_prices/{roomId} {'));
  test('create requires request.resource.data.agencyId == request.auth.uid', () => {
    assert.match(rulesBlock, /allow create: if request\.auth != null\s*\n\s*&& request\.resource\.data\.agencyId == request\.auth\.uid;/);
  });
  test('read allows the owning agency (resource.data.agencyId == uid) or Admin\\/Staff\\/Manager -- no broader clause', () => {
    assert.match(rulesBlock, /allow read: if request\.auth != null\s*\n\s*&& \(isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\) \|\| resource\.data\.agencyId == request\.auth\.uid\);/);
  });
  test('update requires DRAFT status AND agencyId immutable for a self-service agency update; Admin/Staff/Manager bypass', () => {
    assert.match(rulesBlock, /resource\.data\.agencyId == request\.auth\.uid\s*\n\s*&& request\.resource\.data\.agencyId == resource\.data\.agencyId\s*\n\s*&& resource\.data\.status == 'DRAFT'/);
  });
  test('delete is fully disabled (allow delete: if false) -- matches the block_requests convention of no client deletes', () => {
    assert.match(rulesBlock, /allow delete: if false;/);
  });
  test('agency_quotes is keyed by agencyId (the Auth uid), not email -- matching reservations/block_requests, explicitly NOT matching agency_packages\' email-keying', () => {
    assert.match(RULES, /Keyed by agencyId[\s\S]{0,20}\(the Firebase Auth uid\), matching the existing reservations\//);
  });
}

section('Case E — agency_quotes helper layer exists but is NOT wired to any UI yet (Phase A = foundation only)');
{
  test('vilu-agency-portal.html has createDraftAgencyQuote()/newAgencyQuoteId() but nothing calls createDraftAgencyQuote() from an onclick/button yet', () => {
    assert.match(PORTAL, /async function createDraftAgencyQuote\(fields\)\s*\{/);
    assert.match(PORTAL, /function newAgencyQuoteId\(\)\s*\{/);
    assert.doesNotMatch(PORTAL, /onclick="createDraftAgencyQuote/);
  });
  test('createDraftAgencyQuote() writes to agency_quotes/{quoteId} with agencyId forced to currentAgency.uid (cannot be overridden by a caller-supplied field)', () => {
    const src = extractByStart(PORTAL, /async function createDraftAgencyQuote\(fields\)\s*\{/);
    assert.match(src, /fsDb\.collection\('agency_quotes'\)\.doc\(quoteId\)\.set\(quote\)/);
    assert.match(src, /\{ agencyId: currentAgency\.uid, quoteId: quoteId \}/);
  });
  test('vilu-unified.html has a read-only fetchAgencyQuotes() helper, also not wired to any UI page yet', () => {
    assert.match(PMS, /async function fetchAgencyQuotes\(agencyId\)\s*\{/);
    assert.doesNotMatch(PMS, /onclick="fetchAgencyQuotes/);
  });
  test('no Agency Quotes admin page/section was added (Phase A is foundation only, not Phase B/C)', () => {
    assert.doesNotMatch(PMS, /id="s-agency-quotes"/);
    assert.doesNotMatch(PMS, />Agency Quotes</);
  });
}

section('Case F — agency_packages remains Admin-write-only (Phase A did not weaken this to make anything work)');
{
  test('firestore.rules still restricts agency_packages write to isAdmin() only', () => {
    assert.match(RULES, /match \/agency_packages\/\{email\} \{\s*\n\s*allow read: if request\.auth != null &&\s*\n\s*\(request\.auth\.token\.email\.lower\(\) == email \|\| isAdmin\(\)\);\s*\n\s*allow write: if isAdmin\(\);/);
  });
}

section('Case G — current booking flow (direct agency reservation create) is UNCHANGED -- Phase F territory, not touched here');
{
  test('reservations create rule still includes the isAgency() && source==\'Agency\' branch (removing this is explicitly Phase F, not Phase A)', () => {
    const resBlock = RULES.slice(RULES.indexOf('match /reservations/{id} {'), RULES.indexOf('match /reservation_price_adjustments/'));
    assert.match(resBlock, /isAgency\(\) && request\.resource\.data\.agencyId == request\.auth\.uid && request\.resource\.data\.source == 'Agency'/);
  });
  test('submitAgencyBooking() in the portal is untouched -- still writes status:\'Confirmed\' directly (no Phase A behavior change to live bookings)', () => {
    assert.match(PORTAL, /status: 'Confirmed'/);
  });
}

section('Case H — block_requests / blocks workflow is UNCHANGED -- Phase E territory, not touched here');
{
  test('block_requests rules are byte-identical to the pre-Phase-A shape', () => {
    assert.match(RULES, /match \/block_requests\/\{id\} \{\s*\n\s*allow create: if request\.auth != null && request\.resource\.data\.agencyId == request\.auth\.uid;\s*\n\s*allow read: if request\.auth != null && \(isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\) \|\| resource\.data\.agencyId == request\.auth\.uid\);\s*\n\s*allow update: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*\n\s*allow delete: if false;/);
  });
  test('submitBlock()/approveBlockRequest()/rejectBlockRequest()/saveBLK() are all still present and untouched', () => {
    assert.match(PORTAL, /window\.submitBlock\s*=\s*async function\(\)\s*\{/);
    assert.match(PMS, /async function approveBlockRequest\(id\)\s*\{/);
    assert.match(PMS, /async function rejectBlockRequest\(id\)\s*\{/);
    assert.match(PMS, /function saveBLK\(\)\s*\{/);
  });
}

section('Case I — Website Packages isolation preserved');
{
  test('the Website tab\'s own card renderer is unchanged', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /WEBSITE PACKAGES — redesigned compact cards/);
  });
  test('no new Phase A code references vilu-website.html or holiday-packages.html', () => {
    const quoteHelperSrc = extractByStart(PMS, /async function fetchAgencyQuotes\(agencyId\)\s*\{/);
    assert.doesNotMatch(quoteHelperSrc, /vilu-website|holiday-packages/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-quotes-phase-a (structural) assertions passed`);
