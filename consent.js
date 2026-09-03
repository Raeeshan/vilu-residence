/* ══════════════════════════════════════════════════════════════
   VILU CONSENT MANAGER — Phase 11B
   Basic Google Consent Mode: the GA4 script itself is never
   requested from Google's CDN until Analytics consent is granted
   ("nothing loads, nothing is sent" — the defining property of
   Basic mode, verified at the network level, not just via a
   consent-signal variable). Reuses the accessible-dialog / focus-
   trap / Escape / RTL patterns already proven in nav-shell.js.

   Consent record: localStorage key "vilu_consent", versioned.
   {
     version: 1,
     timestamp: ISO string,
     method: "accept_all" | "reject_non_essential" | "customize",
     categories: { essential:true, preferences, analytics, marketing }
   }
   Storing this record is itself Essential — it does not require
   consent to write.

   Language preference (vilu_lang) and the sticky-CTA dismissal
   (hp_sticky_dismissed) remain Essential/functional, per approved
   design — untouched by this file.
   ══════════════════════════════════════════════════════════════ */
(function(){

  var STORAGE_KEY = 'vilu_consent';
  var CONSENT_VERSION = 1;
  var GA_MEASUREMENT_ID = 'G-1EPZ71Q331';

  // Strict Boolean validation: an optional category is granted ONLY when its
  // stored value is the literal Boolean `true`. Anything else -- a string
  // "true", the number 1, an object, undefined -- is treated as denied. This
  // is what keeps a malformed or hand-edited vilu_consent record fail-closed
  // rather than accidentally granting Analytics/Marketing.
  function isTrue(v){ return v === true; }

  function normalizeCategories(categories){
    return {
      essential: true,
      preferences: isTrue(categories && categories.preferences),
      analytics: isTrue(categories && categories.analytics),
      marketing: isTrue(categories && categories.marketing)
    };
  }

  // ── STATE ──
  function readConsent(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== CONSENT_VERSION || !parsed.categories) return null;
      parsed.categories = normalizeCategories(parsed.categories);
      return parsed;
    } catch(e) { return null; }
  }

  function writeConsent(categories, method){
    var record = {
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
      method: method,
      categories: {
        essential: true,
        preferences: !!categories.preferences,
        analytics: !!categories.analytics,
        marketing: !!categories.marketing
      }
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch(e) {}
    return record;
  }

  var stored = readConsent();

  // ── GOOGLE CONSENT MODE SIGNALS ──
  function gcmSignals(categories){
    var analyticsState = categories.analytics ? 'granted' : 'denied';
    var marketingState = categories.marketing ? 'granted' : 'denied';
    return {
      analytics_storage: analyticsState,
      ad_storage: marketingState,
      ad_user_data: marketingState,
      ad_personalization: marketingState
    };
  }

  // Set the default using the ALREADY-KNOWN stored state (if any) so a
  // returning visitor who previously accepted never sees a denied->granted
  // flash. First-time visitors (stored === null) default to fully denied.
  var initialCategories = stored ? stored.categories : {analytics:false, marketing:false};
  gtag('consent', 'default', gcmSignals(initialCategories));

  // ── GA4 LOADING (Basic mode: literally not requested until granted) ──
  var gaLoaded = false;
  function loadGA(){
    if (gaLoaded) return;
    gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID);
  }

  function applyConsent(categories){
    gtag('consent', 'update', gcmSignals(categories));
    if (categories.analytics) loadGA();
  }

  if (stored) applyConsent(stored.categories);

  // Public API consumed by trackEvent() in vilu-website.html and
  // shared-page-i18n.js, and by 404.html's direct gtag call.
  window.viluConsent = {
    get: function(){ return readConsent(); },
    hasDecision: function(){ return !!readConsent(); },
    isAnalyticsAllowed: function(){ var c = readConsent(); return !!(c && c.categories.analytics); }
  };

  // ── UI ──
  var _lastFocused = null;

  function t(key, fallback){
    // Reuses whichever i18n lookup the page already exposes (homepage vs.
    // shared-page-i18n.js both define a global `t(key)` used elsewhere on
    // the same pages) if present; otherwise falls back to the English
    // string already baked into the markup via data-i18n (no-op).
    try {
      if (typeof window.t === 'function') {
        var v = window.t(key);
        if (v) return v;
      }
    } catch(e) {}
    return fallback;
  }

  function showBar(){
    var bar = document.getElementById('consentBar');
    if (bar) bar.hidden = false;
  }
  function hideBar(){
    var bar = document.getElementById('consentBar');
    if (bar) bar.hidden = true;
  }

  function getFocusable(container){
    return Array.prototype.slice.call(container.querySelectorAll(
      'a[href], button:not([disabled]), [role="switch"], [tabindex]:not([tabindex="-1"])'
    )).filter(function(el){ return el.offsetParent !== null; });
  }

  function setToggle(id, on){
    var el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    el.classList.toggle('on', on);
  }
  function getToggle(id){
    var el = document.getElementById(id);
    return el ? el.getAttribute('aria-checked') === 'true' : false;
  }

  function openPanel(prefill){
    var overlay = document.getElementById('consentPanelOverlay');
    var panel = document.getElementById('consentPanel');
    if (!overlay || !panel) return;
    _lastFocused = document.activeElement;
    var current = prefill || (stored ? stored.categories : {preferences:false, analytics:false, marketing:false});
    setToggle('consentTogglePreferences', !!current.preferences);
    setToggle('consentToggleAnalytics', !!current.analytics);
    setToggle('consentToggleMarketing', !!current.marketing);
    overlay.hidden = false;
    var closeBtn = document.getElementById('consentPanelClose');
    if (closeBtn) closeBtn.focus();
  }
  function closePanel(){
    var overlay = document.getElementById('consentPanelOverlay');
    if (!overlay) return;
    overlay.hidden = true;
    if (_lastFocused && typeof _lastFocused.focus === 'function') _lastFocused.focus();
  }

  function decide(categories, method){
    stored = writeConsent(categories, method);
    applyConsent(stored.categories);
    hideBar();
    closePanel();
  }

  function initUI(){
    var acceptBtn = document.getElementById('consentAccept');
    var rejectBtn = document.getElementById('consentReject');
    var customizeOpenBtn = document.getElementById('consentCustomizeOpen');
    var panelCloseBtn = document.getElementById('consentPanelClose');
    var saveBtn = document.getElementById('consentSave');
    var overlay = document.getElementById('consentPanelOverlay');
    var panel = document.getElementById('consentPanel');
    var footerLink = document.getElementById('footerPrivacyChoices');

    if (acceptBtn) acceptBtn.addEventListener('click', function(){
      decide({preferences:true, analytics:true, marketing:true}, 'accept_all');
    });
    if (rejectBtn) rejectBtn.addEventListener('click', function(){
      decide({preferences:false, analytics:false, marketing:false}, 'reject_non_essential');
    });
    if (customizeOpenBtn) customizeOpenBtn.addEventListener('click', function(){
      openPanel(stored ? stored.categories : null);
    });
    if (panelCloseBtn) panelCloseBtn.addEventListener('click', closePanel);
    if (overlay) overlay.addEventListener('click', function(e){
      if (e.target === overlay) closePanel();
    });
    if (saveBtn) saveBtn.addEventListener('click', function(){
      decide({
        preferences: getToggle('consentTogglePreferences'),
        analytics: getToggle('consentToggleAnalytics'),
        marketing: getToggle('consentToggleMarketing')
      }, 'customize');
    });
    if (footerLink) footerLink.addEventListener('click', function(){
      openPanel(stored ? stored.categories : {preferences:false, analytics:false, marketing:false});
    });

    ['consentTogglePreferences','consentToggleAnalytics','consentToggleMarketing'].forEach(function(id){
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', function(){
        setToggle(id, el.getAttribute('aria-checked') !== 'true');
      });
    });

    document.addEventListener('keydown', function(e){
      if (e.key !== 'Escape') return;
      if (overlay && !overlay.hidden) { closePanel(); return; }
    });
    document.addEventListener('keydown', function(e){
      if (e.key !== 'Tab') return;
      if (!overlay || overlay.hidden || !panel) return;
      var focusable = getFocusable(panel);
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    if (!stored) showBar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
