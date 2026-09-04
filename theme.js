/* ══════════════════════════════════════════════════════════════
   VILU THEME STATE — Phase 12B-C
   Cinematic Dark / Island Luxury Light. Loaded synchronously in <head>
   right after consent.js so the correct theme is on <html> before the
   first paint (no flash of the wrong theme). ~2 KB, no dependencies.

   Contract:
     <html data-theme="dark|light">     only these two values are ever applied
     first-ever visit                   Cinematic Dark (the OS colour-scheme
                                        preference is deliberately NOT consulted)
     storage key                        vilu_theme  (valid values: dark | light)
     persistence                        Preferences consent granted  → localStorage
                                        otherwise                     → sessionStorage only
   Preferences status is read through consent.js's public API
   (window.viluConsent.get().categories.preferences) with a read-only
   fallback to the vilu_consent record. Nothing here loads GA, calls gtag,
   or writes any consent state. No analytics event is emitted.
   ══════════════════════════════════════════════════════════════ */
(function(){
  var KEY = 'vilu_theme';
  var DEFAULT_THEME = 'dark';
  var VALID = { dark: true, light: true };
  var root = document.documentElement;

  function isValid(v){ return typeof v === 'string' && VALID[v] === true; }

  // Preferences consent: strict Boolean true only (mirrors consent.js).
  function preferencesAllowed(){
    try {
      if (window.viluConsent && typeof window.viluConsent.get === 'function') {
        var c = window.viluConsent.get();
        return !!(c && c.categories && c.categories.preferences === true);
      }
      var raw = localStorage.getItem('vilu_consent');
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      return !!(parsed && parsed.version === 1 && parsed.categories && parsed.categories.preferences === true);
    } catch (e) { return false; }
  }

  function readStored(){
    var v = null;
    try { v = sessionStorage.getItem(KEY); } catch (e) {}
    if (isValid(v)) return v;
    try {
      var stored = localStorage.getItem(KEY);
      if (stored === null) return null;
      if (isValid(stored) && preferencesAllowed()) return stored;
      // Invalid value, or a persisted choice that consent no longer covers:
      // drop it rather than honour it.
      localStorage.removeItem(KEY);
    } catch (e) {}
    return null;
  }

  function persist(theme){
    try { sessionStorage.setItem(KEY, theme); } catch (e) {}
    try {
      if (preferencesAllowed()) localStorage.setItem(KEY, theme);
      else localStorage.removeItem(KEY);
    } catch (e) {}
  }

  var current = readStored() || DEFAULT_THEME;
  root.setAttribute('data-theme', current);   // before first paint

  function apply(theme, opts){
    if (!isValid(theme)) return current;
    current = theme;
    root.setAttribute('data-theme', theme);
    if (!(opts && opts.silent)) persist(theme);
    updateSwitches();
    try { document.dispatchEvent(new CustomEvent('vilu:themechange', { detail: { theme: theme } })); } catch (e) {}
    return current;
  }

  // ── Switch component (sun/moon, self-hosted inline SVG from Tabler Icons) ──
  var SUN = '<svg class="ts-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/></svg>';
  var MOON = '<svg class="ts-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/></svg>';
  var LABEL_LIGHT = 'Island Luxury Light theme';

  function makeSwitch(withText){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-switch';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', LABEL_LIGHT);
    b.setAttribute('data-theme-switch', '');
    b.innerHTML = MOON + SUN + (withText ? '<span class="ts-text"></span>' : '');
    b.addEventListener('click', function(){ apply(current === 'dark' ? 'light' : 'dark'); });
    return b;
  }

  function updateSwitches(){
    var isLight = current === 'light';
    var list = document.querySelectorAll('[data-theme-switch]');
    for (var i = 0; i < list.length; i++) {
      list[i].setAttribute('aria-checked', isLight ? 'true' : 'false');
      list[i].setAttribute('title', isLight ? 'Switch to Cinematic Dark' : 'Switch to Island Luxury Light');
      var t = list[i].querySelector('.ts-text');
      if (t) t.textContent = isLight ? 'Island Luxury Light' : 'Cinematic Dark';   // names the CURRENT theme, matching the icon and aria-checked
    }
  }

  function mount(){
    var right = document.querySelector('.nav-right');
    var lang = right ? right.querySelector('.lang-switcher') : null;
    if (right && !right.querySelector('[data-theme-switch]')) right.insertBefore(makeSwitch(false), lang || right.firstChild);
    var mobileRight = document.querySelector('.nav-mobile-right');
    var burger = mobileRight ? mobileRight.querySelector('.nav-hamburger') : null;
    if (mobileRight && !mobileRight.querySelector('[data-theme-switch]')) mobileRight.insertBefore(makeSwitch(false), burger);
    var mmLang = document.querySelector('.mm-lang');
    if (mmLang && !mmLang.querySelector('[data-theme-switch]')) mmLang.insertBefore(makeSwitch(true), mmLang.firstChild);
    updateSwitches();

    // Re-evaluate persistence after a consent decision (Accept / Reject / Save):
    // consent.js's own handlers run first on the element; this bubbling
    // listener then re-syncs vilu_theme with the new Preferences status.
    document.addEventListener('click', function(e){
      var t = e.target && e.target.closest ? e.target.closest('#consentAccept,#consentReject,#consentSave') : null;
      if (t) setTimeout(function(){ persist(current); }, 0);
    });
  }

  // Follow a change made in another tab (only reaches here if it was persisted, i.e. consented).
  try {
    window.addEventListener('storage', function(e){
      if (e.key === KEY && isValid(e.newValue) && e.newValue !== current) apply(e.newValue, { silent: true });
    });
  } catch (e) {}

  window.viluTheme = {
    get: function(){ return current; },
    set: function(theme){ return apply(theme); },
    toggle: function(){ return apply(current === 'dark' ? 'light' : 'dark'); },
    valid: ['dark', 'light']
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
