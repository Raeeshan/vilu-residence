'use strict';
// Deployment copy for the "core" Functions codebase — kept in sync with
// functions/lib/store-firestore.js and functions-ota/lib/store-firestore.js.
// Firestore (Admin SDK) implementation of the store interface used by the
// booking core / ingestion / availability modules. Keeping the interface tiny
// lets the same logic run against MemoryStore in the sandbox harness.
class FirestoreStore {
  constructor(db) { this.db = db; }
  async get(col, id) { const s = await this.db.collection(col).doc(id).get(); return s.exists ? s.data() : null; }
  async set(col, id, data, opts) { await this.db.collection(col).doc(id).set(data, opts && opts.merge ? { merge: true } : {}); }
  async delete(col, id) { await this.db.collection(col).doc(id).delete(); }
  async list(col) { const s = await this.db.collection(col).get(); return s.docs.map((d) => Object.assign({ _id: d.id }, d.data())); }
  async query(col, field, value) { const s = await this.db.collection(col).where(field, '==', value).get(); return s.docs.map((d) => Object.assign({ _id: d.id }, d.data())); }
  runTransaction(fn) {
    const db = this.db;
    return db.runTransaction(async (t) => {
      const staged = [];
      const tx = {
        get: async (col, id) => { const s = await t.get(db.collection(col).doc(id)); return s.exists ? s.data() : null; },
        set: (col, id, data, opts) => { staged.push(() => t.set(db.collection(col).doc(id), data, opts && opts.merge ? { merge: true } : {})); },
        update: (col, id, data) => { staged.push(() => t.set(db.collection(col).doc(id), data, { merge: true })); },
      };
      const result = await fn(tx); // all reads happen inside fn before any staged write is applied
      staged.forEach((w) => w());
      return result;
    });
  }
}
module.exports = { FirestoreStore };
