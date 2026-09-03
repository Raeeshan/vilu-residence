/* ══════════════════════════════════════════════════════════════
   VILU ANALYTICS — Phase 11C
   One consent-gated trackEvent() API shared by the homepage and all
   standalone pages, replacing the two previously-duplicated
   implementations (vilu-website.html's inline copy and
   shared-page-i18n.js's copy).

   Deliberately contains NO translation/rendering globals -- no `t`,
   `currentLang` (only ever READS the page's own global, never
   declares/owns it), `applyTranslations`, `detectInitialLang`, or
   `setLanguage` -- so it can load on the homepage without colliding
   with vilu-website.html's own independent versions of all five
   (confirmed by direct audit, Phase 11C-A). Load this file BEFORE
   shared-page-i18n.js (and before vilu-website.html's own inline
   script) on every page.

   Never loads GA4 (consent.js owns that), never touches consent
   state, never queues or replays pre-consent events -- a call made
   before Analytics consent is granted is simply dropped, every time.
   ══════════════════════════════════════════════════════════════ */
(function(){

  // ── canonical package analytics-ID mapping (Phase 11C-A §4 / 11C-B §2) ──
  // Locked, hand-authored -- deliberately NOT derived from Firestore
  // document IDs, which are not guaranteed to match holiday-packages.html's
  // static PACKAGES array slugs. Keyed on the package display name, the one
  // field guaranteed identical (and locked/unchangeable) across both the
  // homepage's live Firestore source and the static page. No Firestore
  // read or write happens here -- this is a pure, static lookup table.
  var PACKAGE_NAME_TO_ID = {
    'Island Explorer Getaway': 'island-explorer-getaway',
    'Reef & Sunset Adventure': 'reef-sunset-adventure',
    'Island Serenity Escape': 'island-serenity-escape',
    'Maldives Dream Bliss': 'maldives-dream-bliss',
    'Ultimate Island Relaxation': 'ultimate-island-relaxation',
    'Grand Maldives Escape': 'grand-maldives-escape',
    'Ultimate Maldives Odyssey': 'ultimate-maldives-odyssey',
    'Ultimate Resort & Island Odyssey': 'ultimate-resort-island-odyssey',
    'Honeymoon Dream Escape': 'honeymoon-dream-escape'
  };

  // Collapses/trims incidental whitespace before lookup so formatting
  // noise alone never triggers the unmapped-* fallback below.
  function normalizePackageName(name){
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  // Resolves a package's canonical analytics ID from its display name.
  // Never guesses: a name outside the locked nine falls back to a visibly
  // distinct 'unmapped-<id>' identifier (id = some existing non-PII
  // internal id already available at the call site, e.g. a Firestore doc
  // id or a static slug) rather than silently misattributing the event to
  // the wrong package or inventing a new mapping on the fly.
  function resolvePackageId(name, id){
    var hit = PACKAGE_NAME_TO_ID[normalizePackageName(name)];
    if (hit) return hit;
    return 'unmapped-' + (id || 'unknown');
  }

  // ── transient, click-triggered guide -> package handoff (Phase 11C-A §6 / 11C-B §3) ──
  // Written ONLY when a guide page's own outbound package link is
  // clicked -- never merely because a guide page was viewed. Consumed
  // (read once, then cleared from sessionStorage) by the very next page
  // load, so an unrelated later visit to a package page never inherits
  // stale guide context. The consumed value is cached in this module's
  // own in-memory state for the rest of THAT page's lifetime, so multiple
  // package interactions on the same destination page load can all still
  // carry it -- but a subsequent full page navigation starts clean again
  // unless another explicit guide-link click sets it afresh.
  // Deliberately transient/session-scoped, not durable or cross-session --
  // durable source/referrer/UTM attribution belongs to Phase 11D.
  var GUIDE_HANDOFF_KEY = 'vilu_guide_handoff';
  var _consumedGuideSlug; // undefined = not yet consumed on this page load

  function setGuideHandoff(guideSlug){
    if (!guideSlug) return;
    try { sessionStorage.setItem(GUIDE_HANDOFF_KEY, guideSlug); } catch(e) {}
  }

  function consumeGuideHandoff(){
    if (_consumedGuideSlug !== undefined) return _consumedGuideSlug;
    try {
      var v = sessionStorage.getItem(GUIDE_HANDOFF_KEY);
      sessionStorage.removeItem(GUIDE_HANDOFF_KEY);
      _consumedGuideSlug = v || null;
    } catch(e) { _consumedGuideSlug = null; }
    return _consumedGuideSlug;
  }

  // ── common parameters, attached to every event ──
  // site_language reflects the VISITOR'S CHOSEN SITE LANGUAGE (the page's
  // own `currentLang`, maintained entirely by vilu-website.html's or
  // shared-page-i18n.js's own i18n code -- this file only reads it, never
  // declares or assigns it), not the browser/device language GA4 already
  // collects automatically. page_type/page_slug come from data-* attributes
  // on <body>, set once per template.
  function commonParams(){
    var body = document.body;
    return {
      site_language: (typeof currentLang === 'string' && currentLang) ? currentLang : 'en',
      page_type: (body && body.getAttribute('data-page-type')) || 'guide',
      page_slug: (body && body.getAttribute('data-page-slug')) || ''
    };
  }

  // ── core tracking API ──
  // Phase 11B rule, unchanged: never transmit to GA4 without Analytics
  // consent, checked here (not just via Google's own Consent Mode
  // signals) so a pre-consent call is discarded outright, never queued
  // for later replay. consent.js remains the only place consent state is
  // read/written/decided.
  function trackEvent(name, data){
    try {
      var payload = Object.assign({}, commonParams(), data || {});
      if (typeof gtag === 'function' && window.viluConsent && window.viluConsent.isAnalyticsAllowed()) {
        gtag('event', name, payload);
      }
      console.log('[track]', name, payload);
    } catch(e) {}
  }

  window.trackEvent = trackEvent;
  window.viluAnalytics = {
    resolvePackageId: resolvePackageId,
    setGuideHandoff: setGuideHandoff,
    consumeGuideHandoff: consumeGuideHandoff
  };

})();
