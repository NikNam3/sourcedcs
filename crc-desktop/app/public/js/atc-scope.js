'use strict';

// The ATC scope in the STARS scheme (crc-sync's docs/adr/0088; decisions H5,
// H41 variant B, H47, H48, H50, H71).
//
// crc-sync says per contact which scheme draws it (`scheme: 'TACTICAL'|'ATC'`,
// its presentation.js). A TACTICAL contact is drawn exactly as before. An ATC
// contact is drawn the way a STARS scope draws it, and what a STARS scope
// shows depends on the controller's RELATION to the aircraft rather than on
// whose side it is:
//
//   mine                        white Full Data Block (FDB), my letter
//   being handed to me          flashing white FDB, the sender's letter
//   pointed out to me           flashing yellow FDB with `PO`
//   someone else's              green Partial Data Block (PDB), their letter
//   nobody's, squawking         green Limited Data Block (LDB), `*`
//   nobody's, primary only      no block, `+`
//
// This file works the relation out from the EFSP Board every client already
// has (efsp-state.js) and holds the few pieces of LOCAL UI state STARS keeps
// per scope: what this controller has acknowledged or clicked down. None of it
// is synced; each scope acknowledges for itself, as on STARS. The text of a
// block is track-label.js's (atcBlockLines); geojson.js and map-setup.js draw
// it.
//
// Guarded module.exports at the end, like efsp-state.js, so node:test can
// require it without a browser.

// ── Colours (H41 variant B, and A for the black scope) ────────────────────
//
// MAP  — the app's dark map ("ATC map background" on): the approved variant B
//        values, softened for a non-black background, with a text halo.
// BLACK — the setting off: strict STARS, the measured TCW values (FAA
//        DOT/FAA/TC-08/15 Table 1), no halo.
const ATC_PALETTES = {
  MAP: {
    name: 'MAP', own: '#E6E6E6', other: '#3CE63C', pointout: '#FFFF00', alert: '#FF3C3C', sa: '#FFFF00',
    target: '#1E78FF', targetOpacity: 0.8, otherOpacity: 0.8, halo: 1,
    history: ['#1E50C8', '#4646AA', '#323282', '#34347A', '#2A2A6A'], historyOpacity: 0.7,
  },
  BLACK: {
    name: 'BLACK', own: '#FFFFFF', other: '#00FF00', pointout: '#FFFF00', alert: '#FF0000', sa: '#FFFF00',
    target: '#1E78FF', targetOpacity: 1, otherOpacity: 1, halo: 0,
    history: ['#1E50C8', '#4646AA', '#323282', '#28286E', '#1E1E5A'], historyOpacity: 1,
  },
};
// docs/adr/0058's conformance tag keeps the app's own colours on both
// backgrounds (H41 S10): it is not STARS, and must not look like STARS's
// yellow or red.
const ATC_CONFORM_COLOR = { bad: '#FF8A4C', attn: '#E0A83C' };
const ATC_DIM_GRAY = '#8C8C8C';

const ATC_SENDER_BLINK_MS = 5000;   // an accepted handoff / point-out blinks this long at the sender
const ATC_TIMESHARE_MS = 2000;      // ground speed and type alternate this often (approximation)
const ATC_COAST_SWEEPS = 2;         // a correlated track coasts after missing this many ATC sweeps
const ATC_COAST_FALLBACK_MS = 6000; // when no ATC radar says how often it sweeps
const ATC_HANDOFF_PRIMITIVES = new Set(['HANDOFF', 'AIT']);

// ── Local UI state (per scope, never synced) ──────────────────────────────
const _atcAcked = new Set();    // 'CA:<conflictId>', 'EM:<trackId>:<tag>', 'UN:<stripId>'
const _atcSeen = new Map();     // stripId -> { state, from, changedAt } — coordination states as this scope saw them
const _atcStage = new Map();    // 'HO:<stripId>' / 'PO:<stripId>' -> click-down stage
const _atcExpanded = new Set(); // trackIds whose PDB this controller opened into an FDB
const _atcOwnerSeen = new Map(); // trackId -> { mine, transferredAt } — for a same-Facility transfer, which has no PROPOSED step

/**
 * Records a Strip's coordination state as this scope sees it, and when it
 * last changed. A change this scope saw happen (e.g. PROPOSED -> ACTIVE) is
 * what may blink; one that was already so when the scope first looked is old
 * news and must not — otherwise every reconnect would flash every handoff
 * ever accepted.
 */
function _observe(strip, now) {
  const c = strip.coordination;
  const state = c ? `${c.primitive}:${c.state}` : null;
  const seen = _atcSeen.get(strip.stripId);
  if (!seen) { const first = { state, from: null, changedAt: null }; _atcSeen.set(strip.stripId, first); return first; }
  if (seen.state !== state) { seen.from = seen.state; seen.state = state; seen.changedAt = now; }
  return seen;
}

/** When this scope saw the Strip reach its current state from `from`, or null. */
function _changedFrom(strip, from, now) {
  const seen = _observe(strip, now);
  return seen.from === from && seen.changedAt != null ? seen.changedAt : null;
}

function _tofiControlled(strips) {
  return strips.some((s) => {
    const c = s.tofiCoordination;
    return !!c && ((c.direction === 'ENTRY' && c.state === 'ACTIVE') || (c.direction === 'EXIT' && c.state === 'PROPOSED'));
  });
}

/**
 * The controller's relation to one contact. Pure: everything comes in.
 *
 * Several Strips per flight are normal (per-Facility replicas after a
 * cross-Facility exchange, a TOFI mission line). The OWNER is the ATC Strip
 * that still holds the flight: a sender's Strip stops owning it once its
 * handoff is ACTIVE, a receiver's replica owns it only once it is, and a
 * point-out never moves ownership. Under tactical control (TOFI ENTRY
 * ACTIVE, or its EXIT still PROPOSED) the owner is the tactical side, shown
 * by its letter — `M` (H48).
 *
 * @param {object} t  the wire track
 * @param {object[]} strips  the live Strips of the flight the track is correlated to
 * @param {Set<string>} acting  the Positions this controller acts as
 * @param {(positionId:string)=>string|null} letterOf
 */
function atcRelation(t, strips, acting, letterOf) {
  const source = t && t.label && t.label.source;
  const live = (strips || []).filter(s => s && s.state !== 'DROPPED');
  const rel = {
    associated: (source === 'FDR' || source === 'FDR_PROVISIONAL') && live.length > 0,
    owner: null, ownerLetter: null, mine: false, tofi: false,
    handoffIn: null, handoffOut: null, handoffDone: null, poIn: null, poOut: null,
  };
  if (!rel.associated) return rel;
  const atcStrips = live.filter(s => s.role !== 'MISSION');

  for (const s of atcStrips) {
    const c = s.coordination;
    if (!c || !acting.has(s.ownerPositionId)) continue;
    const replica = !!c.mintedForCoordination;
    if (ATC_HANDOFF_PRIMITIVES.has(c.primitive)) {
      if (replica && c.state === 'PROPOSED') rel.handoffIn = { strip: s };
      else if (!replica && c.state === 'PROPOSED') rel.handoffOut = { strip: s, recipientLetter: letterOf(c.peerPositionId) || '' };
      else if (!replica && c.state === 'ACTIVE') rel.handoffDone = { strip: s };
    } else if (c.primitive === 'POINT_OUT') {
      if (replica && (c.state === 'PROPOSED' || c.state === 'ACTIVE')) rel.poIn = { strip: s, state: c.state };
      else if (!replica) rel.poOut = { strip: s, state: c.state, recipientLetter: letterOf(c.peerPositionId) || '' };
    }
  }

  const owners = atcStrips.filter((s) => {
    const c = s.coordination;
    if (!c) return true;
    if (c.mintedForCoordination) return ATC_HANDOFF_PRIMITIVES.has(c.primitive) && c.state === 'ACTIVE';
    return !(ATC_HANDOFF_PRIMITIVES.has(c.primitive) && c.state === 'ACTIVE');
  });
  const owner = owners.find(s => acting.has(s.ownerPositionId)) || owners[0] || null;
  if (owner) {
    rel.owner = owner.ownerPositionId;
    rel.mine = acting.has(owner.ownerPositionId);
    rel.ownerLetter = letterOf(owner.ownerPositionId) || owner.ownerPositionId.charAt(0);
  }
  if (_tofiControlled(live)) {
    const mission = live.find(s => s.role === 'MISSION');
    rel.tofi = true;
    rel.owner = mission ? mission.ownerPositionId : rel.owner;
    rel.ownerLetter = (mission && letterOf(mission.ownerPositionId)) || 'M';
    rel.mine = !!(mission && acting.has(mission.ownerPositionId));
  }
  return rel;
}

/**
 * What the scope draws for one contact: its block kind and colour, its
 * position character, and the indicators around its text.
 *
 * @param {object} t
 * @param {object} rel  atcRelation()
 * @param {object} env
 * @param {object} env.palette    ATC_PALETTES entry
 * @param {number} env.now        local ms, for blink windows
 * @param {string[]} env.conflicts  the STCA conflict ids this track is in
 * @param {{tag:string,color:string}|null} env.conform  docs/adr/0058's tag, if any
 * @param {boolean} env.coast
 */
function atcView(t, rel, env) {
  const P = env.palette;
  const now = env.now;
  const id = String(t.id);
  const hasSsr = (t.sources || []).includes('SSR');
  const conflicts = env.conflicts || [];

  const line0 = [];
  const em = typeof atcEmergencyTag === 'function' ? atcEmergencyTag(t) : '';
  if (em) line0.push({ text: em, color: P.alert, blink: !_atcAcked.has(`EM:${id}:${em}`) });
  if (conflicts.length) line0.push({ text: 'CA', color: P.alert, blink: conflicts.some(c => !_atcAcked.has(`CA:${c}`)) });
  if (t.iffOverride === 'hostile') line0.push({ text: 'SA', color: P.sa, blink: false }); // H47: steady
  if (env.conform && env.conform.tag) line0.push({ text: env.conform.tag, color: env.conform.color, blink: false });
  const forced = !!em || conflicts.length > 0;

  let kind; let color = P.other; let blinkBlock = false;
  const l1Suffix = [];
  let recipient = '';
  let posChar;

  if (!rel.associated) {
    kind = hasSsr ? 'LDB' : 'NONE';
    posChar = hasSsr ? '*' : '+';
  } else {
    posChar = rel.ownerLetter || '*';

    // Point-out to me: flashing yellow while proposed; steady yellow once
    // accepted, then a click to green, a click to a PDB (stages 1, 2, 3).
    let poStage = null;
    if (rel.poIn) {
      if (rel.poIn.state === 'PROPOSED') { _observe(rel.poIn.strip, now); poStage = 0; }
      else {
        const accepted = _changedFrom(rel.poIn.strip, 'POINT_OUT:PROPOSED', now);
        poStage = accepted != null ? (_atcStage.get(`PO:${rel.poIn.strip.stripId}`) || 1) : 3;
      }
    }
    // Handed off by me and accepted: blinks white for a few seconds, then
    // stays a white FDB until clicked green, then a PDB (stages 0, 1, 2).
    let hoStage = null;
    const done = _handedOn(rel, now);
    if (done) {
      hoStage = done.at != null ? (_atcStage.get(done.key) || 0) : 2;
      if (hoStage === 0 && done.at != null && now - done.at < ATC_SENDER_BLINK_MS) blinkBlock = true;
    }

    if (rel.handoffIn) { kind = 'FDB'; color = P.own; blinkBlock = true; }
    else if (poStage != null && poStage <= 1) { kind = 'FDB'; color = P.pointout; blinkBlock = poStage === 0; l1Suffix.push({ text: 'PO' }); }
    else if (rel.mine) { kind = 'FDB'; color = P.own; }
    else if (hoStage != null && hoStage <= 1) { kind = 'FDB'; color = hoStage === 0 ? P.own : P.other; }
    else if (poStage === 2 || forced || _atcExpanded.has(id)) { kind = 'FDB'; color = P.other; }
    else { kind = 'PDB'; color = P.other; }

    if (rel.handoffOut) recipient = rel.handoffOut.recipientLetter;
    if (rel.poOut) {
      const s = rel.poOut.strip;
      if (rel.poOut.state === 'PROPOSED') { _observe(s, now); l1Suffix.push({ text: `PO${rel.poOut.recipientLetter}` }); }
      else if (rel.poOut.state === 'ACTIVE') {
        const at = _changedFrom(s, 'POINT_OUT:PROPOSED', now);
        if (at != null && now - at < ATC_SENDER_BLINK_MS) l1Suffix.push({ text: 'PO', blink: true });
      } else if (rel.poOut.state === 'REJECTED') {
        const at = _changedFrom(s, 'POINT_OUT:PROPOSED', now);
        if (at != null && !_atcAcked.has(`UN:${s.stripId}`)) l1Suffix.push({ text: 'UN', blink: true });
      }
    }
    if (rel.handoffIn) _observe(rel.handoffIn.strip, now);
    if (rel.handoffOut) _observe(rel.handoffOut.strip, now);
  }

  const fdb = kind === 'FDB';
  return {
    kind, color, blinkBlock, line0, l1Suffix, recipient,
    coast: !!env.coast && rel.associated,
    posChar,
    posColor: fdb ? color : P.other,
    opacity: fdb ? 1 : P.otherOpacity,
    disc: !(env.coast && rel.associated),
  };
}

/**
 * A flight I handed on that this scope saw go: a cross-Facility handoff
 * accepted, or a same-Facility transfer (a Strip dragged TWR -> APP, which
 * moves at once with no PROPOSED step, guide §8). `at` is when this scope saw
 * it happen, or null when it was already so; `key` names its click-down stage.
 */
function _handedOn(rel, now) {
  if (rel.handoffDone) {
    const s = rel.handoffDone.strip;
    return { key: `HO:${s.stripId}`, at: _changedFrom(s, `${s.coordination.primitive}:PROPOSED`, now) };
  }
  if (rel.transferredAt != null) return { key: `TR:${rel.trackId}`, at: rel.transferredAt };
  return null;
}

/**
 * Remembers whether each contact was mine, and stamps `rel.transferredAt`
 * when this scope sees one stop being mine without a coordination exchange —
 * the same-Facility transfer, which STARS shows with the sender's post-accept
 * blink. Impure on purpose (local UI state); atcRelation stays pure.
 */
function atcNoteOwnership(id, rel, now) {
  rel.trackId = String(id);
  const seen = _atcOwnerSeen.get(rel.trackId);
  if (seen && seen.mine && !rel.mine && rel.associated && !rel.tofi && !rel.handoffDone && seen.transferredAt == null) {
    seen.transferredAt = now;
  }
  if (rel.mine) _atcOwnerSeen.set(rel.trackId, { mine: true, transferredAt: null });
  else if (!seen) _atcOwnerSeen.set(rel.trackId, { mine: false, transferredAt: null });
  const entry = _atcOwnerSeen.get(rel.trackId);
  rel.transferredAt = entry.transferredAt;
  return rel;
}

/** docs/adr/0058's conformance tag for a flight, without the conflict (the ATC block says `CA` for that). */
function atcConformTag(alerts) {
  const list = alerts || [];
  const bad = list.find(a => a.kind !== 'HEADING');
  if (bad && bad.kind === 'LEVEL_BUST') return { tag: `BUST${bad.deviationFt > 0 ? '+' : '−'}${Math.abs(bad.deviationFt)}`, color: ATC_CONFORM_COLOR.bad };
  if (bad && bad.kind === 'WRONG_WAY') return { tag: `ALT${bad.fpm < 0 ? '↓' : '↑'}`, color: ATC_CONFORM_COLOR.bad };
  const hdg = list.find(a => a.kind === 'HEADING');
  if (hdg) return { tag: `HDG${String(hdg.actual).padStart(3, '0')}`, color: ATC_CONFORM_COLOR.attn };
  return null;
}

/** The flight's ACTIVE assigned altitude (ft) and heading, from its FDR's clearance (docs/adr/0058). */
function atcAssigned(fdr) {
  if (!fdr || !fdr.clearance) return null;
  const active = (cell) => cell && (cell.entries || []).find(e => e.status === 'ACTIVE');
  const alt = active(fdr.clearance.altitude);
  const hdg = active(fdr.clearance.heading);
  return {
    altFt: alt && Number.isFinite(alt.parsed) ? alt.parsed : null,
    altBlock: alt && alt.block ? alt.block : null,
    hdg: hdg && Number.isFinite(hdg.parsed) ? hdg.parsed : null,
  };
}

// ── The session and the background ────────────────────────────────────────

/** Every radar this controller looks through is an ATC radar, and there is no datalink (H50: an ATC-only session). */
function atcOnlySession() {
  const radars = typeof coverageRadars !== 'undefined' ? coverageRadars : [];
  const datalink = typeof coverageDatalink !== 'undefined' ? coverageDatalink : false;
  return radars.length > 0 && radars.every(r => r.presentation === 'ATC') && !datalink;
}

/** The black strict-STARS scope: the personal setting is off, and only while the session is ATC-only (H71, question 1). */
function atcBlackScope() {
  const s = (typeof settings !== 'undefined' && settings) || {};
  return s.atcMapBackground === false && atcOnlySession();
}

function atcPalette() { return atcBlackScope() ? ATC_PALETTES.BLACK : ATC_PALETTES.MAP; }

// ── The picture, as geojson.js asks for it ────────────────────────────────

function _actingSet() {
  return new Set(typeof getActingPositions === 'function' ? getActingPositions() : []);
}

function _stripsFor(trackId) {
  if (typeof stripIdsForTrackId !== 'function' || typeof getEfspStrip !== 'function') return [];
  return stripIdsForTrackId(trackId).map(getEfspStrip).filter(Boolean);
}

function _letterOf(positionId) {
  return typeof getEfspPositionLetter === 'function' ? getEfspPositionLetter(positionId) : null;
}

/** How long after its last return a correlated ATC contact starts to coast. */
function atcCoastAfterMs() {
  const radars = typeof coverageRadars !== 'undefined' ? coverageRadars : [];
  const sweeps = radars.filter(r => r.presentation === 'ATC' && Number.isFinite(r.sweepMs)).map(r => r.sweepMs);
  return sweeps.length ? ATC_COAST_SWEEPS * Math.max(...sweeps) : ATC_COAST_FALLBACK_MS;
}

/**
 * Everything the map needs to draw one ATC contact. Coasting (H41 S6, a
 * correlated contact whose returns stopped) moves the symbol and block to the
 * dead-reckoned position, for as long as the app keeps the contact at all
 * (its fade window).
 */
function atcDisplay(id, t, now = Date.now()) {
  const palette = atcPalette();
  const strips = _stripsFor(id);
  const rel = atcNoteOwnership(id, atcRelation(t, strips, _actingSet(), _letterOf), now);
  const sinceReturn = now - ((typeof lastSweepMs !== 'undefined' && lastSweepMs.get(id)) || now);
  const coast = rel.associated && sinceReturn > atcCoastAfterMs();

  let lat = t.lat; let lon = t.lon;
  const hist = (typeof history !== 'undefined' && history.get && history.get(id)) || [];
  if (coast && typeof kinematics === 'function' && typeof projectPos === 'function') {
    const { heading, speedMs } = kinematics(hist);
    if (speedMs > 0) [lat, lon] = projectPos(t.lat, t.lon, heading, speedMs * (sinceReturn / 1000));
  }

  const conflicts = typeof stcaConflictsForTrack === 'function' ? stcaConflictsForTrack(id).map(c => c.id) : [];
  const fdr = strips.length && typeof getEfspFdr === 'function' ? getEfspFdr(strips[0].fdrId) : null;
  const conform = fdr && typeof conformanceAlertsForFdr === 'function' ? atcConformTag(conformanceAlertsForFdr(fdr.fdrId)) : null;
  const view = atcView(t, rel, { palette, now, conflicts, conform, coast });

  const speedKt = typeof kinematics === 'function' ? kinematics(hist).speedKt : 0;
  const lines = typeof atcBlockLines === 'function'
    ? atcBlockLines(t, view, { speedKt, assigned: atcAssigned(fdr), typePhase: Math.floor(now / ATC_TIMESHARE_MS) % 2 === 1 })
    : [];
  return { id, lat, lon, rel, view, palette, lines };
}

// ── Clicks on the target (the block's own click still opens the track panel) ──

/**
 * A click on an ATC target, as STARS uses it: accept what is offered to me,
 * acknowledge what is blinking, step a finished exchange down, else toggle the
 * PDB open into an FDB and back. Returns what it did, for tests and logs.
 */
function atcTargetClick(id, now = Date.now()) {
  const t = typeof tracks !== 'undefined' ? tracks.get(String(id)) : null;
  if (!t) return 'NONE';
  const rel = atcNoteOwnership(id, atcRelation(t, _stripsFor(id), _actingSet(), _letterOf), now);
  return atcApplyClick(t, rel, now, {
    conflicts: typeof stcaConflictsForTrack === 'function' ? stcaConflictsForTrack(id).map(c => c.id) : [],
    accept: (strip) => {
      if (typeof sendEfspMutation !== 'function') return;
      sendEfspMutation(strip.ownerPositionId, strip, { kind: strip.coordination.primitive, action: 'ACCEPT' });
    },
  });
}

/** atcTargetClick's decision, with the effects passed in (testable). */
function atcApplyClick(t, rel, now, { conflicts = [], accept = () => {} } = {}) {
  const id = String(t.id);
  if (rel.handoffIn) { accept(rel.handoffIn.strip); return 'ACCEPT_HANDOFF'; }
  if (rel.poIn && rel.poIn.state === 'PROPOSED') { accept(rel.poIn.strip); return 'ACCEPT_POINT_OUT'; }

  const em = typeof atcEmergencyTag === 'function' ? atcEmergencyTag(t) : '';
  if (em && !_atcAcked.has(`EM:${id}:${em}`)) { _atcAcked.add(`EM:${id}:${em}`); return 'ACK_EMERGENCY'; }
  const unacked = conflicts.filter(c => !_atcAcked.has(`CA:${c}`));
  if (unacked.length) { for (const c of unacked) _atcAcked.add(`CA:${c}`); return 'ACK_CONFLICT'; }
  if (rel.poOut && rel.poOut.state === 'REJECTED' && !_atcAcked.has(`UN:${rel.poOut.strip.stripId}`)) {
    _atcAcked.add(`UN:${rel.poOut.strip.stripId}`); return 'ACK_UNABLE';
  }

  const done = _handedOn(rel, now);
  if (done) {
    const stage = done.at != null ? (_atcStage.get(done.key) || 0) : 2;
    if (stage < 2) { _atcStage.set(done.key, stage + 1); return stage === 0 ? 'HANDOFF_GREEN' : 'HANDOFF_PDB'; }
  }
  if (rel.poIn && rel.poIn.state === 'ACTIVE') {
    const key = `PO:${rel.poIn.strip.stripId}`;
    const seen = _atcSeen.get(rel.poIn.strip.stripId);
    const live = seen && seen.changedAt != null && seen.from === 'POINT_OUT:PROPOSED';
    const stage = live ? (_atcStage.get(key) || 1) : 3;
    if (stage < 3) { _atcStage.set(key, stage + 1); return stage === 1 ? 'POINT_OUT_GREEN' : 'POINT_OUT_PDB'; }
  }

  if (_atcExpanded.has(id)) { _atcExpanded.delete(id); return 'COLLAPSE'; }
  if (rel.associated && !rel.mine) { _atcExpanded.add(id); return 'EXPAND'; }
  return 'NONE';
}

function _resetAtcScopeForTest() {
  _atcAcked.clear(); _atcSeen.clear(); _atcStage.clear(); _atcExpanded.clear(); _atcOwnerSeen.clear();
}

// ── The redraw clock and the background ───────────────────────────────────
//
// An ATC scope changes with time even when nothing arrives: blinks, the
// speed/type time-share, the post-accept blink window, coasting. So while any
// ATC contact is on the map, the map is redrawn on the same 500 ms beat as
// the app's own pulse. The black background is applied here too, so a change
// of Positions (coverage) or of the setting takes effect on the next beat.
let _atcBlackApplied = null;

function atcTick() {
  if (typeof mapReady === 'undefined' || !mapReady) return;
  const black = atcBlackScope();
  if (black !== _atcBlackApplied) {
    // Set after applying: restoring the theme marks the background dirty
    // (applyMapTheme -> atcBackgroundDirty), and that must not loop.
    if (typeof applyAtcBackground === 'function') applyAtcBackground(black);
    _atcBlackApplied = black;
  }
  // The block follows the app's label scale (applyScale sets it on the
  // tactical label layer only).
  if (typeof map !== 'undefined' && map.getLayer && map.getLayer('atc-labels') && map.getLayer('unit-labels')) {
    const size = map.getLayoutProperty('unit-labels', 'text-size');
    if (size !== map.getLayoutProperty('atc-labels', 'text-size')) {
      map.setLayoutProperty('atc-labels', 'text-size', size);
      map.setLayoutProperty('atc-symbols', 'text-size', size);
    }
  }
  if (typeof tracks === 'undefined') return;
  for (const t of tracks.values()) {
    if (t.scheme === 'ATC') { if (typeof updateMap === 'function') updateMap(); return; }
  }
}

/** Forces the background to be re-applied on the next beat (after the base theme repainted it). */
function atcBackgroundDirty() { _atcBlackApplied = null; }

if (typeof window !== 'undefined' && typeof setInterval === 'function' && !(typeof module !== 'undefined' && module.exports)) {
  setInterval(atcTick, 500);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ATC_PALETTES, ATC_CONFORM_COLOR, ATC_DIM_GRAY, ATC_SENDER_BLINK_MS, ATC_TIMESHARE_MS,
    atcRelation, atcNoteOwnership, atcView, atcConformTag, atcAssigned, atcApplyClick, atcOnlySession, atcBlackScope,
    atcPalette, atcCoastAfterMs, _resetAtcScopeForTest,
  };
}
