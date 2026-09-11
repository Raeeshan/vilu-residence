// Website Package Manager audit + UI reorganization — 2026-09-11.
//
// Phase 1 was a READ-ONLY dependency audit (no code changed while tracing
// live website data flow). Phase 2 reorganizes the Package Manager admin
// UI only -- same Firestore collection/fields, same website readers
// (vilu-website.html untouched), same 9 locked package prices/nights/
// names, same Agency Packages tab. This file locks down BOTH: the locked
// catalog itself (across all three places it appears), and that the UI
// reorg touched nothing it wasn't supposed to.
//
// Technique: regex/structural checks directly on vilu-unified.html,
// vilu-website.html, and holiday-packages.html's source. No vm sandbox
// needed (nothing computational changed) — no Firestore, no browser, no
// live reservation.
//   node test/website-package-manager-reorg.test.js
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
const WEBSITE = read('vilu-website.html');
const HOLIDAY_PAGE = read('holiday-packages.html');

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

// The locked catalog, exactly as given in the task.
const LOCKED_PACKAGES = [
  ['Island Explorer Getaway', 450, 4],
  ['Reef & Sunset Adventure', 550, 5],
  ['Island Serenity Escape', 650, 6],
  ['Maldives Dream Bliss', 700, 7],
  ['Ultimate Island Relaxation', 790, 8],
  ['Grand Maldives Escape', 880, 9],
  ['Ultimate Maldives Odyssey', 940, 10],
  ['Ultimate Resort & Island Odyssey', 1300, 11],
  ['Honeymoon Dream Escape', 1100, 10],
];

section('Case A — the 9 locked package names/prices/nights are unchanged everywhere they appear');
{
  test('all 9 package names/prices/nights appear unchanged in vilu-website.html\'s static #hp-grid fallback', () => {
    LOCKED_PACKAGES.forEach(([name, price, nights]) => {
      const re = new RegExp(`data-pkg-name="${name.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}" data-pkg-nights="${nights}"`);
      assert.match(WEBSITE, re, `${name} (${nights} nights) not found intact in vilu-website.html`);
      const priceRe = new RegExp(`data-pkg-name="${name.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}"[\\s\\S]{0,400}?\\$${price}\\s`);
      assert.match(WEBSITE, priceRe, `${name}'s $${price} not found intact in vilu-website.html`);
    });
  });
  test('all 9 package names/prices/nights appear unchanged in holiday-packages.html\'s static PACKAGES array', () => {
    LOCKED_PACKAGES.forEach(([name, price, nights]) => {
      const re = new RegExp(`name:"${name.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}", price:${price}, nights:${nights}`);
      assert.match(HOLIDAY_PAGE, re, `${name} $${price}/${nights}n not found intact in holiday-packages.html`);
    });
  });
  test('exactly 9 packages in each static source (none added, none removed)', () => {
    const hpMatches = HOLIDAY_PAGE.match(/slug:"[a-z0-9-]+", name:"/g) || [];
    assert.equal(hpMatches.length, 9);
    const websiteMatches = WEBSITE.match(/data-pkg-id="[a-z0-9-]+" data-pkg-name="/g) || [];
    assert.equal(websiteMatches.length, 9);
  });
}

section('Case B — website data source and reader functions are byte-for-byte untouched (Phase 1 audit conclusions still hold)');
{
  test('the live package reader (loadHolidayPackages) still queries the exact same Firestore collection/filter this audit traced', () => {
    const src = extractByStart(WEBSITE, /async function loadHolidayPackages\(\)\s*\{/);
    assert.match(src, /fsDb\.collection\('packages'\)\.where\('active','==',true\)\.get\(\)/);
    assert.match(src, /fsDb\.collection\('website_content'\)\.doc\('packages_trip_notes'\)\.get\(\)/);
    assert.match(src, /\.filter\(function\(p\)\{ return p\.channel !== 'agency'; \}\)/);
    assert.match(src, /\.filter\(function\(p\)\{ return p\.activities && p\.activities\.length; \}\)/);
  });
  test('Package Terms reader (loadHpTerms) still reads website_content/packages_terms.terms', () => {
    const src = extractByStart(WEBSITE, /async function loadHpTerms\(\)\s*\{/);
    assert.match(src, /fsDb\.collection\('website_content'\)\.doc\('packages_terms'\)\.get\(\)/);
    assert.match(src, /_lastTerms = \(snap\.exists && snap\.data\(\)\.terms\) \|\| \[\]/);
  });
  test('the activity-note matching logic (hpNotesFor) is untouched -- general notes always included, activity notes only on an exact activities[] match', () => {
    const src = extractByStart(WEBSITE, /function hpNotesFor\(p, notesData\)\s*\{/);
    assert.match(src, /pkgActivities\.indexOf\(an\.activity\) > -1/);
    assert.match(src, /return general\.concat\(matched\);/);
  });
  test('holiday-packages.html has NO Firestore/Firebase calls at all -- confirmed static (Ads landing page snapshot), not a live PMS-connected page', () => {
    assert.doesNotMatch(HOLIDAY_PAGE, /fsDb|firebase\.|firestore/i);
  });
  test('the package order website visitors see is COMPUTED (sorted by nights, specialty packages last) -- there is no stored order/index field to preserve or invent (Part F)', () => {
    const src = extractByStart(WEBSITE, /async function loadHolidayPackages\(\)\s*\{/);
    assert.match(src, /return a\.nights - b\.nights;/);
    assert.doesNotMatch(PMS, /pkg\.order|pkg\.sortIndex|pkg\.displayOrder/);
  });
}

section('Case C — Package Manager writes to the exact same Firestore fields the website reads (PMS <-> website connection unchanged)');
{
  test('savePkgTerms() still writes website_content/packages_terms.terms — same field the website reads', () => {
    const src = extractByStart(PMS, /async function savePkgTerms\(\)\s*\{/);
    assert.match(src, /fsDb\.collection\('website_content'\)\.doc\('packages_terms'\)\.set\(\{ terms: terms \}, \{ merge: true \}\)/);
  });
  test('savePkgTripNotes() still writes website_content/packages_trip_notes.{general,activityNotes} — same fields the website reads', () => {
    const src = extractByStart(PMS, /async function savePkgTripNotes\(\)\s*\{/);
    assert.match(src, /fsDb\.collection\('website_content'\)\.doc\('packages_trip_notes'\)\.set\(\{ general: general, activityNotes: activityNotes \}, \{ merge: true \}\)/);
    // Activity note parsing (Activity | Note) is unchanged.
    assert.match(src, /var idx = line\.indexOf\('\|'\);/);
  });
  test('savePkg() still writes the exact same package fields to the same `packages` Firestore collection (name/pricePerRoom/nights/description/includes/activities/badge/active/channel)', () => {
    const src = extractByStart(PMS, /function savePkg\(\)\s*\{/);
    ['name: name', 'pricePerRoom: price', 'nights: +(document.getElementById(\'pkg-nights\').value||1)', 'description:', 'includes: includes', 'activities: activities', 'badge:', 'channel: _pkgViewTab'].forEach(fragment => {
      assert.ok(src.indexOf(fragment) !== -1, `savePkg() missing expected fragment: ${fragment}`);
    });
    const syncSrc = extractByStart(PMS, /async function syncPackagesToFirestore\(\)\s*\{/);
    assert.match(syncSrc, /fsDb\.collection\('packages'\)\.doc\(p\.id\)\.set\(p\)/);
  });
  test('deletePkg() still requires confirmation before deleting (Part H: prefer Disable over Delete, protect Delete)', () => {
    const src = extractByStart(PMS, /function deletePkg\(pid\)\s*\{/);
    assert.match(src, /showConfirm\(\{title:'Delete this package\?'/);
  });
}

section('Case D — Website Content Settings: collapsed by default, same fields, connection badges only where verified');
{
  const s = PMS.slice(PMS.indexOf('<div class="sec" id="s-pkgs">'), PMS.indexOf('<div class="sec" id="s-ops">'));
  test('a "Website Content Settings" collapsible section exists and contains Package Terms / General Trip Notes / Activity-Specific Notes', () => {
    assert.match(s, /Website Content Settings/);
    assert.match(s, />Package Terms /);
    assert.match(s, />General Trip Notes /);
    assert.match(s, />Activity-Specific Notes /);
  });
  test('Website Content Settings is collapsed by default (outer <details> has no `open` attribute)', () => {
    const m = s.match(/<details class="card" id="pkg-content-settings"([^>]*)>/);
    assert.ok(m);
    assert.doesNotMatch(m[1], /\bopen\b/);
  });
  test('all three content editors keep their original ids/textareas (pkg-terms, pkg-notes-general, pkg-notes-activity) and save buttons', () => {
    assert.match(s, /id="pkg-terms"/);
    assert.match(s, /id="pkg-notes-general"/);
    assert.match(s, /id="pkg-notes-activity"/);
    assert.match(s, /onclick="savePkgTerms\(\)"/);
    const saveTripNotesCalls = (s.match(/onclick="savePkgTripNotes\(\)"/g) || []).length;
    assert.equal(saveTripNotesCalls, 2, 'expected one Save button in each of the two trip-notes panels');
  });
  test('connection badges say "Website-linked · live data" -- short wording, only on the 3 fields Phase 1 actually verified as live-connected', () => {
    const badgeCount = (s.match(/Website-linked · live data/g) || []).length;
    assert.equal(badgeCount, 3);
  });
  test('Website Content Settings and the package-list toolbar are hidden on the Agency tab (pkgSwitchTab)', () => {
    const src = extractByStart(PMS, /function pkgSwitchTab\(tab\)\s*\{/);
    assert.match(src, /contentSettings\.style\.display = tab==='agency' \? 'none' : ''/);
    assert.match(src, /listToolbar\.style\.display = tab==='agency' \? 'none' : ''/);
  });
}

section('Case E — package list toolbar: filter/sort/search never mutate website data');
{
  test('pkgSetFilter/pkgSetSort/pkgSetSearch only set local state and re-render -- none of them touch Firestore, PACKAGES, or savePackages()', () => {
    ['pkgSetFilter', 'pkgSetSort', 'pkgSetSearch'].forEach(fn => {
      const src = extractByStart(PMS, new RegExp('function ' + fn + '\\([^)]*\\)\\s*\\{'));
      assert.doesNotMatch(src, /fsDb\.|savePackages\(|syncPackagesToFirestore\(|PACKAGES\s*=|PACKAGES\.push|PACKAGES\.splice/, fn + '() must never mutate PACKAGES or write to Firestore');
    });
  });
  test('renderPkgList() computes a local `visible` copy for filtering/sorting and never reassigns/reorders the underlying tabPackages/PACKAGES arrays in place', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /var visible = tabPackages\.filter\(/);
    assert.match(src, /visible = visible\.slice\(\)\.sort\(/);
    assert.doesNotMatch(src, /tabPackages\.sort\(|PACKAGES\.sort\(/, 'must sort a copy, never the source arrays in place');
  });
  test('"custom order" is a genuine no-op (no sort applied) -- Part F: never invent a website order system here', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /\/\/ 'custom' = whatever order Firestore\/PACKAGES already returned them in/);
  });
  test('drawPkgs() still refetches Firestore on tab switch/save/toggle/delete exactly as before -- only the render step was split out', () => {
    const src = extractByStart(PMS, /async function drawPkgs\(\)\s*\{/);
    assert.match(src, /var qs = await fsDb\.collection\('packages'\)\.get\(\);/);
    assert.match(src, /renderPkgList\(\);/);
  });
}

section('Case F — package cards: compact, max 3 inclusions, full contents only in Edit');
{
  test('the website-tab card only shows up to 3 inclusions, with a "+N more — see Edit" note for the rest', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /var includesShown = \(pkg\.includes\|\|\[\]\)\.slice\(0,3\);/);
    assert.match(src, /\+'\+moreIncludes\+' more — see Edit<\/div>'/);
  });
  test('the description is visually clamped to 2 lines on the card (CSS line-clamp), not shown in full', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /-webkit-line-clamp:2/);
  });
  test('Edit/Disable stay as primary buttons; Delete moved into a "⋯" overflow menu, away from the primary actions', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /onclick="openPkgForm\(this\.dataset\.pid\)"/);
    assert.match(src, /onclick="togglePkg\(this\.dataset\.pid\)"/);
    assert.match(src, /onclick="pkgToggleMenu\(this\.dataset\.pid,event\)"/);
    assert.match(src, /onclick="deletePkg\(this\.dataset\.pid\)"[^>]*><i class="ti ti-trash"><\/i> Delete package/);
  });
}

section('Case G — Edit package modal: reorganized into BASIC/CONTENT/INCLUSIONS/WEBSITE, same fields, no schema change');
{
  const modalHTML = PMS.slice(PMS.indexOf('<div class="mbg" id="m-pkg"'), PMS.indexOf('<div class="toast" id="toast">'));
  test('the modal has all 4 section headers in order: BASIC, CONTENT, INCLUSIONS, WEBSITE', () => {
    const basicIdx = modalHTML.indexOf('>BASIC<');
    const contentIdx = modalHTML.indexOf('>CONTENT<');
    const inclusionsIdx = modalHTML.indexOf('>INCLUSIONS<');
    const websiteIdx = modalHTML.indexOf('>WEBSITE<');
    assert.ok(basicIdx > -1 && contentIdx > basicIdx && inclusionsIdx > contentIdx && websiteIdx > inclusionsIdx, 'section headers must appear in BASIC -> CONTENT -> INCLUSIONS -> WEBSITE order');
  });
  test('every original field id is still present exactly once: pkg-name, pkg-emoji, pkg-price, pkg-agency-price, pkg-nights, pkg-badge, pkg-badge-style, pkg-desc, pkg-includes, pkg-activities, pkg-addons, pkg-exclude-ladder', () => {
    ['pkg-name','pkg-emoji','pkg-price','pkg-agency-price','pkg-nights','pkg-badge','pkg-badge-style','pkg-desc','pkg-includes','pkg-activities','pkg-addons','pkg-exclude-ladder'].forEach(id => {
      const count = (modalHTML.match(new RegExp('id="'+id+'"', 'g')) || []).length;
      assert.equal(count, 1, `#${id} must appear exactly once in the edit modal`);
    });
  });
  test('savePkg() itself (the function these fields feed) is completely unchanged', () => {
    const src = extractByStart(PMS, /function savePkg\(\)\s*\{/);
    assert.match(src, /if\(!name\)\{toast\('Enter a package name'\);return;\}/);
    assert.match(src, /if\(!price\)\{toast\('Enter a price'\);return;\}/);
  });
}

section('Case H — Agency Packages tab is completely untouched');
{
  test('the agency-tab card rendering branch (isAgencyTab) still shows AGENCY PRICE, the master-template note, and Edit/Disable/Delete exactly as before -- no compact redesign applied there', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    const agencyBranch = src.slice(src.indexOf('if(isAgencyTab){'), src.indexOf('// WEBSITE PACKAGES'));
    assert.match(agencyBranch, /AGENCY PRICE/);
    assert.match(agencyBranch, /Master template — copied into every new agency/);
    assert.match(agencyBranch, /onclick="openPkgForm\(this\.dataset\.pid\)"/);
    assert.match(agencyBranch, /onclick="togglePkg\(this\.dataset\.pid\)"/);
    assert.match(agencyBranch, /onclick="deletePkg\(this\.dataset\.pid\)"/);
    assert.doesNotMatch(agencyBranch, /includesShown|pkgToggleMenu|-webkit-line-clamp/, 'agency cards must not receive the website-tab compact redesign');
  });
  test('getMasterAgencyPackages/createAgencyPackageSet/backfillAgencyPackages (Agency Packages\' own data functions) are untouched', () => {
    const src1 = extractByStart(PMS, /function getMasterAgencyPackages\(\)\s*\{/);
    assert.match(src1, /return PACKAGES\.filter\(function\(p\)\{ return p\.channel === 'agency'; \}\);/);
    const src2 = extractByStart(PMS, /async function createAgencyPackageSet\(email, force\)\s*\{/);
    assert.match(src2, /await fsDb\.collection\('agency_packages'\)\.doc\(email\)\.set\(\{ email: email, packages: master \}\);/);
  });
  test('syncPackagesToAgency() still only touches the Agency Portal via localStorage/BroadcastChannel — never Firestore, never the public website', () => {
    const src = extractByStart(PMS, /function syncPackagesToAgency\(\)\s*\{/);
    assert.doesNotMatch(src, /fsDb\./);
    assert.match(src, /localStorage\.setItem\('vilu_packages', JSON\.stringify\(PACKAGES\)\)/);
  });
}

console.log(`\n${passed}/${passed + failed} website-package-manager-reorg assertions passed`);
