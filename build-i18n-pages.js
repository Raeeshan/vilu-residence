/* ══════════════════════════════════════════════════════════════
   BUILD STEP — generates real, crawler-visible static HTML for every
   non-English language at /{lang}/index.html.

   WHY THIS EXISTS: vilu-website.html translates client-side via JS.
   Google's fast-pass crawl doesn't run JS, so every non-English URL
   was serving byte-identical English HTML to crawlers — this script
   fixes that by baking each language's translated text directly into
   its own static file.

   SOURCE OF TRUTH: vilu-website.html (English) is the only file a
   human should ever hand-edit. Every /{lang}/index.html file below is
   a GENERATED ARTIFACT — re-run this script after any content change
   or translation update, ideally as an automatic step before every
   deploy, not a manual one-off. A stale generated file will silently
   drift out of sync with the real site, the exact failure mode this
   project has already hit twice with hand-maintained duplicate markup
   (see the room-dropdown bug history).

   WHAT THIS DOES NOT DO: it does not prerender Firestore-sourced
   dynamic content (live packages, room availability, pricing) — that
   remains client-JS-rendered for every language, same as it already
   is for English today. This script only fixes the specific reported
   problem (non-English pages showing English text to crawlers), not
   overall JS-dependency of dynamic content, which was never in scope.

   Run: node build-i18n-pages.js
   ══════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SITE_ROOT = 'https://viluresidence.web.app';
const SOURCE_FILE = 'vilu-website.html';
const LANGS = ['zh', 'ru', 'de', 'it', 'fr', 'ar', 'ja', 'ko', 'sk', 'cs']; // non-English
const RTL_LANGS = { ar: true };

// Attributes that can carry a local resource path needing a root-absolute
// rewrite, since generated files live one directory deeper than the source.
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

// True if a resource-attribute value is a bare relative path (needs a
// leading "/") rather than a fragment, absolute URL, or non-http scheme.
function needsAbsolute(val) {
  if (!val) return false;
  return !/^(\/|#|https?:\/\/|\/\/|mailto:|tel:|data:|javascript:)/i.test(val);
}

function rewriteResourcePaths($) {
  $('*').each(function () {
    const el = $(this);
    for (const attr of RESOURCE_ATTRS) {
      const val = el.attr(attr);
      if (val === undefined) continue;
      if (attr === 'srcset') {
        const rewritten = val
          .split(',')
          .map((part) => {
            const trimmed = part.trim();
            const spaceIdx = trimmed.indexOf(' ');
            const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
            const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
            return (needsAbsolute(url) ? '/' + url : url) + descriptor;
          })
          .join(', ');
        el.attr(attr, rewritten);
      } else if (needsAbsolute(val)) {
        el.attr(attr, '/' + val);
      }
    }
  });
}

function rewriteHreflangAndCanonical($, lang) {
  $('link[rel="alternate"][hreflang]').each(function () {
    const code = $(this).attr('hreflang');
    if (code === 'x-default') { $(this).attr('href', SITE_ROOT + '/'); return; }
    $(this).attr('href', code === 'en' ? SITE_ROOT + '/' : SITE_ROOT + '/' + code + '/');
  });
  const canonical = $('#canonical-link');
  if (canonical.length) canonical.attr('href', SITE_ROOT + '/' + lang + '/');
}

function applyStaticTranslations($, dict) {
  $('[data-i18n]').each(function () {
    const val = getPath(dict.static, $(this).attr('data-i18n'));
    if (val !== undefined) $(this).text(val);
  });
  $('[data-i18n-html]').each(function () {
    const val = getPath(dict.static, $(this).attr('data-i18n-html'));
    if (val !== undefined) $(this).html(val);
  });
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
  const seoTitle = getPath(dict.static, 'seo.title');
  if (seoTitle !== undefined) $('title').text(seoTitle);
  const seoDesc = getPath(dict.static, 'seo.description');
  if (seoDesc !== undefined) $('meta[name="description"]').attr('content', seoDesc);
}

function main() {
  const srcHtml = fs.readFileSync(SOURCE_FILE, 'utf8');
  let generated = 0;
  for (const lang of LANGS) {
    const dictPath = `i18n/${lang}.json`;
    if (!fs.existsSync(dictPath)) {
      console.warn(`SKIPPED ${lang}: no ${dictPath} found`);
      continue;
    }
    const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    const $ = cheerio.load(srcHtml, { decodeEntities: false });

    applyStaticTranslations($, dict);
    rewriteHreflangAndCanonical($, lang);
    rewriteResourcePaths($);
    $('html').attr('lang', lang);
    $('html').attr('dir', RTL_LANGS[lang] ? 'rtl' : 'ltr');

    const outDir = path.join('.', lang);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), $.html());
    console.log(`Generated ${lang}/index.html`);
    generated++;
  }
  console.log(`\nDone: ${generated}/${LANGS.length} language pages generated.`);
}

main();
