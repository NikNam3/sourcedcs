'use strict';
import { registerEfspMessage, dispatchEfspMessage } from './efsp-message-registry.js';
import { renderPositionControls, renderPositionWarnings } from '../radar-panel.js';
import { updateTrackPanel } from '../track-panel.js';
import { updateMap } from '../../geojson.js';
import {
  applyEfspAlerts, applyEfspCorrelationDelta, applyEfspDelta, applyEfspMarsaDelta, applyEfspMutationAck,
  applyEfspSnapshot, efspEpochChangeOf, getEfspFacility, getEfspStrip
} from './efsp-state.js';
import { captureEfspPlacement } from './efsp-arrivals.js';
import { applyEfspSfaDelta } from './sfa-state.js';
import {
  efspResyncReplyAsMessage, noteEfspBoardMessageForSync, noteEfspHeartbeatForSync, noteEfspResyncAnswered,
  noteEfspSnapshotLanded, replayPendingEfspMutations
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
import { onAtoAck, onAtoPreviewResult } from './ato-import.js';
import { renderAirspacePanel } from './airspace-panel.js';
import { renderFieldStatePanel } from './field-state-panel.js';

// The handlers of the EFSP message families whose state lives in bay-view.js / efsp-panel.js / efsp-state.js
// (CMSG): Board, correlation, MARSA, alerts, SFA, ATO import, positions, resync. They moved here out of app.js's
// ws.onmessage switch with their bodies and their call order unchanged. The airspace, carrier, field-state and
// metrics families register in their own panel modules.

// EFSP — sent once at connect (efsp-snapshot) plus immediately on
// every accepted Mutation (efsp-board-delta), not on this file's own
// 500ms track/delta rhythm (see crc-sync's docs/adr/0004-immediate-
// board-broadcast.md — the guide's <200ms remote-change budget).
registerEfspMessage('efsp-snapshot', (msg) => {
  applyEfspSnapshot(msg);
  if (typeof noteEfspSnapshotLanded === 'function') noteEfspSnapshotLanded();
  if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
  // §9.10's route table is fetched over HTTP, not carried on the
  // snapshot — but a snapshot is the one event that means crc-sync may
  // have restarted, which is also the only way the table can change.
  // See efsp-panel.js's _loadStereoRoutes for the bug this closes.
  if (typeof reloadEfspStereoRoutes === 'function') reloadEfspStereoRoutes();
  // MARSA relations come back with the snapshot too, so the selected
  // Strip's participant highlight has to be re-resolved before the
  // re-render below — same reason the correlation ring is, a few lines
  // down. Resolved first, rendered second: the highlight is a class each
  // Strip reads while being built.
  if (typeof refreshMarsaHighlight === 'function') refreshMarsaHighlight();
  if (typeof refreshArHighlight === 'function') refreshArHighlight(); // docs/adr/0071
  if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
  // A reconnect brings correlations back with the rest of the snapshot,
  // so a Strip that was selected before the drop needs its ring redrawn
  // — otherwise it stays absent until the next reconcile delta happens
  // to touch that flight, which could be a while on a quiet board.
  if (typeof refreshCorrelatedHighlight === 'function') refreshCorrelatedHighlight();
  updateMap();
  if (typeof renderAirspacePanel === 'function') renderAirspacePanel();
  if (typeof renderFieldStatePanel === 'function') renderFieldStatePanel();
  // §5.6.3 — replay every still-pending Mutation against this fresh
  // baseline. A no-op on the very first connect (nothing pending
  // yet); on a RECONNECT this is what stops a Mutation in flight at
  // the moment of disconnect from being silently lost forever (its
  // ack could never otherwise arrive on the dead connection —
  // defect D6, "the worst failure mode in the system").
  if (typeof replayPendingEfspMutations === 'function') {
    replayPendingEfspMutations((orphaned) => {
      if (typeof notifyEfspOrphanedMutation === 'function') notifyEfspOrphanedMutation(orphaned);
    });
  }
});

// The answer to this client's efsp-resync (docs/adr/0081, S-12): a snapshot or a
// delta, tagged. Unwrapped into the message it carries, so one code path applies it.
registerEfspMessage('efsp-resync-reply', (msg) => {
  dispatchEfspMessage(efspResyncReplyAsMessage(msg));
});

registerEfspMessage('efsp-board-delta', (msg) => {
  // Where the changed Strips sat BEFORE this delta, so the panel can
  // tell a Strip that just arrived in one of this controller's Bays
  // from one that merely changed (efsp-arrivals.js, docs/adr/0057).
  const placementBefore = typeof captureEfspPlacement === 'function' ? captureEfspPlacement(msg, getEfspStrip) : null;
  // A delta from another Board lifetime asks for a resync (answered with a snapshot).
  if (typeof noteEfspBoardMessageForSync === 'function') noteEfspBoardMessageForSync(msg);
  applyEfspDelta(msg);
  if (typeof noteEfspResyncAnswered === 'function' && !efspEpochChangeOf(msg)) noteEfspResyncAnswered(msg.facilityId || getEfspFacility());
  if (placementBefore && typeof noteEfspBoardArrivals === 'function') noteEfspBoardArrivals(msg, placementBefore);
  if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
  if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
});

// Sent every 500ms unconditionally (ws-hub.js's _tick) — the genuine
// periodic signal a staleness check needs, since "no message" on a
// quiet Board is not itself evidence the connection died (guide §5.6
// rule 5). See efsp-panel.js's staleness interval.
registerEfspMessage('efsp-heartbeat', (msg) => {
  if (typeof noteEfspHeartbeat === 'function') noteEfspHeartbeat();
  if (typeof noteEfspHeartbeatForSync === 'function') noteEfspHeartbeatForSync(msg);
});

registerEfspMessage('efsp-mutation-ack', (msg) => {
  // This controller's own move can land here BEFORE the board delta that
  // also carries it, and by then the Strip already sits in its new Bay —
  // so arrivals are noted from the ack too (docs/adr/0057). Whichever of
  // the two comes second sees no Bay change and adds nothing.
  const ackAsDelta = { strips: { updated: msg.strip ? [msg.strip] : [] } };
  const ackPlacementBefore = typeof captureEfspPlacement === 'function' ? captureEfspPlacement(ackAsDelta, getEfspStrip) : null;
  if (typeof noteEfspBoardMessageForSync === 'function') noteEfspBoardMessageForSync(msg);
  const result = applyEfspMutationAck(msg);
  if (ackPlacementBefore && typeof noteEfspBoardArrivals === 'function') {
    noteEfspBoardArrivals(ackAsDelta, ackPlacementBefore);
    if (typeof refreshEfspPanel === 'function') refreshEfspPanel(); // the tab counts and arrivals line
  }
  if (!result.ok) console.warn('[efsp] Mutation rejected:', result.reason, msg);
  if (typeof notifyEfspMutationAck === 'function') notifyEfspMutationAck(msg.clientMutationId, result);
  if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
});

registerEfspMessage('efsp-positions-ack', (msg) => {
  console.warn('[efsp] efsp-positions-ack received, held =', msg.held, 'warnings =', msg.warnings);
  if (typeof renderPositionControls === 'function') renderPositionControls();
  if (typeof renderPositionWarnings === 'function') renderPositionWarnings(msg.warnings);
  if (typeof refreshEfspPanel === 'function') refreshEfspPanel();
});

// WP5 (crc-sync's docs/adr/0045) — changed correlation records, once
// per server reconcile tick. updateMap() matters as much as the
// re-render: a re-bind has to move the ring on the scope, not just the
// badge on the Strip.
registerEfspMessage('efsp-correlation-delta', (msg) => {
  applyEfspCorrelationDelta(msg);
  if (typeof refreshCorrelatedHighlight === 'function') refreshCorrelatedHighlight();
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
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.correlation ? { fdrId: msg.correlation.fdrId } : null);
  applyEfspCorrelationDelta({ correlations: { updated: msg.correlation ? [msg.correlation] : [] } });
  if (typeof refreshCorrelatedHighlight === 'function') refreshCorrelatedHighlight();
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
  if (typeof applyEfspMarsaDelta === 'function') applyEfspMarsaDelta(msg);
  if (typeof refreshMarsaHighlight === 'function') refreshMarsaHighlight();
  renderAllOpenEfspBays();
});

registerEfspMessage('efsp-marsa-ack', (msg) => {
  // Same one-argument bug as efsp-correlation-ack above, same fix. A
  // relation is named by its participants, not by one Strip — §9.2's
  // "model it as an edge, not a flag" applies to the refusal too.
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, msg.marsa ? { fdrIds: msg.marsa.participants } : null);
  if (typeof applyEfspMarsaDelta === 'function') {
    applyEfspMarsaDelta({ marsa: { updated: msg.marsa ? [msg.marsa] : [] } });
  }
  if (typeof refreshMarsaHighlight === 'function') refreshMarsaHighlight();
  renderAllOpenEfspBays();
});

// docs/adr/0058 — the whole conformance + short-term conflict picture,
// and (docs/adr/0067) every forwarding obligation due right now, sent
// when it changes and once on connect; one no longer listed is cleared.
registerEfspMessage('efsp-alerts', (msg) => {
  if (typeof applyEfspAlerts === 'function') applyEfspAlerts(msg);
  if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
  updateMap();
  if (typeof updateTrackPanel === 'function') updateTrackPanel();
});

// crc-sync's docs/adr/0093 — who is on which SFA frequency, sent whole on every change.
registerEfspMessage('efsp-sfa-delta', (msg) => {
  if (typeof applyEfspSfaDelta === 'function') applyEfspSfaDelta(msg);
  if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
});

registerEfspMessage('efsp-sfa-ack', (msg) => {
  if (!msg.ok && typeof _showMutationError === 'function') _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: 'SFA rotation' });
  if (msg.sfaRotation && typeof applyEfspSfaDelta === 'function') applyEfspSfaDelta({ sfaRotation: msg.sfaRotation });
  if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
});

// WP7 (crc-sync docs/adr/0071) — the ATO import's two answers, sender only.
registerEfspMessage('efsp-ato-preview-result', (msg) => {
  if (typeof onAtoPreviewResult === 'function') onAtoPreviewResult(msg);
});

registerEfspMessage('efsp-ato-ack', (msg) => {
  if (typeof onAtoAck === 'function') onAtoAck(msg);
});

// WP8 (docs/adr/0065, 0072): the ack for the client measurements efsp-metrics-client.js reports.
registerEfspMessage('efsp-metrics-report-ack', (msg) => {
  if (typeof onEfspMetricsReportAck === 'function') onEfspMetricsReportAck(msg);
});
