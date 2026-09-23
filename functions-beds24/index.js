'use strict';
// Vilu Residence — Cloud Functions ("beds24" codebase)
//   beds24OutboundWorker  Vilu PMS -> Beds24 differential-sync outbound worker
//
// Split into its OWN codebase, separate from both "core" (functions-core/,
// deliberately secret-free) and "ota" (functions-ota/, which owns
// OTA_WEBHOOK_SECRET for the still-undeployed inbound otaWebhook/
// processOtaEvent/otaCatchUp). Cloud Functions v2 secret discovery
// validates every declared secret across a WHOLE codebase before --only
// filtering applies -- so as long as OTA_WEBHOOK_SECRET has no value set,
// functions-ota cannot deploy ANY function in it, including one (like this
// worker) that never reads that secret. This codebase declares ONLY
// BEDS24_REFRESH_TOKEN, so it deploys independently of that unrelated,
// still-unset secret -- the same reasoning that originally split "core"
// from "ota", applied one level further.
//
// VILU PMS = SOLE PMS / SOURCE OF TRUTH. BEDS24 = API/CHANNEL TRANSPORT
// BRIDGE ONLY. This worker computes nothing about pricing/availability
// itself -- it always re-derives the current, absolute Vilu state via
// buildDifferentialPayload() (functions/lib/beds24-bridge.js) at the moment
// it runs, never trusting a value captured when the job was enqueued.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { FirestoreStore } = require('./lib/store-firestore');
const { Beds24Adapter } = require('./lib/adapters');
const { PHYSICAL_ROOMS } = require('./lib/inventory');
const { BEDS24_ROOM_MAP, buildDifferentialPayload, buildChannelRateDifferentialPayload } = require('./lib/beds24-bridge');
const { CODE_TO_ROOM_TYPE_ID, INITIAL_OTA_ROOM_TYPES } = require('./lib/ota-room-types');
const { otaFeatureEnabled, OUTBOUND_JOB_INTENT_FLAG } = require('./lib/ota-feature-flags');
const { CHANNEL_PRICING_RULES, INITIAL_CANONICAL_RATES } = require('./lib/channel-pricing');

// job_intent -> buildDifferentialPayload's `mode` (Phase B24-2A.1, Section
// D/E): now a strict 1:1 identity mapping across the 3 final intents
// (availability/rate/restriction), each authorizing exactly one payload
// mode that can only ever emit that category's fields (see beds24-bridge.js
// buildDatePayload's mode allowlists). Kept as its own explicit map, not a
// direct `job.job_intent` passthrough, so a FUTURE new intent value that
// doesn't map 1:1 to an existing payload mode still has one deliberate place
// to encode that -- and, same as OUTBOUND_JOB_INTENT_FLAG, an intent absent
// from this map must never silently resolve to any mode (see the fail-closed
// check below, which already returns before this map is ever consulted for
// an unrecognized intent).
const JOB_INTENT_TO_PAYLOAD_MODE = Object.freeze({ availability: 'availability', rate: 'rate', restriction: 'restriction' });

initializeApp();
const db = getFirestore();
const store = new FirestoreStore(db);

// Secret lives ONLY in Secret Manager (firebase functions:secrets:set ...).
const BEDS24_TOKEN = defineSecret('BEDS24_REFRESH_TOKEN');

async function roomsDocs() {
  try {
    const s = await db.collection('rooms').get();
    const out = s.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((r) => /^VR0[1-6]$/.test(r.id));
    return out.length ? out : PHYSICAL_ROOMS;
  } catch (e) { return PHYSICAL_ROOMS; }
}

// Falls back to the bundled INITIAL_OTA_ROOM_TYPES constant when the
// Firestore ota_room_types/{roomTypeId} doc is missing -- the same
// established pattern roomsDocs() above already uses for the `rooms`
// collection (Firestore is the live source once an admin edits a category's
// commercial config; the bundled constant is the safety net so a first
// deploy, before any doc is ever written, still resolves a valid config
// instead of failing every push).
async function roomTypeConfig(roomTypeCode) {
  const roomTypeId = CODE_TO_ROOM_TYPE_ID[roomTypeCode];
  if (!roomTypeId) return null;
  try {
    const doc = await store.get('ota_room_types', roomTypeId);
    if (doc) return doc;
  } catch (e) { /* fall through to bundled default */ }
  return INITIAL_OTA_ROOM_TYPES[roomTypeId] || null;
}

// Canonical seasonal base-rate calendar for one room type (PMS-driven
// multi-slot OTA rates pass) -- canonical_room_rates/{roomTypeId} = {
// intervals: [{from,to,rate}, ...] }. Same "Firestore-live overrides the
// bundled default" fallback pattern as roomTypeConfig() above: an admin's
// edit through the future PMS UI (Phase R11) is the live source once it
// exists; INITIAL_CANONICAL_RATES is the safety net so a first deploy,
// before any doc is ever written, still resolves the Cloudbeds-verified
// schedule instead of failing every channel-rate push.
async function canonicalRates(roomTypeCode) {
  const roomTypeId = CODE_TO_ROOM_TYPE_ID[roomTypeCode];
  if (!roomTypeId) return null;
  try {
    const doc = await store.get('canonical_room_rates', roomTypeId);
    if (doc && doc.intervals) return doc;
  } catch (e) { /* fall through to bundled default */ }
  return INITIAL_CANONICAL_RATES[roomTypeId] || null;
}

// Per-date rate overrides for one OTA room type (Bulk Price Manager's
// category-level date-range edits) -- ota_room_type_overrides/{roomTypeId}
// = { overrides: { 'YYYY-MM-DD': rate } }. Reused as-is by
// buildDifferentialPayload()'s pre-existing `dateOverrides` parameter
// (functions-beds24/lib/beds24-bridge.js resolveRate()), which until now no
// caller in this codebase ever supplied. Missing doc / read failure = no
// overrides for that type, never a thrown error -- an override-less push is
// simply the category's flat base_rate, which is already correct.
async function roomTypeOverrides(roomTypeCode) {
  const roomTypeId = CODE_TO_ROOM_TYPE_ID[roomTypeCode];
  if (!roomTypeId) return {};
  try {
    const doc = await store.get('ota_room_type_overrides', roomTypeId);
    return (doc && doc.overrides) || {};
  } catch (e) { return {}; }
}

// ── Beds24 outbound differential-sync worker ────────────────────────────────
// Triggered by ota_pushes doc CREATION -- but ota_pushes also receives
// 'availability' audit docs from syncAvailability() (functions-core), so
// this MUST no-op on anything that isn't a pending beds24_calendar_push
// job, never assume every doc here is its own work. Reads CURRENT Vilu
// state fresh (never trusts a value from when the job was enqueued --
// always absolute truth, never previous+1/-1, so a delayed or duplicate
// job can never drift Beds24 away from Vilu's real state). Never marks the
// job succeeded unless Beds24 itself confirms it; never touches Vilu PMS
// data. Bounded retry (never infinite) distinguishes retryable (429/5xx)
// from non-retryable (4xx other than 429, or a caller/mapping bug) failure.
const BEDS24_RETRYABLE_ATTEMPTS = 3;
const BEDS24_RETRY_BACKOFF_MS = [1000, 3000, 9000];
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

exports.beds24OutboundWorker = onDocumentCreated({ document: 'ota_pushes/{id}', secrets: [BEDS24_TOKEN] }, async (event) => {
  const snap = event.data; if (!snap) return;
  const jobRef = db.collection('ota_pushes').doc(event.params.id);
  const job = snap.data();
  if (!job || job.type !== 'beds24_calendar_push' || job.status !== 'pending') return; // not our job (e.g. an 'availability' audit doc, or already processed)

  // Phase B24-2A, Section D: FAIL CLOSED on a missing/unrecognized
  // job_intent. This is what makes it impossible for a job to be queued
  // under one feature and accidentally executed under another -- an old
  // pre-B24-2A job (no job_intent field at all) is treated exactly like an
  // unknown one, never processed just because it happens to be well-formed
  // otherwise.
  const requiredFlag = OUTBOUND_JOB_INTENT_FLAG[job.job_intent];
  if (!requiredFlag) {
    await jobRef.set({ status: 'skipped', last_error: { message: 'missing or unrecognized job_intent "' + job.job_intent + '" -- fail closed, job left for manual review', http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
    return;
  }

  const cfg = (await store.get('ota_config', 'channel_manager')) || {};
  // otaFeatureEnabled() already folds in the master `enabled` check (Section
  // B): cfg.enabled !== true alone is enough to disable every intent,
  // regardless of the specific granular flag's own value.
  if (cfg.provider !== 'beds24' || !otaFeatureEnabled(cfg, requiredFlag)) {
    await jobRef.set({ status: 'skipped', last_error: { message: 'Beds24 ' + requiredFlag + ' not enabled in ota_config for job_intent "' + job.job_intent + '" -- job left for a future controlled run', http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
    return;
  }

  const roomTypeCode = job.room_type_code;
  const affectedDates = (job.window && job.window.affected_dates) || [];
  if (!roomTypeCode || !BEDS24_ROOM_MAP[roomTypeCode] || !affectedDates.length) {
    await jobRef.set({ status: 'failed', last_error: { message: 'malformed job: missing room_type_code or affected_dates', http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
    return;
  }

  let payload; // [{roomId, calendar:[...]}] -- exactly one room here, either branch below
  if (job.job_intent === 'channel_rate') {
    // Phase R6: a SEPARATE payload path from the 3 pre-existing intents --
    // never routed through buildDifferentialPayload/JOB_INTENT_TO_PAYLOAD_MODE,
    // since a channel-rate job's rate comes from the NEW canonical seasonal
    // calendar + a per-channel rule, not from ota_room_types.base_rate. Fails
    // closed on an unknown/disabled/not-PMS-managed channel even though
    // job_intent itself already passed the OUTBOUND_JOB_INTENT_FLAG check
    // above -- that check only proves the INTENT is known, never that this
    // job's specific `channel` value is currently authorized (e.g. a stale
    // 'agoda' channel_rate job enqueued before Agoda's migration was reverted
    // must still be refused here, not just at enqueue time).
    const rule = CHANNEL_PRICING_RULES[job.channel];
    if (!rule || !rule.enabled || !rule.managed_by_pms) {
      await jobRef.set({ status: 'failed', last_error: { message: 'channel "' + job.channel + '" is not a currently enabled, PMS-managed channel -- fail closed', http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
      return;
    }
    const canonical = await canonicalRates(roomTypeCode);
    if (!canonical) {
      await jobRef.set({ status: 'failed', last_error: { message: 'no canonical_room_rates config found for ' + roomTypeCode, http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
      return;
    }
    const built = buildChannelRateDifferentialPayload({ roomTypeCode, dates: affectedDates, canonicalIntervals: canonical.intervals, rule });
    if (built.invalid.length) {
      await jobRef.set({ status: 'failed', last_error: { message: 'channel-rate differential payload invalid: ' + JSON.stringify(built.invalid.slice(0, 5)), http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
      return;
    }
    payload = built.grouped;
  } else {
    const payloadMode = JOB_INTENT_TO_PAYLOAD_MODE[job.job_intent];
    const config = await roomTypeConfig(roomTypeCode);
    if (!config) {
      await jobRef.set({ status: 'failed', last_error: { message: 'no ota_room_types config found for ' + roomTypeCode, http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
      return;
    }

    const rooms = await roomsDocs();
    const reservations = (await store.list('reservations')).map((d) => Object.assign({ id: d._id || d.id }, d));
    const blocks = (await store.list('blocks')).map((d) => Object.assign({ id: d._id || d.id }, d));
    const overridesForCode = await roomTypeOverrides(roomTypeCode);

    const built = buildDifferentialPayload({
      roomsDocs: rooms,
      reservations,
      blocks,
      affectedDates: { [roomTypeCode]: affectedDates },
      configs: { [roomTypeCode]: config },
      dateOverrides: { [roomTypeCode]: overridesForCode },
      mode: payloadMode,
    });
    if (built.invalid.length) {
      await jobRef.set({ status: 'failed', last_error: { message: 'differential payload invalid: ' + JSON.stringify(built.invalid.slice(0, 5)), http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
      return;
    }
    payload = built.grouped;
  }
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await jobRef.set({ status: 'in_flight', payload, payload_hash: payloadHash, updated_at: new Date().toISOString() }, { merge: true });

  const allowedRoomIds = new Set(Object.values(BEDS24_ROOM_MAP).map((r) => r.beds24_room_id));
  const adapter = new Beds24Adapter({ enabled: true, token: BEDS24_TOKEN.value() });

  let lastError = null;
  for (let attempt = 1; attempt <= BEDS24_RETRYABLE_ATTEMPTS; attempt++) {
    try {
      await adapter.pushAvailability(payload, { allowedRoomIds });
      await jobRef.set({ status: 'succeeded', attempt_count: attempt, last_error: null, updated_at: new Date().toISOString(), result: 'pushed', error_reason: null }, { merge: true });
      return;
    } catch (e) {
      // Sanitized logging only: HTTP status, our own error message, the
      // operation id -- never the refresh token, access token, or any
      // Authorization header (adapters.js's own tests confirm e.message
      // never contains a credential).
      lastError = { message: e.message, http_status: e.httpStatus || null };
      console.warn('beds24OutboundWorker attempt ' + attempt + ' failed for operation ' + event.params.id, lastError);
      if (e.retryable === false || attempt === BEDS24_RETRYABLE_ATTEMPTS) {
        await jobRef.set({ status: e.retryable === false ? 'failed' : 'review_required', attempt_count: attempt, last_error: lastError, updated_at: new Date().toISOString(), result: 'push_failed: ' + e.message, error_reason: e.message }, { merge: true });
        return;
      }
      await jobRef.set({ attempt_count: attempt, last_error: lastError, updated_at: new Date().toISOString() }, { merge: true });
      await sleep(BEDS24_RETRY_BACKOFF_MS[attempt - 1] || 9000);
    }
  }
});
