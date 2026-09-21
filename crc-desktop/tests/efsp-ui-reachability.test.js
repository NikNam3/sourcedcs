'use strict';

/* Can a controller actually DO the things the sorties test?
 *
 * The server-side scenario suite proves the ops work. It says nothing about
 * whether anything in the panel sends them — and twice now a Block has been
 * added to the Block Map, validated server-side, gated the state machine, and
 * been completely invisible because the compact Strip view renders a
 * hand-maintained list (docs/adr/0022 closed that for 5A/24A; §3.8's whole
 * release model shipped the same way and was found by asking this question).
 *
 * Two halves:
 *  1. Reachability — every writable Block is somewhere a controller can get
 *     at, or is on an explicit list saying why not.
 *  2. Dispatch — the real bay-view.js rendering a real Strip, against a DOM
 *     stub, asserting the controls a sortie needs exist and send the right
 *     op. Not a browser, so it proves the wiring rather than the pixels.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const { BLOCK_MAPS, isBlockEditable, enumSelectOptionsFor } = require(path.join(CLIENT, 'strip-template.js'));

// ── 1. reachability ──────────────────────────────────────────────────────

/**
 * Blocks that are writable but deliberately not in the compact view, each
 * with the reason. Anything NOT here has to be reachable — that is the point
 * of the list. Keep it short and keep the reasons honest.
 */
const DELIBERATELY_NOT_IN_COMPACT_VIEW = {
  '2A': 'scratchpad annotation — reachable through the annotation editor',
  '9A': 'route restriction — annotation editor', '9B': 'route restriction — annotation editor',
  '9C': 'route restriction — annotation editor', '9D': 'full-route-clearance flag — annotation editor',
  '9E': 'remarks — annotation editor', '11': 'APREQ — annotation editor',
  '19': 'note — annotation editor', '20': 'scratchpad — annotation editor',
  '21': 'scratchpad — annotation editor', '23': 'note — annotation editor',
  '24': 'miles-in-trail remarks — annotation editor',
  '6': 'proposed departure time — set by the flight-plan lookup, rarely typed',
  '10': 'ATIS code — the airport panel owns this',
  '14': 'release time — only meaningful with a RELEASE_TIME state, set alongside it',
  '14B': 'EDCT time — same, alongside the EDCT release state',
  '14C': 'call-for-release time — same',
  '16': 'movement-area entry time — metering, deferred (§12)',
  '17': 'taxi time', '18': 'takeoff time',
  '4B': 'datalink clearance indicator — no workflow needs it yet',
  '8A': 'departure runway is in the compact view for DEPARTURE; ARRIVAL has no equivalent',
  // ARRIVAL's Block 7 is an append-only sequence of issued altitude
  // clearances (§3.7), split into named sub-Blocks — all annotation editor.
  '9A-FUEL': 'arrival restriction — annotation editor',
  '9A-DEST': 'arrival restriction — annotation editor',
  '9A-PTOUT': 'arrival restriction — annotation editor',
  '9A-VECTOR': 'arrival restriction — annotation editor',
  '9A-SPEED': 'arrival restriction — annotation editor',
  M8: 'mission remarks — annotation editor',
};

/** The compact-view list bay-view.js actually renders, read from the source. */
function compactBlocksFor(role) {
  const source = fs.readFileSync(path.join(CLIENT, 'bay-view.js'), 'utf8');
  const body = source.slice(source.indexOf('function compactBlocksFor'));
  const mission = body.match(/\['M3'[^\]]*\]/);
  const ordinary = body.match(/\['1',[\s\S]*?\]/);
  assert.ok(mission && ordinary, 'could not read the compact-view Block list out of bay-view.js');
  return JSON.parse((role === 'MISSION' ? mission[0] : ordinary[0]).replace(/'/g, '"').replace(/\s+/g, ''));
}

for (const role of Object.keys(BLOCK_MAPS)) {
  test(`every writable ${role} Block is reachable from the Strip, or explicitly listed as not`, () => {
    const compact = compactBlocksFor(role);
    const unreachable = Object.keys(BLOCK_MAPS[role]).filter((blockId) => {
      const writable = isBlockEditable(blockId, role) || enumSelectOptionsFor(blockId);
      if (!writable) return false;
      return !compact.includes(blockId) && !DELIBERATELY_NOT_IN_COMPACT_VIEW[blockId];
    });
    assert.deepEqual(unreachable, [],
      `${role}: writable but nowhere a controller can reach — add to the compact view, or to DELIBERATELY_NOT_IN_COMPACT_VIEW with a reason`);
  });
}

test('the Blocks the release and airspace sorties depend on are all on the Strip', () => {
  const compact = compactBlocksFor('DEPARTURE');
  // Each of these gates a scenario: the release state and void time drive
  // §3.8's holds, and 22 is the frequency a flight is approved onto.
  for (const blockId of ['14A', '14D', '22', '24A', 'SREG', 'IFR', '5A']) {
    assert.ok(compact.includes(blockId), `Block ${blockId} is not rendered on a Strip`);
  }
});

test('the release state is a picker, not free text — six exact strings nobody should type', () => {
  assert.deepEqual(enumSelectOptionsFor('14A'),
    ['RELEASED', 'HOLD_FOR_RELEASE', 'RELEASE_TIME', 'CLEARANCE_VOID_TIME', 'EDCT', 'CALL_FOR_RELEASE']);
});

// ── 2. dispatch ──────────────────────────────────────────────────────────

/** A DOM stub with just enough surface for bay-view.js's Strip rendering. */
function makeElement(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', title: '', value: '', disabled: false, hidden: false,
    children: [], dataset: {}, style: {}, _listeners: {},
    classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); }, toggle() {} },
    appendChild(c) {
      this.children.push(c); c.parentNode = this;
      // A real <select> reports its first option's value until one is
      // chosen; without that, every picker reads as empty here.
      if (this.tagName === 'select' && c.tagName === 'option' && this.value === '') this.value = c.value;
      return c;
    },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    replaceWith(next) { if (this.parentNode) { this.parentNode.children = this.parentNode.children.map(x => (x === this ? next : x)); next.parentNode = this.parentNode; } },
    closest() { return null; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    contains(other) { return this === other || this.children.some(c => c.contains && c.contains(other)); },
    querySelector() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 10, left: 0, right: 10, height: 10, width: 10 }; },
    focus() {}, select() {}, setAttribute() {}, removeAttribute() {},
    set innerHTML(v) { if (v === '') this.children = []; },
    get innerHTML() { return ''; },
  };
  return el;
}

/** Every descendant, flattened — the rendered Strip is a small tree. */
function descendants(el) {
  return el.children.flatMap(c => [c, ...descendants(c)]);
}

function findByText(el, text) {
  return descendants(el).find(c => c.textContent === text);
}

function click(el) {
  assert.ok(el, 'no such control on the Strip');
  assert.equal(el.disabled, false, `"${el.textContent}" is present but disabled`);
  for (const fn of el._listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
}

/**
 * Loads the real client modules into one sandbox and renders a Strip,
 * capturing whatever it would have sent. Returns the rendered element and the
 * captured dispatches.
 */
function renderStrip({ strip, fdr, held, airspaces = [] }) {
  const sent = [];
  const sandbox = {
    console, module: { exports: {} }, setTimeout, clearTimeout, Date, JSON, Math, Number, Set, Map,
    Array, Object, String, Boolean, isNaN, parseInt, parseFloat, crypto: { randomUUID: () => 'test-id' },
    document: { getElementById: () => null, createElement: makeElement, addEventListener() {}, removeEventListener() {}, body: makeElement('body') },
    window: { prompt: () => 'a note', getSelection: () => ({ removeAllRanges() {} }) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ['efsp-nla.js', 'strip-template.js', 'efsp-state.js', 'efsp-gestures.js',
    'annotation-editor.js', 'strip-drag.js', 'bay-view.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }

  // Stand in for the pieces the Strip dispatches through.
  sandbox.getActingPositions = () => held;
  sandbox.sendEfspMutation = (actingPositionId, s, op) => { sent.push({ actingPositionId, op }); return 'mid'; };
  sandbox.sendEfspAirspaceMutation = (actingPositionId, airspaceId, rev, op) => { sent.push({ actingPositionId, airspaceId, op }); };
  sandbox.convertStripToArrival = (s) => { sent.push({ op: { kind: 'ConvertToArrival' } }); };
  sandbox.getActiveEfspSearchQuery = () => null;

  sandbox.applyEfspSnapshot({ strips: [strip], fdrs: [fdr], positions: [], bays: [], airspaces });
  const el = sandbox._buildStripEl(strip);
  return { el, sent, sandbox };
}

const FDR = {
  fdrId: 'f1', rev: 1, provenance: {},
  identity: { callsign: 'VIPER1', beaconAssigned: '0001', trackDegradationFlag: 'NONE' },
  filed: {}, assigned: {}, tofi: { ifrActive: true }, airspace: {}, comms: {},
};

function stripAt(overrides) {
  return {
    stripId: 's1', cid: '001', fdrId: 'f1', rev: 1, role: 'DEPARTURE', state: 'HANDED_OFF',
    ownerPositionId: 'APP', bayId: 'app-departures', rackId: 'main', orderKey: 'V',
    annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
    correlation: { state: 'UNCORRELATED' }, coordination: null, tofiCoordination: null, airspaceEntry: null,
    ...overrides,
  };
}

test('a controller can advance a flight — the NLA button is there and sends InvokeNla', () => {
  const { el, sent } = renderStrip({ strip: stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'] });
  click(findByText(el, 'Send to Clearance'));
  assert.deepEqual(sent.map(s => s.op.kind), ['InvokeNla']);
});

test('a controller can hand a flight to Center — the Coordinate button offers all five primitives', () => {
  const { el, sent } = renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] });
  click(findByText(el, 'Coordinate…'));

  const select = descendants(el).find(c => c.tagName === 'select');
  assert.ok(select, 'the popover has no primitive picker');
  const offered = select.children.map(o => o.value);
  assert.deepEqual(offered.sort(), ['AIT', 'HANDOFF', 'OPERATIONAL_REQUEST', 'POINT_OUT', 'TRAFFIC'].sort());

  select.value = 'POINT_OUT';
  click(findByText(el, 'Send'));
  assert.equal(sent[0].op.kind, 'POINT_OUT');
  assert.equal(sent[0].op.action, 'PROPOSE');
});

test('the receiving controller can accept, reject or say stand by', () => {
  const replica = stripAt({
    bayId: 'ctr-app-coordination', ownerPositionId: 'CTR',
    coordination: { primitive: 'OPERATIONAL_REQUEST', state: 'PROPOSED', peerFacilityId: 'INCIRLIK', peerPositionId: 'APP' },
  });
  const { el, sent } = renderStrip({ strip: replica, fdr: FDR, held: ['CTR'] });

  // An operational request is answered in the words a controller uses —
  // approve / unable / stand by (§4.6) — not generic accept/reject.
  click(findByText(el, 'Approve'));
  assert.equal(sent[0].op.action, 'ACCEPT');
  // An operational request's refusal is "Unable", not "Reject" — the word a
  // controller actually says.
  click(findByText(el, 'Unable'));
  assert.equal(sent[1].op.action, 'REJECT');
  // Stand by is OPERATIONAL_REQUEST's alone — the sortie relies on it.
  click(findByText(el, 'Stand By'));
  assert.equal(sent[2].op.action, 'STAND_BY');
});

test('a controller can open tactical control, and the MRU side can accept it', () => {
  const ctr = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  click(findByText(ctr.el, 'TOFI…'));
  const picker = descendants(ctr.el).find(c => c.tagName === 'select');
  assert.ok(picker, 'CTR has two counterparts, so it must offer a choice');
  assert.deepEqual(picker.children.map(o => JSON.parse(o.value).positionId), ['TAC_C2', 'GCI']);
  click(findByText(ctr.el, 'Send TOFI'));
  assert.equal(ctr.sent[0].op.kind, 'TOFI');
  assert.equal(ctr.sent[0].op.direction, 'ENTRY');

  const mission = stripAt({
    role: 'MISSION', state: 'TASKED', ownerPositionId: 'TAC_C2', bayId: 'tac-c2-coordination',
    tofiCoordination: { direction: 'ENTRY', state: 'PROPOSED', peerFacilityId: 'CENTER', peerPositionId: 'CTR' },
  });
  const mru = renderStrip({ strip: mission, fdr: FDR, held: ['TAC_C2'] });
  click(findByText(mru.el, 'Accept TOFI Entry'));
  assert.equal(mru.sent[0].op.action, 'ACCEPT');
});

test('a TOFI exit cannot be accepted early, and the Strip says whose job it is to fix', () => {
  const mission = stripAt({
    role: 'MISSION', state: 'ON_STATION', ownerPositionId: 'TAC_C2', bayId: 'tac-c2-coordination',
    tofiCoordination: { direction: 'EXIT', state: 'PROPOSED', peerFacilityId: 'CENTER', peerPositionId: 'CTR' },
  });
  const notYet = { ...FDR, tofi: { ifrActive: true, separationRegime: 'MARSA' } };
  const { el } = renderStrip({ strip: mission, fdr: notYet, held: ['TAC_C2'] });

  const accept = findByText(el, 'Accept TOFI Exit');
  assert.equal(accept.disabled, true, 'rule 3 — separation has to be back with ATC first');
  assert.match(accept.title, /CTR must set separation regime back to ATC/);

  const ready = { ...FDR, tofi: { ifrActive: true, separationRegime: 'ATC' } };
  const { el: el2, sent } = renderStrip({ strip: mission, fdr: ready, held: ['TAC_C2'] });
  click(findByText(el2, 'Accept TOFI Exit'));
  assert.equal(sent[0].op.action, 'ACCEPT');
});

test('a controller can put a flight into an airspace, and take it out again', () => {
  const airspaces = [{
    airspaceId: 'MOA-EAST', state: 'ACTIVE', rev: 1, transitions: [],
    definition: { airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
  }];
  const { el, sent } = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'], airspaces });

  click(findByText(el, 'Airspace…'));
  const picker = descendants(el).find(c => c.tagName === 'select');
  assert.match(picker.children[0].textContent, /East MOA — ACTIVE/, 'the state is visible before committing');
  click(findByText(el, 'Approve entry'));
  assert.equal(sent[0].op.kind, 'ApproveAirspaceEntry');
  assert.equal(sent[0].op.airspaceId, 'MOA-EAST');

  const inside = stripAt({ ownerPositionId: 'CTR', airspaceEntry: { airspaceId: 'MOA-EAST', frequencyMhz: 134.25, altitudeBlock: null } });
  const out = renderStrip({ strip: inside, fdr: FDR, held: ['CTR'], airspaces });
  assert.ok(findByText(out.el, 'East MOA 134.250'), 'the Strip names where the flight is working');
  click(findByText(out.el, 'Leave airspace'));
  assert.equal(out.sent[0].op.kind, 'ClearAirspaceEntry');
});

test('a Strip working an airspace nobody activated says so on its face', () => {
  const airspaces = [{
    airspaceId: 'MOA-COLD', state: 'RETURNED', rev: 1, transitions: [],
    definition: { airspaceId: 'MOA-COLD', name: 'Cold MOA', type: 'MOA', controllingPositionId: 'CTR' },
  }];
  const inside = stripAt({ ownerPositionId: 'CTR', airspaceEntry: { airspaceId: 'MOA-COLD', frequencyMhz: null, altitudeBlock: null } });
  const { el } = renderStrip({ strip: inside, fdr: FDR, held: ['CTR'], airspaces });

  const badge = findByText(el, 'Cold MOA');
  assert.ok(badge.classList.contains('efsp-airspace-badge-unactivated'));
  assert.match(badge.title, /RETURNED, not active/);
});

test('the Drop button refuses while a flight is under tactical control', () => {
  const underControl = stripAt({
    ownerPositionId: 'CTR',
    tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE', peerFacilityId: 'TACTICAL', peerPositionId: 'TAC_C2' },
  });
  const { el } = renderStrip({ strip: underControl, fdr: FDR, held: ['CTR'] });
  const drop = findByText(el, 'Drop');
  assert.equal(drop.disabled, true, '§4.6.3 rule 2 — and the button must not look pressable');
  assert.match(drop.title, /active tactical control/);
});

test('Convert to Arrival is offered for the return leg, and refused mid-exchange', () => {
  const ready = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  click(findByText(ready.el, 'Convert to Arrival →'));
  assert.equal(ready.sent[0].op.kind, 'ConvertToArrival');

  const midExchange = stripAt({
    ownerPositionId: 'CTR',
    tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE', peerFacilityId: 'TACTICAL', peerPositionId: 'TAC_C2' },
  });
  const blocked = renderStrip({ strip: midExchange, fdr: FDR, held: ['CTR'] });
  assert.equal(findByText(blocked.el, 'Convert to Arrival →').disabled, true);
});

test('a flight sharing a block by altitude shows its restriction, not just the airspace', () => {
  const airspaces = [{
    airspaceId: 'D-12', state: 'ACTIVE', rev: 1, transitions: [],
    definition: { airspaceId: 'D-12', name: 'Danger 12', type: 'DANGER', controllingPositionId: 'CTR', workingFrequencyMhz: 135.5 },
  }];
  const restricted = stripAt({
    ownerPositionId: 'CTR',
    airspaceEntry: { airspaceId: 'D-12', frequencyMhz: 135.5, altitudeBlock: { lowerFt: 5000, upperFt: 15000 } },
  });
  const { el } = renderStrip({ strip: restricted, fdr: FDR, held: ['CTR'], airspaces });
  // Two aircraft in one block are only safe if you can see who is where.
  assert.ok(findByText(el, 'Danger 12 135.500 5000–15000 ft'),
    'the Strip must name the block, the frequency and the altitude restriction together');
});

// ── 3. the airspace board ────────────────────────────────────────────────

/** Renders the real airspace panel against the DOM stub, capturing dispatches. */
function renderAirspaceBoard({ airspaces, held, strips = [], fdrs = [] }) {
  const sent = [];
  const nodes = { 'airspace-list': makeElement('div'), 'airspace-empty': makeElement('div') };
  const sandbox = {
    console, module: { exports: {} }, setTimeout, Date, JSON, Math, Number, Set, Map, Array, Object, String,
    document: { getElementById: (id) => nodes[id] || null, createElement: makeElement, addEventListener() {}, removeEventListener() {} },
    window: { prompt: () => 'inbound traffic' },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['efsp-state.js', 'airspace-panel.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.getActingPositions = () => held;
  sandbox.sendEfspAirspaceMutation = (actingPositionId, airspaceId, rev, op) => sent.push({ actingPositionId, airspaceId, op });

  sandbox.applyEfspSnapshot({ strips, fdrs, positions: [], bays: [], airspaces });
  sandbox.initAirspacePanel();
  return { list: nodes['airspace-list'], empty: nodes['airspace-empty'], sent };
}

function moa(state, extra = {}) {
  return {
    airspaceId: 'MOA-EAST', state, rev: 4, window: null, pendingRequest: null, transitions: [],
    definition: { airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
    ...extra,
  };
}

test('a controller can run a block through its whole life from the board', () => {
  // RETURNED -> schedule.
  const available = renderAirspaceBoard({ airspaces: [moa('RETURNED')], held: ['CTR'] });
  click(findByText(available.list, 'Schedule'));
  assert.equal(available.sent[0].op.kind, 'ScheduleAirspace');
  assert.ok(available.sent[0].op.toUtc > available.sent[0].op.fromUtc, 'a booking needs a window');

  // SCHEDULED -> activate (a MOA has no second party, so no request step).
  const booked = renderAirspaceBoard({ airspaces: [moa('SCHEDULED')], held: ['CTR'] });
  click(findByText(booked.list, 'Approve activation'));
  assert.equal(booked.sent[0].op.kind, 'ApproveActivation');

  // ACTIVE -> release, RELEASED -> take back.
  const hot = renderAirspaceBoard({ airspaces: [moa('ACTIVE')], held: ['CTR'] });
  click(findByText(hot.list, 'Release'));
  assert.equal(hot.sent[0].op.kind, 'ReleaseAirspace');

  const given = renderAirspaceBoard({ airspaces: [moa('RELEASED')], held: ['CTR'] });
  click(findByText(given.list, 'Take back'));
  assert.equal(given.sent[0].op.kind, 'ReturnAirspace');
});

test('a range asks and the controlling Position answers, each seeing only their own half', () => {
  const range = (state, extra = {}) => ({
    airspaceId: 'RANGE-SOUTH', state, rev: 2, window: null, pendingRequest: null, transitions: [],
    definition: {
      airspaceId: 'RANGE-SOUTH', name: 'South Range', type: 'RANGE',
      controllingPositionId: 'APP', usingPositionId: 'SOUTH_RANGE', controlFrequencyMhz: 283.5,
    },
    ...extra,
  });

  const asking = renderAirspaceBoard({ airspaces: [range('SCHEDULED')], held: ['SOUTH_RANGE'] });
  click(findByText(asking.list, 'Request activation'));
  assert.equal(asking.sent[0].op.kind, 'RequestActivation');
  assert.equal(asking.sent[0].actingPositionId, 'SOUTH_RANGE');
  assert.equal(findByText(asking.list, 'Approve activation'), undefined, 'a range cannot activate its own airspace');

  const pending = range('SCHEDULED', { pendingRequest: { requestedPositionId: 'SOUTH_RANGE', requestedAt: Date.now() } });
  const answering = renderAirspaceBoard({ airspaces: [pending], held: ['APP'] });
  assert.ok(findByText(answering.list, 'activation requested by SOUTH_RANGE'), 'the asking is visible');
  click(findByText(answering.list, 'Deny'));
  assert.equal(answering.sent[0].op.kind, 'DenyActivation');
  assert.equal(answering.sent[0].op.reason, 'inbound traffic', 'a refusal carries a reason');
});

test('the board shows who is in a block, and at what altitude', () => {
  const strips = [{
    stripId: 's1', cid: '001', fdrId: 'f1', state: 'HANDED_OFF', ownerPositionId: 'CTR',
    airspaceEntry: { airspaceId: 'MOA-EAST', frequencyMhz: 134.25, altitudeBlock: { lowerFt: 5000, upperFt: 15000 } },
  }];
  const { list } = renderAirspaceBoard({ airspaces: [moa('ACTIVE')], held: ['CTR'], strips, fdrs: [FDR] });
  assert.ok(findByText(list, 'VIPER1 (134.250, 5000–15000 ft)'),
    'a range controller has to be able to see who is in their block and where');
});

test('with nothing configured the board says so rather than rendering blank', () => {
  const { list, empty } = renderAirspaceBoard({ airspaces: [], held: ['CTR'] });
  assert.equal(list.children.length, 0);
  assert.equal(empty.hidden, false);
});
