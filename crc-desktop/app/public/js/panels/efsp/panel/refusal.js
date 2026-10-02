'use strict';
import { _mutationErrorEl, _mutationWarningEl } from './state.js';
import { _pendingCreateStripMutationId, _setCreateStripMsg, _setPendingCreateStripMutationId } from './create-strip.js';
import { blockLabelFor } from '../strip-template.js';
import { getEfspFlightData, getEfspStrip } from '../efsp-state.js';
import { renderAllOpenEfspBays } from '../bay-view.js';

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

// Reason codes as something a controller can act on. Enumerated from every
// `ok: false, reason:` in crc-sync's src/efsp/ rather than guessed. The code
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
  if (had && had.stripId) renderAllOpenEfspBays();
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
 * ack types, _showMutationError) BEFORE renderAllOpenEfspBays(), so by the
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
};

export function _showMutationWarning(warning) {
  if (!_mutationWarningEl) return;
  clearTimeout(_mutationWarningClearTimer);
  _mutationWarningEl.textContent = MUTATION_WARNING_MESSAGES[warning] || warning;
  _mutationWarningClearTimer = setTimeout(() => { _mutationWarningEl.textContent = ''; }, 6000);
}

/**
 * Called from app.js after every efsp-mutation-ack. Two things happen on
 * rejection: (1) the general error banner always shows the reason (so a
 * refused drag/drop is never silent — see _showMutationError above), and
 * (2) if this ack is specifically the CreateStrip we're waiting on,
 * "Creating…" is replaced with the concrete rejection reason too. Without
 * (2), a rejected CreateStrip (e.g. a malformed callsign that slipped past
 * client-side validation) would silently vanish exactly like the old
 * window.prompt() bug did.
 */
/**
 * Called from app.js when replayPendingEfspMutations() (efsp-state.js)
 * finds a pending Mutation whose target Strip no longer exists in the
 * fresh post-reconnect snapshot (guide §5.6.3). This is the orphaned case
 * — surfaced, never silently dropped, per defect D6.
 */
export function notifyEfspOrphanedMutation(original) {
  const label = original.op && original.op.kind ? original.op.kind : 'change';
  _showMutationError('Could not resync', `a pending ${label} could not be replayed — its target Strip no longer exists`, { pending: original });
}

export function notifyEfspMutationAck(clientMutationId, result) {
  // `result.pending` is the request this ack answers (efsp-state.js) — the
  // only place the refused Strip and the refused value exist. F-103/F-207.
  if (!result.ok) _showMutationError(result.reason || 'Rejected', result.detail, { pending: result.pending });
  else if (result.warning) _showMutationWarning(result.warning);
  if (clientMutationId !== _pendingCreateStripMutationId) return;
  _setPendingCreateStripMutationId(null);
  // `detail` carries the only part worth reading for a whole class of
  // rejection — "VALIDATION_ERROR" alone doesn't distinguish a malformed
  // callsign from "PACK9 is not a configured stereo route". It was being
  // dropped on the floor; the reason stays as the prefix so nothing that
  // relied on it has changed.
  const why = result.detail ? `${result.reason || 'rejected'} — ${result.detail}` : (result.reason || 'unknown error');
  _setCreateStripMsg(result.ok ? '' : `Rejected: ${why}`, !result.ok);
}

// ESM-1 (S-ESM1c): the unit tests set the refusal on screen directly in the old shared scope; this is that seam.
export function _setCurrentRefusalForTest(r) { _currentRefusal = r; }
