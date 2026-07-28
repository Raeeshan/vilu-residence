const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SITE_ROOT = 'https://viluresidence.web.app';
const LANGS = ['zh', 'ru', 'de', 'it', 'fr', 'ar', 'ja', 'ko', 'sk', 'cs'];
const RTL_LANGS = { ar: true };

const PAGES = [
  { source: 'vilu-website.html', outFile: 'index.html', metaNs: 'seo', i18nMode: 'homepage' },
  { source: 'whale-shark-snorkeling.html', outFile: 'whale-shark-snorkeling.html', metaNs: 'wsMeta', i18nMode: 'standalone' },
  { source: 'manta-ray-snorkeling.html', outFile: 'manta-ray-snorkeling.html', metaNs: 'mrMeta', i18nMode: 'standalone' },
  { source: 'south-ari-atoll-guide.html', outFile: 'south-ari-atoll-guide.html', metaNs: 'saaMeta', i18nMode: 'standalone' },
  { source: 'holiday-packages.html', outFile: 'holiday-packages.html', metaNs: 'hpMeta', i18nMode: 'standalone' },
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

function main() {
  let totalGenerated = 0;
  for (const pageDef of PAGES) {
    if (!fs.existsSync(pageDef.source)) { console.warn(`SKIPPED ${pageDef.source}: not found`); continue; }
    const srcHtml = fs.readFileSync(pageDef.source, 'utf8');
    for (const lang of LANGS) {
      const dictPath = `i18n/${lang}.json`;
      if (!fs.existsSync(dictPath)) { console.warn(`SKIPPED ${pageDef.source}/${lang}: no ${dictPath}`); continue; }
      const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
      const $ = cheerio.load(srcHtml, { decodeEntities: false });
      applyStaticTranslations($, dict, pageDef.metaNs, pageDef.i18nMode);
      rewriteHreflangAndCanonical($, lang, pageDef.outFile);
      rewriteResourcePaths($);
      if (pageDef.i18nMode === 'standalone') rewriteHomepageBackLinks($, lang);
      $('html').attr('lang', lang);
      $('html').attr('dir', RTL_LANGS[lang] ? 'rtl' : 'ltr');
      const outDir = path.join('.', lang);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, pageDef.outFile), $.html());
      totalGenerated++;
    }
    console.log(`Generated ${pageDef.source} -> /{lang}/${pageDef.outFile}`);
  }
  console.log(`\nDone: ${totalGenerated}/${PAGES.length * LANGS.length} files generated.`);
}

main();
