# Vilu Mobile

One shared React Native / Expo codebase that builds **two** apps from the
same source:

| Variant  | For                          | App name    | Bundle/package id           |
|----------|------------------------------|-------------|------------------------------|
| `staff`  | Admin, Manager, Staff        | Vilu Staff  | `com.viluresidence.staff`   |
| `agency` | Approved agency partners     | Vilu Agency | `com.viluresidence.agency`  |

Both variants talk to the **same existing Firebase project**
(`vilu-residence`) the web PMS (`vilu-unified.html`) and Agency Portal
(`vilu-agency-portal.html`) already use — same Auth users, same Firestore
data, same Cloud Functions, same security rules. This app is an
**additional client**, not a replacement or a parallel backend. Vilu PMS
remains the single source of truth.

> **Phase M0/M1 status**: this is the shared authentication + role-routing
> foundation only. No reservations/calendar/packages data is wired up yet —
> see "What's next (M2)" below.

## Architecture

```
mobile/
  app/                     # expo-router file-based routes
    _layout.tsx            # root layout: ThemeProvider + AuthProvider
    index.tsx              # the ONE redirect decision (loading/signed-out/guarded)
    (auth)/                # login, forgot-password — shared by both variants
    status/                # pending / rejected / suspended / unauthorized
    (staff)/                # Vilu Staff tab shell (guarded)
    (agency)/               # Vilu Agency tab shell (guarded)
  src/
    types/profile.ts        # UserRole, AccountStatus, ResolvedSession, AuthState
    utils/                  # normalizeEmail, toCleanError
    config/variant.ts        # APP_VARIANT -> name/bundle id
    services/
      firebase/             # RNFB init (auth/firestore/functions accessors)
      auth/authService.ts    # signIn/signOut/resetPassword/onAuthStateChanged
      profile/               # profile resolution (pure + Firestore I/O)
      api/applicationService.ts  # getMyAgencyApplicationStatus wrapper
    navigation/guards.ts      # resolveStaffAccess / resolveAgencyAccess (pure)
    state/AuthProvider.tsx     # wires auth + profile into ONE AuthState
    theme/                    # design tokens, light/dark
    components/                # Button, Card, Badge, StatusScreen, PlaceholderScreen
  app.config.ts              # dynamic Expo config, variant-aware
  __tests__/logic/            # dependency-free unit tests (the security-critical suite)
```

### Why Expo Router + a development build (not Expo Go)

Expo Go can't load custom native modules. This project needs
`@react-native-firebase/*` (native Auth/Firestore/Functions/Messaging/
Crashlytics/App Check) for parity with the web app's security model, plus
push notifications later — all of which require a **development build**
(`expo run:ios` / `expo run:android`, or an EAS dev client), not Expo Go.

### One codebase, two identities

`APP_VARIANT=staff` or `APP_VARIANT=agency` (env var) is read in exactly
one place — `src/config/variant.ts` — and drives:

- `app.config.ts`: app name, `bundleIdentifier`/`package`, slug
- `app/index.tsx`: which guard (`resolveStaffAccess` vs `resolveAgencyAccess`) applies
- Which route group (`(staff)` vs `(agency)`) the guarded redirect lands on

There is no second copy of any screen, service, or type for the two
variants — only the routing/guard decision differs.

## Firebase integration

This app reuses the **existing** Firebase project (`vilu-residence`) —
confirmed from the web apps' own client config (project id `vilu-residence`,
same `authDomain`). No new Firebase project, no new Firestore database, no
new Cloud Functions.

React Native Firebase auto-initializes from **native config files**
(unlike the web SDK's explicit `firebaseConfig` object):

- `android/app/google-services.json`
- `ios/GoogleService-Info.plist`

**These are not in this repo and were deliberately not generated in this
phase.** Before a real device/simulator build can authenticate, the iOS
and Android app identities (`com.viluresidence.staff`,
`com.viluresidence.agency` — four app registrations total, two per
variant) need to be registered in the Firebase console for the *existing*
`vilu-residence` project, and their config files downloaded into this
project (see `.env.example` for where they're expected). That registration
is additive (new app entries under the same project) and was intentionally
left as a manual step rather than performed automatically, per this
project's own "stop and report before touching production backend
configuration" principle — registering apps isn't a rules/Functions/data
change, but it's still a real, persistent change to the Firebase project
that should be a deliberate decision, not an automatic side effect of
scaffolding.

## Session persistence

Firebase Auth's own native SDK persists the signed-in session (Keychain on
iOS, encrypted storage on Android). This app does **not** implement any
custom token/session storage — no `AsyncStorage`, no `expo-secure-store`
for auth state. `authService.onAuthStateChanged()` is what restores a
session on launch, mirroring the web apps' own `onAuthStateChanged`
listener pattern exactly.

## Profile / role resolution

`src/services/profile/profileService.ts` is the **one** place a
`users/{email}` document is read client-side, and it normalizes the email
first (`normalizeEmail()` — trim + lowercase) before every lookup. This
exists specifically because of a real bug found and fixed in the web
Agency Portal on 2026-09-13: `fetchAgencyProfile()` looked up
`users/{email}` using whatever casing Firebase Auth handed back, not
lower-case, and a mismatch silently returned `null` — misread as "not set
up for access" for a perfectly valid account. This app never reintroduces
that class of bug.

Resolved contract (verified against the real `functions-core/index.js` and
`firestore.rules`, not assumed from memory):

- `role`: `'admin' | 'manager' | 'staff' | 'agency'` from `users/{email}.role`
  (or `'none'` if no document exists yet — a not-yet-approved applicant).
- `accountStatus`: `'ACTIVE' | 'SUSPENDED'`, only meaningful for
  `role === 'agency'`. A legacy agency account created before Agency
  Self-Registration (2026-09-13) has **no** `accountStatus` field at all —
  that's treated as `'ACTIVE'`, matching `functions-core/index.js`'s own
  `callerRole()` (which only flips to a `'suspended'` sentinel when
  `accountStatus === 'SUSPENDED'` exactly).
- `applicationStatus`: `'NONE' | 'PENDING_APPROVAL' | 'REJECTED'`, read via
  the **existing** `getMyAgencyApplicationStatus` callable when no
  `users/{email}` doc exists — the same callable the web Agency Portal's
  `showStatusScreenIfApplicant()` already uses. No second application
  model.

## Server authority

The mobile UI is never the security boundary. `src/navigation/guards.ts`
decides which *screen* to show — every sensitive read/write still goes
through the same Cloud Functions and Firestore rules the web apps use
(`callerRole()`, `requireStaffLike()`, `requireManagerLike()`,
`isAdmin()`/`isStaff()`/`isManagerRole()`/`isAgency()` in
`firestore.rules`), which independently re-derive role/status/ownership
from `request.auth` every time. Hiding a tab is a UX nicety, not
authorization — nothing in this app relaxes or duplicates that logic
client-side.

## Local development

```bash
cd mobile
npm install
cp .env.example .env.local   # then fill in real values, see above

# Staff variant
npm run start:staff
npm run ios:staff       # requires the iOS app registered + GoogleService-Info.plist
npm run android:staff   # requires the Android app registered + google-services.json

# Agency variant
npm run start:agency
npm run ios:agency
npm run android:agency
```

### Testing

```bash
npm run typecheck   # tsc --noEmit, strict mode
npm run lint        # eslint
npm test            # jest — two projects:
                     #   "logic" (dependency-free, runs anywhere): the
                     #     security-critical auth/guard/profile suite
                     #   "app" (jest-expo): React Native component tests,
                     #     not yet populated in this phase
```

## Security model summary

- Server authority: every Cloud Function/Firestore rule re-derives
  authorization independently (see above) — the mobile guards are routing,
  not security.
- No credentials stored client-side beyond what Firebase Auth's own native
  SDK manages; no service-account/Admin SDK material is ever bundled into
  the app (`__tests__/logic/security.test.ts` asserts this against the
  actual source tree).
- Email is normalized (trim + lowercase) at the one seam where it matters
  (`users/{email}` lookups), closing the exact casing bug found on web.
- Agency accounts can only ever resolve their **own** identity — there is
  no code path that accepts an arbitrary target email/agency id for a
  profile lookup.
- No Admin-Preview/impersonation mode exists yet for the Agency app variant
  (explicit product decision for this phase) — Admin only ever authorizes
  into the Staff variant.

## What's next (M2)

Not built in this phase (explicitly out of scope per the task):

- Real reservations/calendar/guest data in the Staff app
- Real packages/availability/quotations/bookings/earnings data in the
  Agency app
- Self-registration signup flow on mobile (only status-aware login
  handling for an existing applicant was required this phase)
- Push notifications (Messaging), Crashlytics wiring, App Check enforcement
  (dependencies are declared; not yet initialized/enabled)
- Native app registration in the Firebase console + committing the real
  `google-services.json` / `GoogleService-Info.plist`
- App icon/splash real assets (placeholders referenced in `app.config.ts`
  do not yet exist as real image files)
- React Native component/rendering tests (the "app" Jest project is wired
  but empty — this phase's tests are the dependency-free "logic" suite)
