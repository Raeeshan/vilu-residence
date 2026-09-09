'use strict';
// Deployment copy for the "ota" Functions codebase — kept in sync with
// functions/lib/adapters.js (the canonical copy the test harness imports).
// Channel-manager adapters. Interface:
//   fetchBooking(externalId) → canonical booking (see ingest.js buildFields) | null
//   listModifiedSince(isoTs)  → [externalId]      (catch-up / reconciliation)
//   pushAvailability(payload) → void              (Stage 6 outbound; not used yet)
//
// MockAdapter is what the sandbox harness drives. Beds24Adapter is a skeleton
// only: it has NO credentials, NO endpoint calls are made unless ota_config
// marks it enabled AND a secret is present — neither exists in this stage.

class MockAdapter {
  constructor() { this.bookings = new Map(); this.offline = false; this.fetches = 0; }
  put(booking) { this.bookings.set(String(booking.external_id), JSON.parse(JSON.stringify(booking))); }
  remove(id) { this.bookings.delete(String(id)); }
  async fetchBooking(id) { this.fetches++; if (this.offline) throw new Error('channel manager unreachable'); const b = this.bookings.get(String(id)); return b ? JSON.parse(JSON.stringify(b)) : null; }
  async listModifiedSince(iso) { return [...this.bookings.values()].filter((b) => String(b.revision) > String(iso || '')).map((b) => b.external_id); }
  async pushAvailability() { if (this.offline) throw new Error('channel manager unreachable'); }
}

class Beds24Adapter {
  constructor(opts) { this.opts = opts || {}; }
  _guard() { if (!this.opts.enabled || !this.opts.token) throw new Error('BEDS24_NOT_CONFIGURED'); }
  // Canonical mapping documented for the future stage; no network call is
  // made anywhere in this file until the owner enables the integration.
  async fetchBooking() { this._guard(); throw new Error('BEDS24_NOT_IMPLEMENTED_IN_THIS_STAGE'); }
  async listModifiedSince() { this._guard(); throw new Error('BEDS24_NOT_IMPLEMENTED_IN_THIS_STAGE'); }
  async pushAvailability() { this._guard(); throw new Error('BEDS24_NOT_IMPLEMENTED_IN_THIS_STAGE'); }
}

module.exports = { MockAdapter, Beds24Adapter };
