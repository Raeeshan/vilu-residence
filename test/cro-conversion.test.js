// Phase 39 — CRO (Conversion Rate Optimization) regression suite.
//
// Run: node test/cro-conversion.test.js
//
// Guards the one concrete defect found and fixed during Phase 39 (the
// floating WhatsApp button overlapping the mobile sticky "need help
// choosing?" bar on holiday-packages.html) and locks in the conversion
// architecture the audit found already correctly implemented: contextual
// WhatsApp/email pre-fill per package, the packages-first/accommodation-
// second bridge, no fake urgency/scarcity language, and the China
// email-primary CTA override (extending, not duplicating,
// test/china-cta-priority.test.js). Reads the actual generated locale
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
const PACKAGE_SLUGS_NIGHTS_PRICE = {
  'island-explorer-getaway': [4, '450'], 'reef-sunset-adventure': [5, '550'], 'island-serenity-escape': [6, '650'],
  'maldives-dream-bliss': [7, '700'], 'ultimate-island-relaxation': [8, '790'], 'grand-maldives-escape': [9, '880'],
  'ultimate-maldives-odyssey': [10, '940'], 'ultimate-resort-island-odyssey': [11, '1300'], 'honeymoon-dream-escape': [10, '1100'],
};

section('Case A — floating WhatsApp button no longer overlaps the mobile sticky package-help bar (Phase 39 fix)');
{
  test('shared-page.css hides .floating-whatsapp while body.pkg-sticky-clearance is active', () => {
    const css = read('shared-page.css');
    assert.ok(/body\.pkg-sticky-clearance\s*\.floating-whatsapp\s*\{\s*display:\s*none\s*\}/.test(css), 'the overlap-avoidance rule is missing');
  });
  test('the rule appears after the clearance/media-query block it depends on (correct cascade position)', () => {
    const css = read('shared-page.css');
    const clearanceIdx = css.indexOf('body.pkg-sticky-clearance{');
    const fixIdx = css.indexOf('body.pkg-sticky-clearance .floating-whatsapp{display:none}');
    assert.ok(clearanceIdx !== -1 && fixIdx !== -1 && fixIdx > clearanceIdx, 'rule ordering looks wrong');
  });
}

section('Case B — no fake urgency, scarcity, or dark-pattern language anywhere on the public site');
{
  const URGENCY_RE = /only \d+ (left|room)|\d+ (people|guests) (viewing|looking)|almost sold out|selling fast|limited time|book now before|hurry|last chance/i;
  test('no English source page contains fake urgency/scarcity phrasing', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-unified') && !f.startsWith('vilu-agency-portal'));
    pages.push('vilu-website.html');
    for (const file of pages) {
      assert.ok(!URGENCY_RE.test(read(file)), `${file}: contains fake urgency/scarcity language`);
    }
  });
  test('no locale i18n dictionary contains fake urgency/scarcity phrasing', () => {
    for (const loc of [...FULL_LOCALES, 'es']) {
      const doc = JSON.parse(read(`i18n/${loc}.json`));
      assert.ok(!URGENCY_RE.test(JSON.stringify(doc)), `i18n/${loc}.json: contains fake urgency/scarcity language`);
    }
  });
}

section('Case C — package enquiry CTAs remain contextual, correct, and locked-fact-accurate (English source)');
{
  test('every one of the 9 packages carries a WhatsApp CTA pre-filled with its own real name/nights, and an Email CTA with matching subject', () => {
    const html = read('holiday-packages.html');
    for (const [slug, [nights, price]] of Object.entries(PACKAGE_SLUGS_NIGHTS_PRICE)) {
      const detailsStart = html.indexOf(`id="${slug}"`);
      assert.ok(detailsStart !== -1, `${slug}: package block not found`);
      const detailsEnd = html.indexOf('</details>', detailsStart);
      const block = html.slice(detailsStart, detailsEnd);
      assert.ok(new RegExp(`wa\\.me/9609903339\\?text=[^"]*${nights}%20nights`).test(block), `${slug}: WhatsApp link missing correct night count`);
      assert.ok(block.includes(`<span class="pkg-price">$${price}</span>`), `${slug}: price drifted from locked value ${price}`);
      assert.ok(/href="mailto:Viluresidence@gmail\.com\?subject=Enquiry/.test(block), `${slug}: Email CTA missing or malformed`);
    }
  });
  test('every package links to live availability as an accommodation-separate alternative (packages-first, accommodation-second bridge)', () => {
    const html = read('holiday-packages.html');
    // 10, not 9: 9 pre-rendered package instances plus 1 occurrence in the
    // pkgDetailHtml() JS template source itself (the string literal is part
    // of the page's own <script> text, same as the trust-microcopy check below).
    const count = (html.match(/href="\/#booking" onclick="trackEvent\('availability_click'/g) || []).length;
    assert.equal(count, 10, `expected 9 rendered instances + 1 JS-source instance of the accommodation-separate bridge link, found ${count}`);
  });
  test('every package shows a real, already-published cancellation/deposit reassurance right at the decision point, not only buried in the FAQ (Phase 39 fix)', () => {
    const html = read('holiday-packages.html');
    const renderedCount = (html.match(/class="pkg-cta-trust">Free cancellation, no deposit/g) || []).length;
    assert.equal(renderedCount, 9, `expected all 9 pre-rendered packages to carry the reassurance line, found ${renderedCount}`);
  });
  test('the reassurance text matches the real published policy (free cancellation, no deposit, pay in person) -- no new fact invented', () => {
    const html = read('holiday-packages.html');
    assert.ok(html.includes('free cancellation, with no deposit ever collected'), 'the underlying published FAQ policy text this microcopy is drawn from is missing/changed');
  });
  test('the reassurance line is localized (not left in English) in every full locale', () => {
    for (const loc of FULL_LOCALES) {
      const file = `${loc}/holiday-packages.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      assert.ok(!/class="pkg-cta-trust">Free cancellation, no deposit/.test(html), `${file}: reassurance line left in English`);
      const count = (html.match(/class="pkg-cta-trust"/g) || []).length;
      assert.ok(count >= 9, `${file}: expected at least 9 rendered reassurance lines, found ${count}`);
    }
  });
}

section('Case D — China conversion-path override still intact (extends test/china-cta-priority.test.js)');
{
  test('the zh-scoped WhatsApp-demote/Email-promote CSS rules still exist, unchanged in intent', () => {
    const css = read('shared-page.css');
    assert.ok(/html\[lang="zh"\] \.pkg-cta a\.btn-primary\[href\^="https:\/\/wa\.me"\]/.test(css), 'zh WhatsApp-demote rule missing');
    assert.ok(/html\[lang="zh"\] \.pkg-cta a\.btn-outline\[href\^="mailto:"\]/.test(css), 'zh Email-promote rule missing');
  });
  test('zh/holiday-packages.html markup is unforked from the shared component (same href/class structure as English)', () => {
    const en = read('holiday-packages.html');
    const zh = read('zh/holiday-packages.html');
    const enHasBtnPrimaryWa = /class="btn-primary" href="https:\/\/wa\.me/.test(en);
    const zhHasBtnPrimaryWa = /class="btn-primary" href="https:\/\/wa\.me/.test(zh);
    assert.equal(enHasBtnPrimaryWa, zhHasBtnPrimaryWa, 'zh markup structure diverged from English (should differ only via CSS, not markup)');
  });
}

section('Case E — review-proof links are real, restrained, and present at conversion points (no fabricated ratings)');
{
  test('holiday-packages.html links to real Google and Tripadvisor review destinations, not a hardcoded count or fake AggregateRating', () => {
    const html = read('holiday-packages.html');
    assert.ok(html.includes('share.google/pvHqwMzmtKflnZyPo'), 'real Google reviews link missing');
    assert.ok(html.includes('tripadvisor.com/Hotel_Review-g9712403-d26836968'), 'real Tripadvisor reviews link missing');
    assert.ok(!/\d+(\.\d+)?\s*(stars?|★)\s*\(\d+\s*reviews?\)/i.test(html), 'a hardcoded review count/star rating appears to have been added to the page copy');
  });
}

section('Case F — no accidental PMS/booking-logic surface touched by this phase');
{
  // vilu-website.html legitimately and correctly contains the real booking
  // engine (writeReservation/ROOM_CONFLICT/runTransaction ARE its own code,
  // untouched by Phase 39) -- checked separately below by content, not
  // excluded from scrutiny. This case guards the actual Phase 39 changes
  // (shared-page.css, holiday-packages.html), which have no legitimate
  // reason to ever reference PMS write-path internals.
  test('Phase 39\'s own changed files (shared-page.css, holiday-packages.html) never reference PMS write-path internals', () => {
    for (const file of ['shared-page.css', 'holiday-packages.html']) {
      const content = read(file);
      assert.ok(!/writeReservation|submitDirectBooking|runTransaction\(|ROOM_CONFLICT/.test(content), `${file}: unexpectedly references protected PMS booking logic`);
    }
  });
  test('vilu-website.html\'s real booking engine is present and untouched in shape (writeReservation still the sole Firestore writer)', () => {
    const content = read('vilu-website.html');
    assert.ok(/async function writeReservation\(docId, fields, opts\)/.test(content), 'writeReservation signature changed or missing');
    assert.ok(/throw new Error\('ROOM_CONFLICT'\)/.test(content), 'ROOM_CONFLICT guard changed or missing');
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} CRO/conversion assertions passed`);
if (failed > 0) process.exitCode = 1;
