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
const { shouldAutoIngest } = require('./lib/beds24-inbound');

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

// Step 12 gate (Beds24 only -- MockAdapter/mock provider path is completely
// unaffected, matching every existing ota-core.test.js expectation): a
// Beds24 booking whose channel is not Booking.com/Expedia/Agoda is real and
// valid on Beds24's side, but is never auto-ingested into production Vilu.
// Reuses the EXISTING ota_conflicts collection (never a second review
// mechanism) with a new `reason: 'unrecognized_channel'` value alongside
// ingest.js's own 'unknown_room_type'/'no_physical_room' reasons.
async function raiseChannelReviewRecord(data, peeked) {
  const id = data.channel_manager + '_' + data.external_id + '_channel_' + Date.now();
  await db.collection('ota_conflicts').doc(id).set({
    open: true,
    channel_manager: data.channel_manager,
    external_id: data.external_id,
    event_type: data.type,
    reason: 'unrecognized_channel',
    detail: 'Beds24 channel "' + ((peeked && peeked._raw_channel) || 'unknown') + '" is not a recognized OTA for auto-ingestion (Booking.com/Expedia/Agoda only)',
    at: new Date().toISOString(),
  });
}

async function processQueued(queueId, data) {
  const { name, adapter } = await channelAdapter();
  const ref = db.collection('ota_queue').doc(queueId);
  if (!adapter) { await ref.set({ state: 'skipped', error_reason: 'no channel manager adapter configured (' + name + ')' }, { merge: true }); return; }
  if (name === 'beds24') {
    // Peek the booking's channel before deciding whether to ingest at all.
    // Beds24Adapter caches this fetch per invocation, so ingestEvent()'s own
    // internal fetchBooking() call below costs nothing extra against the
    // real Beds24 API.
    let peeked;
    try {
      peeked = await adapter.fetchBooking(data.external_id);
    } catch (e) {
      const retry = !!e.retryable && (data.retry_count || 0) < 6;
      await ref.set({ state: retry ? 'retry' : 'done', result: 'error', error_reason: e.message, processed_at: new Date().toISOString(), retry_count: (data.retry_count || 0) + (retry ? 1 : 0), next_retry_at: retry ? new Date(Date.now() + Math.min(60, 2 ** (data.retry_count || 0)) * 60000).toISOString() : null }, { merge: true });
      return;
    }
    if (peeked && !shouldAutoIngest(peeked)) {
      await raiseChannelReviewRecord(data, peeked);
      await ref.set({ state: 'done', result: 'unrecognized_channel_review', channel: peeked._raw_channel, processed_at: new Date().toISOString() }, { merge: true });
      return;
    }
    // peeked === null (Beds24 has no such booking) falls through to
    // ingestEvent(), which independently derives 'not_found' via its own
    // fetchBooking() call -- one consistent source of truth for that
    // outcome, not duplicated here.
  }
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
