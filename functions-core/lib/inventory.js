'use strict';
// Deployment copy for the "core" Functions codebase — kept byte-identical to
// functions/lib/inventory.js (the canonical copy the test harness imports).
// Cloud Functions only uploads a codebase's own directory, so shared modules
// used by more than one codebase must physically exist in each; if you edit
// this file, apply the same edit to functions/lib/inventory.js and
// functions-ota/lib/inventory.js.
//
// Room-type inventory layer (Stage 1). Pure functions — no Firestore here.
//
// The PMS models PHYSICAL rooms only (room_availability/{VRxx} locks, blocks
// per room, reservations pinned to a room). OTAs sell ROOM TYPES. This module
// derives the sellable quantity per room type per date from the physical
// truth, so the physical-room lock stays the single conflict authority and a
// room can never be counted twice.
//
// Half-open intervals everywhere: a stay [check_in, check_out) occupies the
// nights check_in .. check_out-1, so a same-day check-out/check-in never
// conflicts — identical to isOcc()/hasBlockConflict()/writeReservation() in
// vilu-unified.html and blockDoubleBooking in index.js.

// Physical rooms and their sellable type — verified against VR[] in
// vilu-unified.html (2876-2882) and the website ROOMS list (3749-3760).
const PHYSICAL_ROOMS = [
  { id: 'VR01', name: 'Room 101', type: 'Deluxe Family Room' },
  { id: 'VR02', name: 'Room 102', type: 'Deluxe Family Room' },
  { id: 'VR03', name: 'Room 103', type: 'Double Room' },
  { id: 'VR04', name: 'Room 104', type: 'Double Room' },
  { id: 'VR05', name: 'Room 105', type: 'Double Room' },
  { id: 'VR06', name: 'Room 106', type: 'Deluxe Family Room with Open Deck' },
];

// Stable OTA-facing codes (what a channel manager room type maps to).
const ROOM_TYPE_CODES = {
  'Deluxe Family Room': 'DELUXE_FAMILY',
  'Double Room': 'DOUBLE',
  'Deluxe Family Room with Open Deck': 'DELUXE_FAMILY_OPEN_DECK',
};

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function isActiveStatus(status) {
  return status !== 'Cancelled' && status !== 'Checked out';
}

// Builds the type → eligible rooms map. `rooms` may come from the Firestore
// `rooms` collection ({id,type}) or default to the constant; the constant is
// always cross-checked so a typo in Firestore can never silently move a room
// to another type.
function buildRoomTypes(rooms) {
  const src = (rooms && rooms.length ? rooms : PHYSICAL_ROOMS).filter((r) => /^VR0[1-6]$/.test(r.id));
  const map = {};
  const errors = [];
  for (const r of src) {
    const constant = PHYSICAL_ROOMS.find((p) => p.id === r.id);
    if (!constant) { errors.push('unknown room ' + r.id); continue; }
    if (r.type && r.type !== constant.type) errors.push('room ' + r.id + ' type mismatch: ' + r.type + ' vs ' + constant.type);
    const type = constant.type;
    (map[type] = map[type] || []).push(r.id);
  }
  Object.keys(map).forEach((t) => map[t].sort());
  return { types: map, codes: ROOM_TYPE_CODES, errors };
}

function eligibleRooms(roomTypes, type) {
  return (roomTypes.types[type] || []).slice();
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Which physical rooms are unavailable on a given night.
// reservations: [{id, room_id, check_in, check_out, status}]
// blocks: [{id, room_id, from_date, to_date, reason, kind}]
function occupiedRoomsOnDate(date, reservations, blocks) {
  const next = addDays(date, 1);
  const occ = new Map(); // room → reason list
  for (const r of reservations) {
    if (!r || !r.room_id || !isActiveStatus(r.status)) continue;
    if (overlaps(r.check_in, r.check_out, date, next)) {
      const list = occ.get(r.room_id) || [];
      list.push('reservation:' + r.id);
      occ.set(r.room_id, list);
    }
  }
  for (const b of blocks) {
    if (!b || !b.room_id) continue;
    if (overlaps(b.from_date, b.to_date, date, next)) {
      const list = occ.get(b.room_id) || [];
      list.push((b.kind || 'block') + ':' + b.id);
      occ.set(b.room_id, list);
    }
  }
  return occ;
}

// Sellable inventory per room type per date.
// Returns [{room_type, room_type_code, date, total, available, occupied:[{room, reasons}]}]
function computeSellable({ roomTypes, reservations, blocks, from, to }) {
  const out = [];
  const types = Object.keys(roomTypes.types);
  for (const date of dateRange(from, to)) {
    const occ = occupiedRoomsOnDate(date, reservations || [], blocks || []);
    for (const type of types) {
      const rooms = roomTypes.types[type];
      const occupied = rooms.filter((r) => occ.has(r)).map((r) => ({ room: r, reasons: occ.get(r) }));
      out.push({
        room_type: type,
        room_type_code: roomTypes.codes[type] || type,
        date,
        total: rooms.length,
        available: rooms.length - occupied.length, // each room counted once
        occupied,
      });
    }
  }
  return out;
}

// Canonical outbound payload (Stage 6): grouped per type, dates → available.
function toOutboundPayload(sellable, generatedAt) {
  const byType = {};
  for (const s of sellable) {
    const t = byType[s.room_type_code] || (byType[s.room_type_code] = { room_type: s.room_type, room_type_code: s.room_type_code, total: s.total, dates: {} });
    t.dates[s.date] = { available: s.available };
  }
  return { generated_at: generatedAt || new Date().toISOString(), room_types: byType };
}

// Free physical rooms of a type for a stay, in deterministic order.
// preferred: room to keep first (modification keeps its room when possible).
function freeRoomsForStay({ roomTypes, type, checkIn, checkOut, reservations, blocks, excludeReservationIds, preferred }) {
  const excl = new Set(excludeReservationIds || []);
  const candidates = eligibleRooms(roomTypes, type);
  if (preferred && candidates.includes(preferred)) {
    candidates.splice(candidates.indexOf(preferred), 1);
    candidates.unshift(preferred);
  }
  return candidates.filter((room) => {
    const resClash = (reservations || []).some((r) => r.room_id === room && !excl.has(r.id) && isActiveStatus(r.status) && overlaps(r.check_in, r.check_out, checkIn, checkOut));
    if (resClash) return false;
    const blkClash = (blocks || []).some((b) => b.room_id === room && overlaps(b.from_date, b.to_date, checkIn, checkOut));
    return !blkClash;
  });
}

module.exports = { PHYSICAL_ROOMS, ROOM_TYPE_CODES, overlaps, isActiveStatus, buildRoomTypes, eligibleRooms, addDays, dateRange, occupiedRoomsOnDate, computeSellable, toOutboundPayload, freeRoomsForStay };
