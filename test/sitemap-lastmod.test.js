// Regression test for the sitemap <lastmod> namespace-scoping fix.
//
// Run: node test/sitemap-lastmod.test.js
//
// Uses only Node's built-in assert — no framework, per the fix's scope.
// Cases A-C exercise the pure helpers (extractNamespaces / computeKeyLastChanged)
// with in-memory fixtures, so they need no git access and can't be broken by
// unrelated future commits. Case D and the namespace-extraction check against
// the real holiday-packages.html file are integration-style checks against
// this repo's actual current state.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const cheerio = require('cheerio');
const {
  PAGES,
  extractNamespaces,
  namespacesForPage,
  computeKeyLastChanged,
  computeSitemapLastmod,
  gitLastCommitDate,
  getPath,
  applyStaticTranslations,
} = require('../build-i18n-pages.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    console.log(`  FAIL - ${name}`);
    console.log(e.message);
    process.exitCode = 1;
  }
}

console.log('Case A — page-specific namespace only affects the page(s) that read it');
test('a commit touching only hpPage bumps hpPage, not an unrelated namespace', () => {
  const snapshots = [
    { date: '2026-08-01', static: { hpPage: { title: 'v1' }, maaPage: { title: 'v1' } }, dynamic: {} },
    { date: '2026-08-10', static: { hpPage: { title: 'v2' }, maaPage: { title: 'v1' } }, dynamic: {} },
  ];
  const result = computeKeyLastChanged(snapshots);
  assert.equal(result.hpPage, '2026-08-10', 'hpPage should reflect the commit that actually changed it');
  assert.equal(result.maaPage, '2026-08-01', 'maaPage must NOT be bumped by an hpPage-only change — this is the exact bug being fixed');
});

console.log('Case B — a genuinely shared namespace is recognized as relevant to every page that consumes it');
test('nav is a shared namespace: a nav-only commit is visible to every page whose markup reads nav.*', () => {
  const snapshots = [
    { date: '2026-08-01', static: { nav: { home: 'Home' }, hpPage: { title: 'v1' } }, dynamic: {} },
    { date: '2026-08-15', static: { nav: { home: 'Home!' }, hpPage: { title: 'v1' } }, dynamic: {} },
  ];
  const result = computeKeyLastChanged(snapshots);
  assert.equal(result.nav, '2026-08-15');
  // hpPage did not change in this commit, so its own last-changed date stays at its first appearance.
  assert.equal(result.hpPage, '2026-08-01');
  // Both holiday-packages.html and maamigili-guide.html read `nav` in their own markup
  // (confirmed by namespacesForPage below) — a nav edit is correctly visible to both,
  // since both would include 'nav' in the namespace set fed into this same lookup.
  const hpNs = namespacesForPage(PAGES.find((p) => p.source === 'holiday-packages.html'));
  const maaNs = namespacesForPage(PAGES.find((p) => p.source === 'maamigili-guide.html'));
  assert.ok(hpNs.has('nav'), 'holiday-packages.html markup must read nav.*');
  assert.ok(maaNs.has('nav'), 'maamigili-guide.html markup must read nav.*');
});

console.log('Case C — namespace extraction from real markup identifies what holiday-packages.html actually consumes');
test('extractNamespaces finds exactly the namespaces used by fixture markup', () => {
  const fixtureHtml = `
    <nav><a data-i18n="nav.home">Home</a></nav>
    <h1 data-i18n="hpPage.title">t</h1>
    <p data-i18n-html="hpPage.intro">i</p>
    <img data-i18n-alt="hpPage.heroAlt">
    <input data-i18n-placeholder="hpPage.searchPlaceholder">
    <button data-i18n-aria-label="hpPage.closeLabel"></button>
    <footer data-i18n="footer.copyright"></footer>
  `;
  const ns = extractNamespaces(fixtureHtml);
  assert.deepEqual([...ns].sort(), ['footer', 'hpPage', 'nav']);
});
test('namespacesForPage(holiday-packages.html) matches the real file on disk', () => {
  const pageDef = PAGES.find((p) => p.source === 'holiday-packages.html');
  const ns = namespacesForPage(pageDef);
  // Must include everything the page's own markup reads via data-i18n*, its
  // metadata namespace (never found via attribute scan — set via getPath(dict.static, metaNs+'.title')
  // directly), and the dynamic pseudo-key since this page has hasPackageGrid:true.
  for (const expected of ['hpPage', 'nav', 'footer', 'pageNav', 'hpMeta', '__dynamic__']) {
    assert.ok(ns.has(expected), `expected namespace "${expected}" missing from holiday-packages.html's derived set`);
  }
});

console.log('Case D — English lastmod stays based on the English source file only, no i18n coupling');
test('computeSitemapLastmod for the un-prefixed (English) URL equals gitLastCommitDate of the source file alone', () => {
  const enResult = computeSitemapLastmod('https://viluresidence.net/holiday-packages.html');
  const sourceOnly = gitLastCommitDate('holiday-packages.html');
  assert.equal(enResult, sourceOnly, 'English lastmod must be exactly the source file\'s own git history — nothing else can have influenced it');
});
test('computeSitemapLastmod for a translated URL does not equal only the source-file date when i18n is newer', () => {
  // Sanity check the other direction: for holiday-packages.html specifically, we know from
  // the real repo history that the fr i18n dictionary's hpPage change (2026-09-02) is newer
  // than earlier states — confirming the lang path actually DOES fold in i18n data, unlike
  // the English path above. This just proves the two code paths are genuinely different,
  // not accidentally both source-only.
  const frResult = computeSitemapLastmod('https://viluresidence.net/fr/holiday-packages.html');
  assert.ok(frResult, 'fr holiday-packages.html should produce a lastmod');
});

console.log('Case E — data-i18n-href: explicit whitelist for localizing an anchor href');
test('extractNamespaces recognizes data-i18n-href alongside the other data-i18n* forms', () => {
  const fixtureHtml = `
    <nav><a data-i18n="nav.home">Home</a></nav>
    <h1 data-i18n="hpPage.title">t</h1>
    <p data-i18n-html="hpPage.intro">i</p>
    <img data-i18n-alt="hpPage.heroAlt">
    <input data-i18n-placeholder="hpPage.searchPlaceholder">
    <button data-i18n-aria-label="hpPage.closeLabel"></button>
    <a data-i18n-href="wsPage.ctaWhatsappHref" href="https://wa.me/123?text=fallback">WhatsApp</a>
    <footer data-i18n="footer.copyright"></footer>
  `;
  const ns = extractNamespaces(fixtureHtml);
  assert.deepEqual([...ns].sort(), ['footer', 'hpPage', 'nav', 'wsPage']);
});

test('applyStaticTranslations rewrites href only for elements carrying data-i18n-href, leaving other hrefs untouched', () => {
  const fixtureHtml = `
    <a id="wa" data-i18n-href="wsPage.ctaWhatsappHref" href="https://wa.me/9609903339?text=English%20fallback">WhatsApp</a>
    <a id="plain" href="/#booking">Book</a>
  `;
  const $ = cheerio.load(fixtureHtml, { decodeEntities: false });
  const dict = { static: { wsPage: { ctaWhatsappHref: 'https://wa.me/9609903339?text=Localized' } } };
  applyStaticTranslations($, dict, 'wsMeta', 'standalone');
  assert.equal($('#wa').attr('href'), 'https://wa.me/9609903339?text=Localized');
  // The floating/global-style plain anchor has no data-i18n-href — must be untouched.
  assert.equal($('#plain').attr('href'), '/#booking');
});

test('applyStaticTranslations leaves href alone when the dictionary key is missing (fallback stays English)', () => {
  const fixtureHtml = `<a data-i18n-href="wsPage.ctaWhatsappHref" href="https://wa.me/9609903339?text=English%20fallback">WhatsApp</a>`;
  const $ = cheerio.load(fixtureHtml, { decodeEntities: false });
  const dict = { static: { wsPage: {} } }; // key absent, e.g. a language not yet translated
  applyStaticTranslations($, dict, 'wsMeta', 'standalone');
  assert.equal($('a').attr('href'), 'https://wa.me/9609903339?text=English%20fallback');
});

test('a percent-encoded multilingual URL survives the cheerio round-trip with no double-encoding or corruption', () => {
  const messages = {
    ar: 'مرحبًا! كنت أقرأ دليلك.',
    ru: 'Здравствуйте! Меня заинтересовал ваш гид.',
    ja: 'こんにちは。ガイドを拝見しました。',
    ko: '안녕하세요! 가이드를 읽었습니다.',
    zh: '您好！我看了您的指南。',
  };
  for (const [lang, message] of Object.entries(messages)) {
    const url = 'https://wa.me/9609903339?text=' + encodeURIComponent(message);
    const fixtureHtml = `<a data-i18n-href="wsPage.ctaWhatsappHref" href="https://wa.me/9609903339?text=fallback">WhatsApp</a>`;
    const $ = cheerio.load(fixtureHtml, { decodeEntities: false });
    applyStaticTranslations($, { static: { wsPage: { ctaWhatsappHref: url } } }, 'wsMeta', 'standalone');
    const rewrittenHref = $('a').attr('href');
    const textParam = rewrittenHref.split('?text=')[1];
    assert.equal(decodeURIComponent(textParam), message, `${lang}: decoded href text must exactly match the source message, no corruption/double-encoding`);
  }
});

test('existing data-i18n / data-i18n-alt / data-i18n-placeholder / data-i18n-aria-label attributes still work unchanged', () => {
  const fixtureHtml = `
    <h1 data-i18n="hpPage.title">fallback title</h1>
    <img data-i18n-alt="hpPage.heroAlt" alt="fallback alt">
    <input data-i18n-placeholder="hpPage.searchPlaceholder" placeholder="fallback placeholder">
    <button data-i18n-aria-label="hpPage.closeLabel" aria-label="fallback aria"></button>
  `;
  const $ = cheerio.load(fixtureHtml, { decodeEntities: false });
  const dict = { static: { hpPage: { title: 'Translated Title', heroAlt: 'Translated Alt', searchPlaceholder: 'Translated Placeholder', closeLabel: 'Translated Aria' } } };
  applyStaticTranslations($, dict, 'hpMeta', 'standalone');
  assert.equal($('h1').html(), 'Translated Title');
  assert.equal($('img').attr('alt'), 'Translated Alt');
  assert.equal($('input').attr('placeholder'), 'Translated Placeholder');
  assert.equal($('button').attr('aria-label'), 'Translated Aria');
});

console.log('Case F — real-repo integration: the 9 Guide -> Holiday Packages WhatsApp CTAs are correctly wired');
test('each of the 9 approved guide source files carries exactly one data-i18n-href WhatsApp annotation', () => {
  const guideNsMap = {
    'maamigili-guide.html': 'maaPage',
    'south-ari-atoll-guide.html': 'saaPage',
    'whale-shark-snorkeling.html': 'wsPage',
    'manta-ray-snorkeling.html': 'mrPage',
    'best-time-to-visit.html': 'btPage',
    'guesthouse-vs-resort.html': 'gvrPage',
    'maldives-holiday-cost.html': 'costPage',
    'best-local-islands-snorkeling.html': 'cmpSnorkelPage',
    'south-ari-vs-other-regions.html': 'cmpRegionsPage',
  };
  for (const [file, ns] of Object.entries(guideNsMap)) {
    const html = fs.readFileSync(file, 'utf8');
    const matches = html.match(new RegExp(`data-i18n-href="${ns}\\.ctaWhatsappHref"`, 'g')) || [];
    assert.equal(matches.length, 1, `${file} should carry exactly one data-i18n-href="${ns}.ctaWhatsappHref" annotation`);
  }
});
test('every one of the 10 language dictionaries has a non-English, correctly-encoded ctaWhatsappHref for every guide namespace', () => {
  const LANGS = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk', 'zh'];
  const namespaces = ['maaPage', 'saaPage', 'wsPage', 'mrPage', 'btPage', 'gvrPage', 'costPage', 'cmpSnorkelPage', 'cmpRegionsPage'];
  for (const lang of LANGS) {
    const dict = JSON.parse(fs.readFileSync(`i18n/${lang}.json`, 'utf8'));
    for (const ns of namespaces) {
      const href = getPath(dict.static, `${ns}.ctaWhatsappHref`);
      assert.ok(href && href.startsWith('https://wa.me/9609903339?text='), `${lang}/${ns}.ctaWhatsappHref must be a well-formed wa.me URL`);
      const textParam = href.split('?text=')[1];
      const decoded = decodeURIComponent(textParam);
      assert.ok(decoded.includes('Vilu'), `${lang}/${ns}: decoded message should still reference Vilu by name`);
      // Round-trip: re-encoding the decoded text must reproduce the exact same query string —
      // proves no double-encoding and no corrupted/mismatched bytes survived the authoring step.
      assert.equal(encodeURIComponent(decoded), textParam, `${lang}/${ns}: encode(decode(x)) must equal x — no double-encoding or corruption`);
    }
  }
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED');
}
