// Phase 20 — Live Destination Experience weather-cache regression harness.
//
// Run: node test/weather-live.test.js
//
// Tests the pure client-side functions that turn scripts/fetch-weather.js's
// output into what the approved Phase 17 component displays (or its
// graceful failure state), extracted from vilu-website.html's own inline
// <script> via vm (same technique test/phase12-preservation.test.js already
// uses for PACKAGES/etc.) so this suite tests the SAME code that ships,
// never a reimplementation of it. Never touches the network, never calls
// the real WeatherAPI, never needs a WeatherAPI key.
//
// Also verifies, directly against the shipped files, that no WeatherAPI key
// is ever present in anything served to a browser.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + String(e.message).split('\n').join('\n        ')); process.exitCode = 1; }
}
function section(t) { console.log(`\n# ${t}`); }

// ---------------------------------------------------------------------------
section('Extraction — pull the real Destination Now module out of vilu-website.html');

function loadDestinationNowModule() {
  const src = read('vilu-website.html');
  const startMarker = '// DESTINATION NOW — Phase 20 zero-cost live implementation';
  const endMarker = "document.addEventListener('DOMContentLoaded', initDestinationNow);";
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, 'could not find the Destination Now module start marker');
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, 'could not find the Destination Now module end marker');
  const code = src.slice(start, end);

  // Minimal DOM/browser stubs -- just enough for the module's top-level
  // evaluation (Intl IIFEs, function declarations) to run without a real
  // browser. initDestinationNow() itself is never invoked by this harness.
  const sandbox = {
    document: { getElementById: () => null, addEventListener: () => {} },
    window: {},
    Intl,
    Date,
    Math,
    console,
    setInterval: () => 0,
    clearTimeout: () => {},
    setTimeout: (fn) => { return 0; }, // never auto-fires in this sandbox -- no test here calls the real fetch path
    fetch: () => { throw new Error('fetch must never be called by this test suite'); },
    AbortController: class { constructor(){ this.signal = {}; } abort(){} }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code + `
    ;__out = {
      dnIcon, mapConditionCodeToIcon, dnIsFresh, dnValidateCache, dnCacheToRenderData,
      renderDestinationNow, renderDestinationFailure, DN_ICONS, DN_WEATHER_CACHE_URL, DN_STALE_MS
    };
  `, ctx);
  return { mod: ctx.__out, sandbox };
}

let M;
test('module extracts cleanly with all expected exports present', () => {
  M = loadDestinationNowModule().mod;
  for (const name of ['dnIcon', 'mapConditionCodeToIcon', 'dnIsFresh', 'dnValidateCache', 'dnCacheToRenderData', 'renderDestinationNow', 'renderDestinationFailure']) {
    assert.equal(typeof M[name], 'function', `${name} should be a function`);
  }
});

// ---------------------------------------------------------------------------
section('Condition-code mapping (real WeatherAPI.com code table)');

test('clear/sunny (1000) maps to sun', () => assert.equal(M.mapConditionCodeToIcon(1000), 'sun'));
test('partly cloudy (1003) maps to partlyCloudy', () => assert.equal(M.mapConditionCodeToIcon(1003), 'partlyCloudy'));
test('cloudy/overcast/mist family (1006, 1009, 1030, 1135) maps to cloud', () => {
  for (const code of [1006, 1009, 1030, 1135]) assert.equal(M.mapConditionCodeToIcon(code), 'cloud', `code ${code}`);
});
test('rain/drizzle/thunder family (1063, 1183, 1195, 1273, 1282) maps to rain', () => {
  for (const code of [1063, 1183, 1195, 1273, 1282]) assert.equal(M.mapConditionCodeToIcon(code), 'rain', `code ${code}`);
});
test('unknown/unmapped condition code (e.g. 9999, or non-numeric) falls back to a real icon, never throws or returns undefined', () => {
  assert.equal(typeof M.mapConditionCodeToIcon(9999), 'string');
  assert.ok(M.mapConditionCodeToIcon(9999) in M.DN_ICONS);
  assert.equal(typeof M.mapConditionCodeToIcon(null), 'string');
  assert.equal(typeof M.mapConditionCodeToIcon(undefined), 'string');
  assert.equal(typeof M.mapConditionCodeToIcon('1000'), 'string'); // wrong type (string, not number) -- must not throw
});
test('dnIcon() never returns undefined for any DN_ICONS key, and falls back safely for an unknown key', () => {
  for (const key of Object.keys(M.DN_ICONS)) assert.equal(typeof M.dnIcon(key), 'string');
  assert.equal(typeof M.dnIcon('totally-not-a-real-key'), 'string');
});

// ---------------------------------------------------------------------------
section('Cache validation and freshness (cache hit / expiration / malformed response)');

// Matches vilu-weather-cache's own cache contract exactly (see that
// repo's README.md and scripts/fetch-weather.js) -- this repo's client
// code is tested against the SAME field names that repo publishes.
function fixtureCache(overrides) {
  return Object.assign({
    updated_at: new Date().toISOString(),
    location: 'Maamigili, Alif Dhaal Atoll, Maldives',
    temperature_c: 29,
    condition: { code: 1003, text: 'Partly cloudy' },
    is_day: 1,
    sunrise: '06:02',
    sunset: '18:14',
    forecast: [
      { date: '2026-09-06', max_c: 30, min_c: 26, condition: { code: 1000, text: 'Sunny' } },
      { date: '2026-09-07', max_c: 29, min_c: 26, condition: { code: 1003, text: 'Partly cloudy' } },
      { date: '2026-09-08', max_c: 28, min_c: 25, condition: { code: 1063, text: 'Patchy rain possible' } }
    ]
  }, overrides);
}

test('a well-formed, fresh cache (cache hit) validates and is fresh', () => {
  const c = fixtureCache({});
  assert.equal(M.dnValidateCache(c), true);
  assert.equal(M.dnIsFresh(c.updated_at, 90 * 60 * 1000), true);
});
test('successful weather response shape: current temp/condition present and correctly typed', () => {
  const c = fixtureCache({});
  assert.equal(typeof c.temperature_c, 'number');
  assert.equal(typeof c.condition.code, 'number');
  assert.equal(M.dnValidateCache(c), true);
});
test('3-day forecast: exactly the free-plan-supported count is accepted, each entry validated', () => {
  const c = fixtureCache({});
  assert.equal(c.forecast.length, 3);
  assert.equal(M.dnValidateCache(c), true);
});
test('sunrise/sunset: present as 24-hour strings, required for validation to pass', () => {
  assert.equal(M.dnValidateCache(fixtureCache({ sunrise: '06:02', sunset: '18:14' })), true);
  assert.equal(M.dnValidateCache(fixtureCache({ sunrise: undefined })), false, 'missing sunrise must fail validation');
  assert.equal(M.dnValidateCache(fixtureCache({ sunset: undefined })), false, 'missing sunset must fail validation');
});
test('cache expiration: an updated_at older than the staleness window is correctly detected as stale', () => {
  const staleTs = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h old > 90min threshold
  assert.equal(M.dnIsFresh(staleTs, 90 * 60 * 1000), false);
});
test('cache expiration boundary: just inside the window is fresh, just outside is stale', () => {
  const insideTs = new Date(Date.now() - 89 * 60 * 1000).toISOString();
  const outsideTs = new Date(Date.now() - 91 * 60 * 1000).toISOString();
  assert.equal(M.dnIsFresh(insideTs, 90 * 60 * 1000), true);
  assert.equal(M.dnIsFresh(outsideTs, 90 * 60 * 1000), false);
});
test('dnIsFresh() never throws on a malformed/missing updated_at -- treated as not fresh', () => {
  assert.equal(M.dnIsFresh(undefined, 90 * 60 * 1000), false);
  assert.equal(M.dnIsFresh(null, 90 * 60 * 1000), false);
  assert.equal(M.dnIsFresh('not-a-date', 90 * 60 * 1000), false);
  assert.equal(M.dnIsFresh('', 90 * 60 * 1000), false);
});
test('malformed response: missing temperature_c fails validation without throwing', () => {
  assert.equal(M.dnValidateCache(fixtureCache({ temperature_c: undefined })), false);
});
test('malformed response: missing forecast array, or a forecast entry missing required fields, fails validation', () => {
  assert.equal(M.dnValidateCache(fixtureCache({ forecast: [] })), false, 'empty forecast array must fail');
  assert.equal(M.dnValidateCache(fixtureCache({ forecast: [{ date: '2026-09-06' }] })), false, 'forecast entry missing temps/condition must fail');
  assert.equal(M.dnValidateCache(null), false, 'null input must not throw');
  assert.equal(M.dnValidateCache(undefined), false, 'undefined input must not throw');
  assert.equal(M.dnValidateCache('not even an object'), false, 'wrong-type input must not throw');
});
test('unknown weather condition code inside a cache still validates and renders (falls back to a safe icon)', () => {
  const c = fixtureCache({ condition: { code: 9999, text: 'Something unusual' } });
  assert.equal(M.dnValidateCache(c), true);
  const data = M.dnCacheToRenderData(c);
  assert.ok(data.conditionIcon in M.DN_ICONS);
});
test('dnCacheToRenderData() maps a valid cache into renderDestinationNow()\'s exact expected shape', () => {
  const data = M.dnCacheToRenderData(fixtureCache({}));
  assert.equal(typeof data.conditionIcon, 'string');
  assert.equal(typeof data.conditionLabel, 'string');
  assert.equal(typeof data.tempC, 'number');
  assert.equal(data.sunrise, '06:02');
  assert.equal(data.sunset, '18:14');
  assert.equal(data.forecast.length, 3);
  for (const d of data.forecast) {
    assert.equal(typeof d.day, 'string');
    assert.equal(typeof d.icon, 'string');
    assert.equal(typeof d.high, 'number');
    assert.equal(typeof d.low, 'number');
  }
});

// ---------------------------------------------------------------------------
section('Frontend failure state (provider timeout / provider error / network failure)');

// fetchDestinationWeather() itself always resolves to either
// renderDestinationNow() or renderDestinationFailure() -- provider timeout,
// HTTP error, and network failure are exercised together here since all
// three collapse to the exact same call in that function's catch/!res.ok
// branches (see vilu-website.html). What's tested here is that the
// FAILURE RENDER ITSELF never fabricates a value, not the fetch plumbing.
test('renderDestinationFailure() never writes a fake temperature, sunrise, sunset, or forecast', () => {
  const dom = { grid: null, strip: null };
  const fakeDoc = {
    getElementById: (id) => {
      if (id === 'dn-grid') return dom.grid || (dom.grid = { innerHTML: '' });
      if (id === 'dn-forecast') return dom.strip || (dom.strip = { innerHTML: '' });
      if (id === 'dn-local-time') return { textContent: '' };
      return null;
    }
  };
  const src = read('vilu-website.html');
  const start = src.indexOf('// DESTINATION NOW — Phase 20 zero-cost live implementation');
  const end = src.indexOf("document.addEventListener('DOMContentLoaded', initDestinationNow);", start);
  const code = src.slice(start, end);
  const ctx = vm.createContext({ document: fakeDoc, window: {}, Intl, Date, Math, console, setInterval: () => 0, clearTimeout: () => {}, setTimeout: () => 0 });
  vm.runInContext(code + ';__fail = renderDestinationFailure; __tick = dnTickClock;', ctx);
  ctx.__fail();
  assert.ok(!dom.grid.innerHTML.includes('NaN'), 'must never render NaN');
  assert.ok(!dom.grid.innerHTML.includes('undefined'), 'must never render undefined');
  assert.ok(!dom.grid.innerHTML.includes('0°C'), 'must never render a fake 0°C');
  assert.ok(/Live conditions temporarily unavailable|destNow\.unavailable/.test(dom.grid.innerHTML), 'must show the restrained unavailable message');
  assert.equal(dom.strip.innerHTML, '', 'forecast strip must be empty, never fake forecast cards');
});
test('renderDestinationFailure() leaves the Local Time stat present and re-tickable (never removes it)', () => {
  const src = read('vilu-website.html');
  const failureBlockStart = src.indexOf('function renderDestinationFailure()');
  const failureBlockEnd = src.indexOf('\n}', failureBlockStart);
  const block = src.slice(failureBlockStart, failureBlockEnd);
  assert.ok(block.includes('id="dn-local-time"'), 'renderDestinationFailure must still render the #dn-local-time element');
  assert.ok(block.includes('dnTickClock()'), 'renderDestinationFailure must re-tick the clock immediately after replacing the DOM node');
});

// ---------------------------------------------------------------------------
section('API-key non-exposure (static check across every shipped file)');

test('the string "WEATHERAPI_KEY" (the secret env var name) never appears in any file Firebase Hosting ships', () => {
  const shipped = ['vilu-website.html', 'analytics.js', 'consent.js', 'theme.js', 'nav-shell.js', 'shared-page-i18n.js', 'shared-page.css', 'sitemap.xml'];
  for (const f of shipped) assert.ok(!read(f).includes('WEATHERAPI_KEY'), `${f} must never reference the WeatherAPI key env var name`);
});
test('no WeatherAPI key query parameter (key=...) appears anywhere in vilu-website.html', () => {
  assert.ok(!/[?&]key=[A-Za-z0-9]/.test(read('vilu-website.html')), 'a literal key= query string must never appear client-side');
});
test('the client never calls api.weatherapi.com directly -- only the keyless cache URL on the dedicated, separate repository', () => {
  const html = read('vilu-website.html');
  assert.ok(!html.includes('api.weatherapi.com'), 'the client must never call the WeatherAPI endpoint directly (that would require a client-exposed key)');
  assert.ok(html.includes('raw.githubusercontent.com/Raeeshan/vilu-weather-cache/main/weather-cache.json'), 'the client must fetch the pre-fetched, keyless cache file from the dedicated weather-cache repository');
  assert.ok(!html.includes('raw.githubusercontent.com/Raeeshan/vilu-residence/'), 'the client must not point at this repository -- the automation lives entirely in the separate vilu-weather-cache repository');
});
test('scripts/fetch-weather.js (the fetch/publish automation) does not live in this repository -- it belongs to the separate vilu-weather-cache repository, never touching this one\'s origin/main', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'fetch-weather.js')), false, 'fetch-weather.js must not be duplicated into vilu-residence -- its authoritative copy and its own tests live in vilu-weather-cache');
});
test('no weather-cache.json is ever committed inside this repository -- it is only ever fetched live from the dedicated repository', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'weather-cache.json')), false);
});

// ---------------------------------------------------------------------------
section('Attribution (WeatherAPI.com free-tier requirement)');

test('a WeatherAPI.com attribution credit is present in the static markup, with a real link to weatherapi.com', () => {
  const html = read('vilu-website.html');
  const noteMatch = html.match(/<p class="dn-note">[\s\S]*?<\/p>/);
  assert.ok(noteMatch, 'could not find the .dn-note attribution element');
  assert.ok(/weatherapi\.com/i.test(noteMatch[0]), 'attribution must reference weatherapi.com');
  assert.ok(/href="https:\/\/www\.weatherapi\.com\//.test(noteMatch[0]), 'attribution must link to the real WeatherAPI.com site');
});

console.log(`\n${passed}/${passed + failed} weather-live assertions passed${failed ? ` — ${failed} FAILED` : ''}`);
