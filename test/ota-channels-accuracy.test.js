// OTA Channels page accuracy fix — 2026-09-10.
//
// Owner report: the live OTA Channels page showed Booking.com, Airbnb,
// Agoda, Expedia, and Google Hotels all as "Live — Vilu rooms only" with
// enabled-looking toggles and fabricated bookings/revenue/commission
// figures. Traced to source (Step 1, not assumed): the old `OTAS` array
// was 100% hardcoded mock data -- every channel permanently `on:true`
// with sample bk/rev/comm numbers -- with zero backend behind any of it.
// No per-channel Beds24/Cloudbeds connection-status backend exists yet to
// detect this live; functions-core/lib/beds24-bridge.js's own architecture
// comment confirms the Beds24 bridge is scoped to Booking.com/Expedia/
// Agoda only (Airbnb/Google Hotels aren't in its target scope at all),
// and functions-core/index.js's own comment confirms the OTA-facing
// functions that would actually talk to an OTA remain undeployed. Per the
// task's own Step 6 fallback, this fix replaces the mock array with an
// explicit, conservative, owner-confirmed OTA_CHANNELS config reflecting
// today's real state, and rebuilds the page around it with no fake
// numbers, no working toggle, and no live "Push rates" action.
//
// Same technique as the rest of this suite: brace-match/extractConst real
// source out of vilu-unified.html, regex-check directly. No Firestore, no
// browser, no live reservation, no OTA/Beds24/Cloudbeds call of any kind.
//   node test/ota-channels-accuracy.test.js
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

section('Case A — the old fully-fabricated mock data is gone');
{
  test('the old OTAS array (comm/on/bk/rev sample numbers, every channel on:true) no longer exists', () => {
    assert.doesNotMatch(PMS, /const OTAS=\[/);
  });
  test('no leftover reference to the removed togOTA()/pushOTA() fake-toggle/fake-push functions', () => {
    assert.doesNotMatch(PMS, /function togOTA\(/);
    assert.doesNotMatch(PMS, /function pushOTA\(/);
  });
}

section('Case B — OTA_CHANNELS reflects the verified real state, all 5 channels, no fake metrics');
{
  const src = extractConst(PMS, 'OTA_CHANNELS');
  test('exactly Booking.com, Expedia, Agoda, Airbnb, Google Hotels -- same 5 channels, correctly re-stated', () => {
    ['Booking.com', 'Expedia', 'Agoda', 'Airbnb', 'Google Hotels'].forEach(nm => {
      assert.match(src, new RegExp("nm:'" + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"));
    });
  });
  test('Booking.com/Expedia/Agoda are marked cloudbeds:true, beds24:false, cutover Not started', () => {
    ['Booking.com', 'Expedia', 'Agoda'].forEach(nm => {
      const re = new RegExp("nm:'" + nm + "'[^}]*cloudbeds:true[^}]*beds24:false[^}]*cutover:'Not started'");
      assert.match(src, re, nm + ' should be cloudbeds:true/beds24:false/Not started');
    });
  });
  test('Airbnb/Google Hotels are marked cloudbeds:false, beds24:false, cutover Not configured', () => {
    ['Airbnb', 'Google Hotels'].forEach(nm => {
      const re = new RegExp("nm:'" + nm + "'[^}]*cloudbeds:false[^}]*beds24:false[^}]*cutover:'Not configured'");
      assert.match(src, re, nm + ' should be cloudbeds:false/beds24:false/Not configured');
    });
  });
  test('no channel is marked beds24:true -- confirmed real state is zero connected channels', () => {
    assert.doesNotMatch(src, /beds24:true/);
  });
  test('no bookings/revenue/commission fields exist on the config at all -- not even zeroed out (which would wrongly imply live tracking)', () => {
    assert.doesNotMatch(src, /\bbk:/);
    assert.doesNotMatch(src, /\brev:/);
    assert.doesNotMatch(src, /\bcomm:/);
    assert.doesNotMatch(src, /\bon:/);
  });
}

section('Case C — drawOTA() renders no fake metrics, no working toggle, no live push action');
{
  const src = extractByStart(PMS, /function drawOTA\(\)\s*\{/);
  test('no "Bookings"/"Revenue"/"Comm." cards remain in the rendered markup', () => {
    assert.doesNotMatch(src, />Bookings</);
    assert.doesNotMatch(src, />Revenue</);
    assert.doesNotMatch(src, />Comm\.</);
  });
  test('no "Live — Vilu rooms only" claim and no onclick toggle remain', () => {
    assert.doesNotMatch(src, /Live — Vilu rooms only/);
    assert.doesNotMatch(src, /onclick="togOTA/);
  });
  test('no "Push rates now" button/action remains anywhere in the render', () => {
    assert.doesNotMatch(src, /Push rates now/);
    assert.doesNotMatch(src, /onclick="pushOTA/);
  });
  test('each card shows Current connection / Beds24 / Cutover, sourced from otaChannelInfo(), not inline fabricated strings', () => {
    assert.match(src, /Current connection:/);
    assert.match(src, /Beds24:/);
    assert.match(src, /Cutover:/);
    assert.match(src, /otaChannelInfo\(o\)/);
  });
  test('the action button reads "Setup / Review" for Cloudbeds-managed channels and "Configure later" for unconfigured ones, matching the task\'s own example card', () => {
    assert.match(src, /Setup \/ Review/);
    assert.match(src, /Configure later/);
  });
}

section('Case D — the info button is purely informational: never touches OTA_CHANNELS, Beds24, Cloudbeds, or any OTA');
{
  const src = extractByStart(PMS, /function otaChannelInfoDialog\(id\)\s*\{/);
  test('never assigns to any OTA_CHANNELS field (no mutation of connection state from this page)', () => {
    assert.doesNotMatch(src, /o\.(cloudbeds|beds24|cutover)\s*=/);
  });
  test('never calls a network/Firestore/Beds24/Cloudbeds API', () => {
    assert.doesNotMatch(src, /fetch\(/);
    assert.doesNotMatch(src, /fsDb\./);
    assert.doesNotMatch(src, /httpsCallable/);
  });
  test('onYes is a no-op -- clicking "Got it" does nothing but close the dialog', () => {
    assert.match(src, /onYes:function\(\)\{\}/);
  });
}

section('Case E — the misleading page-level banners are corrected too (same false-claim pattern, same page)');
{
  test('the old "All rate changes push to connected OTAs automatically. OTA bookings go to Vilu Residence rooms only." green banner is gone from the actual rendered markup (not just its own removal comment)', () => {
    assert.doesNotMatch(PMS, /All rate changes push to connected OTAs automatically\. OTA bookings go to Vilu Residence rooms only\./);
    // the OTA Channels section's own <div class="al gn"> (green "all good") banner is gone too
    const idx = PMS.indexOf('<div class="sec" id="s-ota">');
    const src = PMS.slice(idx, idx + 700);
    assert.doesNotMatch(src, /class="al gn"/);
  });
  test('the OTA Channels section now states plainly that Booking.com/Expedia/Agoda are Cloudbeds-managed and nothing is connected via Beds24 yet', () => {
    const idx = PMS.indexOf('<div class="sec" id="s-ota">');
    const src = PMS.slice(idx, idx + 700);
    assert.match(src, /Cloudbeds/);
    assert.match(src, /No channel is connected via Beds24 yet/);
  });
  test('the sidebar\'s permanent "All channels synced" claim (visible on every page, not just OTA Channels) is corrected to an accurate, neutral statement', () => {
    assert.doesNotMatch(PMS, />\s*All channels synced</); // the actual rendered text node, not this fix's own explanatory comment mentioning the old text
    assert.match(PMS, /Cloudbeds is the active channel manager/);
  });
}

section('Case F — architecture untouched (Step 7/DO NOT TOUCH): Beds24 bridge scope, Cloudbeds-active-until-cutover model unchanged');
{
  test('functions-core/lib/beds24-bridge.js is untouched by this pass (file unmodified -- verified by its own unchanged architecture comment)', () => {
    const bridge = read('functions-core/lib/beds24-bridge.js');
    assert.match(bridge, /Beds24 is used ONLY as an API\/channel transport bridge to Booking\.com,\s*\n\/\/ Expedia and Agoda/);
  });
  test('OTA_CHANNELS is a plain, static, client-side display config -- never referenced by any Beds24/Cloudbeds sync function (no accidental new coupling)', () => {
    const funcCoreSrc = read('functions-core/index.js');
    assert.doesNotMatch(funcCoreSrc, /OTA_CHANNELS/);
  });
}

console.log(`\n${passed}/${passed + failed} ota-channels-accuracy assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); } else { console.log('\nALL TESTS PASSED'); }
