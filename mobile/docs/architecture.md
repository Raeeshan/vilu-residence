# Vilu Mobile — Architecture

## Data flow

```
┌─────────────────────────────┐
│  Mobile App (Vilu Staff /    │
│  Vilu Agency — same bundle,  │
│  APP_VARIANT selects which)  │
└───────────────┬───────────────┘
                │
                ▼
┌─────────────────────────────┐
│  Firebase Auth                │  ← SAME users as vilu-unified.html /
│  (email/password)              │    vilu-agency-portal.html. No new
└───────────────┬───────────────┘    accounts, no new auth system.
                │ uid, email, emailVerified
                ▼
┌─────────────────────────────┐
│  Profile resolution            │
│  (users/{normalizedEmail} via  │
│  Firestore client read, OR      │
│  getMyAgencyApplicationStatus   │
│  callable when no doc exists)   │
└───────────────┬───────────────┘
                │ ResolvedSession { role, accountStatus, applicationStatus }
                ▼
┌─────────────────────────────┐
│  Route guard                    │  ← src/navigation/guards.ts (pure,
│  (resolveStaffAccess /          │    unit-tested). Routing decision
│   resolveAgencyAccess)           │    ONLY — not the security boundary.
└───────────────┬───────────────┘
                │ allowed / redirect
                ▼
┌─────────────────────────────┐
│  Staff shell  OR  Agency shell │  ← Today/Reservations/Calendar/Guests/
│  OR a status screen             │    Agency Requests/More (Staff);
│  (pending/rejected/suspended/   │    Packages/Availability/Quotations/
│   unauthorized)                  │    Bookings/Earnings/Account (Agency)
└─────────────────────────────┘

Any future real data (reservations, packages, availability, settlements)
flows through the SAME existing Cloud Functions and Firestore
collections/rules the web apps already use — never a parallel database,
never a relaxed rule "because it's mobile".
```

## Why the guard functions are pure

`resolveStaffAccess`/`resolveAgencyAccess` take a plain `AuthState` object
and return a plain `AccessDecision` object — no React, no navigation
library, no Firebase SDK call inside them. This means:

1. Every scenario in the Phase M0/M1 test requirements (admin/manager/staff
   accepted by Staff, agency rejected by Staff, active/legacy/suspended
   agency handling, pending/rejected applicants, admin never becoming
   agency, etc.) is assertable with a plain object fixture — no mocking a
   navigation stack or a live Firebase connection.
2. The SAME decision function backs both the top-level redirect
   (`app/index.tsx`) and each protected route group's own layout guard
   (`app/(staff)/_layout.tsx`, `app/(agency)/_layout.tsx`), so a direct
   deep link into a protected screen is checked by the identical logic a
   normal navigation would have used — there is exactly one implementation
   of "who is allowed in here", not two that could drift apart.

## Why profile resolution is split into pure + I/O halves

`resolveRole`/`resolveAccountStatus`/`buildResolvedSession` in
`profileService.ts` take already-fetched data and return a `ResolvedSession`
— no Firestore call inside them. `fetchResolvedSession` is the thin async
wrapper that actually reads `users/{email}` (via an injected
`FirestoreUserDocReader`) and, only when no document exists, calls
`getMyAgencyApplicationStatus` (via an injected `ApplicationStatusReader`).

Test doubles are passed in for both dependencies in
`__tests__/logic/profileService.test.ts`, so the ENTIRE role/status
resolution contract — including "the applications reader is never called
when a users/{email} doc already exists" and "the Firestore reader always
receives the normalized email, never the raw Firebase Auth casing" — is
proven without a real Firebase connection.

## Security boundary

This app follows the same rule the web apps already do: **the client
never becomes the authority**. Every guard/redirect in this app answers
"which screen should I show", not "is this action allowed" — that second
question is answered independently, every time, by:

- `functions-core/index.js`'s `callerRole()` (re-derives role from
  `request.auth.token.email`/`users/{email}`/`staff_permissions/{uid}` —
  never trusts anything the client claims)
- `requireStaffLike()` / `requireManagerLike()` gates on every
  staff/manager-only callable
- `firestore.rules`' own `isAdmin()` (a hardcoded-email check,
  independent of any document), `isStaff()`, `isManagerRole()`,
  `isAgency()`

No Firestore rule or Cloud Function was relaxed, and none needs to be, for
this mobile foundation — it reads exactly what the web clients already
read, through the same rules.

## Variant build architecture

```
APP_VARIANT=staff  ─┐
                    ├─→ app.config.ts reads src/config/variant.ts
APP_VARIANT=agency ─┘        │
                              ├─→ name: "Vilu Staff" | "Vilu Agency"
                              ├─→ ios.bundleIdentifier / android.package
                              └─→ extra.appVariant (read at runtime by
                                  src/config/variant.ts's APP_VARIANT export,
                                  which app/index.tsx and the two layout
                                  guards read to pick the right guard/shell)
```
