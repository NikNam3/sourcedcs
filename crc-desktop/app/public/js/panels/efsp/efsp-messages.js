'use strict';
import { registerEfspMessage, registerEfspStoreRedraw, redrawEfspStore, dispatchEfspMessage } from './efsp-message-registry.js';
import { markEfspChanged } from './efsp-change-bus.js';
import { renderPositionControls, renderPositionWarnings } from '../radar-panel.js';
import {
  applyEfspAlerts, applyEfspCorrelationDelta, applyEfspDelta, applyEfspMarsaDelta, applyEfspMutationAck,
  applyEfspSnapshot, applyEfspStoreSlices, getEfspFacility, getEfspStrip
} from './efsp-state.js';
import { captureEfspPlacement } from './efsp-arrivals.js';
import { applyEfspSfaDelta } from './sfa-state.js';
import {
  efspResyncReplyAsMessage, noteEfspPositionsAck, replayPendingEfspMutations, settleEfspAck
} from './efsp-ws.js';
import { onEfspMetricsReportAck } from './efsp-metrics-client.js';
import { _showMutationError, notifyEfspMutationAck, notifyEfspOrphanedMutation } from './panel/refusal.js';
import { noteEfspBoardArrivals } from './panel/arrivals.js';
import { noteEfspHeartbeat } from './panel/staleness.js';
import { reloadEfspStereoRoutes } from './panel/create-strip.js';
import { onAtoPreviewResult } from './ato-import.js';
import { noteUndoAck, noteUndoBoardEpoch, noteUndoVoided, reconcileUndoSlotEpoch } from './panel/undo-slot.js';
import { noteEfspPositionOffer } from './panel/combination.js';

// The handlers of the EFSP message families whose state lives in bay-view.js / efsp-panel.js / efsp-state.js
// (CMSG): Board, correlation, MARSA, alerts, SFA, ATO import, positions, resync. They moved here out of app.js's
// ws.onmessage switch. DESK-GRAPH: a handler applies state and says what changed (`markEfspChanged`, efsp-change-bus.js);
// the panels, the Bays and the map subscribe to the topics they draw. The bus flushes once the handler has returned. The airspace, carrier, runway-status and
// metrics families register in their own panel modules.

// EFSP — sent once at connect (efsp-snapshot) plus immediately on
// every accepted Mutation (efsp-board-delta), not on this file's own
// 500ms track/delta rhythm (see crc-sync's docs/adr/0004-immediate-
// board-broadcast.md — the guide's <200ms remote-change budget).
registerEfspMessage('efsp-snapshot', (msg) => {
  applyEfspSnapshot(msg);
  reconcileUndoSlotEpoch(); // a new Board lifetime: nothing to undo (docs/adr/0100 §7)
  // The panel, the MARSA / AR / correlation highlights (resolved before the Bays that read them), the Bays, the map,
  // the airspace and runway-status panels all redraw from a snapshot: they subscribe to 'snapshot'.
  markEfspChanged('snapshot');
  // §9.10's route table is fetched over HTTP, not carried on the
  // snapshot — but a snapshot is the one event that means crc-sync may
  // have restarted, which is also the only way the table can change.
  // See efsp-panel.js's _loadStereoRoutes for the bug this closes.
  reloadEfspStereoRoutes();
  // MARSA relations come back with the snapshot too, so the selected
  // Strip's participant highlight has to be re-resolved before the
  // re-render below — same reason the correlation ring is, a few lines
  // down. Resolved first, rendered second: the highlight is a class each
  // Strip reads while being built.
  // (the highlights subscribe to 'snapshot' too, ahead of the Bays; a reconnect brings correlations back with the
  // snapshot, so a Strip selected before the drop gets its ring redrawn rather than waiting for the next delta)
  // §5.6.3 — replay every still-pending Mutation against this fresh
  // baseline. A no-op on the very first connect (nothing pending
  // yet); on a RECONNECT this is what stops a Mutation in flight at
  // the moment of disconnect from being silently lost forever (its
  // ack could never otherwise arrive on the dead connection —
  // defect D6, "the worst failure mode in the system").
  replayPendingEfspMutations((orphaned) => {
    const detail = orphaned.stripId ? 'its target is no longer on the Board'
      : 'too long disconnected to re-send safely: check the Board before creating it again';
    settleEfspAck({ clientMutationId: orphaned.clientMutationId, ok: false, reason: 'CONNECTION_LOST', detail });
    notifyEfspOrphanedMutation(orphaned);
  });
});

// The answer to this client's efsp-resync (docs/adr/0081, S-12): a snapshot or a
// delta, tagged. Unwrapped into the message it carries, so one code path applies it.
registerEfspMessage('efsp-resync-reply', (msg) => {
  // `stores` (crc-sync docs/adr/0106): the slices of the stores outside the Board that this client was behind in. Each
  // replaces that store's state, and its family redraws through the store (registerEfspStoreRedraw). The in-flight
  // requests are settled by efsp-ws.js's observer, which sees this reply first.
  if (msg.answer === 'stores' || msg.stores) {
    for (const key of applyEfspStoreSlices(msg.stores)) redrawEfspStore(key);
  }
  if (msg.answer !== 'stores') dispatchEfspMessage(efspResyncReplyAsMessage(msg));
});

registerEfspMessage('efsp-board-delta', (msg) => {
  // Where the changed Strips sat BEFORE this delta, so the panel can
  // tell a Strip that just arrived in one of this controller's Bays
  // from one that merely changed (efsp-arrivals.js, docs/adr/0057).
  const placementBefore = captureEfspPlacement(msg, getEfspStrip);
  noteUndoBoardEpoch(msg.facilityId || getEfspFacility(), msg.boardEpoch);
  applyEfspDelta(msg);
  if (placementBefore) noteEfspBoardArrivals(msg, placementBefore);
  markEfspChanged('board');
});

// Sent every 500ms unconditionally (ws-hub.js's _tick) — the genuine
// periodic signal a staleness check needs, since "no message" on a
// quiet Board is not itself evidence the connection died (guide §5.6
// rule 5). See efsp-panel.js's staleness interval.
registerEfspMessage('efsp-heartbeat', () => {
  noteEfspHeartbeat(); // the gap check and the retry clock run in efsp-ws.js's observer
});

registerEfspMessage('efsp-mutation-ack', (msg) => {
  // This controller's own move can land here BEFORE the board delta that
  // also carries it, and by then the Strip already sits in its new Bay —
  // so arrivals are noted from the ack too (docs/adr/0057). Whichever of
  // the two comes second sees no Bay change and adds nothing.
  const ackAsDelta = { strips: { updated: msg.strip ? [msg.strip] : [] } };
  const ackPlacementBefore = captureEfspPlacement(ackAsDelta, getEfspStrip);
  const result = applyEfspMutationAck(msg);
  if (ackPlacementBefore) {
    noteEfspBoardArrivals(ackAsDelta, ackPlacementBefore);
    markEfspChanged('panel'); // the tab counts and arrivals line
  }
  noteUndoBoardEpoch(msg.facilityId, msg.boardEpoch);
  // The Undo slot (docs/adr/0100 §10) takes the ack's `undoable`; an Undo's own refusal shows in the slot line.
  const handled = settleEfspAck(msg, result); // the request's own continuation (Undo, CreateStrip, ...), if it left one
  noteUndoAck(msg, result.pending);
  if (!result.ok) console.warn('[efsp] Mutation rejected:', result.reason, msg);
  if (!handled) notifyEfspMutationAck(result);
  markEfspChanged('ack');
});

registerEfspMessage('efsp-positions-ack', (msg) => {
  noteEfspPositionsAck(msg); // the server's signedOn is the truth (adopted)
  console.warn('[efsp] efsp-positions-ack received, signedOn =', msg.signedOn, 'warnings =', msg.warnings);
  renderPositionControls();
  renderPositionWarnings(msg.warnings);
  markEfspChanged('positions');
});

// crc-sync docs/adr/0105 (H104): GC signed off holding Strips while this controller is LC's Primary: offered GC as well.
registerEfspMessage('efsp-position-offer', (msg) => {
  noteEfspPositionOffer(msg);
});

// WP5 (crc-sync's docs/adr/0045) — changed correlation records, once
// per server reconcile tick. updateMap() matters as much as the
// re-render: a re-bind has to move the ring on the scope, not just the
// badge on the Strip.
function _redrawCorrelations() {
  markEfspChanged('correlations'); // the ring (resolved first), the Bays, the panel, the map
}
registerEfspMessage('efsp-correlation-delta', (msg) => {
  applyEfspCorrelationDelta(msg);
  _redrawCorrelations();
});
registerEfspStoreRedraw('correlations', _redrawCorrelations);

registerEfspMessage('efsp-correlation-ack', (msg) => {
  // _showMutationError's signature is (reason, detail, context) — this
  // passed the whole message object as `reason` and rendered
  // "[object Object]" for every refused bind (docs/ui-findings F-103).
  // A correlation op registers nothing pending (efsp-ws.js: the §5.6.3
  // replay machinery is keyed on Strip identity), so the flight can only
  // be named from whatever record the ack carries back.
  settleEfspAck(msg);
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.correlation ? { flightDataId: msg.correlation.flightDataId } : null);
  applyEfspCorrelationDelta({ correlations: { updated: msg.correlation ? [msg.correlation] : [] } });
  markEfspChanged('correlations');
});

// WP6 (crc-sync's docs/adr/0051), guide §9.2. Its own delta type with its
// own seq, like the airspace and correlation deltas — a relation is not a
// Strip and rides no Board's sequence.
//
// A delta lands for two reasons: somebody acted on a relation, or a
// clearance voided one. The second arrives ALONGSIDE an efsp-board-delta
// in the same round trip, which is why this case does a full re-render
// rather than trusting the board delta to have done one — the two
// messages are independent and either may arrive first.
function _redrawMarsa() {
  markEfspChanged('marsa'); // the participant highlight (resolved first), then the Bays
}
registerEfspMessage('efsp-marsa-delta', (msg) => {
  applyEfspMarsaDelta(msg);
  _redrawMarsa();
});
registerEfspStoreRedraw('marsa', _redrawMarsa);

registerEfspMessage('efsp-marsa-ack', (msg) => {
  // Same one-argument bug as efsp-correlation-ack above, same fix. A
  // relation is named by its participants, not by one Strip — §9.2's
  // "model it as an edge, not a flag" applies to the refusal too.
  settleEfspAck(msg); // a popover's Send closes on this (bay/popover-portal.js _sendFromPopover)
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.marsa ? { flightDataIds: msg.marsa.participants } : null);
  applyEfspMarsaDelta({ marsa: { updated: msg.marsa ? [msg.marsa] : [] } });
  markEfspChanged('marsa');
});

// docs/adr/0058 — the whole conformance + short-term conflict picture,
// and (docs/adr/0067) every forwarding obligation due right now, sent
// when it changes and once on connect; one no longer listed is cleared.
registerEfspMessage('efsp-alerts', (msg) => {
  applyEfspAlerts(msg);
  markEfspChanged('alerts'); // the Bays, the map, the track panel
});

// crc-sync's docs/adr/0093 — who is on which SFA frequency, sent whole on every change.
registerEfspMessage('efsp-sfa-delta', (msg) => {
  applyEfspSfaDelta(msg);
  markEfspChanged('sfa');
});
registerEfspStoreRedraw('sfaRotation', () => markEfspChanged('sfa'));

registerEfspMessage('efsp-sfa-ack', (msg) => {
  settleEfspAck(msg);
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: 'SFA rotation' });
  if (msg.sfaRotation) applyEfspSfaDelta({ sfaRotation: msg.sfaRotation });
  markEfspChanged('sfa');
});

// WP7 (crc-sync docs/adr/0071) — the ATO import's two answers, sender only.
registerEfspMessage('efsp-ato-preview-result', (msg) => {
  onAtoPreviewResult(msg);
});

registerEfspMessage('efsp-ato-ack', (msg) => {
  settleEfspAck(msg); // sendAtoImport's continuation (ato-import.js)
});

// WP8 (docs/adr/0065, 0072): the ack for the client measurements efsp-metrics-client.js reports.
registerEfspMessage('efsp-metrics-report-ack', (msg) => {
  onEfspMetricsReportAck(msg);
});

// docs/adr/0100 §6 (H100 Q-U2 b): another Position's Undo voided a change of this Position. A panel message,
// dismissible, kept for the session only. Nothing is drawn on the Strip.
registerEfspMessage('efsp-undo-voided', (msg) => {
  noteUndoVoided(msg);
});
