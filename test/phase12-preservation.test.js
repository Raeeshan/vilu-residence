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
function read(rel) {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
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
  const corpus = ['vilu-website.html', 'analytics.js', 'consent.js', 'nav-shell.js', 'shared-page-i18n.js'].map(read).join('\n');
  for (const k of M.storage_keys.localStorage.concat(M.storage_keys.sessionStorage)) assert.ok(corpus.includes(`'${k}'`) || corpus.includes(`"${k}"`), k);
});

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
console.log(`\n${passed}/${passed + failed} preservation assertions passed${failed ? ` — ${failed} FAILED` : ''}`);
