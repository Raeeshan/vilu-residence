# VILU — Idea Backlog

Future owner ideas that are **not approved for immediate implementation**. Recorded so they survive between sessions instead of disappearing. When the owner explicitly approves one of these for active work, move its detail into `VILU_ROADMAP.md` as a numbered phase (see how Phase 26 was promoted from a mid-session instruction on 2026-09-06) and leave a one-line pointer here.

---

## Live Destination Experience — weather / time — STATUS: LIVE (kept here for the original full design notes only, not as open work)

**This entire section describes work that is now COMPLETE and live in production** (`VILU_COMPLETION_MATRIX.md` Phase 20/`VILU_ROADMAP.md` Phase 6) — real WeatherAPI.com data, live on `viluresidence.net`'s homepage. Kept below only as historical design-rationale notes; do not read the numbered implementation-order list as a remaining to-do.

**Concept:** show real Maamigili/South Ari destination conditions elegantly over or near the cinematic hero, to reinforce "Vilu = South Ari travel platform" rather than "Vilu = guesthouse website."

**Live Maamigili time:** timezone `Indian/Maldives`, UTC+05:00, via timezone-aware browser APIs (never a manually-added five hours). Compact presentation idea: "MAAMIGILI · SOUTH ARI — 13:42 MVT", clock updating live, no visitor location permission required.

**Live Maamigili weather:** current temperature, condition, feels-like, humidity, wind, precipitation probability, sunrise, sunset. Forecast: today, tomorrow, 3-day outlook, up to 7 days if the provider supports it reliably. Never hardcode or invent weather data.

**Visual design target:** transparent, glass-like, subtle, cinematic, premium, minimal, high legibility, restrained blur, thin border, Vilu amber accent — not a weather-dashboard pasted onto the hero. Desktop hierarchy idea:
```
MAAMIGILI · SOUTH ARI
30°  Partly Cloudy
13:42 MVT
Feels 33° · Wind 14 km/h · Sunset 18:12
View forecast →
```
Mobile: much smaller, e.g. "30° · Partly Cloudy — 13:42 MVT — Forecast →". The cinematic video stays dominant; weather/time is a quiet accent, never competes with it.

**Implementation order (do not skip steps):** 1) finish the correct hero video first — done, 2026-09-06 (see `VILU_CHANGELOG.md`). 2) design a *static* visual weather/time prototype. 3) owner visual approval of the prototype. 4) choose a weather provider. 5) verify commercial license. 6) verify API rate limits. 7) verify attribution requirements. 8) verify frontend-API-key security (never expose a paid-tier key client-side without protection). 9) design caching. 10) implement live data. 11) design the failure fallback. 12) accessibility QA. 13) performance QA. Weather must load asynchronously and never block hero rendering, LCP, booking, Firebase, consent, or main content — see `VILU_PROTECTED_CONTRACTS.md` for the exact fallback contract.

**Future analytics (once live):** a `weather_forecast_open` event, privacy-safe. Do not fire noisy events on automatic background refresh.

## Broader Destination Utility System (future, beyond weather/time)

Once weather/time exists, a broader family of "useful right now" destination utilities could follow: transfer information, airport information, arrival guidance, today's useful destination info, trip-preparation shortcuts, local-island rules, practical stay information. Not to be implemented automatically — each needs its own owner approval, likely folded into `VILU_ROADMAP.md` Phase 11 (Trip Preparation content) rather than the hero itself.

## Future Vilu-family brands (concept only, not launched)

- **Vilu Voyager** — **corrected understanding (2026-09-08, owner clarification, supersedes the earlier "excursion/activity brand" framing below)**: a post-arrival Guest Guide PDF given to guests with practical stay information — island information, activities/excursion details and prices, rules, transport, meals, safety, and contact information. **Not** a separate excursion company, a public-facing brand, or a public excursion marketplace. Roadmap position: `VILU_ROADMAP.md` Phase 31 / `VILU_COMPLETION_MATRIX.md` Phase 45.
- **Vilu Ari Dive**, **Vilu Spice**, **Vilu Griffin** — known related owner concepts, status unconfirmed beyond "exists in documentation." Treat each as real/future only according to current owner status at the time a future session picks this up — do not assume any of these are ready to build, and do not publicly reference them on the live site until the owner says so.

## Guest Account / CRM — loyalty sub-feature specifically

The core Guest Account / CRM / Direct-Marketing System is now `VILU_ROADMAP.md` Phase 26 (added 2026-09-06). Its loyalty component specifically remains here as unresolved backlog within that phase: repeat-guest benefits, package-upgrade offers, exclusive rates, early access, member offers, referral rewards. Explicitly `FUTURE / NOT DEFINED` — no discount, rate, or rule exists yet, and none should be invented without a dedicated owner decision when this sub-phase is actually reached.

## Package/experience presentation ideas — both shipped (2026-09-07 correction)

- ~~A hybrid Holiday Packages homepage layout...~~ **Built and live**: the homepage package section now uses 1 flagship + 2 secondary photographic cards (commit `8e4d0a1`, Phase 15). See `VILU_CHANGELOG.md`.
- ~~A more editorial/asymmetric Gallery composition...~~ **Built and live**: one dominant image + a slim click-to-swap thumbnail strip (commit `8e4d0a1`, Phase 15). See `VILU_CHANGELOG.md`.

## Technical SEO cleanup candidates (noted, not yet actioned)

`docs/PHASE12_PRESERVATION_BASELINE.md` flags that `/vilu-website.html` and each `/xx/index.html` remain directly reachable (200) alongside their canonical `/` and `/xx/` forms — mitigated today by a correct canonical tag, but a P4 cleanup candidate (e.g. a redirect) if ever revisited. Do not attempt this without checking it doesn't reintroduce the redirect-loop bug already found and reverted once (see `docs/PHASE12_PRESERVATION_BASELINE.md` and prior session history).
