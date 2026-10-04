'use strict';
import { _mutationErrorEl, _mutationWarningEl } from './state.js';
import { blockLabelFor } from '../strip-template.js';
import { getEfspFlightData, getEfspStrip } from '../efsp-state.js';
import { noteAttestationRefusal } from './control-attest.js';
import { LUAW_WHILE_COMBINED_TEXT } from '../combination-rules.js';
import { markEfspChanged } from '../efsp-change-bus.js';

// Rejections that reach here have no other visible surface — a dragged
// Strip that gets refused (e.g. by crc-sync's bay-implied-state
// validation (board/placement.js's `validateBayImpliedTransition`): "you can't drop this here, it'd skip a lifecycle check")
// just silently snaps back to where it was otherwise, indistinguishable
// from the drag not registering at all. That property is the point of this
// banner and must survive every change to it.
//
// docs/ui-findings F-103 rewrote what it SAYS. It used to write
// `${reason}: ${detail}` — a raw machine code and no hint of which of the
// Strips below it was refused ("NLA_INHIBITED: no receiving Position
// present", with AAA11 and BBB22 both on screen). It now names the Strip by
// callsign, says the reason in a sentence, and carries the value a refused
// Block edit threw away (F-207).

// How long a refusal stays on screen.
//
// F-103 measured the old 6 s and found it gone before a controller who had
// looked away came back; F-207 adds that for a refused Block edit this banner
// is the ONLY place the typed value still exists ("to correct a long route,
// the controller retypes all of it from memory"). Whether a refusal should
// time out AT ALL is a workflow question F-103 deliberately leaves open, so
// the auto-clear stays rather than being decided here unilaterally — it is
// just made long enough to read a full route back off, and the banner is
// click-to-dismiss (initEfspPanel) for the controller who is done with it.
export const MUTATION_ERROR_VISIBLE_MS = 30000;

// Reason codes as something a controller can act on. One entry per code in crc-sync's REFUSAL_CODES
// (src/efsp/refusal-codes.js); tests/efsp-refusal-banner.test.mjs fails when the server gains one this table lacks. The code
// itself stays on the element's `title` and `data-reason`, so it is still
// greppable against the server.
//
// `null` means "the server always writes the whole sentence into `detail` for
// this one" — VALIDATION_ERROR's detail IS the message ("NOSUCH is not a
// configured stereo route"), and a canned prefix would only talk over it.
export const MUTATION_ERROR_MESSAGES = {
  VALIDATION_ERROR: null,
  STALE_REV: 'Somebody else changed this Strip while you were working on it — it has been reloaded, check it and try again',
  NOT_FOUND: 'That record is no longer on the Board',
  NLA_INHIBITED: 'That step is not available on this Strip yet',
  NO_RECEIVING_POSITION: 'Nobody is holding the Position this would go to',
  NOT_HOLDING_POSITION: 'You are not Primary at that Position',
  NOT_OWNER: 'Another Position owns this Strip',
  PERMISSION_DENIED: 'Your Position is not allowed to do that',
  NOT_STAFFED: 'Nobody is Primary at that Position',
  ALREADY_PRIMARY: 'You are already Primary at that Position',
  NOT_OBSERVER: 'You are not an observer at that Position',
  ASSIGNMENT_REQUIRED: 'The departing part needs a heading, speed or altitude assignment', // docs/adr/0099 (SplitFormation)
  BAY_FULL: 'That Bay is full — clear a Strip from it or use another Bay',
  UNDO_BLOCKED: 'Something has changed since that action, so it can no longer be undone',
  UNDO_UNAVAILABLE: 'There is nothing left to undo — the window has passed',
  INTERNAL_ERROR: 'crc-sync hit an internal error handling that — check the Strip before trying again, and report it if it repeats',
  // Not server codes: the client's own answers when the request never got one (efsp-ws.js sendEfsp / orphanEfspAcks).
  NOT_CONNECTED: 'Not connected to crc-sync — nothing was sent',
  CONNECTION_LOST: 'The connection to crc-sync dropped before it answered — check whether that went through',
};

function _refusalSentence(reason, detail) {
  const canned = Object.prototype.hasOwnProperty.call(MUTATION_ERROR_MESSAGES, reason)
    ? MUTATION_ERROR_MESSAGES[reason]
    : undefined;
  if (canned && detail) return `${canned} (${detail})`;
  if (canned) return canned;
  return detail || reason || 'Rejected';
}

/** The callsign on a flight data — what a controller reads off the Strip, and so how a refusal has to name it. */
export function _callsignOfFlightData(flightDataId) {
  const flightData = flightDataId ? getEfspFlightData(flightDataId) : null;
  return (flightData && flightData.identity && flightData.identity.callsign) || '';
}

/**
 * Names what a refusal was about, from the ORIGINAL request rather than the
 * ack — an ack says only "no, STALE_REV"; which Strip and which typed value
 * live in the message that was sent (efsp-state.js hands it back as
 * `result.pending`).
 *
 * @param {?object} context
 *   `{pending}`  the original efsp-mutation message (the usual case)
 *   `{stripId}` / `{flightDataId}` / `{flightDataIds}`  for the ack types that are not
 *       Strip Mutations and so register nothing pending (correlation, MARSA)
 *   `{subject}`  an already-formatted name for something that is not a
 *       flight at all, e.g. an airspace
 */
function _refusalSubject(context) {
  if (!context) return { label: '', stripId: null, blockId: null, value: null };
  if (context.subject) return { label: context.subject, stripId: null, blockId: null, value: null };

  const pending = context.pending || null;
  const op = (pending && pending.op) || context.op || null;
  const stripId = (pending && pending.stripId) || context.stripId || null;
  const strip = stripId ? getEfspStrip(stripId) : null;
  const callsign = (strip && _callsignOfFlightData(strip.flightDataId))
    || _callsignOfFlightData(context.flightDataId)
    || (op && op.flightData && op.flightData.callsign)   // a refused CreateStrip has no Strip yet — the callsign is in the op
    || _callsignOfFlightData(op && op.flightDataId)
    || (context.flightDataIds || []).map(_callsignOfFlightData).filter(Boolean).join(' + ');

  // F-207 — the Block input closes on Enter, before the server replies, so on
  // a refusal the typed text exists nowhere else on screen. Put it in the
  // message, where it is at least readable and copyable.
  //
  // `blockId` is recovered for EVERY refused SetBlock, including a
  // confirmVacated one that carries no value at all: which Block was refused
  // is what marks the right cell, and it is a separate question from whether
  // there is text to put back into it.
  let blockId = null;
  let value = null;
  let blockName = '';
  if (op && op.kind === 'SetBlock') {
    blockId = op.blockId || null;
    if (op.value != null && op.value !== '') {
      value = String(op.value);
      blockName = (blockLabelFor(op.blockId, (strip && strip.stripType) || 'DEPARTURE'))
        || op.blockId || '';
    }
  }

  const parts = [];
  if (callsign) parts.push(callsign);
  if (value) parts.push(`${blockName} “${value}”`.trim());
  return { label: parts.join(' '), stripId, blockId, value };
}

// The refusal currently on screen, or null. Read by getCurrentEfspRefusal().
let _currentRefusal = null;
let _mutationErrorClearTimer = null;
let _mutationWarningClearTimer = null;

export function _showMutationError(reason, detail, context) {
  const subject = _refusalSubject(context);
  const sentence = _refusalSentence(reason, detail);
  _currentRefusal = {
    stripId: subject.stripId,
    blockId: subject.blockId,
    reason: reason || null,
    detail: detail || null,
    value: subject.value,
    message: subject.label ? `${subject.label} — ${sentence}` : sentence,
    at: Date.now(),
  };
  // Scheduled before the element check: _currentRefusal is what bay-view.js
  // reads, and a refusal raised while the panel has never been opened would
  // otherwise stand forever with nothing to clear it.
  clearTimeout(_mutationErrorClearTimer);
  _mutationErrorClearTimer = setTimeout(dismissEfspRefusal, MUTATION_ERROR_VISIBLE_MS);
  if (!_mutationErrorEl) return;
  _mutationErrorEl.textContent = _currentRefusal.message;
  // The machine code stays reachable — still greppable against crc-sync's
  // src/efsp/, just not the thing a controller has to read first.
  _mutationErrorEl.title = `${reason || 'Rejected'}${detail ? `: ${detail}` : ''} · click to dismiss`;
  _mutationErrorEl.dataset.reason = reason || '';
  if (subject.stripId) _mutationErrorEl.dataset.stripId = subject.stripId;
  else delete _mutationErrorEl.dataset.stripId;
}

/**
 * Clears the refusal — on the auto-clear timer, and on a click on the banner.
 * Re-renders the Bays, because the Strip-level marker bay-view.js draws from
 * getCurrentEfspRefusal() has to go at the same moment the banner does.
 */
export function dismissEfspRefusal() {
  clearTimeout(_mutationErrorClearTimer);
  _mutationErrorClearTimer = null;
  const had = _currentRefusal;
  _currentRefusal = null;
  if (_mutationErrorEl) {
    _mutationErrorEl.textContent = '';
    _mutationErrorEl.title = '';
    _mutationErrorEl.dataset.reason = '';
    delete _mutationErrorEl.dataset.stripId;
  }
  if (had && had.stripId) markEfspChanged('bays');
}

/**
 * The refusal currently on screen, or null — the read side of F-103's
 * Strip-level half and of F-207's re-open-the-editor half. bay-view.js reads
 * this while building a Strip and marks the one whose `stripId` matches, so a
 * refusal is attributable at the Strip as well as in the shared banner.
 *
 * Returns null when nothing has been refused, or once the refusal has been
 * dismissed. Otherwise every field is present, and every one of them can be
 * null on its own:
 *
 *   stripId  the Strip the refused op targeted, or null when it targeted no
 *            single Strip — a CreateStrip (there is no Strip yet), an airspace
 *            op, or an ack type that registers nothing pending and came back
 *            without a record to name (see the correlation/MARSA note in
 *            app.js). A null stripId means MARK NOTHING; it is not "mark
 *            whatever is selected".
 *   blockId  the Block of a refused SetBlock ('9F', '7', …), or null for every
 *            other op kind. Set even when `value` is null (a confirmVacated
 *            SetBlock carries no value), because which cell was refused and
 *            whether there is text to put back are separate questions.
 *   reason   the raw server code, verbatim — 'STALE_REV', 'VALIDATION_ERROR',
 *            … — or null in the one case _showMutationError is called with no
 *            reason at all. Use it for a class or a title, never as prose: the
 *            plain-sentence mapping is MUTATION_ERROR_MESSAGES above.
 *   detail   the server's own sentence ('NOSUCH is not a configured stereo
 *            route'), or null — several reason codes carry none.
 *   value    the text a refused Block edit threw away (F-207), or null when
 *            the op carried none. This is what a re-opened Block editor has to
 *            be seeded with; the Block input closes on Enter before the server
 *            replies, so after a refusal this is the only copy that exists.
 *   message  the exact text in the banner, already composed (callsign, Block
 *            label, typed value, sentence). Never null. Reuse it rather than
 *            re-deriving a second wording that can drift from the banner's.
 *   at       Date.now() when the refusal was raised. Never null.
 *
 * ORDERING GUARANTEE. app.js calls notifyEfspMutationAck (and, for the other
 * ack types, _showMutationError) BEFORE markEfspChanged('bays'), so by the
 * time a render runs in response to a refusal this accessor is already
 * populated — a Strip built during that render can read it straight away, with
 * no deferral and no second pass. The mirror of that holds on the way out:
 * dismissEfspRefusal() nulls this and THEN re-renders, so a marker never
 * outlives the banner. bay-view.js therefore never has to clear anything
 * itself; it only ever reads.
 *
 * Lives here rather than in efsp-state.js because it is panel chrome, not
 * Board state: it is exactly as local as which Bay is in view, and it is
 * cleared by the same timer and the same click that clear the banner.
 */
export function getCurrentEfspRefusal() { return _currentRefusal; }

// A warning is NOT a rejection — the Mutation was accepted (guide §3.10.2
// rule 7: a duplicate beacon code "raise[s] an alert, never a hard block").
// Kept visually distinct from _showMutationError (amber, not red) so a
// controller never mistakes "accepted, but note this" for "refused".
const MUTATION_WARNING_MESSAGES = {
  DUPLICATE_IGNORED_WARNING: 'Duplicate beacon code — assigned anyway, per policy',
  NOT_IN_ACTIVE_AIRSPACE: 'Marked entered, but the flight is not inside an airspace active for you: the regime is now effective anyway (crc-sync docs/adr/0102)',
  LUAW_WHILE_COMBINED: LUAW_WHILE_COMBINED_TEXT, // crc-sync docs/adr/0105
  UNSTAFFED_RECEIVER: 'The receiving Position is unstaffed: it has been offered to another controller', // docs/adr/0110; the server's detail (names both) wins
};

// `warning` is a text or code (the airspace panel's), or the ack's list of { code, detail? }: each one is shown.
export function _showMutationWarning(warning) {
  if (!_mutationWarningEl) return;
  clearTimeout(_mutationWarningClearTimer);
  const text = (w) => (typeof w === 'string' ? (MUTATION_WARNING_MESSAGES[w] || w) : (w.code === 'UNSTAFFED_RECEIVER' && w.detail ? w.detail : (MUTATION_WARNING_MESSAGES[w.code] || w.detail || w.code)));
  _mutationWarningEl.textContent = Array.isArray(warning) ? warning.map(text).join(' · ') : text(warning);
  _mutationWarningClearTimer = setTimeout(() => { _mutationWarningEl.textContent = ''; }, 6000);
}

/**
 * Called from app.js when replayPendingEfspMutations() (efsp-state.js)
 * finds a pending Mutation whose target Strip no longer exists in the
 * fresh post-reconnect snapshot (guide §5.6.3). This is the orphaned case
 * — surfaced, never silently dropped, per defect D6.
 */
export function notifyEfspOrphanedMutation(original) {
  const label = original.op && original.op.kind ? original.op.kind : 'change';
  const why = original.stripId ? 'its target Strip no longer exists'
    : 'the connection was down too long to re-send it safely; check the Board before creating it again';
  _showMutationError('Could not resync', `a pending ${label} could not be replayed — ${why}`, { pending: original });
}

/**
 * Called from efsp-messages.js after an efsp-mutation-ack that no continuation handled (efsp-ws.js settleEfspAck). A
 * refusal always shows the red banner (so a refused drag/drop is never silent), except the server asking for "coordinated
 * with", which is a question to the controller (docs/adr/0101); an accepted one shows its warnings, amber.
 * `result.pending` is the request this ack answers (efsp-state.js), the only place the refused Strip and value exist.
 */
export function notifyEfspMutationAck(result) {
  if (!result.ok && noteAttestationRefusal(result)) return; // asked in #efsp-control-attest
  if (!result.ok) _showMutationError(result.reason || 'Rejected', result.detail, { pending: result.pending });
  else if (result.warnings && result.warnings.length) _showMutationWarning(result.warnings);
}

// ESM-1 (S-ESM1c): the unit tests set the refusal on screen directly in the old shared scope; this is that seam.
export function _setCurrentRefusalForTest(r) { _currentRefusal = r; }
