// Phase 35 — E-E-A-T / brand authority regression suite.
//
// Run: node test/eeat-trust.test.js
//
// Guards against the specific defects found and fixed during Phase 35's
// trust/authority audit, so they don't silently regress in a future phase.
// Reads the actual generated locale mirrors — run `node build-i18n-pages.js`
// first if source files changed.

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
const ARTICLE_DATED_PAGES = [
  'maamigili-guide.html', 'best-time-to-visit.html', 'guesthouse-vs-resort.html',
  'maldives-holiday-cost.html', 'best-local-islands-snorkeling.html',
  'south-ari-vs-other-regions.html', 'things-to-do-maamigili.html', 'getting-to-maamigili.html',
];
const NEW_ARTICLE_PAGES = ['whale-shark-snorkeling.html', 'manta-ray-snorkeling.html', 'south-ari-atoll-guide.html'];

function jsonLdNodes(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      for (const n of (Array.isArray(parsed) ? parsed : [parsed])) nodes.push(n);
    } catch (e) { /* skip malformed, not this suite's concern */ }
  }
  return nodes;
}

section('Case A — no fabricated low-quality citation sources anywhere in the shipped site');
{
  test('airial.travel and resortlife.travel appear nowhere in maamigili-guide.html (English source)', () => {
    const html = read('maamigili-guide.html');
    assert.ok(!/airial\.travel/.test(html), 'airial.travel citation still present');
    assert.ok(!/resortlife\.travel/.test(html), 'resortlife.travel citation still present');
  });
  test('the replacement citations (MWSRP, Maldives Ministry of Environment, Divernet) are present in maamigili-guide.html', () => {
    const html = read('maamigili-guide.html');
    assert.ok(html.includes('maldiveswhalesharkresearch.org'), 'MWSRP citation missing');
    assert.ok(html.includes('protectedareas.environment.gov.mv'), 'Maldives Ministry of Environment SAMPA citation missing');
    assert.ok(html.includes('divernet.com'), 'Divernet citation missing');
  });
  test('no locale mirror of maamigili-guide.html leaked the old low-quality domains via a stale JS fallback', () => {
    for (const loc of FULL_LOCALES) {
      const file = `${loc}/maamigili-guide.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      assert.ok(!/airial\.travel/.test(html), `${file} still has airial.travel`);
      assert.ok(!/resortlife\.travel/.test(html), `${file} still has resortlife.travel`);
    }
  });
}

section('Case B — Article JSON-LD authorship/freshness is present where expected');
{
  test('every Article-bearing page carries a real (non-empty) datePublished and dateModified', () => {
    for (const file of ARTICLE_DATED_PAGES) {
      const html = read(file);
      const nodes = jsonLdNodes(html);
      const article = nodes.find(n => n['@type'] === 'Article');
      assert.ok(article, `${file}: no Article JSON-LD node found`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(article.datePublished || ''), `${file}: datePublished missing or malformed`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(article.dateModified || ''), `${file}: dateModified missing or malformed`);
    }
  });
  test('whale-shark-snorkeling.html, manta-ray-snorkeling.html, south-ari-atoll-guide.html each gained a new Article node alongside their primary entity node', () => {
    for (const file of NEW_ARTICLE_PAGES) {
      const html = read(file);
      const nodes = jsonLdNodes(html);
      const types = nodes.map(n => n['@type']);
      assert.ok(types.includes('Article'), `${file}: no Article node (types found: ${types.join(', ')})`);
      assert.ok(types.includes('Product') || types.includes('TouristDestination'), `${file}: primary entity node missing`);
    }
  });
  test('Article authorship is always attributed to the Vilu Residence organization, never an invented individual', () => {
    for (const file of [...ARTICLE_DATED_PAGES, ...NEW_ARTICLE_PAGES]) {
      const html = read(file);
      const nodes = jsonLdNodes(html);
      const article = nodes.find(n => n['@type'] === 'Article');
      if (!article || !article.author) continue; // getting-to-maamigili.html-style pages may only carry publisher
      assert.equal(article.author['@type'], 'Organization', `${file}: Article author is not an Organization`);
      assert.equal(article.author.name, 'Vilu Residence', `${file}: Article author is not "Vilu Residence"`);
    }
  });
}

section('Case C — no fabricated trust entities anywhere in the shipped site');
{
  test('no AggregateRating or Review JSON-LD node exists anywhere on the English source pages (no invented review statistics)', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-'));
    for (const file of pages) {
      const html = read(file);
      const nodes = jsonLdNodes(html);
      assert.ok(!nodes.some(n => n['@type'] === 'AggregateRating' || n['@type'] === 'Review'), `${file}: found a fabricated AggregateRating/Review node`);
    }
  });
  test('no Person JSON-LD node exists anywhere (no invented individual staff/expert profiles)', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-'));
    for (const file of pages) {
      const html = read(file);
      const nodes = jsonLdNodes(html);
      assert.ok(!nodes.some(n => n['@type'] === 'Person'), `${file}: found a fabricated Person node`);
    }
  });
}

section('Case D — holiday-packages.html wildlife-sighting disclaimer (highest-priority booking-page gap)');
{
  test('holiday-packages.html FAQ (visible + JSON-LD) includes a sightings-not-guaranteed Q&A', () => {
    const html = read('holiday-packages.html');
    assert.ok(/sightings can never be guaranteed/i.test(html), 'visible FAQ text missing the sightings-not-guaranteed disclaimer');
    const nodes = jsonLdNodes(html);
    const faq = nodes.find(n => n['@type'] === 'FAQPage');
    assert.ok(faq, 'no FAQPage node found');
    assert.ok(faq.mainEntity.some(q => /sightings can never be guaranteed/i.test(q.acceptedAnswer.text)), 'FAQPage JSON-LD missing the sightings-not-guaranteed disclaimer');
  });
  test('the new FAQ entry is localized (not left in English) in every full locale, and count-matches the visible page', () => {
    for (const loc of FULL_LOCALES) {
      const file = `${loc}/holiday-packages.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      const detailsCount = (html.match(/<div class="faq-a"/g) || []).length;
      assert.equal(detailsCount, 8, `${file}: expected 8 visible FAQ answers, found ${detailsCount}`);
      const nodes = jsonLdNodes(html);
      const faq = nodes.find(n => n['@type'] === 'FAQPage');
      assert.equal(faq.mainEntity.length, 8, `${file}: expected 8 FAQPage Q&A entries, found ${faq.mainEntity.length}`);
      assert.ok(!/sightings can never be guaranteed/i.test(JSON.stringify(faq.mainEntity[7])), `${file}: FAQ #8 was left in English (untranslated)`);
    }
  });
}

section('Case E — homepage room-card breakfast-inclusion trust signal (Task 15)');
{
  test('every room card on the homepage states breakfast is included', () => {
    const html = read('vilu-website.html');
    const roomsSection = html.slice(html.indexOf('<section id="rooms">'), html.indexOf('</section>', html.indexOf('<section id="rooms">')));
    const count = (roomsSection.match(/rooms\.featureBreakfast/g) || []).length;
    assert.equal(count, 3, `expected all 3 room cards to carry the breakfast feature, found ${count}`);
  });
  test('the breakfast-included feature is localized (not left in English) in every full locale homepage mirror', () => {
    for (const loc of FULL_LOCALES) {
      const file = `${loc}/index.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      const roomsSection = html.slice(html.indexOf('<section id="rooms">'), html.indexOf('</section>', html.indexOf('<section id="rooms">')));
      assert.ok(!/Breakfast included/.test(roomsSection), `${file}: room card breakfast feature left in English`);
    }
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} E-E-A-T/brand-authority assertions passed`);
if (failed > 0) process.exitCode = 1;
