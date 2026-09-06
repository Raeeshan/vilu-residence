#!/usr/bin/env node
// Phase 20 — zero-cost Live Destination Experience data refresh.
//
// Run on a schedule by .github/workflows/weather-cache.yml (every ~20
// minutes, well inside WeatherAPI.com's documented 60-minute current-
// conditions cache limit). Calls WeatherAPI.com's free-tier forecast.json
// once, writes the result to weather-cache.json on the `weather-cache-data`
// branch. That branch is never deployed to Firebase Hosting -- the
// production site's client JS fetches this file directly from GitHub's
// own raw-content CDN (public, free, CORS-enabled), so refreshing this
// data is not a "production deployment" of viluresidence.net.
//
// The WEATHERAPI_KEY is read from the environment (a GitHub Actions
// repository secret) and is never written to weather-cache.json or any
// other output -- only the resulting weather data is persisted.
//
// Exits non-zero on any failure so the Action run shows as failed
// (visible in the repo's Actions tab) rather than silently succeeding
// with no data -- but never writes a partial/fake file on failure; the
// previously-committed weather-cache.json is left untouched, and the
// production client's own staleness check (see fetchDestinationWeather()
// in vilu-website.html) will fall back to the "unavailable" state if the
// file goes stale because runs keep failing.

const fs = require('fs');
const path = require('path');

const MAAMIGILI_QUERY = '3.475,72.8375'; // Maamigili, Alif Dhaal Atoll -- sourced coordinates, see VILU_DECISIONS.md
const FORECAST_DAYS = 3; // Free-tier limit. Do not raise without a paid plan decision -- see VILU_ROADMAP.md Phase 6.
const OUTPUT_FILE = path.join(__dirname, '..', 'weather-cache.json');

function fail(message) {
  console.error('fetch-weather: ' + message);
  process.exit(1);
}

async function main() {
  const key = process.env.WEATHERAPI_KEY;
  if (!key) fail('WEATHERAPI_KEY environment variable is not set -- refusing to run with no key.');

  const url = 'https://api.weatherapi.com/v1/forecast.json?key=' + encodeURIComponent(key) +
    '&q=' + encodeURIComponent(MAAMIGILI_QUERY) + '&days=' + FORECAST_DAYS + '&aqi=no&alerts=no';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    fail('network error or timeout calling WeatherAPI: ' + e.message);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // Free-plan overage/suspension surfaces here as 401/403/429 -- never
    // billed, per WeatherAPI's own terms for the pure free plan; treated
    // as an ordinary failure, not a crash, and never faked.
    fail('WeatherAPI returned HTTP ' + res.status + ' ' + res.statusText);
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    fail('WeatherAPI response was not valid JSON: ' + e.message);
  }

  if (!json || !json.current || !json.location || !json.forecast || !Array.isArray(json.forecast.forecastday)) {
    fail('WeatherAPI response is missing expected fields (current/location/forecast.forecastday).');
  }
  if (json.forecast.forecastday.length < 1) {
    fail('WeatherAPI response has zero forecast days.');
  }

  // Sanity-check the resolved location is genuinely Maamigili/Maldives,
  // not a mis-resolved query -- required verification before this data
  // is ever trusted in production (see Phase 20 authorization).
  const region = ((json.location.country || '') + ' ' + (json.location.region || '') + ' ' + (json.location.name || '')).toLowerCase();
  if (!region.includes('maldives')) {
    fail('resolved location does not appear to be in the Maldives (got: ' + JSON.stringify(json.location) + ') -- refusing to publish possibly-wrong data.');
  }

  const today = json.forecast.forecastday[0];
  const out = {
    fetchedAt: new Date().toISOString(),
    location: {
      name: json.location.name || null,
      region: json.location.region || null,
      country: json.location.country || null,
      tzId: json.location.tz_id || null
    },
    current: {
      tempC: typeof json.current.temp_c === 'number' ? json.current.temp_c : null,
      conditionCode: json.current.condition && typeof json.current.condition.code === 'number' ? json.current.condition.code : null,
      conditionText: (json.current.condition && json.current.condition.text) || null,
      isDay: json.current.is_day === 1 ? 1 : 0
    },
    astro: today.astro ? {
      sunrise: to24Hour(today.astro.sunrise),
      sunset: to24Hour(today.astro.sunset)
    } : null,
    forecast: json.forecast.forecastday.slice(0, FORECAST_DAYS).map(function (d) {
      return {
        date: d.date || null,
        maxTempC: d.day && typeof d.day.maxtemp_c === 'number' ? d.day.maxtemp_c : null,
        minTempC: d.day && typeof d.day.mintemp_c === 'number' ? d.day.mintemp_c : null,
        conditionCode: d.day && d.day.condition && typeof d.day.condition.code === 'number' ? d.day.condition.code : null,
        conditionText: (d.day && d.day.condition && d.day.condition.text) || null
      };
    })
  };

  if (out.current.tempC === null || out.current.conditionCode === null || !out.astro || !out.astro.sunrise || !out.astro.sunset || out.forecast.length === 0) {
    fail('normalized output is missing required fields -- refusing to publish an incomplete record: ' + JSON.stringify(out));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log('fetch-weather: wrote ' + OUTPUT_FILE + ' for ' + out.location.name + ', ' + out.location.country + ' (tz ' + out.location.tzId + ')');
}

// WeatherAPI astro times are "hh:mm AM/PM" -- converted to 24-hour "HH:MM"
// to match the approved Phase 17 display format. Returns null (never a
// guessed/fake time) if the input doesn't match the expected shape.
function to24Hour(t) {
  if (typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === 'AM' && h === 12) h = 0;
  if (ampm === 'PM' && h !== 12) h += 12;
  return String(h).padStart(2, '0') + ':' + min;
}

main().catch(function (e) { fail('unexpected error: ' + (e && e.stack || e)); });
