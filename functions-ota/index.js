'use strict';
// Vilu Residence — Cloud Functions ("ota" codebase)
//   otaWebhook          channel-manager webhook receiver (trigger only; verifies secret)
//   processOtaEvent     Firestore-triggered idempotent ingestion (re-reads the booking from the CM)
//   otaCatchUp          every 30 min: re-pull bookings modified since the last cursor (+ retries)
//
// Split out of the original single-codebase functions/index.js: this is the
// ONLY codebase that declares BEDS24_REFRESH_TOKEN / OTA_WEBHOOK_SECRET, so
// its currently-unset secret values only block deploying THIS codebase, never
// the "core" codebase (functions-core/) that publicBooking/blockDoubleBooking/
// the availability triggers live in.
//
// No channel manager is connected in this stage: adapters resolve to "none"
// unless ota_config/channel_manager.enabled is true AND the BEDS24 secret is
// set — neither exists yet. Deploying this codebase does not connect
// anything; it only becomes reachable once real secret values and
// ota_config are set, which has not happened.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { FirestoreStore } = require('./lib/store-firestore');
const { ingestEvent } = require('./lib/ingest');
const { MockAdapter, Beds24Adapter } = require('./lib/adapters');
const { PHYSICAL_ROOMS } = require('./lib/inventory');
const { BEDS24_ROOM_MAP, buildDifferentialPayload } = require('./lib/beds24-bridge');
const { CODE_TO_ROOM_TYPE_ID } = require('./lib/ota-room-types');

initializeApp();
const db = getFirestore();
const store = new FirestoreStore(db);

// Secrets live ONLY in Secret Manager (firebase functions:secrets:set ...).
// Not set in this stage; functions that declare them fail closed.
const BEDS24_TOKEN = defineSecret('BEDS24_REFRESH_TOKEN');
const OTA_WEBHOOK_SECRET = defineSecret('OTA_WEBHOOK_SECRET');

async function roomsDocs() {
  try {
    const s = await db.collection('rooms').get();
    const out = s.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((r) => /^VR0[1-6]$/.test(r.id));
    return out.length ? out : PHYSICAL_ROOMS;
  } catch (e) { return PHYSICAL_ROOMS; }
}

async function channelAdapter() {
  const cfg = (await store.get('ota_config', 'channel_manager')) || {};
  if (cfg.enabled && cfg.provider === 'beds24') return { name: 'beds24', adapter: new Beds24Adapter({ enabled: true, token: BEDS24_TOKEN.value() }) };
  if (cfg.enabled && cfg.provider === 'mock') { const m = new MockAdapter(); const s = await db.collection('ota_mock_bookings').get(); s.forEach((d) => m.put(d.data())); return { name: 'mock', adapter: m }; }
  return { name: cfg.provider || 'none', adapter: null };
}

// ── OTA ingestion (Stages 3/4/9/10/11) ───────────────────────────────────────
// Webhook = trigger only. Verifies the shared secret (constant-time), then
// enqueues an ota_queue doc; the Firestore trigger below does the
// authoritative re-read + idempotent processing, so a slow channel-manager
// API can never time out the webhook response and duplicates are harmless.
exports.otaWebhook = onRequest({ region: 'us-central1', secrets: [OTA_WEBHOOK_SECRET], maxInstances: 3 }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('');
  const provided = String(req.headers['x-vilu-webhook-secret'] || '');
  const expected = OTA_WEBHOOK_SECRET.value() || '';
  if (!expected || provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return res.status(401).send('');
  const cfg = (await store.get('ota_config', 'channel_manager')) || {};
  if (!cfg.enabled) return res.status(503).json({ error: 'OTA_DISABLED' });
  const body = req.body || {};
  const externalId = String((body.booking && body.booking.id) || body.external_id || body.booking_id || '');
  if (!externalId) return res.status(400).json({ error: 'NO_ID' });
  const revision = String((body.booking && body.booking.modifiedTime) || body.revision || '');
  const evt = String((body.booking && body.booking.status) || body.event || '');
  const type = /cancel/i.test(evt) ? 'cancel' : (/modif/i.test(evt) ? 'modify' : 'new');
  const queueId = cfg.provider + '_' + externalId + '_' + revision.replace(/[^A-Za-z0-9]/g, '') + '_' + Date.now();
  await db.collection('ota_queue').doc(queueId).set({ channel_manager: cfg.provider, external_id: externalId, revision, type, received_at: new Date().toISOString(), state: 'queued', retry_count: 0, source_ip_hash: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex').slice(0, 16) });
  return res.status(202).json({ queued: queueId });
});

async function processQueued(queueId, data) {
  const { name, adapter } = await channelAdapter();
  const ref = db.collection('ota_queue').doc(queueId);
  if (!adapter) { await ref.set({ state: 'skipped', error_reason: 'no channel manager adapter configured (' + name + ')' }, { merge: true }); return; }
  const result = await ingestEvent({ store, adapter, roomsDocs: await roomsDocs(), event: { channel_manager: name, external_id: data.external_id, revision: data.revision, type: data.type, retry_count: data.retry_count || 0 } });
  const retry = result.result === 'error' && result.retryable && (data.retry_count || 0) < 6;
  await ref.set({ state: retry ? 'retry' : 'done', result: result.result, event_id: result.event_id || null, vilu_reservation_ids: result.docs || [], processed_at: new Date().toISOString(), retry_count: (data.retry_count || 0) + (retry ? 1 : 0), next_retry_at: retry ? new Date(Date.now() + Math.min(60, 2 ** (data.retry_count || 0)) * 60000).toISOString() : null }, { merge: true });
}

exports.processOtaEvent = onDocumentCreated({ document: 'ota_queue/{queueId}', secrets: [BEDS24_TOKEN] }, async (event) => {
  const snap = event.data; if (!snap) return;
  await processQueued(event.params.queueId, snap.data());
});

// ── catch-up + retries (Stage 10) ────────────────────────────────────────────
exports.otaCatchUp = onSchedule({ schedule: 'every 30 minutes', secrets: [BEDS24_TOKEN] }, async () => {
  const { name, adapter } = await channelAdapter();
  if (!adapter) return;
  const cursorDoc = (await store.get('ota_config', 'cursor')) || {};
  const since = cursorDoc.modified_since || new Date(Date.now() - 6 * 3600e3).toISOString();
  const ids = await adapter.listModifiedSince(since);
  for (const id of ids) await db.collection('ota_queue').add({ channel_manager: name, external_id: String(id), revision: '', type: 'unknown', received_at: new Date().toISOString(), state: 'queued', retry_count: 0, origin: 'catch_up' });
  const retries = await db.collection('ota_queue').where('state', '==', 'retry').get();
  for (const d of retries.docs) { const x = d.data(); if (!x.next_retry_at || x.next_retry_at <= new Date().toISOString()) await processQueued(d.id, x); }
  await store.set('ota_config', 'cursor', { modified_since: new Date().toISOString(), last_catch_up: new Date().toISOString(), queued: ids.length }, { merge: true });
});

// ── Beds24 outbound differential-sync worker (continuous-sync pass) ────────
// Vilu PMS -> Beds24 API bridge outbound worker. Triggered by ota_pushes doc
// CREATION -- but ota_pushes also receives 'availability' audit docs from
// syncAvailability() (functions-core), so this MUST no-op on anything that
// isn't a pending beds24_calendar_push job, never assume every doc here is
// its own work. Reads CURRENT Vilu state fresh (never trusts a value from
// when the job was enqueued -- Step 4/6 of the continuous-sync pass: always
// absolute truth, never previous+1/-1, so a delayed or duplicate job can
// never drift Beds24 away from Vilu's real state). Never marks the job
// succeeded unless Beds24 itself confirms it; never touches Vilu PMS data.
const BEDS24_RETRYABLE_ATTEMPTS = 3;
const BEDS24_RETRY_BACKOFF_MS = [1000, 3000, 9000];
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function roomTypeConfig(roomTypeCode) {
  const roomTypeId = CODE_TO_ROOM_TYPE_ID[roomTypeCode];
  if (!roomTypeId) return null;
  return store.get('ota_room_types', roomTypeId);
}

exports.beds24OutboundWorker = onDocumentCreated({ document: 'ota_pushes/{id}', secrets: [BEDS24_TOKEN] }, async (event) => {
  const snap = event.data; if (!snap) return;
  const jobRef = db.collection('ota_pushes').doc(event.params.id);
  const job = snap.data();
  if (!job || job.type !== 'beds24_calendar_push' || job.status !== 'pending') return; // not our job (e.g. an 'availability' audit doc, or already processed)

  const cfg = (await store.get('ota_config', 'channel_manager')) || {};
  if (!cfg.enabled || cfg.provider !== 'beds24') {
    await jobRef.set({ status: 'skipped', last_error: { message: 'Beds24 channel manager not enabled in ota_config -- job left for a future controlled run', http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
    return;
  }

  const roomTypeCode = job.room_type_code;
  const affectedDates = (job.window && job.window.affected_dates) || [];
  if (!roomTypeCode || !BEDS24_ROOM_MAP[roomTypeCode] || !affectedDates.length) {
    await jobRef.set({ status: 'failed', last_error: { message: 'malformed job: missing room_type_code or affected_dates', http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
    return;
  }

  const config = await roomTypeConfig(roomTypeCode);
  if (!config) {
    await jobRef.set({ status: 'failed', last_error: { message: 'no ota_room_types config found for ' + roomTypeCode, http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
    return;
  }

  const rooms = await roomsDocs();
  const reservations = (await store.list('reservations')).map((d) => Object.assign({ id: d._id || d.id }, d));
  const blocks = (await store.list('blocks')).map((d) => Object.assign({ id: d._id || d.id }, d));

  const built = buildDifferentialPayload({
    roomsDocs: rooms,
    reservations,
    blocks,
    affectedDates: { [roomTypeCode]: affectedDates },
    configs: { [roomTypeCode]: config },
  });
  if (built.invalid.length) {
    await jobRef.set({ status: 'failed', last_error: { message: 'differential payload invalid: ' + JSON.stringify(built.invalid.slice(0, 5)), http_status: null }, updated_at: new Date().toISOString() }, { merge: true });
    return;
  }
  const payload = built.grouped; // [{roomId, calendar:[...]}] -- exactly one room here
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await jobRef.set({ status: 'in_flight', payload, payload_hash: payloadHash, updated_at: new Date().toISOString() }, { merge: true });

  const allowedRoomIds = new Set(Object.values(BEDS24_ROOM_MAP).map((r) => r.beds24_room_id));
  const adapter = new Beds24Adapter({ enabled: true, token: BEDS24_TOKEN.value() });

  let lastError = null;
  for (let attempt = 1; attempt <= BEDS24_RETRYABLE_ATTEMPTS; attempt++) {
    try {
      const result = await adapter.pushAvailability(payload, { allowedRoomIds });
      await jobRef.set({ status: 'succeeded', attempt_count: attempt, last_error: null, updated_at: new Date().toISOString(), result: 'pushed', error_reason: null }, { merge: true });
      return;
    } catch (e) {
      // Sanitized logging only: HTTP status, our own error message, the
      // operation id -- never the refresh token, access token, or any
      // Authorization header. e.message never contains a credential (see
      // adapters.js's own tests confirming this).
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
