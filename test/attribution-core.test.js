// Regression test for the Phase 11D-B/B2/B3 first-party attribution core
// inside analytics.js (window.viluAnalytics.getAttribution() / the
// `vilu_attribution` localStorage record).
//
// Run: node test/attribution-core.test.js
//
// Uses only Node's built-ins (assert/strict, vm, fs) — no framework, no
// new dependency, matching this repo's existing test/sitemap-lastmod.test.js
// convention. Runs the ACTUAL shipped analytics.js inside a minimal mocked
// browser environment (vm.runInContext) — never a reimplementation of its
// logic — so a real bug in the shipped file fails this test.

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

// Runs analytics.js fresh in a new vm context for one page-load scenario.
// opts: href, referrer, analyticsAllowed, hasDecision, pageType, pageSlug,
// initialLocalStorage.
function runScenario(opts) {
  const ls = makeStorage(opts.initialLocalStorage);
  let pathname = '/';
  try { pathname = new URL(opts.href).pathname; } catch (e) {}

  const sandbox = {
    console,
    Date, JSON, Math, String, Array, Object, RegExp, Number, Boolean,
    URL, URLSearchParams,
    currentLang: opts.currentLang || 'en',
    gtag: undefined,
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
      getElementById() { return null; }, // no consent buttons in this synthetic DOM
    },
  };
  sandbox.window = {
    location: { href: opts.href, pathname },
    viluConsent: {
      isAnalyticsAllowed: () => !!opts.analyticsAllowed,
      hasDecision: () => opts.hasDecision !== false,
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'analytics.js' });

  return {
    getAttribution: sandbox.window.viluAnalytics.getAttribution(),
    storedRaw: ls.getItem('vilu_attribution'),
  };
}

// The exact, real, currently attribution-eligible Vilu landing slugs —
// derived from the English source files (see analytics.js's own
// ELIGIBLE_LANDING_SLUGS comment for the exact grep command used), kept
// here too so this test independently proves every one of them is
// actually accepted, not just a hand-picked subset.
const ELIGIBLE_LANDING_SLUGS = [
  'home',
  'holiday-packages',
  'best-local-islands-snorkeling',
  'best-time-to-visit',
  'guesthouse-vs-resort',
  'maamigili-guide',
  'maldives-holiday-cost',
  'manta-ray-snorkeling',
  'south-ari-atoll-guide',
  'south-ari-vs-other-regions',
  'things-to-do-maamigili',
  'whale-shark-snorkeling',
];

console.log('Case A — direct entrance, consent already granted');
test('creates a direct/none record with the right shape', () => {
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'direct');
  assert.equal(ft.medium, 'none');
  assert.equal(ft.referrer_host, null);
  assert.equal(ft.landing_page_slug, 'home');
});

console.log('Case B — pre-consent: candidate stays in memory only, never persisted');
test('no decision yet -> getAttribution() null, nothing in storage', () => {
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: 'https://www.google.com/', analyticsAllowed: false, hasDecision: false, pageType: 'home', pageSlug: 'home' });
  assert.equal(r.getAttribution, null);
  assert.equal(r.storedRaw, null);
});
test('explicit rejection -> getAttribution() null, nothing in storage', () => {
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: 'https://www.google.com/', analyticsAllowed: false, hasDecision: true, pageType: 'home', pageSlug: 'home' });
  assert.equal(r.getAttribution, null);
  assert.equal(r.storedRaw, null);
});

console.log('Case C — UTM entrance: source/medium/campaign captured, precedence over referrer classification');
test('utm_source wins over referrer table; medium/campaign captured as given', () => {
  const r = runScenario({
    href: 'https://viluresidence.net/de/maamigili-guide.html?utm_source=Instagram&utm_medium=Paid_Social&utm_campaign=Sep2026_Maamigili',
    referrer: 'https://l.instagram.com/', analyticsAllowed: true, pageType: 'guide', pageSlug: 'maamigili-guide', currentLang: 'de',
  });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'instagram'); // lowercased
  assert.equal(ft.medium, 'paid_social'); // lowercased, NOT the referrer table's "social"
  assert.equal(ft.campaign, 'Sep2026_Maamigili');
  assert.equal(ft.referrer_host, 'l.instagram.com');
  assert.equal(ft.landing_language, 'de');
});
test('utm_source present, utm_medium absent -> honest "unknown", never invented', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=newsletter', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'newsletter');
  assert.equal(ft.medium, 'unknown');
  assert.equal(ft.campaign, null);
});

console.log('Case D — referrer classification table (organic vs. social vs. unknown)');
for (const [ref, expSource, expMedium] of [
  ['https://www.google.com/search?q=vilu', 'google', 'organic'],
  ['https://www.google.co.uk/', 'google', 'organic'],
  ['https://maps.google.de/', 'google', 'organic'],
  ['https://www.bing.com/search?q=vilu', 'bing', 'organic'],
  ['https://yandex.ru/search/?text=vilu', 'yandex', 'organic'],
  ['https://l.instagram.com/', 'instagram', 'social'],
  ['https://m.facebook.com/', 'facebook', 'social'],
  ['https://www.tiktok.com/', 'tiktok', 'social'],
]) {
  test(`${ref} -> ${expSource}/${expMedium}`, () => {
    const r = runScenario({ href: 'https://viluresidence.net/', referrer: ref, analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
    const ft = r.getAttribution.first_touch;
    assert.equal(ft.source, expSource);
    assert.equal(ft.medium, expMedium);
  });
}
test('unknown external referrer -> bounded referral/referral, never source:"unknown-<hostname>"', () => {
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: 'https://some-travel-blog.example/', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'referral');
  assert.equal(ft.medium, 'referral');
  assert.equal(ft.referrer_host, 'some-travel-blog.example');
});

console.log('Case E — internal (own-hostname) referrer is a hard acquisition stop, precedence over UTM');
for (const ref of ['https://viluresidence.net/holiday-packages.html', 'https://viluresidence.web.app/', 'https://vilu-residence.web.app/', 'https://viluresidence.firebaseapp.com/', 'https://vilu-residence.firebaseapp.com/']) {
  test(`internal referrer ${ref} -> no new record`, () => {
    const r = runScenario({ href: 'https://viluresidence.net/maamigili-guide.html', referrer: ref, analyticsAllowed: true, pageType: 'guide', pageSlug: 'maamigili-guide' });
    assert.equal(r.getAttribution, null);
  });
}
test('internal referrer never clobbers an existing valid record', () => {
  const existing = { version: 1, first_touch: { ts: new Date().toISOString(), source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'maamigili-guide', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/maamigili-guide.html', referrer: 'https://viluresidence.net/whale-shark-snorkeling.html', analyticsAllowed: true, pageType: 'guide', pageSlug: 'maamigili-guide', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.getAttribution.first_touch.source, 'google');
});
test('internal referrer + UTM params still creates no new record (internal check runs before UTM parsing)', () => {
  const r = runScenario({ href: 'https://viluresidence.net/holiday-packages.html?utm_source=internal_banner&utm_medium=website', referrer: 'https://viluresidence.net/maamigili-guide.html', analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages' });
  assert.equal(r.getAttribution, null);
});
test('internal referrer + UTM params does not overwrite an existing valid record either', () => {
  const existing = { version: 1, first_touch: { ts: new Date().toISOString(), source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'maamigili-guide', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/holiday-packages.html?utm_source=internal_banner&utm_medium=website', referrer: 'https://viluresidence.net/maamigili-guide.html', analyticsAllowed: true, pageType: 'package', pageSlug: 'holiday-packages', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.getAttribution.first_touch.source, 'google');
});

console.log('Case F — first-touch permanence: never refreshed by a later visit, expires cleanly at 30 days');
test('direct return visit does not overwrite an existing non-expired record', () => {
  const existing = { version: 1, first_touch: { ts: new Date().toISOString(), source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'whale-shark-snorkeling', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.getAttribution.first_touch.source, 'google');
  assert.equal(r.getAttribution.first_touch.ts, existing.first_touch.ts);
});
test('31-day-old record is expired, deleted, and replaced by a fresh eligible entrance', () => {
  const oldTs = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const existing = { version: 1, first_touch: { ts: oldTs, source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'whale-shark-snorkeling', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.getAttribution.first_touch.source, 'direct');
  assert.notEqual(r.getAttribution.first_touch.ts, oldTs);
});
test('29-day-old record is still valid (boundary check)', () => {
  const ts29 = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
  const existing = { version: 1, first_touch: { ts: ts29, source: 'bing', medium: 'organic', campaign: null, referrer_host: 'www.bing.com', landing_page_slug: 'south-ari-atoll-guide', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.getAttribution.first_touch.source, 'bing');
});

console.log('Case G — 404/legal landing pages are excluded, both fresh and with an existing record');
test('404 landing page never creates a record', () => {
  const r = runScenario({ href: 'https://viluresidence.net/nope.html', referrer: 'https://www.google.com/', analyticsAllowed: true, pageType: '404', pageSlug: '404' });
  assert.equal(r.getAttribution, null);
});
test('legal landing page never creates a record', () => {
  const r = runScenario({ href: 'https://viluresidence.net/privacy-policy.html', referrer: 'https://www.google.com/', analyticsAllowed: true, pageType: 'legal', pageSlug: 'privacy-policy' });
  assert.equal(r.getAttribution, null);
});
test('existing record remains intact while viewing a legal page', () => {
  const existing = { version: 1, first_touch: { ts: new Date().toISOString(), source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'maamigili-guide', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/privacy-policy.html', referrer: 'https://www.google.com/', analyticsAllowed: true, pageType: 'legal', pageSlug: 'privacy-policy', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.getAttribution.first_touch.source, 'google');
});

console.log('Case H — capture-time UTM sanitization: length cap, HTML-special-char stripping, never throws');
test('overlong utm_source is capped to 100 chars; campaign HTML-special chars stripped but legible text survives', () => {
  const longVal = 'a'.repeat(500);
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=' + encodeURIComponent(longVal) + '&utm_medium=cpc&utm_campaign=' + encodeURIComponent('promo <script>alert(1)</script> "quoted"'), referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source.length, 100);
  assert.ok(ft.campaign.indexOf('<') === -1 && ft.campaign.indexOf('"') === -1);
  assert.equal(ft.campaign.indexOf('promo'), 0);
});
test('malformed location.href does not throw', () => {
  assert.doesNotThrow(() => runScenario({ href: 'not a valid url at all', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' }));
});
test('a storage implementation that throws on every call does not crash the module', () => {
  const throwingStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const sandbox = {
    console, Date, JSON, Math, String, Array, Object, RegExp, Number, Boolean, URL, URLSearchParams,
    currentLang: 'en', gtag: undefined, localStorage: throwingStorage, sessionStorage: throwingStorage,
    document: { referrer: '', readyState: 'complete', addEventListener() {}, body: { getAttribute: () => null }, getElementById: () => null },
  };
  sandbox.window = { location: { href: 'https://viluresidence.net/' }, viluConsent: { isAnalyticsAllowed: () => true, hasDecision: () => true } };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(SRC, sandbox, { filename: 'analytics.js' });
    sandbox.window.viluAnalytics.getAttribution();
  });
});

console.log('Case I — consent invariant: a stale persisted record must not survive when Analytics is not currently allowed');
test('stale record + explicit rejection already stored -> removed during init', () => {
  const existing = { version: 1, first_touch: { ts: new Date().toISOString(), source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'home', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: false, hasDecision: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.storedRaw, null);
  assert.equal(r.getAttribution, null);
});
test('stale record + no valid consent decision yet -> removed, candidate memory-only', () => {
  const existing = { version: 1, first_touch: { ts: new Date().toISOString(), source: 'bing', medium: 'organic', campaign: null, referrer_host: 'www.bing.com', landing_page_slug: 'home', landing_language: 'en' } };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: 'https://www.google.com/', analyticsAllowed: false, hasDecision: false, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(existing) } });
  assert.equal(r.storedRaw, null);
  assert.equal(r.getAttribution, null);
});
test('getAttribution() is always null without Analytics consent, even with an otherwise-eligible entrance', () => {
  const r = runScenario({ href: 'https://viluresidence.net/whale-shark-snorkeling.html', referrer: 'https://www.google.com/', analyticsAllowed: false, hasDecision: true, pageType: 'guide', pageSlug: 'whale-shark-snorkeling' });
  assert.equal(r.getAttribution, null);
});

console.log('Case J — orphan UTM handling: only a valid utm_source activates UTM attribution');
test('external Google referrer + orphan utm_campaign -> normal google/organic, campaign ignored', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_campaign=test', referrer: 'https://www.google.com/', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'google');
  assert.equal(ft.medium, 'organic');
  assert.equal(ft.campaign, null);
});
test('direct entrance + orphan utm_medium -> direct/none, not synthetic UTM attribution', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_medium=social', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'direct');
  assert.equal(ft.medium, 'none');
});
test('valid utm_source -> correct UTM first-touch', () => {
  const r = runScenario({ href: 'https://viluresidence.net/de/maamigili-guide.html?utm_source=instagram&utm_medium=paid_social&utm_campaign=sep2026_maamigili', referrer: '', analyticsAllowed: true, pageType: 'guide', pageSlug: 'maamigili-guide' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'instagram');
  assert.equal(ft.medium, 'paid_social');
  assert.equal(ft.campaign, 'sep2026_maamigili');
});

console.log('Case K — UTM PII-shape rejection at capture: email/URL/phone-shaped values ignored, real campaign values pass through');
test('email-shaped utm_source ignored -> falls back to direct', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=' + encodeURIComponent('someone@example.com'), referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  assert.equal(r.getAttribution.first_touch.source, 'direct');
});
test('URL-shaped utm_source ignored -> falls back to direct', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=' + encodeURIComponent('https://example.com/campaign'), referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  assert.equal(r.getAttribution.first_touch.source, 'direct');
});
test('phone-shaped utm_campaign ignored (null), valid utm_source still captured', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=instagram&utm_campaign=' + encodeURIComponent('+960 987 6543'), referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  const ft = r.getAttribution.first_touch;
  assert.equal(ft.source, 'instagram');
  assert.equal(ft.campaign, null);
});
test('real campaign value "sep2026_maamigili" passes through untouched', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=instagram&utm_medium=paid_social&utm_campaign=sep2026_maamigili', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  assert.equal(r.getAttribution.first_touch.campaign, 'sep2026_maamigili');
});
test('real medium value "paid_social" passes through untouched', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=instagram&utm_medium=paid_social', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  assert.equal(r.getAttribution.first_touch.medium, 'paid_social');
});
test('real campaign value "whale-shark-de" passes through untouched', () => {
  const r = runScenario({ href: 'https://viluresidence.net/?utm_source=facebook&utm_medium=paid_social&utm_campaign=whale-shark-de', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home' });
  assert.equal(r.getAttribution.first_touch.campaign, 'whale-shark-de');
});

console.log('Case L — Phase 11D-B3 §1: stored source/medium/campaign must pass the SAME safety rules as capture');
function poisonedFirstTouch(overrides) {
  return { ts: new Date().toISOString(), source: 'google', medium: 'organic', campaign: null, referrer_host: 'www.google.com', landing_page_slug: 'home', landing_language: 'en', ...overrides };
}
function expectRejectedAndReplaced(overrides, label) {
  test(label, () => {
    const rec = { version: 1, first_touch: poisonedFirstTouch(overrides) };
    const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(rec) } });
    // A poisoned record must never be returned as-is -- it must be
    // discarded, and (since this is otherwise a plain eligible direct
    // entrance) a fresh clean direct/none record established instead.
    assert.notEqual(r.storedRaw, JSON.stringify(rec));
    assert.ok(r.getAttribution);
    assert.equal(r.getAttribution.first_touch.source, 'direct');
  });
}
expectRejectedAndReplaced({ source: 'person@example.com' }, 'poisoned stored source (email-shaped) -> record rejected');
expectRejectedAndReplaced({ medium: 'https://evil.example/track' }, 'poisoned stored medium (URL-shaped) -> record rejected');
expectRejectedAndReplaced({ campaign: '+960 987 6543' }, 'poisoned stored campaign (phone-shaped) -> record rejected');
expectRejectedAndReplaced({ source: 'goo\x00gle' }, 'control character in stored source -> record rejected');
expectRejectedAndReplaced({ medium: 'orga\x1Fnic' }, 'control character in stored medium -> record rejected');
expectRejectedAndReplaced({ campaign: 'promo\x7Fcode' }, 'control character in stored campaign -> record rejected');
expectRejectedAndReplaced({ source: 'a'.repeat(101) }, 'over-length stored source (101 chars) -> record rejected');
expectRejectedAndReplaced({ landing_language: 'xx' }, 'invalid landing_language -> record rejected');
expectRejectedAndReplaced({ ts: 'not-a-real-timestamp' }, 'invalid timestamp -> record rejected');
expectRejectedAndReplaced({ ts: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() }, 'far-future timestamp -> record rejected');
expectRejectedAndReplaced({ referrer_host: 'https://evil.example/steal?x=1' }, 'referrer_host containing a full URL -> record rejected');
expectRejectedAndReplaced({ source: '' }, 'empty-string source -> record rejected');
expectRejectedAndReplaced({ medium: null }, 'null medium -> record rejected');
expectRejectedAndReplaced({ campaign: 12345 }, 'non-string campaign -> record rejected');

test('stored record with entirely normal values (google/organic/null campaign) is accepted, not rejected', () => {
  const rec = { version: 1, first_touch: poisonedFirstTouch({}) };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(rec) } });
  assert.equal(r.getAttribution.first_touch.source, 'google');
  assert.equal(r.getAttribution.first_touch.ts, rec.first_touch.ts); // untouched, not replaced
});
test('stored record with a real campaign value ("sep2026_maamigili") is accepted', () => {
  const rec = { version: 1, first_touch: poisonedFirstTouch({ source: 'instagram', medium: 'paid_social', campaign: 'sep2026_maamigili' }) };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(rec) } });
  assert.equal(r.getAttribution.first_touch.campaign, 'sep2026_maamigili');
});
for (const [source, medium] of [['google', 'organic'], ['instagram', 'social'], ['referral', 'referral'], ['direct', 'none'], ['newsletter', 'unknown']]) {
  test(`stored record with normal closed-vocabulary values ${source}/${medium} is accepted`, () => {
    const rec = { version: 1, first_touch: poisonedFirstTouch({ source, medium }) };
    const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(rec) } });
    assert.equal(r.getAttribution.first_touch.source, source);
    assert.equal(r.getAttribution.first_touch.medium, medium);
  });
}

console.log('Case M — Phase 11D-B3 §2: landing_page_slug must be an actual, real, eligible Vilu landing slug');
test('empty landing slug (capture time) -> not eligible, no record created', () => {
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: '' });
  assert.equal(r.getAttribution, null);
});
test('empty landing slug (stored record) -> rejected', () => {
  const rec = { version: 1, first_touch: poisonedFirstTouch({ landing_page_slug: '' }) };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(rec) } });
  assert.notEqual(r.storedRaw, JSON.stringify(rec));
  assert.equal(r.getAttribution.first_touch.landing_page_slug, 'home'); // replaced by a fresh eligible one
});
test('invented landing slug "fake-page" (capture time) -> not eligible, no record created', () => {
  const r = runScenario({ href: 'https://viluresidence.net/fake-page.html', referrer: '', analyticsAllowed: true, pageType: 'guide', pageSlug: 'fake-page' });
  assert.equal(r.getAttribution, null);
});
test('invented landing slug "fake-page" (stored record) -> rejected', () => {
  const rec = { version: 1, first_touch: poisonedFirstTouch({ landing_page_slug: 'fake-page' }) };
  const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(rec) } });
  assert.notEqual(r.storedRaw, JSON.stringify(rec));
});
test('404/legal slugs can never become a stored first-touch landing page, even via a hand-edited record', () => {
  for (const badSlug of ['404', 'privacy-policy', 'cookies']) {
    const rec = { version: 1, first_touch: poisonedFirstTouch({ landing_page_slug: badSlug }) };
    const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType: 'home', pageSlug: 'home', initialLocalStorage: { vilu_attribution: JSON.stringify(rec) } });
    assert.notEqual(r.storedRaw, JSON.stringify(rec));
  }
});
for (const slug of ELIGIBLE_LANDING_SLUGS) {
  test(`every real eligible landing slug is accepted: "${slug}"`, () => {
    const pageType = slug === 'home' ? 'home' : slug === 'holiday-packages' ? 'package' : 'guide';
    const r = runScenario({ href: 'https://viluresidence.net/', referrer: '', analyticsAllowed: true, pageType, pageSlug: slug });
    assert.ok(r.getAttribution, `expected a record for slug "${slug}"`);
    assert.equal(r.getAttribution.first_touch.landing_page_slug, slug);
  });
}

console.log('Case N — guide-handoff mechanism is completely separate and untouched by attribution');
test('setGuideHandoff/consumeGuideHandoff still exist and remain independent of getAttribution()', () => {
  const sandbox = {
    console, Date, JSON, Math, String, Array, Object, RegExp, Number, Boolean, URL, URLSearchParams,
    currentLang: 'en', gtag: undefined, localStorage: makeStorage({}),
    sessionStorage: makeStorage({ vilu_guide_handoff: 'maamigili-guide' }),
    document: { referrer: '', readyState: 'complete', addEventListener() {}, body: { getAttribute: () => null }, getElementById: () => null },
  };
  sandbox.window = { location: { href: 'https://viluresidence.net/' }, viluConsent: { isAnalyticsAllowed: () => false, hasDecision: () => false } };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'analytics.js' });
  assert.equal(sandbox.window.viluAnalytics.consumeGuideHandoff(), 'maamigili-guide');
  assert.equal(sandbox.sessionStorage.getItem('vilu_guide_handoff'), null); // consumed and cleared
  assert.equal(sandbox.window.viluAnalytics.getAttribution(), null); // unrelated, still consent-gated
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED');
}
