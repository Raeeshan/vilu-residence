/* ══════════════════════════════════════════════════════════════
   SHARED I18N ENGINE for standalone SEO/Ads content pages.
   Mirrors vilu-website.html's client-side i18n exactly (same
   i18n/{lang}.json files, same data-i18n attribute contract) so
   language switching behaves identically across the whole site.
   Each page defines its own `var I18N = {en: {...}}` BEFORE this
   script runs, then calls initPage() on DOMContentLoaded.
   ══════════════════════════════════════════════════════════════ */
var LANG_NAMES = {en:"English",zh:"中文",ru:"Русский",de:"Deutsch",it:"Italiano",fr:"Français",ar:"العربية",ja:"日本語",ko:"한국어",sk:"Slovenčina",cs:"Čeština"};
var RTL_LANGS = {ar:true};
var currentLang = 'en';

function t(key){
  var parts = key.split('.');
  var dict = I18N[currentLang] || I18N.en;
  var fallback = I18N.en;
  var node = dict, fbNode = fallback;
  for (var i=0;i<parts.length;i++){
    node = node ? node[parts[i]] : undefined;
    fbNode = fbNode ? fbNode[parts[i]] : undefined;
  }
  return (node !== undefined ? node : fbNode);
}
function tf(key, vars){
  var s = t(key) || '';
  if (vars) Object.keys(vars).forEach(function(k){ s = s.replace('{'+k+'}', vars[k]); });
  return s;
}
function applyTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(function(el){
    var val = t(el.getAttribute('data-i18n'));
    if (val !== undefined) el.innerHTML = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){
    var val = t(el.getAttribute('data-i18n-placeholder'));
    if (val !== undefined) el.setAttribute('placeholder', val);
  });
  document.querySelectorAll('[data-i18n-alt]').forEach(function(el){
    var val = t(el.getAttribute('data-i18n-alt'));
    if (val !== undefined) el.setAttribute('alt', val);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(function(el){
    var val = t(el.getAttribute('data-i18n-aria-label'));
    if (val !== undefined) el.setAttribute('aria-label', val);
  });
  // Uses PAGE_META_NS (set by each page before this script loads) rather than
  // the shared "seo" namespace — that key already exists in i18n/{lang}.json
  // holding the HOMEPAGE's own title/description, and would otherwise get
  // pulled in and clobber this page's title the moment a language loads.
  var metaNs = (typeof PAGE_META_NS !== 'undefined') ? PAGE_META_NS : null;
  if (metaNs) {
    var seoTitle = t(metaNs + '.title'); if (seoTitle !== undefined) document.title = seoTitle;
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) { var d = t(metaNs + '.description'); if (d !== undefined) metaDesc.setAttribute('content', d); }
  }
  document.documentElement.setAttribute('lang', currentLang);
  document.documentElement.setAttribute('dir', RTL_LANGS[currentLang] ? 'rtl' : 'ltr');
  document.querySelectorAll('.lang-switcher select').forEach(function(sel){ sel.value = currentLang; });
  // Update this-page-only canonical/hreflang self-reference to reflect the active language.
  var canonical = document.getElementById('canonical-link');
  if (canonical) {
    var base = canonical.getAttribute('data-base-url');
    if (base) {
      if (currentLang === 'en') {
        canonical.setAttribute('href', base);
      } else {
        var u = new URL(base);
        u.pathname = '/' + currentLang + u.pathname;
        canonical.setAttribute('href', u.href);
      }
    }
  }
}

// td(): looks up an English source string (as typed by admins into the PMS —
// package names/descriptions/inclusions) in the DYNAMIC_I18N map, same
// mechanism vilu-website.html uses for Firestore-sourced content. Falls back
// to the English original if a translator hasn't covered that exact string.
var DYNAMIC_I18N = {};
function td(str){
  if (!str) return str;
  var dict = DYNAMIC_I18N[currentLang];
  if (!dict) return str;
  var hit = dict[str];
  return hit !== undefined ? hit : str;
}

var _loadedLangs = {en: true};
async function loadLanguageData(lang){
  if (_loadedLangs[lang]) return;
  var res = await fetch('/i18n/' + lang + '.json');
  if (!res.ok) throw new Error('Failed to load language: ' + lang);
  var data = await res.json();
  Object.keys(data.static || {}).forEach(function(ns){
    if (!I18N[lang]) I18N[lang] = {};
    I18N[lang][ns] = data.static[ns];
  });
  DYNAMIC_I18N[lang] = data.dynamic || {};
  _loadedLangs[lang] = true;
}

function detectInitialLang(){
  try {
    var seg = window.location.pathname.split('/').filter(Boolean)[0];
    if (seg && LANG_NAMES[seg]) return seg;
    var url = new URL(window.location.href);
    var q = url.searchParams.get('lang');
    if (q && LANG_NAMES[q]) return q;
    var stored = localStorage.getItem('vilu_lang');
    if (stored && LANG_NAMES[stored]) return stored;
  } catch(e) {}
  return 'en';
}

async function setLanguage(lang, opts){
  if (!LANG_NAMES[lang]) lang = 'en';
  try { await loadLanguageData(lang); } catch(e) { lang = 'en'; }
  currentLang = lang;
  try { localStorage.setItem('vilu_lang', lang); } catch(e) {}
  try {
    var canonical = document.getElementById('canonical-link');
    var base = canonical ? canonical.getAttribute('data-base-url') : null;
    if (base) {
      var u = new URL(base);
      if (lang !== 'en') u.pathname = '/' + lang + u.pathname;
      window.history.replaceState({}, '', u.pathname + window.location.hash);
    }
  } catch(e) {}
  applyTranslations();
  if (typeof renderDynamicContent === 'function') renderDynamicContent();
}

function initLangSwitcher(){
  var langOptions = Object.keys(LANG_NAMES).map(function(code){ return '<option value="'+code+'">'+LANG_NAMES[code]+'</option>'; }).join('');
  document.querySelectorAll('.lang-switcher').forEach(function(mount){
    mount.innerHTML = '<i class="ti ti-world" aria-hidden="true"></i><select aria-label="Language">'+langOptions+'</select>';
    mount.querySelector('select').addEventListener('change', function(e){ setLanguage(e.target.value); });
  });
}

function initReveal(){
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(function(el){ el.classList.add('visible'); });
    return;
  }
  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    });
  }, {threshold:.15});
  document.querySelectorAll('.reveal').forEach(function(el){ observer.observe(el); });
}

async function initPage(){
  var initial = detectInitialLang();
  initLangSwitcher();
  currentLang = 'en';
  applyTranslations();
  if (initial !== 'en') {
    try { await loadLanguageData(initial); currentLang = initial; } catch(e) { currentLang = 'en'; }
    applyTranslations();
  }
  if (typeof renderDynamicContent === 'function') renderDynamicContent();
  initReveal();
}
document.addEventListener('DOMContentLoaded', initPage);
