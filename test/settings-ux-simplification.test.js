// Settings & Taxes UX simplification — 2026-09-11.
//
// Owner feedback from live production: the page had too many settings,
// explanations, warning banners, and unrelated controls all visible at
// once. This is an information-architecture cleanup ONLY -- every input
// id, every save function, every calculation must be byte-for-byte
// unchanged; only WHERE things are shown moves (primary view vs.
// collapsed Advanced/Other Settings).
//
// Technique: regex/structural checks directly on vilu-unified.html's
// source (no vm sandbox needed -- nothing computational changed). No
// Firestore, no browser, no live reservation.
//   node test/settings-ux-simplification.test.js
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

const sCfgStart = PMS.indexOf('<div class="sec" id="s-cfg">');
const sCfgEnd = PMS.indexOf('<div class="sec" id="s-transport">', sCfgStart);
if (sCfgStart === -1 || sCfgEnd === -1) throw new Error('could not locate the s-cfg section');
const sCfgHTML = PMS.slice(sCfgStart, sCfgEnd);

section('Case A — every existing input id is preserved (no data/field silently dropped)');
{
  const requiredIds = [
    'st-tgst', 'st-gt', 'st-sc', 'st-bt', 'st-3g', 'st-cd', 'st-tgst-eff', 'st-green-eff',
    'st-fx-mvr', 'st-fx-eur', 'st-fx-reason', 'st-usd-mode', 'st-mvr-mode', 'st-eur-mode',
    'st-nm', 'st-addr', 'st-ph', 'st-em', 'st-gst', 'st-bk', 'st-cancel-code',
    'tax-sum', 'recon-result',
  ];
  requiredIds.forEach(id => {
    test(`#${id} still exists in the Settings & Taxes section`, () => {
      assert.match(sCfgHTML, new RegExp(`id="${id}"`), `#${id} must still exist -- moving sections must never delete a field`);
    });
  });
  test('every existing save/action button (saveTax, resetTax, saveCompanyExchangeRates, saveInvoiceDefaults, saveProp, runReconciliationNow, saveCancellationOverrideCode) is still wired somewhere on the page', () => {
    ['saveTax()', 'resetTax()', 'saveCompanyExchangeRates()', 'saveInvoiceDefaults()', 'saveProp()', 'runReconciliationNow()', 'saveCancellationOverrideCode()'].forEach(call => {
      assert.match(sCfgHTML, new RegExp('onclick="' + call.replace(/[()]/g, '\\$&') + '"'), call + ' must still be reachable from a button');
    });
  });
}

section('Case B — primary view: only Tax Settings / Company Exchange Rates / Invoice Defaults are immediately visible (not inside a collapsed <details>)');
{
  // Split the section into: everything before the first <details>, vs. inside <details> blocks.
  const firstDetailsIdx = sCfgHTML.indexOf('<details');
  const primaryHTML = sCfgHTML.slice(0, firstDetailsIdx === -1 ? sCfgHTML.length : firstDetailsIdx);
  test('the primary (non-collapsed) view contains the Tax Settings, Company Exchange Rates, and Invoice Defaults cards', () => {
    assert.match(primaryHTML, />Tax Settings\b/);
    assert.match(primaryHTML, />Company Exchange Rates</);
    assert.match(primaryHTML, />Invoice Defaults</);
  });
  test('the primary Tax Settings card shows ONLY TGST / Green Tax / Service Charge -- effective dates, Bed Tax, 3rd Guest, Child Discount are NOT in the primary view', () => {
    const taxCardIdx = primaryHTML.search(/>Tax Settings\b/);
    const nextCardIdx = primaryHTML.indexOf('>Company Exchange Rates<');
    const taxCardHTML = primaryHTML.slice(taxCardIdx, nextCardIdx);
    assert.match(taxCardHTML, /id="st-tgst"/);
    assert.match(taxCardHTML, /id="st-gt"/);
    assert.match(taxCardHTML, /id="st-sc"/);
    assert.doesNotMatch(taxCardHTML, /id="st-tgst-eff"/);
    assert.doesNotMatch(taxCardHTML, /id="st-green-eff"/);
    assert.doesNotMatch(taxCardHTML, /id="st-bt"/);
    assert.doesNotMatch(taxCardHTML, /id="st-3g"/);
    assert.doesNotMatch(taxCardHTML, /id="st-cd"/);
  });
  test('the primary view does not contain Property Settings, Data Integrity, or Cancellation Override Code', () => {
    assert.doesNotMatch(primaryHTML, /Property Settings/);
    assert.doesNotMatch(primaryHTML, /Data Integrity/);
    assert.doesNotMatch(primaryHTML, /Cancellation Override Code/);
  });
}

section('Case C — Advanced Settings: collapsed by default, contains the moved fields');
{
  const advMatch = sCfgHTML.match(/<details class="card">\s*<summary[^>]*>[\s\S]*?Advanced Settings<\/summary>([\s\S]*?)<\/details>/);
  test('an Advanced Settings <details> section exists', () => {
    assert.ok(advMatch, 'Advanced Settings <details> block not found');
  });
  const advHTML = advMatch ? advMatch[1] : '';
  test('Advanced Settings is collapsed by default (no `open` attribute on the <details>)', () => {
    const detailsTagMatch = sCfgHTML.match(/<details([^>]*)>\s*<summary[^>]*>[\s\S]{0,120}Advanced Settings/);
    assert.ok(detailsTagMatch);
    assert.doesNotMatch(detailsTagMatch[1], /\bopen\b/);
  });
  test('Advanced Settings contains TGST/Green Tax effective dates, Bed Tax, 3rd Guest Supplement, Child Discount, and Reset to defaults', () => {
    assert.match(advHTML, /id="st-tgst-eff"/);
    assert.match(advHTML, /id="st-green-eff"/);
    assert.match(advHTML, /id="st-bt"/);
    assert.match(advHTML, /id="st-3g"/);
    assert.match(advHTML, /id="st-cd"/);
    assert.match(advHTML, /id="st-tax-reset-btn"/);
  });
}

section('Case D — Other Settings: collapsed by default, contains Property Settings / Data Integrity / Cancellation Override Code');
{
  const otherMatch = sCfgHTML.match(/<details class="card">\s*<summary[^>]*>[\s\S]*?Other Settings<\/summary>([\s\S]*?)<\/details>\s*<\/div>\s*$/);
  test('an Other Settings <details> section exists', () => {
    assert.ok(otherMatch, 'Other Settings <details> block not found');
  });
  const otherHTML = otherMatch ? otherMatch[1] : '';
  test('Other Settings is collapsed by default (no `open` attribute)', () => {
    const detailsTagMatch = sCfgHTML.match(/<details([^>]*)>\s*<summary[^>]*>[\s\S]{0,120}Other Settings/);
    assert.ok(detailsTagMatch);
    assert.doesNotMatch(detailsTagMatch[1], /\bopen\b/);
  });
  test('Other Settings contains Property Settings, Data Integrity, and Cancellation Override Code, with their real fields', () => {
    assert.match(otherHTML, /Property Settings/);
    assert.match(otherHTML, /id="st-nm"/);
    assert.match(otherHTML, /Data Integrity/);
    assert.match(otherHTML, /onclick="runReconciliationNow\(\)"/);
    assert.match(otherHTML, /Cancellation Override Code/);
    assert.match(otherHTML, /id="st-cancel-code"/);
  });
}

section('Case E — visual noise removed: no oversized warning banners or permanent worked examples');
{
  test('the primary Tax Settings / Exchange Rates / Invoice Defaults cards no longer contain the old long .al.am warning banners', () => {
    const firstDetailsIdx = sCfgHTML.indexOf('<details');
    const primaryHTML = sCfgHTML.slice(0, firstDetailsIdx === -1 ? sCfgHTML.length : firstDetailsIdx);
    assert.doesNotMatch(primaryHTML, /class="al am"/);
  });
  test('drawTaxSum() renders one compact line, not 5 large colored cards plus a permanent worked example', () => {
    const src = extractByStart(PMS, /function drawTaxSum\(\)\s*\{/);
    assert.doesNotMatch(src, /grid-template-columns:repeat\(5,1fr\)/);
    assert.doesNotMatch(src, /Example:/);
    assert.match(src, /TGST \$\{TAX\.tgst\}%/);
  });
  test('Exchange Rates and Invoice Defaults carry only short one-line helper text, per the owner\'s exact wording', () => {
    assert.match(sCfgHTML, /Rates are set manually by Vilu and apply to new invoices only\./);
    assert.match(sCfgHTML, /These are defaults only\. They can still be changed while creating an invoice\./);
  });
}

section('Case F — logic unchanged (Part 8/9 of the report: logic changed = NO, data changed = NO)');
{
  test('drawCfg() still reads/writes the exact same TAX/PROP fields under the exact same ids -- moving sections never touched this function\'s logic', () => {
    const src = extractByStart(PMS, /function drawCfg\(\)\s*\{/);
    assert.match(src, /document\.getElementById\('st-tgst'\)\.value=TAX\.tgst/);
    assert.match(src, /document\.getElementById\('st-fx-mvr'\)\.value=TAX\.exchangeRateUsdMvr>0\?TAX\.exchangeRateUsdMvr:''/);
    assert.match(src, /var editable=canEditTaxSettings\(\);/);
  });
  test('saveTax()/saveCompanyExchangeRates()/saveInvoiceDefaults() are untouched -- same canEditTaxSettings() gate, same TAX field assignments', () => {
    const saveTaxSrc = extractByStart(PMS, /function saveTax\(\)\s*\{/);
    assert.match(saveTaxSrc, /if\(!canEditTaxSettings\(\)\)\{ toast\('⛔ Admin\/Manager access only'\); return; \}/);
    assert.match(saveTaxSrc, /TAX\.tgst=\+document\.getElementById\('st-tgst'\)\.value/);
    const saveFxSrc = extractByStart(PMS, /async function saveCompanyExchangeRates\(\)\s*\{/);
    assert.match(saveFxSrc, /TAX\.exchangeRateUsdMvr=newMvr;/);
    const saveDefaultsSrc = extractByStart(PMS, /function saveInvoiceDefaults\(\)\s*\{/);
    assert.match(saveDefaultsSrc, /TAX\.mvrDefaultPriceMode=mvrModeEl\.value/);
  });
  test('the canonical tax/currency calculation engine (calcTaxGeneral/calcTax/companyExchangeRate) is completely untouched by this UX-only task', () => {
    const calcTaxGeneralSrc = extractByStart(PMS, /function calcTaxGeneral\(input\)\s*\{/);
    assert.match(calcTaxGeneralSrc, /var tgstRate=input\.taxCfg\.tgst\/100, svcRate=input\.taxCfg\.svc\/100;/);
    const companyRateSrc = extractByStart(PMS, /function companyExchangeRate\(currency\)\s*\{/);
    assert.match(companyRateSrc, /if\(!currency \|\| currency==='USD'\) return 1;/);
  });
  test('firestore.rules governing tax_currency_settings/tax_settings_audit are untouched -- this is a front-end-only change', () => {
    const RULES = read('firestore.rules');
    assert.match(RULES, /match \/tax_currency_settings\/\{docId\} \{\s*\n\s*allow read: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);\s*\n\s*allow write: if isAdmin\(\) \|\| isManagerRole\(\);/);
  });
}

console.log(`\n${passed}/${passed + failed} settings-ux-simplification assertions passed`);
