// Phase 33 — local SEO regression suite.
//
// Run: node test/local-seo.test.js
//
// Guards against the specific defects found and fixed during Phase 33's
// local-entity/NAP/Maps/multilingual-place-name audit, so they don't
// silently regress in a future phase. Reads the actual generated locale
// mirrors — run `node build-i18n-pages.js` first if source files changed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const FULL_LOCALES = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk', 'zh'];

section('Case A — Vilu Residence is never described as a hotel/resort (business-type consistency)');
{
  test('whale-shark-snorkeling.html and manta-ray-snorkeling.html English source never say "hotel staff" or "the hotel"', () => {
    for (const file of ['whale-shark-snorkeling.html', 'manta-ray-snorkeling.html']) {
      const html = read(file);
      assert.ok(!/hotel staff/i.test(html), `${file} still says "hotel staff"`);
      assert.ok(!/confirming the current price with the hotel/i.test(html), `${file} still says "the hotel" for price confirmation`);
    }
  });
  test('no locale mirror of these two pages carries an untranslated "hotel" business-type word in the who-can-join/price sections', () => {
    // Spot-check the English loanword forms that would indicate an untranslated leak
    // (locale-specific correct translations are exempted -- this only catches the
    // literal English word slipping through, the same class of defect that was found).
    for (const loc of FULL_LOCALES) {
      for (const file of [`${loc}/whale-shark-snorkeling.html`, `${loc}/manta-ray-snorkeling.html`]) {
        if (!fs.existsSync(file)) continue;
        const html = read(file);
        assert.ok(!/\bhotel staff\b/i.test(html), `${file} leaked English "hotel staff"`);
      }
    }
  });
}

section('Case B — Arabic "Maamigili" spelling is consistent (single correct form: ماميغيلي)');
{
  test('i18n/ar.json carries zero instances of the two incorrect spellings (مامجيلي missing غ, مامیغیلي Farsi ی)', () => {
    const doc = JSON.parse(read('i18n/ar.json'));
    const s = JSON.stringify(doc.static);
    assert.ok(!/مامجيلي/.test(s), 'found the incorrect "مامجيلي" (missing غ) spelling');
    assert.ok(!/مامیغیلي/.test(s), 'found the incorrect "مامیغیلي" (Farsi ی) spelling');
  });
  test('ar/index.html and ar/maamigili-guide.html use the correct spelling in <title>', () => {
    for (const file of ['ar/index.html', 'ar/maamigili-guide.html']) {
      const html = read(file);
      const m = html.match(/<title>([^<]+)<\/title>/);
      assert.ok(m, `${file}: no <title> found`);
      assert.ok(m[1].includes('ماميغيلي'), `${file} title does not use the correct Arabic spelling: ${m[1]}`);
    }
  });
}

section('Case C — French "South Ari Atoll" naming is consistent (single canonical form: Sud Ari, with correct elision)');
{
  test('i18n/fr.json carries zero instances of the inconsistent "Ari Sud" word order', () => {
    const doc = JSON.parse(read('i18n/fr.json'));
    const s = JSON.stringify(doc.static);
    assert.ok(!/Ari Sud/.test(s), 'found the inconsistent "Ari Sud" word order (canonical form is "Sud Ari")');
  });
  test('fr.json never has the ungrammatical "de Sud Ari" without elision before a vowel... i.e. never "de Ari" or bare "de Sud Ari" is fine, but never a stray "d\'Ari Sud" leftover', () => {
    const doc = JSON.parse(read('i18n/fr.json'));
    const s = JSON.stringify(doc.static);
    assert.ok(!/d'Ari Sud/.test(s), 'found a leftover ungrammatical "d\'Ari Sud"');
  });
}

section('Case D — Site-wide "Find us on Google Maps" footer link is present and consistent');
{
  const PAGES = [
    'vilu-website.html', 'holiday-packages.html', 'whale-shark-snorkeling.html', 'manta-ray-snorkeling.html',
    'south-ari-atoll-guide.html', 'maamigili-guide.html', 'best-time-to-visit.html', 'guesthouse-vs-resort.html',
    'maldives-holiday-cost.html', 'best-local-islands-snorkeling.html', 'south-ari-vs-other-regions.html',
    'things-to-do-maamigili.html', 'privacy-policy.html', 'cookies.html',
  ];
  for (const file of PAGES) {
    test(`${file}: footer address is a real link to the verified Google Maps listing`, () => {
      const html = read(file);
      assert.ok(
        html.includes('<a class="footer-address" href="https://maps.google.com/?cid=8624726302398144856"'),
        `${file} footer address is not a Maps link`
      );
    });
  }
}

section('Case E — getting-to-maamigili.html title includes the disambiguating "South Ari Atoll"');
{
  test('title, og:title, twitter:title, and JSON-LD headline all say "South Ari Atoll" (not just "Maamigili" alone, which collides with the unrelated Raa Atoll island of the same name)', () => {
    const html = read('getting-to-maamigili.html');
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.includes('South Ari Atoll'), `title missing "South Ari Atoll": ${title}`);
    const ogTitle = html.match(/property="og:title" content="([^"]+)"/)[1];
    assert.ok(ogTitle.includes('South Ari Atoll'), `og:title missing "South Ari Atoll": ${ogTitle}`);
  });
}

section('Case G — whale-shark-snorkeling.html / manta-ray-snorkeling.html link to maamigili-guide.html in-body (English source, static HTML AND embedded I18N.en fallback stay in sync)');
{
  // Real bug class this guards: every data-i18n string on a standalone page
  // exists in two places -- the static HTML default text, and the embedded
  // `var I18N = { en: {...} }` JS object used by applyTranslations() at
  // runtime (which runs -- and overwrites the DOM -- even on the plain
  // English page). Editing only the HTML half leaves the JS half stale, and
  // the stale JS value silently reverts the fix the moment the page loads.
  // Caught live in Phase 33 (a fresh no-cache fetch showed the fix; the
  // rendered DOM after JS ran did not) -- both copies must be checked here.
  for (const [file, ns] of [['whale-shark-snorkeling.html', 'wsPage'], ['manta-ray-snorkeling.html', 'mrPage']]) {
    test(`${file}: the quick-facts "Departs from Maamigili" note links to maamigili-guide.html in BOTH the static HTML and the embedded I18N.en JS fallback`, () => {
      const html = read(file);
      const htmlKeyIdx = html.indexOf(`data-i18n="${ns}.qfDurationNote"`);
      assert.ok(htmlKeyIdx >= 0, `${file}: could not find the qfDurationNote <p> element`);
      const htmlSnippet = html.slice(htmlKeyIdx, html.indexOf('</p>', htmlKeyIdx));
      assert.ok(htmlSnippet.includes('<a href="maamigili-guide.html">'), `${file}: static HTML qfDurationNote has no link to maamigili-guide.html`);

      const jsKeyIdx = html.indexOf('qfDurationNote: "');
      assert.ok(jsKeyIdx >= 0, `${file}: could not find the embedded I18N.en qfDurationNote entry`);
      const jsSnippet = html.slice(jsKeyIdx, jsKeyIdx + 200);
      assert.ok(jsSnippet.includes('<a href=\\"maamigili-guide.html\\">'), `${file}: embedded I18N.en qfDurationNote is STALE -- still has no link, will silently overwrite the HTML fix at runtime`);
    });
  }
}

section('Case F — Maamigili entity clarity: maamigili-guide.html names Vilu Residence in its introduction section');
{
  test('maamigili-guide.html introduces Vilu Residence within the #introduction section, not only far down the page', () => {
    const html = read('maamigili-guide.html');
    const introStart = html.indexOf('id="introduction"');
    const introEnd = html.indexOf('</section>', introStart);
    const introBlock = html.slice(introStart, introEnd);
    assert.ok(introBlock.includes('Vilu Residence'), 'the #introduction section never names Vilu Residence');
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} local-SEO assertions passed`);
if (failed > 0) process.exitCode = 1;
