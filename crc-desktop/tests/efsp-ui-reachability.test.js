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
const { BLOCK_MAPS, isBlockEditable, enumSelectOptionsFor, isBooleanToggleBlock } = require(path.join(CLIENT, 'strip-template.js'));

// ── 1. reachability ──────────────────────────────────────────────────────
//
// This half used to hold every writable Block to being in the compact view OR
// on a DELIBERATELY_NOT_IN_COMPACT_VIEW excuse list. That list is gone, and
// its absence is the point: most of its entries excused a Block with the
// reason "annotation editor" — a surface that was never built. An excuse list
// whose reasons name surfaces that do not exist is a test reporting green
// while covering nothing, and it hid the fact that five of six MARSA interlock
// Blocks, and several guide-REQUIRED Blocks including 9A-FUEL, could not be
// reached from the panel at all.
//
// So the check is behavioural now: render the Strip, render it expanded, and
// require every writable Block to actually appear in one of them. Nothing can
// be excused by assertion.

/** The compact Block list bay-view.js actually renders, read from the module rather than scraped out of its source. */
function compactBlocksFor(role) {
  return clientSandbox().compactBlocksFor(role);
}

/**
 * Every Block id the expanded view renders for a Role — by pressing the real
 * toggle, not by poking module state.
 *
 * `_expandedStripId` is a `let`, and a `let` at the top level of a vm script
 * is a lexical binding rather than a property of the context, so assigning
 * `sandbox._expandedStripId` creates a different variable the module never
 * reads. Clicking the button is both the only thing that works and the more
 * honest test: it exercises the path a controller takes.
 */
function expandedBlocksFor(role) {
  const strip = stripAt({ role, state: role === 'MISSION' ? 'TASKED' : 'PROPOSED', ownerPositionId: 'OPS' });
  const r = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  // The toggle re-renders every open Bay, which needs a real DOM; the state
  // it sets is what matters, so the rebuild is stubbed and done by hand below.
  r.sandbox.renderAllOpenEfspBays = () => {};
  const toggle = descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn'));
  assert.ok(toggle, `${role}: no expand toggle on the Strip`);
  click(toggle);
  const expandedEl = r.sandbox._buildStripEl(strip);
  return descendants(expandedEl).filter(c => c.dataset && c.dataset.expandedBlock).map(c => c.dataset.expandedBlock);
}

for (const role of Object.keys(BLOCK_MAPS)) {
  test(`every writable ${role} Block is somewhere a controller can reach`, () => {
    const compact = compactBlocksFor(role);
    const expanded = expandedBlocksFor(role);
    const unreachable = Object.keys(BLOCK_MAPS[role]).filter((blockId) => {
      const writable = isBlockEditable(blockId, role) || enumSelectOptionsFor(blockId) || isBooleanToggleBlock(blockId);
      if (!writable) return false;
      return !compact.includes(blockId) && !expanded.includes(blockId);
    });
    assert.deepEqual(unreachable, [], `${role}: writable but nowhere a controller can reach`);
  });
}

test('the expanded view shows what the chips do NOT, in Block Map order', () => {
  // It listed every Block at first, which made it mostly a second copy of what
  // the controller was already looking at — 26 of ~30 rows saying nothing new,
  // with the few that mattered buried among them. The panel's job is reaching
  // what the chips cannot.
  //
  // Map order is deliberate: the order of the paper strip and of the guide's
  // own §6.2/§6.3 tables, so it is learnable and stable rather than derived
  // from a property that changes as the Strip is worked.
  for (const role of Object.keys(BLOCK_MAPS)) {
    const compact = compactBlocksFor(role);
    const expanded = expandedBlocksFor(role);
    const expected = Object.keys(BLOCK_MAPS[role]).filter(id => !compact.includes(id));
    assert.deepEqual(expanded, expected, role);
    assert.equal(expanded.some(id => compact.includes(id)), false, `${role}: duplicates a chip`);
  }
});

test('a chip whose history is truncated stays in the expanded view, so the * has somewhere to land', () => {
  // §3.7 rule 2's overflow indicator promises "full history on tap". Filtering
  // a Block out just because it has a chip would make that promise point at
  // nothing — so a Block the chip cannot fully show is the one exception to
  // "only what is not already on the Strip".
  const many = ['2000', '3000', '4000', '5000'].map(v => ({ value: v, status: 'SUPERSEDED', at: 1, by: 'c-OPS' }));
  const strip = stripAt({
    state: 'PROPOSED', ownerPositionId: 'OPS',
    annotations: { 21: { blockId: '21', entries: [...many, { value: '6000', status: 'ACTIVE', at: 2, by: 'c-OPS' }] } },
  });
  assert.ok(compactBlocksFor('DEPARTURE').includes('21'), 'precondition: 21 is a chip');

  const r = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  r.sandbox.renderAllOpenEfspBays = () => {};
  click(descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn')));
  const expandedEl = r.sandbox._buildStripEl(strip);
  const ids = descendants(expandedEl).filter(c => c.dataset && c.dataset.expandedBlock).map(c => c.dataset.expandedBlock);
  assert.ok(ids.includes('21'), 'a truncated chip must still be reachable in full');
});

test('an expansion toggle makes the reconciler rebuild the Strip', () => {
  // The bug this exists for: the toggle set its state and asked for a
  // re-render, but the reconciler reuses an element unless something marks it
  // dirty, and it only ever compared `rev` and selection. Expansion is
  // client-local and moves neither, so the button did nothing visible at all.
  //
  // Asserted against the RULE, not against a freshly-built element — a test
  // that only checks the `data-expanded` stamp passes whether or not the
  // reconciler ever reads it, which is exactly how the first version of this
  // test let the bug back through.
  const { sandbox, el } = renderStrip({ strip: stripAt({ stripId: 's1' }), fdr: FDR, held: ['APP'] });
  const needsRebuild = sandbox._stripElNeedsRebuild;
  const wanted = { rev: Number(el.dataset.rev) };

  assert.equal(el.dataset.expanded, '0', 'the element records what it was built as');
  assert.equal(needsRebuild(el, wanted, null, null), false, 'nothing changed');
  assert.equal(needsRebuild(el, wanted, null, 's1'), true, 'now expanded — must rebuild');
  assert.equal(needsRebuild(el, wanted, 's1', null), true, 'now selected — must rebuild');
  assert.equal(needsRebuild(el, { rev: wanted.rev + 1 }, null, null), true, 'rev moved — must rebuild');
});

test('the clearance Blocks a controller edits on most Strips are chips, per Role', () => {
  // The criterion is EDIT FREQUENCY, not interlock-ness — see
  // COMPACT_BLOCKS_BY_ROLE's comment. A heading and an initial altitude are
  // issued with every departure clearance; a radar vector constantly.
  assert.ok(compactBlocksFor('DEPARTURE').includes('20'), 'DEPARTURE HDG');
  assert.ok(compactBlocksFor('DEPARTURE').includes('21'), 'DEPARTURE INIT ALT');
  assert.ok(compactBlocksFor('ARRIVAL').includes('9A-VECTOR'), 'ARRIVAL VECTOR');
  assert.ok(compactBlocksFor('OVERFLIGHT').includes('7A'), 'OVERFLIGHT ASGN ALT');
  assert.ok(compactBlocksFor('OVERFLIGHT').includes('9A-VECTOR'), 'OVERFLIGHT VECTOR');
  // And the Role-specific meanings do not leak: 20/21 are radar scratchpads on
  // the airborne Roles, which is why they could never live in a shared list.
  assert.equal(compactBlocksFor('ARRIVAL').includes('21'), false);
  assert.equal(compactBlocksFor('OVERFLIGHT').includes('20'), false);
});

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

/**
 * One sandbox, built lazily, for reading bay-view.js's own module values.
 *
 * This replaces a regex that scraped the compact-Block list out of the source
 * (`body.match(/\['1',[\s\S]*?\]/)`) and assumed exactly two array literals,
 * the ordinary one starting `['1',`. Making the list per-Role broke it
 * instantly. Reading the real function from the real module cannot drift.
 */
let _readSandbox = null;
function clientSandbox() {
  if (!_readSandbox) _readSandbox = renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] }).sandbox;
  return _readSandbox;
}

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
    querySelector(sel) {
      // Enough for `.class` lookups, which is all the panel uses — notably
      // _isProtectedStripEl's `.efsp-block-input` check, which silently could
      // not fire while this returned null and so was untestable.
      if (typeof sel !== 'string' || !sel.startsWith('.')) return null;
      const want = sel.slice(1);
      const hit = (n) => (n.className || '').split(/\s+/).includes(want)
        ? n : n.children.reduce((found, c) => found || hit(c), null);
      return this.children.reduce((found, c) => found || hit(c), null);
    },
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
function renderStrip({ strip, fdr, held, airspaces = [], correlations = [], tracks = [], marsa = [], otherStrips = [] }) {
  const sent = [];
  const docListeners = {};
  const sandbox = {
    console, module: { exports: {} }, setTimeout, clearTimeout, Date, JSON, Math, Number, Set, Map,
    Array, Object, String, Boolean, isNaN, parseInt, parseFloat, crypto: { randomUUID: () => 'test-id' },
    // Document-level listeners are RECORDED, not dropped. The dismiss-on-
    // outside-click popovers register here in the capture phase, and a stub
    // that swallowed them made a whole class of bug — a popover that closes on
    // its own controls — structurally invisible to every test in this file.
    document: {
      getElementById: () => null, createElement: makeElement, body: makeElement('body'),
      addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
      removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter(f => f !== fn); },
    },
    window: { prompt: () => 'a note', getSelection: () => ({ removeAllRanges() {} }) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const file of ['efsp-nla.js', 'strip-template.js', 'efsp-state.js', 'efsp-gestures.js',
    'annotation-editor.js', 'strip-drag.js', 'correlation-highlight.js', 'marsa-badge.js', 'bay-view.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }

  // Stand in for the pieces the Strip dispatches through.
  sandbox.getActingPositions = () => held;
  sandbox.sendEfspMutation = (actingPositionId, s, op) => { sent.push({ actingPositionId, op }); return 'mid'; };
  sandbox.sendEfspAirspaceMutation = (actingPositionId, airspaceId, rev, op) => { sent.push({ actingPositionId, airspaceId, op }); };
  sandbox.convertStripToArrival = (s) => { sent.push({ op: { kind: 'ConvertToArrival' } }); };
  sandbox.getActiveEfspSearchQuery = () => null;
  sandbox.sendEfspCorrelationMutation = (actingPositionId, fdrId, rev, op) => { sent.push({ actingPositionId, fdrId, op }); };
  sandbox.sendEfspMarsaMutation = (actingPositionId, marsaId, rev, op) => { sent.push({ actingPositionId, marsaId, op }); };
  sandbox.updateMap = () => {};
  const liveTracks = new Map(tracks.map(t => [String(t.id), t]));
  sandbox.window.getLatestTrack = (id) => liveTracks.get(String(id)) || null;
  sandbox.window.getAllTracks = () => [...liveTracks.values()];

  sandbox.applyEfspSnapshot({
    strips: [strip, ...otherStrips], fdrs: [fdr, ...otherStrips.map(s => ({ ...FDR, fdrId: s.fdrId, identity: { ...FDR.identity, callsign: s._callsign || s.fdrId } }))],
    positions: [], bays: [], airspaces, correlations, marsa,
  });
  const el = sandbox._buildStripEl(strip);
  // Fires what a real pointer press fires first: the document capture-phase
  // listeners, before the event would reach the element itself.
  const pointerDownOn = (target) => {
    for (const fn of docListeners.pointerdown || []) fn({ target, stopPropagation() {}, preventDefault() {} });
  };
  return { el, sent, sandbox, pointerDownOn };
}

const FDR = {
  fdrId: 'f1', rev: 1, provenance: {},
  identity: { callsign: 'VIPER1', beaconAssigned: '0001', trackDegradationFlag: 'NONE' },
  filed: {}, assigned: {}, tofi: { ifrActive: true }, airspace: {}, comms: {},
  // WP6, guide §6.4 (crc-sync's docs/adr/0052) — seeded the way createFdr
  // seeds it, not left off, so the Strip renders what a real one would.
  military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr: {} },
};

/** The rendered cell for one Block, by its data-block attribute. */
function blockCell(el, blockId) {
  return descendants(el).find(c => c.dataset && c.dataset.block === blockId);
}

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
  // Accepting an ENTRY now carries the separation regime (crc-sync's
  // docs/adr/0053) — the server refuses an accept without one, so a bare
  // button would render fine and fail on every click.
  const regime = descendants(mru.el).find(c => (c.className || '').includes('efsp-tofi-regime-select'));
  assert.ok(regime, 'no regime picker beside Accept — the accept would be refused');
  assert.deepEqual(regime.children.map(o => o.value), ['MARSA', 'ATC', 'USING_AGENCY', 'DUE_REGARD', 'SEE_AND_AVOID']);
  regime.value = 'USING_AGENCY';
  click(findByText(mru.el, 'Accept TOFI Entry'));
  assert.equal(mru.sent[0].op.action, 'ACCEPT');
  assert.equal(mru.sent[0].op.separationRegime, 'USING_AGENCY');
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

test('Convert to Arrival asks twice when it would clear annotations, and once when it would not', () => {
  const clean = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  click(findByText(clean.el, 'Convert to Arrival →'));
  assert.equal(clean.sent[0].op.kind, 'ConvertToArrival', 'nothing to lose, so no ceremony');

  const annotated = stripAt({
    ownerPositionId: 'CTR',
    annotations: { 24: { entries: [{ value: 'MIT 10', at: 1, by: 'APP' }] } },
  });
  const careful = renderStrip({ strip: annotated, fdr: FDR, held: ['CTR'] });
  const btn = findByText(careful.el, 'Convert to Arrival →');
  assert.match(btn.title, /archived and cleared/);
  click(btn);
  assert.deepEqual(careful.sent, [], 'the first press only warns');
  click(findByText(careful.el, 'Convert — press again'));
  assert.equal(careful.sent[0].op.kind, 'ConvertToArrival');
});

test('a return leg shows that it has a departure leg behind it', () => {
  const returned = stripAt({
    role: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'CTR', bayId: 'ctr-enroute',
    previousLeg: { role: 'DEPARTURE', annotations: { 24: { entries: [{ value: 'MIT 10', at: 1, by: 'APP' }] } }, convertedAt: 1, convertedBy: 'CTR' },
  });
  const { el } = renderStrip({ strip: returned, fdr: FDR, held: ['CTR'] });
  const badge = findByText(el, 'DEPARTURE ×1');
  assert.ok(badge, 'the archived leg is not surfaced anywhere');
  assert.match(badge.title, /24: MIT 10/);
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

// ── 4. correlation (WP5, guide §6.6 rule 5) ──────────────────────────────
//
// Read-only state, so `isBlockEditable` is false and the reachability half
// above cannot see it — which is exactly why it is a Strip-level badge rather
// than a Block, and why it gets its own dispatch test instead. No entry in
// DELIBERATELY_NOT_IN_COMPACT_VIEW is needed: no Block was added.

function correlationOf(over = {}) {
  return {
    fdrId: 'f1', rev: 2, state: 'CORRELATED', trackId: '101', matchedBy: 'BEACON',
    confidence: null, binding: null, warning: null, observedBeacon: '0041',
    transitions: [], ...over,
  };
}

test('a correlated Strip names its contact on its face', () => {
  const { el } = renderStrip({
    strip: stripAt(), fdr: FDR, held: ['APP'],
    correlations: [correlationOf()],
    tracks: [{ id: '101', callsign: 'VIPER1' }],
  });
  assert.ok(findByText(el, 'TRK VIPER1'), 'the badge must be on the Strip, not only in the record');
});

test('a Strip whose contact went away says so, and is marked', () => {
  const { el } = renderStrip({
    strip: stripAt(), fdr: FDR, held: ['APP'],
    correlations: [correlationOf({
      state: 'UNCORRELATED', trackId: null, matchedBy: null,
      warning: { kind: 'TRACK_IDENTITY_LOST', lostTrackId: '101' },
    })],
  });
  assert.ok(findByText(el, 'NO TRK'));
  assert.ok(el.classList.contains('efsp-strip-correlation-warned'),
    'a binding that broke has to be visible without reading the badge');
});

test('an ambiguous correlation offers its candidates, and picking one binds it', () => {
  // The server refuses to guess between two contacts that match equally well
  // (§3.10.2 rule 7 for codes), so the way out has to be reachable — this is
  // §6.6 rule 1's top rung becoming a control.
  const { el, sent } = renderStrip({
    strip: stripAt(), fdr: FDR, held: ['APP'],
    correlations: [correlationOf({
      state: 'UNCORRELATED', trackId: null, matchedBy: null,
      warning: { kind: 'AMBIGUOUS_BEACON', candidateTrackIds: ['101', '102'], detail: '2 contacts are squawking 0041 — bind one' },
    })],
    tracks: [{ id: '101', callsign: 'SOMEONE', squawk: 41, category: 1 }, { id: '102', callsign: 'SOMEONEELSE', squawk: 41, category: 1 }],
  });

  const badge = findByText(el, 'TRK ×2');
  assert.ok(badge, 'the ambiguity must be visible');
  click(badge);
  const choice = findByText(el, 'SOMEONEELSE · 0041');
  assert.ok(choice, 'both candidates must be offered, with enough to tell them apart');
  click(choice);

  assert.equal(sent[0].op.kind, 'BindTrack');
  assert.equal(sent[0].op.trackId, '102');
  assert.equal(sent[0].fdrId, 'f1');
});

test('an uncorrelated Strip offers Bind, and a bound one offers Unbind', () => {
  const uncorrelated = renderStrip({
    strip: stripAt(), fdr: FDR, held: ['APP'],
    correlations: [correlationOf({ state: 'UNCORRELATED', trackId: null, matchedBy: null })],
    tracks: [{ id: '303', callsign: 'MYSTERY', category: 1 }],
  });
  const bindBtn = findByText(uncorrelated.el, 'Bind…');
  assert.ok(bindBtn, 'an aircraft the controller can see but nothing matches needs a way in');
  click(bindBtn);
  click(findByText(uncorrelated.el, 'MYSTERY'));
  assert.equal(uncorrelated.sent[0].op.kind, 'BindTrack');
  assert.equal(uncorrelated.sent[0].op.trackId, '303');

  const bound = renderStrip({
    strip: stripAt(), fdr: FDR, held: ['APP'],
    correlations: [correlationOf({ matchedBy: 'BINDING', binding: { trackId: '101', boundPositionId: 'APP' } })],
    tracks: [{ id: '101', callsign: 'VIPER1' }],
  });
  click(findByText(bound.el, 'Unbind'));
  assert.equal(bound.sent[0].op.kind, 'UnbindTrack');
});

test('a controller holding no Position can see the correlation but not change it', () => {
  const { el } = renderStrip({
    strip: stripAt(), fdr: FDR, held: [],
    correlations: [correlationOf({ state: 'UNCORRELATED', trackId: null, matchedBy: null })],
  });
  assert.ok(findByText(el, 'NO TRK'), 'still legible');
  assert.equal(findByText(el, 'Bind…').disabled, true, 'but not actionable');
});


// ── 5. MARSA on the Strip (§9.2 rules 2 and 5, crc-sync's docs/adr/0051) ──
//
// The badge itself is a read-only indicator, and this file's own blind spot is
// that it holds only WRITABLE Blocks — so an indicator is invisible to the
// reachability half above. These tests are the other half: they render the
// real bay-view.js and assert the badge is there, the control is enabled when
// somebody can act, and the op that leaves is the right one.

function marsaRelation(over = {}) {
  return {
    marsaId: 'm-1', rev: 3, state: 'ACTIVE', declaringCallsign: 'SHELL71',
    participants: ['f1', 'f2'], startEvent: 'TANKER_ACCEPTED',
    endCondition: 'VERTICALLY_POSITIONED', startedAt: 1000, rendezvousAt: null,
    voidedBy: null, voidedDetail: null, endedAt: null, endedBy: null, transitions: [],
    ...over,
  };
}

const PEER_STRIP = { ...stripAt({}), stripId: 's2', fdrId: 'f2', _callsign: 'SHELL71' };

test('a MARSA participant Strip carries the badge, and it says the interlock is armed', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation()], otherStrips: [PEER_STRIP],
  });
  assert.ok(findByText(el, 'MARSA ⚠'), 'the armed badge is on the Strip');
  assert.ok(el.classList._set.has('efsp-strip-marsa-armed'));
});

test('a VOIDED relation flags the whole Strip — rule 2 calls it an alert', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation({ state: 'VOIDED', voidedBy: 'CONTROLLER_COURSE_CHANGE', endedAt: 2000 })],
    otherStrips: [PEER_STRIP],
  });
  assert.ok(findByText(el, 'MARSA ✕'));
  // Not just a chip among six: an alert that reads as one more chip is not one.
  assert.ok(el.classList._set.has('efsp-strip-marsa-voided'));
});

test('a flight in no relation is offered the declaration', () => {
  const { el } = renderStrip({ strip: stripAt({}), fdr: FDR, held: ['APP'], otherStrips: [PEER_STRIP] });
  assert.ok(findByText(el, 'MARSA…'), 'a controller can start a relation from a Strip that has never been in one');
});

test('declaring MARSA sends DeclareMarsa with both flights and the declaring callsign', () => {
  const { el, sent } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'], otherStrips: [PEER_STRIP],
  });
  click(findByText(el, 'MARSA…'));
  click(findByText(el, 'Declare'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.kind, 'DeclareMarsa');
  assert.deepEqual([...sent[0].op.participants].sort(), ['f1', 'f2']);
  assert.equal(sent[0].op.startEvent, 'TANKER_ACCEPTED');
  assert.equal(sent[0].op.endCondition, 'VERTICALLY_POSITIONED');
  assert.equal(sent[0].actingPositionId, 'APP');
});

test('an armed relation offers the rendezvous, and marking it sends MarkRendezvous', () => {
  const { el, sent } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation()], otherStrips: [PEER_STRIP],
  });
  click(findByText(el, 'MARSA ⚠'));
  click(findByText(el, 'Mark rendezvous'));
  assert.equal(sent[0].op.kind, 'MarkRendezvous');
  assert.equal(sent[0].marsaId, 'm-1');
});

test('ending and voiding are both reachable, and carry the relation id', () => {
  for (const [label, kind] of [['End MARSA', 'EndMarsa'], ['Void MARSA', 'VoidMarsa']]) {
    const { el, sent } = renderStrip({
      strip: stripAt({}), fdr: FDR, held: ['APP'],
      marsa: [marsaRelation({ rendezvousAt: 2000 })], otherStrips: [PEER_STRIP],
    });
    click(findByText(el, 'MARSA'));
    click(findByText(el, label));
    assert.equal(sent[0].op.kind, kind, label);
    assert.equal(sent[0].marsaId, 'm-1', label);
  }
});

test('a receiver breaking off sends RemoveParticipant naming ITS OWN flight', () => {
  const { el, sent } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation({ rendezvousAt: 2000 })], otherStrips: [PEER_STRIP],
  });
  click(findByText(el, 'MARSA'));
  click(findByText(el, 'Remove this flight'));
  assert.equal(sent[0].op.kind, 'RemoveParticipant');
  assert.equal(sent[0].op.fdrId, 'f1', 'the Strip you pressed it on is the one leaving');
});

test('the popover names the other participants — rule 5\'s "visible as a link"', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation()], otherStrips: [PEER_STRIP],
  });
  click(findByText(el, 'MARSA ⚠'));
  assert.ok(findByText(el, 'SHELL71'), 'the other participant is named, not just counted');
});

test('the badge is disabled when the controller holds no Position that can act', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: [],
    marsa: [marsaRelation()], otherStrips: [PEER_STRIP],
  });
  const badge = findByText(el, 'MARSA ⚠');
  assert.ok(badge, 'still rendered — the relation is a fact whoever is watching');
  assert.equal(badge.disabled, true, 'but not actionable');
});

test('an ENDED relation leaves no badge and offers a fresh declaration', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation({ state: 'ENDED', endedBy: 'END_CONDITION', endedAt: 4000 })],
    otherStrips: [PEER_STRIP],
  });
  assert.equal(findByText(el, 'MARSA ⚠'), undefined);
  assert.ok(findByText(el, 'MARSA…'), 'ready to declare a new one');
});

// ── the military extension namespace (crc-sync's docs/adr/0052) ───────────
//
// The server half is proved by efsp-scenario-military.test.mjs. This is the
// other half of the habit that keeps catching things: a green sortie says the
// server does the right thing and nothing about whether a controller can ask
// for it.

test('ordnance state is a picker on the Strip, and sends the Block the server routes', () => {
  const { el, sent } = renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] });

  const cell = blockCell(el, '3G');
  assert.ok(cell, 'Block 3G (ordnance state) is not rendered on the Strip at all');
  click(cell);

  const select = descendants(el).find(c => c.tagName === 'select');
  assert.ok(select, '3G opened no picker — free text would let a controller type an invalid state');
  assert.deepEqual(select.children.map(o => o.value), ['', 'CLEAN', 'LOADED', 'HUNG', 'EXPENDED']);

  select.value = 'HUNG';
  for (const fn of select._listeners.change || []) fn({ stopPropagation() {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.kind, 'SetBlock');
  assert.equal(sent[0].op.blockId, '3G');
  assert.equal(sent[0].op.value, 'HUNG');
});

test('the hook requirement toggles, and a blank cell sends true rather than clearing', () => {
  const { el, sent } = renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] });

  const cell = blockCell(el, '3F');
  assert.ok(cell, 'Block 3F (hook requirement) is not rendered on the Strip at all');
  assert.equal(cell.textContent, '', 'hookRequired:false renders blank, like every other boolean Block');
  click(cell);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.kind, 'SetBlock');
  assert.equal(sent[0].op.blockId, '3F');
  assert.equal(sent[0].op.value, true, 'a blank hook cell must SET the requirement, not clear it');
});

test('an FDR from before the military namespace existed still renders its Strip', () => {
  // Nothing reseeds an FDR already in a connected client's cache, so a Strip
  // can legitimately arrive with `military: null` — the literal value this
  // field held until docs/adr/0052. Rendering must degrade to a blank cell,
  // not throw and take the whole Bay down with it.
  const legacy = { ...FDR, military: null };
  const { el } = renderStrip({ strip: stripAt(), fdr: legacy, held: ['APP'] });
  assert.equal(blockCell(el, '3G').textContent, '');
  assert.equal(blockCell(el, '3F').textContent, '');
});

// ── popovers must not dismiss on their own controls ──────────────────────
//
// Found by hand in the running app: the MARSA menu closed the instant you
// pressed any of its selects. The cause was one missing target test in a
// document-level CAPTURE-phase pointerdown listener — so the popover was torn
// out between pointerdown and pointerup and its buttons never saw a click.
//
// Invisible to every other test here, because those call click handlers
// directly and a real pointer press fires pointerdown first. These tests fire
// it the way a browser does.

// The dismiss listener is registered in a deferred setTimeout(…, 0) — so every
// one of these has to let a real tick elapse first, or nothing is listening
// and the "still open" half passes for the wrong reason.
const tick = () => new Promise(r => setTimeout(r, 0));

test('the MARSA popover survives a press on its own controls, and closes on one outside', async () => {
  const { el, pointerDownOn } = renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] });
  click(findByText(el, 'MARSA…'));

  const popover = descendants(el).find(c => (c.className || '').includes('efsp-marsa-popover'));
  assert.ok(popover, 'no MARSA popover opened');
  await tick();

  // The stub's removeChild drops the node from its parent's children but
  // leaves `parentNode` set, so attachment is tested by membership.
  const attached = () => descendants(el).includes(popover);

  const inner = descendants(popover)[0];
  assert.ok(inner, 'the popover rendered no controls to press');
  assert.ok(attached(), 'precondition: the popover is open before anything is pressed');
  pointerDownOn(inner);
  assert.ok(attached(), 'pressing a control inside the popover closed it');

  pointerDownOn(el);
  assert.equal(attached(), false, 'a press outside the popover must still dismiss it');
});

test('the bind and airspace popovers behave the same way', async () => {
  // Both had the identical defect and both carry a picker plus a submit
  // button, so both were unusable by pointer while their dot-command and
  // server paths were fine.
  const uncorrelated = stripAt({ correlation: { state: 'UNCORRELATED' } });
  const bind = renderStrip({
    strip: uncorrelated, fdr: FDR, held: ['APP'],
    tracks: [{ id: 't1', callsign: 'VIPER1', lat: 37, lon: 35 }],
  });
  const bindBtn = descendants(bind.el).find(c => (c.className || '').includes('efsp-bind-btn'));
  if (bindBtn) {
    click(bindBtn);
    await tick();
    const popover = descendants(bind.el).find(c => (c.className || '').includes('popover'));
    if (popover) {
      const inner = descendants(popover)[0];
      if (inner) {
        bind.pointerDownOn(inner);
        assert.ok(descendants(bind.el).includes(popover), 'the bind picker closed on its own candidate row');
      }
    }
  }

  const air = renderStrip({
    strip: stripAt({ ownerPositionId: 'APP' }), fdr: FDR, held: ['APP'],
    airspaces: [{ airspaceId: 'MOA1', name: 'North MOA', state: 'ACTIVE', workingFrequencyMhz: 251.0 }],
  });
  const airBtn = descendants(air.el).find(c => (c.textContent || '').includes('Airspace'));
  if (airBtn) {
    click(airBtn);
    await tick();
    const popover = descendants(air.el).find(c => (c.className || '').includes('popover'));
    if (popover) {
      const inner = descendants(popover)[0];
      if (inner) {
        air.pointerDownOn(inner);
        assert.ok(descendants(air.el).includes(popover), 'the airspace popover closed on its own picker');
      }
    }
  }
});

// ── ops, not just Blocks ─────────────────────────────────────────────────
//
// The reachability half above holds every writable BLOCK to being reachable.
// It says nothing about OPS, and that is how DropStrip stayed affordance-less:
// server-side it has never been state-gated and OPS has always held the
// permission, but the only way to ask was the `.drop` dot-command. The NLA
// button reads "Send to Clearance" at PROPOSED — "Drop" is every Role's
// TERMINAL transition and appears nowhere else.

test('a Strip proposed in error can be dropped from the Strip itself, in two presses', () => {
  const strip = stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS', bayId: 'ops-proposed' });
  const { el, sent } = renderStrip({ strip, fdr: FDR, held: ['OPS'] });

  const drop = descendants(el).find(c => (c.className || '').includes('efsp-drop-btn'));
  assert.ok(drop, 'no Drop affordance on a PROPOSED Strip — OPS would have to know `.drop` exists');

  // First press arms rather than drops: this is the one Strip action with no
  // Undo outside the terminal NLA's 30s window.
  click(drop);
  assert.deepEqual(sent, [], 'the first press must not drop anything');

  // It arms in place, so the label says what the next press does.
  assert.equal(drop.textContent, 'Drop?', 'the armed label must say what the next press does');
  assert.ok(drop.classList.contains('efsp-drop-btn-armed'));

  click(drop);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.kind, 'DropStrip');
  assert.equal(sent[0].actingPositionId, 'OPS');
});

test('Drop is not offered where the server would refuse it, or where the NLA already says Drop', () => {
  const hasDrop = (strip, held) =>
    !!descendants(renderStrip({ strip, fdr: FDR, held }).el).find(c => (c.className || '').includes('efsp-drop-btn'));

  // The terminal state's own NLA is "Drop" — one question, one control.
  assert.equal(hasDrop(stripAt({ state: 'HANDED_OFF', ownerPositionId: 'APP' }), ['APP']), false);

  // An open coordination proposal: _applyDropStrip refuses these outright, so
  // offering the control would be offering a button that always fails.
  assert.equal(hasDrop(stripAt({
    state: 'INBOUND', ownerPositionId: 'CTR',
    coordination: { primitive: 'HANDOFF', state: 'PROPOSED', peerFacilityId: 'INCIRLIK', peerPositionId: 'APP' },
  }), ['CTR']), false);

  // And a live TOFI — guide §4.6.3 rule 2, the Strip stays posted throughout
  // tactical control.
  assert.equal(hasDrop(stripAt({
    state: 'INBOUND', ownerPositionId: 'CTR',
    tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE', peerFacilityId: 'TACTICAL', peerPositionId: 'TAC_C2' },
  }), ['CTR']), false);

  // Nobody holding the Position means no control at all, not a disabled one —
  // a Strip nobody holds should not grow an affordance.
  assert.equal(hasDrop(stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' }), []), false);
});

// ── §3.7 on the Strip itself ─────────────────────────────────────────────
//
// Rule 2 wants the superseded value "in the same Block", not one click away:
// the server has kept, persisted and broadcast every entry since Phase 1 and
// resolveBlockValue threw all but the ACTIVE one away before it reached the
// DOM. These assert the chip, which is where the rule points.

function cellWithHistory(entries) {
  return stripAt({
    state: 'PROPOSED', ownerPositionId: 'OPS', bayId: 'ops-proposed',
    annotations: { 21: { blockId: '21', entries } },
  });
}
const entry = (value, status) => ({ value, status, at: Date.now(), by: 'c-OPS' });
const historyIn = (el) => descendants(el).filter(c => (c.className || '').includes('efsp-annotation-entry'));

test('a Block written once shows no history at all', () => {
  // The common case by far. It must not sprout an empty container on every
  // unamended Block of every Strip.
  const { el } = renderStrip({ strip: cellWithHistory([entry('6000', 'ACTIVE')]), fdr: FDR, held: ['OPS'] });
  assert.deepEqual(historyIn(el), []);
  assert.equal(descendants(el).filter(c => (c.className || '').includes('efsp-annotation-history')).length, 0);
});

test('an amended Block shows the prior value struck through, on the Strip', () => {
  const { el } = renderStrip({
    strip: cellWithHistory([entry('4000', 'SUPERSEDED'), entry('6000', 'ACTIVE')]),
    fdr: FDR, held: ['OPS'],
  });
  const prior = historyIn(el);
  assert.equal(prior.length, 1);
  assert.equal(prior[0].textContent, '4000');
  assert.ok(prior[0].className.includes('efsp-annotation-entry-superseded'));
  // And the current value is still the cell's own.
  assert.equal(blockCell(el, '21').textContent, '6000');
});

test('a struck entry renders as struck, not as superseded', () => {
  const { el } = renderStrip({
    strip: cellWithHistory([entry('4000', 'STRUCK'), entry('6000', 'ACTIVE')]),
    fdr: FDR, held: ['OPS'],
  });
  assert.ok(historyIn(el)[0].className.includes('efsp-annotation-entry-struck'));
});

test('a much-amended Block caps at two priors and offers the overflow indicator', () => {
  // §3.7 rule 2's own escape hatch — "where space does not permit, the Block
  // MUST render an overflow indicator and expose full history on tap",
  // modelled on ATOP's `*`. History is append-only for the life of the Strip,
  // so without this a long sortie grows a chip without limit.
  const strip = cellWithHistory([
    entry('2000', 'SUPERSEDED'), entry('3000', 'SUPERSEDED'),
    entry('4000', 'SUPERSEDED'), entry('5000', 'SUPERSEDED'), entry('6000', 'ACTIVE'),
  ]);
  const { el } = renderStrip({ strip, fdr: FDR, held: ['OPS'] });

  const shown = historyIn(el).map(c => c.textContent);
  assert.deepEqual(shown, ['4000', '5000'], 'the two most recent priors, oldest of those first');

  const overflow = descendants(el).find(c => (c.className || '').includes('efsp-annotation-overflow'));
  assert.ok(overflow, 'no overflow indicator');
  assert.equal(overflow.textContent, '*');
  assert.match(overflow.title, /2 earlier entries/);
});

test('the expanded view shows the whole chain, which is what makes capping the chip legal', () => {
  const strip = cellWithHistory([
    entry('2000', 'SUPERSEDED'), entry('3000', 'SUPERSEDED'),
    entry('4000', 'SUPERSEDED'), entry('5000', 'SUPERSEDED'), entry('6000', 'ACTIVE'),
  ]);
  const r = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  r.sandbox.renderAllOpenEfspBays = () => {};
  click(descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn')));

  const expanded = r.sandbox._buildStripEl(strip);
  const row = descendants(expanded).find(c => c.dataset && c.dataset.expandedBlock === '21');
  assert.ok(row);
  assert.deepEqual(descendants(row).filter(c => (c.className || '').includes('efsp-annotation-entry')).map(c => c.textContent),
    ['2000', '3000', '4000', '5000'], 'unbounded here');
});

test('confirm-vacated is reachable on DEPARTURE 21, and strikes rather than clears', () => {
  // §3.7 rule 3's explicit action. The button has existed since Phase 2 and no
  // test has ever exercised it — stripAt() always set `annotations: {}`, and
  // Block 21 had no chip to render it on.
  const strip = cellWithHistory([entry('6000', 'ACTIVE')]);
  const { el, sent } = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  const strike = descendants(el).find(c => (c.className || '').includes('efsp-confirm-vacated-btn'));
  assert.ok(strike, 'no confirm-vacated button on an ACTIVE altitude');
  click(strike);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.blockId, '21');
  assert.equal(sent[0].op.confirmVacated, true);
  assert.equal(sent[0].op.value, undefined, 'it marks the entry struck, it never amends');
});

// ── interactive state survives a remote re-render ────────────────────────

test('every popover protects its Strip from reconciliation', () => {
  // Enumerates the CLASS, not the instances. The bind and MARSA popovers were
  // both missing from _isProtectedStripEl — the third time that list was found
  // incomplete after the same bug, so a seventh popover must fail here rather
  // than be discovered by a controller losing a half-filled form to somebody
  // else's board delta.
  const cases = [
    ['Coordinate…', stripAt(), ['APP']],
    ['TOFI…', stripAt({ ownerPositionId: 'CTR' }), ['CTR']],
    ['MARSA…', stripAt(), ['APP']],
  ];
  for (const [label, strip, held] of cases) {
    const r = renderStrip({ strip, fdr: FDR, held, otherStrips: [stripAt({ stripId: 's9', fdrId: 'f9' })] });
    const btn = findByText(r.el, label);
    assert.ok(btn, `${label} not rendered`);
    click(btn);
    assert.equal(r.sandbox._isProtectedStripEl(r.el), true,
      `${label} is open but its Strip is not protected — a remote delta would destroy it mid-interaction`);
  }
});

test('an open Block edit protects its Strip too', () => {
  const { el, sandbox } = renderStrip({ strip: stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'] });
  assert.equal(sandbox._isProtectedStripEl(el), false, 'nothing open yet');
  click(blockCell(el, '9'));
  assert.equal(sandbox._isProtectedStripEl(el), true);
});
