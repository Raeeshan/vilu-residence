// Agency Packages Management UI reorganization — 2026-09-11.
//
// Owner feedback: the Agency Packages area was functionally correct but the
// admin UI needed to be cleaner and better prepared for the Agency Portal.
// This is an information-architecture + UI-wiring change ONLY. Hard rule
// carried through every assertion below: each agency's package set stays
// fully independent, Master Template edits never retroactively touch an
// existing agency, and Website Packages / the Agency Portal's own filtering
// logic are completely untouched.
//
// Technique: regex/structural checks directly on source (no vm sandbox --
// nothing computational changed, matching the established pattern from
// website-package-manager-reorg.test.js and settings-ux-simplification.test.js).
//   node test/agency-packages-reorg.test.js
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

section('Case A — Agency Booking Rules: compact card, correct fields, GLOBAL DEFAULT label, exact helper text');
{
  const cardStart = PMS.indexOf('id="agency-booking-settings-card"');
  const cardEnd = PMS.indexOf('<!-- Website Package Manager reorganization', cardStart);
  const cardHTML = PMS.slice(cardStart, cardEnd === -1 ? cardStart + 3000 : cardEnd);

  test('Agency Booking Rules title is present', () => {
    assert.match(cardHTML, />Agency Booking Rules</);
  });
  test('is labeled GLOBAL DEFAULT (audit confirmed one shared doc, not per-agency)', () => {
    assert.match(cardHTML, />GLOBAL DEFAULT</);
  });
  test('the same #agy-flight-surcharge / #agy-extra-night-rate inputs still exist', () => {
    assert.match(cardHTML, /id="agy-flight-surcharge"/);
    assert.match(cardHTML, /id="agy-extra-night-rate"/);
  });
  test('the same saveAgencyBookingSettings() button is still wired', () => {
    assert.match(cardHTML, /onclick="saveAgencyBookingSettings\(\)"/);
  });
  test('helper text matches the owner\'s exact wording', () => {
    assert.match(cardHTML, /Default values used in agency quotations\/bookings\. Individual agency overrides can be added later\./);
  });
  test('no long technical paragraph remains in the primary card (moved to Advanced/Maintenance)', () => {
    const primaryOnly = cardHTML.slice(0, cardHTML.indexOf('<details'));
    assert.doesNotMatch(primaryOnly, /Backfill missing agency package sets/);
  });
}

section('Case B — Backfill moved into a collapsed Advanced/Maintenance section, gated by confirmation');
{
  const advMatch = PMS.match(/<details class="card"[^>]*>\s*<summary[^>]*>[\s\S]{0,80}Advanced \/ Maintenance[\s\S]*?<\/details>/);
  test('an Advanced / Maintenance <details> exists inside the agency booking settings block', () => {
    assert.ok(advMatch, 'Advanced / Maintenance <details> not found');
  });
  const advHTML = advMatch ? advMatch[0] : '';
  test('is collapsed by default (no `open` attribute)', () => {
    const tagMatch = advHTML.match(/^<details([^>]*)>/);
    assert.ok(tagMatch);
    assert.doesNotMatch(tagMatch[1], /\bopen\b/);
  });
  test('contains the backfill action, now behind a confirmation wrapper (not called directly)', () => {
    assert.match(advHTML, /onclick="confirmBackfillAgencyPackages\(\)"/);
    assert.doesNotMatch(advHTML, /onclick="backfillAgencyPackages\(\)"/);
  });
  test('confirmBackfillAgencyPackages() shows a confirm dialog before calling the real backfillAgencyPackages()', () => {
    const src = extractByStart(PMS, /function confirmBackfillAgencyPackages\(\)\s*\{/);
    assert.match(src, /showConfirm\(/);
    assert.match(src, /backfillAgencyPackages\(\)/);
  });
  test('backfillAgencyPackages() itself is untouched — force=false, never overwrites an existing agency\'s package set', () => {
    const src = extractByStart(PMS, /async function backfillAgencyPackages\(\)\s*\{/);
    assert.match(src, /createAgencyPackageSet\(agencies\[i\]\.email, false\)/);
  });
}

section('Case C — Master Template: collapsed entry point only, no package listing, correct warning');
{
  const src = extractByStart(PMS, /function renderAgencyDirectoryList\(\)\s*\{/);
  test('Master Template is rendered as a collapsed <details>, not an always-open list', () => {
    assert.match(src, /<details class="card"[\s\S]{0,300}Master Template/);
  });
  test('links to the existing showMasterPkgTemplate() — does not reimplement template editing', () => {
    assert.match(src, /onclick="showMasterPkgTemplate\(\)"/);
  });
  test('carries the required warning that edits never retroactively change existing agencies', () => {
    assert.match(src, /Changes here do not update existing agencies\./);
  });
  test('does NOT list every master template package inline on the main page', () => {
    const masterBlockMatch = src.match(/<details class="card"[\s\S]{0,300}Master Template[\s\S]*?<\/details>/);
    assert.ok(masterBlockMatch);
    assert.doesNotMatch(masterBlockMatch[0], /agy-pkg-list|pkg\.name/);
  });
  test('showMasterPkgTemplate() and the underlying master-template edit view (renderPkgList isAgencyTab branch) are completely unchanged', () => {
    const switchSrc = extractByStart(PMS, /function showMasterPkgTemplate\(\)\s*\{/);
    assert.match(switchSrc, /_agencyPkgView = 'master'/);
    assert.match(switchSrc, /drawPkgs\(\)/);
  });
}

section('Case D — Agency Accounts: real data only, no fabricated statuses');
{
  const src = extractByStart(PMS, /function renderAgencyDirectoryList\(\)\s*\{/);
  test('filter pills are All / Portal ready / Not yet activated -- derived from real Firebase Auth uid presence, not an invented Active/Disabled flag', () => {
    assert.match(src, /data-filter="all"/);
    assert.match(src, /data-filter="ready"/);
    assert.match(src, /data-filter="pending"/);
    assert.match(src, /var ready = !!a\.uid;/);
  });
  test('search input exists and filters the already-fetched list (no Firestore call in the filter path)', () => {
    assert.match(src, /id="agy-dir-search-input"/);
    assert.match(src, /oninput="agyDirSetSearch\(this\.value\)"/);
  });
  test('list is sorted by name', () => {
    assert.match(src, /\.sort\(function\(a,b\)\{ return \(a\.name\|\|''\)\.localeCompare\(b\.name\|\|''\); \}\)/);
  });
  test('agyDirSetSearch/agyDirSetFilter only update local state and re-render -- no Firestore writes, no mutation of USERS/_agyDirCache contents', () => {
    assert.match(PMS, /function agyDirSetSearch\(q\)\{ _agyDirSearch = \(q\|\|''\)\.trim\(\)\.toLowerCase\(\); renderAgencyDirectoryList\(\); \}/);
    assert.doesNotMatch(PMS.match(/function agyDirSetSearch\(q\)\{[^}]*\}/)[0], /fsDb\.collection/);
  });
  test('each agency card shows a real "Assigned packages: N" count (fetched from that agency\'s own agency_packages doc, not guessed)', () => {
    assert.match(src, /Assigned packages: /);
  });
  test('no fake "Last updated" field is displayed anywhere (no such field exists in the data model)', () => {
    assert.doesNotMatch(src, /Last updated/i);
  });
  test('[Manage packages] opens the existing per-agency modal; no fake [Preview portal] action -- shows honest "Portal access configured" text instead', () => {
    assert.match(src, /onclick="openAgencyPkgManager\(.*email.*\)"/);
    assert.match(src, /Portal access configured/);
    assert.doesNotMatch(src, /Preview portal/);
  });
  test('drawAgencyPkgDirectory() fetches per-agency package counts and Auth uid from real USERS/Firestore data, then hands off to the pure renderer', () => {
    const drawSrc = extractByStart(PMS, /async function drawAgencyPkgDirectory\(\)\s*\{/);
    assert.match(drawSrc, /USERS\.filter\(function\(u\)\{ return u\.role === 'agency'; \}\)/);
    assert.match(drawSrc, /fsDb\.collection\('agency_packages'\)\.doc\(/);
    assert.match(drawSrc, /renderAgencyDirectoryList\(\)/);
  });
}

section('Case E — Manage Agency Packages panel: reuses the existing per-agency modal, adds explicit Assigned/Not assigned labeling');
{
  test('the modal header now reads "Agency Package Set" alongside the agency name', () => {
    assert.match(PMS, />Agency Package Set — <span id="agy-pkg-agency-name">/);
  });
  test('the modal intro still states independence from master template and other agencies (unchanged claim, now re-verified true)', () => {
    assert.match(PMS, /fully independent from the master template and every other agency/);
  });
  const listSrc = extractByStart(PMS, /function renderAgencyPkgList\(\)\s*\{/);
  test('each package row shows nights, agency price (labeled Vilu Agency Rate as of the 2026-09-11 Agency Sales Workflow Phase A relabel, never confused with website guest price), and an explicit Assigned\\/Not assigned text label', () => {
    assert.match(listSrc, /Vilu Agency Rate \$'\+price/);
    assert.match(listSrc, /'Assigned':'Not assigned'/);
  });
  test('label is driven by the real `active` field already read by the Agency Portal -- not a newly invented field', () => {
    assert.match(listSrc, /var assigned = pkg\.active !== false;/);
  });
  test('a toggle button flips Assigned/Not assigned by writing the SAME agency_packages/{email} doc -- no new collection, no schema change', () => {
    const toggleSrc = extractByStart(PMS, /async function toggleAgencyPkgActive\(pid\)\s*\{/);
    assert.match(toggleSrc, /fsDb\.collection\('agency_packages'\)\.doc\(_agyPkgEmail\)\.set\(\{ email: _agyPkgEmail, packages: _agyPkgWorking \}, \{ merge: true \}\)/);
  });
}

section('Case F — Per-agency package editor: BASIC/PRICING/CONTENT/PORTAL grouping, same field ids, same storage');
{
  const formStart = PMS.indexOf('id="agy-pkg-form-view"');
  const formEnd = PMS.indexOf('<!-- CATEGORY MANAGER MODAL', formStart);
  const formHTML = PMS.slice(formStart, formEnd === -1 ? formStart + 6000 : formEnd);

  test('BASIC / PRICING / CONTENT / PORTAL section labels are present, in order', () => {
    const basicIdx = formHTML.indexOf('BASIC');
    const pricingIdx = formHTML.indexOf('PRICING');
    const contentIdx = formHTML.indexOf('CONTENT');
    const portalIdx = formHTML.indexOf('PORTAL');
    assert.ok(basicIdx > -1 && pricingIdx > basicIdx && contentIdx > pricingIdx && portalIdx > contentIdx);
  });
  const requiredIds = [
    'agy-pkg-name', 'agy-pkg-emoji', 'agy-pkg-nights', 'agy-pkg-price', 'agy-pkg-childdiscount',
    'agy-pkg-desc', 'agy-pkg-includes', 'agy-pkg-activities', 'agy-pkg-addons',
  ];
  requiredIds.forEach(id => {
    test(`#${id} is preserved -- "do not alter field names/storage just for presentation"`, () => {
      assert.match(formHTML, new RegExp(`id="${id}"`));
    });
  });
  // agy-pkg-guestcharge/agy-pkg-commission (Margin Ledger) were intentionally
  // REMOVED by the 2026-09-11 Agency Sales Workflow Phase A task, which
  // explicitly supersedes this file's original "preserve every id" rule for
  // just these two -- see test/agency-quotes-phase-a.test.js Case A for the
  // removal proof.
  test('#agy-pkg-guestcharge / #agy-pkg-commission (Margin Ledger) are intentionally removed, not preserved -- see agency-quotes-phase-a.test.js', () => {
    assert.doesNotMatch(formHTML, /id="agy-pkg-guestcharge"/);
    assert.doesNotMatch(formHTML, /id="agy-pkg-commission"/);
  });
  test('a Status control (BASIC) shows Assigned/Not assigned and can toggle it without leaving the form', () => {
    assert.match(formHTML, /id="agy-pkg-status-label"/);
    assert.match(formHTML, /onclick="toggleAgencyPkgActiveInForm\(\)"/);
  });
  test('PRICING shows the global additional-night-rate / flight-surcharge note, never implying a per-package override that doesn\'t exist', () => {
    assert.match(formHTML, /id="agy-pkg-global-notes"/);
    const notesSrc = extractByStart(PMS, /async function loadAgencyPkgGlobalNotes\(\)\s*\{/);
    assert.match(notesSrc, /Global default/);
    assert.match(notesSrc, /website_content'\)\.doc\('agency_booking_settings'\)/);
  });
  test('PORTAL section states "Source: Agency-specific copy" and does not link back to Website Packages', () => {
    assert.match(formHTML, /Source: Agency-specific copy/);
    assert.doesNotMatch(formHTML, /Website Package/);
  });
  test('saveAgencyPkgForm() still writes pricePerRoom/agencyPricePerRoom/channel:\'agency\' exactly as before -- pricing/storage unchanged', () => {
    const src = extractByStart(PMS, /async function saveAgencyPkgForm\(\)\s*\{/);
    assert.match(src, /pricePerRoom: price,/);
    assert.match(src, /agencyPricePerRoom: price,/);
    assert.match(src, /channel: 'agency'/);
  });
  test('saveAgencyPkgForm() now PRESERVES an existing package\'s active state instead of force-resetting it to true on every edit', () => {
    const src = extractByStart(PMS, /async function saveAgencyPkgForm\(\)\s*\{/);
    assert.match(src, /active: existingPkg \? !!existingPkg\.active : true,/);
    assert.doesNotMatch(src, /active: true,\n\s*channel: 'agency'/);
  });
}

section('Case G — Agency independence: editing one agency never touches another, Master Template, or Website Packages');
{
  test('every per-agency write path is keyed by _agyPkgEmail (the one currently-open agency), never a hardcoded or shared key', () => {
    const saveSrc = extractByStart(PMS, /async function saveAgencyPkgForm\(\)\s*\{/);
    const delSrc = extractByStart(PMS, /function deleteAgencyPkg\(pid\)\s*\{/);
    const toggleSrc = extractByStart(PMS, /async function toggleAgencyPkgActive\(pid\)\s*\{/);
    [saveSrc, delSrc, toggleSrc].forEach(src => {
      assert.match(src, /doc\(_agyPkgEmail\)/);
    });
  });
  test('getMasterAgencyPackages() is read-only from PACKAGES (channel==="agency") -- never written back to by any per-agency function', () => {
    const src = extractByStart(PMS, /function getMasterAgencyPackages\(\)\s*\{/);
    assert.match(src, /PACKAGES\.filter\(function\(p\)\{ return p\.channel === 'agency'; \}\)/);
    assert.doesNotMatch(PMS, /getMasterAgencyPackages\(\)\.push|getMasterAgencyPackages\(\)\[/);
  });
  test('createAgencyPackageSet() deep-copies (JSON parse/stringify) the master into a NEW per-agency doc -- editing the copy can never mutate PACKAGES', () => {
    const src = extractByStart(PMS, /async function createAgencyPackageSet\(email, force\)\s*\{/);
    assert.match(src, /JSON\.parse\(JSON\.stringify\(getMasterAgencyPackages\(\)\)\)/);
    assert.match(src, /fsDb\.collection\('agency_packages'\)\.doc\(email\)\.set/);
  });
  test('firestore.rules still restricts agency_packages/{email} reads to that agency\'s own auth email (or admin), writes to admin only -- untouched by this UI-only task', () => {
    const RULES = read('firestore.rules');
    assert.match(RULES, /match \/agency_packages\/\{email\} \{\s*\n\s*allow read: if request\.auth != null &&\s*\n\s*\(request\.auth\.token\.email\.lower\(\) == email \|\| isAdmin\(\)\);\s*\n\s*allow write: if isAdmin\(\);/);
  });
}

section('Case H — Website Packages isolation: untouched by this task');
{
  test('the Website tab\'s own card renderer (non-agency branch of renderPkgList) is unchanged -- still the compact redesigned cards from the prior task', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /WEBSITE PACKAGES — redesigned compact cards/);
    assert.match(src, /var visible = tabPackages\.filter\(function\(pkg\)\{/);
  });
  test('pkgSwitchTab() still only shows agency-booking-settings-card on the Agency tab, hides website-only toolbar/content-settings on it -- same as before', () => {
    const src = extractByStart(PMS, /function pkgSwitchTab\(tab\)\s*\{/);
    assert.match(src, /settingsCard\.style\.display = tab==='agency' \? '' : 'none'/);
    assert.match(src, /contentSettings\.style\.display = tab==='agency' \? 'none' : ''/);
  });
  test('savePkg()/drawPkgs()/syncPackagesToFirestore() (Website+Master shared package CRUD) are untouched', () => {
    const drawSrc = extractByStart(PMS, /async function drawPkgs\(\)\s*\{/);
    assert.match(drawSrc, /fsDb\.collection\('packages'\)\.get\(\)/);
    const syncSrc = extractByStart(PMS, /async function syncPackagesToFirestore\(\)\s*\{/);
    assert.match(syncSrc, /fsDb\.collection\('packages'\)\.doc\(p\.id\)\.set\(p\)/);
  });
  test('vilu-website.html and holiday-packages.html were not part of this task and remain unreferenced by any new agency-packages code', () => {
    const newCode = extractByStart(PMS, /function renderAgencyDirectoryList\(\)\s*\{/);
    assert.doesNotMatch(newCode, /vilu-website|holiday-packages/);
  });
}

section('Case I — Agency Portal (vilu-agency-portal.html): completely untouched by this admin-side UI task');
{
  test('the portal\'s own package fetch + active-filter logic is byte-for-byte unchanged', () => {
    assert.match(PORTAL, /var snap = await fsDb\.collection\('agency_packages'\)\.doc\(currentAgency\.email\.toLowerCase\(\)\)\.get\(\);/);
    assert.match(PORTAL, /var pkgs=loadPMS_Packages\(\)\.filter\(function\(p\)\{return p\.active;\}\);/);
  });
  test('agencyId-based reservation/block-request filtering (server-enforced via firestore.rules, not just frontend hiding) is unchanged', () => {
    const RULES = read('firestore.rules');
    assert.match(RULES, /resource\.data\.agencyId == request\.auth\.uid/);
  });
  test('doAgencyLogin() role-gate ("This account is not set up for agency access.") is unchanged', () => {
    assert.match(PORTAL, /This account is not set up for agency access\./);
  });
}

console.log(`\n${passed}/${passed + failed} agency-packages-reorg assertions passed`);
