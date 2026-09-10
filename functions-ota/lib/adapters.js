'use strict';
// Deployment copy for the "ota" Functions codebase -- kept in sync with
// functions/lib/adapters.js (the canonical copy the test harness imports).
// Beds24Adapter is required by functions-ota/index.js's beds24OutboundWorker.
// Channel-manager adapters. Interface:
//   fetchBooking(externalId) → canonical booking (see ingest.js buildFields) | null
//   listModifiedSince(isoTs)  → [externalId]      (catch-up / reconciliation)
//   pushAvailability(payload) → { httpStatus, response }   (outbound differential sync)
//
// MockAdapter is what the sandbox harness drives -- pure in-memory, no
// network, deterministic. Beds24Adapter.pushAvailability() is the ONE real
// outbound network call in this whole codebase (2026-09-10 continuous-sync
// pass): it refreshes a short-lived access token from the caller-supplied
// refresh token (never persisted, never logged), then POSTs the already-
// built, already-range-compressed Beds24 calendar payload. fetchBooking()/
// listModifiedSince() remain unimplemented placeholders for the separate
// inbound-ingestion stage -- this pass is outbound only.
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
  }
  _guard() { if (!this.opts.enabled || !this.opts.token) throw new Error('BEDS24_NOT_CONFIGURED'); }
  async fetchBooking() { this._guard(); throw new Error('BEDS24_NOT_IMPLEMENTED_IN_THIS_STAGE'); }
  async listModifiedSince() { this._guard(); throw new Error('BEDS24_NOT_IMPLEMENTED_IN_THIS_STAGE'); }

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
