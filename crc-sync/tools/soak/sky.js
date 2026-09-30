'use strict';

// Simulated aircraft (briefing §5.3). Each airborne flight gets one aircraft
// flying a straight line near Incirlik, fed to the host's TrackStore every
// virtual 2 s. Seeded faults: wrong squawk, no transponder, callsign typo,
// shared callsign. DCS identity churn: per-aircraft re-mints and whole-mission
// reloads. After its flight ends an aircraft lingers 2-5 minutes, still
// squawking the code CodeAllocator is about to hand out again (H8).

const M_PER_NM = 1852;
const BASE = { lat: 37.0, lon: 35.42 }; // Incirlik
const BOX_M = 150000;

class Sky {
  constructor(rng) {
    this.rng = rng;
    this.aircraft = new Map(); // flightId -> aircraft
    this.byTrack = new Map();  // trackId (string) -> aircraft (includes re-minted-away ids for a while? no: current only)
    this.retiredTracks = new Map(); // trackId -> { flightId, fdrId } for ids an aircraft no longer uses — so a late correlation to one is attributable
    this._nextId = 16777300;
    this.pendingRemove = [];
    this.stats = { spawned: 0, remints: 0, reloads: 0, faults: { wrongSquawk: 0, noTransponder: 0, typo: 0, sharedCallsign: 0 }, conflictsInjected: 0, nonConformingAssignments: 0 };
  }

  _newId() { return this._nextId++; }

  /** A flight became airborne. `fdr` is { fdrId, callsign, code }. */
  spawn(flightId, fdr, now) {
    if (this.aircraft.has(flightId)) return this.aircraft.get(flightId);
    const r = this.rng;
    let callsign = fdr.callsign;
    let squawk = fdr.code || null;
    const faults = [];
    if (r.chance(0.08)) { squawk = randomCode(r, squawk); faults.push('wrongSquawk'); this.stats.faults.wrongSquawk++; }
    else if (r.chance(0.05 / 0.92)) { squawk = null; faults.push('noTransponder'); this.stats.faults.noTransponder++; }
    if (r.chance(0.05)) { callsign = typo(r, callsign); faults.push('typo'); this.stats.faults.typo++; }
    else if (r.chance(0.03 / 0.95)) {
      const other = r.pick([...this.aircraft.values()].filter(a => !a.done));
      if (other) { callsign = other.callsign; faults.push('sharedCallsign'); this.stats.faults.sharedCallsign++; }
    }
    const bearing = r.uniform(0, 2 * Math.PI);
    const dist = r.uniform(5000, 60000);
    const a = {
      flightId, fdrId: fdr.fdrId, trueCallsign: fdr.callsign, callsign, squawk, faults,
      id: this._newId(),
      x: Math.sin(bearing) * dist, y: Math.cos(bearing) * dist,
      altM: r.uniform(1500, 3000), targetAltM: r.uniform(4000, 9000),
      course: r.uniform(0, 360), gsMs: r.uniform(110, 220),
      vsMs: 0,
      nextRemintAt: now + r.exp(10 * 60000),
      done: false, removeAt: null,
    };
    this.aircraft.set(flightId, a);
    this.byTrack.set(String(a.id), a);
    this.stats.spawned++;
    return a;
  }

  /** The flight's last Strip is gone: keep squawking for 2-5 minutes, then vanish. */
  land(flightId, now) {
    const a = this.aircraft.get(flightId);
    if (!a || a.done) return;
    a.done = true;
    a.removeAt = now + this.rng.uniform(2 * 60000, 5 * 60000);
  }

  /** The controller assigned an altitude (Block 21, e.g. 'FL180'). Most pilots comply. */
  assignAltitude(flightId, value) {
    const a = this.aircraft.get(flightId);
    if (!a) return;
    const m = /^FL(\d{2,3})$/.exec(value);
    if (!m) return;
    if (this.rng.chance(0.9)) a.targetAltM = Number(m[1]) * 100 * 0.3048;
    else this.stats.nonConformingAssignments++;
  }

  /** Two aircraft on converging courses at one level, so STCA raises and then clears. */
  injectConflict() {
    const live = [...this.aircraft.values()].filter(a => !a.done);
    if (live.length < 2) return false;
    const [a, b] = [this.rng.pick(live), null];
    const others = live.filter(x => x !== a);
    const bb = this.rng.pick(others);
    if (!bb) return false;
    const c = (a.course * Math.PI) / 180;
    bb.x = a.x + Math.sin(c) * 6 * M_PER_NM;
    bb.y = a.y + Math.cos(c) * 6 * M_PER_NM;
    bb.course = (a.course + 180) % 360;
    bb.altM = a.altM; bb.targetAltM = a.altM; a.targetAltM = a.altM;
    a.gsMs = 180; bb.gsMs = 180;
    this.stats.conflictsInjected++;
    return !!b || true;
  }

  /** Advance every aircraft `dtMs`; returns the tracks command body. */
  step(now, dtMs) {
    const upsert = [];
    const remove = [];
    for (const [flightId, a] of this.aircraft) {
      if (a.done && now >= a.removeAt) {
        remove.push(a.id);
        this._retire(a);
        this.aircraft.delete(flightId);
        continue;
      }
      if (now >= a.nextRemintAt) {
        remove.push(a.id);
        this._retire(a);
        a.id = this._newId();
        this.byTrack.set(String(a.id), a);
        a.nextRemintAt = now + this.rng.exp(10 * 60000);
        this.stats.remints++;
      }
      const dt = dtMs / 1000;
      const dAlt = a.targetAltM - a.altM;
      a.vsMs = Math.abs(dAlt) < 5 ? 0 : Math.sign(dAlt) * Math.min(15, Math.abs(dAlt) / dt);
      a.altM += a.vsMs * dt;
      const c = (a.course * Math.PI) / 180;
      a.x += Math.sin(c) * a.gsMs * dt;
      a.y += Math.cos(c) * a.gsMs * dt;
      if (Math.abs(a.x) > BOX_M || Math.abs(a.y) > BOX_M) a.course = (a.course + 180) % 360;
      upsert.push(this._wire(a));
    }
    return { upsert, remove };
  }

  /** A DCS mission reload: every aircraft comes back under a new id. */
  reloadAll() {
    for (const a of this.aircraft.values()) {
      this._retire(a);
      a.id = this._newId();
      this.byTrack.set(String(a.id), a);
    }
    this.stats.reloads++;
  }

  _retire(a) {
    this.byTrack.delete(String(a.id));
    this.retiredTracks.set(String(a.id), { flightId: a.flightId, fdrId: a.fdrId });
    if (this.retiredTracks.size > 5000) this.retiredTracks.delete(this.retiredTracks.keys().next().value);
  }

  ownerOfTrack(trackId) {
    const a = this.byTrack.get(String(trackId));
    if (a) return { flightId: a.flightId, fdrId: a.fdrId, done: a.done, squawk: a.squawk, faults: a.faults };
    const r = this.retiredTracks.get(String(trackId));
    return r ? { ...r, retired: true } : null;
  }

  trackIdOf(flightId) {
    const a = this.aircraft.get(flightId);
    return a && !a.done ? a.id : null;
  }

  _wire(a) {
    const lat = BASE.lat + a.y / 111320;
    const lon = BASE.lon + a.x / (111320 * Math.cos((BASE.lat * Math.PI) / 180));
    return { id: a.id, callsign: a.callsign, squawk: a.squawk, lat, lon, alt: a.altM, course: a.course, groundSpeed: a.gsMs, verticalSpeed: a.vsMs };
  }
}

function randomCode(r, not) {
  for (;;) {
    const c = [0, 0, 0, 0].map(() => r.int(0, 7)).join('');
    if (c !== not && !/^(0000|7500|7600|7700|7400|7777)$/.test(c) && !c.startsWith('6')) return c;
  }
}

function typo(r, callsign) {
  if (!callsign || callsign.length < 2) return callsign;
  const i = r.int(1, callsign.length - 1);
  const ch = callsign[i];
  const repl = /\d/.test(ch) ? String((Number(ch) + 1) % 10) : (ch === 'X' ? 'Y' : 'X');
  return callsign.slice(0, i) + repl + callsign.slice(i + 1);
}

module.exports = { Sky };
