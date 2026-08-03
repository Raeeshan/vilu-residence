const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const vm = require('vm');
const { execSync } = require('child_process');

const SITE_ROOT = 'https://viluresidence.net';
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

function computeSitemapLastmod(loc) {
  const { page, lang } = parseSitemapLoc(loc);
  const sourceFile = SITEMAP_PAGE_SOURCE[page];
  if (sourceFile === undefined) return null;
  const pageDate = gitLastCommitDate(sourceFile);
  if (!lang) return pageDate;
  const i18nDate = gitLastCommitDate(`i18n/${lang}.json`);
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
    const withoutOld = block.replace(/\n {4}<lastmod>[^<]*<\/lastmod>/, '');
    const newBlock = withoutOld.replace('</loc>', `</loc>\n    <lastmod>${lastmod}</lastmod>`);
    if (newBlock !== block) { content = content.replace(block, newBlock); updated++; }
  }
  fs.writeFileSync(sitemapPath, content);
  console.log(`sitemap.xml: <lastmod> refreshed on ${updated}/${urlBlocks.length} url blocks.`);
}

function main() {
  let totalGenerated = 0;
  for (const pageDef of PAGES) {
    if (!fs.existsSync(pageDef.source)) { console.warn(`SKIPPED ${pageDef.source}: not found`); continue; }
    const srcHtml = fs.readFileSync(pageDef.source, 'utf8');

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
  updateSitemapLastmod();
}

main();
