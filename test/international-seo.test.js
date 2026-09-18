// Phase 32 — international SEO QA regression suite.
//
// Run: node test/international-seo.test.js
//
// Guards against the specific defects found and fixed during Phase 32's
// hreflang/canonical/JSON-LD/link-integrity audit, so they don't silently
// regress in a future phase. Reads the actual generated locale mirrors
// (never assumes correctness) — run `node build-i18n-pages.js` first if
// source files changed since the last build.

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
function exists(p) { return fs.existsSync(p); }

const FULL_LOCALES = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk', 'zh']; // es is intentionally partial
const ALL_LOCALES = [...FULL_LOCALES, 'es'];
const GUIDE_PAGES = [
  'whale-shark-snorkeling.html', 'manta-ray-snorkeling.html', 'south-ari-atoll-guide.html',
  'maamigili-guide.html', 'best-time-to-visit.html', 'guesthouse-vs-resort.html',
  'maldives-holiday-cost.html', 'best-local-islands-snorkeling.html',
  'south-ari-vs-other-regions.html', 'things-to-do-maamigili.html',
];

section('Case A — getting-to-maamigili.html links resolve to a real page in every full locale');
{
  for (const loc of FULL_LOCALES) {
    for (const page of ['index.html', 'holiday-packages.html', 'maamigili-guide.html']) {
      const p = path.join(loc, page);
      if (!exists(p)) continue;
      test(`${p}: no bare relative "getting-to-maamigili.html" link (would 404 as /${loc}/getting-to-maamigili.html)`, () => {
        const html = read(p);
        assert.ok(
          !/href="getting-to-maamigili\.html"/.test(html),
          `found a bare relative link to getting-to-maamigili.html, which has no /${loc}/ mirror`
        );
        if (html.includes('getting-to-maamigili.html')) {
          assert.ok(
            html.includes('href="/getting-to-maamigili.html"'),
            'expected the real English page to be linked root-absolute'
          );
        }
      });
    }
  }
}

section('Case B — JSON-LD self-referencing URLs point at the locale\'s own page, not the English root');
{
  for (const loc of FULL_LOCALES) {
    const hp = path.join(loc, 'holiday-packages.html');
    test(`${hp}: every Product.offers.url points at /${loc}/holiday-packages.html, never the English root`, () => {
      const html = read(hp);
      const urls = [...html.matchAll(/"url":\s*"(https:\/\/viluresidence\.com\/[^"]*holiday-packages\.html[^"]*)"/g)].map(m => m[1]);
      assert.ok(urls.length > 0, 'expected at least one Product.offers.url in the JSON-LD');
      for (const u of urls) {
        assert.ok(u.startsWith(`https://viluresidence.com/${loc}/`), `offers.url leaked the English root: ${u}`);
      }
    });

    const maa = path.join(loc, 'maamigili-guide.html');
    if (exists(maa)) {
      test(`${maa}: Article.mainEntityOfPage.@id points at /${loc}/maamigili-guide.html`, () => {
        const html = read(maa);
        const m = html.match(/"mainEntityOfPage":\s*{\s*"@type":\s*"WebPage",\s*"@id":\s*"([^"]+)"/);
        assert.ok(m, 'expected a mainEntityOfPage.@id in the JSON-LD');
        assert.equal(m[1], `https://viluresidence.com/${loc}/maamigili-guide.html`, `mainEntityOfPage.@id leaked the English root: ${m[1]}`);
      });
    }
  }
}

section('Case C — no guide page fabricates a Spanish (es) hreflang alternate');
{
  for (const page of GUIDE_PAGES) {
    test(`${page}: no locale mirror carries a fabricated hreflang="es" (Spanish is a partial locale, guides excluded)`, () => {
      for (const loc of FULL_LOCALES) {
        const p = path.join(loc, page);
        if (!exists(p)) continue;
        const html = read(p);
        assert.ok(!/hreflang="es"/.test(html), `${p} carries a fabricated hreflang="es"`);
      }
      // English source itself must not carry one either.
      if (exists(page)) {
        assert.ok(!/hreflang="es"/.test(read(page)), `${page} (English source) carries a fabricated hreflang="es"`);
      }
    });
  }
}

section('Case D — Spanish partial-locale sibling-link fallback stays correct');
{
  test('es/index.html and es/holiday-packages.html link every uncovered guide page root-absolute to the real English page, never a fake /es/ route', () => {
    for (const page of ['index.html', 'holiday-packages.html']) {
      const html = read(path.join('es', page));
      for (const guide of GUIDE_PAGES) {
        if (guide === 'holiday-packages.html') continue;
        assert.ok(!html.includes(`href="/es/${guide}"`) && !new RegExp(`href="${guide.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html),
          `es/${page} links ${guide} as if a Spanish mirror existed`);
      }
    }
  });
}

section('Case E — sitemap.xml stays clean');
{
  const sitemap = read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

  test('every <loc> is a production https://viluresidence.com/ URL (no Firebase *.web.app, no query strings)', () => {
    for (const u of locs) {
      assert.ok(u.startsWith('https://viluresidence.com/'), `non-production URL in sitemap: ${u}`);
      assert.ok(!u.includes('web.app'), `Firebase-hosting URL leaked into sitemap: ${u}`);
      assert.ok(!u.includes('?'), `query-string URL in sitemap: ${u}`);
    }
  });

  test('no duplicate <loc> entries', () => {
    const dupes = locs.filter((u, i) => locs.indexOf(u) !== i);
    assert.equal(dupes.length, 0, `duplicate sitemap URLs: ${[...new Set(dupes)].join(', ')}`);
  });

  test('vilu-unified.html and vilu-agency-portal.html never appear in the sitemap', () => {
    assert.ok(!locs.some(u => u.includes('vilu-unified.html')), 'PMS URL found in sitemap');
    assert.ok(!locs.some(u => u.includes('vilu-agency-portal.html')), 'Agency Portal URL found in sitemap');
  });

  test('Spanish appears exactly twice (es/ and es/holiday-packages.html), never a fabricated guide URL', () => {
    const esUrls = locs.filter(u => /\/es\//.test(u));
    assert.equal(esUrls.length, 2, `expected exactly 2 Spanish sitemap URLs, found ${esUrls.length}: ${esUrls.join(', ')}`);
  });
}

section('Case F — robots.txt keeps the protected internal pages blocked');
{
  test('robots.txt blocks vilu-unified.html and vilu-agency-portal.html, allows everything else', () => {
    const robots = read('robots.txt');
    assert.match(robots, /Allow:\s*\//);
    assert.match(robots, /Disallow:\s*\/vilu-unified\.html/);
    assert.match(robots, /Disallow:\s*\/vilu-agency-portal\.html/);
    assert.match(robots, /Sitemap:\s*https:\/\/viluresidence\.com\/sitemap\.xml/);
  });
}

section('Case G — lang/dir/canonical are seeded from the URL-detected locale before the first paint, not hardcoded English');
{
  test('vilu-website.html seeds currentLang from detectInitialLang() before the first applyTranslations() call', () => {
    const html = read('vilu-website.html');
    const handler = html.slice(html.indexOf("addEventListener('DOMContentLoaded', async function()"));
    const beforeFirstApply = handler.slice(0, handler.indexOf('applyTranslations();'));
    assert.ok(/currentLang\s*=\s*initial\s*;/.test(beforeFirstApply), 'currentLang must be seeded from the detected locale (not hardcoded \'en\') before the first applyTranslations() call -- lang/dir/canonical would briefly render English/ltr on every non-English page load');
    assert.ok(!/currentLang\s*=\s*'en'\s*;/.test(beforeFirstApply), 'currentLang must not be hardcoded to \'en\' before the first applyTranslations() call');
  });
  test('shared-page-i18n.js seeds currentLang from detectInitialLang() before the first applyTranslations() call', () => {
    const js = read('shared-page-i18n.js');
    const fn = js.slice(js.indexOf('async function initPage()'));
    const beforeFirstApply = fn.slice(0, fn.indexOf('applyTranslations();'));
    assert.ok(/currentLang\s*=\s*initial\s*;/.test(beforeFirstApply), 'currentLang must be seeded from the detected locale before the first applyTranslations() call');
    assert.ok(!/currentLang\s*=\s*'en'\s*;/.test(beforeFirstApply), 'currentLang must not be hardcoded to \'en\' before the first applyTranslations() call');
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} international-SEO assertions passed`);
if (failed > 0) process.exitCode = 1;
