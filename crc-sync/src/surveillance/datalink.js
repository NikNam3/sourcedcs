'use strict';

// The datalink feed (docs/adr/0059): what the tactical side knows about its
// own aircraft without a radar return.
//
// Own-coalition units whose type is a network participant
// (sensor-specs.json `datalink.participants`) report themselves — position,
// callsign, type and altitude — every `pliPeriodMs`, the way Link 16 PPLI
// does. A controller whose Positions are granted the datalink (the
// `{kind: 'datalink'}` selector, facility-config.js) sees every participant,
// radar or no radar.
//
// Participants also report what their radar is locked on. That is polled
// from the mission scripting environment (Unit:getRadar()) and only ever
// names a contact: ws-hub.js drops a lock whose target is not already in the
// controller's picture, so the datalink never reveals a position the
// controller's own sensors have not.
//
// Players and AI both count. Everything here is [SOURCE-DEFINED].

const { USER_COALITION } = require('./iff');

function hashId(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A string as a Lua literal. */
function luaString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

class DatalinkFeed {
  /**
   * @param {object} deps
   * @param {(lua:string)=>Promise<any>} [deps.evalLua]  grpc-client's evalLua; without it there are no locks
   * @param {{getAll:()=>object[]}} deps.trackStore
   * @param {{participants:string[], pliPeriodMs:number}} deps.config  sensor-specs.json `datalink`
   * @param {number} [deps.ownCoalition]
   */
  constructor({ evalLua = null, trackStore, config, ownCoalition = USER_COALITION }) {
    this._eval = evalLua;
    this._tracks = trackStore;
    this._types = new Set((config && config.participants) || []);
    this._period = (config && config.pliPeriodMs) || 4000;
    this._own = ownCoalition;
    this._reports = new Map(); // trackId -> { at, callsign, type, lock }
    this._locks = new Map();   // trackId -> locked trackId
    this._polling = false;
  }

  isParticipant(track) {
    return track.coalition === this._own
      && (track.category === 1 || track.category === 2 || track.category === 4)
      && this._types.has(track.type);
  }

  /**
   * Brings every participant's report up to date. A participant reports on
   * its own fixed phase, so `at` moves once per period rather than every tick,
   * which is what lets the hub send it once per report.
   */
  tick(now = Date.now()) {
    const live = new Set();
    for (const track of this._tracks.getAll()) {
      if (!this.isParticipant(track)) continue;
      const id = String(track.id);
      live.add(id);
      const phase = hashId(id) % this._period;
      const at = now - ((((now - phase) % this._period) + this._period) % this._period);
      this._reports.set(id, {
        at, callsign: track.callsign || null, type: track.type || null, lock: this._locks.get(id) || null,
      });
    }
    for (const id of [...this._reports.keys()]) if (!live.has(id)) this._reports.delete(id);
    for (const id of [...this._locks.keys()]) if (!live.has(id)) this._locks.delete(id);
  }

  /** trackId -> { at, callsign, type, lock } for every participant, as of the last tick. */
  reports() { return this._reports; }

  /**
   * Asks the mission what each participant's radar is locked on. One Eval for
   * all of them; a participant with its radar off or nothing locked has no
   * entry. Skipped while the previous poll is still in flight.
   */
  async pollLocks() {
    if (!this._eval || this._polling) return;
    const participants = this._tracks.getAll().filter(t => this.isParticipant(t) && t.name);
    if (participants.length === 0) { this._locks.clear(); return; }
    this._polling = true;
    try {
      const lua = `
local names = {${participants.map(t => luaString(t.name)).join(', ')}}
local out = {}
for _, n in ipairs(names) do
  local u = Unit.getByName(n)
  if u then
    local ok, on, tgt = pcall(function() return u:getRadar() end)
    if ok and on and tgt then
      local ok2, tname = pcall(function() return tgt:getName() end)
      if ok2 and tname then out[n] = tname end
    end
  end
end
return net.lua2json(out)`.trim();
      const result = await this._eval(lua);
      this.applyLocks(result && !Array.isArray(result) ? result : {});
    } catch (_) {
      // evalLua logs; a failed poll just leaves the last answer standing
    } finally {
      this._polling = false;
    }
  }

  /** @param {Object<string,string>} byUnitName  participant unit name -> locked unit name */
  applyLocks(byUnitName) {
    const idByName = new Map();
    for (const t of this._tracks.getAll()) if (t.name) idByName.set(t.name, String(t.id));
    this._locks.clear();
    for (const [unitName, targetName] of Object.entries(byUnitName)) {
      const from = idByName.get(unitName);
      const to = idByName.get(targetName);
      if (from && to && from !== to) this._locks.set(from, to);
    }
  }

  clear() {
    this._reports.clear();
    this._locks.clear();
  }
}

module.exports = { DatalinkFeed, luaString };
