'use strict';

// The wire's shared frame builders: the Strip stamp, the delta shapes every family and the Board path send,
// and the read-scope helper the filters use. Moved out of efsp-ws.js (WIRE lane); nothing else changed.

const VERSION = 1;

/**
 * Every Strip record leaving this module — snapshot, delta, ack — is stamped
 * here rather than spread with `{ ...s, facilityId }` at each of the six places
 * one goes out.
 *
 * `facilityId` (WP4A): without it a client's local Map (efsp-state.js, which
 * just Map.set()s whatever record arrives) would end up with delta-derived
 * Strips missing it entirely, breaking every Facility-scoped filter downstream.
 *
 * `nla`: what pressing this Strip's NLA button would do right now, and the
 * reason it would be refused when it would be — see BoardStore.nlaStatusFor.
 * Guide §3.5 rule 2 requires the reason to be RENDERED, not the control merely
 * greyed out, and until now every reason was computed on the press and never
 * left the server: an NLA the server would refuse looked exactly like one it
 * would accept (docs/ui-findings/lane4.md F-408). Computed per Strip for its
 * OWNER, which is the only Position the button is ever offered to (guide §3.5,
 * the Board's NOT_OWNER gate, board/strip-ops.js) — Strips are not otherwise scoped per client,
 * so there is nothing per-connection to compute here.
 *
 * Derived at the wire boundary, never stored on the Strip: it is a function of
 * Position staffing and the clock as much as of the Strip, so persisting it
 * would make the Board snapshot carry a value that is wrong the moment anyone
 * takes or gives up a Position.
 *
 * Every stamp is reported to `ctx.nlaStatusMonitor`, which sweeps for the
 * status changes no message causes — a release time passing, an EDCT window
 * closing. Telling it what went out here is what stops it re-sending a status
 * a Mutation's own ack and broadcast have just carried; see
 * nla-status-monitor.js.
 */
function stampStrip(boardStore, strip, facilityId, ctx) {
  const nla = boardStore ? boardStore.nlaStatusFor(strip) : null;
  if (ctx && ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.note(strip.stripId, nla);
  return { ...strip, facilityId, nla };
}

/** The flight data a Mutation changed — the one it addressed, plus any it wrote as a side effect — deduplicated by flightDataId, most recent value winning. */
function mergeFlightDataList(primary, extra) {
  const byId = new Map();
  for (const flightData of [primary, ...(extra || [])]) if (flightData && flightData.flightDataId) byId.set(flightData.flightDataId, flightData);
  return [...byId.values()];
}

/**
 * The `strips` section of a board-delta for the Strips a Board event touched
 * (docs/adr/0081): `first` (the addressed Strip, already stamped) leads, then
 * every other touched id, looked up now. DROPPED goes into `gone`, everything
 * else is stamped into `updated` — through stampStrip, never by hand.
 */
function touchedStrips(ctx, boardStore, facilityId, touchedIds, first) {
  const updated = [];
  const gone = [];
  const place = (s) => { if (s.state === 'DROPPED') gone.push(s.stripId); else updated.push(s); };
  if (first) place(first);
  for (const id of touchedIds) {
    if (first && id === first.stripId) continue;
    const s = boardStore ? boardStore.getStrip(id) : null;
    if (!s) { gone.push(id); continue; }
    if (s.state === 'DROPPED') gone.push(id);
    else updated.push(stampStrip(boardStore, s, facilityId, ctx));
  }
  return { updated, gone };
}

/**
 * An efsp-board-delta for one Facility. Every one carries `boardEpoch` beside
 * `boardSeq` (docs/adr/0081): a seq only means something within one Board
 * lifetime, and the epoch names the lifetime.
 */
function boardDelta(ctx, boardStore, facilityId, strips, flightDataList, positions = []) {
  return {
    version: VERSION, type: 'efsp-board-delta',
    boardSeq: boardStore ? boardStore.currentSeq : undefined,
    boardEpoch: boardStore ? boardStore.epoch : undefined,
    facilityId,
    strips,
    flightDataList: { updated: flightDataList },
    positions: { updated: positions },
  };
}

/**
 * An efsp-board-delta a SERVER-originated change sends (the NLA-status sweep, the archiver): `payload` is
 * `{ facilityId, boardSeq, boardEpoch?, strips, gone, flightDataListGone }`. The Board's own epoch names the lifetime when the
 * caller did not stamp one (docs/adr/0081). Flight data appears only as `gone`: neither caller ever updates one here.
 */
function serverBoardDelta(payload, boardStoreFor) {
  const board = boardStoreFor ? boardStoreFor(payload.facilityId) : null;
  return {
    version: VERSION, type: 'efsp-board-delta',
    boardSeq: payload.boardSeq,
    boardEpoch: payload.boardEpoch !== undefined ? payload.boardEpoch : (board ? board.epoch : undefined),
    facilityId: payload.facilityId,
    strips: { updated: payload.strips || [], gone: payload.gone || [] },
    flightDataList: payload.flightDataListGone && payload.flightDataListGone.length ? { updated: [], gone: payload.flightDataListGone } : { updated: [] },
    positions: { updated: [] },
  };
}

/**
 * An efsp-correlation-delta (docs/adr/0045): its own delta type and seq, a correlation is not a Strip. With a `store`
 * it carries the store's seq and lifetime (docs/adr/0106); with none it is the seq-less supplement a filtered Strip brings.
 */
function correlationDelta(store, correlations, stats) {
  const frame = { version: VERSION, type: 'efsp-correlation-delta' };
  if (store) { frame.correlationSeq = store.currentSeq; frame.correlationEpoch = store.epoch; }
  frame.correlations = { updated: correlations };
  if (stats !== undefined) frame.stats = stats;
  return frame;
}

/** Its own delta type with its own seq (rule 5's deliberate deviation, docs/adr/0061). */
function runwayStatusDelta(store, records) {
  return {
    version: VERSION, type: 'efsp-runway-status-delta',
    runwayStatusSeq: store.currentSeq, runwayStatusEpoch: store.epoch,
    runwayStatuses: { updated: records.filter(Boolean) },
  };
}

/** The whole rotation record, sent whole: small. Its own delta type and seq, like efsp-carrier-delta. */
function sfaDelta(sfaStore) {
  return { version: VERSION, type: 'efsp-sfa-delta', sfaSeq: sfaStore.currentSeq, sfaEpoch: sfaStore.epoch, sfaRotation: sfaStore.view() };
}

/** The whole hull view(s), sent whole: small, and the derived stack comes from the server so the client never reimplements it. */
function carrierDelta(carrierStore) {
  return { version: VERSION, type: 'efsp-carrier-delta', carrierSeq: carrierStore.currentSeq, carrierEpoch: carrierStore.epoch, carriers: { updated: carrierStore.getAll() } };
}

/** Its own delta type with its own seq, like efsp-airspace-delta and efsp-correlation-delta — a relation is not a Strip and rides no Board's sequence. */
function marsaDelta(marsaStore, relations) {
  return {
    version: VERSION, type: 'efsp-marsa-delta',
    marsaSeq: marsaStore.currentSeq, marsaEpoch: marsaStore.epoch,
    marsa: { updated: relations.filter(Boolean) },
  };
}

/** Every live Strip on every Board, stamped with its Facility (what the visibility sets are computed from). */
function liveStamped(ctx) {
  const out = [];
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    const boardStore = ctx.boardStoreFor(facilityId);
    if (!boardStore) continue;
    for (const s of boardStore.getAll()) if (s.state !== 'DROPPED') out.push({ ...s, facilityId });
  }
  return out;
}

module.exports = { VERSION, stampStrip, mergeFlightDataList, touchedStrips, boardDelta, serverBoardDelta, correlationDelta, runwayStatusDelta, marsaDelta, carrierDelta, sfaDelta, liveStamped };
