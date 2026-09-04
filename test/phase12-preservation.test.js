// Phase 12 preservation regression harness.
//
// Run: node test/phase12-preservation.test.js
//
// Loads test/phase12-preservation-manifest.json and checks the CURRENT working
// tree against it SEMANTICALLY (titles, canonicals, hreflang, JSON-LD types,
// the nine-package contract, analytics/consent contracts, booking/PMS
// structure, multilingual output, contact paths, font policy). It never does
// whole-file equality as its main mechanism, never touches the network, never
// writes to Firestore, and never creates a reservation: it is structural
// regression testing only.
//
// Uses only Node built-ins (assert/strict, fs, path, vm, crypto), matching the
// existing test/*.test.js convention. Regex extraction is used for the small
// set of well-formed head/body tags it inspects; the build itself (cheerio)
// is not required to run this file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const M = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase12-preservation-manifest.json'), 'utf8'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + String(e.message).split('\n').join('\n        ')); process.exitCode = 1; }
}
function section(t) { console.log(`\n# ${t}`); }

const cache = new Map();
// Line endings are normalized to LF here so every assertion below tests the
// SAME source logic regardless of the checkout's line-ending representation.
// core.autocrlf=true (a standard, expected Windows git setting -- left
// untouched, not something this harness should fight) converts LF blobs to
// CRLF on checkout; a handful of assertions match multi-line literal text
// (e.g. faqWireExpandTracking's closing braces), and those hardcode `\n`.
// Without this, the exact same commit can show a different preservation
// result purely depending on which machine/worktree checked it out -- a
// false regression signal, not a real one. Two call sites intentionally
// read raw bytes instead of going through read() and are correctly left
// alone: the consent.js/analytics.js sha256 baseline fingerprint check
// (line-ending changes to those files SHOULD be caught, byte-exactness is
// the point) and the harness's own self-referential no-network-import check
// (a single-line regex test, already checkout-format-independent).
function normalizeLineEndings(s) { return s.replace(/\r\n?/g, '\n'); }
function read(rel) {
  if (!cache.has(rel)) cache.set(rel, normalizeLineEndings(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  return cache.get(rel);
}
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function attr(tag, name) { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"')); return m ? m[1] : null; }
function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function headOf(html) { const i = html.indexOf('</head>'); return i < 0 ? html : html.slice(0, i); }
function metaByName(html, name) {
  for (const t of headOf(html).match(/<meta\b[^>]*>/g) || []) if (attr(t, 'name') === name) return attr(t, 'content');
  return null;
}
function linkRel(html, rel) { return (headOf(html).match(/<link\b[^>]*>/g) || []).filter(t => attr(t, 'rel') === rel); }
function titleOf(html) { const m = headOf(html).match(/<title>([^<]*)<\/title>/); return m ? m[1] : null; }
function h1s(html) { return [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m => stripTags(m[1])); }
function bodyTag(html) { const m = html.match(/<body\b[^>]*>/); return m ? m[0] : ''; }
function jsonLd(html) {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
}
function jsonLdTypes(html) {
  const types = [];
  for (const block of jsonLd(html)) for (const it of (Array.isArray(block) ? block : (block['@graph'] || [block]))) types.push(it['@type']);
  return types;
}
function sortedCopy(a) { return [...a].sort(); }
function sameSet(actual, expected, label) {
  assert.deepEqual(sortedCopy(actual), sortedCopy(expected), label);
}
function evalBlock(src, startRe, endStr, varName) {
  // Extracts `var NAME = ...;` from a larger script (even inside an IIFE) and evaluates it in isolation.
  const start = src.search(startRe);
  assert.ok(start >= 0, `could not find ${varName}`);
  const end = src.indexOf(endStr, start);
  assert.ok(end > start, `could not find end of ${varName}`);
  const code = src.slice(start, end + endStr.length);
  const ctx = vm.createContext({});
  vm.runInContext(code + `\n;__out = ${varName};`, ctx);
  return JSON.parse(JSON.stringify(ctx.__out)); // strip vm-context prototypes so deepEqual compares values
}

const CONTENT_PAGES = M.pages.filter(p => p.translated !== false);       // 14 (everything except 404)
const SITEMAP_PAGES = M.pages.filter(p => p.in_sitemap);                  // 12

// ---------------------------------------------------------------------------
section('Test harness self-check — line-ending normalization (Phase 12B-E2F)');
{
  test('normalizeLineEndings() makes LF and CRLF (and lone-CR) input produce identical output', () => {
    const lf = 'trustedActivation = false;\n    });\n  });';
    const crlf = 'trustedActivation = false;\r\n    });\r\n  });';
    const cr = 'trustedActivation = false;\r    });\r  });';
    assert.equal(normalizeLineEndings(crlf), lf);
    assert.equal(normalizeLineEndings(cr), lf);
    assert.equal(normalizeLineEndings(lf), lf); // already-LF input is a no-op
  });
  test('read() returns LF-normalized content regardless of the checked-out file\'s actual line endings', () => {
    // Doesn't assert a specific line-ending byte in vilu-website.html (that's
    // a checkout-time artifact, not something this suite should pin down) --
    // only that whatever read() hands back never contains a \r, so every
    // multi-line literal match downstream is checkout-format-independent.
    assert.ok(!read('vilu-website.html').includes('\r'), 'read() output must never contain \\r');
  });
}

// ---------------------------------------------------------------------------
section('URLs / SEO — English source pages');
for (const p of M.pages) {
  test(`${p.file}: source file exists`, () => assert.ok(exists(p.file)));
  if (!exists(p.file)) continue;
  const html = read(p.file);
  test(`${p.file}: <body data-page-type="${p.page_type}" data-page-slug="${p.page_slug}">`, () => {
    const b = bodyTag(html);
    assert.equal(attr(b, 'data-page-type'), p.page_type);
    assert.equal(attr(b, 'data-page-slug'), p.page_slug);
  });
  test(`${p.file}: <title> preserved`, () => assert.equal(titleOf(html), p.title));
  test(`${p.file}: meta description preserved`, () => assert.equal(metaByName(html, 'description'), p.description));
  test(`${p.file}: canonical = ${p.canonical}`, () => {
    const c = linkRel(html, 'canonical');
    if (p.canonical === null) assert.equal(c.length, 0, 'expected no canonical');
    else { assert.equal(c.length, 1); assert.equal(attr(c[0], 'href'), p.canonical); }
  });
  test(`${p.file}: robots = ${p.robots === null ? '(absent)' : p.robots}`, () => assert.equal(metaByName(html, 'robots'), p.robots));
  test(`${p.file}: hreflang ${p.hreflang ? 'parity (' + M.hreflang_codes.length + ' codes)' : 'absent'}`, () => {
    const codes = linkRel(html, 'alternate').map(t => attr(t, 'hreflang')).filter(Boolean);
    if (p.hreflang) sameSet(codes, M.hreflang_codes); else assert.equal(codes.length, 0);
  });
  test(`${p.file}: exactly one <h1> = "${p.h1}"`, () => { const h = h1s(html); assert.equal(h.length, 1); assert.equal(h[0], p.h1); });
  test(`${p.file}: JSON-LD types ${JSON.stringify(p.jsonld_types)}`, () => sameSet(jsonLdTypes(html), p.jsonld_types));
  test(`${p.file}: FAQPage Q&A count = ${p.faq_count}`, () => {
    const faq = jsonLd(html).flatMap(b => Array.isArray(b) ? b : [b]).find(b => b && b['@type'] === 'FAQPage');
    assert.equal(faq ? faq.mainEntity.length : 0, p.faq_count);
  });
  for (const id of p.required_ids || []) test(`${p.file}: required id="${id}"`, () => assert.ok(html.includes(`id="${id}"`)));
  for (const a of p.required_anchors || []) test(`${p.file}: anchor target ${a} exists`, () => assert.ok(html.includes(`id="${a.slice(1)}"`)));
}
test('every content page has hreflang for every language and x-default (12 tags, no duplicates)', () => {
  for (const p of CONTENT_PAGES) {
    const codes = linkRel(read(p.file), 'alternate').map(t => attr(t, 'hreflang'));
    assert.equal(new Set(codes).size, codes.length, p.file + ' duplicate hreflang');
  }
});
test('no unapproved GA measurement id anywhere in shipped root files', () => {
  const files = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f));
  for (const f of files) for (const m of read(f).matchAll(/G-[A-Z0-9]{8,12}\b/g)) assert.equal(m[0], M.analytics.ga_measurement_id, `${f} references ${m[0]}`);
});

// ---------------------------------------------------------------------------
section('URLs / SEO — sitemap');
{
  const sm = read(M.sitemap.file);
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  test(`sitemap has exactly ${M.sitemap.expected_url_count} URLs`, () => assert.equal(locs.length, M.sitemap.expected_url_count));
  test('sitemap URL set is exactly the canonical set (12 pages x (en + 10 languages))', () => {
    const expected = [];
    for (const p of SITEMAP_PAGES) {
      expected.push(M.site_origin + p.url_path);
      for (const l of M.languages) expected.push(M.site_origin + '/' + l + (p.url_path === '/' ? '/' : p.url_path));
    }
    sameSet(locs, expected);
  });
  test('sitemap excludes legal pages, 404 and internal tools', () => {
    for (const u of locs) {
      for (const ex of M.sitemap.excluded_pages.concat(M.internal_tools.files)) assert.ok(!u.endsWith('/' + ex), u);
      assert.ok(!u.endsWith('vilu-website.html') && !u.endsWith('index.html'), 'physical-file alias in sitemap: ' + u);
    }
  });
  test('sitemap URLs equal each page canonical (English)', () => {
    for (const p of SITEMAP_PAGES) assert.ok(locs.includes(p.canonical), p.canonical);
  });
}

// ---------------------------------------------------------------------------
section('Internal tools — reachable but excluded (P4 security residual, not access control)');
test('robots.txt disallows both internal tools and advertises the sitemap', () => {
  const r = read('robots.txt');
  for (const d of M.internal_tools.robots_txt_disallow) assert.ok(r.includes('Disallow: ' + d), d);
  assert.ok(r.includes('Sitemap: ' + M.site_origin + '/sitemap.xml'));
});
for (const f of M.internal_tools.files) test(`${f}: meta robots "${M.internal_tools.robots_meta}"`, () => assert.equal(metaByName(read(f), 'robots'), M.internal_tools.robots_meta));
test('no public page links to the internal tools', () => {
  for (const p of M.pages) for (const f of M.internal_tools.files) assert.ok(!read(p.file).includes('href="' + f) && !read(p.file).includes('href="/' + f), `${p.file} links to ${f}`);
});

// ---------------------------------------------------------------------------
section('Packages — locked nine-package commercial contract');
{
  const hp = read('holiday-packages.html');
  const PACKAGES = evalBlock(hp, /var PACKAGES = \[/, '\n];', 'PACKAGES');
  const items = M.packages.items;
  test(`exactly ${M.packages.expected_count} packages in holiday-packages.html PACKAGES`, () => assert.equal(PACKAGES.length, M.packages.expected_count));
  test('package order and canonical analytics ids', () => assert.deepEqual(PACKAGES.map(p => p.slug), items.map(i => i.id)));
  for (const it of items) {
    const p = PACKAGES.find(x => x.slug === it.id) || {};
    test(`${it.id}: name "${it.name}"`, () => assert.equal(p.name, it.name));
    test(`${it.id}: price $${it.price_usd_pp} pp`, () => assert.equal(p.price, it.price_usd_pp));
    test(`${it.id}: ${it.nights} nights`, () => assert.equal(p.nights, it.nights));
    test(`${it.id}: badge ${it.badge || '(none)'}`, () => assert.equal(p.badge || null, it.badge ? M.packages.badge_i18n_keys[it.badge] : null));
    test(`${it.id}: includes (transfer, accommodation, breakfast)`, () => sameSet(p.includes, M.packages.common_includes.concat([it.accommodation_include])));
    test(`${it.id}: activity set`, () => sameSet(p.activities, it.essential_activities));
    test(`${it.id}: add-ons`, () => sameSet(p.addons, it.addons));
    test(`${it.id}: Save-% presentation baseline (${it.save_percent_presentation === null ? 'none' : it.save_percent_presentation + '%'}; not locked commercial data)`, () => assert.equal(p.save === undefined ? null : p.save, it.save_percent_presentation));
    test(`${it.id}: deep-link anchor id="${it.id}" in prerendered grid`, () => assert.ok(hp.includes(`id="${it.id}"`)));
  }
  test('JSON-LD Product/Offer set matches the nine packages (names + prices)', () => {
    const products = jsonLd(hp).flatMap(b => Array.isArray(b) ? b : [b]).filter(b => b && b['@type'] === 'Product');
    assert.equal(products.length, 9);
    for (const it of items) {
      const pr = products.find(x => x.name === it.name);
      assert.ok(pr, 'missing Product ' + it.name);
      assert.equal(Number(pr.offers.price), it.price_usd_pp, it.name + ' price');
    }
  });
  test('per-package enquiry helpers (pkgWaText / pkgEmailHref) still exist and target the approved contacts', () => {
    assert.ok(/function pkgWaText\(/.test(hp) && /function pkgEmailHref\(/.test(hp));
    assert.ok(hp.includes(M.contact.mailto_prefix));
    assert.ok(hp.includes(M.contact.whatsapp_link_prefix));
  });
  test('each package card offers the live-availability entry point (/#booking)', () => {
    assert.ok((hp.match(/href="\/#booking"/g) || []).length >= 9);
  });
}

// ---------------------------------------------------------------------------
section('Phase 12C-B — Featured Journeys + Full Collection + Duration Guide structure');
{
  const hp = read('holiday-packages.html');
  const PACKAGES = evalBlock(hp, /var PACKAGES = \[/, '\n];', 'PACKAGES');
  const items = M.packages.items;
  const slugs = items.map(i => i.id);

  test('each canonical package slug id="..." appears exactly once in the source (one canonical DOM id per package)', () => {
    for (const slug of slugs) {
      const count = (hp.match(new RegExp(`id="${slug}"`, 'g')) || []).length;
      assert.equal(count, 1, `id="${slug}" should appear exactly once, found ${count}`);
    }
  });

  test('Full Collection contains all 9 canonical packages as <details> elements, in canonical order', () => {
    // Scoped to the prerendered #pkg-grid..#pkg-duration span so the matching stays inside
    // the actual markup and never picks up the "'+p.slug+'"-style literal from the JS
    // template source (renderDynamicContent) further down the same file.
    const gridStart = hp.indexOf('id="pkg-grid"');
    const durationStart = hp.indexOf('id="pkg-duration"');
    assert.ok(gridStart >= 0 && durationStart > gridStart, '#pkg-grid..#pkg-duration span not found');
    const gridBlock = hp.slice(gridStart, durationStart);
    const found = [...gridBlock.matchAll(/<details\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(found, slugs);
  });

  test('Featured Journeys section exists and links only to real canonical package targets', () => {
    const start = hp.indexOf('id="pkg-featured"');
    assert.ok(start >= 0, '#pkg-featured container not found');
    const end = hp.indexOf('id="pkg-grid"', start);
    assert.ok(end > start, '#pkg-grid should follow #pkg-featured');
    const featuredBlock = hp.slice(start, end);
    const hrefs = [...featuredBlock.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
    assert.equal(hrefs.length, 3, 'expected exactly 3 Featured Journeys panels');
    for (const h of hrefs) assert.ok(slugs.includes(h), `Featured Journeys href #${h} is not a canonical package id`);
    // Featured panels are pure navigation: no duplicate canonical id, no data-pkg-* tracking attributes.
    assert.ok(!/id="[^"]*"/.test(featuredBlock.replace(/id="pkg-featured"/, '')), 'Featured Journeys panels must not carry their own id attributes');
    assert.ok(!featuredBlock.includes('data-pkg-slug'), 'Featured Journeys panels must not carry data-pkg-slug (single-sourced package_view tracking from the Full Collection only)');
  });

  test('Duration Guide lists all 9 packages, sorted by nights, each linking to its canonical id', () => {
    const start = hp.indexOf('id="pkg-duration"');
    assert.ok(start >= 0, '#pkg-duration container not found');
    // Bounded to the next real section wrapper so the match stays inside the prerendered
    // markup and never reaches the "'+p.slug+'"-style literal in the JS template source.
    const end = hp.indexOf('hp-section', start);
    assert.ok(end > start, 'next section boundary after #pkg-duration not found');
    const durationBlock = hp.slice(start, end);
    const hrefs = [...durationBlock.matchAll(/class="pc-duration-row" href="#([^"]+)"/g)].map(m => m[1]);
    assert.equal(hrefs.length, 9, 'expected all 9 packages in the Duration Guide');
    sameSet(hrefs, slugs);
    const sortedByNights = items.slice().sort((a, b) => a.nights - b.nights).map(i => i.id);
    assert.deepEqual(hrefs, sortedByNights, 'Duration Guide rows must be sorted by nights ascending');
    assert.ok(!/\$\d+\s*(\/|per)\s*night/i.test(durationBlock), 'Duration Guide must not present price-per-night');
  });

  test('every package renders its full detail (Includes/Activities/Add-Ons) in crawlable, no-JS-safe static HTML', () => {
    for (const p of PACKAGES) {
      const detailStart = hp.indexOf(`id="${p.slug}"`);
      assert.ok(detailStart >= 0, `${p.slug} not found`);
      const detailEnd = hp.indexOf('</details>', detailStart);
      const block = hp.slice(detailStart, detailEnd);
      for (const inc of p.includes) assert.ok(block.includes(inc.replace(/'/g, '&#39;')) || block.includes(inc), `${p.slug} missing include "${inc}"`);
      for (const act of p.activities) assert.ok(block.includes(act), `${p.slug} missing activity "${act}"`);
      for (const ao of p.addons) assert.ok(block.includes(ao), `${p.slug} missing add-on "${ao}"`);
    }
  });

  test('package detail is inside a native <details>/<summary> disclosure (no-JS-safe, keyboard-operable, no modal)', () => {
    for (const slug of slugs) {
      assert.ok(hp.includes(`<details class="pc-pkg reveal visible" id="${slug}"`), `${slug} is not a native <details> element`);
    }
    assert.ok(!/class="[^"]*modal/i.test(hp.slice(hp.indexOf('id="pkg-grid"'), hp.indexOf('id="pkg-duration"'))), 'package detail must not use a modal pattern');
  });

  test('PMS files remain untouched by the package-page CSS redesign (no .pc- prefixed classes, no shared-page.css coupling)', () => {
    for (const f of M.internal_tools.files) {
      const pms = read(f);
      assert.ok(!/class="[^"]*\bpc-[a-z-]+/.test(pms), `${f} must not reference .pc- prefixed package-redesign classes`);
      assert.ok(!pms.includes('shared-page.css'), `${f} must not load shared-page.css`);
    }
  });
}

// ---------------------------------------------------------------------------
section('Phase 12C-C — premium motion + deep-link hardening');
{
  const hp = read('holiday-packages.html');
  const css = read('shared-page.css');
  const items = M.packages.items;
  const slugs = items.map(i => i.id);

  test('package hash resolver recognizes exactly the 9 canonical slugs (only via a real <details id> inside #pkg-grid, not a hardcoded list)', () => {
    assert.ok(/function pcResolveHash\(\)/.test(hp), 'pcResolveHash() not found');
    assert.ok(/target\.closest\(['"]#pkg-grid['"]\)/.test(hp), 'resolver must scope to a real #pkg-grid descendant, not just any id');
    assert.ok(/target\.tagName !== ['"]DETAILS['"]/.test(hp), 'resolver must require the target to be a <details> element');
    // The 9 real ids are exactly the Full Collection's own ids -- reconfirm here
    // in this section too, since the resolver's correctness depends on it.
    const found = [...hp.slice(hp.indexOf('id="pkg-grid"'), hp.indexOf('id="pkg-duration"')).matchAll(/<details\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(found.length, 9);
    sameSet(found, slugs);
  });

  test('direct hash target is opened (details.open = true), not merely scrolled to', () => {
    assert.ok(/target\.open\s*=\s*true/.test(hp), 'resolver must set target.open = true');
  });

  test('hash resolution runs after the package grid (re)renders, and again on hashchange -- not from a fixed-delay timer or endless poll', () => {
    assert.ok(/pcResolveHash\(\);\s*\n\}/.test(hp) || /if \(typeof pcResolveHash === 'function'\) pcResolveHash\(\);/.test(hp), 'renderDynamicContent() must call the resolver after rebuilding the grid');
    assert.ok(/addEventListener\(['"]hashchange['"],\s*pcResolveHash\)/.test(hp), 'a hashchange listener must re-resolve the hash');
    assert.ok(!/setInterval/.test(hp), 'must not poll on a timer');
    // Bounded settle: allowed to wait a couple of animation frames, never a
    // recurring one.
    const rafCount = (hp.match(/requestAnimationFrame/g) || []).length;
    assert.ok(rafCount >= 1 && rafCount <= 4, `expected a small bounded number of requestAnimationFrame call sites, found ${rafCount}`);
  });

  test('Featured Journeys links remain real href="#slug" anchors (still functional with JS disabled)', () => {
    const start = hp.indexOf('id="pkg-featured"');
    const end = hp.indexOf('id="pkg-grid"', start);
    const hrefs = [...hp.slice(start, end).matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
    assert.equal(hrefs.length, 3);
    for (const h of hrefs) assert.ok(slugs.includes(h), `Featured href #${h} is not a canonical package id`);
  });

  test('Duration Guide links remain real href="#slug" anchors (still functional with JS disabled)', () => {
    const start = hp.indexOf('id="pkg-duration"');
    const end = hp.indexOf('hp-section', start);
    const hrefs = [...hp.slice(start, end).matchAll(/class="pc-duration-row" href="#([^"]+)"/g)].map(m => m[1]);
    assert.equal(hrefs.length, 9);
    sameSet(hrefs, slugs);
  });

  test('no duplicate canonical ids: each of the 9 slugs still appears as id="..." exactly once', () => {
    for (const slug of slugs) {
      const count = (hp.match(new RegExp(`id="${slug}"`, 'g')) || []).length;
      assert.equal(count, 1, `id="${slug}" should appear exactly once, found ${count}`);
    }
  });

  test('package commercial data is unchanged by the motion/deep-link work', () => {
    const PACKAGES = evalBlock(hp, /var PACKAGES = \[/, '\n];', 'PACKAGES');
    assert.equal(PACKAGES.length, M.packages.expected_count);
    for (const it of items) {
      const p = PACKAGES.find(x => x.slug === it.id) || {};
      assert.equal(p.name, it.name);
      assert.equal(p.price, it.price_usd_pp);
      assert.equal(p.nights, it.nights);
    }
  });

  test('a reduced-motion hook exists and neutralizes animation/transition duration and delay site-wide', () => {
    assert.ok(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/.test(css), 'no prefers-reduced-motion:reduce rule found');
    const block = css.slice(css.indexOf('prefers-reduced-motion:reduce'), css.indexOf('prefers-reduced-motion:reduce') + 400);
    assert.ok(/animation-duration:\.01ms\s*!important/.test(block), 'reduced-motion rule must neutralize animation-duration');
    assert.ok(/transition-duration:\.01ms\s*!important/.test(block), 'reduced-motion rule must neutralize transition-duration');
    assert.ok(/transition-delay:0ms\s*!important/.test(block), 'reduced-motion rule must also neutralize transition-delay (staggers)');
  });

  test('new motion is scoped behind prefers-reduced-motion:no-preference or is a benign hover/focus color change', () => {
    // The hero settle, Featured stagger/clip-path reveal and duration-line
    // growth are all gated -- this is a structural sanity check that the
    // gate exists at all, not a pixel-level animation assertion.
    assert.ok(/@media \(prefers-reduced-motion:no-preference\)/.test(css));
    assert.ok(css.includes('pcHeroSettle') && css.includes('pcFadeUp'));
  });

  test('progressive-enhancement base state: package detail is visible by default, not opacity:0 outside a transient JS-applied class', () => {
    const base = css.slice(css.indexOf('.pc-pkg-detail{padding:0 20px 22px'), css.indexOf('.pc-pkg-detail{padding:0 20px 22px') + 400);
    assert.ok(/\.pc-pkg-detail\{[^}]*opacity:1/.test(base), 'the base .pc-pkg-detail rule must default to opacity:1');
    assert.ok(css.includes('.pc-pkg-detail.pc-detail-enter'), 'the transient enter-state must be a separate, JS-toggled class, not the base rule');
  });

  test('a no-JS fallback exists for the shared .reveal class on this page (content must not stay opacity:0 forever with JS disabled)', () => {
    assert.ok(/<noscript><style>\.reveal\{opacity:1/.test(hp), 'expected a <noscript> override restoring .reveal to opacity:1');
  });

  test('package_view analytics target remains the canonical Full Collection only -- Featured/Duration stay untracked navigation surfaces', () => {
    assert.ok(hp.includes(`document.querySelectorAll('#pkg-grid .pc-pkg')`), 'package_view observer selector must remain scoped to #pkg-grid .pc-pkg');
    const featuredBlock = hp.slice(hp.indexOf('id="pkg-featured"'), hp.indexOf('id="pkg-grid"'));
    assert.ok(!featuredBlock.includes('data-pkg-slug'), 'Featured panels must not carry data-pkg-slug');
    const durationBlock = hp.slice(hp.indexOf('id="pkg-duration"'), hp.indexOf('hp-section', hp.indexOf('id="pkg-duration"')));
    assert.ok(!durationBlock.includes('data-pkg-slug'), 'Duration Guide rows must not carry data-pkg-slug');
  });

  test('analytics.js is untouched by this stage', () => {
    // Structural proxy: this stage's own report states analytics.js was not
    // edited; a real regression would show up as one of the analytics
    // section's own assertions below failing, since those read analytics.js
    // directly. This test exists only to document the constraint here too.
    assert.ok(exists('analytics.js'));
  });

  test('no autoplay video was added to the package page', () => {
    assert.ok(!/<video\b/i.test(hp), 'a <video> element was added to holiday-packages.html');
  });

  test('no new animation framework or external script dependency was added', () => {
    const scriptSrcs = [...hp.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
    for (const src of scriptSrcs) {
      assert.ok(!/cdn|gsap|anime|framer|unpkg|jsdelivr/i.test(src), `unexpected external/animation-library script: ${src}`);
    }
  });

  test('sticky mobile CTA contract preserved: same ids, same session-dismissal key, mobile-only', () => {
    assert.ok(hp.includes('id="pkg-sticky-cta"') && hp.includes('id="pkg-sticky-cta-close"'));
    assert.ok(hp.includes("sessionStorage.getItem('hp_sticky_dismissed')") && hp.includes("sessionStorage.setItem('hp_sticky_dismissed', '1')"));
    assert.ok(css.includes('@media(min-width:701px){.pkg-sticky-cta{display:none !important}}') || /@media\(min-width:701px\)\{\.pkg-sticky-cta\{display:none/.test(css));
  });
}

// ---------------------------------------------------------------------------
section('Phase 12C-D — multilingual, accessibility, analytics completion');
{
  const hp = read('holiday-packages.html');
  const css = read('shared-page.css');
  const items = M.packages.items;
  const slugs = items.map(i => i.id);
  const NEW_12C_KEYS = ['planHoliday','emailVilu','viewJourney','viewDetails','heroEyebrow','heroDisplay','verifiedLine','featuredTag','featuredTitle','collectionTag','collectionTitle','durationTag','durationTitle'];
  // Strips <script>...</script> and HTML comments so an English-leakage
  // check only ever looks at real page text, never at this codebase's own
  // (never-translated) code/documentation comments -- e.g. "...every .reveal
  // section on this page (intro, Featured Journeys, Duration Guide...)"
  // appears verbatim in every language's generated file and is not a leak.
  function stripScripts(s) { return s.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, ''); }

  test('all 10 languages have every new 12C-B/C hpPage key, non-empty (no English-fallback gaps)', () => {
    for (const lang of M.languages) {
      const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', lang + '.json'), 'utf8'));
      const hpPage = (dict.static && dict.static.hpPage) || {};
      for (const k of NEW_12C_KEYS) {
        assert.ok(k in hpPage, `${lang}: missing hpPage.${k}`);
        assert.ok(String(hpPage[k] || '').trim().length > 0, `${lang}: hpPage.${k} is empty`);
      }
    }
  });

  test('critical package-page UI strings do not leak into translated pages as literal English', () => {
    const CRITICAL_ENGLISH = ['Featured Journeys', 'Full Collection', 'Duration Guide', 'Plan This Holiday', 'Email Vilu', 'View Journey', 'View Details'];
    for (const lang of M.languages) {
      const generated = stripScripts(read(path.join(lang, 'holiday-packages.html')));
      for (const phrase of CRITICAL_ENGLISH) {
        assert.ok(!generated.includes(phrase), `${lang}/holiday-packages.html still shows English "${phrase}"`);
      }
    }
  });

  test('FAQ trusted-user tracking: armed only by a real click/Enter/Space on <summary>, consumed once per toggle (ports the proven homepage E2C pattern, not e.isTrusted on toggle)', () => {
    assert.ok(/summary\.addEventListener\('click', function\(e\)\{ if \(e\.isTrusted\) trustedActivation = true; \}\)/.test(hp), 'trusted click arm not found');
    assert.ok(/summary\.addEventListener\('keydown', function\(e\)\{ if \(e\.isTrusted && \(e\.key === 'Enter' \|\| e\.key === ' '\)\) trustedActivation = true; \}\)/.test(hp), 'trusted keydown arm not found');
    assert.ok(/if \(details\.open && trustedActivation\) trackEvent\('faq_expand'/.test(hp), 'toggle handler must require trustedActivation, not just details.open');
    assert.ok(/trustedActivation = false;/.test(hp), 'trustedActivation must be reset after every toggle (armed once, consumed once)');
    // The old, insufficient bare-toggle pattern and the stray answer-div
    // onclick this stage removed must both be gone.
    assert.ok(!/details\.addEventListener\('toggle', function\(\)\{\s*\n\s*if \(details\.open\) trackEvent\('faq_expand'/.test(hp), 'old untrusted bare-toggle FAQ tracking must be removed');
    assert.ok(!/class="faq-a"[^>]*onclick="trackEvent\('faq_expand'/.test(hp), 'stray onclick on a .faq-a answer div must be removed');
  });

  test('package_view analytics observes only the 9 canonical Full Collection records (Featured/Duration carry no data-pkg-slug)', () => {
    const featuredBlock = hp.slice(hp.indexOf('id="pkg-featured"'), hp.indexOf('id="pkg-grid"'));
    const durationBlock = hp.slice(hp.indexOf('id="pkg-duration"'), hp.indexOf('hp-section', hp.indexOf('id="pkg-duration"')));
    assert.ok(!featuredBlock.includes('data-pkg-slug') && !durationBlock.includes('data-pkg-slug'));
    assert.ok(hp.includes(`document.querySelectorAll('#pkg-grid .pc-pkg')`));
  });

  test('package_enquire fires for both WhatsApp (Plan This Holiday) and Email Vilu, with package_id/package_nights/contact_method — never a legacy event name', () => {
    for (const it of items) {
      assert.ok(hp.includes(`trackEvent('package_enquire',{contact_method:'whatsapp',package_id:'${it.id}',package_nights:${it.nights}`), `${it.id} missing whatsapp package_enquire wiring`);
      assert.ok(hp.includes(`trackEvent('package_enquire',{contact_method:'email',package_id:'${it.id}',package_nights:${it.nights}`), `${it.id} missing email package_enquire wiring`);
    }
    assert.ok(!/trackEvent\('enquire_/.test(hp), 'no legacy enquire_* event names');
  });

  test('availability_click is separate from package_enquire (Check live availability never fires package_enquire)', () => {
    for (const it of items) {
      assert.ok(hp.includes(`trackEvent('availability_click',{source_context:'package',package_id:'${it.id}'`), `${it.id} missing availability_click wiring`);
    }
    // Structural guarantee: the .pkg-cta-alt anchor's own onclick is the only
    // handler on that element, and it names availability_click, never
    // package_enquire, for any package.
    const altOnclicks = [...hp.matchAll(/class="pkg-cta-alt"[^>]*onclick="([^"]*)"/g)].map(m => m[1]);
    assert.ok(altOnclicks.length >= 9);
    for (const oc of altOnclicks) assert.ok(oc.includes('availability_click') && !oc.includes('package_enquire'));
  });

  test('translated package pages keep canonical (English, untranslated) slugs as both ids and hrefs', () => {
    for (const lang of M.languages) {
      const generated = read(path.join(lang, 'holiday-packages.html'));
      for (const slug of slugs) {
        assert.ok(generated.includes(`id="${slug}"`), `${lang}: missing id="${slug}"`);
        assert.ok(generated.includes(`href="#${slug}"`), `${lang}: missing href="#${slug}"`);
      }
    }
  });

  test('heading hierarchy for package-page-owned content is sequential with no skip (h1 -> h2 -> h3), independent of the shared site-wide footer', () => {
    const bodyOnly = hp.slice(hp.indexOf('<header class="page-header"'), hp.indexOf('<footer'));
    const headings = [...bodyOnly.matchAll(/<(h[1-6])\b/g)].map(m => Number(m[1][1]));
    assert.equal(headings.filter(h => h === 1).length, 1, 'exactly one H1');
    for (let i = 1; i < headings.length; i++) {
      assert.ok(headings[i] <= headings[i - 1] + 1, `heading level jumps from h${headings[i-1]} to h${headings[i]} (index ${i})`);
    }
  });

  test('exactly 9 Product/Offer schema entities, no duplicate Product from Featured Journeys, plus BreadcrumbList and FAQPage intact', () => {
    const types = jsonLdTypes(hp);
    assert.equal(types.filter(t => t === 'Product').length, 9);
    assert.ok(types.includes('BreadcrumbList'));
    assert.ok(types.includes('FAQPage'));
  });

  test('no internal/private architecture markers in shipped source (PMS, Firestore, Agency Portal, supplier/commission language, AI-tool references)', () => {
    const forbidden = ['Firestore', 'Agency Portal', 'vilu-unified', 'supplier rate', 'commission', 'Claude', 'ChatGPT', 'Anthropic'];
    for (const term of forbidden) assert.ok(!hp.includes(term), `forbidden internal term "${term}" found in holiday-packages.html`);
  });

  test('reduced-motion safety: package-page motion additions are gated behind prefers-reduced-motion, and the site-wide neutralizer also zeroes transition-delay (staggers)', () => {
    assert.ok(css.includes('pcHeroSettle') && css.includes('@media (prefers-reduced-motion:no-preference)'));
    const block = css.slice(css.indexOf('prefers-reduced-motion:reduce'), css.indexOf('prefers-reduced-motion:reduce') + 400);
    assert.ok(/transition-delay:0ms\s*!important/.test(block));
  });

  test('no-JS content contract: a page-scoped noscript override keeps every .reveal section visible without JavaScript', () => {
    assert.ok(/<noscript><style>\.reveal\{opacity:1!important;transform:none!important;filter:none!important\}<\/style><\/noscript>/.test(hp));
  });

  test('RTL logical-direction hooks: badge position and Featured layout use logical (not physical left/right) properties', () => {
    assert.ok(css.includes('inset-inline-start:28px'), '.pkg-badge must stay on the logical inset-inline-start');
    assert.ok(!/\.pc-featured\{[^}]*\bleft:/.test(css) && !/\.pc-duration\{[^}]*\bleft:/.test(css), 'new package layout containers must not hardcode physical left/right');
  });

  test('light-theme package price contrast fix: .pkg-price gets a scoped, darker accent override in Light (matches the established :root[data-theme] override pattern)', () => {
    assert.ok(/:root\[data-theme="light"\]\s*\.pkg-price\{color:#8a5a1a\}/.test(css));
  });
}

// ---------------------------------------------------------------------------
section('Analytics — canonical events, dimensions, attribution');
{
  const an = read('analytics.js');
  const corpus = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f)).map(f => read(f)).join('\n');
  test('exactly 10 canonical event names, each referenced as a string literal in shipped code', () => {
    assert.equal(M.analytics.canonical_events.length, 10);
    for (const e of M.analytics.canonical_events) assert.ok(corpus.includes(`'${e}'`) || corpus.includes(`"${e}"`), e);
  });
  test('GA measurement id in consent.js', () => assert.ok(read('consent.js').includes(`GA_MEASUREMENT_ID = '${M.analytics.ga_measurement_id}'`)));
  test('commonParams reads data-page-type / data-page-slug from <body>', () => {
    for (const a of M.analytics.body_attributes) assert.ok(an.includes(`'${a}'`), a);
  });
  test('11 approved GA4 custom-dimension params (page_type/page_slug deliberately not among them)', () => {
    const d = M.analytics.ga4_custom_dimensions;
    assert.equal(d.params.length, d.count);
    assert.equal(d.count, 11);
    for (const x of d.not_registered_as_dimensions) assert.ok(!d.params.includes(x), x);
    for (const pName of d.params) assert.ok(corpus.includes(pName), 'param never emitted: ' + pName);
  });
  test('GA4 key-event contract is unambiguous (2 ON, availability_click OFF, legacy/auto-suggested OFF)', () => {
    const k = M.analytics.ga4_key_events;
    assert.deepEqual(k.on, ['package_enquire', 'experience_enquire']);
    assert.ok(k.off.includes('availability_click'));
    for (const x of k.on) assert.ok(!k.off.includes(x) && !k.legacy_off.includes(x));
  });
  test('PACKAGE_NAME_TO_ID matches the locked package contract', () => {
    const map = evalBlock(an, /var PACKAGE_NAME_TO_ID = \{/, '};', 'PACKAGE_NAME_TO_ID');
    assert.deepEqual(map, M.analytics.package_name_to_id);
    for (const it of M.packages.items) assert.equal(map[it.name], it.id, it.name);
  });
  test('ELIGIBLE_LANDING_SLUGS is exactly the 12 approved landing slugs', () => {
    const slugs = evalBlock(an, /var ELIGIBLE_LANDING_SLUGS = \[/, '];', 'ELIGIBLE_LANDING_SLUGS');
    assert.equal(slugs.length, 12);
    sameSet(slugs, M.analytics.attribution.landing_slugs);
  });
  test('every landing slug is the data-page-slug of a sitemap page', () => {
    const slugs = SITEMAP_PAGES.map(p => p.page_slug);
    sameSet(M.analytics.attribution.landing_slugs, slugs);
  });
  test('COMMERCIAL_ATTRIBUTION_EVENTS allow-list = package_enquire, experience_enquire, availability_click', () => {
    const ev = evalBlock(an, /var COMMERCIAL_ATTRIBUTION_EVENTS = \[/, '];', 'COMMERCIAL_ATTRIBUTION_EVENTS');
    sameSet(ev, M.analytics.attribution.commercial_events);
  });
  test('OWN_HOSTNAMES / SITE_LANG_CODES / attribution storage constants', () => {
    sameSet(evalBlock(an, /var OWN_HOSTNAMES = \[/, '];', 'OWN_HOSTNAMES'), M.analytics.attribution.own_hostnames);
    sameSet(evalBlock(an, /var SITE_LANG_CODES = \[/, '];', 'SITE_LANG_CODES'), M.analytics.attribution.site_lang_codes);
    assert.ok(an.includes(`var ATTR_KEY = '${M.analytics.attribution.storage_key}'`));
    assert.ok(an.includes(`var ATTR_VERSION = ${M.analytics.attribution.version};`));
    assert.ok(an.includes(`var ATTR_MAX_AGE_MS = ${M.analytics.attribution.max_age_days} * 24 * 60 * 60 * 1000`));
  });
  test('attribution augmentation params are all emitted by analytics.js', () => {
    for (const pName of M.analytics.attribution.augmented_params) assert.ok(an.includes(pName), pName);
  });
  test('trackEvent() and getAttribution() are consent-gated (isAnalyticsAllowed)', () => {
    const te = an.slice(an.indexOf('function trackEvent('));
    assert.ok(te.slice(0, 1500).includes('isAnalyticsAllowed()'));
    const ga = an.slice(an.indexOf('function getAttribution('));
    assert.ok(ga.slice(0, 600).includes('isAnalyticsAllowed()'));
  });
  test('guide handoff uses sessionStorage key vilu_guide_handoff', () => assert.ok(corpus.includes(`'${M.analytics.guide_handoff_session_key}'`)));
  test('nav-shell.js Check Availability hook emits availability_click with source_context navigation', () => {
    assert.ok(read('nav-shell.js').includes("trackEvent('availability_click', {source_context: 'navigation'})"));
  });
}

// ---------------------------------------------------------------------------
section('Consent — DOM contract, storage, GA-after-consent');
{
  const cs = read('consent.js');
  test(`consent.js storage key '${M.consent.storage_key}' v${M.consent.version}`, () => {
    assert.ok(cs.includes(`STORAGE_KEY = '${M.consent.storage_key}'`));
    assert.ok(cs.includes(`CONSENT_VERSION = ${M.consent.version};`));
  });
  test('consent.js exposes window.viluConsent and sets a denied-by-default consent state before any GA load', () => {
    assert.ok(cs.includes('window.viluConsent ='));
    assert.ok(cs.indexOf("gtag('consent', 'default'") < cs.indexOf('function loadGA'));
    assert.ok(cs.includes(`${M.consent.ga_loader_host}/gtag/js?id=`));
  });
  test('consent.js references every DOM id it consumes', () => {
    for (const id of M.consent.dom_ids_consumed_by_consent_js) assert.ok(cs.includes(id), id);
  });
  for (const p of M.pages) {
    const skipFooter = M.consent.pages_without_footer_privacy_choices.includes(p.file);
    test(`${p.file}: consent DOM ids present${skipFooter ? ' (footerPrivacyChoices exempt)' : ''}`, () => {
      const html = read(p.file);
      for (const id of M.consent.required_dom_ids) {
        if (skipFooter && id === 'footerPrivacyChoices') continue;
        assert.ok(html.includes(`id="${id}"`), id);
      }
    });
    test(`${p.file}: no static googletagmanager script tag (GA loads only via consent.js)`, () => {
      assert.ok(!/<script[^>]+src="https?:\/\/www\.googletagmanager\.com/.test(read(p.file)));
    });
  }
}

// ---------------------------------------------------------------------------
section('Baseline fingerprints (consent.js / analytics.js) — informational lock, not permanent');
for (const [f, hash] of Object.entries(M.file_fingerprints)) {
  if (f.startsWith('$')) continue;
  test(`${f} sha256 matches baseline (an approved change must update the manifest + re-verify behaviour)`, () => {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
    assert.equal(h, hash);
  });
}

// ---------------------------------------------------------------------------
section('Storage contract');
test('localStorage / sessionStorage keys still referenced by shipped code', () => {
  const corpus = M.storage_keys.code_files_referencing_keys.map(read).join('\n');
  for (const k of M.storage_keys.localStorage.concat(M.storage_keys.sessionStorage)) assert.ok(corpus.includes(`'${k}'`) || corpus.includes(`"${k}"`), k);
});

// ---------------------------------------------------------------------------
section('Theme foundation — dual theme tokens, state, persistence policy (Phase 12B-C)');
{
  const T = M.theme;
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  function cssBlock(css, selector) {
    const i = css.indexOf(selector + '{');
    assert.ok(i >= 0, 'missing block ' + selector);
    return norm(css.slice(i, css.indexOf('}', i)));
  }
  test(`${T.css_file} and ${T.js_file} exist`, () => { assert.ok(exists(T.css_file)); assert.ok(exists(T.js_file)); });
  const css = exists(T.css_file) ? read(T.css_file) : '';
  const js = exists(T.js_file) ? read(T.js_file) : '';
  const normCss = norm(css);
  test('brand reference --vilu-amber is the measured logo coconut', () => {
    for (const [k, v] of Object.entries(T.brand_reference)) assert.ok(normCss.includes(`${k}:${norm(v)}`), k);
  });
  test('Cinematic Dark tokens on :root (the default theme)', () => {
    const block = cssBlock(css, ':root');
    for (const [k, v] of Object.entries(T.dark_tokens)) assert.ok(block.includes(`${k}:${norm(v)}`), `${k} ${v}`);
  });
  test('Island Luxury Light tokens on :root[data-theme="light"] (own surfaces, own accent, own link amber — not an inversion)', () => {
    const block = cssBlock(css, ':root[data-theme="light"]');
    for (const [k, v] of Object.entries(T.light_tokens)) assert.ok(block.includes(`${k}:${norm(v)}`), `${k} ${v}`);
    assert.notEqual(T.light_tokens['--accent'], T.dark_tokens['--accent']);
  });
  // ── Accent contrast contract (12B-C1) ──
  const rgbOf = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = (c) => { const a = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
  const contrast = (a, b) => { const l1 = lum(rgbOf(a)), l2 = lum(rgbOf(b)); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
  const isDarkInk = (h) => lum(rgbOf(h)) < 0.05;
  test('accent ink is a DARK foreground in both themes (never white/ivory on amber)', () => {
    assert.ok(isDarkInk(T.dark_tokens['--accent-ink']), 'dark');
    assert.ok(isDarkInk(T.light_tokens['--accent-ink']), 'light');
    assert.equal(T.light_tokens['--accent'], '#ad701f'); assert.equal(T.light_tokens['--accent-text'], '#925f1c'); assert.equal(T.dark_tokens['--accent'], '#e0a752');
  });
  for (const [name, tok] of [['dark', T.dark_tokens], ['light', T.light_tokens]]) {
    test(`${name} theme WCAG contrast: ink on accent, accent-text on bg/surface, text and muted on bg, fill edge vs bg`, () => {
      const m = T.contrast_minimums;
      const c1 = contrast(tok['--accent-ink'], tok['--accent']); assert.ok(c1 >= m.accent_ink_on_accent, `accent-ink on accent ${c1.toFixed(2)}`);
      const c2 = contrast(tok['--accent-text'], tok['--bg']); assert.ok(c2 >= m.accent_text_on_bg, `accent-text on bg ${c2.toFixed(2)}`);
      const c3 = contrast(tok['--accent-text'], tok['--surface']); assert.ok(c3 >= m.accent_text_on_surface, `accent-text on surface ${c3.toFixed(2)}`);
      const c4 = contrast(tok['--text'], tok['--bg']); assert.ok(c4 >= m.text_on_bg, `text on bg ${c4.toFixed(2)}`);
      const c5 = contrast(tok['--text-muted'], tok['--bg']); assert.ok(c5 >= m.text_muted_on_bg, `muted on bg ${c5.toFixed(2)}`);
      const c6 = contrast(tok['--accent'], tok['--bg']); assert.ok(c6 >= m.accent_fill_vs_bg, `accent fill vs bg ${c6.toFixed(2)}`);
    });
  }
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  test('every filled-amber component selector is pinned to color:var(--accent-ink) in theme.css', () => {
    const blocks = [...cssNoComments.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ sel: m[1].replace(/\s+/g, ' ').trim().replace(/^html /, '').replace(/,\s*html /g, ','), body: norm(m[2]) }));
    for (const sel of T.filled_amber_selectors) {
      const hit = blocks.find(b => b.sel.split(',').map(s => s.trim()).includes(sel) && b.body.includes('color:var(--accent-ink)'));
      assert.ok(hit, sel + ' not pinned to --accent-ink');
    }
  });
  test('no theme.css rule that paints background:var(--accent) sets a white/ivory/page-colour foreground', () => {
    for (const m of cssNoComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = norm(m[2]);
      if (!body.includes('background:var(--accent)') && !body.includes('background-color:var(--accent)')) continue;
      for (const bad of T.forbidden_foreground_on_accent) assert.ok(!body.includes('color:' + norm(bad) + ';') && !body.endsWith('color:' + norm(bad)), `${m[1].trim()} uses ${bad} on the accent fill`);
    }
    assert.ok(!/--accent-ink:\s*#fff8ef/i.test(css) && !/--accent-ink:\s*#fff\b/i.test(css));
  });
  test('retired cyan --gold semantic: legacy names alias the amber accent', () => {
    for (const [k, v] of Object.entries(T.legacy_aliases_retired_semantic)) assert.ok(normCss.includes(`${k}:${norm(v)}`), k);
    assert.ok(!/--gold:\s*#22d3ee/i.test(css));
  });
  test('theme.css never consults prefers-color-scheme and loads no external font', () => {
    for (const f of T.forbidden_in_theme_css) assert.ok(!css.includes(f), f);
  });
  test(`theme.js contract: key '${T.storage_key}', default '${T.default_theme}', valid ${JSON.stringify(T.valid_values)}, public API ${T.public_api}`, () => {
    assert.ok(js.includes(`KEY = '${T.storage_key}'`));
    assert.ok(js.includes(`DEFAULT_THEME = '${T.default_theme}'`));
    for (const v of T.valid_values) assert.ok(new RegExp(`\\b${v}: true`).test(js), v);
    assert.ok(js.includes(T.public_api + ' ='));
    assert.ok(js.includes(`root.setAttribute('${T.root_attribute}'`));
  });
  test('theme persistence is Preferences-consent gated via the consent.js public API, with a sessionStorage fallback', () => {
    assert.ok(js.includes('window.viluConsent') && js.includes('categories.preferences === true'));
    assert.ok(js.includes('sessionStorage.setItem(KEY') && js.includes('localStorage.setItem(KEY') && js.includes('localStorage.removeItem(KEY'));
  });
  test('theme.js never decides by OS scheme, never loads GA, never emits analytics', () => {
    for (const f of T.forbidden_in_theme_js) assert.ok(!js.includes(f), f);
  });
  test('theme switch is an accessible role="switch" with aria-checked and a label', () => {
    assert.ok(js.includes("setAttribute('role', 'switch')") && js.includes("'aria-checked'") && js.includes("setAttribute('aria-label'"));
    assert.ok(js.includes(`'${T.switch_selector.slice(1, -1)}'`));
  });
  test('every source page boots dark statically (<html data-theme="dark">), loads theme.js after consent.js/analytics.js, and theme.css last in <head>', () => {
    for (const p of M.pages) {
      const h = read(p.file);
      assert.ok(/<html lang="en" data-theme="dark">/.test(h), p.file + ' html tag');
      const head = headOf(h);
      const iConsent = head.indexOf('src="consent.js"'), iAnalytics = head.indexOf('src="analytics.js"'), iTheme = head.indexOf(`src="${T.js_file}"`), iCss = head.lastIndexOf(`href="${T.css_file}"`);
      assert.ok(iConsent >= 0 && iAnalytics > iConsent && iTheme > iAnalytics, p.file + ' script order');
      assert.ok(iCss >= 0, p.file + ' theme.css');
      const lastSheet = Math.max(...[...head.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(m => m.index));
      assert.ok(head.lastIndexOf('<link rel="stylesheet" href="' + T.css_file) === lastSheet, p.file + ' theme.css must be the last stylesheet');
    }
  });
  test('generated language pages keep data-theme="dark" and root-absolute /theme.js + /theme.css', () => {
    for (const l of M.languages) for (const p of CONTENT_PAGES) {
      const rel = `${l}/${p.generated_out_file || p.file}`; const h = read(rel);
      assert.ok(/data-theme="dark"/.test(h.match(/<html[^>]*>/)[0]), rel + ' html tag');
      assert.ok(h.includes(`src="/${T.js_file}"`) && h.includes(`href="/${T.css_file}"`), rel + ' theme assets');
    }
  });
  test('internal PMS/agency tools are untouched by the theme foundation', () => {
    for (const f of M.internal_tools.files) assert.ok(!read(f).includes(T.js_file) && !read(f).includes(T.css_file), f);
  });
}

// ---------------------------------------------------------------------------
section('Booking / PMS — structural preservation (read-only; no Firestore access)');
{
  const B = M.booking_pms; const home = read('vilu-website.html'); const nav = read('nav-shell.js');
  test(`Firebase SDK ${B.firebase_sdk_version} loaded by vilu-website.html only`, () => {
    assert.ok(home.includes(`firebasejs/${B.firebase_sdk_version}/firebase-app-compat.js`));
    assert.ok(home.includes(`firebasejs/${B.firebase_sdk_version}/firebase-firestore-compat.js`));
    for (const p of M.pages) if (p.file !== B.only_page_loading_firebase) assert.ok(!read(p.file).includes('firebasejs/'), p.file + ' loads Firebase');
  });
  test('Firebase configuration identity (projectId / authDomain / storageBucket)', () => {
    assert.ok(home.includes(`projectId: "${B.firebase_project_id}"`));
    assert.ok(home.includes(`authDomain: "${B.firebase_auth_domain}"`));
    assert.ok(home.includes(`storageBucket: "${B.firebase_storage_bucket}"`));
  });
  test('public Firestore collections referenced (' + B.public_collections_referenced.join(', ') + ')', () => {
    for (const c of B.public_collections_referenced) assert.ok(home.includes(`collection('${c}')`), c);
  });
  test('reservation write boundary: reservations + room_availability via runTransaction / merge / ROOM_CONFLICT', () => {
    for (const c of B.write_collections) assert.ok(home.includes(`collection('${c}')`), c);
    for (const m of B.write_mechanism) assert.ok(home.includes(m), m);
  });
  for (const fn of B.functions_in_vilu_website) test(`vilu-website.html defines ${fn}()`, () => assert.ok(new RegExp('function ' + fn + '\\(').test(home)));
  for (const fn of B.functions_in_nav_shell) test(`nav-shell.js defines ${fn}()`, () => assert.ok(new RegExp('function ' + fn + '\\(').test(nav)));
  test(`BroadcastChannel('${M.storage_keys.broadcast_channel}') website<->PMS refresh channel`, () => assert.ok(home.includes(`BroadcastChannel('${M.storage_keys.broadcast_channel}')`)));
  test('booking entry-point ids (' + B.entry_point_ids.join(', ') + ')', () => { for (const id of B.entry_point_ids) assert.ok(home.includes(`id="${id}"`), id); });
  test('booking entry-point classes (' + B.entry_point_classes.join(', ') + ')', () => { for (const c of B.entry_point_classes) assert.ok(home.includes(c), c); });
  test('nav-shell.js booking hooks (' + B.nav_shell_hooks.join(', ') + ')', () => { for (const h of B.nav_shell_hooks) assert.ok(nav.includes(h), h); });
  test('submitDirectBooking() writes source "Website" with status "Pending"', () => {
    const fnBody = home.slice(home.indexOf('function submitDirectBooking('), home.indexOf('function submitDirectBooking(') + 3000);
    assert.ok(fnBody.includes(`'${B.reservation_source_value}'`) || fnBody.includes(`"${B.reservation_source_value}"`));
    assert.ok(fnBody.includes(`'${B.reservation_status_value}'`) || fnBody.includes(`"${B.reservation_status_value}"`));
  });
  test('every content page exposes the navigation booking entry points', () => {
    for (const p of CONTENT_PAGES) { const h = read(p.file); assert.ok(h.includes('js-check-availability') && h.includes('js-live-availability'), p.file); }
  });
  test('this harness never touches Firestore (self-check: no firebase import, no network client)', () => {
    const self = fs.readFileSync(__filename, 'utf8');
    assert.ok(!/require\(["'](firebase|@google-cloud|node:https?|https?)["']/.test(self));
  });
}

// ---------------------------------------------------------------------------
section('Multilingual — generated pages');
{
  const files = [];
  for (const l of M.languages) for (const p of CONTENT_PAGES) files.push({ l, p, rel: `${l}/${p.generated_out_file || p.file}` });
  test(`${M.languages.length} languages x ${M.generated_pages_per_language} pages = ${M.generated_pages_total} generated files exist`, () => {
    assert.equal(files.length, M.generated_pages_total);
    for (const f of files) assert.ok(exists(f.rel), f.rel);
  });
  test('generated pages carry <html lang="xx" dir="rtl|ltr"> (Arabic rtl, all others ltr)', () => {
    for (const f of files) {
      const tag = read(f.rel).match(/<html\b[^>]*>/)[0];
      assert.equal(attr(tag, 'lang'), f.l, f.rel);
      assert.equal(attr(tag, 'dir'), M.rtl_languages.includes(f.l) ? 'rtl' : 'ltr', f.rel);
    }
  });
  test('generated pages: canonical rewritten to /xx/ path, hreflang parity kept', () => {
    for (const f of files) {
      const html = read(f.rel);
      const c = linkRel(html, 'canonical');
      assert.equal(c.length, 1, f.rel);
      const expected = M.site_origin + '/' + f.l + (f.p.url_path === '/' ? '/' : f.p.url_path);
      assert.equal(attr(c[0], 'href'), expected, f.rel);
      sameSet(linkRel(html, 'alternate').map(t => attr(t, 'hreflang')).filter(Boolean), M.hreflang_codes, f.rel);
    }
  });
  test('generated pages keep data-page-type / data-page-slug and the consent DOM', () => {
    for (const f of files) {
      const html = read(f.rel); const b = bodyTag(html);
      assert.equal(attr(b, 'data-page-type'), f.p.page_type, f.rel);
      assert.equal(attr(b, 'data-page-slug'), f.p.page_slug, f.rel);
      assert.ok(html.includes('id="consentBar"'), f.rel);
    }
  });
  test('legal pages stay noindex in every language', () => {
    for (const f of files) if (f.p.robots) assert.equal(metaByName(read(f.rel), 'robots'), f.p.robots, f.rel);
  });
  test('i18n attributes present on English sources (data-i18n, data-i18n-aria-label) and language <select aria-label="Language">', () => {
    for (const p of CONTENT_PAGES) assert.ok(read(p.file).includes('data-i18n='), p.file);
    assert.ok(read('vilu-website.html').includes('data-i18n-aria-label='));
    assert.ok(read(M.navigation.language_select_source).includes(`aria-label="${M.navigation.language_select_aria_label}"`));
  });
  test('i18n JSON files exist for all 10 languages', () => { for (const l of M.languages) assert.ok(exists(`i18n/${l}.json`), l); });
}

// ---------------------------------------------------------------------------
section('Contact / conversion paths');
test('every page carries the WhatsApp link (' + M.contact.whatsapp_link_prefix + ')', () => {
  for (const p of M.pages) assert.ok(read(p.file).includes(M.contact.whatsapp_link_prefix), p.file);
});
test('email + phone present on all content and legal pages', () => {
  for (const f of M.contact.pages_requiring_email) {
    const h = read(f);
    assert.ok(h.toLowerCase().includes(M.contact.mailto_prefix.toLowerCase()), f + ' mailto');
    assert.ok(h.includes(M.contact.phone_display), f + ' phone');
  }
});
test('no other phone number / email is advertised as the contact', () => {
  for (const p of M.pages) {
    const h = read(p.file);
    for (const m of h.matchAll(/wa\.me\/(\d+)/g)) assert.equal(m[1], M.contact.whatsapp_number, p.file);
    for (const m of h.matchAll(/mailto:([^?"']+)/g)) assert.equal(m[1].toLowerCase(), M.contact.email.toLowerCase(), p.file);
  }
});

// ---------------------------------------------------------------------------
section('Navigation / footer IA');
{
  const N = M.navigation;
  test(`reference page ${N.reference_page} contains every required nav destination and behaviour class`, () => {
    const h = read(N.reference_page);
    for (const href of N.required_hrefs) assert.ok(h.includes(`href="${href}"`), href);
    for (const c of N.required_classes) assert.ok(h.includes(c), c);
  });
  test('every content page has the hamburger + mobile menu + required nav destinations + legal footer links', () => {
    for (const p of CONTENT_PAGES) {
      const h = read(p.file);
      assert.ok(h.includes(`id="${N.hamburger_id}"`) && h.includes(`id="${N.mobile_menu_id}"`), p.file);
      for (const href of N.required_hrefs) {
        if (href === '/') { assert.ok(N.home_href_alternatives.some(a => h.includes(`href="${a}"`)), `${p.file} missing home link`); continue; }
        // The homepage links its own sections as same-page anchors (href="#about"); other pages use "/#about".
        const ok = h.includes(`href="${href}"`) || (href.startsWith('/#') && p.url_path === '/' && h.includes(`href="${href.slice(1)}"`));
        assert.ok(ok, `${p.file} missing ${href}`);
      }
      for (const href of N.footer_legal_hrefs) assert.ok(h.includes(`href="${href}"`), `${p.file} missing ${href}`);
    }
  });
  test('nav-shell.js is loaded by every content page', () => { for (const p of CONTENT_PAGES) assert.ok(/<script[^>]+src="\/?nav-shell\.js"/.test(read(p.file)), p.file); });

  // Phase 12B-E2B: the homepage's #about section became #what-is-vilu (old
  // About content absorbed there / into Homecoming); every OTHER content
  // page's shared nav copy is untouched this stage and must still point at
  // /#about -- required_hrefs can't express a homepage-only exception, so
  // this is asserted explicitly instead (see the manifest's $comment_about).
  test('non-homepage content pages still link "Vilu Residence" nav destination to /#about (unchanged this stage)', () => {
    for (const p of CONTENT_PAGES) {
      if (p.url_path === '/') continue;
      assert.ok(read(p.file).includes('href="/#about"'), p.file);
    }
  });
  test('homepage nav + footer link "Vilu Residence" destination to #what-is-vilu, not the removed #about', () => {
    const h = read('vilu-website.html');
    assert.ok(h.includes('href="#what-is-vilu"'), 'missing href="#what-is-vilu"');
    assert.ok(!h.includes('href="#about"'), 'stale href="#about" still present');
    assert.ok(!/id="about"/.test(h), '#about section should be removed, not just unlinked');
  });

  // ── Phase 12B-D global shell contracts ──
  const S = N.shell;
  const navBlock = (h) => { const s = h.indexOf('<nav id="nav"'); return h.slice(s, h.indexOf('</nav>', s)); };
  const drawerBlock = (h) => {
    // From the drawer's opening tag to the close of .mobile-menu: the social row is the
    // last child, followed by </div> ×4 (social, mm-contact, mm-body, mobile-menu).
    const s = h.indexOf('id="mobileMenu"'); let i = h.indexOf('mm-contact-social', s);
    for (let n = 0; n < 4 && i > 0; n++) i = h.indexOf('</div>', i + 1);
    return h.slice(s, i > 0 ? i + 6 : undefined);
  };
  const footerBlock = (h) => { const s = h.indexOf('<footer'); return h.slice(s, h.indexOf('</footer>', s)); };
  test('header is a labelled navigation landmark using a disclosure pattern (no ARIA menu roles) with aria-controls → existing panel ids', () => {
    for (const p of CONTENT_PAGES) {
      const h = read(p.file); const nav = navBlock(h);
      assert.ok(nav.includes(`data-i18n-aria-label="${S.nav_landmark_i18n_key}"`) && /<nav id="nav" aria-label="[^"]+"/.test(nav), p.file + ' landmark label');
      for (const bad of S.forbidden_in_nav) assert.ok(!nav.includes(bad), `${p.file} still uses ${bad}`);
      for (const id of S.dropdown_panel_ids) assert.ok(nav.includes(`aria-controls="${id}"`) && nav.includes(`id="${id}"`), `${p.file} ${id}`);
      for (const m of nav.matchAll(/<button[^>]*class="nav-drop-trigger"[^>]*>/g)) assert.ok(/aria-expanded="false"/.test(m[0]) && /type="button"/.test(m[0]), p.file + ' trigger semantics');
      assert.ok(nav.includes(`aria-controls="${N.mobile_menu_id}"`) && nav.includes('aria-expanded="false"'), p.file + ' hamburger');
    }
  });
  test('mobile drawer keeps its accessibility hooks (dialog, close, group panels, language + theme mounts)', () => {
    for (const p of CONTENT_PAGES) {
      const d = drawerBlock(read(p.file));
      for (const mk of S.drawer_required_markers) assert.ok(d.includes(mk), `${p.file} drawer missing ${mk}`);
      for (const id of S.mobile_panel_ids) assert.ok(d.includes(`aria-controls="${id}"`) && d.includes(`id="${id}"`), `${p.file} ${id}`);
    }
  });
  test('every nav destination is also reachable from the mobile drawer', () => {
    for (const p of CONTENT_PAGES) {
      const d = drawerBlock(read(p.file));
      for (const href of N.required_hrefs) {
        if (href === '/') continue;
        const ok = d.includes(`href="${href}"`) || (href.startsWith('/#') && p.url_path === '/' && d.includes(`href="${href.slice(1)}"`));
        assert.ok(ok, `${p.file} drawer missing ${href}`);
      }
    }
  });
  test('theme-switch labels are localized: keys in all 10 language files, consumed by theme.js through the i18n engine', () => {
    for (const l of M.languages) {
      const j = JSON.parse(read(`i18n/${l}.json`));
      for (const k of S.theme_i18n_keys.concat(S.shell_i18n_keys)) {
        const v = k.split('.').reduce((o, s) => (o ? o[s] : undefined), j.static);
        assert.ok(typeof v === 'string' && v.length > 0, `${l}: ${k}`);
      }
    }
    const js = read('theme.js');
    assert.ok(js.includes("window.t(") && js.includes("'navShell.'"));
    for (const k of ['themeDark', 'themeLight', 'switchToDark', 'switchToLight']) assert.ok(js.includes(k), k);
    assert.ok(js.includes("'data-i18n-aria-label'") && js.includes("'data-i18n'"), 'switch re-translates on language change');
  });
  test('shell i18n keys are wired in the markup (nav landmark, panel eyebrows, footer brand line)', () => {
    for (const p of CONTENT_PAGES) {
      const h = read(p.file);
      for (const k of ['navShell.destination', 'navShell.planning', 'footer.brandLine', 'footer.positioning']) assert.ok(h.includes(`data-i18n="${k}"`), `${p.file} ${k}`);
    }
  });
  test('language selector: 11 languages in the shared engine, a selector in the header and in the drawer of every content page', () => {
    const src = read(N.language_select_source);
    for (const l of ['en'].concat(M.languages)) assert.ok(new RegExp(`\\b${l}:"`).test(src), l);
    for (const p of CONTENT_PAGES) { const h = read(p.file); assert.ok((h.match(/class="lang-switcher/g) || []).length >= 2, p.file); }
  });
  test('footer keeps its brand statement, contact block, PMS attribution, Privacy Choices and legal links on every content page', () => {
    for (const p of CONTENT_PAGES) {
      const f = footerBlock(read(p.file));
      for (const mk of S.footer_required_markers) assert.ok(f.includes(mk), `${p.file} footer missing ${mk}`);
      for (const href of N.footer_legal_hrefs) assert.ok(f.includes(`href="${href}"`), `${p.file} ${href}`);
    }
  });
  test('social links: exactly the three verified destinations, labelled, and no placeholder or internal hrefs anywhere in the shell', () => {
    for (const p of CONTENT_PAGES) {
      const h = read(p.file); const shell = navBlock(h) + drawerBlock(h) + footerBlock(h);
      for (const s of S.social_hrefs) assert.ok(footerBlock(h).includes(`href="${s}"`), `${p.file} missing ${s}`);
      for (const m of shell.matchAll(/href="https:\/\/(www\.)?(instagram|facebook|tripadvisor)\.com[^"]*"/g)) assert.ok(S.social_hrefs.includes(m[0].slice(6, -1)), `${p.file} unexpected social ${m[0]}`);
      for (const m of shell.matchAll(/<a [^>]*href="https:\/\/(www\.)?(instagram|facebook|tripadvisor)\.com[^>]*>/g)) assert.ok(/aria-label="[^"]+"/.test(m[0]), `${p.file} social link without label`);
      for (const bad of S.forbidden_shell_hrefs) assert.ok(!shell.includes(bad), `${p.file} shell contains ${bad}`);
    }
  });
  test('public shell exposes no internal architecture (no PMS/Agency/Firestore/tooling phrases, no internal-tool links) on source and generated pages', () => {
    // PUBLIC VILU PRINCIPLE: maximum traveler discoverability, minimum technical exposure.
    const stripTags = (s) => s.replace(/<[^>]+>/g, ' ');
    const check = (rel, h) => {
      const shellHtml = navBlock(h) + drawerBlock(h) + footerBlock(h);
      const visible = stripTags(shellHtml);
      for (const phrase of S.forbidden_public_shell_phrases) assert.ok(!new RegExp('(^|[^A-Za-z_])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z_])', 'i').test(visible), `${rel} shell shows "${phrase}"`);
      for (const f of M.internal_tools.files) assert.ok(!shellHtml.includes(f), `${rel} shell links ${f}`);
    };
    for (const p of CONTENT_PAGES) check(p.file, read(p.file));
    for (const l of M.languages) for (const p of CONTENT_PAGES) { const rel = `${l}/${p.generated_out_file || p.file}`; check(rel, read(rel)); }
  });
  test('no framework, external UI library or external font was introduced; no legacy event names', () => {
    const files = fs.readdirSync(ROOT).filter(f => /\.(html|css|js)$/.test(f) && !M.internal_tools.files.includes(f));
    for (const f of files) {
      const c = read(f);
      // Only loaded resources count (src/href/url()), not prose or comments.
      const refs = [...c.matchAll(/(?:src|href)="([^"]+)"|url\((['"]?)([^)'"]+)\2\)/g)].map(m => (m[1] || m[3] || '').toLowerCase());
      for (const r of refs) for (const bad of S.forbidden_frameworks) assert.ok(!r.includes(bad), `${f} loads ${r}`);
      for (const ev of S.forbidden_event_names) assert.ok(!c.includes(ev), `${f} uses ${ev}`);
    }
  });
}

// ---------------------------------------------------------------------------
section('External resources — fonts');
test('zero references to fonts.googleapis.com / fonts.gstatic.com in shipped html/css/js', () => {
  const files = fs.readdirSync(ROOT).filter(f => /\.(html|css|js)$/.test(f));
  for (const f of files) for (const host of M.performance.forbidden_hosts) assert.ok(!read(f).includes(host), `${f} references ${host}`);
  for (const l of M.languages) for (const p of CONTENT_PAGES) for (const host of M.performance.forbidden_hosts) assert.ok(!read(`${l}/${p.generated_out_file || p.file}`).includes(host), `${l}/${p.file}`);
});
test('self-hosted webfonts remain (shared-page.css -> /fonts/webfonts/, font-display: swap only)', () => {
  const css = read(M.performance.self_hosted_font_css);
  assert.ok(css.includes(`url(${M.performance.self_hosted_font_path_prefix}`));
  assert.ok((css.match(/font-display\s*:\s*swap/g) || []).length > 0);
  assert.ok(!/font-display\s*:\s*(block|auto|optional)/.test(css));
  assert.ok(exists(M.performance.icon_font_css));
});

// ---------------------------------------------------------------------------
section('Phase 12B-E2B — complete cinematic homepage contracts');
{
  const h = read('vilu-website.html');
  const GUIDE_HREFS = [
    'south-ari-atoll-guide.html', 'maamigili-guide.html', 'best-local-islands-snorkeling.html',
    'south-ari-vs-other-regions.html', 'best-time-to-visit.html', 'whale-shark-snorkeling.html',
    'guesthouse-vs-resort.html', 'maldives-holiday-cost.html', 'things-to-do-maamigili.html'
  ];
  test('all 9 guide links remain, each with related_content_click tracking', () => {
    for (const href of GUIDE_HREFS) {
      const re = new RegExp(`<a href="${href}" onclick="trackEvent\\('related_content_click'`);
      assert.ok(re.test(h), href);
    }
  });
  test('homepage package rail/featured links point at holiday-packages.html#<slug> (real anchors, no JS-only nav)', () => {
    assert.ok(h.includes("href=\"holiday-packages.html#'+slug+'\""), 'featured card view-full-details link');
    assert.ok(h.includes("href=\"holiday-packages.html#'+slug+'\">'+t('packages.viewPackage')"), 'rail item view-package link');
  });
  test('every package (featured + rail) still carries id="package-<slug>" + data-pkg-id/name/nights for package_view + deep-link handling', () => {
    assert.ok(/id="package-'\+slug\+'"[^>]*data-pkg-id="'\+p\.id\+'"/.test(h), 'featured card attrs');
    assert.ok(/hp-rail-item" id="package-'\+slug\+'"[^>]*data-pkg-id="'\+p\.id\+'"/.test(h), 'rail item attrs');
    assert.ok(h.includes("document.querySelectorAll('#hp-grid [data-pkg-id]').forEach(function(card){ hpViewObserver.observe(card); })"), 'package_view observer covers both featured + rail');
  });
  test('package names use semantic <h3> in both the featured card and rail items', () => {
    assert.ok(h.includes('<h3 class="hp-name">') && h.includes('<h3 class="hp-rail-name">'), 'package h3s');
  });
  test('Live Availability fields use real <label for> associations (accessibility)', () => {
    for (const id of ['bwf-ci', 'bwf-co', 'bwf-ad', 'bwf-ch']) {
      assert.ok(new RegExp(`<label for="${id}"`).test(h), id);
    }
  });
  test('faq_expand fires only on a genuine TRUSTED user-initiated <details> open, never on render/close/init/programmatic-open', () => {
    assert.ok(/<details class="faq-item"/.test(h), 'FAQ items are semantic <details>');
    // Phase 12B-E2C: e.isTrusted on the <details> 'toggle' event itself is NOT
    // a working guard (verified live: <details> fires 'toggle' as trusted
    // even when a script sets `open` directly, or calls summary.click()).
    // The real guard has to check isTrusted on the INPUT event (click/keydown
    // on <summary>) that precedes the toggle, via a short-lived flag.
    assert.ok(h.includes("summary.addEventListener('click', function(e){ if (e.isTrusted) trustedActivation = true; });"), 'summary click sets the trusted-activation flag only when isTrusted');
    assert.ok(h.includes("summary.addEventListener('keydown', function(e){ if (e.isTrusted && (e.key === 'Enter' || e.key === ' ')) trustedActivation = true; });"), 'summary keydown sets the flag only for a trusted Enter/Space');
    assert.ok(h.includes("if (el.open && trustedActivation) trackEvent('faq_expand'"), 'toggle handler requires both open===true and the trusted-activation flag');
    assert.ok(h.includes('trustedActivation = false;\n    });\n  });'), 'flag is consumed (reset) on every toggle, so it cannot leak into a later unrelated toggle');
    assert.ok(!/renderFAQ\(\)[^}]*setAttribute\('open'/.test(h), 'renderFAQ never force-opens an item');
  });
  test('no hardcoded rgba(255,255,255,...) text color regression on package-card body text (must adapt in Light theme)', () => {
    for (const cls of ['.hp-hook', '.hp-line', '.hp-notes-line', '.wiv-points li']) {
      const rule = new RegExp(cls.replace(/[.\s]/g, '\\$&') + '\\{[^}]*\\}');
      const m = h.match(rule);
      assert.ok(m, `${cls} rule not found`);
      assert.ok(!/color:\s*rgba\(255,255,255/.test(m[0]), `${cls} still hardcodes white text: ${m[0]}`);
    }
  });
  test('FAQ has a real static no-JS fallback (not an empty shell)', () => {
    const faqSection = h.slice(h.indexOf('<section id="faq">'), h.indexOf('</section>', h.indexOf('<section id="faq">')));
    assert.ok((faqSection.match(/<details class="faq-item">/g) || []).length >= 3, 'static fallback has real fallback questions');
  });
  test('real Google review link preserved with review_link_click tracking (no invented ratings/counts)', () => {
    assert.ok(h.includes('https://share.google/pvHqwMzmtKflnZyPo') && h.includes("trackEvent('review_link_click'"), 'review link + tracking');
    for (const bad of ['★', '4.9', '5.0 stars', 'reviews)']) assert.ok(!h.includes(bad), `unexpected fabricated rating marker: ${bad}`);
  });
  test('gallery keeps all 6 real Vilu image assets as crawlable <img src> (not JS-only backgrounds)', () => {
    const GALLERY_IMAGES = [
      'vilu-residence-bikini-beach-maldives.jpg', 'vilu-residence-guests-maamigili-sunset.jpg',
      'vilu-residence-guests-lagoon-maldives.jpg', 'vilu-residence-couple-sunset-beach-maldives.jpg',
      'vilu-residence-maamigili-island-buggy-tour.jpg', 'vilu-residence-sandbank-bbq-beach-dining.jpg'
    ];
    for (const img of GALLERY_IMAGES) assert.ok(h.includes(`<img class="ga-img" src="https://viluresidence.net/images/${img}"`), img);
  });
  test('closing conversion uses the approved line + exactly 2 CTAs to the approved destinations', () => {
    const closing = h.slice(h.indexOf('<section id="closing">'), h.indexOf('</section>', h.indexOf('<section id="closing">')));
    assert.ok(closing.includes('Your South Ari story starts here.'));
    assert.ok(closing.includes('href="#holiday-packages"') && closing.includes("openBookingPage()"));
    assert.equal((closing.match(/class="btn-primary"|class="btn-outline"/g) || []).length, 2, 'exactly 2 primary/secondary CTAs');
  });
  test('legacy #about section removed, not just unlinked; Homecoming remains the single accommodation-photo moment', () => {
    assert.ok(!/id="about"/.test(h));
    assert.ok(!h.includes('about-float-card'), 'old duplicate "6 rooms" float card removed');
    assert.ok(!h.includes('style="background:var(--gold);color:var(--navy)"'), 'legacy inline amber button style removed');
  });
  test('Experiences section is a compact chip rail, not a second full card grid duplicating Above/Below', () => {
    assert.ok(h.includes('class="exp-chip"') && !h.includes('class="exp-card"'), 'exp-card grid replaced by exp-chip rail');
  });
  test('South Ari Expertise merges Guides + Getting Here + Timing Checker under one 5-tab bar; FAQ is its own section', () => {
    const se = h.slice(h.indexOf('<section id="travel-info">'), h.indexOf('</section>', h.indexOf('<section id="travel-info">')));
    for (const id of ['se-tab-destinations','se-tab-compare','se-tab-blog','se-tab-getting-here','se-tab-timing']) assert.ok(se.includes(`id="${id}"`), id);
    assert.ok(!se.includes('id="ti-panel-faq"') && !se.includes('id="se-panel-faq"'), 'FAQ tab removed from this bar');
  });
  test('South Ari Expertise tabs expose real tab semantics (role=tab/tablist + aria-selected toggled by seSwitchTab)', () => {
    const se = h.slice(h.indexOf('<section id="travel-info">'), h.indexOf('</section>', h.indexOf('<section id="travel-info">')));
    assert.ok(se.includes('class="ti-tabs" role="tablist"'), 'tab bar exposes role=tablist');
    for (const id of ['se-tab-destinations','se-tab-compare','se-tab-blog','se-tab-getting-here','se-tab-timing']) {
      assert.ok(new RegExp(`id="${id}" role="tab" aria-selected="(true|false)"`).test(se), `${id} exposes role=tab + aria-selected`);
    }
    assert.ok(h.includes("tabEl.setAttribute('aria-selected', k === tab ? 'true' : 'false')"), 'seSwitchTab keeps aria-selected in sync with the active tab');
  });
  test('final homepage section order matches the approved narrative', () => {
    // Phase 12B-E2C: Experiences moved from between Packages and Above to
    // between Homecoming and Rooms -- honest review found the compact chip
    // list (still a real, functional/utility-register block) sitting
    // directly before Above blunted the Packages -> Above emotional turn by
    // stacking two utility sections back to back. Repositioning it after the
    // cinematic arc completes gives Packages a direct handoff into Above,
    // and gives Experiences a more natural home next to Rooms/Availability's
    // own practical register. No content, links, or tracking moved or changed.
    const order = ['id="home"', 'id="what-is-vilu"', 'id="holiday-packages"', 'id="vc-above"', 'id="vc-homecoming"', 'id="experiences"', 'id="rooms"', 'id="booking"', 'id="travel-info"', 'id="reviews"', 'id="faq"', 'id="gallery"', 'id="closing"', 'id="contact"', '<footer'];
    let pos = -1;
    for (const marker of order) {
      const next = h.indexOf(marker, pos + 1);
      assert.ok(next > pos, `${marker} out of order (expected after previous section)`);
      pos = next;
    }
  });
}

// ---------------------------------------------------------------------------
section('Phase 12B-E2D — multilingual completion + final acceptance');
{
  const h = read('vilu-website.html');
  const LANGS = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk', 'zh'];

  // The 45 keys E2C's audit found missing from every non-English i18n/{lang}.json
  // (git log confirms this predates E2C/E2D — the whole `above`/`descent`/`below`/
  // `homecoming`/`whatIsVilu`/`closing` namespaces plus a handful of individual
  // keys simply never got added to any of the 9 dictionaries when Phase 12B's
  // cinematic homepage introduced them). This list is intentionally the exact
  // audited set, not a broader "every i18n key" sweep — a parity check this
  // specific stays meaningful without becoming a brittle full-dictionary diff.
  const PHASE12B_KEYS = [
    'above.eyebrow', 'above.displayLine1', 'above.displayLine2', 'above.sub',
    'below.eyebrow', 'below.displayLine1', 'below.displayLine2', 'below.displayLine3', 'below.sub', 'below.linkGuide', 'below.linkManta', 'below.linkWhale',
    'descent.caption',
    'homecoming.eyebrow', 'homecoming.display', 'homecoming.rooms', 'homecoming.personal', 'homecoming.cta',
    'whatIsVilu.eyebrow', 'whatIsVilu.headline', 'whatIsVilu.body', 'whatIsVilu.point1', 'whatIsVilu.point2', 'whatIsVilu.point3',
    'hero.display', 'hero.ctaPrimary', 'hero.ctaSecondary',
    'packages.featuredTag', 'packages.more', 'packages.moreLabel', 'packages.viewFullDetails', 'packages.viewPackage',
    'booking.reframeEyebrow', 'booking.reframeHeadline', 'booking.labelCheckin', 'booking.labelCheckout', 'booking.labelGuests', 'booking.labelRooms',
    'reviews.assurance1', 'reviews.assurance2', 'reviews.assurance3',
    'closing.headline', 'closing.cta', 'closing.ctaSecondary', 'closing.contactHint',
  ];
  test(`the audited Phase 12B key list itself has ${PHASE12B_KEYS.length} entries (sanity check on this test, not the site)`, () => {
    assert.equal(PHASE12B_KEYS.length, 45); // precise audited count (E2C's report used "~23" as a rough estimate before this audit ran)
  });
  function getPath(obj, dotted) { return dotted.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
  for (const lang of LANGS) {
    test(`i18n/${lang}.json: all ${PHASE12B_KEYS.length} Phase 12B homepage keys present with non-empty translated values`, () => {
      const dict = JSON.parse(read(`i18n/${lang}.json`));
      const missing = PHASE12B_KEYS.filter(k => {
        const v = getPath(dict.static, k);
        return typeof v !== 'string' || v.length === 0;
      });
      assert.deepEqual(missing, [], `${lang}.json missing/empty: ${missing.join(', ')}`);
    });
  }
  test('every generated homepage (English + 10 languages) exposes a real, non-placeholder #hp-grid before any JS runs', () => {
    // Guards the no-JS package-discovery fallback (E2D §11): the raw HTML
    // must never again ship only the "Loading packages…" placeholder.
    assert.ok(!/id="hp-grid"[^>]*>\s*<div[^>]*data-i18n="packages\.loading"/.test(h), 'English source #hp-grid still shows only the loading placeholder');
    // Bounded to the actual #hp-grid markup region -- a naive whole-file count
    // would also match the literal `class="hp-rail-item"` string inside
    // renderHolidayPackages()'s own JS source further down the same file.
    const hpGridRegion = h.slice(h.indexOf('id="hp-grid"'), h.indexOf('class="exp-links'));
    const railCount = (hpGridRegion.match(/class="hp-rail-item"/g) || []).length;
    assert.equal(railCount, 9, 'English #hp-grid should prerender all 9 packages');
    for (const it of M.packages.items) {
      assert.ok(h.includes(`id="package-${it.id}"`) && h.includes(`href="holiday-packages.html#${it.id}"`), `${it.id} missing a real prerendered deep link`);
    }
    for (const lang of LANGS) {
      const lh = read(`${lang}/index.html`);
      const lRegion = lh.slice(lh.indexOf('id="hp-grid"'), lh.indexOf('class="exp-links'));
      const lRailCount = (lRegion.match(/class="hp-rail-item"/g) || []).length;
      assert.equal(lRailCount, 9, `${lang}/index.html #hp-grid should prerender all 9 packages`);
    }
  });
  test('#hp-grid no-JS fallback is generated from holiday-packages.html’s own PACKAGES array (build-i18n-pages.js), not a second hand-authored dataset', () => {
    const build = read('build-i18n-pages.js');
    assert.ok(build.includes('function extractHomepagePackagesSource()') && build.includes("fs.readFileSync('holiday-packages.html'"), 'homepage fallback must import PACKAGES from holiday-packages.html at build time');
    assert.ok(!/var\s+HOMEPAGE_PACKAGES\s*=\s*\[/.test(build) && !/const\s+HOMEPAGE_PACKAGES\s*=\s*\[/.test(build), 'no second hand-maintained package array in the build script');
  });
  test('renderHolidayPackages() itself is untouched by the no-JS fallback work (live Firestore path unaffected)', () => {
    // The fallback is a small independent renderer in build-i18n-pages.js
    // specifically BECAUSE renderHolidayPackages() unconditionally constructs
    // `new IntersectionObserver` and calls loadHpTerms()/handleHolidayPackageDeepLink()
    // with no defensive guards -- reusing it in a build-time vm sandbox would
    // require adding guards to booking-adjacent runtime code just to satisfy
    // a build script. Confirm those calls are still there, unguarded, exactly
    // as approved -- i.e. this stage did not quietly rewrite that function.
    assert.ok(h.includes('var hpViewObserver = new IntersectionObserver('), 'renderHolidayPackages() IntersectionObserver construction unchanged');
    assert.ok(h.includes('loadHpTerms();') && h.includes('handleHolidayPackageDeepLink();'), 'renderHolidayPackages() side effects unchanged');
  });
  test('.room-price-amount: Dark gets a legible scoped override, Light keeps the E2C --teal fix untouched', () => {
    assert.ok(h.includes('.room-price-amount{font-size:var(--font-size-3xl);font-weight:600;color:var(--teal)}'), 'base rule (Light-theme-correct via the E2C --teal fix) must be unchanged');
    assert.ok(h.includes(':root[data-theme="dark"] .room-price-amount{color:var(--teal-light)}'), 'Dark-only override present, scoped to this one selector');
    // --teal itself (the token every OTHER component still relies on: WhatsApp
    // button, primary buttons, contact controls/icons) must not have been
    // touched in either theme block -- this is the exact "don't cause another
    // token regression" requirement.
    const themeCss = read('theme.css');
    assert.ok(/--teal:var\(--surface-secondary\);/.test(themeCss), 'Dark --teal alias (theme.css :root) unchanged');
    assert.ok(themeCss.includes('--teal:#0e7490;'), 'Light --teal override (the E2C fix) unchanged');
  });
  test('room-price-amount Dark contrast clears WCAG AA (>=4.5:1) against the room-card background', () => {
    // #14294a (the old Dark --teal-derived color) on #0f2140 (--card/--surface)
    // measured ~1.10:1 -- a real failure, not merely borderline. --teal-light
    // (#e0a752, the same token .hp-price already uses for the Holiday
    // Packages price) measures far above AA here.
    const rgbOf = (hx) => [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16));
    const lum = (c) => { const a = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
    const contrast = (a, b) => { const l1 = lum(rgbOf(a)), l2 = lum(rgbOf(b)); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
    const dark = M.theme.dark_tokens;
    const c = contrast(dark['--accent'], dark['--surface']); // --teal-light resolves to --accent; --card resolves to --surface
    assert.ok(c >= 4.5, `Dark room-price contrast ${c.toFixed(2)}:1, need >=4.5:1`);
  });
  test('room-card-badge dynamic translations cover both "Garden View" and "Garden view" (Firestore case variant confirmed live)', () => {
    // td() is an exact-string lookup (analytics.js's DYNAMIC_I18N), so a room
    // whose Firestore `view` field is literally "Garden view" (lowercase v --
    // confirmed via ROOMS[0].view over a real HTTP-served /de/ page, not
    // file://, which has its own unrelated language-detection quirk) never
    // matched the pre-existing "Garden View" (capital V) dynamic key. Every
    // language's dynamic dict needs BOTH exact strings covered.
    for (const lang of LANGS) {
      const dict = JSON.parse(read(`i18n/${lang}.json`));
      const cap = dict.dynamic && dict.dynamic['Garden View'];
      const lower = dict.dynamic && dict.dynamic['Garden view'];
      assert.ok(cap, `${lang}.json missing "Garden View" (capital V) dynamic translation`);
      assert.equal(lower, cap, `${lang}.json "Garden view" (lowercase v) should alias the same translation as "Garden View"`);
    }
  });
}

// ---------------------------------------------------------------------------
section('Phase 12D-A — guide/destination editorial system (4 representative pages)');
{
  const GUIDE_PAGES = ['maamigili-guide.html', 'south-ari-atoll-guide.html', 'whale-shark-snorkeling.html', 'manta-ray-snorkeling.html'];
  const css = read('shared-page.css');
  const navShellJs = read('nav-shell.js');

  test('each of the 4 pages keeps its canonical URL identity: exactly one H1, canonical link, complete hreflang set', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      assert.equal((src.match(/<h1\b/g) || []).length, 1, `${page}: expected exactly one H1`);
      assert.ok(/<link rel="canonical"/.test(src), `${page}: missing canonical link`);
      const hreflangs = [...src.matchAll(/rel="alternate" hreflang="([^"]+)"/g)].map(m => m[1]);
      assert.ok(hreflangs.includes('x-default'), `${page}: missing x-default hreflang`);
      assert.equal(hreflangs.length, 12, `${page}: expected 12 hreflang entries (11 languages + x-default)`);
    }
  });

  test('package-page-content heading hierarchy is sequential with no skip (excludes the known, deferred global footer H2->H4)', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      const bodyOnly = src.slice(src.indexOf('<body'), src.indexOf('<footer'));
      const headings = [...bodyOnly.matchAll(/<(h[1-6])\b/g)].map(m => Number(m[1][1]));
      for (let i = 1; i < headings.length; i++) {
        assert.ok(headings[i] <= headings[i - 1] + 1, `${page}: heading jumps from h${headings[i - 1]} to h${headings[i]} at index ${i}`);
      }
    }
  });

  test('TOC anchors remain real: every .toc-block ol > li > a href points to a real in-page id', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      const tocStart = src.indexOf('class="toc-block"');
      const tocEnd = src.indexOf('</nav>', tocStart);
      const tocHtml = src.slice(tocStart, tocEnd);
      const hrefs = [...tocHtml.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
      assert.ok(hrefs.length >= 5, `${page}: expected a substantial TOC (>=5 entries)`);
      for (const id of hrefs) assert.ok(src.includes(`id="${id}"`), `${page}: TOC links to #${id} but no element has that id`);
    }
  });

  test('the new two-zone layout wraps, not replaces, the existing TOC and article content (same nav.toc-block, same section ids, same FAQ)', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      assert.ok(src.includes('<div class="guide-layout">'), `${page}: missing .guide-layout wrapper`);
      assert.ok(src.includes('<aside class="guide-toc-rail">'), `${page}: missing .guide-toc-rail`);
      assert.ok(/<nav aria-label="Table of contents" class="toc-block">/.test(src), `${page}: toc-block nav markup changed`);
      assert.ok(/<article class="content-block reveal">/.test(src), `${page}: content-block article markup changed`);
      assert.ok(src.includes('class="faq-block"'), `${page}: FAQ block missing`);
    }
  });

  test('FAQ preservation: native <details>/<summary>, FAQPage schema present, question count matches', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      const faqBlockStart = src.indexOf('class="faq-block"');
      const faqBlockEnd = src.indexOf('</section>', faqBlockStart);
      const detailsCount = (src.slice(faqBlockStart, faqBlockEnd).match(/<details>/g) || []).length;
      assert.ok(detailsCount >= 5, `${page}: expected a substantial FAQ (>=5 questions), found ${detailsCount}`);
      const ldBlocks = jsonLd(src);
      const hasFaqPage = ldBlocks.some(b => (Array.isArray(b) ? b : [b]).some(x => x['@type'] === 'FAQPage'));
      assert.ok(hasFaqPage, `${page}: FAQPage schema missing`);
    }
  });

  test('Holiday Packages and availability links remain real hrefs, not duplicated package records', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      assert.ok(src.includes('href="holiday-packages.html"'), `${page}: no link to holiday-packages.html`);
      assert.ok(src.includes('href="/#booking"'), `${page}: no availability link`);
      // No package price schema was introduced into a guide page.
      const ldBlocks = jsonLd(src);
      const hasProduct = ldBlocks.some(b => (Array.isArray(b) ? b : [b]).some(x => x['@type'] === 'Product' && String(x.name || '').includes('Package')));
      assert.ok(!hasProduct, `${page}: must not introduce a package Product schema entity`);
    }
  });

  test('no-JS content contract: article/FAQ/related/closing sections have no opacity:0 base-state dependency beyond the existing site-wide .reveal (already covered by its own no-JS/IO-disabled fallback)', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      assert.ok(!/<noscript>/.test(src) || /\.reveal\{opacity:1/.test(src), `${page}: if a noscript override exists it must restore .reveal to visible`);
    }
  });

  test('no autoplay video, no new animation framework, no heavy slider was added to any of the 4 pages', () => {
    for (const page of GUIDE_PAGES) {
      const src = read(page);
      assert.ok(!/<video\b/i.test(src), `${page}: <video> element found`);
      const scriptSrcs = [...src.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
      for (const s of scriptSrcs) assert.ok(!/cdn|gsap|anime|framer|swiper|slick|unpkg|jsdelivr/i.test(s), `${page}: unexpected external/animation script: ${s}`);
    }
  });

  test('hero motion and breakout-image reveal are gated behind prefers-reduced-motion, reusing the existing pcHeroSettle/pcFadeUp keyframes', () => {
    assert.ok(css.includes('pcHeroSettle') && css.includes('pcFadeUp'));
    assert.ok(/body\[data-page-type="guide"\] \.page-header::after\{/.test(css));
    assert.ok(/@media \(prefers-reduced-motion:no-preference\)\{[\s\S]*?body\[data-page-type="guide"\] \.page-header::after\{animation:pcHeroSettle/.test(css));
  });

  test('guide-scoped CSS never touches the homepage or the frozen Holiday Packages page (selectors are scoped to body[data-page-type="guide"], distinct from "package"/"home")', () => {
    const guideRulesBlock = css.slice(css.indexOf('Phase 12D-A: Guide / Destination Editorial System'), css.indexOf('FOOTER — GLOBAL SHELL (Phase 10)'));
    assert.ok(!/data-page-type="package"/.test(guideRulesBlock), 'guide system CSS must not target the package page');
    assert.ok(!/data-page-type="home"/.test(guideRulesBlock), 'guide system CSS must not target the homepage');
  });

  test('nav-shell.js guide-TOC enhancement is guarded and a no-op on pages without .toc-block (homepage, package page)', () => {
    assert.ok(/function initGuideToc\(\)\{/.test(navShellJs));
    assert.ok(/if \(!tocBlocks\.length\) return;/.test(navShellJs));
  });

  test('homepage and Holiday Packages source carry none of this stage\'s new guide-system markers (a proxy for "not materially touched" that needs no git/network access)', () => {
    const GUIDE_MARKERS = ['class="guide-layout"', 'class="guide-toc-rail"', 'class="guide-breakout', 'class="box-label"'];
    for (const page of ['vilu-website.html', 'holiday-packages.html']) {
      const src = read(page);
      for (const marker of GUIDE_MARKERS) assert.ok(!src.includes(marker), `${page}: unexpectedly contains guide-system marker ${marker}`);
    }
  });

  test('PMS and Agency Portal files carry none of this stage\'s new guide-system markers or shared .pc-/.guide- class references', () => {
    for (const f of ['vilu-unified.html', 'vilu-agency-portal.html']) {
      const src = read(f);
      assert.ok(!src.includes('class="guide-layout"') && !src.includes('shared-page.css'), `${f} must stay isolated from the public guide/package CSS system`);
    }
  });
}

// ---------------------------------------------------------------------------
console.log(`\n${passed}/${passed + failed} preservation assertions passed${failed ? ` — ${failed} FAILED` : ''}`);
