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

### Firebase project setup (done — Phase M1.5)

Four real client apps are now registered under the existing
`vilu-residence` project (additive only — no new project, no new
Firestore database, no new Auth users, nothing else in the project was
touched):

| Platform | Variant | App ID |
|---|---|---|
| Android | Vilu Staff  | `1:751046104531:android:b92271da51a999c6c84b26` |
| Android | Vilu Agency | `1:751046104531:android:9f8c3760bbc58098c84b26` |
| iOS     | Vilu Staff  | `1:751046104531:ios:972e26bb5f5f50fdc84b26` |
| iOS     | Vilu Agency | `1:751046104531:ios:2690b7eccd3d224cc84b26` |

Their real config files are fetched into `mobile/native-config/<variant>/`
(git-ignored — see below) via:

```bash
firebase apps:sdkconfig ANDROID <appId> --out native-config/<variant>/google-services.json
firebase apps:sdkconfig IOS     <appId> --out native-config/<variant>/GoogleService-Info.plist
```

`app.config.ts` defaults `ios.googleServicesFile`/`android.googleServicesFile`
to `native-config/${APP_VARIANT}/...` automatically — no env var needed for
local development once these files exist.

**Note on file contents**: Firebase's `google-services.json` format lists
*every* Android app registered in the project as a separate `client[]`
entry (confirmed live during this phase) — so the Staff and Agency files
are not expected to differ entry-for-entry; what matters, and what
`__tests__/logic/nativeConfig.test.ts` actually verifies, is that each
file *contains* the entry matching its own package id. The Android Gradle
`google-services` plugin picks the right entry via `applicationId` at
build time, exactly like a human downloading the file from the Firebase
console would get.

**Why these files are git-ignored, not committed**: they're real,
non-secret public client identifiers (not API secrets), but are kept out
of git as a matter of convention — they're trivially regenerable via the
one-line command above (or CI/EAS's own secret store, see "EAS builds"
below), and keeping them out of git avoids ever needing a diff review on
a large binary-ish JSON/plist blob. This mirrors how the existing web
apps' own equivalent (the public `apiKey`/`appId` object in
`vilu-unified.html`) is committed only because the web SDK requires it
inline in source — RNFB's native config has no such constraint.

### EAS builds (cloud) — native config strategy

`native-config/` is git-ignored, so an EAS cloud build (which only sees
what's in git, plus EAS's own secret store) will **not** see these files
automatically. The correct, EAS-native mechanism — never committing them,
never baking them into `eas.json` in plaintext — is EAS's **file-type
environment variables**, uploaded once per variant:

```bash
# One-time setup, requires an authenticated `eas login` (see "Blockers" below)
eas env:create --scope project --name GOOGLE_SERVICES_JSON   --type file --value native-config/staff/google-services.json    --environment development --visibility sensitive
eas env:create --scope project --name GOOGLE_SERVICES_PLIST  --type file --value native-config/staff/GoogleService-Info.plist --environment development --visibility sensitive
# Repeat with distinct names (e.g. GOOGLE_SERVICES_JSON_AGENCY) or a
# separate EAS "environment" per variant, then reference the right one
# from each profile in eas.json's own "env" block.
```

At build time EAS decrypts the file to a temp path and injects that path
as the named env var — which `app.config.ts` already reads
(`process.env.GOOGLE_SERVICES_JSON ?? './native-config/${APP_VARIANT}/...'`)
with **zero code changes needed**: the same env-var seam that lets a
developer override the local default is exactly the seam EAS uses. This
was designed in from Phase M1.1 specifically so this would be a
config-only step, not a code change, once a real EAS account is
available.

**This was documented, not executed** — creating EAS environment
variables requires an authenticated `eas login`, which needs the user's
own Expo account credentials. No EAS secrets were created in this phase.

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

## Native build status (Phase M1.5)

`expo prebuild` has been verified to succeed for **both** variants on this
machine (Windows), generating a real native `android/` Gradle project each
time, correctly wired to the real registered Firebase app (confirmed:
`applicationId`, `rootProject.name`, and the copied `google-services.json`
all match the variant; see `__tests__/logic/nativeConfig.test.ts`):

```bash
APP_VARIANT=staff  npx expo prebuild --platform android --no-install
APP_VARIANT=agency npx expo prebuild --platform android --no-install
```

`android/`/`ios/` are git-ignored (regenerated on demand by `prebuild` —
this repo stays managed-workflow-first; there is no hand-edited native
code to lose by regenerating them).

**Confirmed blocker — no local Android SDK on this machine.** Running the
generated project's own Gradle wrapper reaches real project configuration
(Kotlin build-logic modules compile successfully) before failing with:

```
SDK location not found. Define a valid SDK location with an
ANDROID_HOME environment variable or by setting the sdk.dir path in your
project's local properties file at '...\mobile\android\local.properties'.
```

This machine has a JDK (Eclipse Adoptium 21) but no Android SDK, no `adb`,
no emulator, and `ANDROID_HOME`/`ANDROID_SDK_ROOT` are unset. This is a
genuine tooling gap, not a project misconfiguration — installing the full
Android SDK (several GB, Android Studio or the standalone command-line
tools + license acceptance) was deliberately not attempted automatically
in this phase, matching the explicit instruction to prefer EAS over
"spending hours hacking around Windows SDK configuration."

**EAS cloud build — blocked on account authentication, not tooling.**
`eas-cli` can be installed as a dev dependency with no login required, and
`eas.json` (below) is ready with `development-staff`/`development-agency`
profiles. Actually *triggering* a build (`eas build --profile
development-staff --platform android`) requires `eas login` — the user's
own Expo account credentials, which this assistant does not have and will
not request, exactly like the Firebase Admin password used for the manual
auth-proof steps. See "Blockers" in the Phase M1.5 report for the two
ways to unblock this (install Android Studio/SDK locally and hand back
control, or run `eas login` and either continue this session or trigger
the build directly).

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
