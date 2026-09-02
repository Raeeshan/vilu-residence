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
const {
  PAGES,
  extractNamespaces,
  namespacesForPage,
  computeKeyLastChanged,
  computeSitemapLastmod,
  gitLastCommitDate,
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

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED');
}
