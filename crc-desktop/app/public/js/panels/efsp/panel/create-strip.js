'use strict';
import { _callsignOfFlightData } from './refusal.js';
import { _createStripBindEl, _createStripBtnEl, _createStripInputEl, _createStripMsgEl, _createStripTypeEl, _createStripStereoEl } from './state.js';
import { _resolveActingPositionId } from '../bay-view.js';
import { getActingPositions, sendEfspCreateStrip, sendEfspMutation } from '../efsp-ws.js';
import { facilityOfPosition } from '../facility-topology.js';
import { getAllEfspStrips, getEfspFlightData, liveStripsForCallsign } from '../efsp-state.js';
import { listStereoRoutesClient } from '../efsp-stereo-routes.js';
import { lookupFlightPlanClient } from '../efsp-flight-plan-lookup.js';
import { refreshAtoImportButton } from '../ato-import.js';

// Deliberately NOT window.prompt() — it's the only blocking native dialog
// anywhere in this codebase (grepped: zero other uses of prompt/alert/
// confirm), Electron's support for it is inconsistent across versions/
// webPreferences, and every other input flow here already uses an inline
// form. A silent no-op from a dialog that doesn't fire is
// indistinguishable from a broken button — this doesn't have that failure
// mode, and every rejection path is now visible instead of silent too.

export let _pendingCreateStripMutationId = null;

/**
 * Every CreateStrip the panel sends goes through here: the form is busy until the ack, and the ack's continuation (the
 * one ack path, efsp-ws.js) puts the outcome in the form. A refusal is also banner-worthy, so this returns false.
 */
export function _sendCreateStrip(actingPositionId, createOp, facilityId) {
  const id = sendEfspCreateStrip(actingPositionId, createOp, facilityId, { onAck: _onCreateStripAck });
  _pendingCreateStripMutationId = id;
  return id;
}

function _onCreateStripAck(ack) {
  _pendingCreateStripMutationId = null;
  // `detail` carries the only part worth reading for a whole class of rejection ("VALIDATION_ERROR" alone does not
  // tell a malformed callsign from an unknown stereo route); the reason stays as the prefix.
  const why = ack.detail ? `${ack.reason || 'rejected'} — ${ack.detail}` : (ack.reason || 'unknown error');
  _setCreateStripMsg(ack.ok ? '' : `Rejected: ${why}`, !ack.ok);
  return false;
}
// Guards the flight-plan lookup in _submitCreateStrip() against a double-
// submit while it's in flight (up to a few seconds — a real window a
// second Enter/click could land in, unlike the near-instant validation
// that runs before it).
let _createStripLookupInFlight = false;
// Callsign the duplicate-origination warning has already been shown for, so
// a second press goes through. Cleared on any successful create.
export let _pendingDuplicateCallsign = null;

// §9.10's canned-route table (docs/adr/0050). Static squadron configuration:
// it only changes when somebody edits a file and restarts crc-sync, so this
// is not polled the way `ops-filed`'s queue is (that queue is other people's
// live filings, which is a different kind of thing).
//
// But it IS refetched on every snapshot, not just at panel init, and that
// distinction cost a bug: the table changing implies a crc-sync restart,
// which drops every socket, and the reconnect delivers a fresh
// efsp-snapshot. Fetching only at init meant a squadron could edit the
// table, restart the service, and have every controller keep the OLD
// picker until they reloaded the whole app. A snapshot is exactly the event
// that means "the server you were talking to may not be the one you are
// talking to now", so it is the right trigger — and it is free, because
// the stereo-route refresh is a no-op re-render when nothing changed.
export let _stereoRoutes = [];
let _stereoRoutesInFlight = false;

export function _loadStereoRoutes() {
  // Fire and forget: the picker appears when the list lands. Nothing waits
  // on it, and the failure case is identical to the (shipped) empty-table
  // case — no picker, file by hand exactly as before. The in-flight latch
  // stops a burst of snapshots (a flapping connection) stacking fetches.
  if (_stereoRoutesInFlight) return;
  _stereoRoutesInFlight = true;
  listStereoRoutesClient().then((routes) => {
    _stereoRoutesInFlight = false;
    _stereoRoutes = Array.isArray(routes) ? routes : [];
    _refreshCreateStripAvailability();
  });
}

/**
 * Called from app.js when an efsp-snapshot lands — see _loadStereoRoutes.
 * Safe before initEfspPanel() has run: the fetch just populates the cache
 * and the render inside no-ops until the elements are cached.
 */
export function reloadEfspStereoRoutes() { _loadStereoRoutes(); }

/** The stereo name currently picked in the toolbar, or '' for none. */
function _selectedStereoName() {
  if (!_createStripStereoEl || _createStripStereoEl.hidden) return '';
  return _createStripStereoEl.value || '';
}

/**
 * Strip types a canned route can seed. DEPARTURE only, matching Block 9F's own
 * Block-Map placement: ARRIVAL's filed shape is originAirport/arrivalFix/
 * estimatedArrivalTimeUtc, MISSION has no filed route at all, and an
 * OVERFLIGHT by definition did not depart here, so a locally-defined route
 * out of this base is not what it filed.
 *
 * Takes the ORIGIN rather than the role string on purpose: OPS's entry in
 * CREATE_STRIP_ORIGINS carries `stripType: undefined` to mean DEPARTURE (the
 * server's own default), so a bare `stripType === 'DEPARTURE'` would exclude the
 * one Position that files these. _createStripOriginKey already normalises
 * the same way.
 */
export function _stereoEligibleOrigin(origin) {
  return !!origin && (origin.stripType || 'DEPARTURE') === 'DEPARTURE';
}

export function _setCreateStripMsg(text, isError) {
  if (!_createStripMsgEl) return;
  _createStripMsgEl.textContent = text || '';
  _createStripMsgEl.classList.toggle('efsp-msg-error', !!isError);
}

// WP4A (docs/adr/0014) started this as CTR self-originating ARRIVAL Strips
// — the same "no Facility further upstream is built yet" terminus stub
// OPS/DEPARTURE always had. docs/adr/0023 opens the same right to AP (for
// ARRIVAL, matching guide §4.1's "all" strip types for AP) and adds
// OVERFLIGHT for both — real pop-up ATC scenarios (a VFR aircraft picking
// up an IFR clearance airborne, an aircraft transiting Center's airspace
// without landing at Incirlik) have no sending Facility to HANDOFF from,
// so whichever Position takes the call originates the Strip directly.
//
// Every (Position, strip type) origin this app can ever originate a Strip from —
// a flat, exhaustive list rather than a priority order. An earlier version
// of this picked OPS unconditionally whenever it was held, silently
// ignoring AP/CTR even if ALSO held — wrong per guide §4.8.1's own
// framing: "under low manning the combined case is the NORMAL case," not
// an edge case to deprioritize. A controller holding OPS+AP+CTR at once
// (entirely plausible under low manning) must be able to originate any of
// the three, not just whichever this list happened to check first.
const CREATE_STRIP_ORIGINS = [
  { actingPositionId: 'OPS', facilityId: 'INCIRLIK', bayId: 'ops-proposed',    stripType: undefined,     label: 'OPS · Departure' },
  { actingPositionId: 'AP', facilityId: 'INCIRLIK', bayId: 'ap-inbound',     stripType: 'ARRIVAL',     label: 'AP · Arrival' },
  { actingPositionId: 'AP', facilityId: 'INCIRLIK', bayId: 'ap-overflight',  stripType: 'OVERFLIGHT',  label: 'AP · Overflight' },
  { actingPositionId: 'CTR', facilityId: 'CENTER',   bayId: 'ctr-enroute',     stripType: 'ARRIVAL',     label: 'CTR · Arrival' },
  { actingPositionId: 'CTR', facilityId: 'CENTER',   bayId: 'ctr-overflight',  stripType: 'OVERFLIGHT',  label: 'CTR · Overflight' },
  // WP4A second slice — TAC_C2/GCI self-originate a standalone MISSION
  // Strip (guide §9.8), for a mission that never needs to touch ATC-
  // controlled airspace at all. Distinct from a MISSION Strip minted as a
  // TOFI ENTRY exchange's byproduct (crc-sync's board/tofi.js
  // `receiveTofiProposal`), which shares its flight data with the ATC-side Strip
  // instead — both paths coexist, same "origin OR replica" duality
  // DEPARTURE/ARRIVAL Strips already have. GCI has no Tasked/Airborne Bay
  // of its own (guide §4.2 only gives those to TAC_C2 — AIC/GCI get the
  // narrower On Station/Committed/Coordination set), so its origin starts
  // already ON_STATION rather than at MISSION's default TASKED, matching
  // the one Bay it actually has to land in.
  { actingPositionId: 'TAC_C2', facilityId: 'TACTICAL', bayId: 'tac-c2-tasked', stripType: 'MISSION', label: 'TAC_C2 · Mission' },
  { actingPositionId: 'GCI', facilityId: 'TACTICAL',   bayId: 'gci-on-station', stripType: 'MISSION', label: 'GCI · Mission', initialState: 'ON_STATION' },
];

function _createStripOriginKey(o) { return `${o.actingPositionId}:${o.stripType || 'DEPARTURE'}`; }

/** Every origin CURRENTLY reachable, given the Positions actually signed on right now — not a fixed list, since signed-on Positions change live during a session (guide §4.1: "the set changes live during a session"). */
export function _availableCreateStripOrigins() {
  const signedOn = getActingPositions();
  return CREATE_STRIP_ORIGINS.filter(o => signedOn.includes(o.actingPositionId));
}

export function _createStripOrigin() {
  const available = _availableCreateStripOrigins();
  if (available.length === 0) return null;
  if (available.length === 1) return available[0]; // the common single-Position case — no picker was shown, nothing to read
  const selectedKey = _createStripTypeEl && _createStripTypeEl.value;
  return available.find(o => _createStripOriginKey(o) === selectedKey) || available[0];
}

/**
 * Flights a mission line could be fragged against — every live Strip that is
 * a flight rather than a mission line, minus any that already has one.
 *
 * Mirrors _marsaCandidates' shape in bay-view.js, including its rule that a
 * candidate the server would refuse is not offered at all: a control that
 * always fails is worse than no control.
 */
export function _missionBindCandidates() {
  const all = getAllEfspStrips();
  const taken = new Set(all.filter(s => s.stripType === 'MISSION' && s.state !== 'DROPPED').map(s => s.flightDataId));
  const seen = new Set();
  const out = [];
  for (const s of all) {
    if (s.stripType === 'MISSION' || s.state === 'DROPPED') continue;
    if (taken.has(s.flightDataId) || seen.has(s.flightDataId)) continue;
    seen.add(s.flightDataId);
    out.push(s);
  }
  return out;
}

/** The flightDataId the operator picked, or '' for today's standalone-origination path. */
function _selectedBindFlightDataId() {
  return (_createStripBindEl && !_createStripBindEl.hidden && _createStripBindEl.value) || '';
}

/**
 * The mission-line binding picker (crc-sync's docs/adr/0054) — how a mission
 * line comes to be the SAME flight as the ATC Strip, at fragging time.
 *
 * TAC_C2 only. GCI has no Tasked or Airborne Bay (guide §4.2 gives those to
 * TAC_C2 alone), so CREATE_STRIP_ORIGINS starts its mission lines already
 * ON_STATION — binding there would frag a mission line on station for a jet
 * still on the ramp.
 */
function _refreshMissionBindPicker(origin) {
  if (!_createStripBindEl) return;
  const eligible = !!origin && origin.stripType === 'MISSION' && origin.actingPositionId === 'TAC_C2';
  const candidates = eligible ? _missionBindCandidates() : [];
  // Same "no empty picker to puzzle over" rule the stereo select follows.
  _createStripBindEl.hidden = !eligible || candidates.length === 0;
  if (_createStripBindEl.hidden) return;

  const prev = _createStripBindEl.value;
  _createStripBindEl.innerHTML = '';
  // Blank first, so an unbound mission line stays the default and today's
  // behaviour is never something you have to deselect into.
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— not bound to a flight —';
  _createStripBindEl.appendChild(none);
  for (const s of candidates) {
    const flightData = getEfspFlightData(s.flightDataId);
    const id = flightData && flightData.identity ? flightData.identity : {};
    const opt = document.createElement('option');
    opt.value = s.flightDataId;
    // Callsign ALONE is not enough. Four jets in one package with adjacent
    // callsigns is exactly the mis-pick this has to survive, so the squawk
    // and the route are on the row to tell them apart.
    const route = (flightData && flightData.filed && flightData.filed.route) || '';
    opt.textContent = [id.callsign || s.flightDataId, id.beaconAssigned, route].filter(Boolean).join(' · ');
    _createStripBindEl.appendChild(opt);
  }
  if (candidates.some(s => s.flightDataId === prev)) _createStripBindEl.value = prev;
}

/**
 * The ATO-first direction (crc-sync docs/adr/0071, docs/adr/0054's promised
 * caller change). An ATO often arrives before the flight is filed: TAC_C2's
 * import made the flight and its mission line, and when OPS then files it,
 * the DEPARTURE must be the SAME flight — same flightDataId, same Mode 3/A, no second
 * code minted. So when OPS types a callsign that an ATO mission flight has
 * and that flight has no ATC Strip yet, the bind picker offers "file against
 * ATO mission <msn>", picked by default only when exactly one matches.
 * Sending it is the existing bind path (`op.flightDataId`), unchanged server-side.
 */
function _atoFirstCandidates(callsign) {
  const wanted = String(callsign || '').trim().toUpperCase();
  if (!wanted) return [];
  const all = getAllEfspStrips();
  const live = all.filter(s => s.state !== 'DROPPED');
  const out = [];
  const seen = new Set();
  for (const s of live) {
    if (s.stripType !== 'MISSION' || seen.has(s.flightDataId)) continue;
    seen.add(s.flightDataId);
    const flightData = getEfspFlightData(s.flightDataId);
    if (!flightData || !flightData.ato || !flightData.identity || flightData.identity.callsign !== wanted) continue;
    if (live.some(o => o.flightDataId === s.flightDataId && o.stripType !== 'MISSION')) continue; // already filed
    out.push(flightData);
  }
  return out;
}

export function _refreshAtoFirstPicker(origin) {
  if (!_createStripBindEl || !_createStripInputEl) return;
  if (!origin || origin.actingPositionId !== 'OPS' || (origin.stripType || 'DEPARTURE') !== 'DEPARTURE') return;
  const candidates = _atoFirstCandidates(_createStripInputEl.value);
  _createStripBindEl.hidden = candidates.length === 0;
  if (_createStripBindEl.hidden) { _createStripBindEl.value = ''; return; }
  const prev = _createStripBindEl.value;
  _createStripBindEl.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— a new flight —';
  _createStripBindEl.appendChild(none);
  for (const flightData of candidates) {
    const opt = document.createElement('option');
    opt.value = flightData.flightDataId;
    opt.textContent = `file against ATO mission ${flightData.ato.missionNumber || (flightData.mission && flightData.mission.missionNumber) || '?'} · ${flightData.identity.callsign} · ${flightData.identity.beaconAssigned}`;
    _createStripBindEl.appendChild(opt);
  }
  if (candidates.some(f => f.flightDataId === prev)) _createStripBindEl.value = prev;
  else _createStripBindEl.value = candidates.length === 1 ? candidates[0].flightDataId : '';
}

export function _refreshCreateStripAvailability() {
  if (!_createStripInputEl || !_createStripBtnEl) return;
  if (_createStripLookupInFlight) return; // don't fight the "Looking up flight plan…" message or re-enable mid-lookup — _submitCreateStrip owns this window
  const available = _availableCreateStripOrigins();
  if (_createStripTypeEl) {
    // Only actually a CHOICE when 2+ origins are simultaneously reachable
    // (a combined-Position controller) — the common single-Position case
    // keeps today's minimal toolbar, nothing to pick.
    _createStripTypeEl.hidden = available.length <= 1;
    if (!_createStripTypeEl.hidden) {
      const prevKey = _createStripTypeEl.value;
      _createStripTypeEl.innerHTML = '';
      for (const o of available) {
        const opt = document.createElement('option');
        opt.value = _createStripOriginKey(o);
        opt.textContent = o.label;
        _createStripTypeEl.appendChild(opt);
      }
      // Preserve the operator's prior choice across a Position-set change
      // (e.g. picking up a third Position) when it's still valid; default
      // to the first option otherwise — never silently reset a deliberate
      // choice out from under them.
      if (available.some(o => _createStripOriginKey(o) === prevKey)) _createStripTypeEl.value = prevKey;
    }
  }
  const origin = _createStripOrigin();
  if (_createStripStereoEl) {
    // Hidden unless a table is actually installed AND the selected origin
    // could use one. The shipped table is empty, so for a squadron that has
    // not written one this control never appears at all — no empty picker
    // to puzzle over, and the toolbar is byte-identical to before.
    const usable = _stereoRoutes.length > 0 && _stereoEligibleOrigin(origin);
    _createStripStereoEl.hidden = !usable;
    if (usable) {
      const prevName = _createStripStereoEl.value;
      _createStripStereoEl.innerHTML = '';
      // Blank first, so "no stereo" stays the default and the existing
      // hand-filing path is never something you have to deselect into.
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— no stereo —';
      _createStripStereoEl.appendChild(none);
      for (const r of _stereoRoutes) {
        const opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = r.description ? `${r.name} — ${r.description}` : r.name;
        _createStripStereoEl.appendChild(opt);
      }
      // Same "never silently reset a deliberate choice" rule the role
      // select above follows.
      if (_stereoRoutes.some(r => r.name === prevName)) _createStripStereoEl.value = prevName;
    }
  }
  _refreshMissionBindPicker(origin);
  refreshAtoImportButton(); // docs/adr/0071
  _refreshAtoFirstPicker(origin); // docs/adr/0071 — OPS files against an ATO mission
  _createStripInputEl.disabled = !origin;
  _createStripBtnEl.disabled = !origin;
  if (!origin) {
    _setCreateStripMsg('OPS, AP or CTR only — select one in Panels to create Strips', true);
  } else if (!_pendingCreateStripMutationId) {
    // Clear a stale "OPS/AP/CTR only"/validation message once one is
    // selected — but never stomp "Creating…" while an attempt is still in
    // flight.
    _setCreateStripMsg('', false);
  }
}

/**
 * docs/adr/0023 — converts this DEPARTURE Strip into its return-leg
 * ARRIVAL Strip IN PLACE: one Mutation (`ConvertToArrival`), same stripId,
 * same flightDataId, throughout. Two earlier versions of this feature spawned a
 * SECOND Strip/flight data instead (per guide §3.6's turnaround rule) — abandoned
 * after live testing found that approach left a stale departure Strip
 * behind and needed every field copied by hand, including a beacon code
 * that can't even be copied cleanly (flight-data-store.js's createFlightData always
 * auto-allocates a fresh one). Reusing the same flight data makes both problems
 * structurally impossible — there's nothing to copy, because nothing new
 * is created. crc-sync's `_applyConvertToArrival` (board/ops/convert-to-arrival.js) is authoritative
 * for the state/role/Bay/permission rules; this just sends the Mutation.
 */
export function convertStripToArrival(strip) {
  // _resolveActingPositionId (bay-view.js), like every other dispatch helper
  // — not strip.ownerPositionId unconditionally. The server now requires the
  // acting Position to be one this session is actually Primary at, so naming
  // the owner regardless of whether this controller holds it is a guaranteed
  // rejection rather than the silent pass it used to get.
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'ConvertToArrival' });
}

async function _submitCreateStrip() {
  if (!_createStripInputEl || _createStripLookupInFlight) return;

  const origin = _createStripOrigin();
  if (!origin) {
    _setCreateStripMsg('OPS, AP or CTR only — select one in Panels to create Strips', true);
    return;
  }
  // docs/ui-findings F-308 — the picker is read BEFORE the typed callsign is
  // validated, not after. A bound CreateStrip carries no `flightData` at all:
  // identity comes entirely from the flight it is fragged against. Demanding
  // a callsign here therefore asked for a value that was then thrown away,
  // and typing the NEIGHBOURING callsign fragged the picked flight without a
  // word — the adjacent-callsign mis-pick _refreshMissionBindPicker's own
  // comment says this has to survive. `.mission <CALLSIGN>` never had the
  // problem because it has no second source of identity to disagree with.
  const bindFlightDataId = _selectedBindFlightDataId();
  const boundCallsign = bindFlightDataId ? _callsignOfFlightData(bindFlightDataId) : '';
  const callsign = _createStripInputEl.value.trim().toUpperCase();
  if (bindFlightDataId) {
    // Not demanded — and not silently discarded either. Only the controller
    // knows which of the two flights they meant.
    if (callsign && boundCallsign && callsign !== boundCallsign) {
      _setCreateStripMsg(`${boundCallsign} is picked in the list but ${callsign} is typed — clear the callsign, or pick ${callsign} in the list`, true);
      return;
    }
  } else {
    if (!callsign) {
      _setCreateStripMsg('Enter a callsign first', true);
      return;
    }
    if (!/^[A-Z0-9]{1,7}$/.test(callsign)) {
      _setCreateStripMsg('Callsign must be 1-7 alphanumeric characters', true);
      return;
    }
  }

  // Duplicate-origination warning (§3.6). A flight handed off across a
  // Facility boundary is meant to be picked up by ACCEPTing the replica that
  // already exists for it — but nothing stopped a controller originating a
  // fresh, unlinked Strip for the same callsign instead, which then carries
  // its own beacon code and its own lifecycle for an aircraft that already
  // had both. Two presses, not a block: genuinely distinct flights do reuse
  // a callsign across a session, so this is the controller's call.
  //
  // SKIPPED in bind mode, deliberately. The warning's whole point is "you
  // are about to mint a second beacon code and a second lifecycle for a
  // flight that already has both" — binding is the precise opposite, the
  // very thing the warning tells you to do instead. Leaving it in would
  // make the good path harder than the bad one.
  const existing = bindFlightDataId ? [] : liveStripsForCallsign(callsign);
  if (existing.length > 0 && _pendingDuplicateCallsign !== callsign) {
    _pendingDuplicateCallsign = callsign;
    const where = existing.map(s => `${s.facilityId || '?'}/${s.ownerPositionId}`).join(', ');
    _setCreateStripMsg(`${callsign} already has a live Strip at ${where} — press again to create another anyway`, true);
    return;
  }
  _pendingDuplicateCallsign = null;

  // Flight-plan pre-fill (guide §10.1 "auto-population — do it
  // aggressively", §10.5 provenance fallback chains) — DEPARTURE-role
  // only: the DD1801 lookup maps onto route/altitude/departure+destination
  // airport/remarks (crc-sync's toFlightDataFiledSeed), which line up with
  // DEPARTURE's filed shape, not ARRIVAL's (originAirport/arrivalFix/
  // estimatedArrivalTimeUtc — a genuinely different set of fields),
  // OVERFLIGHT's (docs/adr/0023 — the fields it reuses mean the flight's
  // real origin/destination, not a plan filed FROM Incirlik, so a lookup
  // keyed on "departed Incirlik" would be actively wrong here), or
  // MISSION's (WP4A second slice — a mission line has no DD1801 flight
  // plan at all; its fields are mission number/package/controlling agency,
  // nothing a civil flight-plan lookup could ever populate). Bounded by
  // the lookup's own client-side timeout; ANY failure (unreachable, no
  // plan on file, malformed response) just leaves every field blank,
  // exactly like today's behavior — Strip creation is never blocked on
  // this succeeding, only delayed by a few seconds while it's tried.
  // §9.10 / docs/adr/0050 — filing by short name. A picked stereo SKIPS the
  // DD1801 lookup below entirely, rather than racing it: filing a canned
  // route is an explicit choice a controller just made, where the lookup is
  // a best-effort background guess, and §9.10's whole premise is the path
  // taken *without* the international form. Spending up to four seconds
  // fetching a plan whose fields the stereo would mostly supply anyway is
  // latency for nothing — and it keeps the server's seed-wins-over-stereo
  // precedence rule out of the one place a real controller could hit it.
  const stereoRouteName = _stereoEligibleOrigin(origin) ? _selectedStereoName() : '';

  let seed = {};
  if (!stereoRouteName && origin.stripType !== 'ARRIVAL' && origin.stripType !== 'OVERFLIGHT' && origin.stripType !== 'MISSION') {
    _createStripLookupInFlight = true;
    if (_createStripInputEl) _createStripInputEl.disabled = true;
    if (_createStripBtnEl) _createStripBtnEl.disabled = true;
    _setCreateStripMsg('Looking up flight plan…', false);
    try {
      const result = await lookupFlightPlanClient(callsign);
      if (result.found) seed = result.seed;
    } finally {
      // lookupFlightPlanClient is designed to never throw (see its own
      // header comment) — this finally is a defense-in-depth backstop, not
      // an expected path, so the form can never get stuck disabled.
      _createStripLookupInFlight = false;
      if (_createStripInputEl) _createStripInputEl.disabled = false;
      if (_createStripBtnEl) _createStripBtnEl.disabled = false;
    }
  }

  const flightData = origin.stripType === 'ARRIVAL'
    ? { callsign, aircraftType: '', wakeCategory: '', originAirport: '', estimatedArrivalTimeUtc: null }
    : origin.stripType === 'MISSION'
      ? { callsign, missionNumber: '', packageId: '', controllingAgency: '', vulWindowStartUtc: null, vulWindowEndUtc: null }
      : stereoRouteName
        // Only the callsign and the short name go over the wire — route,
        // altitude and airports are left ABSENT rather than blank so the
        // server's table fills them (an empty string would count as an
        // explicit value and win over the expansion). The server resolves
        // the name again and refuses one it doesn't know, so this client
        // list is the picker's option source, never the authority.
        ? { callsign, aircraftType: '', wakeCategory: '', stereoRouteName }
        : {
            callsign, aircraftType: '', wakeCategory: '',
            departureAirport: '', destinationAirport: '', route: '', requestedAltitude: '',
            ...seed, // overrides only the blanks above when the lookup actually found something
          };

  // A bound mission line carries NO `flightData`: identity comes entirely from the
  // flight it is fragged against, down to the Mode 3/A (guide §9.8's bridge
  // field). The server refuses both keys together, so sending a blank one
  // "just in case" would refuse the whole op.
  const createOp = bindFlightDataId
    ? { kind: 'CreateStrip', bayId: origin.bayId, rackId: 'main', stripType: origin.stripType, flightDataId: bindFlightDataId, initialState: origin.initialState || undefined }
    : { kind: 'CreateStrip', bayId: origin.bayId, rackId: 'main', stripType: origin.stripType, flightData, initialState: origin.initialState || undefined };
  _sendCreateStrip(origin.actingPositionId, createOp, origin.facilityId);
  _createStripInputEl.value = '';
  if (_createStripStereoEl) _createStripStereoEl.value = '';
  if (_createStripBindEl) _createStripBindEl.value = '';
  _pendingDuplicateCallsign = null;
  _setCreateStripMsg(
    bindFlightDataId ? (origin.stripType === 'MISSION' ? `Fragging a mission line for ${boundCallsign || 'this flight'}…` : `Filing ${boundCallsign} against its ATO mission…`)
      : stereoRouteName ? `Creating (${stereoRouteName})…`
        : seed.route ? 'Creating (flight plan found)…'
          : 'Creating…',
    false);
}

/**
 * Called from bay-view.js's ops-filed card "Create Strip" button — the
 * plan's data is already in hand (it came from the same list fetch that
 * rendered the card), so this skips lookupFlightPlanClient's network round
 * trip entirely and goes straight to CreateStrip. DEPARTURE/OPS only, same
 * scope restriction _submitCreateStrip's own lookup has — see
 * docs/efsp-usage-guide.md §4 for why ARRIVAL/CTR is out of scope for this
 * seed shape.
 * @param {{callsign:string, seed:object}} plan
 */
export function createStripFromFiledPlan(plan) {
  if (!plan || !plan.callsign) return;
  if (!getActingPositions().includes('OPS')) {
    _setCreateStripMsg('OPS only — select OPS in Panels to create Strips', true);
    return;
  }
  const flightData = {
    callsign: plan.callsign, aircraftType: '', wakeCategory: '',
    departureAirport: '', destinationAirport: '', route: '', requestedAltitude: '',
    ...(plan.seed || {}),
  };
  _sendCreateStrip('OPS', {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', flightData,
  }, facilityOfPosition('OPS'));
  _setCreateStripMsg('Creating ' + plan.callsign + ' (flight plan found)…', false);
}

export function _wireCreateStrip() {
  if (!_createStripBtnEl || !_createStripInputEl) return;
  _createStripBtnEl.addEventListener('click', _submitCreateStrip);
  _createStripInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') _submitCreateStrip(); });
  _createStripInputEl.addEventListener('input', () => _refreshAtoFirstPicker(_createStripOrigin())); // docs/adr/0071
  _refreshCreateStripAvailability();
}

export function _setPendingDuplicateCallsign(v) { _pendingDuplicateCallsign = v; }
