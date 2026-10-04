'use strict';
import { registerEfspMessage, dispatchEfspMessage } from './efsp-message-registry.js';
import { renderPositionControls, renderPositionWarnings } from '../radar-panel.js';
import { updateTrackPanel } from '../track-panel.js';
import { updateMap } from '../../geojson.js';
import {
  applyEfspAlerts, applyEfspCorrelationDelta, applyEfspDelta, applyEfspMarsaDelta, applyEfspMutationAck,
  applyEfspSnapshot, applyEfspStoreSlices, efspEpochChangeOf, getEfspFacility, getEfspStrip, STORE_SYNC
} from './efsp-state.js';
import { captureEfspPlacement } from './efsp-arrivals.js';
import { applyEfspSfaDelta } from './sfa-state.js';
import {
  efspResyncReplyAsMessage, noteEfspBoardMessageForSync, noteEfspHeartbeatForSync, noteEfspResyncAnswered,
  noteEfspPositionsAck, noteEfspSnapshotLanded, noteEfspStoreAnswerLanded, replayPendingEfspMutations, settleEfspAck
} from './efsp-ws.js';
import { onEfspMetricsReportAck } from './efsp-metrics-client.js';
import { refreshCorrelatedHighlight } from './correlation-highlight.js';
import { refreshMarsaHighlight } from './marsa-badge.js';
import { renderAllOpenEfspBays } from './bay-view.js';
import {
  _showMutationError, noteEfspBoardArrivals, noteEfspHeartbeat, notifyEfspMutationAck,
  notifyEfspOrphanedMutation, refreshEfspPanel, reloadEfspStereoRoutes
} from './efsp-panel.js';
import { refreshArHighlight } from './ato-strip.js';
import { onAtoPreviewResult } from './ato-import.js';
import { renderAirspacePanel } from './airspace-panel.js';
import { noteUndoAck, noteUndoBoardEpoch, noteUndoVoided, reconcileUndoSlotEpoch } from './panel/undo-slot.js';
import { noteEfspPositionOffer } from './panel/combination.js';
import { renderRunwayStatusPanel } from './runway-status-panel.js';

// The handlers of the EFSP message families whose state lives in bay-view.js / efsp-panel.js / efsp-state.js
// (CMSG): Board, correlation, MARSA, alerts, SFA, ATO import, positions, resync. They moved here out of app.js's
// ws.onmessage switch with their bodies and their call order unchanged. The airspace, carrier, runway-status and
// metrics families register in their own panel modules.

// EFSP — sent once at connect (efsp-snapshot) plus immediately on
// every accepted Mutation (efsp-board-delta), not on this file's own
// 500ms track/delta rhythm (see crc-sync's docs/adr/0004-immediate-
// board-broadcast.md — the guide's <200ms remote-change budget).
registerEfspMessage('efsp-snapshot', (msg) => {
  applyEfspSnapshot(msg);
  reconcileUndoSlotEpoch(); // a new Board lifetime: nothing to undo (docs/adr/0100 §7)
  noteEfspSnapshotLanded();
  refreshEfspPanel();
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
  refreshMarsaHighlight();
  refreshArHighlight(); // docs/adr/0071
  renderAllOpenEfspBays();
  // A reconnect brings correlations back with the rest of the snapshot,
  // so a Strip that was selected before the drop needs its ring redrawn
  // — otherwise it stays absent until the next reconcile delta happens
  // to touch that flight, which could be a while on a quiet board.
  refreshCorrelatedHighlight();
  updateMap();
  renderAirspacePanel();
  renderRunwayStatusPanel();
  // §5.6.3 — replay every still-pending Mutation against this fresh
  // baseline. A no-op on the very first connect (nothing pending
  // yet); on a RECONNECT this is what stops a Mutation in flight at
  // the moment of disconnect from being silently lost forever (its
  // ack could never otherwise arrive on the dead connection —
  // defect D6, "the worst failure mode in the system").
  replayPendingEfspMutations((orphaned) => {
    settleEfspAck({ clientMutationId: orphaned.clientMutationId, ok: false, reason: 'CONNECTION_LOST', detail: 'its target is no longer on the Board' });
    notifyEfspOrphanedMutation(orphaned);
  });
});

// The answer to this client's efsp-resync (docs/adr/0081, S-12): a snapshot or a
// delta, tagged. Unwrapped into the message it carries, so one code path applies it.
registerEfspMessage('efsp-resync-reply', (msg) => {
  // `stores` (crc-sync docs/adr/0106): the slices of the stores outside the Board that this client was behind in. Each
  // replaces that store's state; the family's own handler then redraws, re-dispatched with an empty delta. Any reply
  // that carries `stores` (or answers 'stores') settles the store resyncs in flight: a store left out was current.
  if (msg.answer === 'stores' || msg.stores) {
    for (const key of applyEfspStoreSlices(msg.stores)) {
      dispatchEfspMessage({ type: STORE_SYNC.find(d => d.key === key).deltaType });
    }
    noteEfspStoreAnswerLanded();
  }
  if (msg.answer !== 'stores') dispatchEfspMessage(efspResyncReplyAsMessage(msg));
});

registerEfspMessage('efsp-board-delta', (msg) => {
  // Where the changed Strips sat BEFORE this delta, so the panel can
  // tell a Strip that just arrived in one of this controller's Bays
  // from one that merely changed (efsp-arrivals.js, docs/adr/0057).
  const placementBefore = captureEfspPlacement(msg, getEfspStrip);
  // A delta from another Board lifetime asks for a resync (answered with a snapshot).
  noteEfspBoardMessageForSync(msg);
  noteUndoBoardEpoch(msg.facilityId || getEfspFacility(), msg.boardEpoch);
  applyEfspDelta(msg);
  if (!efspEpochChangeOf(msg)) noteEfspResyncAnswered(msg.facilityId || getEfspFacility());
  if (placementBefore) noteEfspBoardArrivals(msg, placementBefore);
  refreshEfspPanel();
  renderAllOpenEfspBays();
});

// Sent every 500ms unconditionally (ws-hub.js's _tick) — the genuine
// periodic signal a staleness check needs, since "no message" on a
// quiet Board is not itself evidence the connection died (guide §5.6
// rule 5). See efsp-panel.js's staleness interval.
registerEfspMessage('efsp-heartbeat', (msg) => {
  noteEfspHeartbeat();
  noteEfspHeartbeatForSync(msg);
});

registerEfspMessage('efsp-mutation-ack', (msg) => {
  // This controller's own move can land here BEFORE the board delta that
  // also carries it, and by then the Strip already sits in its new Bay —
  // so arrivals are noted from the ack too (docs/adr/0057). Whichever of
  // the two comes second sees no Bay change and adds nothing.
  const ackAsDelta = { strips: { updated: msg.strip ? [msg.strip] : [] } };
  const ackPlacementBefore = captureEfspPlacement(ackAsDelta, getEfspStrip);
  noteEfspBoardMessageForSync(msg);
  const result = applyEfspMutationAck(msg);
  if (ackPlacementBefore) {
    noteEfspBoardArrivals(ackAsDelta, ackPlacementBefore);
    refreshEfspPanel(); // the tab counts and arrivals line
  }
  noteUndoBoardEpoch(msg.facilityId, msg.boardEpoch);
  // The Undo slot (docs/adr/0100 §10) takes the ack's `undoable`; an Undo's own refusal shows in the slot line.
  const handled = settleEfspAck(msg, result); // the request's own continuation (Undo, CreateStrip, ...), if it left one
  noteUndoAck(msg, result.pending);
  if (!result.ok) console.warn('[efsp] Mutation rejected:', result.reason, msg);
  if (!handled) notifyEfspMutationAck(result);
  renderAllOpenEfspBays();
});

registerEfspMessage('efsp-positions-ack', (msg) => {
  noteEfspPositionsAck(msg); // the server's signedOn is the truth (adopted)
  console.warn('[efsp] efsp-positions-ack received, signedOn =', msg.signedOn, 'warnings =', msg.warnings);
  renderPositionControls();
  renderPositionWarnings(msg.warnings);
  refreshEfspPanel();
});

// crc-sync docs/adr/0105 (H104): GC signed off holding Strips while this controller is LC's Primary: offered GC as well.
registerEfspMessage('efsp-position-offer', (msg) => {
  noteEfspPositionOffer(msg);
});

// WP5 (crc-sync's docs/adr/0045) — changed correlation records, once
// per server reconcile tick. updateMap() matters as much as the
// re-render: a re-bind has to move the ring on the scope, not just the
// badge on the Strip.
registerEfspMessage('efsp-correlation-delta', (msg) => {
  applyEfspCorrelationDelta(msg);
  refreshCorrelatedHighlight();
  renderAllOpenEfspBays();
  refreshEfspPanel();
  updateMap();
});

registerEfspMessage('efsp-correlation-ack', (msg) => {
  // _showMutationError's signature is (reason, detail, context) — this
  // passed the whole message object as `reason` and rendered
  // "[object Object]" for every refused bind (docs/ui-findings F-103).
  // A correlation op registers nothing pending (efsp-ws.js: the §5.6.3
  // replay machinery is keyed on Strip identity), so the flight can only
  // be named from whatever record the ack carries back.
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.correlation ? { flightDataId: msg.correlation.flightDataId } : null);
  applyEfspCorrelationDelta({ correlations: { updated: msg.correlation ? [msg.correlation] : [] } });
  refreshCorrelatedHighlight();
  renderAllOpenEfspBays();
  updateMap();
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
registerEfspMessage('efsp-marsa-delta', (msg) => {
  applyEfspMarsaDelta(msg);
  refreshMarsaHighlight();
  renderAllOpenEfspBays();
});

registerEfspMessage('efsp-marsa-ack', (msg) => {
  // Same one-argument bug as efsp-correlation-ack above, same fix. A
  // relation is named by its participants, not by one Strip — §9.2's
  // "model it as an edge, not a flag" applies to the refusal too.
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.marsa ? { flightDataIds: msg.marsa.participants } : null);
  applyEfspMarsaDelta({ marsa: { updated: msg.marsa ? [msg.marsa] : [] } });
  refreshMarsaHighlight();
  renderAllOpenEfspBays();
});

// docs/adr/0058 — the whole conformance + short-term conflict picture,
// and (docs/adr/0067) every forwarding obligation due right now, sent
// when it changes and once on connect; one no longer listed is cleared.
registerEfspMessage('efsp-alerts', (msg) => {
  applyEfspAlerts(msg);
  renderAllOpenEfspBays();
  updateMap();
  updateTrackPanel();
});

// crc-sync's docs/adr/0093 — who is on which SFA frequency, sent whole on every change.
registerEfspMessage('efsp-sfa-delta', (msg) => {
  applyEfspSfaDelta(msg);
  renderAllOpenEfspBays();
});

registerEfspMessage('efsp-sfa-ack', (msg) => {
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: 'SFA rotation' });
  if (msg.sfaRotation) applyEfspSfaDelta({ sfaRotation: msg.sfaRotation });
  renderAllOpenEfspBays();
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
