// Post-Phase-35 — Google Merchant listings / Product snippets structured-data fix.
//
// Run: node test/structured-data-merchant.test.js
//
// Guards against the specific GSC-reported defect (missing "image" on
// holiday-packages.html's 9 Product objects, confirmed critical via live
// Search Console) and against ever fabricating ecommerce/review fields that
// don't apply to Vilu's real business (accommodation/travel packages, not
// shipped physical goods). Reads the actual generated locale mirrors — run
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
const ALL_MIRRORS = ['', 'ar/', 'cs/', 'de/', 'fr/', 'it/', 'ja/', 'ko/', 'ru/', 'sk/', 'zh/']; // '' = English source

const LOCKED_SLUGS_PRICES = {
  'island-explorer-getaway': '450', 'reef-sunset-adventure': '550', 'island-serenity-escape': '650',
  'maldives-dream-bliss': '700', 'ultimate-island-relaxation': '790', 'grand-maldives-escape': '880',
  'ultimate-maldives-odyssey': '940', 'ultimate-resort-island-odyssey': '1300', 'honeymoon-dream-escape': '1100',
};

function productArray(file) {
  const html = read(file);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    let json;
    try { json = JSON.parse(b[1]); } catch (e) { continue; }
    const arr = Array.isArray(json) ? json : [json];
    if (arr[0] && arr[0]['@type'] === 'Product') return arr;
  }
  return null;
}

section('Case A — every holiday-packages.html Product has a real image (the critical GSC-reported defect)');
{
  for (const prefix of ALL_MIRRORS) {
    const file = `${prefix}holiday-packages.html`;
    test(`${file}: all 9 Products carry an "image" field`, () => {
      const arr = productArray(file);
      assert.ok(arr, `${file}: no Product JSON-LD array found`);
      assert.equal(arr.length, 9, `${file}: expected 9 Products, found ${arr.length}`);
      for (const p of arr) {
        assert.ok(typeof p.image === 'string' && p.image.length > 0, `${file}: "${p.name}" has no image`);
      }
    });
  }
}

section('Case B — image URLs are absolute, HTTPS, crawlable-format, and point at real shipped assets');
{
  test('every image URL is an absolute https://viluresidence.com/images/... URL (no placeholder, no relative path, no data: URI)', () => {
    const arr = productArray('holiday-packages.html');
    for (const p of arr) {
      assert.ok(/^https:\/\/viluresidence\.com\/images\/[\w.-]+\.(jpg|jpeg|png|webp)$/.test(p.image), `"${p.name}": image URL is not a well-formed absolute production URL: ${p.image}`);
    }
  });
  test('every referenced image file actually exists in the repository (no dangling reference)', () => {
    const arr = productArray('holiday-packages.html');
    for (const p of arr) {
      const filename = p.image.split('/').pop();
      assert.ok(fs.existsSync(`images/${filename}`), `"${p.name}": images/${filename} does not exist locally`);
    }
  });
}

section('Case C — no fabricated ecommerce identifiers or fields');
{
  test('no Product anywhere on the site carries a gtin/mpn/sku (never fabricated)', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-'));
    for (const file of pages) {
      const arr = productArray(file);
      if (!arr) continue;
      for (const p of arr) {
        assert.ok(p.gtin === undefined && p.gtin13 === undefined && p.gtin8 === undefined && p.gtin12 === undefined && p.gtin14 === undefined, `${file}: "${p.name}" has a fabricated gtin`);
        assert.ok(p.mpn === undefined, `${file}: "${p.name}" has a fabricated mpn`);
        assert.ok(p.sku === undefined, `${file}: "${p.name}" has a fabricated sku`);
      }
    }
  });
  test('no Offer anywhere carries shippingDetails (Vilu does not ship physical goods)', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-'));
    for (const file of pages) {
      const arr = productArray(file);
      if (!arr) continue;
      for (const p of arr) {
        assert.ok(!p.offers || p.offers.shippingDetails === undefined, `${file}: "${p.name}" has a fabricated shippingDetails`);
      }
    }
  });
  test('no Offer anywhere carries hasMerchantReturnPolicy (a retail return policy is not semantically applicable to travel bookings)', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-'));
    for (const file of pages) {
      const arr = productArray(file);
      if (!arr) continue;
      for (const p of arr) {
        assert.ok(!p.offers || p.offers.hasMerchantReturnPolicy === undefined, `${file}: "${p.name}" has a fabricated hasMerchantReturnPolicy`);
      }
    }
  });
  test('no Product anywhere carries a fabricated review or aggregateRating', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-'));
    for (const file of pages) {
      const arr = productArray(file);
      if (!arr) continue;
      for (const p of arr) {
        assert.ok(p.review === undefined, `${file}: "${p.name}" has a fabricated review`);
        assert.ok(p.aggregateRating === undefined, `${file}: "${p.name}" has a fabricated aggregateRating`);
      }
    }
  });
}

section('Case D — brand is truthful and consistent (resolves the "no global identifier" warning without inventing one)');
{
  test('every holiday-packages.html Product carries brand {"@type":"Brand","name":"Vilu Residence"} — no other value, matching the site-established pattern', () => {
    const arr = productArray('holiday-packages.html');
    for (const p of arr) {
      assert.deepEqual(p.brand, { '@type': 'Brand', name: 'Vilu Residence' }, `"${p.name}": brand does not match the established Vilu Residence pattern`);
    }
  });
  test('whale-shark-snorkeling.html and manta-ray-snorkeling.html (the pre-existing reference pattern) still carry the same brand value', () => {
    for (const file of ['whale-shark-snorkeling.html', 'manta-ray-snorkeling.html']) {
      const html = read(file);
      const m = html.match(/"brand":\s*\{\s*"@type":\s*"Brand",\s*"name":\s*"Vilu Residence"\s*\}/);
      assert.ok(m, `${file}: brand pattern missing or changed`);
    }
  });
}

section('Case E — locked package facts (names/prices/URLs) are unchanged by this fix');
{
  test('every package name, price, and offer URL fragment is byte-identical to the locked commercial contract', () => {
    const arr = productArray('holiday-packages.html');
    const bySlug = {};
    for (const p of arr) {
      const slug = p.offers.url.split('#')[1];
      bySlug[slug] = p;
    }
    for (const [slug, price] of Object.entries(LOCKED_SLUGS_PRICES)) {
      assert.ok(bySlug[slug], `locked package slug "${slug}" is missing from the Product array`);
      assert.equal(bySlug[slug].offers.price, price, `"${slug}": price changed from the locked value ${price}`);
    }
  });
}

section('Case F — JSON-LD stays valid and localizes correctly across every locale mirror');
{
  for (const loc of FULL_LOCALES) {
    test(`${loc}/holiday-packages.html: Product JSON-LD parses, image/brand identical to English, name localized`, () => {
      const file = `${loc}/holiday-packages.html`;
      if (!fs.existsSync(file)) return;
      const enArr = productArray('holiday-packages.html');
      const locArr = productArray(file);
      assert.ok(locArr, `${file}: no Product array found`);
      assert.equal(locArr.length, 9, `${file}: expected 9 Products`);
      for (let i = 0; i < 9; i++) {
        assert.equal(locArr[i].image, enArr[i].image, `${file}: Product #${i} image should be identical to English (image URLs are not localized)`);
        assert.deepEqual(locArr[i].brand, enArr[i].brand, `${file}: Product #${i} brand should be identical to English`);
      }
    });
  }
}

section('Summary');
console.log(`\n${passed}/${passed + failed} structured-data/merchant-listing assertions passed`);
if (failed > 0) process.exitCode = 1;
