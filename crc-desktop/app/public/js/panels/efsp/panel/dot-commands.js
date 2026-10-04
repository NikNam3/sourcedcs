'use strict';
import { _availableCreateStripOrigins, _createStripOrigin, _missionBindCandidates, _pendingDuplicateCallsign, _sendCreateStrip, _setCreateStripMsg, _setPendingDuplicateCallsign, _stereoEligibleOrigin, _stereoRoutes } from './create-strip.js';
import { _dotCommandInputEl, _dotCommandPreviewEl } from './state.js';
import { requestUndo } from './undo-slot.js';
import { _runEfspSearch } from './tabs.js';
import { getActingPositions, sendEfspCorrelationMutation, sendEfspMarsaMutation, sendEfspMutation } from '../efsp-ws.js';
import { getAllEfspStrips, getEfspCorrelationForStrip, getEfspFlightData, getEfspStrip, liveStripsForCallsign, marsaForStrip } from '../efsp-state.js';
import { getSelectedEfspStripId } from '../bay-view.js';
import { normalizeStereoNameClient } from '../efsp-stereo-routes.js';
import { parseDotCommand } from '../dot-command.js';
import { buildJoinOp, buildSplitOp, joinLeadCandidates, parseSplitCommand } from '../formation-rules.js';
import { dispatchFormationOp } from '../bay/popovers/formation.js';

/**
 * `.mission <CALLSIGN>` — frag a mission line bound to a live flight.
 *
 * Shares _createStripOrigin() with the toolbar so the two surfaces cannot
 * disagree about who may originate what, exactly as _fileStereoByName does.
 */
function _fragMissionLine(callsign) {
  const wanted = String(callsign || '').trim().toUpperCase();
  if (!wanted) return _showDotCommandError('.mission needs a callsign');

  const origin = _availableCreateStripOrigins().find(o => o.stripType === 'MISSION' && o.actingPositionId === 'TAC_C2');
  if (!origin) return _showDotCommandError('only TAC_C2 can frag a mission line');

  const candidate = _missionBindCandidates().find((s) => {
    const flightData = getEfspFlightData(s.flightDataId);
    return flightData && flightData.identity && String(flightData.identity.callsign || '').toUpperCase() === wanted;
  });
  if (!candidate) {
    // docs/ui-findings F-309 — _missionBindCandidates() drops every flight
    // that already HAS a live mission line, so the lookup misses and the
    // generic message above fired about a flight that is live and on screen.
    // The refusal is right (one mission line per flight, which crc-sync
    // enforces); only the wording was wrong.
    const flightDataIds = new Set(liveStripsForCallsign(wanted).map(s => s.flightDataId));
    const alreadyFragged = flightDataIds.size > 0 && getAllEfspStrips()
      .some(s => s.stripType === 'MISSION' && s.state !== 'DROPPED' && flightDataIds.has(s.flightDataId));
    if (alreadyFragged) return _showDotCommandError(`${wanted} already has a mission line — a flight gets one`);
    return _showDotCommandError(`no live flight ${wanted} available to frag against`);
  }

  _sendCreateStrip(origin.actingPositionId, {
    kind: 'CreateStrip', bayId: origin.bayId, rackId: 'main', stripType: 'MISSION',
    flightDataId: candidate.flightDataId, initialState: origin.initialState || undefined,
  });
  _setCreateStripMsg(`Fragging a mission line for ${wanted}…`, false);
}

// Phase 1's minimal dot-command vocabulary (guide §7.1 rule 5 specifies
// the input surface, not a fixed verb set for DEPARTURE strips) — grows
// here without changing dot-command.js's parser.
export function _dispatchDotCommand(parsed) {
  // .find doesn't target a selected Strip at all — handle it before the
  // strip-selection-dependent verbs below need one.
  if (parsed.verb === 'find') {
    _runEfspSearch(parsed.args.join(' '));
    return;
  }

  // .stereo <NAME> <CALLSIGN> — file by §9.10 short name (docs/adr/0050).
  // Creates a Strip, so like .find it belongs above the selected-Strip
  // guard: there is nothing selected yet, that's the point. Guide §7.1 rule
  // 5 is explicit that the dot-command surface is "a primary feature, not a
  // power-user extra", and filing a canned route by typing its name is the
  // most literal reading of §9.10's "a filing path that does not require a
  // full flight-plan form" available.
  //
  // The name is ONE token. `.stereo PACK 1 VIPER11` would be ambiguous
  // against `.stereo PACK1 VIPER11`, and normalisation is what makes the
  // single-token rule harmless: `PACK1` resolves a route the squadron
  // spelled "PACK 1".
  if (parsed.verb === 'stereo') {
    _fileStereoByName(parsed.args[0], parsed.args[1]);
    return;
  }

  // Above the selected-Strip guard below, alongside .find and .stereo, for
  // the same reason those are: it CREATES a Strip, so nothing is selected —
  // that is the point. Guide §7.1 rule 5 makes the dot-command surface a
  // primary feature, and docs/adr/0049 found that shipping a create/bind
  // affordance as pointer-only was a defect.
  if (parsed.verb === 'mission') {
    _fragMissionLine(parsed.args[0]);
    return;
  }

  // docs/adr/0100 §10: .undo undoes the slot's action, not "the selected Strip", so it needs no selection.
  if (parsed.verb === 'undo') {
    requestUndo();
    return;
  }

  const stripId = getSelectedEfspStripId();
  const strip = stripId ? getEfspStrip(stripId) : null;
  if (!strip) return;
  const positions = getActingPositions();
  const actingPositionId = positions.includes(strip.ownerPositionId) ? strip.ownerPositionId : positions[0];
  if (!actingPositionId) return;

  if (parsed.verb === 'drop') {
    sendEfspMutation(actingPositionId, strip, { kind: 'DropStrip', reason: parsed.args.join(' ') || 'manual' });
  } else if (parsed.verb === 'bind' || parsed.verb === 'unbind') {
    // WP5 (guide §6.6 rule 1's top rung). The badge's picker is a pointer
    // affordance; this is the keyboard path §7.1 rule 4 asks for at the
    // positions that do the data entry, and §7.1 rule 5 is explicit that the
    // dot-command surface is "a primary feature, not a power-user extra".
    const record = getEfspCorrelationForStrip(strip);
    const baseRev = record ? record.rev : 0;
    if (parsed.verb === 'unbind') {
      sendEfspCorrelationMutation(actingPositionId, strip.flightDataId, baseRev, { kind: 'UnbindTrack' });
      return;
    }
    const trackId = parsed.args[0];
    if (!trackId) {
      // Nothing to guess at: a bind names a specific contact, and picking one
      // on the controller's behalf is exactly what the server refuses to do.
      _showDotCommandError('.bind needs a track id — click the TRK badge to pick from the candidates');
      return;
    }
    sendEfspCorrelationMutation(actingPositionId, strip.flightDataId, baseRev, { kind: 'BindTrack', trackId: String(trackId) });
  } else if (parsed.verb === 'split') {
    _dispatchSplitDotCommand(parsed, strip);
  } else if (parsed.verb === 'join') {
    _dispatchJoinDotCommand(parsed, strip);
  } else if (MARSA_VERBS[parsed.verb]) {
    _dispatchMarsaDotCommand(parsed, strip, actingPositionId);
  }
}

// crc-sync docs/adr/0099 — `.split <k> <CALLSIGN> <H270|S250|SM.80|A120|FL240> [MARSA]` (the assignment may be left
// off on a Strip on the ground) and `.join <LEAD-CALLSIGN>`, on the selected Strip. Validation is formation-rules.js's,
// shared with the popover; the server gates again.
function _dispatchSplitDotCommand(parsed, strip) {
  const req = parseSplitCommand(parsed.args);
  if (!req.ok) { _showDotCommandError(req.error); return; }
  const built = buildSplitOp(req, { strip, flightData: getEfspFlightData(strip.flightDataId) });
  if (!built.ok) { _showDotCommandError(built.error); return; }
  if (!dispatchFormationOp(strip, built.op)) _showDotCommandError('sign on to the Position that holds this Strip first');
}

function _dispatchJoinDotCommand(parsed, strip) {
  const wanted = String(parsed.args[0] || '').trim().toUpperCase();
  if (!wanted) { _showDotCommandError('.join needs the lead\'s callsign — e.g. .join VIPER1'); return; }
  const lead = joinLeadCandidates(strip, getAllEfspStrips()).find((s) => {
    const fd = getEfspFlightData(s.flightDataId);
    return fd && fd.identity && String(fd.identity.callsign || '').toUpperCase() === wanted;
  });
  if (!lead) { _showDotCommandError(`${wanted} is not a Strip of yours this one can join`); return; }
  if (!dispatchFormationOp(strip, buildJoinOp(lead))) _showDotCommandError('sign on to the Position that holds this Strip first');
}

// WP6 (guide §9.2) — the keyboard path to the MARSA relation, for the same
// reason .bind has one: §7.1 rule 5 makes the dot-command surface "a primary
// feature, not a power-user extra", and the badge's popover is the pointer
// affordance, not the only one.
//
// `.marsa <CALLSIGN> [DECLARER]` reads the way the radio call arrives —
// "SHELL71 accepting MARSA with VIPER11" — rather than making the controller
// type two flightDataIds nobody can see.
const MARSA_VERBS = {
  marsa: 'DeclareMarsa',
  rendezvous: 'MarkRendezvous',
  endmarsa: 'EndMarsa',
  voidmarsa: 'VoidMarsa',
};

function _dispatchMarsaDotCommand(parsed, strip, actingPositionId) {
  const relation = marsaForStrip(strip);
  const active = relation && relation.state === 'ACTIVE' ? relation : null;

  if (parsed.verb === 'marsa') {
    const callsign = (parsed.args[0] || '').trim();
    if (!callsign) {
      _showDotCommandError('.marsa needs the other flight — e.g. .marsa VIPER11 SHELL71');
      return;
    }
    if (active) {
      // Already in one: the useful reading of ".marsa VIPER13" on a live
      // relation is "VIPER13 is joining us", not "start a second relation" —
      // which crc-sync would refuse anyway, since a flight is in at most one.
      const joining = _marsaStripByCallsign(callsign);
      if (!joining) { _showDotCommandError(`no live Strip for ${callsign.toUpperCase()}`); return; }
      sendEfspMarsaMutation(actingPositionId, active.marsaId, active.rev, { kind: 'AddParticipant', flightDataId: joining.flightDataId });
      return;
    }
    const other = _marsaStripByCallsign(callsign);
    if (!other) { _showDotCommandError(`no live Strip for ${callsign.toUpperCase()}`); return; }
    // §9.2 rule 1 — the declaration is the tanker's and it is verbal, so who
    // said it is required. Defaulted to the selected Strip's own callsign,
    // which is the usual case (the tanker's Strip is the one in front of you),
    // and overridable by a second argument when it is not.
    const declaringCallsign = (parsed.args[1] || '').trim().toUpperCase()
      || _marsaCallsignOf(strip)
      || '';
    if (!declaringCallsign) {
      _showDotCommandError('.marsa needs the callsign that declared it — e.g. .marsa VIPER11 SHELL71');
      return;
    }
    sendEfspMarsaMutation(actingPositionId, undefined, undefined, {
      kind: 'DeclareMarsa',
      participants: [strip.flightDataId, other.flightDataId],
      // [SOURCE-DEFINED] defaults: the typed form is the fast path for the
      // common AR case, and the popover is where a controller picks an MTR
      // entry or a local declaration. §9.2 rule 1's aerial-refuelling case is
      // the one the guide spells out in full, so it is the one defaulted to.
      startEvent: 'TANKER_ACCEPTED',
      endCondition: 'VERTICALLY_POSITIONED',
      declaringCallsign,
    });
    return;
  }

  if (!active) {
    _showDotCommandError(`.${parsed.verb} needs an active MARSA relation on this flight`);
    return;
  }
  sendEfspMarsaMutation(actingPositionId, active.marsaId, active.rev, {
    kind: MARSA_VERBS[parsed.verb],
    note: parsed.args.join(' ') || undefined,
  });
}

function _marsaCallsignOf(strip) {
  const flightData = getEfspFlightData(strip.flightDataId);
  return (flightData && flightData.identity && flightData.identity.callsign) || '';
}

/** The live Strip whose flight answers to this callsign — how a controller names a flight out loud. */
function _marsaStripByCallsign(callsign) {
  const matches = liveStripsForCallsign(callsign);
  return matches[0] || null;
}

/**
 * `.stereo <NAME> <CALLSIGN>` — the keyboard half of filing by short name.
 *
 * Shares _createStripOrigin() with the toolbar rather than duplicating the
 * OPS/AP/CTR gate and the combined-Position choice, so the two surfaces can
 * never disagree about who may originate what.
 *
 * Deliberately does NOT reuse _submitCreateStrip's duplicate-callsign
 * two-press warning (§3.6), including the duplicate-origination check —
 * which this originally skipped, on the reasoning that "a controller who
 * typed a verb, a route name and a callsign has been explicit enough."
 * That was wrong, and worth recording as wrong: §3.6's guard is not about
 * how deliberate the request was, it is about state the controller CANNOT
 * SEE — a replica already live at another Facility that should be picked up
 * by ACCEPTing it, not re-originated with a second beacon code and a second
 * lifecycle. Typing a longer command tells you nothing about that.
 */
function _fileStereoByName(rawName, rawCallsign) {
  const name = String(rawName || '').trim();
  const callsign = String(rawCallsign || '').trim().toUpperCase();
  if (!name || !callsign) {
    _showDotCommandError('.stereo needs a route name and a callsign — e.g. .stereo PACK1 VIPER11');
    return;
  }
  if (!/^[A-Z0-9]{1,7}$/.test(callsign)) {
    _showDotCommandError(`${callsign} is not a valid callsign — 1-7 alphanumeric characters`);
    return;
  }

  const origin = _createStripOrigin();
  if (!origin) {
    _showDotCommandError('OPS, AP or CTR only — select one in Panels to create Strips');
    return;
  }
  if (!_stereoEligibleOrigin(origin)) {
    _showDotCommandError(`a stereo route seeds a DEPARTURE Strip, not ${origin.stripType}`);
    return;
  }

  // A courtesy check against the fetched list, not the gate — the server
  // resolves the name again and refuses an unknown one regardless. Same
  // standing as .bind's "needs a track id" precheck: catch the typo where
  // the controller is looking instead of making them wait for a rejection.
  const known = _stereoRoutes.find(r =>
    normalizeStereoNameClient(r.name) === normalizeStereoNameClient(name));
  if (!known) {
    _showDotCommandError(`${name} is not a configured stereo route`);
    return;
  }

  // §3.6 duplicate origination, shared with the button rather than skipped.
  // Re-entering the same command confirms, the same way pressing + New Strip
  // twice does; _pendingDuplicateCallsign is the same latch, so confirming
  // on one surface confirms on both.
  const existing = liveStripsForCallsign(callsign);
  if (existing.length > 0 && _pendingDuplicateCallsign !== callsign) {
    _setPendingDuplicateCallsign(callsign);
    const where = existing.map(s => `${s.facilityId || '?'}/${s.ownerPositionId}`).join(', ');
    _showDotCommandError(`${callsign} already has a live Strip at ${where} — repeat the command to create another anyway`);
    return;
  }
  _setPendingDuplicateCallsign(null);

  _sendCreateStrip(origin.actingPositionId, {
    kind: 'CreateStrip', bayId: origin.bayId, rackId: 'main', stripType: origin.stripType,
    flightData: { callsign, aircraftType: '', wakeCategory: '', stereoRouteName: known.name },
    initialState: origin.initialState || undefined,
  });
  _setCreateStripMsg(`Creating ${callsign} (${known.name})…`, false);
}

// Set by _showDotCommandError, read by _wireDotCommand's Enter handler so it
// knows not to wipe the message it just asked for. Without this the clear
// below erased every dot-command error the instant it was written — .bind's
// "needs a track id" has never once been visible on screen, which made a
// mistyped .bind indistinguishable from the input not registering at all.
// Found writing efsp-stereo-panel.test.mjs; it is the same silent-failure
// shape the create-strip box's own rejection message was added to close.
let _dotCommandErrorShown = false;

/** Surfaces a dot-command problem where the preview already draws the eye. */
function _showDotCommandError(message) {
  if (!_dotCommandPreviewEl) return;
  _dotCommandPreviewEl.textContent = message;
  _dotCommandErrorShown = true;
}

export function _wireDotCommand() {
  if (!_dotCommandInputEl) return;
  _dotCommandInputEl.addEventListener('input', () => {
    const parsed = parseDotCommand(_dotCommandInputEl.value);
    if (_dotCommandPreviewEl) _dotCommandPreviewEl.textContent = parsed ? `${parsed.verb} ${parsed.args.join(' ')}`.trim() : '';
  });
  _dotCommandInputEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const parsed = parseDotCommand(_dotCommandInputEl.value);
    if (!parsed) return;
    _dotCommandErrorShown = false;
    _dispatchDotCommand(parsed);
    _dotCommandInputEl.value = '';
    // Clear the echoed command, but NOT a message the dispatch just wrote
    // there — see _dotCommandErrorShown for the bug that was.
    if (_dotCommandPreviewEl && !_dotCommandErrorShown) _dotCommandPreviewEl.textContent = '';
  });
}
