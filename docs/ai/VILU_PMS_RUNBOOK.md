# Vilu Residence — PMS Operational Runbook

Added Phase 48 (PMS Hardening), 2026-09-07. Six named failure scenarios staff
or an on-call developer may hit, and the concrete recovery step for each.
Written against the reservation-write architecture audited in Phase 48:
`writeReservation()` (identical in `vilu-website.html`, `vilu-unified.html`,
`vilu-agency-portal.html`) writes `reservations` and `room_availability` in
one Firestore transaction; `functions/index.js`'s `blockDoubleBooking` is a
server-side backstop that runs after any reservation is created.

## 1. Booking submission fails (guest sees an error, direct booking)

- The guest-facing flow (`confirmGuestBooking()` in `vilu-website.html`)
  already retries per-room and reports partial success/failure by name —
  check what the guest actually saw before assuming total failure.
- Ask the guest for the room + dates they tried. Open the PMS calendar for
  that room/date range — if a reservation with source `Website` and status
  `Pending` already exists for those dates, it succeeded and the guest saw a
  false error (e.g. a network blip after the write committed) — confirm it
  with them and stop.
- If nothing exists: check `reconciliation_log` (PMS → the reconciliation log
  panel) for a recent entry on that room — if reconciliation just repaired a
  drift, the room's true availability changed and the booking may have
  legitimately failed with `ROOM_CONFLICT`.
- If Firestore itself was down/unreachable: the site shows an availability
  warning banner and will not silently show false availability (confirmed in
  `loadBookedRangesFromSupabase()`) — the guest should be told to retry in a
  few minutes, no manual data fix is needed.

## 2. ROOM_CONFLICT on a booking that "should" have been free

- `ROOM_CONFLICT` means either the pre-check (`hasBlockConflict`, against the
  `blocks` collection) or the atomic transaction check (against
  `room_availability`) found an overlapping active booking or a manual block.
- Open the PMS → the room's calendar row for the exact date range. You will
  find either a reservation or a block explaining it. If you see neither:
  run **Run Reconciliation Now** (PMS Settings/Reconciliation panel) — this
  recomputes every room's `room_availability` lock straight from the real
  `reservations` collection and repairs drift; it never touches
  `reservations` itself, so it's always safe to run.
- If reconciliation finds nothing and the conflict still isn't visible
  anywhere, treat it as a true concurrent-booking race (two guests booked the
  same room within milliseconds) — check `reconciliation_log` and the
  Cloud Functions log for `blockDoubleBooking` around that timestamp; it
  auto-cancels the later of two conflicting reservations and logs which one.

## 3. Availability shown on the site doesn't match the PMS

- This is a cache/read-path question, not a write-integrity question — the
  site reads `room_availability` (a cache) and `blocks`, not `reservations`
  directly.
- First: hard-refresh the site (or wait — it also re-fetches on every search).
  If it's still wrong, run **Run Reconciliation Now** in the PMS — this is
  the direct fix, since `room_availability` is explicitly documented as "just
  a cache used for fast conflict-checking," with `reservations` as the source
  of truth.
- Reconciliation also runs automatically at most once per 24h on PMS load —
  if the mismatch is recent and self-resolves within a day, that's expected
  behavior, not a bug.

## 4. Guest reports a duplicate booking / double charge

- Open the PMS reservations list, filter by the guest's email. Genuine
  duplicates will be two separate reservation IDs for the same room+dates.
- Check both documents' `source` and whether one has `autoBlockedReason:
  'double_booking_detected_by_server'` — if so, the Cloud Function already
  auto-cancelled the losing one and this is a false alarm (the guest is
  seeing a stale confirmation from the losing attempt, but only the surviving
  reservation is actually active/billable).
- If both are genuinely still active (no auto-cancel field on either): this
  means both were created via two different write paths close enough
  together that neither the pre-check nor the transaction caught the other —
  cancel the incorrect one manually in the PMS (status → Cancelled) and
  notify the guest. This does not require a code change; it's exactly the
  scenario the server-side backstop exists to catch, so also check why it
  didn't fire (Cloud Functions log, or whether the second doc was created
  before the trigger for the first had finished).

## 5. PMS tab not syncing (another tab/device shows stale data)

- Live sync between tabs uses `BroadcastChannel('vilu_pms')`, which only
  reaches other tabs in the **same browser** — it does not sync across
  devices or browsers by design. For cross-device sync, the PMS also polls
  and re-syncs on page load and visibility change; a manual refresh always
  gets current data.
- If two tabs in the same browser are out of sync: `BroadcastChannel` support
  is wrapped in `try/catch` everywhere it's used, so an older/unusual browser
  silently falls back to the polling path only — this is expected, not a
  bug, on such browsers.
- If it's the same modern browser and tabs still disagree: refresh the stale
  tab. There is no manual cache to clear — the PMS holds reservation state
  in memory per tab, refreshed from Firestore on load.

## 6. Firestore permission error (in the PMS, agency portal, or booking flow)

- Confirm who's logged in and what they were trying to do — `firestore.rules`
  enforces (as of Phase 48): admin (`viluresidence@gmail.com`) and staff
  (present in `staff_permissions`) can read/write reservations; an agency
  account can only read/write its **own** (`agencyId`-matched) reservations,
  never another agency's; the public site can only **create** a reservation,
  never read, update, or delete one, and only with `source: 'Website'`,
  no `agencyId`, and `status: 'Pending'`.
- A permission error on a **read** almost always means the account isn't in
  `staff_permissions` yet, or an agency is trying to open a reservation that
  isn't theirs (by design, not a bug).
- A permission error on a **write** to an existing reservation from a staff
  account cancelling a booking may be the Phase 47 cancellation-override
  guard (`isCancellingNow()` requires a valid `cancellationAttemptId` +
  override code for staff, not admin) — this is intentional friction on
  cancellations, not a fault.
- Never work around a permission error by loosening `firestore.rules` as a
  quick fix — identify which of the cases above it actually is first.
