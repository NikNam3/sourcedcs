'use strict';

/* Hung ordnance on the Strip (guide §9.5, crc-sync's docs/adr/0069).
 *
 *  1. Drift — the client's hungOrdnanceAdvisoryFor is a copy of crc-sync's
 *     (browser scripts cannot load crc-sync), so both run over one table and
 *     must agree on every row.
 *  2. ordnanceAlertsFor with and without client field state (L1b's
 *     getEfspFieldState may not be loaded; the chip shows regardless).
 *  3. The real strip-view.js rendering the chip and reason line on a Position
 *     whose grid does not carry Block 3G, and nothing on a CLEAN Strip
 *     (docs/adr/0058).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const server = require('../../crc-sync/src/efsp/field-state.js');
const client = require(path.join(CLIENT, 'ordnance-advisory.js'));
const { makeElement, descendants } = require('./helpers/dom-stub.js');

// ── fixtures ─────────────────────────────────────────────────────────────

/** One Facility's record as crc-sync's field-state-store.js getFieldState puts it on the wire. */
function record({ pad = 'Hot cargo pad', activeRunway = '05', facilityId = 'INCIRLIK' } = {}) {
  return {
    facilityId, rev: 2, activeRunway, activeRunwaySource: 'WIND',
    runways: [{
      runwayId: '05/23', ends: ['05', '23'], endHeadingsTrue: { '05': 56, '23': 236 },
      rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, status: 'OPEN', arrestingGear: [],
      suspension: null, closure: null, lastInspection: null, pendingRequest: null,
    }],
    runwayChange: null,
    hotCargoPad: pad === null ? { occupied: false, occupantFdrId: null } : { name: pad, occupied: false, occupantFdrId: null },
    alertPad: { name: 'Alert pad', occupied: false, occupantFdrId: null },
    runwayChangeInProgress: false,
  };
}

const fdrWith = (ordnanceState, { dep = null, arr = null } = {}) => ({
  fdrId: 'f1', rev: 1, provenance: {},
  identity: { callsign: 'VIPER1', beaconAssigned: '0001', trackDegradationFlag: 'NONE' },
  filed: { departureRunway: dep }, assigned: { landingRunway: arr }, tofi: { ifrActive: true }, airspace: {}, comms: {},
  military: { ordnanceState, hookRequired: false, alertStatus: 'NONE', mtr: {} },
});

const STATES_BY_ROLE = {
  DEPARTURE: ['TAXI', 'RUNWAY_QUEUE', 'DROPPED'],
  ARRIVAL: ['INBOUND', 'HANDED_TO_TOWER', 'TAXI_IN', 'DROPPED'],
  OVERFLIGHT: ['ACTIVE', 'DROPPED'],
  MISSION: ['TASKED', 'ON_STATION', 'DROPPED'],
};

// ── 1. drift ─────────────────────────────────────────────────────────────

test('drift: the client copy and crc-sync\'s hungOrdnanceAdvisoryFor agree on every row', () => {
  const pick = (a) => (a === null ? null : { text: a.text, runway: a.runway, end: a.end, padName: a.padName, reason: a.reason, runwaySource: a.runwaySource, kind: a.kind });
  let rows = 0;
  let advised = 0;
  for (const ordnance of ['CLEAN', 'LOADED', 'HUNG', 'EXPENDED']) {
    for (const [role, states] of Object.entries(STATES_BY_ROLE)) {
      for (const state of states) {
        for (const pad of ['Hot cargo pad', null, '  ']) {
          for (const rackId of ['main', 'rwy-05', 'rwy-23', 'nowhere']) {
            for (const runwayText of [null, '', '23', 'RWY 5', '05/23', '17', 'rw23']) {
              for (const activeRunway of ['05', '23', null]) {
                for (const fs of [record({ pad, activeRunway }), null]) {
                  const strip = { stripId: 's1', fdrId: 'f1', facilityId: 'INCIRLIK', role, state, rackId };
                  const fdr = fdrWith(ordnance, { dep: runwayText, arr: runwayText });
                  const s = server.hungOrdnanceAdvisoryFor(strip, fdr, fs);
                  const c = client.hungOrdnanceAdvisoryFor(strip, fdr, fs);
                  assert.deepEqual(pick(c), pick(s), JSON.stringify({ ordnance, role, state, pad, rackId, runwayText, activeRunway, fs: !!fs }));
                  rows++;
                  if (s) advised++;
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(rows > 5000 && advised > 300, `the table exercised both branches (${rows} rows, ${advised} advised)`);
  // And the no-FDR / no-military rows (an archived FDR, S-R2-13).
  for (const fdr of [null, undefined, { identity: {} }, { military: null }]) {
    const strip = { role: 'ARRIVAL', state: 'INBOUND', rackId: 'main' };
    assert.equal(client.hungOrdnanceAdvisoryFor(strip, fdr, record()), server.hungOrdnanceAdvisoryFor(strip, fdr, record()));
  }
});

// ── 2. ordnanceAlertsFor ─────────────────────────────────────────────────

function alertsSandbox({ fdr, fieldState }) {
  const sandbox = { module: { exports: {} }, getEfspFdr: () => fdr };
  if (fieldState !== undefined) sandbox.getEfspFieldState = (facilityId) => (fieldState && fieldState.facilityId === facilityId ? fieldState : null);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(CLIENT, 'ordnance-advisory.js'), 'utf8'), sandbox, { filename: 'ordnance-advisory.js' });
  return sandbox;
}

const arrivalStrip = (over = {}) => ({ stripId: 's1', fdrId: 'f1', facilityId: 'INCIRLIK', role: 'ARRIVAL', state: 'HANDED_TO_TOWER', rackId: 'main', ...over });

test('ordnanceAlertsFor: one amber HUNG chip with the pad sentence when field state is loaded', () => {
  const sb = alertsSandbox({ fdr: fdrWith('HUNG', { arr: '05' }), fieldState: record() });
  const alerts = sb.ordnanceAlertsFor(arrivalStrip());
  assert.equal(alerts.length, 1);
  assert.deepEqual({ ...alerts[0] }, {
    key: 'ord', tone: 'attn', legacy: 'efsp-ord-indicator', text: 'HUNG',
    reason: 'Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller\'s call. Runway 05/23 (05) assigned.',
  });
  assert.ok(alerts[0].text.length <= 8 && alerts[0].text === alerts[0].text.toUpperCase(), 'chip label: capitals, 8 characters at most');
});

test('ordnanceAlertsFor: the chip still shows with no client field state at all (L1b not loaded)', () => {
  const sb = alertsSandbox({ fdr: fdrWith('HUNG'), fieldState: undefined });
  assert.equal(typeof sb.getEfspFieldState, 'undefined');
  const alerts = sb.ordnanceAlertsFor(arrivalStrip());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].text, 'HUNG');
  assert.equal(alerts[0].reason, 'Hung ordnance. The hot cargo pad is shown when field state is available.');
});

test('ordnanceAlertsFor: a Facility with no record yet shows the generic sentence too', () => {
  const sb = alertsSandbox({ fdr: fdrWith('HUNG'), fieldState: null });
  assert.equal(sb.ordnanceAlertsFor(arrivalStrip()).at(0).reason, client.ORDNANCE_NO_FIELD_STATE_REASON);
});

test('ordnanceAlertsFor: nothing for CLEAN/LOADED/EXPENDED, a DROPPED Strip, an OVERFLIGHT, a MISSION line or a missing FDR', () => {
  for (const state of ['CLEAN', 'LOADED', 'EXPENDED']) {
    assert.equal(alertsSandbox({ fdr: fdrWith(state), fieldState: record() }).ordnanceAlertsFor(arrivalStrip()).length, 0, state);
  }
  const hung = alertsSandbox({ fdr: fdrWith('HUNG'), fieldState: record() });
  assert.equal(hung.ordnanceAlertsFor(arrivalStrip({ state: 'DROPPED' })).length, 0);
  assert.equal(hung.ordnanceAlertsFor(arrivalStrip({ role: 'OVERFLIGHT', state: 'ACTIVE' })).length, 0);
  assert.equal(hung.ordnanceAlertsFor(arrivalStrip({ role: 'MISSION', state: 'ON_STATION' })).length, 0);
  assert.equal(alertsSandbox({ fdr: null, fieldState: record() }).ordnanceAlertsFor(arrivalStrip()).length, 0);
});

// ── 3. the real Strip ────────────────────────────────────────────────────
//
// A loader of its own, copied from efsp-ui-reachability.test.js's renderStrip
// rather than shared (that harness is not this lane's to change).

function renderStrip({ strip, fdr, held, fieldState }) {
  const sandbox = {
    console, module: { exports: {} }, setTimeout, clearTimeout, Date, JSON, Math, Number, Set, Map,
    Array, Object, String, Boolean, isNaN, parseInt, parseFloat, crypto: { randomUUID: () => 'test-id' },
    document: {
      getElementById: () => null, createElement: makeElement, body: makeElement('body'),
      activeElement: null, addEventListener() {}, removeEventListener() {},
    },
    window: {
      prompt: () => null, getSelection: () => ({ removeAllRanges() {} }), innerWidth: 1600, innerHeight: 1000,
      addEventListener() {}, removeEventListener() {},
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(CLIENT, '../../track-label.js'), 'utf8'), sandbox, { filename: 'track-label.js' });
  for (const file of ['efsp-nla.js', 'strip-template.js', 'efsp-state.js', 'efsp-arrivals.js', 'efsp-gestures.js',
    'annotation-editor.js', 'strip-drag.js', 'correlation-highlight.js', 'marsa-badge.js', 'ordnance-advisory.js',
    'strip-fields.js', 'bay-view.js', 'strip-view.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.getActingPositions = () => held;
  sandbox.sendEfspMutation = () => 'mid';
  sandbox.getActiveEfspSearchQuery = () => null;
  sandbox.updateMap = () => {};
  sandbox.renderAllOpenEfspBays = () => {};
  sandbox.getCurrentEfspRefusal = () => null;
  sandbox.window.getLatestTrack = () => null;
  sandbox.window.getAllTracks = () => [];
  if (fieldState !== undefined) sandbox.getEfspFieldState = (id) => (fieldState && fieldState.facilityId === id ? fieldState : null);
  sandbox.applyEfspSnapshot({ strips: [strip], fdrs: [fdr], positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  return { el: sandbox._buildStripEl(strip), sandbox };
}

const appArrival = () => ({
  stripId: 's1', cid: '001', fdrId: 'f1', rev: 1, facilityId: 'INCIRLIK', role: 'ARRIVAL', state: 'INBOUND',
  ownerPositionId: 'APP', bayId: 'app-inbound', rackId: 'main', orderKey: 'V',
  annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
  correlation: { state: 'UNCORRELATED' }, coordination: null, tofiCoordination: null, airspaceEntry: null,
});

const byClass = (el, cls) => descendants(el).filter(c => (c.className || '').split(/\s+/).includes(cls));

test('a HUNG arrival shows the HUNG chip and its reason line on every Position\'s Strip, whether or not 3G is on its grid', () => {
  for (const positionId of ['APP', 'GND', 'TWR', 'CTR']) {
    const strip = { ...appArrival(), ownerPositionId: positionId };
    const { el, sandbox } = renderStrip({ strip, fdr: fdrWith('HUNG', { arr: '23' }), held: [positionId], fieldState: record() });
    const chip = descendants(el).find(c => c.dataset && c.dataset.slot === 'ord');
    assert.ok(chip, `${positionId}: no ord chip`);
    assert.equal(chip.textContent, 'HUNG');
    assert.match(chip.className, /efsp-ind-attn/);
    assert.match(chip.className, /efsp-ord-indicator/);
    const reasons = byClass(el, 'efsp-strip-reason').map(r => r.textContent);
    assert.ok(reasons.includes('Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller\'s call. Runway 05/23 (23) assigned.'),
      `${positionId}: ${JSON.stringify(reasons)}`);
    // GND has no 3G on its grid (H55: only the Positions a pilot reports to), and still sees it.
    if (positionId === 'GND') assert.equal(sandbox.compactBlocksFor('ARRIVAL', 'GND').includes('3G'), false);
    // Chips in their slot order: ord after the conformance warnings, before trk.
    const slots = descendants(el).filter(c => c.dataset && c.dataset.slot).map(c => c.dataset.slot);
    assert.ok(slots.indexOf('ord') < (slots.indexOf('trk') === -1 ? Infinity : slots.indexOf('trk')));
  }
});

test('the chip shows with no client field state loaded, with the generic sentence', () => {
  const { el } = renderStrip({ strip: appArrival(), fdr: fdrWith('HUNG'), held: ['APP'], fieldState: undefined });
  assert.ok(descendants(el).find(c => c.dataset && c.dataset.slot === 'ord'));
  assert.ok(byClass(el, 'efsp-strip-reason').some(r => r.textContent === client.ORDNANCE_NO_FIELD_STATE_REASON));
});

test('the advisory never disables the NLA button', () => {
  const strip = { ...appArrival(), ownerPositionId: 'TWR', state: 'HANDED_TO_TOWER', bayId: 'twr-arrivals' };
  const clean = renderStrip({ strip, fdr: fdrWith('CLEAN', { arr: '05' }), held: ['TWR'], fieldState: record() });
  const hung = renderStrip({ strip, fdr: fdrWith('HUNG', { arr: '05' }), held: ['TWR'], fieldState: record() });
  const buttons = (el) => descendants(el).filter(c => c.tagName === 'button').map(b => [b.textContent, b.disabled]);
  assert.deepEqual(buttons(hung.el), buttons(clean.el));
  assert.ok(buttons(hung.el).some(([label, disabled]) => /Cleared to Land|Final|Land/i.test(label) && !disabled), JSON.stringify(buttons(hung.el)));
  assert.equal(byClass(hung.el, 'efsp-nla-inhibit-reason').length, 0);
});

test('a CLEAN arrival shows no indicator row at all (docs/adr/0058)', () => {
  const { el } = renderStrip({ strip: appArrival(), fdr: fdrWith('CLEAN'), held: ['APP'], fieldState: record() });
  assert.equal(byClass(el, 'efsp-strip-slots').length, 0);
  assert.equal(byClass(el, 'efsp-strip-reason').length, 0);
});
