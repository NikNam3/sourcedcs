'use strict';

/* Can TAC_C2 actually frag a mission line against a flight?
 *
 * crc-sync's efsp-scenario-military.test.mjs is the server half and proves
 * the binding works. This is the other half — the one docs/adr/0049 exists
 * because of: a green sortie says nothing about whether anything in the panel
 * can ask for it.
 *
 * The toolbar, not a Strip popover: the mission line does not exist yet, so
 * there is nothing to anchor a popover to. That means efsp-ui-reachability's
 * Strip-rendering harness cannot reach this at all (its getElementById
 * returns null by design), and this file mounts the real efsp-panel.js
 * against stub toolbar elements the way efsp-stereo-panel.test.js does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { makeElement } = require('./helpers/dom-stub.js');
const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');

const TOOLBAR_IDS = [
  'efsp-panel', 'efsp-position-tabs', 'efsp-bay-tabs', 'efsp-bay-content',
  'efsp-new-strip-callsign', 'efsp-create-strip-btn', 'efsp-create-strip-msg',
  'efsp-create-strip-role', 'efsp-create-strip-stereo', 'efsp-create-strip-bind',
  'efsp-dot-command-input', 'efsp-dot-command-preview',
  'efsp-mutation-error', 'efsp-mutation-warning', 'efsp-connection-banner',
];

function fdrFor(fdrId, callsign, extra = {}) {
  return {
    fdrId, rev: 1, provenance: {},
    identity: { callsign, beaconAssigned: extra.beacon || '0001', trackDegradationFlag: 'NONE' },
    filed: { route: extra.route || '' }, assigned: {}, tofi: {}, airspace: {}, comms: {},
    military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr: {} },
  };
}

function stripFor(stripId, fdrId, overrides = {}) {
  return {
    stripId, cid: '001', fdrId, rev: 1, role: 'ARRIVAL', state: 'INBOUND',
    ownerPositionId: 'CTR', facilityId: 'CENTER', bayId: 'ctr-enroute', rackId: 'main', orderKey: 'V',
    annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
    correlation: { state: 'UNCORRELATED' }, coordination: null, tofiCoordination: null, airspaceEntry: null,
    ...overrides,
  };
}

function mountPanel({ held = ['TAC_C2'], strips = [], fdrs = [] } = {}) {
  const sent = [];
  const els = {};
  for (const id of TOOLBAR_IDS) {
    els[id] = makeElement(id.endsWith('-btn') ? 'button' : id.includes('role') || id.includes('stereo') || id.includes('bind') ? 'select' : 'input');
  }

  const sandbox = {
    console, module: { exports: {} }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Date, JSON, Math, Number, Set, Map, Array, Object, String, Boolean, RegExp,
    isNaN, parseInt, parseFloat, Promise,
    document: { getElementById: (id) => els[id] || null, createElement: makeElement, addEventListener() {}, removeEventListener() {} },
    window: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ['efsp-nla.js', 'strip-template.js', 'efsp-state.js', 'dot-command.js',
    'efsp-gestures.js', 'annotation-editor.js', 'strip-drag.js', 'correlation-highlight.js',
    'marsa-badge.js', 'strip-fields.js', 'bay-view.js', 'strip-view.js', 'efsp-stereo-routes.js', 'efsp-panel.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }

  sandbox.getActingPositions = () => held;
  sandbox.liveStripsForCallsign = (cs) => strips.filter((s) => {
    const f = fdrs.find(x => x.fdrId === s.fdrId);
    return f && f.identity.callsign === cs;
  });
  sandbox.sendEfspCreateStrip = (actingPositionId, op, facilityId) => { sent.push({ actingPositionId, op, facilityId }); return 'mid'; };
  sandbox.sendEfspMutation = () => 'mid';
  sandbox.updateMap = () => {};
  sandbox.lookupFlightPlanClient = async () => ({ found: false });
  sandbox.listStereoRoutesClient = async () => [];

  sandbox.applyEfspSnapshot({ strips, fdrs, positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  sandbox.initEfspPanel();
  return { els, sent, sandbox };
}

/** Lets initEfspPanel's fire-and-forget stereo fetch land before a test acts. */
const settled = (m) => new Promise(resolve => setImmediate(() => resolve(m)));

const TWO_FLIGHTS = {
  strips: [
    stripFor('s1', 'f1'),
    stripFor('s2', 'f2'),
  ],
  fdrs: [
    fdrFor('f1', 'VIPER11', { beacon: '4201', route: 'LTAG DCT ALPHA' }),
    fdrFor('f2', 'VIPER12', { beacon: '4202', route: 'LTAG DCT BRAVO' }),
  ],
};

// ── the picker ───────────────────────────────────────────────────────────

test('the bind picker lists live flights, blank-first, and names more than the callsign', async () => {
  const { els } = await settled(mountPanel(TWO_FLIGHTS));
  const select = els['efsp-create-strip-bind'];
  assert.equal(select.hidden, false);
  assert.deepEqual(select.children.map(o => o.value), ['', 'f1', 'f2']);
  // Callsign alone is not enough: four jets in one package with adjacent
  // callsigns is exactly the mis-pick this has to survive.
  assert.equal(select.children[1].textContent, 'VIPER11 · 4201 · LTAG DCT ALPHA');
});

test('a flight that already has a mission line is not offered', async () => {
  const { els } = await settled(mountPanel({
    strips: [...TWO_FLIGHTS.strips, stripFor('m1', 'f1', { role: 'MISSION', state: 'TASKED', ownerPositionId: 'TAC_C2', facilityId: 'TACTICAL', bayId: 'tac-c2-tasked' })],
    fdrs: TWO_FLIGHTS.fdrs,
  }));
  // The server refuses a second one, and a control that always fails is
  // worse than no control — the same rule _marsaCandidates follows.
  assert.deepEqual(els['efsp-create-strip-bind'].children.map(o => o.value), ['', 'f2']);
});

test('the picker is hidden for GCI, which has no Tasked Bay to frag into', async () => {
  const { els } = await settled(mountPanel({ ...TWO_FLIGHTS, held: ['GCI'] }));
  assert.equal(els['efsp-create-strip-bind'].hidden, true);
});

test('the picker is hidden when there is no flight to bind against', async () => {
  const { els } = await settled(mountPanel({ strips: [], fdrs: [] }));
  assert.equal(els['efsp-create-strip-bind'].hidden, true);
});

// ── dispatch ─────────────────────────────────────────────────────────────

test('picking a flight sends fdrId and no fdr at all, with no callsign typed', async () => {
  const { els, sent } = await settled(mountPanel(TWO_FLIGHTS));
  els['efsp-create-strip-bind'].value = 'f2';
  // Deliberately empty. docs/ui-findings F-308: this test used to type
  // 'IGNORED' here and assert the op was sent anyway, which is precisely the
  // defect — a callsign demanded, accepted, and then thrown away.
  els['efsp-new-strip-callsign'].value = '';
  for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} });

  assert.equal(sent.length, 1, JSON.stringify(sent));
  assert.equal(sent[0].actingPositionId, 'TAC_C2');
  assert.equal(sent[0].op.kind, 'CreateStrip');
  assert.equal(sent[0].op.role, 'MISSION');
  assert.equal(sent[0].op.bayId, 'tac-c2-tasked');
  assert.equal(sent[0].op.fdrId, 'f2');
  // Identity comes entirely from the bound flight, down to the Mode 3/A.
  // The server refuses both keys together, so a blank `fdr` "just in case"
  // would refuse the whole op.
  assert.equal('fdr' in sent[0].op, false);
});

test('binding skips the duplicate-origination warning, which means the opposite thing here', async () => {
  // §3.6's two-press warning exists to say "you are about to mint a second
  // beacon and a second lifecycle for a flight that already has both".
  // Binding is the precise opposite — the thing that warning tells you to do
  // instead — so leaving it in would make the good path harder than the bad
  // one. One press, not two.
  const { els, sent } = await settled(mountPanel(TWO_FLIGHTS));
  els['efsp-create-strip-bind'].value = 'f1';
  els['efsp-new-strip-callsign'].value = 'VIPER11'; // a callsign that IS live
  for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} });
  assert.equal(sent.length, 1, 'the first press must go through');
  assert.equal(sent[0].op.fdrId, 'f1');
});

// ── F-308: the picker is the identity, so it is read first ───────────────

test('a picked flight needs no callsign retyped', async () => {
  // Measured before the fix: "Enter a callsign first", and no Strip created —
  // _submitCreateStrip validated the typed callsign before it ever read the
  // picker, for an op that carries no `fdr` at all.
  const { els, sent } = await settled(mountPanel(TWO_FLIGHTS));
  els['efsp-create-strip-bind'].value = 'f1';
  els['efsp-new-strip-callsign'].value = '';
  for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} });
  assert.equal(sent.length, 1, els['efsp-create-strip-msg'].textContent);
  assert.equal(sent[0].op.fdrId, 'f1');
  // And it says which flight, not "this flight" — the whole point of the picker.
  assert.match(els['efsp-create-strip-msg'].textContent, /VIPER11/);
});

test('a typed callsign that agrees with the picked flight is accepted', async () => {
  const { els, sent } = await settled(mountPanel(TWO_FLIGHTS));
  els['efsp-create-strip-bind'].value = 'f2';
  els['efsp-new-strip-callsign'].value = 'viper12';
  for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} });
  assert.equal(sent.length, 1, els['efsp-create-strip-msg'].textContent);
  assert.equal(sent[0].op.fdrId, 'f2');
});

test('a typed callsign that disagrees with the picked flight is refused, not discarded', async () => {
  // The adjacent-callsign mis-pick the picker's own comment says it has to
  // survive: measured before the fix, picking MSNA11 and typing MSNA12
  // fragged MSNA11 with no word about the callsign that was typed.
  const { els, sent } = await settled(mountPanel(TWO_FLIGHTS));
  els['efsp-create-strip-bind'].value = 'f1';       // VIPER11
  els['efsp-new-strip-callsign'].value = 'VIPER12'; // the neighbour
  for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} });
  assert.equal(sent.length, 0, 'nothing is fragged while the two disagree');
  const msg = els['efsp-create-strip-msg'].textContent;
  assert.match(msg, /VIPER11/, 'names what was picked');
  assert.match(msg, /VIPER12/, 'and what was typed — neither is thrown away');
});

test('leaving the picker blank still files a standalone mission line, exactly as before', async () => {
  const { els, sent } = await settled(mountPanel(TWO_FLIGHTS));
  els['efsp-create-strip-bind'].value = '';
  els['efsp-new-strip-callsign'].value = 'SHADOW1';
  for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.fdrId, undefined);
  assert.equal(sent[0].op.fdr.callsign, 'SHADOW1');
});

// ── the keyboard path ────────────────────────────────────────────────────

test('.mission binds by callsign, and refuses visibly when it cannot', async () => {
  const { els, sent, sandbox } = await settled(mountPanel(TWO_FLIGHTS));
  sandbox._dispatchDotCommand({ verb: 'mission', args: ['viper12'] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.fdrId, 'f2', 'case-insensitive, like every other callsign lookup');

  sandbox._dispatchDotCommand({ verb: 'mission', args: [] });
  assert.match(els['efsp-dot-command-preview'].textContent, /needs a callsign/);

  sandbox._dispatchDotCommand({ verb: 'mission', args: ['NOBODY'] });
  assert.match(els['efsp-dot-command-preview'].textContent, /no live flight NOBODY/);
  assert.equal(sent.length, 1, 'and dispatches nothing on either refusal');
});

test('.mission is refused for a Position that cannot frag one', async () => {
  const { els, sent, sandbox } = await settled(mountPanel({ ...TWO_FLIGHTS, held: ['CTR'] }));
  sandbox._dispatchDotCommand({ verb: 'mission', args: ['VIPER11'] });
  assert.equal(sent.length, 0);
  assert.match(els['efsp-dot-command-preview'].textContent, /only TAC_C2/);
});

// ── F-309: the right refusal, said for the right reason ──────────────────

test('.mission on a flight that already has a mission line says so', async () => {
  // Measured before the fix: "no live flight TWICE1 available to frag
  // against", about a flight that is live and on screen —
  // _missionBindCandidates() drops a flight that already has one, so the
  // lookup missed and the generic message fired. The refusal itself is right
  // (one mission line per flight, which crc-sync enforces); the wording was not.
  const { els, sent, sandbox } = await settled(mountPanel({
    strips: [...TWO_FLIGHTS.strips, stripFor('m1', 'f1', { role: 'MISSION', state: 'TASKED', ownerPositionId: 'TAC_C2', facilityId: 'TACTICAL', bayId: 'tac-c2-tasked' })],
    fdrs: TWO_FLIGHTS.fdrs,
  }));
  sandbox._dispatchDotCommand({ verb: 'mission', args: ['VIPER11'] });
  assert.equal(sent.length, 0);
  assert.match(els['efsp-dot-command-preview'].textContent, /already has a mission line/);
  assert.doesNotMatch(els['efsp-dot-command-preview'].textContent, /no live flight/);
});

test('.mission on a callsign nobody is flying still says the flight does not exist', async () => {
  const { els, sandbox } = await settled(mountPanel(TWO_FLIGHTS));
  sandbox._dispatchDotCommand({ verb: 'mission', args: ['NOBODY'] });
  assert.match(els['efsp-dot-command-preview'].textContent, /no live flight NOBODY/);
});
