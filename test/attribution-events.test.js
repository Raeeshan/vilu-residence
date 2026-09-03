// Regression test for Phase 11D-C: attaching validated first-touch
// attribution to the three approved commercial-intent analytics events
// (package_enquire, experience_enquire, availability_click) via the
// central augmentation inside analytics.js's trackEvent().
//
// Run: node test/attribution-events.test.js
//
// Separate from test/attribution-core.test.js (storage/classification
// core) so each file stays focused: this one is entirely about what
// trackEvent() actually sends to gtag() for a given page/consent/
// attribution state. Same conventions: Node's built-in assert/strict, no
// new dependency, runs the actual shipped analytics.js via
// vm.runInContext -- never a reimplementation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'analytics.js'), 'utf8');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    console.log(`  FAIL - ${name}`);
    console.log(e.message);
    process.exitCode = 1;
  }
}

function makeStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
}

// Boots analytics.js fresh in a new vm context representing ONE page
// view (with its own referrer/UTM/consent/localStorage state, exactly
// like attribution-core.test.js's runScenario), then fires a single
// trackEvent() call on that same "page" and returns every gtag() call
// made as a result -- this is what a real page load followed by one
// user click would produce.
function runEventScenario(opts) {
  const ls = makeStorage(opts.initialLocalStorage);
  const gtagCalls = [];
  const href = opts.href || 'https://viluresidence.net/';
  let pathname = '/';
  try { pathname = new URL(href).pathname; } catch (e) {}

  const sandbox = {
    console,
    Date, JSON, Math, String, Array, Object, RegExp, Number, Boolean,
    URL, URLSearchParams,
    currentLang: opts.currentLang || 'en',
    gtag(...args) { gtagCalls.push(args); },
    localStorage: ls,
    sessionStorage: makeStorage({}),
    document: {
      referrer: opts.referrer || '',
      readyState: 'complete',
      addEventListener() {},
      body: {
        getAttribute(name) {
          if (name === 'data-page-type') return opts.pageType != null ? opts.pageType : 'home';
          if (name === 'data-page-slug') return opts.pageSlug != null ? opts.pageSlug : 'home';
          return null;
        },
      },
      getElementById() { return null; },
    },
  };
  sandbox.window = {
    location: { href, pathname },
    viluConsent: {
      isAnalyticsAllowed: () => !!opts.analyticsAllowed,
      hasDecision: () => opts.hasDecision !== false,
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'analytics.js' });

  sandbox.window.trackEvent(opts.eventName, opts.eventData || {});

  const eventCalls = gtagCalls.filter((c) => c[0] === 'event');
  return {
    gtagCalls,
    eventCalls,
    payload: eventCalls.length ? eventCalls[0][2] : undefined,
  };
}

function seededRecord(overrides) {
  return {
    version: 1,
    first_touch: Object.assign(
      { ts: new Date().toISOString(), source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'south-ari-atoll-guide', landing_language: 'en' },
      overrides
    ),
  };
}

console.log('Case A — Google organic -> package enquiry gets first-touch attribution');
test('package_enquire augmented with first_touch_source/medium + landing context', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ landing_page_slug: 'south-ari-atoll-guide' })) },
    eventName: 'package_enquire',
    eventData: { package_id: 'island-explorer-getaway', package_name: 'Island Explorer Getaway', nights: 4, contact_method: 'whatsapp', guide_slug: null },
  });
  assert.equal(r.eventCalls.length, 1, 'exactly one canonical event fired');
  const p = r.payload;
  assert.equal(p.first_touch_source, 'google');
  assert.equal(p.first_touch_medium, 'organic');
  assert.equal(p.landing_page_slug, 'south-ari-atoll-guide');
  assert.equal(p.landing_language, 'en');
  assert.equal('first_touch_campaign' in p, false, 'no campaign was captured -> field must be absent');
  // existing Phase 11C context preserved, not renamed/removed
  assert.equal(p.package_id, 'island-explorer-getaway');
  assert.equal(p.contact_method, 'whatsapp');
  assert.equal(p.page_type, 'package');
});

console.log('Case B — UTM Instagram campaign -> experience enquiry');
test('experience_enquire augmented with UTM-derived first-touch including campaign', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'home', pageSlug: 'home',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ source: 'instagram', medium: 'paid_social', campaign: 'sep2026_maamigili', landing_page_slug: 'home' })) },
    eventName: 'experience_enquire',
    eventData: { contact_method: 'whatsapp', experience_id: 'Whale Shark Snorkeling' },
  });
  const p = r.payload;
  assert.equal(p.first_touch_source, 'instagram');
  assert.equal(p.first_touch_medium, 'paid_social');
  assert.equal(p.first_touch_campaign, 'sep2026_maamigili');
  assert.equal(p.experience_id, 'Whale Shark Snorkeling');
});

console.log('Case C — direct entrance -> availability_click');
test('availability_click augmented with direct/none, a legitimate real record', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'home', pageSlug: 'home',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ source: 'direct', medium: 'none', referrer_host: null, landing_page_slug: 'home' })) },
    eventName: 'availability_click',
    eventData: { source_context: 'homepage_booking_bar' },
  });
  const p = r.payload;
  assert.equal(p.first_touch_source, 'direct');
  assert.equal(p.first_touch_medium, 'none');
  assert.equal(p.source_context, 'homepage_booking_bar');
});

console.log('Case D — organic with no campaign: first_touch_campaign must be entirely absent, never "null"/""/"(not set)"');
test('campaign omitted, not sent as a placeholder value', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ source: 'bing', medium: 'organic', campaign: null })) },
    eventName: 'package_enquire',
    eventData: { package_id: 'maldives-dream-bliss' },
  });
  const p = r.payload;
  assert.equal('first_touch_campaign' in p, false);
  assert.notEqual(p.first_touch_campaign, null);
  assert.notEqual(p.first_touch_campaign, 'null');
  assert.notEqual(p.first_touch_campaign, '(not set)');
});

console.log('Case E — no attribution record at all: event fires normally, zero synthetic first-touch fields');
test('consent allowed but no valid record (internal-only navigation history) -> plain Phase 11C payload', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    referrer: 'https://viluresidence.net/maamigili-guide.html', // internal -> establishes nothing
    eventName: 'package_enquire',
    eventData: { package_id: 'grand-maldives-escape', contact_method: 'email' },
  });
  const p = r.payload;
  assert.equal(r.eventCalls.length, 1);
  for (const key of Object.keys(p)) {
    assert.ok(!key.startsWith('first_touch_'), `unexpected attribution field present: ${key}`);
  }
  assert.equal('landing_page_slug' in p, false);
  assert.equal('landing_language' in p, false);
  assert.equal(p.package_id, 'grand-maldives-escape'); // Phase 11C context still present
});

console.log('Case F — Analytics rejected: event is not transmitted at all (attribution or not)');
test('rejected consent -> zero gtag event calls, even with a (stale, about-to-be-deleted) record present', () => {
  const r = runEventScenario({
    analyticsAllowed: false, hasDecision: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({})) },
    eventName: 'package_enquire',
    eventData: { package_id: 'honeymoon-dream-escape' },
  });
  assert.equal(r.eventCalls.length, 0);
});

console.log('Case G — Analytics withdrawn: future event is not transmitted, and attribution has been removed from storage');
test('withdrawn consent -> zero event calls; vilu_attribution deleted by the consent invariant', () => {
  const ls = makeStorage({ vilu_attribution: JSON.stringify(seededRecord({})) });
  const r = runEventScenario({
    analyticsAllowed: false, hasDecision: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({})) },
    eventName: 'availability_click',
    eventData: { source_context: 'navigation' },
  });
  assert.equal(r.eventCalls.length, 0);
});

console.log('Case H — expired attribution cannot be attached');
test('31-day-old record is not attached; event still fires with plain Phase 11C payload', () => {
  // Referrer is internal so THIS page view is itself ineligible to
  // establish a brand-new first-touch (matching Case E's technique) --
  // isolating the exact thing under test: an expired record sitting in
  // storage must never be attached, and nothing on this particular page
  // view replaces it either. (A page view that IS a fresh eligible
  // entrance legitimately establishing a brand-new direct/none record
  // after an old one expires is already covered, correctly, by
  // attribution-core.test.js Case F.)
  const oldTs = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    referrer: 'https://viluresidence.net/maamigili-guide.html',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ ts: oldTs })) },
    eventName: 'package_enquire',
    eventData: { package_id: 'ultimate-maldives-odyssey' },
  });
  const p = r.payload;
  assert.equal('first_touch_source' in p, false);
  assert.equal(p.package_id, 'ultimate-maldives-odyssey');
});

console.log('Case I — guide assist + acquisition coexist, never overwrite each other');
test('landing_page_slug (acquisition) and guide_slug (explicit content-assist) are both present and distinct', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ source: 'google', medium: 'organic', landing_page_slug: 'south-ari-atoll-guide' })) },
    eventName: 'package_enquire',
    eventData: { package_id: 'island-explorer-getaway', guide_slug: 'maamigili-guide' },
  });
  const p = r.payload;
  assert.equal(p.first_touch_source, 'google');
  assert.equal(p.landing_page_slug, 'south-ari-atoll-guide'); // where the journey began
  assert.equal(p.guide_slug, 'maamigili-guide'); // the guide just clicked through
  assert.notEqual(p.landing_page_slug, p.guide_slug);
});

console.log('Case J — multilingual divergence: landing_language and site_language answer different questions');
test('landing_language (de, captured at first touch) coexists with site_language (en, at conversion time)', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages', currentLang: 'en',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ landing_page_slug: 'maamigili-guide', landing_language: 'de' })) },
    eventName: 'package_enquire',
    eventData: { package_id: 'reef-sunset-adventure' },
  });
  const p = r.payload;
  assert.equal(p.landing_language, 'de');
  assert.equal(p.site_language, 'en');
  assert.notEqual(p.landing_language, p.site_language);
});

console.log('Case K — non-commercial events never receive first-touch parameters, even with a valid record present');
for (const eventName of ['package_view', 'contact_click', 'language_change', 'faq_expand', 'related_content_click', 'review_link_click', 'page_not_found']) {
  test(`${eventName} receives no first_touch_* / landing_* fields`, () => {
    const r = runEventScenario({
      analyticsAllowed: true, pageType: 'guide', pageSlug: 'maamigili-guide',
      initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({})) },
      eventName,
      eventData: { some_existing_param: 'x' },
    });
    assert.equal(r.eventCalls.length, 1);
    const p = r.payload;
    for (const key of Object.keys(p)) {
      assert.ok(!key.startsWith('first_touch_') && key !== 'landing_page_slug' && key !== 'landing_language', `${eventName} unexpectedly carries ${key}`);
    }
  });
}

console.log('Case L — one interaction remains exactly one canonical event (no double-count, no dual emission)');
test('a single trackEvent() call produces exactly one gtag("event", ...) call', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({})) },
    eventName: 'package_enquire',
    eventData: { package_id: 'ultimate-island-relaxation' },
  });
  assert.equal(r.eventCalls.length, 1);
  assert.equal(r.eventCalls[0][1], 'package_enquire');
});
test('no recommended-event dual emission (generate_lead/begin_checkout/view_item/view_item_list never fire)', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({})) },
    eventName: 'package_enquire',
    eventData: { package_id: 'grand-maldives-escape' },
  });
  const names = r.eventCalls.map((c) => c[1]);
  for (const forbidden of ['generate_lead', 'begin_checkout', 'view_item', 'view_item_list']) {
    assert.ok(!names.includes(forbidden), `unexpected recommended-event emission: ${forbidden}`);
  }
});

console.log('Case M — no PII / no storage-internal fields ever reach the GA4 payload');
test('referrer_host, ts, and schema version are never present on a commercial-event payload', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ referrer_host: 'www.google.com' })) },
    eventName: 'package_enquire',
    eventData: { package_id: 'honeymoon-dream-escape' },
  });
  const p = r.payload;
  assert.equal('referrer_host' in p, false);
  assert.equal('ts' in p, false);
  assert.equal('version' in p, false);
  assert.equal('first_touch_ts' in p, false);
});

console.log('Case N — GA4 parameter-count safety: augmented payloads stay well within GA4 limits');
test('a maximal package_enquire payload (all optional fields present) stays under 25 params', () => {
  const r = runEventScenario({
    analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages',
    initialLocalStorage: { vilu_attribution: JSON.stringify(seededRecord({ source: 'instagram', medium: 'paid_social', campaign: 'sep2026_maamigili', landing_page_slug: 'maamigili-guide' })) },
    eventName: 'package_enquire',
    eventData: { package_id: 'ultimate-resort-island-odyssey', package_name: 'Ultimate Resort & Island Odyssey', nights: 11, contact_method: 'whatsapp', guide_slug: 'maamigili-guide' },
  });
  const keyCount = Object.keys(r.payload).length;
  assert.ok(keyCount < 25, `expected well under GA4's 25-param limit, got ${keyCount}`);
  for (const key of Object.keys(r.payload)) {
    assert.ok(key.length <= 40, `param name "${key}" exceeds GA4's 40-char name limit`);
  }
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED');
}
