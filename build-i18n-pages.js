const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const vm = require('vm');
const { execSync } = require('child_process');

const SITE_ROOT = 'https://viluresidence.net';
const IMAGE_SITEMAP_NS = 'http://www.google.com/schemas/sitemap-image/1.1';
const LANGS = ['zh', 'ru', 'de', 'it', 'fr', 'ar', 'ja', 'ko', 'sk', 'cs'];
const RTL_LANGS = { ar: true };

// Footer copyright year — derived from the Maldives timezone rather than the
// build machine's local clock, so it's correct regardless of where/when the
// predeploy build runs. Standard-library Intl only, no dependency.
const CURRENT_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'Indian/Maldives', year: 'numeric' }).format(new Date());

const PAGES = [
  { source: 'vilu-website.html', outFile: 'index.html', metaNs: 'seo', i18nMode: 'homepage' },
  { source: 'whale-shark-snorkeling.html', outFile: 'whale-shark-snorkeling.html', metaNs: 'wsMeta', i18nMode: 'standalone' },
  { source: 'manta-ray-snorkeling.html', outFile: 'manta-ray-snorkeling.html', metaNs: 'mrMeta', i18nMode: 'standalone' },
  { source: 'south-ari-atoll-guide.html', outFile: 'south-ari-atoll-guide.html', metaNs: 'saaMeta', i18nMode: 'standalone' },
  { source: 'holiday-packages.html', outFile: 'holiday-packages.html', metaNs: 'hpMeta', i18nMode: 'standalone', hasPackageGrid: true },
  { source: 'maamigili-guide.html', outFile: 'maamigili-guide.html', metaNs: 'maaMeta', i18nMode: 'standalone' },
  { source: 'best-time-to-visit.html', outFile: 'best-time-to-visit.html', metaNs: 'btMeta', i18nMode: 'standalone' },
  { source: 'guesthouse-vs-resort.html', outFile: 'guesthouse-vs-resort.html', metaNs: 'gvrMeta', i18nMode: 'standalone' },
  { source: 'maldives-holiday-cost.html', outFile: 'maldives-holiday-cost.html', metaNs: 'costMeta', i18nMode: 'standalone' },
  { source: 'best-local-islands-snorkeling.html', outFile: 'best-local-islands-snorkeling.html', metaNs: 'cmpSnorkelMeta', i18nMode: 'standalone' },
  { source: 'south-ari-vs-other-regions.html', outFile: 'south-ari-vs-other-regions.html', metaNs: 'cmpRegionsMeta', i18nMode: 'standalone' },
  { source: 'things-to-do-maamigili.html', outFile: 'things-to-do-maamigili.html', metaNs: 'blogThingsMeta', i18nMode: 'standalone' },
  // Legal pages (Phase 11B-P5): intentionally NOT added to SITEMAP_PAGE_SOURCE
  // below -- utility/trust pages stay out of the XML sitemap and noindexed,
  // per the P4/P4R/P5 decision, in every language.
  { source: 'privacy-policy.html', outFile: 'privacy-policy.html', metaNs: 'privacyMeta', i18nMode: 'standalone' },
  { source: 'cookies.html', outFile: 'cookies.html', metaNs: 'cookiesMeta', i18nMode: 'standalone' },
];

const RESOURCE_ATTRS = ['src', 'href', 'data-src', 'srcset', 'data-srcset', 'poster'];

function getPath(obj, dottedKey) {
  const parts = dottedKey.split('.');
  let node = obj;
  for (const p of parts) {
    if (node == null) return undefined;
    node = node[p];
  }
  return node;
}

function needsAbsolute(val) {
  if (!val) return false;
  return !/^(\/|#|https?:\/\/|\/\/|mailto:|tel:|data:|javascript:)/i.test(val);
}

// Skips <a> tags entirely — a same-directory relative link like
// <a href="whale-shark-snorkeling.html"> must stay relative so it resolves
// to the sibling page in the SAME generated /{lang}/ directory. Rewriting
// it to root-absolute forces it back to the English page — that's the live
// bug this replaces.
function rewriteResourcePaths($) {
  $('*').each(function () {
    const el = $(this);
    const isAnchor = this.tagName && this.tagName.toLowerCase() === 'a';
    for (const attr of RESOURCE_ATTRS) {
      if (attr === 'href' && isAnchor) continue;
      const val = el.attr(attr);
      if (val === undefined) continue;
      if (attr === 'srcset' || attr === 'data-srcset') {
        const rewritten = val.split(',').map((part) => {
          const trimmed = part.trim();
          const spaceIdx = trimmed.indexOf(' ');
          const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
          const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
          return (needsAbsolute(url) ? '/' + url : url) + descriptor;
        }).join(', ');
        el.attr(attr, rewritten);
      } else if (needsAbsolute(val)) {
        el.attr(attr, '/' + val);
      }
    }
  });
  rewriteStyleUrls($);
}

// Rewrites url('...') references inside inline style="" attributes (e.g. a
// hero's background-image, including the image-set() multi-URL form) to
// root-absolute, same as any other resource path. HTML attribute rewriting
// above never touches these since they live inside a style string, not an
// attribute of their own — without this, every non-English generated page's
// CSS background-image 404s silently (failed background-image loads don't
// throw console errors, unlike a broken <img src>).
function rewriteStyleUrls($) {
  $('[style]').each(function () {
    const el = $(this);
    const style = el.attr('style');
    if (!style || style.indexOf('url(') === -1) return;
    const rewritten = style.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, url) => {
      if (!needsAbsolute(url)) return match;
      return `url(${quote}/${url}${quote})`;
    });
    if (rewritten !== style) el.attr('style', rewritten);
  });
}

// Standalone pages link back to the homepage via already-absolute hrefs
// ("/", "/#booking", ...). Insert the language prefix so switching pages
// keeps the visitor in the same language.
function rewriteHomepageBackLinks($, lang) {
  $('a[href]').each(function () {
    const el = $(this);
    const href = el.attr('href');
    if (href === '/') { el.attr('href', '/' + lang + '/'); return; }
    if (href.startsWith('/#')) { el.attr('href', '/' + lang + href); return; }
  });
}

// The two English-only legal pages (privacy-policy.html, cookies.html) are
// the only standalone pages WITHOUT a per-language duplicate under /{lang}/
// -- every other cross-page link stays a bare relative filename because a
// same-name file genuinely exists in the same output directory (see
// rewriteResourcePaths' comment). Legal-page links use a root-absolute href
// instead (/privacy-policy.html), so once P5 localizes those two pages this
// rewrites the link to the matching localized copy. Runs for every page in
// every language, both homepage and standalone -- both templates' footers
// link to the legal pages the same way.
function rewriteLegalLinks($, lang) {
  $('a[href]').each(function () {
    const el = $(this);
    const href = el.attr('href');
    if (href === '/privacy-policy.html' || href === '/cookies.html') {
      el.attr('href', '/' + lang + href);
    }
  });
}

function rewriteHreflangAndCanonical($, lang, outFile) {
  $('link[rel="alternate"][hreflang]').each(function () {
    const code = $(this).attr('hreflang');
    const suffix = outFile === 'index.html' ? '' : outFile;
    if (code === 'x-default') { $(this).attr('href', SITE_ROOT + '/' + suffix); return; }
    $(this).attr('href', code === 'en' ? SITE_ROOT + '/' + suffix : SITE_ROOT + '/' + code + '/' + suffix);
  });
  const canonical = $('#canonical-link');
  if (canonical.length) {
    const suffix = outFile === 'index.html' ? '' : outFile;
    canonical.attr('href', SITE_ROOT + '/' + lang + '/' + suffix);
  }
}

function applyStaticTranslations($, dict, metaNs, i18nMode) {
  $('[data-i18n]').each(function () {
    const val = getPath(dict.static, $(this).attr('data-i18n'));
    if (val === undefined) return;
    if (i18nMode === 'homepage') $(this).text(val);
    else $(this).html(val); // standalone pages' shared engine always uses innerHTML
  });
  if (i18nMode === 'homepage') {
    $('[data-i18n-html]').each(function () {
      const val = getPath(dict.static, $(this).attr('data-i18n-html'));
      if (val !== undefined) $(this).html(val);
    });
  }
  $('[data-i18n-placeholder]').each(function () {
    const val = getPath(dict.static, $(this).attr('data-i18n-placeholder'));
    if (val !== undefined) $(this).attr('placeholder', val);
  });
  $('[data-i18n-alt]').each(function () {
    const val = getPath(dict.static, $(this).attr('data-i18n-alt'));
    if (val !== undefined) $(this).attr('alt', val);
  });
  $('[data-i18n-aria-label]').each(function () {
    const val = getPath(dict.static, $(this).attr('data-i18n-aria-label'));
    if (val !== undefined) $(this).attr('aria-label', val);
  });
  // Explicit whitelist for translating an <a> tag's href — deliberately not a
  // generic arbitrary-attribute mechanism. Runs before rewriteResourcePaths()/
  // rewriteHomepageBackLinks(), but both of those already skip anchor hrefs
  // outright (see their own comments), so a full external URL written here is
  // never touched again downstream.
  $('[data-i18n-href]').each(function () {
    const val = getPath(dict.static, $(this).attr('data-i18n-href'));
    if (val !== undefined) $(this).attr('href', val);
  });
  const seoTitle = getPath(dict.static, metaNs + '.title');
  if (seoTitle !== undefined) $('title').text(seoTitle);
  const seoDesc = getPath(dict.static, metaNs + '.description');
  if (seoDesc !== undefined) $('meta[name="description"]').attr('content', seoDesc);
}

// ── Package-grid pre-rendering (holiday-packages.html only) ──
//
// holiday-packages.html's #pkg-grid is built entirely client-side from a
// hardcoded PACKAGES array via renderDynamicContent() (see that file) —
// meaning even the ENGLISH raw HTML has an empty grid until JS runs, which
// is the actual audit finding this section fixes. This is NOT
// Firestore-sourced live data (it's an intentionally frozen snapshot, same
// tradeoff already disclosed elsewhere in this project), so it's safe and
// correct to pre-render at build time.
//
// Rather than re-implementing renderDynamicContent()'s card-building logic
// a second time (exactly the dual-maintenance trap this project has hit
// twice before), this EXECUTES the real, unmodified PACKAGES +
// renderDynamicContent() code straight from the page's own <script> tag,
// inside a small vm sandbox that mocks only `document.getElementById` and
// provides t()/td()/tf() implementations matching shared-page-i18n.js's
// real semantics exactly (verified against that file directly).

function makeT(dict, i18nEn) {
  return function t(key) {
    var parts = key.split('.');
    function lookup(root) { var node = root; for (var i = 0; i < parts.length; i++) node = node ? node[parts[i]] : undefined; return node; }
    var node = lookup(dict);
    var fbNode = lookup(i18nEn);
    return node !== undefined ? node : fbNode;
  };
}
function makeTd(dynamicDict) {
  return function td(str) {
    if (!str) return str;
    if (!dynamicDict) return str;
    var hit = dynamicDict[str];
    return hit !== undefined ? hit : str;
  };
}
function makeTf(tFn) {
  return function tf(key, vars) {
    var s = tFn(key) || '';
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  };
}

// Runs the page's own inline script (containing PACKAGES + renderDynamicContent)
// in a sandbox, then calls renderDynamicContent() and captures what it wrote
// into #pkg-grid (Full Collection), #pkg-featured (Featured Journeys,
// Phase 12C-B), and #pkg-duration (Duration Guide, Phase 12C-B).
function renderPackageGridHtml(mainScriptSrc, dict, i18nEn, dynamicDict) {
  var captured = {};
  function mockEl(id) {
    return {
      set innerHTML(val) { captured[id] = val; },
      get innerHTML() { return captured[id] || ''; },
    };
  }
  var TARGET_IDS = ['pkg-grid', 'pkg-featured', 'pkg-duration'];
  var sandbox = {
    document: { getElementById: function (id) { return TARGET_IDS.indexOf(id) !== -1 ? mockEl(id) : null; } },
    t: makeT(dict, i18nEn),
    td: makeTd(dynamicDict),
    tf: null,
    console: console,
  };
  sandbox.tf = makeTf(sandbox.t);
  vm.createContext(sandbox);
  vm.runInContext(mainScriptSrc + '\nrenderDynamicContent();', sandbox, { timeout: 5000 });
  return captured;
}

// Extracts the main inline <script> (the one defining I18N/PACKAGES/
// renderDynamicContent, NOT the small early redirect script) as raw JS text,
// and separately extracts the embedded I18N.en object as a real JS value
// (it's a JS object literal, not JSON, so this evaluates it in a sandbox
// rather than JSON.parse-ing it).
function extractPageScript($) {
  var scripts = $('script').filter(function () { return !$(this).attr('src') && !$(this).attr('type'); });
  // The redirect script is short and always first; the main script (with
  // PACKAGES/renderDynamicContent) is identified by containing that function.
  var mainScriptEl = scripts.filter(function () { return $(this).html().indexOf('function renderDynamicContent') !== -1; }).first();
  if (!mainScriptEl.length) return null;
  var src = mainScriptEl.html();
  var sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.I18N_EN = (typeof I18N !== "undefined" && I18N.en) ? I18N.en : null;', sandbox, { timeout: 5000 });
  return { src: src, i18nEn: sandbox.I18N_EN };
}

function prerenderPackageGrid($, mainScriptSrc, dict, i18nEn, dynamicDict) {
  var captured = renderPackageGridHtml(mainScriptSrc, dict, i18nEn, dynamicDict);
  ['pkg-grid', 'pkg-featured', 'pkg-duration'].forEach(function (id) {
    var el = $('#' + id);
    if (el.length && captured[id] !== undefined) el.html(captured[id]);
  });
}

// ── Homepage #hp-grid no-JS fallback (Phase 12B-E2D) ──
//
// The homepage's own renderHolidayPackages() (vilu-website.html) is NOT
// reused here the way renderPackageGridHtml() reuses holiday-packages.html's
// renderDynamicContent() above -- renderHolidayPackages() unconditionally
// constructs `new IntersectionObserver(...)` and calls loadHpTerms() /
// handleHolidayPackageDeepLink() with no defensive "typeof X === undefined"
// guards (unlike pkgObserveCardViews(), which does guard), so running it in
// a bare vm sandbox throws. Rather than risk a subtle bug in that
// booking-adjacent function by adding guards to it just to satisfy a build
// script, this is a small, independent, read-only renderer: same PACKAGES
// array (imported from holiday-packages.html, never re-typed here -- exactly
// the "don't duplicate commercial data" requirement), routed through the
// same td()/t() translation helpers already used for every other prerender
// in this file, emitting the SAME .hp-rail-item markup/classes
// renderHolidayPackages() itself uses (already fully styled, zero new CSS).
// It only ever fills the pre-JS placeholder; renderHolidayPackages() still
// unconditionally overwrites #hp-grid's entire innerHTML once JS + Firestore
// load, exactly as it does today -- this function's output is never visible
// to a JS-enabled visitor for longer than first paint.
// Extracts the `I18N.en` object literal straight out of the homepage's own
// inline script by bracket-matching the raw text (same technique as
// findDivInnerSpan() below), then evaluating ONLY that isolated object
// literal expression -- never the surrounding script. Deliberately NOT
// extractPageScript()'s vm.runInContext(fullScriptSrc, ...): that runs every
// top-level statement in the homepage's (much larger, DOM-wiring) script,
// which this narrow need doesn't require and shouldn't risk.
function extractHomepageI18nEn() {
  var srcHtml = fs.readFileSync('vilu-website.html', 'utf8');
  var marker = 'var I18N = {';
  var start = srcHtml.indexOf(marker);
  if (start === -1) return null;
  var i = start + marker.length - 1; // land on the opening '{'
  var depth = 0, started = false;
  for (; i < srcHtml.length; i++) {
    var c = srcHtml[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
  }
  var objText = srcHtml.slice(start + 'var I18N = '.length, i);
  var sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('this.I18N_OBJ = ' + objText + ';', sandbox, { timeout: 5000 });
  return sandbox.I18N_OBJ && sandbox.I18N_OBJ.en;
}

function extractHomepagePackagesSource() {
  var srcHtml = fs.readFileSync('holiday-packages.html', 'utf8');
  var $orig = cheerio.load(srcHtml, { decodeEntities: false });
  var pkgScript = extractPageScript($orig);
  if (!pkgScript) return null;
  var sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    pkgScript.src + '\nthis.PACKAGES_DATA = (typeof PACKAGES !== "undefined") ? PACKAGES : null;',
    sandbox,
    { timeout: 5000 }
  );
  return sandbox.PACKAGES_DATA;
}

function renderHomepagePackageFallback(packages, dict, i18nEn, dynamicDict) {
  var t = makeT(dict, i18nEn);
  var td = makeTd(dynamicDict);
  var items = packages.map(function (p) {
    var nightWord = p.nights > 1 ? t('packages.nights') : t('packages.night');
    return '<div class="hp-rail-item" id="package-' + p.slug + '" data-pkg-id="' + p.slug + '" data-pkg-name="' + td(p.name).replace(/"/g, '&quot;') + '" data-pkg-nights="' + p.nights + '">'
      + '<h3 class="hp-rail-name">' + td(p.name) + '</h3>'
      + '<div class="hp-rail-meta">$' + p.price + ' ' + t('packages.pp') + ' &middot; ' + p.nights + ' ' + nightWord + '</div>'
      + '<p class="hp-rail-hook">' + td(p.desc || '') + '</p>'
      + '<div class="hp-rail-actions">'
        + '<a class="hp-rail-view" href="holiday-packages.html#' + p.slug + '">' + t('packages.viewPackage') + ' &rarr;</a>'
      + '</div>'
    + '</div>';
  }).join('');
  return '<div class="hp-rail-wrap"><div class="hp-rail">' + items + '</div></div>';
}

// ── Sitemap <lastmod> maintenance ──
//
// Derives lastmod from real git commit history of each URL's SOURCE files
// (the hand-edited HTML + the relevant i18n/{lang}.json, for non-English
// URLs), never from "now" or from the generated output files themselves.
// The generated files under /{lang}/ get rewritten on every single deploy
// regardless of whether real content changed, so their own git history is
// noise — using it would make lastmod always show "today," which search
// engines learn to distrust. Source-file history is the only signal that
// genuinely reflects when a URL's actual content last changed.
const SITEMAP_ROOT = 'https://viluresidence.net/';
const SITEMAP_PAGE_SOURCE = {
  '': 'vilu-website.html',
  'whale-shark-snorkeling.html': 'whale-shark-snorkeling.html',
  'manta-ray-snorkeling.html': 'manta-ray-snorkeling.html',
  'south-ari-atoll-guide.html': 'south-ari-atoll-guide.html',
  'holiday-packages.html': 'holiday-packages.html',
  'maamigili-guide.html': 'maamigili-guide.html',
  'best-time-to-visit.html': 'best-time-to-visit.html',
  'guesthouse-vs-resort.html': 'guesthouse-vs-resort.html',
  'maldives-holiday-cost.html': 'maldives-holiday-cost.html',
  'best-local-islands-snorkeling.html': 'best-local-islands-snorkeling.html',
  'south-ari-vs-other-regions.html': 'south-ari-vs-other-regions.html',
  'things-to-do-maamigili.html': 'things-to-do-maamigili.html',
};

const _lastmodCache = {};
function gitLastCommitDate(file) {
  if (_lastmodCache[file] !== undefined) return _lastmodCache[file];
  let result = null;
  try {
    const out = execSync(`git log -1 --format=%cI -- "${file}"`, { encoding: 'utf8' }).trim();
    if (out) result = out.slice(0, 10);
  } catch (e) { result = null; }
  _lastmodCache[file] = result;
  return result;
}

function maxDateStr(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function parseSitemapLoc(loc) {
  const rest = loc.replace(SITEMAP_ROOT, '');
  const langMatch = rest.match(/^([a-z]{2})\/(.*)$/);
  if (langMatch && LANGS.includes(langMatch[1])) {
    return { page: langMatch[2], lang: langMatch[1] };
  }
  return { page: rest, lang: null };
}

// Maps a sitemap page-key ('' for the homepage, otherwise the outFile name)
// to its full PAGES entry, so the namespace-scoping below can read
// metaNs/hasPackageGrid without a second hand-maintained table — derived
// mechanically from PAGES, not hand-typed.
const SITEMAP_PAGE_DEF = {};
for (const p of PAGES) {
  SITEMAP_PAGE_DEF[p.outFile === 'index.html' ? '' : p.outFile] = p;
}

// ── Namespace-scoped translation history (fixes the whole-file lastmod bug) ──
//
// The naive approach — git-log-dating the entire i18n/{lang}.json file — was
// wrong: that file holds every page's translation namespaces, so editing
// just one page's namespace (e.g. hpPage for a Holiday Packages copy change)
// made the WHOLE file's git-log date bump, which then got attributed to
// every OTHER page in that language too (110 spurious lastmod changes from a
// single real commit, confirmed against this repo's own history). The fix:
// track each top-level i18n key's own last-changed date from git history,
// and only look at the keys a given page actually reads.
//
// Split into a pure function (computeKeyLastChanged) and an impure one
// (getLangJsonSnapshots) specifically so the date-diffing LOGIC is testable
// without shelling out to git — see the test file.

// Pure. Extracts the set of top-level i18n namespaces a page's markup
// actually reads, from its own data-i18n*="ns.key" attributes — derived from
// the page's real markup on every build, not a hand-maintained page→namespace
// map, so a namespace rename/addition in the HTML is picked up automatically
// and can never drift out of sync the way a manual table could.
const DATA_I18N_ATTR_RE = /data-i18n(?:-html|-placeholder|-alt|-aria-label|-href)?="([^"]+)"/g;
function extractNamespaces(html) {
  const ns = new Set();
  let m;
  DATA_I18N_ATTR_RE.lastIndex = 0;
  while ((m = DATA_I18N_ATTR_RE.exec(html))) {
    const first = m[1].split('.')[0];
    if (first) ns.add(first);
  }
  return ns;
}

// Derives a page's full relevant-namespace set: its data-i18n-attribute
// namespaces, plus its metadata namespace (metaNs — title/description are
// set directly from dict.static[metaNs], never via a data-i18n attribute, so
// it would never be found by extractNamespaces alone), plus the pseudo-key
// "__dynamic__" for pages whose #pkg-grid reads dict.dynamic (package-name
// translations) at build time.
const _namespaceCache = {};
function namespacesForPage(pageDef) {
  if (_namespaceCache[pageDef.source]) return _namespaceCache[pageDef.source];
  const html = fs.readFileSync(pageDef.source, 'utf8');
  const ns = extractNamespaces(html);
  if (pageDef.metaNs) ns.add(pageDef.metaNs);
  if (pageDef.hasPackageGrid) ns.add('__dynamic__');
  _namespaceCache[pageDef.source] = ns;
  return ns;
}

// Pure. Given an i18n/{lang}.json file's history as an ordered array of
// { date, static, dynamic } snapshots (oldest first), returns a map of
// { [topLevelKey]: dateLastChanged }. A key's date updates whenever its
// value differs (by deep JSON comparison) from the immediately preceding
// snapshot — including its first appearance, which is correctly attributed
// to the commit that introduced it (comparison against the "nothing yet"
// starting state of {}/undefined). dict.dynamic is tracked as a single
// pseudo-key "__dynamic__" since it's read as one block by the package grid,
// not per-namespace.
function computeKeyLastChanged(snapshots) {
  const result = {};
  let prevStatic = {};
  let prevDynamicJson;
  for (const snap of snapshots) {
    const snapStatic = snap.static || {};
    const keys = new Set(Object.keys(prevStatic).concat(Object.keys(snapStatic)));
    for (const k of keys) {
      if (JSON.stringify(prevStatic[k]) !== JSON.stringify(snapStatic[k])) result[k] = snap.date;
    }
    const dynamicJson = JSON.stringify(snap.dynamic);
    if (dynamicJson !== prevDynamicJson) result.__dynamic__ = snap.date;
    prevStatic = snapStatic;
    prevDynamicJson = dynamicJson;
  }
  return result;
}

// Impure. Walks the full commit history of i18n/{lang}.json (oldest first)
// and parses each revision's JSON via `git show <hash>:<file>`, for
// computeKeyLastChanged to diff. No caching to disk (deliberately, per this
// task's scope) — result is memoized in-process per language for the
// lifetime of one build run, since a build recomputes it once per language
// regardless of how many pages/URLs reference it.
function getLangJsonSnapshots(lang) {
  const file = `i18n/${lang}.json`;
  let log;
  try {
    log = execSync(`git log --format=%H%x09%cI --reverse -- "${file}"`, { encoding: 'utf8' });
  } catch (e) { return []; }
  const snapshots = [];
  for (const line of log.split('\n')) {
    if (!line) continue;
    const [hash, dateIso] = line.split('\t');
    let raw;
    try {
      raw = execSync(`git show ${hash}:"${file}"`, { encoding: 'utf8' });
    } catch (e) { continue; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    snapshots.push({ date: dateIso.slice(0, 10), static: parsed.static, dynamic: parsed.dynamic });
  }
  return snapshots;
}

const _keyLastChangedCache = {};
function keyLastChangedForLang(lang) {
  if (_keyLastChangedCache[lang]) return _keyLastChangedCache[lang];
  const result = computeKeyLastChanged(getLangJsonSnapshots(lang));
  _keyLastChangedCache[lang] = result;
  return result;
}

function computeSitemapLastmod(loc) {
  const { page, lang } = parseSitemapLoc(loc);
  const sourceFile = SITEMAP_PAGE_SOURCE[page];
  if (sourceFile === undefined) return null;
  const pageDate = gitLastCommitDate(sourceFile);
  if (!lang) return pageDate; // English: source-file history only, no i18n coupling — unchanged behavior.
  const pageDef = SITEMAP_PAGE_DEF[page];
  if (!pageDef) return pageDate;
  const keyDates = keyLastChangedForLang(lang);
  let i18nDate = null;
  for (const ns of namespacesForPage(pageDef)) {
    i18nDate = maxDateStr(i18nDate, keyDates[ns] || null);
  }
  return maxDateStr(pageDate, i18nDate);
}

function updateSitemapLastmod() {
  const sitemapPath = 'sitemap.xml';
  if (!fs.existsSync(sitemapPath)) { console.warn('SKIPPED sitemap.xml: not found'); return; }
  let content = fs.readFileSync(sitemapPath, 'utf8');
  // Source file has mixed CRLF/LF line endings from prior tooling passes,
  // so match either — a literal-\n-only pattern silently misses blocks
  // that end in \r\n (confirmed: only 45/99 blocks matched without this).
  const urlBlocks = content.match(/  <url>[\s\S]*?<\/url>\r?\n/g);
  if (!urlBlocks) { console.warn('sitemap.xml: no <url> blocks found'); return; }

  let updated = 0;
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) continue;
    const lastmod = computeSitemapLastmod(locMatch[1]);
    if (!lastmod) continue;
    const withoutOld = block.replace(/\r?\n {4}<lastmod>[^<]*<\/lastmod>/, '');
    const newBlock = withoutOld.replace('</loc>', `</loc>\r\n    <lastmod>${lastmod}</lastmod>`);
    if (newBlock !== block) { content = content.replace(block, newBlock); updated++; }
  }
  fs.writeFileSync(sitemapPath, content);
  console.log(`sitemap.xml: <lastmod> refreshed on ${updated}/${urlBlocks.length} url blocks.`);
}

// ── Image sitemap ──
//
// Only viluresidence.net-hosted images are eligible. Firebase Storage's
// firebasestorage.googleapis.com is a shared, Google-owned, multi-tenant
// host — it can't be verified as a Vilu Residence property in Search
// Console, which Google's cross-domain image-sitemap guidance requires.
// Hero/Gallery/About images are extracted straight from each page's own
// source markup rather than a hand-maintained parallel list, so those stay
// correct automatically if a photo is ever swapped later.
function escapeXmlText(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Room photos CANNOT be extracted the same way: photoSlots.{slot}.url lives
// in Firestore and is written into the DOM by client-side JS at runtime
// (see refreshRoomCards() / the booking-flow gallery in vilu-website.html),
// never into this file's static source markup — so no regex over srcHtml
// will ever find them, and this build script deliberately has no Firestore
// access (see Room Photo Image Sitemap Integration task). This list is
// therefore a manually maintained snapshot of the 30 canonical URLs that
// were live and `seoMirror.status === 'synced'` in Firestore as of the
// Room Photo SEO Migration (VR01–VR06, closed). If a room photo is ever
// replaced after this, photoSlots.{slot}.url in Firestore will move on
// without this list — someone must update it by hand, or the sitemap will
// silently go stale for that one image. Every room's URL is kept even where
// two rooms share byte-identical underlying photography (see the migration
// report), because each is a real, independently live URL for a specific
// room — deduplicating would arbitrarily attribute one room's photo to
// another. JPG only, never the .webp twin, matching the pattern used for
// every other image list in this file.
const ROOM_PHOTO_SITEMAP_URLS = [
  // VR01 — Deluxe Family Room
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-bed-vr01-cd89b8dd.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-interior-vr01-6b24913b.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-bathroom-vanity-vr01-4dba6981.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-bathroom-shower-vr01-5c619110.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-veranda-night-vr01-c17b483d.jpg`,
  // VR02 — Deluxe Family Room
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-interior-vr02-6b24913b.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-bed-vr02-cd89b8dd.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-bathroom-vanity-vr02-4dba6981.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-bathroom-shower-vr02-5c619110.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-room-veranda-night-vr02-c17b483d.jpg`,
  // VR03 — Double Room
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bed-vr03-5ddc46c5.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-interior-vr03-a7349edd.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bathroom-shower-vr03-cfa7afa3.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bathroom-vanity-vr03-e10a9edf.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-veranda-night-vr03-ff126dbb.jpg`,
  // VR04 — Double Room
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bed-vr04-5ddc46c5.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-interior-vr04-a7349edd.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bathroom-shower-vr04-cfa7afa3.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bathroom-vanity-vr04-e10a9edf.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-veranda-night-vr04-ff126dbb.jpg`,
  // VR05 — Double Room
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bed-vr05-5ddc46c5.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-interior-vr05-a7349edd.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bathroom-shower-vr05-cfa7afa3.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-bathroom-vanity-vr05-e10a9edf.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-double-room-veranda-night-vr05-ff126dbb.jpg`,
  // VR06 — Deluxe Family Room with Open Deck
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-open-deck-bed-ec7aef94.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-open-deck-patio-door-8ccfeeaf.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-open-deck-bathroom-shower-63d57afd.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-open-deck-bathroom-vanity-ac6dad9a.jpg`,
  `${SITE_ROOT}/images/rooms/vilu-residence-deluxe-family-open-deck-veranda-night-6023c510.jpg`,
];

function extractHeroImages(pageDef, srcHtml) {
  const files = [];
  const seen = new Set();
  if (pageDef.outFile === 'index.html') {
    // Homepage: several hero-slide-img tags — slide 1 uses src=, the rest
    // use data-src= (deferred-loaded). Only .jpg, never the sibling .webp
    // <source> variant — one canonical URL per real photo.
    const re = /class="hero-slide-img"[^>]*?(?:data-src|src)="images\/([^"]+\.jpg)"/g;
    let m;
    while ((m = re.exec(srcHtml))) {
      if (!seen.has(m[1])) { seen.add(m[1]); files.push(m[1]); }
    }
    // Gallery + About: same-origin lazy-bg photos already migrated off
    // Firebase Storage (data-bg-url="https://viluresidence.net/images/...").
    // Room-card data-bg-url values are set by client-side JS at runtime and
    // are never present in this static srcHtml at all, so they're excluded
    // automatically here regardless of what host they now point to — see
    // ROOM_PHOTO_SITEMAP_URLS below for how those are actually included.
    const galleryRe = new RegExp(`data-bg-url="${SITE_ROOT}/images/([^"]+\\.jpg)"`, 'g');
    while ((m = galleryRe.exec(srcHtml))) {
      if (!seen.has(m[1])) { seen.add(m[1]); files.push(m[1]); }
    }
    const fullUrls = files.map((file) => `${SITE_ROOT}/images/${file}`);
    // Room photos are already full URLs (they live under /images/rooms/,
    // not /images/), so they're appended after the map, not before it.
    return fullUrls.concat(ROOM_PHOTO_SITEMAP_URLS);
  }
  // Standalone pages: exactly one page-header hero background image.
  const m = srcHtml.match(/class="page-header"[^>]*style="[^"]*?background-image:url\('images\/([^']+\.jpg)'\)/);
  if (m) files.push(m[1]);
  return files.map((file) => `${SITE_ROOT}/images/${file}`);
}

function ensureImageSitemapNamespace(content) {
  if (content.indexOf('xmlns:image=') !== -1) return content;
  return content.replace(
    /(<urlset\s+xmlns="[^"]*"\s*\r?\n\s*xmlns:xhtml="[^"]*")/,
    `$1\r\n        xmlns:image="${IMAGE_SITEMAP_NS}"`
  );
}

function updateSitemapImages(imagesBySource) {
  const sitemapPath = 'sitemap.xml';
  if (!fs.existsSync(sitemapPath)) { console.warn('SKIPPED sitemap.xml: not found (image step)'); return; }
  let content = fs.readFileSync(sitemapPath, 'utf8');
  content = ensureImageSitemapNamespace(content);

  const urlBlocks = content.match(/  <url>[\s\S]*?<\/url>\r?\n/g);
  if (!urlBlocks) { console.warn('sitemap.xml: no <url> blocks found (image step)'); return; }

  let imageTagCount = 0;
  let urlsWithImages = 0;
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) continue;
    const { page } = parseSitemapLoc(locMatch[1]);
    const sourceFile = SITEMAP_PAGE_SOURCE[page];
    const images = sourceFile ? (imagesBySource[sourceFile] || []) : [];

    // Strip any existing <image:image> entries first, so re-running the
    // build replaces cleanly on every pass instead of appending duplicates.
    const withoutOldImages = block.replace(
      /\s*<image:image>\s*<image:loc>[^<]*<\/image:loc>\s*<\/image:image>/g,
      ''
    );

    if (images.length === 0) {
      if (withoutOldImages !== block) content = content.replace(block, withoutOldImages);
      continue;
    }

    const imageXml = images
      .map((url) => `\r\n    <image:image>\r\n      <image:loc>${escapeXmlText(url)}</image:loc>\r\n    </image:image>`)
      .join('');

    // Insert right after the last hreflang line (x-default is always last)
    // and before <changefreq> — same insertion point regardless of a
    // block's own priority/changefreq value.
    const newBlock = withoutOldImages.replace(
      /(<xhtml:link rel="alternate" hreflang="x-default" href="[^"]*"\/>)\r?\n(\s*<changefreq>)/,
      `$1${imageXml}\r\n$2`
    );

    if (newBlock === withoutOldImages) {
      console.warn(`sitemap.xml: could not find image-insertion point for ${locMatch[1]}`);
      if (withoutOldImages !== block) content = content.replace(block, withoutOldImages);
      continue;
    }

    content = content.replace(block, newBlock);
    imageTagCount += images.length;
    urlsWithImages++;
  }

  fs.writeFileSync(sitemapPath, content);
  console.log(`sitemap.xml: ${imageTagCount} <image:image> entries written across ${urlsWithImages} url blocks.`);
}

function main() {
  let totalGenerated = 0;
  const imagesBySource = {};
  for (const pageDef of PAGES) {
    if (!fs.existsSync(pageDef.source)) { console.warn(`SKIPPED ${pageDef.source}: not found`); continue; }
    const srcHtml = fs.readFileSync(pageDef.source, 'utf8');
    imagesBySource[pageDef.source] = extractHeroImages(pageDef, srcHtml);

    let pkgScript = null;
    if (pageDef.hasPackageGrid) {
      const $orig = cheerio.load(srcHtml, { decodeEntities: false });
      pkgScript = extractPageScript($orig);
      if (!pkgScript) console.warn(`WARNING: ${pageDef.source} marked hasPackageGrid but no renderDynamicContent() script found`);
    }

    let homepagePackages = null, homepageI18nEn = null;
    if (pageDef.source === 'vilu-website.html') {
      homepagePackages = extractHomepagePackagesSource();
      homepageI18nEn = extractHomepageI18nEn();
      if (!homepagePackages) console.warn(`WARNING: could not extract PACKAGES from holiday-packages.html for the #hp-grid no-JS fallback`);
      if (!homepageI18nEn) console.warn(`WARNING: could not extract I18N.en from vilu-website.html for the #hp-grid no-JS fallback`);
    }

    for (const lang of LANGS) {
      const dictPath = `i18n/${lang}.json`;
      if (!fs.existsSync(dictPath)) { console.warn(`SKIPPED ${pageDef.source}/${lang}: no ${dictPath}`); continue; }
      const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
      const $ = cheerio.load(srcHtml, { decodeEntities: false });
      applyStaticTranslations($, dict, pageDef.metaNs, pageDef.i18nMode);
      rewriteHreflangAndCanonical($, lang, pageDef.outFile);
      rewriteResourcePaths($);
      if (pageDef.i18nMode === 'standalone') rewriteHomepageBackLinks($, lang);
      rewriteLegalLinks($, lang);
      if (pkgScript) prerenderPackageGrid($, pkgScript.src, dict.static, pkgScript.i18nEn, dict.dynamic);
      if (pageDef.source === 'vilu-website.html' && homepagePackages && homepageI18nEn) {
        const hpGrid = $('#hp-grid');
        if (hpGrid.length) hpGrid.html(renderHomepagePackageFallback(homepagePackages, dict.static, homepageI18nEn, dict.dynamic));
      }
      $('#cur-yr').text(CURRENT_YEAR);
      $('html').attr('lang', lang);
      $('html').attr('dir', RTL_LANGS[lang] ? 'rtl' : 'ltr');
      const outDir = path.join('.', lang);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, pageDef.outFile), $.html());
      totalGenerated++;
    }
    console.log(`Generated ${pageDef.source} -> /{lang}/${pageDef.outFile}`);

    // English itself also needs its #cur-yr copyright-year marker updated —
    // it's set client-side for everyone (including English) as a fallback,
    // but crawlers and non-JS clients should see the correct year directly
    // in raw HTML. Surgical regex replace, not a cheerio full-document
    // rewrite, for the same reason as the #pkg-grid self-update below.
    // Exactly one marker is expected per page; zero or multiple means the
    // content is ambiguous, so we warn and skip rather than guess.
    {
      const yearMarkerRe = /(<span id="cur-yr">)\d{4}(<\/span>)/g;
      const yearMatches = srcHtml.match(yearMarkerRe) || [];
      if (yearMatches.length === 0) {
        console.warn(`WARNING: no #cur-yr marker found in ${pageDef.source} — skipping English self-update, check manually`);
      } else if (yearMatches.length > 1) {
        console.warn(`WARNING: multiple #cur-yr markers found in ${pageDef.source} — skipping English self-update, check manually`);
      } else {
        const updatedYearHtml = srcHtml.replace(yearMarkerRe, `$1${CURRENT_YEAR}$2`);
        if (updatedYearHtml !== srcHtml) {
          fs.writeFileSync(pageDef.source, updatedYearHtml);
          console.log(`Updated #cur-yr in English source: ${pageDef.source} (surgical replace, rest of file untouched)`);
        }
      }
    }

    // English itself also needs its #pkg-grid pre-rendered (the audit found
    // it empty in raw HTML too, since it's JS-populated for everyone,
    // English included). Only the grid's INNER content is touched here —
    // done as a surgical string replace, not a cheerio full-document
    // rewrite, so nothing else in this hand-maintained source file's
    // formatting shifts (cheerio's serializer otherwise collapses
    // whitespace between tags, entity-encodes raw & in attributes, and adds
    // ="" to boolean attributes like `crossorigin` — all harmless to a
    // browser, but needless diff noise on a file real people read and
    // hand-edit).
    //
    // findDivInnerSpan() below locates the div's boundaries by scanning the
    // RAW text directly (tracking <div>/</div> nesting depth), rather than
    // by re-serializing through cheerio and string-matching the result
    // against the original bytes. That round-trip approach was tried first
    // and failed: the div's own opening tag can legitimately carry extra
    // attributes (e.g. a `style` added by later visual work) that a fresh
    // cheerio render of a bare `<div id="pkg-grid" class="pkg-grid">`
    // template never reproduces, so the two serializations never matched
    // even when the actual package content was logically in sync — this
    // was the confirmed root cause of the stale-grid warning persisting
    // across every previous build. Scanning raw text for the CURRENT div's
    // exact span, and replacing only what's between its real opening and
    // closing tags, is immune to that: the file's own opening/closing tags
    // (and any attributes on them) are left completely untouched, and only
    // the package-card markup inside is ever replaced.
    function findDivInnerSpan(html, idAttr) {
      const openTagRe = new RegExp(`<div[^>]*\\bid=["']${idAttr}["'][^>]*>`, 'i');
      const openMatch = openTagRe.exec(html);
      if (!openMatch) return null;
      const innerStart = openMatch.index + openMatch[0].length;
      const tagRe = /<div\b|<\/div>/gi;
      tagRe.lastIndex = innerStart;
      let depth = 1;
      let m;
      while ((m = tagRe.exec(html))) {
        if (m[0].toLowerCase() === '</div>') {
          depth--;
          if (depth === 0) {
            return { openTag: openMatch[0], innerStart, innerEnd: m.index, closeTag: m[0] };
          }
        } else {
          depth++;
        }
      }
      return null; // malformed / no matching close tag found
    }

    if (pkgScript) {
      // Phase 12C-B: three containers now (Full Collection, Featured
      // Journeys, Duration Guide), rendered together by one
      // renderDynamicContent() call. Each div is updated against the
      // CURRENT (possibly already-updated-this-pass) working copy of the
      // source text, not the original snapshot — inserting real content
      // into an earlier div shifts every byte position after it, so a
      // later span computed from a stale copy would corrupt the file.
      const capturedEn = renderPackageGridHtml(pkgScript.src, pkgScript.i18nEn, pkgScript.i18nEn, undefined);
      let workingHtml = srcHtml;
      let anyChanged = false;
      for (const id of ['pkg-grid', 'pkg-featured', 'pkg-duration']) {
        const renderedInner = (capturedEn[id] || '').trim();
        const span = findDivInnerSpan(workingHtml, id);
        if (!span) {
          console.warn(`WARNING: could not locate a well-formed #${id} div in ${pageDef.source} — skipping English self-update for it, check manually`);
          continue;
        }
        const currentInner = workingHtml.slice(span.innerStart, span.innerEnd);
        if (currentInner.trim() === renderedInner) continue; // already in sync
        workingHtml = workingHtml.slice(0, span.innerStart) + renderedInner + workingHtml.slice(span.innerEnd);
        anyChanged = true;
        console.log(`Pre-rendered #${id} in English source: ${pageDef.source} (surgical replace, rest of file untouched)`);
      }
      if (anyChanged) {
        fs.writeFileSync(pageDef.source, workingHtml);
        // Nothing later in this pageDef's own iteration reads srcHtml again
        // (the #hp-grid block below is scoped to vilu-website.html's
        // separate iteration) -- srcHtml itself is `const` and intentionally
        // left untouched here.
      }
    }

    // Same surgical self-update, for the homepage's #hp-grid no-JS fallback
    // (Phase 12B-E2D). English also gets nothing but a static "Loading
    // packages…" placeholder pre-JS -- this closes that gap for / exactly
    // as the block above already does for holiday-packages.html.
    if (pageDef.source === 'vilu-website.html' && homepagePackages && homepageI18nEn) {
      const renderedInner = renderHomepagePackageFallback(homepagePackages, homepageI18nEn, homepageI18nEn, undefined).trim();
      const span = findDivInnerSpan(srcHtml, 'hp-grid');
      if (!span) {
        console.warn(`WARNING: could not locate a well-formed #hp-grid div in ${pageDef.source} — skipping English self-update, check manually`);
      } else {
        const currentInner = srcHtml.slice(span.innerStart, span.innerEnd);
        if (currentInner.trim() === renderedInner) {
          // Already in sync -- no write, no console noise on every build.
        } else {
          const updatedSrcHtml = srcHtml.slice(0, span.innerStart) + renderedInner + srcHtml.slice(span.innerEnd);
          fs.writeFileSync(pageDef.source, updatedSrcHtml);
          console.log(`Pre-rendered #hp-grid in English source: ${pageDef.source} (surgical replace, rest of file untouched)`);
        }
      }
    }
  }
  console.log(`\nDone: ${totalGenerated}/${PAGES.length * LANGS.length} files generated.`);
  updateSitemapImages(imagesBySource);
  updateSitemapLastmod();
}

if (require.main === module) {
  main();
}

module.exports = {
  PAGES,
  SITEMAP_PAGE_SOURCE,
  SITEMAP_PAGE_DEF,
  parseSitemapLoc,
  maxDateStr,
  gitLastCommitDate,
  extractNamespaces,
  namespacesForPage,
  computeKeyLastChanged,
  getLangJsonSnapshots,
  keyLastChangedForLang,
  computeSitemapLastmod,
  getPath,
  applyStaticTranslations,
};
