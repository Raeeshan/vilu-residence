# VILU — Idea Backlog

Future owner ideas that are **not approved for immediate implementation**. Recorded so they survive between sessions instead of disappearing. When the owner explicitly approves one of these for active work, move its detail into `VILU_ROADMAP.md` as a numbered phase (see how Phase 26 was promoted from a mid-session instruction on 2026-09-06) and leave a one-line pointer here.

---

## Live Destination Experience — weather / time (design detail, promoted to `VILU_ROADMAP.md` Phase 2 & 6 for sequencing, kept here for full design notes)

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

- **Vilu Voyager** — activities/excursions/South-Ari-experience brand; potential integration with experiences, holiday packages, agency distribution, guest excursion enquiries, destination content. Roadmap position: `VILU_ROADMAP.md` Phase 31.
- **Vilu Ari Dive**, **Vilu Spice**, **Vilu Griffin** — known related owner concepts, status unconfirmed beyond "exists in documentation." Treat each as real/future only according to current owner status at the time a future session picks this up — do not assume any of these are ready to build, and do not publicly reference them on the live site until the owner says so.

## Guest Account / CRM — loyalty sub-feature specifically

The core Guest Account / CRM / Direct-Marketing System is now `VILU_ROADMAP.md` Phase 26 (added 2026-09-06). Its loyalty component specifically remains here as unresolved backlog within that phase: repeat-guest benefits, package-upgrade offers, exclusive rates, early access, member offers, referral rewards. Explicitly `FUTURE / NOT DEFINED` — no discount, rate, or rule exists yet, and none should be invented without a dedicated owner decision when this sub-phase is actually reached.

## Package/experience presentation ideas not yet actioned

- A hybrid Holiday Packages homepage layout (e.g. 2 strong photographic cards, or 1 featured + an elegant 2/3-card secondary grid) was requested by the owner as a real redesign target, distinct from just adding photography/spacing. Not yet attempted as of 2026-09-06 — see `VILU_CURRENT_STATE.md` for exact status.
- A more editorial/asymmetric Gallery composition (one strong main image + secondary peeks, rather than a horizontal scroll rail with controls) was requested but not yet attempted as of 2026-09-06.

## Technical SEO cleanup candidates (noted, not yet actioned)

`docs/PHASE12_PRESERVATION_BASELINE.md` flags that `/vilu-website.html` and each `/xx/index.html` remain directly reachable (200) alongside their canonical `/` and `/xx/` forms — mitigated today by a correct canonical tag, but a P4 cleanup candidate (e.g. a redirect) if ever revisited. Do not attempt this without checking it doesn't reintroduce the redirect-loop bug already found and reverted once (see `docs/PHASE12_PRESERVATION_BASELINE.md` and prior session history).
