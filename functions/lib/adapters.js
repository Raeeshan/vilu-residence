'use strict';
// Channel-manager adapters. Interface:
//   fetchBooking(externalId) → canonical booking (see ingest.js buildFields) | null
//   listModifiedSince(isoTs)  → [externalId]      (catch-up / reconciliation)
//   pushAvailability(payload) → { httpStatus, response }   (outbound differential sync)
//
// MockAdapter is what the sandbox harness drives -- pure in-memory, no
// network, deterministic. Beds24Adapter now implements all three real
// network operations: pushAvailability() (outbound, built in the prior
// continuous-sync pass) and fetchBooking()/listModifiedSince() (inbound,
// this pass) -- GET /bookings, normalized via beds24-inbound.js into the
// exact canonical shape ingest.js already expects. ingest.js itself is
// never touched: every Beds24-specific field name is translated here and
// in beds24-inbound.js only.
const { normalizeBeds24Booking } = require('./beds24-inbound');
class MockAdapter {
  constructor() { this.bookings = new Map(); this.offline = false; this.fetches = 0; }
  put(booking) { this.bookings.set(String(booking.external_id), JSON.parse(JSON.stringify(booking))); }
  remove(id) { this.bookings.delete(String(id)); }
  async fetchBooking(id) { this.fetches++; if (this.offline) throw new Error('channel manager unreachable'); const b = this.bookings.get(String(id)); return b ? JSON.parse(JSON.stringify(b)) : null; }
  async listModifiedSince(iso) { return [...this.bookings.values()].filter((b) => String(b.revision) > String(iso || '')).map((b) => b.external_id); }
  async pushAvailability() { if (this.offline) throw new Error('channel manager unreachable'); }
}

class Beds24Adapter {
  // opts: { enabled, token (the REFRESH token value -- never the access
  // token), fetchImpl (optional, for dependency-injected testing; defaults
  // to the global fetch, available on Node 20) }
  constructor(opts) {
    this.opts = opts || {};
    this._fetch = this.opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    // Per-invocation booking cache: lets a caller (the inbound processor's
    // channel-recognition gate, see functions-ota/index.js) fetch+inspect a
    // booking once before deciding whether to call ingestEvent() -- which
    // itself calls fetchBooking() again internally -- without doubling the
    // real Beds24 API cost. Never persisted beyond this adapter instance's
    // lifetime (a fresh instance is created per function invocation).
    this._bookingCache = new Map();
  }
  _guard() { if (!this.opts.enabled || !this.opts.token) throw new Error('BEDS24_NOT_CONFIGURED'); }

  // Fetches ONE booking authoritatively from Beds24 (never trusts a webhook
  // payload for booking content -- see ingest.js's own "webhook = trigger
  // only" contract). Returns the canonical shape via normalizeBeds24Booking(),
  // or null if Beds24 genuinely has no such booking (ingestEvent treats a
  // falsy return as 'not_found', matching a real deletion/invalid id).
  async fetchBooking(externalId) {
    this._guard();
    if (this._bookingCache.has(externalId)) return this._bookingCache.get(externalId);
    const accessToken = await this._getAccessToken();
    const params = new URLSearchParams();
    params.append('id', externalId);
    params.set('includeInvoiceItems', 'true');
    params.set('includeGuests', 'true');
    const resp = await this._fetch('https://beds24.com/api/v2/bookings?' + params.toString(), { headers: { token: accessToken } });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* handled by the ok/data check below */ }
    if (!resp.ok || !data || !Array.isArray(data.data)) {
      const err = new Error('BEDS24_FETCH_BOOKING_FAILED: HTTP ' + resp.status);
      err.httpStatus = resp.status;
      err.retryable = resp.status === 429 || resp.status >= 500;
      throw err;
    }
    const raw = data.data.find((b) => String(b.id) === String(externalId)) || null;
    const normalized = raw ? normalizeBeds24Booking(raw) : null;
    this._bookingCache.set(externalId, normalized);
    return normalized;
  }

  // Catch-up/reconciliation (Step 15): lists external_ids modified since a
  // given ISO timestamp, across every real Beds24 booking status INCLUDING
  // cancelled -- GET /bookings only returns confirmed/request/new/black/
  // inquiry by default (confirmed against the live OpenAPI spec), so a
  // cancellation would be silently missed by catch-up without explicitly
  // requesting status=cancelled too. Single-page only for now (bounded,
  // documented limitation -- see the build report); a 30-minute catch-up
  // window is not expected to exceed one page in this property's volume.
  async listModifiedSince(sinceIso) {
    this._guard();
    const accessToken = await this._getAccessToken();
    const params = new URLSearchParams();
    params.set('modifiedFrom', sinceIso);
    ['confirmed', 'request', 'new', 'cancelled', 'black', 'inquiry'].forEach((s) => params.append('status', s));
    const resp = await this._fetch('https://beds24.com/api/v2/bookings?' + params.toString(), { headers: { token: accessToken } });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* handled by the ok/data check below */ }
    if (!resp.ok || !data || !Array.isArray(data.data)) {
      const err = new Error('BEDS24_LIST_MODIFIED_FAILED: HTTP ' + resp.status);
      err.httpStatus = resp.status;
      err.retryable = resp.status === 429 || resp.status >= 500;
      throw err;
    }
    return data.data.map((b) => String(b.id));
  }

  // Exchanges the refresh token for a short-lived access token. The access
  // token is returned to the immediate caller only -- this class never
  // stores it on `this`, never logs it, and the caller (pushAvailability
  // below) never persists it either. HTTP failures are tagged `.retryable`
  // (429/5xx) vs. not (4xx other than 429 -- an invalid/expired refresh
  // credential is a config problem, not a transient one, and must never be
  // silently retried forever).
  async _getAccessToken() {
    this._guard();
    const resp = await this._fetch('https://beds24.com/api/v2/authentication/token', {
      headers: { refreshToken: this.opts.token },
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* handled by the ok/data check below */ }
    if (!resp.ok || !data || !data.token) {
      const err = new Error('BEDS24_REFRESH_FAILED: HTTP ' + resp.status);
      err.httpStatus = resp.status;
      err.retryable = resp.status === 429 || resp.status >= 500;
      throw err;
    }
    return data.token;
  }

  // payload: Beds24 wire-format array [{roomId, calendar:[...]}], already
  // built and range-compressed by beds24-bridge.js -- this method computes
  // nothing about rates/availability itself. `opts.allowedRoomIds` (a Set of
  // integers), when supplied, is validated BEFORE any network call; an
  // unknown roomId is a caller bug (wrong mapping), never retried. Only
  // returns successfully when Beds24 itself confirms every item succeeded --
  // a completed fetch() with an unexpected body is treated as failure, never
  // as silent success.
  async pushAvailability(payload, opts) {
    this._guard();
    const allowedRoomIds = opts && opts.allowedRoomIds;
    if (allowedRoomIds) {
      for (const item of payload) {
        if (!allowedRoomIds.has(item.roomId)) {
          const err = new Error('BEDS24_UNKNOWN_ROOM_ID: ' + item.roomId);
          err.retryable = false;
          throw err;
        }
      }
    }
    const accessToken = await this._getAccessToken();
    const resp = await this._fetch('https://beds24.com/api/v2/inventory/rooms/calendar', {
      method: 'POST',
      headers: { token: accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* handled by the confirmation check below */ }
    const beds24ConfirmedSuccess = resp.ok && Array.isArray(data) && data.length > 0 && data.every((d) => d.success === true);
    if (!beds24ConfirmedSuccess) {
      const err = new Error('BEDS24_PUSH_NOT_CONFIRMED: HTTP ' + resp.status);
      err.httpStatus = resp.status;
      err.retryable = resp.status === 429 || resp.status >= 500;
      err.responseBody = data;
      throw err;
    }
    return { httpStatus: resp.status, response: data };
  }
}

module.exports = { MockAdapter, Beds24Adapter };
