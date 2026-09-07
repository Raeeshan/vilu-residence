// Phase 38 — Image & Video SEO regression suite.
//
// Run: node test/media-seo.test.js
//
// Guards the media-SEO fixes made during Phase 38: the closed related-card
// alt-text backlog (~50 instances, previously repeating the linked page's
// title instead of describing the image, and English-only on every
// translated page), the removed Firebase Storage tokenized image URL in
// JSON-LD, image-sitemap cleanliness, and that no Product/OG/JSON-LD image
// regressed. Reads the actual generated locale mirrors -- run
// `node build-i18n-pages.js` first if source files changed.

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
const RELATED_CARD_PAGES = [
  'best-local-islands-snorkeling.html', 'best-time-to-visit.html', 'getting-to-maamigili.html',
  'guesthouse-vs-resort.html', 'holiday-packages.html', 'maamigili-guide.html',
  'maldives-holiday-cost.html', 'manta-ray-snorkeling.html', 'south-ari-atoll-guide.html',
  'south-ari-vs-other-regions.html', 'things-to-do-maamigili.html', 'whale-shark-snorkeling.html',
];

function jsonLdNodes(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      for (const n of (Array.isArray(parsed) ? parsed : [parsed])) nodes.push(n);
    } catch (e) { /* skip malformed */ }
  }
  return nodes;
}

section('Case A — related-card alt-text backlog is closed (English source)');
{
  test('no related-card-img alt text merely repeats a page title anymore (e.g. "Holiday Packages", "South Ari Atoll Guide")', () => {
    const knownTitles = ['South Ari Atoll Guide', 'Whale Shark Snorkeling', 'Manta Ray Snorkeling', 'Holiday Packages', 'Maamigili Guide', 'Best Time to Visit', 'Getting to Maamigili', 'Guesthouse vs Resort', 'Holiday Cost Guide'];
    for (const file of RELATED_CARD_PAGES) {
      const html = read(file);
      for (const m of html.matchAll(/<img class="related-card-img"[^>]*?\salt="([^"]*)"/g)) {
        assert.ok(!knownTitles.includes(m[1]), `${file}: related-card-img alt is still a bare page title: "${m[1]}"`);
      }
    }
  });
  test('every non-empty related-card-img alt is a genuine visual description (not filename-like, reasonable length)', () => {
    for (const file of RELATED_CARD_PAGES) {
      const html = read(file);
      for (const m of html.matchAll(/<img class="related-card-img"[^>]*?\salt="([^"]*)"/g)) {
        const alt = m[1];
        if (alt === '') continue; // deliberate decorative empty alt (e.g. the logo card) is valid
        assert.ok(alt.length >= 15 && alt.length <= 150, `${file}: alt "${alt}" is not a reasonable descriptive length`);
        assert.ok(!/\.(jpg|jpeg|png|webp)$/i.test(alt), `${file}: alt "${alt}" looks filename-like`);
      }
    }
  });
  test('every meaningful related-card-img carries data-i18n-alt so locale mirrors get a real translation, not a stale English copy', () => {
    for (const file of RELATED_CARD_PAGES) {
      const html = read(file);
      for (const m of html.matchAll(/<img class="related-card-img"([^>]*)>/g)) {
        const tag = m[1];
        const altMatch = tag.match(/alt="([^"]*)"/);
        if (altMatch && altMatch[1] === '') continue; // decorative, no i18n needed
        assert.ok(/data-i18n-alt="media\./.test(tag), `${file}: a meaningful related-card-img is missing data-i18n-alt: ${tag.slice(0, 100)}`);
      }
    }
  });
}

section('Case B — related-card alt-text backlog is closed across every full locale (was English-only before Phase 38)');
{
  const ENGLISH_ALT_TEXT = [
    'Whale shark swimming near the surface in South Ari Atoll, Maldives',
    'Whale shark near the surface in the South Ari Marine Protected Area, close to Maamigili',
    'Manta ray gliding over the reef at Maamigili Beyru, South Ari Atoll',
    'Snorkellers swimming over the reef near Maamigili, Maldives',
    'Sandbank sunset excursion with beach barbecue dining near Maamigili, South Ari Atoll',
    'Guests relaxing in the lagoon near Vilu Residence, Maldives',
    'Vilu Residence courtyard and guesthouse building in Maamigili',
  ];
  for (const loc of FULL_LOCALES) {
    test(`${loc}: related-card-img alt text is translated, not left in English`, () => {
      for (const file of RELATED_CARD_PAGES) {
        const mirror = `${loc}/${file}`;
        if (!fs.existsSync(mirror)) continue;
        const html = read(mirror);
        for (const m of html.matchAll(/<img class="related-card-img"[^>]*?\salt="([^"]*)"/g)) {
          const alt = m[1];
          if (alt === '') continue;
          assert.ok(!ENGLISH_ALT_TEXT.includes(alt), `${mirror}: alt text left in English: "${alt}"`);
        }
      }
    });
  }
}

section('Case C — no Firebase Storage tokenized image URL remains in JSON-LD (Phase 33 finding, closed)');
{
  test('vilu-website.html carries no firebasestorage.googleapis.com URL anywhere', () => {
    assert.ok(!/firebasestorage\.googleapis\.com/.test(read('vilu-website.html')), 'a Firebase Storage URL is still present');
  });
  test('the replacement is a stable, real, already-shipped Vilu-hosted room photo', () => {
    const nodes = jsonLdNodes(read('vilu-website.html'));
    const lb = nodes.find(n => n['@type'] === 'LodgingBusiness');
    assert.ok(Array.isArray(lb.image) && lb.image.some(i => i.includes('/images/rooms/vilu-residence-deluxe-family-room-interior-vr01')), 'LodgingBusiness.image does not include the stable replacement room photo');
    for (const img of lb.image) {
      assert.ok(img.startsWith('https://viluresidence.net/'), `LodgingBusiness image not absolute/canonical: ${img}`);
      const localPath = img.replace('https://viluresidence.net/', '');
      assert.ok(fs.existsSync(localPath), `LodgingBusiness image file missing locally: ${localPath}`);
    }
  });
  test('no full-locale homepage mirror leaked the old Firebase URL', () => {
    for (const loc of FULL_LOCALES) {
      const file = `${loc}/index.html`;
      if (!fs.existsSync(file)) continue;
      assert.ok(!/firebasestorage\.googleapis\.com/.test(read(file)), `${file}: still has the Firebase Storage URL`);
    }
  });
}

section('Case D — image sitemap is clean');
{
  test('every unique <image:loc> in sitemap.xml uses the canonical host and resolves to a real local file', () => {
    const xml = read('sitemap.xml');
    const urls = [...new Set([...xml.matchAll(/<image:loc>([^<]*)<\/image:loc>/g)].map(m => m[1]))];
    assert.ok(urls.length > 0, 'no image entries found in sitemap.xml');
    for (const u of urls) {
      assert.ok(u.startsWith('https://viluresidence.net/'), `sitemap image URL not canonical: ${u}`);
      assert.ok(!/firebasestorage/.test(u), `sitemap image URL is a Firebase Storage URL: ${u}`);
      const localPath = decodeURIComponent(u.replace('https://viluresidence.net/', ''));
      assert.ok(fs.existsSync(localPath), `sitemap image file missing locally: ${localPath}`);
    }
  });
}

section('Case E — Merchant/Product images (Phase post-35 fix) remain untouched and valid');
{
  test('all 9 holiday-packages.html Products still have a real, absolute, existing image and correct brand', () => {
    const arr = jsonLdNodes(read('holiday-packages.html')).filter(n => n['@type'] === 'Product');
    assert.equal(arr.length, 9);
    for (const p of arr) {
      assert.ok(p.image && p.image.startsWith('https://viluresidence.net/images/'), `${p.name}: image not absolute/canonical`);
      assert.ok(fs.existsSync(p.image.replace('https://viluresidence.net/', '')), `${p.name}: image file missing`);
      assert.deepEqual(p.brand, { '@type': 'Brand', name: 'Vilu Residence' }, `${p.name}: brand regressed`);
    }
  });
}

section('Case F — Open Graph images are correct on every representative page');
{
  for (const file of ['vilu-website.html', 'holiday-packages.html', 'maamigili-guide.html', 'south-ari-atoll-guide.html', 'whale-shark-snorkeling.html', 'manta-ray-snorkeling.html', 'getting-to-maamigili.html']) {
    test(`${file}: og:image is absolute, canonical, and the file exists`, () => {
      const html = read(file);
      const m = html.match(/property="og:image" content="([^"]*)"/);
      assert.ok(m, `${file}: no og:image found`);
      assert.ok(m[1].startsWith('https://viluresidence.net/'), `${file}: og:image not absolute/canonical: ${m[1]}`);
      assert.ok(fs.existsSync(m[1].replace('https://viluresidence.net/', '')), `${file}: og:image file missing: ${m[1]}`);
    });
  }
}

section('Case G — hero video structure is intact and untouched (protected, per Task 6)');
{
  test('hero poster, video element, and mount function are all present with the expected protective attributes', () => {
    const html = read('vilu-website.html');
    assert.ok(html.includes('id="vc-hero-poster"') && html.includes('fetchpriority="high"'), 'hero poster / fetchpriority missing');
    assert.ok(/<video class="vc-hero-video" id="vc-hero-video" muted loop playsinline preload="none"/.test(html), 'hero video attributes changed');
    assert.ok(html.includes("hero-desktop.mp4") && html.includes("hero-mobile.mp4"), 'hero video sources missing');
  });
  test('no VideoObject JSON-LD was added for the purely decorative hero (documented decision)', () => {
    const nodes = jsonLdNodes(read('vilu-website.html'));
    assert.ok(!nodes.some(n => n['@type'] === 'VideoObject'), 'a VideoObject node was added for the decorative hero video');
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} media-SEO assertions passed`);
if (failed > 0) process.exitCode = 1;
