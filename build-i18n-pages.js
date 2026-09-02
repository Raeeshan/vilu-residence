const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const vm = require('vm');
const { execSync } = require('child_process');

const SITE_ROOT = 'https://viluresidence.net';
const IMAGE_SITEMAP_NS = 'http://www.google.com/schemas/sitemap-image/1.1';
const LANGS = ['zh', 'ru', 'de', 'it', 'fr', 'ar', 'ja', 'ko', 'sk', 'cs'];
const RTL_LANGS = { ar: true };

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
// into #pkg-grid.
function renderPackageGridHtml(mainScriptSrc, dict, i18nEn, dynamicDict) {
  var capturedHtml = '';
  var mockGrid = {
    set innerHTML(val) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
  };
  var sandbox = {
    document: { getElementById: function (id) { return id === 'pkg-grid' ? mockGrid : null; } },
    t: makeT(dict, i18nEn),
    td: makeTd(dynamicDict),
    tf: null,
    console: console,
  };
  sandbox.tf = makeTf(sandbox.t);
  vm.createContext(sandbox);
  vm.runInContext(mainScriptSrc + '\nrenderDynamicContent();', sandbox, { timeout: 5000 });
  return capturedHtml;
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
  var html = renderPackageGridHtml(mainScriptSrc, dict, i18nEn, dynamicDict);
  var grid = $('#pkg-grid');
  if (grid.length) grid.html(html);
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
const DATA_I18N_ATTR_RE = /data-i18n(?:-html|-placeholder|-alt|-aria-label)?="([^"]+)"/g;
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

    for (const lang of LANGS) {
      const dictPath = `i18n/${lang}.json`;
      if (!fs.existsSync(dictPath)) { console.warn(`SKIPPED ${pageDef.source}/${lang}: no ${dictPath}`); continue; }
      const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
      const $ = cheerio.load(srcHtml, { decodeEntities: false });
      applyStaticTranslations($, dict, pageDef.metaNs, pageDef.i18nMode);
      rewriteHreflangAndCanonical($, lang, pageDef.outFile);
      rewriteResourcePaths($);
      if (pageDef.i18nMode === 'standalone') rewriteHomepageBackLinks($, lang);
      if (pkgScript) prerenderPackageGrid($, pkgScript.src, dict.static, pkgScript.i18nEn, dict.dynamic);
      $('html').attr('lang', lang);
      $('html').attr('dir', RTL_LANGS[lang] ? 'rtl' : 'ltr');
      const outDir = path.join('.', lang);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, pageDef.outFile), $.html());
      totalGenerated++;
    }
    console.log(`Generated ${pageDef.source} -> /{lang}/${pageDef.outFile}`);

    // English itself also needs its #pkg-grid pre-rendered (the audit found
    // it empty in raw HTML too, since it's JS-populated for everyone,
    // English included). Only the grid content is touched here — done as a
    // surgical string replace, not a cheerio full-document rewrite, so
    // nothing else in this hand-maintained source file's formatting shifts
    // (cheerio's serializer otherwise collapses whitespace between tags,
    // entity-encodes raw & in attributes, and adds ="" to boolean
    // attributes like `crossorigin` — all harmless to a browser, but
    // needless diff noise on a file real people read and hand-edit).
    if (pkgScript) {
      const $en = cheerio.load('<div id="pkg-grid" class="pkg-grid"></div>', { decodeEntities: false });
      prerenderPackageGrid($en, pkgScript.src, pkgScript.i18nEn, pkgScript.i18nEn, undefined);
      const renderedDiv = $en.html($en('#pkg-grid')).trim();
      const emptyDiv = '<div id="pkg-grid" class="pkg-grid"></div>';
      if (srcHtml.indexOf(emptyDiv) === -1) {
        console.warn(`WARNING: could not find exact empty #pkg-grid div in ${pageDef.source} to replace — skipping English self-update, check manually`);
      } else if ((srcHtml.match(new RegExp(emptyDiv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length > 1) {
        console.warn(`WARNING: multiple exact matches for empty #pkg-grid div in ${pageDef.source} — skipping English self-update, check manually`);
      } else {
        const updatedSrcHtml = srcHtml.replace(emptyDiv, renderedDiv);
        fs.writeFileSync(pageDef.source, updatedSrcHtml);
        console.log(`Pre-rendered #pkg-grid in English source: ${pageDef.source} (surgical replace, rest of file untouched)`);
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
};
