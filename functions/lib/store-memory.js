'use strict';
// In-memory store with Firestore-like transaction semantics for the sandbox
// test harness (Stage 12). Transactions are serialised (Firestore guarantees
// serialisable isolation for contending transactions on the same docs — the
// loser is retried and sees the winner's writes; here the second caller simply
// runs after the first, which yields the same observable outcome).
class MemoryStore {
  constructor() { this.data = new Map(); this._queue = Promise.resolve(); this.writes = 0; }
  _key(col, id) { return col + '/' + id; }
  async get(col, id) { const v = this.data.get(this._key(col, id)); return v ? JSON.parse(JSON.stringify(v)) : null; }
  async set(col, id, data, opts) {
    const k = this._key(col, id);
    const cur = this.data.get(k);
    const next = (opts && opts.merge && cur) ? Object.assign({}, cur, data) : Object.assign({}, data);
    this.data.set(k, JSON.parse(JSON.stringify(next))); this.writes++;
  }
  async delete(col, id) { this.data.delete(this._key(col, id)); }
  async list(col) { const out = []; for (const [k, v] of this.data) if (k.startsWith(col + '/')) out.push(Object.assign({ _id: k.slice(col.length + 1) }, JSON.parse(JSON.stringify(v)))); return out; }
  async query(col, field, value) { return (await this.list(col)).filter((d) => d[field] === value); }
  async runTransaction(fn) {
    const run = async () => {
      const staged = [];
      const tx = {
        get: (col, id) => this.get(col, id),
        set: (col, id, data, opts) => { staged.push({ col, id, data, opts }); },
        update: (col, id, data) => { staged.push({ col, id, data, opts: { merge: true } }); },
      };
      const result = await fn(tx);
      for (const w of staged) await this.set(w.col, w.id, w.data, w.opts);
      return result;
    };
    const p = this._queue.then(run, run);
    this._queue = p.catch(() => {});
    return p;
  }
}
module.exports = { MemoryStore };
