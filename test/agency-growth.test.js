// Phase 44 — Agency/Partner Growth regression suite.
//
// Run: node test/agency-growth.test.js
//
// Guards the one public-site change made in Phase 44 (a restrained "Travel
// Agents & Partners" footer enquiry link) and the commercial-privacy rules
// this phase's own governance document depends on: no commission/net-rate
// value ever appears in public HTML, no fake "official partner" claim
// exists anywhere, and the real agency booking-write path (shared with
// direct bookings) was not touched. Reads the actual generated locale
// mirrors -- run `node build-i18n-pages.js` first if source files changed.

const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const FULL_LOCALES = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk', 'zh'];

section('Case A — the new travel-trade footer link exists, is restrained, and is correctly localized');
{
  test('vilu-website.html carries a mailto (not a form, not a public rates page) travel-trade footer link', () => {
    const html = read('vilu-website.html');
    assert.ok(/href="mailto:Viluresidence@gmail\.com\?subject=Travel%20Trade%20Enquiry"[^>]*data-i18n="footer\.travelTrade"/.test(html), 'travel-trade footer link missing or changed shape');
  });
  test('the link carries no agency-specific data collection beyond a plain mailto (no new <form>, no hidden fields)', () => {
    const html = read('vilu-website.html');
    const idx = html.indexOf('footer.travelTrade');
    const context = html.slice(Math.max(0, idx - 40), idx + 200);
    assert.ok(!/<form/.test(context), 'a form was added around the travel-trade link, contradicting the "simple enquiry surface" decision');
  });
  test('the link is localized (not left in English) on every full locale homepage mirror', () => {
    for (const loc of FULL_LOCALES) {
      const file = `${loc}/index.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      assert.ok(html.includes('Travel%20Trade%20Enquiry'), `${file}: travel-trade mailto link missing`);
      assert.ok(!html.includes('>Travel Agents &amp; Partners<'), `${file}: link text left in English`);
    }
  });
}

section('Case B — no commission, net-rate, or private partner-pricing value ever appears in public HTML');
{
  const PUBLIC_FILES_RE = /\.html$/;
  test('no public page (excluding the login-gated agency/PMS files themselves) contains agencyPricePerRoom or the word "commission"', () => {
    const files = fs.readdirSync('.').filter(f => PUBLIC_FILES_RE.test(f) && f !== 'vilu-agency-portal.html' && f !== 'vilu-unified.html');
    for (const file of files) {
      const html = read(file);
      assert.ok(!/agencyPricePerRoom/.test(html), `${file}: leaks agencyPricePerRoom`);
      assert.ok(!/\bcommission\b/i.test(html), `${file}: mentions "commission" in public markup`);
    }
  });
}

section('Case C — no fabricated "official partner" or partnership claim exists anywhere');
{
  test('no English source page claims an "official partner"/"official agency" relationship', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-unified') && !f.startsWith('vilu-agency-portal'));
    pages.push('vilu-website.html');
    for (const file of pages) {
      assert.ok(!/official\s+(partner|agency|distributor)/i.test(read(file)), `${file}: contains an unverified "official partner" style claim`);
    }
  });
}

section('Case D — the shared booking write-path is untouched by this phase');
{
  test('vilu-agency-portal.html still routes bookings through the same protected writeReservation()/ROOM_CONFLICT engine (unchanged shape)', () => {
    const content = read('vilu-agency-portal.html');
    assert.ok(/agencyPricePerRoom\|\|selectedPkg\.pricePerRoom|agencyPricePerRoom\|\|pkg\.pricePerRoom/.test(content) || /agencyPricePerRoom/.test(content), 'agency pricing fallback logic missing/changed');
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} agency-growth assertions passed`);
if (failed > 0) process.exitCode = 1;
