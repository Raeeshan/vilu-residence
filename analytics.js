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

   Phase 11D-B adds a first-touch-only, first-party attribution store
   (see the section below, "first-party attribution: FIRST-TOUCH ONLY").
   Classification/storage core only -- nothing here is attached to any
   GA4 event payload yet (Phase 11D-C). Reads consent.js's public API
   only (window.viluConsent) and reacts to its existing consent buttons
   from a distance; consent.js itself is untouched.
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

  // ── first-party attribution: FIRST-TOUCH ONLY (Phase 11D-B) ──
  // Answers "what originally brought this visitor in" as a single,
  // versioned, 30-day localStorage record. Deliberately separate from,
  // and never merged with, the guide-handoff mechanism above: acquisition
  // (e.g. google/organic) and content-assist (e.g. maamigili-guide) are
  // different questions and must stay distinguishable on a conversion
  // event -- see Phase 11D-A §9.
  //
  // Classification/storage ONLY in this phase. Nothing here is attached
  // to any GA4 event payload yet -- that is Phase 11D-C, after this core
  // is reviewed. Existing Phase 11C event payloads are byte-for-byte
  // unchanged by this section.
  var ATTR_KEY = 'vilu_attribution';
  var ATTR_VERSION = 1;
  var ATTR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days -- matches a
    // multi-day/multi-week Maldives research journey; see Phase 11D-A §11.
  var ATTR_STR_MAX_LEN = 100; // generous cap for real campaign names
    // ("sep2026_maamigili-whale-shark-promo" survives intact); bounds
    // storage size / injection risk without a destructively narrow
    // charset whitelist. Applies to utm_source, utm_medium, utm_campaign,
    // and referrer_host (Phase 11D-B2 §6).
  var ATTR_SLUG_MAX_LEN = 60; // landing_page_slug -- every real page_slug
    // in this codebase is well under this (the longest today is
    // "south-ari-vs-other-regions", 27 chars); bounds a tampered/oversized
    // value without ever constraining a legitimate one (Phase 11D-B2 §6).

  // Every Firebase Hosting URL this site is actually served from, plus
  // the live custom domain (confirmed via `firebase hosting:sites:list`
  // and the canonical/og:url tags baked into every page at build time).
  // A referrer from any of these is internal navigation, never acquisition.
  var OWN_HOSTNAMES = [
    'viluresidence.net',
    'viluresidence.web.app',
    'viluresidence.firebaseapp.com',
    'vilu-residence.web.app',
    'vilu-residence.firebaseapp.com'
  ];

  // Controlled allow-list of every currently attribution-eligible
  // `data-page-slug` value (Phase 11D-B3 §2) -- derived directly from the
  // real English source files via `grep -oE 'data-page-type="[a-z0-9-]*"
  // data-page-slug="[a-z0-9-]*"' *.html | sort -u`, NOT guessed. 404
  // ("404") and both legal pages ("privacy-policy", "cookies") are
  // deliberately excluded -- computeCandidate() already excludes them by
  // page_type before a slug is ever considered, and this list is the
  // second, independent gate: it also rejects an invented value like
  // "fake-page" or an empty string that a hand-edited localStorage
  // record could otherwise carry, at BOTH capture and read-validation
  // time. Adding a genuinely new landing page later requires adding its
  // slug here too -- an intentional, accepted maintenance cost.
  var ELIGIBLE_LANDING_SLUGS = [
    'home',                            // vilu-website.html (data-page-type="home")
    'holiday-packages',                // holiday-packages.html (data-page-type="package")
    'best-local-islands-snorkeling',   // guide
    'best-time-to-visit',              // guide
    'guesthouse-vs-resort',            // guide
    'maamigili-guide',                 // guide
    'maldives-holiday-cost',           // guide
    'manta-ray-snorkeling',            // guide
    'south-ari-atoll-guide',           // guide
    'south-ari-vs-other-regions',      // guide
    'things-to-do-maamigili',          // guide
    'whale-shark-snorkeling'           // guide
  ];
  function isEligibleLandingSlug(v){
    return typeof v === 'string' && ELIGIBLE_LANDING_SLUGS.indexOf(v) !== -1;
  }

  // Closed, auditable referrer->{source,medium} table -- used ONLY when
  // no utm_source is present (explicit UTMs always take precedence, see
  // computeCandidate below). Anything not matched here falls through to
  // the bounded 'referral'/'referral' pair in classifyReferrer, never an
  // invented per-hostname source value (Phase 11D-A §10 correction).
  var REFERRER_TABLE = [
    { re: /(^|\.)google\.[a-z.]+$/i,  source: 'google',    medium: 'organic' },
    { re: /(^|\.)bing\.com$/i,        source: 'bing',      medium: 'organic' },
    { re: /(^|\.)yandex\.[a-z.]+$/i,  source: 'yandex',    medium: 'organic' },
    { re: /(^|\.)instagram\.com$/i,   source: 'instagram', medium: 'social'  },
    { re: /(^|\.)facebook\.com$/i,    source: 'facebook',  medium: 'social'  },
    { re: /(^|\.)tiktok\.com$/i,      source: 'tiktok',    medium: 'social'  }
  ];

  // Strips control characters and HTML-special characters, collapses
  // whitespace, hard-caps length. Deliberately NOT a narrow charset
  // whitelist -- legitimate campaign names must survive; the goal is
  // bounding size/injection risk, not rejecting real values (Phase
  // 11D-A §9 correction: "avoid destructive sanitization").
  function sanitizeAttrString(v){
    if (v === null || v === undefined) return null;
    try {
      var s = String(v)
        .replace(/[\x00-\x1F\x7F<>"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!s) return null;
      return s.slice(0, ATTR_STR_MAX_LEN);
    } catch(e) { return null; }
  }

  // Deliberately NOT a general-purpose PII detector (Phase 11D-B2 §6 is
  // explicit that one isn't wanted) -- just three narrow, cheap shape
  // checks that catch the specific accidental-misuse cases named: a
  // pasted email address, a pasted full URL where a short campaign token
  // was expected, and a pasted phone number. A real campaign value like
  // "sep2026_maamigili", "paid_social", or "whale-shark-de" matches none
  // of these and passes through untouched.
  function looksLikePII(s){
    if (!s) return false;
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)) return true; // email-shaped
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^www\./i.test(s)) return true; // URL-shaped
    var digitsAndPhonePunctOnly = s.replace(/[\s().+-]/g, '');
    if (/^[0-9]{7,}$/.test(digitsAndPhonePunctOnly)) return true; // phone-shaped:
      // the ENTIRE value, once ordinary phone punctuation is stripped, is
      // nothing but 7+ digits -- a mixed campaign token like
      // "campaign_20260904_promo" never matches this, only something that
      // was basically just a phone number does.
    return false;
  }

  // UTM-specific wrapper: sanitizes, then rejects PII-shaped values by
  // treating them as absent (same fallback path as a missing/empty UTM --
  // Phase 11D-B2 §4/§6). Used ONLY for utm_source/utm_medium/utm_campaign;
  // other fields (referrer_host, landing_page_slug) have their own
  // shape rules validated separately in isValidStoredRecord below.
  function sanitizeUtmValue(v){
    var s = sanitizeAttrString(v);
    if (s && looksLikePII(s)) return null;
    return s;
  }

  function hasControlChars(s){
    return /[\x00-\x1F\x7F]/.test(s);
  }

  // Read-side validator for a stored `source` / `medium` / `campaign`
  // value, applying the EXACT SAME safety rules capture-time already
  // applies via sanitizeUtmValue() -- bounded length, no control-
  // character contamination, not email/URL/phone-shaped (Phase 11D-B3
  // §1). localStorage is client-controlled: a value that would have been
  // rejected or stripped at capture time must also be rejected here, not
  // "cleaned up" and then trusted. A closed-vocabulary value captured
  // legitimately (`google`, `organic`, `instagram`, `paid_social`,
  // `referral`, `none`, `unknown`, or a real campaign like
  // `sep2026_maamigili`) always passes; nothing here narrows what a
  // genuine capture can already produce.
  function isCleanBoundedString(v, maxLen){
    if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) return false;
    if (hasControlChars(v)) return false;
    if (looksLikePII(v)) return false;
    return true;
  }

  function hostnameOf(url){
    try { return new URL(url).hostname.toLowerCase(); } catch(e) { return null; }
  }

  function isOwnHostname(host){
    return !!host && OWN_HOSTNAMES.indexOf(host) !== -1;
  }

  // The 10 non-English path prefixes build-i18n-pages.js generates (11th
  // language, English, has no prefix) -- the exact same closed list
  // vilu-website.html's own detectInitialLang() checks first, and the
  // only site-wide language signal that is available SYNCHRONOUSLY, from
  // the URL alone. Deliberately NOT read from the page's own `currentLang`
  // variable: that is only assigned by shared-page-i18n.js/vilu-website.html
  // AFTER an awaited fetch of the translation JSON (confirmed by reading
  // both files), so it is still sitting at its unconditional 'en' default
  // at the moment this module's DOM-ready handler runs -- even on a
  // pre-generated page whose <html lang="ar"> is already correct in the
  // raw HTML source. Reusing the URL-path signal sidesteps that async gap
  // entirely rather than racing it.
  var SITE_LANG_CODES = ['ar','cs','de','fr','it','ja','ko','ru','sk','zh'];
  function detectLandingLanguage(){
    try {
      var seg = window.location.pathname.split('/').filter(Boolean)[0];
      if (seg && SITE_LANG_CODES.indexOf(seg) !== -1) return seg;
    } catch(e) {}
    return 'en';
  }

  function classifyReferrer(refHost){
    for (var i = 0; i < REFERRER_TABLE.length; i++){
      if (REFERRER_TABLE[i].re.test(refHost)) {
        return { source: REFERRER_TABLE[i].source, medium: REFERRER_TABLE[i].medium };
      }
    }
    return { source: 'referral', medium: 'referral' }; // bounded fallback,
      // never source:'unknown-<hostname>' -- see Phase 11D-A §10.
  }

  // Reads the CURRENT page's URL/referrer/body attributes and classifies
  // a first-touch candidate. Pure and side-effect-free -- never reads or
  // writes any storage. Returns null when this page view must never
  // establish attribution: an excluded page_type (404/legal -- Phase
  // 11D-A §7/§19) or an own-hostname referrer (internal navigation --
  // §13; checked BEFORE any UTM/referrer classification, so an internal
  // link can never seed a new first-touch record even if it happens to
  // carry a stray utm_ param).
  function computeCandidate(){
    try {
      var body = document.body;
      var pageType = (body && body.getAttribute('data-page-type')) || '';
      if (pageType === '404' || pageType === 'legal') return null;

      // Second, independent gate alongside the page_type check above
      // (Phase 11D-B3 §2): even for an otherwise-eligible page_type, the
      // slug itself must be one of the exact, currently-real Vilu landing
      // pages -- fails closed for any unrecognized value rather than
      // capturing it, which also future-proofs against a new page type
      // being added without this list being updated to match.
      var landingSlug = ((body && body.getAttribute('data-page-slug')) || '').slice(0, ATTR_SLUG_MAX_LEN);
      if (!isEligibleLandingSlug(landingSlug)) return null;

      var refHost = document.referrer ? hostnameOf(document.referrer) : null;
      if (refHost && isOwnHostname(refHost)) return null;

      var params;
      try { params = new URL(window.location.href).searchParams; }
      catch(e) { params = new URLSearchParams(); }

      // A valid, non-empty, non-PII-shaped utm_source is the ONLY thing
      // that activates UTM-based attribution (Phase 11D-B2 §4). An orphan
      // utm_medium/utm_campaign with no utm_source is never enough on its
      // own -- it falls straight through to referrer/direct classification
      // below, and any such orphan values are simply never read.
      var utmSource = sanitizeUtmValue(params.get('utm_source'));
      var source, medium, campaign = null, referrerHost = null;

      if (utmSource) {
        // Explicit UTM always wins over inferred referrer classification
        // (Phase 11D-A §10/§11) -- preserved as-given (sanitized/capped),
        // never remapped into the closed organic/social table.
        source = utmSource.toLowerCase();
        var utmMedium = sanitizeUtmValue(params.get('utm_medium'));
        medium = utmMedium ? utmMedium.toLowerCase() : 'unknown'; // never
          // invented -- honest gap when a link sets utm_source without
          // utm_medium.
        campaign = sanitizeUtmValue(params.get('utm_campaign'));
        referrerHost = refHost || null;
      } else if (refHost) {
        var cls = classifyReferrer(refHost);
        source = cls.source; medium = cls.medium; referrerHost = refHost;
      } else {
        source = 'direct'; medium = 'none'; referrerHost = null; // Phase
          // 11D-A §6/§12: a genuine no-referrer/no-UTM entrance is valid
          // first-touch attribution in its own right.
      }

      return {
        ts: new Date().toISOString(),
        source: source,
        medium: medium,
        campaign: campaign,
        referrer_host: referrerHost,
        landing_page_slug: landingSlug,
        landing_language: detectLandingLanguage()
      };
    } catch(e) { return null; }
  }

  // Computed exactly ONCE per page load, before any consent check. Kept
  // only in memory -- never written to storage pre-consent (Phase 11D-A
  // §3). If Analytics consent is granted later on this same page, THIS
  // exact object is what gets persisted -- never recomputed at
  // consent-grant time, so the recorded source/medium reflects how the
  // page was actually entered, not whichever UI interaction triggered
  // consent. If the visitor navigates away before consenting, this is
  // simply lost -- no pre-consent storage workaround is used.
  //
  // Deliberately NOT computed at top-level IIFE execution: this script
  // loads in <head> (before consent.js's own gtag bootstrap), so
  // `document.body` does not exist yet at parse time on every page that
  // loads analytics.js this way -- computeCandidate() would silently read
  // a null body and lose page_type/page_slug. Set once DOM-ready instead,
  // matching the readyState-gated pattern already used for the consent
  // button wiring below and in consent.js's own initUI().
  var _candidate = null;

  var VALID_LANDING_LANGUAGES = ['en'].concat(SITE_LANG_CODES);

  // Field-shape helpers used ONLY to validate a record already read back
  // from localStorage -- a client-controlled store that can be hand-
  // edited at any time (Phase 11D-B2 §5 / 11D-B3 §1). Every field is
  // checked, not just the envelope (version/first_touch presence). Any
  // failure here means the whole record is treated as absent and
  // deleted -- never partially trusted, and never "cleaned up" in place.
  //
  // referrer_host must be a bare hostname -- no scheme, no path, no
  // query, no whitespace, no embedded full URL.
  function isValidHostnameShape(v){
    if (v === null) return true;
    if (typeof v !== 'string' || !v.length || v.length > ATTR_STR_MAX_LEN) return false;
    if (v.indexOf('/') !== -1 || v.indexOf(':') !== -1 || /\s/.test(v)) return false;
    return /^[a-z0-9.-]+$/i.test(v);
  }

  function isValidStoredRecord(rec){
    if (!rec || rec.version !== ATTR_VERSION || !rec.first_touch) return false;
    var ft = rec.first_touch;

    if (typeof ft.ts !== 'string') return false;
    var age = Date.now() - Date.parse(ft.ts);
    if (!(age >= 0) || age > ATTR_MAX_AGE_MS) return false; // covers NaN
      // (unparseable ts), a future-dated ts (clock skew/tampering), and
      // genuine 30-day expiry in one check -- an "obviously invalid"
      // timestamp is rejected the same way an expired one is, never
      // trusted indefinitely (Phase 11D-B2 §5).

    // source/medium/campaign: the EXACT SAME safety rules capture-time
    // already applies (bounded length, no control characters, not
    // email/URL/phone-shaped) -- Phase 11D-B3 §1. A poisoned value here
    // invalidates the whole record; it is never stripped/cleaned and
    // then trusted.
    if (!isCleanBoundedString(ft.source, ATTR_STR_MAX_LEN)) return false;
    if (!isCleanBoundedString(ft.medium, ATTR_STR_MAX_LEN)) return false;
    if (ft.campaign !== null && !isCleanBoundedString(ft.campaign, ATTR_STR_MAX_LEN)) return false;

    if (!isValidHostnameShape(ft.referrer_host)) return false;

    // landing_page_slug must be one of the exact, real, currently-
    // eligible Vilu landing slugs -- not merely slug-shaped (Phase
    // 11D-B3 §2). Rejects an empty string, an invented value like
    // "fake-page", and any 404/legal slug that a hand-edited record
    // might carry.
    if (!isEligibleLandingSlug(ft.landing_page_slug)) return false;

    if (VALID_LANDING_LANGUAGES.indexOf(ft.landing_language) === -1) return false;

    return true;
  }

  // Defensive read: malformed JSON, a wrong/missing version, a
  // structurally invalid record, or one older than 30 days are all
  // treated identically -- as if no record exists -- AND are actively
  // deleted as a side effect of being read, so storage self-heals the
  // next time anything touches it. Never partially trusts a record.
  function readStoredAttribution(){
    try {
      var raw = localStorage.getItem(ATTR_KEY);
      if (!raw) return null;
      var parsed;
      try { parsed = JSON.parse(raw); }
      catch(e) { deleteStoredAttribution(); return null; }
      if (!isValidStoredRecord(parsed)) { deleteStoredAttribution(); return null; }
      return parsed;
    } catch(e) { return null; } // storage unavailable (quota/private-mode
      // policy/etc.) -- degrade to "no attribution", never throw.
  }

  function deleteStoredAttribution(){
    try { localStorage.removeItem(ATTR_KEY); } catch(e) {}
  }

  function persistCandidate(candidate){
    if (!candidate) return;
    try {
      localStorage.setItem(ATTR_KEY, JSON.stringify({ version: ATTR_VERSION, first_touch: candidate }));
    } catch(e) {}
  }

  // Hard invariant (Phase 11D-B2 §1): if Analytics consent is not
  // CURRENTLY allowed, `vilu_attribution` must not remain persisted --
  // covers explicit rejection, a previous withdrawal, no decision yet at
  // all, and a stale record left over from some earlier allowed state
  // (e.g. the consent record itself was cleared/reset independently).
  // Deleting it here is pure cleanup of optional analytics storage; it
  // never creates any new tracking state, and the ephemeral in-memory
  // `_candidate` for this page load is completely unaffected.
  function enforceConsentInvariant(){
    try {
      if (!window.viluConsent || !window.viluConsent.isAnalyticsAllowed()) {
        deleteStoredAttribution();
      }
    } catch(e) {}
  }

  // Establishes first-touch in storage if -- and only if -- Analytics
  // consent is CURRENTLY granted, no valid unexpired record already
  // exists, and this page view produced an eligible candidate. A valid
  // existing record always wins and is left completely untouched (first-
  // touch is never refreshed merely because the visitor returns -- Phase
  // 11D-A §1/§6/§12).
  function establishFirstTouchIfNeeded(){
    try {
      if (!window.viluConsent || !window.viluConsent.isAnalyticsAllowed()) return;
      if (readStoredAttribution()) return; // valid & unexpired wins; also
        // self-cleans any expired/malformed leftover as a side effect.
      if (_candidate) persistCandidate(_candidate);
    } catch(e) {}
  }

  // Reacts to the three existing consent controls (Accept All / Reject /
  // Save in the Customize panel) to persist-or-delete as appropriate --
  // this is how withdrawal deletes `vilu_attribution` without any change
  // to consent.js, per the explicit instruction that consent.js is a
  // hard boundary.
  //
  // Deliberately does NOT assume this listener runs after consent.js's
  // own click handler merely because of script/registration order --
  // that ordering is not something to rely on. Instead the actual
  // consent-state check is deferred via setTimeout(fn, 0): a macrotask
  // that only runs once the current click's synchronous listeners
  // (consent.js's own handler included, regardless of order) have
  // already finished and localStorage reflects the new decision. This
  // was verified live, not assumed -- see the Phase 11D-B report.
  function onConsentDecisionSettled(){
    setTimeout(function(){
      try {
        if (window.viluConsent && window.viluConsent.isAnalyticsAllowed()) {
          establishFirstTouchIfNeeded();
        } else {
          deleteStoredAttribution(); // covers both explicit Reject and a
            // Customize-panel Save that turns Analytics off (withdrawal).
        }
      } catch(e) {}
    }, 0);
  }

  function wireAttributionConsentButtons(){
    ['consentAccept', 'consentReject', 'consentSave'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', onConsentDecisionSettled);
    });
  }

  // Single DOM-ready-gated init: compute this page load's candidate (now
  // that `document.body` reliably exists), enforce the consent invariant
  // (Phase 11D-B2 §1 -- removes any stale persisted record if Analytics
  // is not currently allowed), attempt to establish first-touch if
  // consent was already granted on a previous visit (Phase 11D-A §4), and
  // wire the consent-button reactor. Runs immediately instead of waiting
  // for the event if the DOM is already past 'loading' by the time this
  // script executes.
  function initAttribution(){
    _candidate = computeCandidate();
    enforceConsentInvariant();
    establishFirstTouchIfNeeded();
    wireAttributionConsentButtons();
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAttribution);
    } else {
      initAttribution();
    }
  }

  // Public, read-only. Consent-gated (Phase 11D-B2 §2): returns null
  // outright whenever Analytics is not CURRENTLY allowed, regardless of
  // what -- if anything -- happens to still be in localStorage (belt and
  // braces alongside the enforceConsentInvariant() cleanup above, which
  // should already have removed it). Never exposes a persisted record to
  // future site code while Analytics is disabled, and never exposes the
  // pre-consent in-memory candidate either way. When Analytics IS
  // allowed, validates/expires and returns the record or null. No
  // mutation methods are exposed (Phase 11D-A §16).
  function getAttribution(){
    try {
      if (!window.viluConsent || !window.viluConsent.isAnalyticsAllowed()) return null;
    } catch(e) { return null; }
    return readStoredAttribution();
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

  // ── commercial-event first-touch attribution augmentation (Phase 11D-C) ──
  // Attribution is attached ONLY to these three approved commercial-
  // intent events -- never to package_view, contact_click,
  // language_change, faq_expand, related_content_click,
  // review_link_click, or page_not_found (§1).
  var COMMERCIAL_ATTRIBUTION_EVENTS = ['package_enquire', 'experience_enquire', 'availability_click'];

  // Returns the extra params to merge into a commercial event's payload,
  // or null when nothing should be added -- either because this isn't
  // one of the three approved events, or because getAttribution() itself
  // returns null (which already means "Analytics isn't currently
  // allowed" OR "no valid, unexpired, field-validated record exists").
  // Deliberately calls the public getAttribution() API rather than
  // touching localStorage directly here (§4) -- this function adds zero
  // new consent logic of its own; it inherits getAttribution()'s gate
  // exactly.
  //
  // Only the five approved fields are ever built: first_touch_source,
  // first_touch_medium, landing_page_slug, landing_language, and
  // first_touch_campaign (only when campaign is non-null -- §6). Never
  // the attribution timestamp, referrer_host, schema version, or any
  // other storage-internal field (§2) -- referrer_host stays first-party
  // diagnostic storage only, never transmitted to GA4.
  function attributionEventParams(name){
    if (COMMERCIAL_ATTRIBUTION_EVENTS.indexOf(name) === -1) return null;
    var attr = getAttribution();
    if (!attr) return null; // no synthetic values invented here -- a
      // missing attribution record is simply absent, never faked as
      // "unknown" (§5). A legitimately-captured direct/none first-touch
      // is a real record and IS transmitted normally (§9) -- this branch
      // only covers the "no record at all" case.
    var ft = attr.first_touch;
    var params = {
      first_touch_source: ft.source,
      first_touch_medium: ft.medium,
      landing_page_slug: ft.landing_page_slug,
      landing_language: ft.landing_language
    };
    if (ft.campaign !== null) params.first_touch_campaign = ft.campaign;
    return params;
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
      // Attribution augments, never replaces or renames, existing Phase
      // 11C context (§7/§8): merged in AFTER `data`, as strictly
      // additional keys that never collide with any existing parameter
      // name on these three events (package_id, package_name, nights,
      // contact_method, cta_location, guide_slug, source_context, etc.
      // all remain exactly as each call site already sets them).
      var attrParams = attributionEventParams(name);
      if (attrParams) payload = Object.assign({}, payload, attrParams);
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
    consumeGuideHandoff: consumeGuideHandoff,
    getAttribution: getAttribution
  };

})();
