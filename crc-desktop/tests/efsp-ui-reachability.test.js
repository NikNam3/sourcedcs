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
function compactBlocksFor(role, positionId) {
  return clientSandbox().compactBlocksFor(role, positionId);
}

// Every (Role, owning Position) pair the field lists distinguish, plus one
// Position no list names, so the per-Role fallback is held to the same rule.
// strip-fields.js is a plain module; reading it directly is the source of truth.
const { COMPACT_BLOCKS_BY_POSITION } = require('../app/public/js/panels/efsp/strip-fields.js');
function positionsFor(role) {
  if (role === 'MISSION') return ['TAC_C2'];
  return [...Object.keys(COMPACT_BLOCKS_BY_POSITION[role] || {}), 'NOLIST'];
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
function expandedBlocksFor(role, positionId = 'OPS') {
  const strip = stripAt({ role, state: role === 'MISSION' ? 'TASKED' : 'PROPOSED', ownerPositionId: positionId });
  const r = renderStrip({ strip, fdr: FDR, held: [positionId] });
  // The toggle re-renders every open Bay, which needs a real DOM; the state
  // it sets is what matters, so the rebuild is stubbed and done by hand below.
  r.sandbox.renderAllOpenEfspBays = () => {};
  const toggle = descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn'));
  assert.ok(toggle, `${role}: no expand toggle on the Strip`);
  click(toggle);
  const expandedEl = r.sandbox._buildStripEl(strip);
  return descendants(expandedEl).filter(c => c.dataset && c.dataset.expandedBlock).map(c => c.dataset.expandedBlock);
}

// Per (Role, Position) now that the field lists are per Position: trimming a
// Position's fields is only legal because the expanded view picks up the rest.
for (const role of Object.keys(BLOCK_MAPS)) {
  test(`every writable ${role} Block is somewhere a controller can reach`, () => {
    for (const positionId of positionsFor(role)) {
      const compact = compactBlocksFor(role, positionId);
      const expanded = expandedBlocksFor(role, positionId);
      const unreachable = Object.keys(BLOCK_MAPS[role]).filter((blockId) => {
        const writable = isBlockEditable(blockId, role) || enumSelectOptionsFor(blockId) || isBooleanToggleBlock(blockId);
        if (!writable) return false;
        return !compact.includes(blockId) && !expanded.includes(blockId);
      });
      assert.deepEqual(unreachable, [], `${role} at ${positionId}: writable but nowhere a controller can reach`);
    }
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
    for (const positionId of positionsFor(role)) {
      const compact = compactBlocksFor(role, positionId);
      const expanded = expandedBlocksFor(role, positionId);
      const expected = Object.keys(BLOCK_MAPS[role]).filter(id => !compact.includes(id));
      assert.deepEqual(expanded, expected, `${role} at ${positionId}`);
      assert.equal(expanded.some(id => compact.includes(id)), false, `${role} at ${positionId}: duplicates a field`);
    }
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
  assert.ok(compactBlocksFor('DEPARTURE', 'OPS').includes('21') === false, 'precondition: OPS has no INIT ALT field');
  assert.ok(compactBlocksFor('DEPARTURE', 'CD').includes('21'), 'precondition: CD does');
  strip.ownerPositionId = 'CD';

  const r = renderStrip({ strip, fdr: FDR, held: ['CD'] });
  r.sandbox.renderAllOpenEfspBays = () => {};
  click(descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn')));
  const expandedEl = r.sandbox._buildStripEl(strip);
  const ids = descendants(expandedEl).filter(c => c.dataset && c.dataset.expandedBlock).map(c => c.dataset.expandedBlock);
  assert.ok(ids.includes('21'), 'a truncated field must still be reachable in full');
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
  const wanted = stripAt({ stripId: 's1' });
  const { sandbox, el } = renderStrip({ strip: wanted, fdr: FDR, held: ['APP'] });
  const needsRebuild = sandbox._stripElNeedsRebuild;

  assert.equal(el.dataset.expanded, '0', 'the element records what it was built as');
  assert.equal(needsRebuild(el, wanted, null, null), false, 'nothing changed');
  assert.equal(needsRebuild(el, wanted, null, 's1'), true, 'now expanded — must rebuild');
  assert.equal(needsRebuild(el, wanted, 's1', null), true, 'now selected — must rebuild');
  assert.equal(needsRebuild(el, { ...wanted, rev: wanted.rev + 1 }, null, null), true, 'rev moved — must rebuild');
});

test('a Strip rebuilds when something it RENDERS but does not own changes', () => {
  // F-305. `rev` is the Strip's own concurrency counter and moves only when a
  // Mutation changes that Strip; _buildStripEl reads a great deal that lives
  // elsewhere and moves independently. Six surfaces were measured stale across
  // three lanes — a stuck TOFI exit gate, a missing +N, an OVERDUE obligation
  // that never appeared, a MARSA badge and participant highlight, and a
  // correlation badge whose absence took the Bind… button with it.
  //
  // Asserted against the RULE (_stripElNeedsRebuild), not against a rebuilt
  // element, for the same reason the expansion test above is: a test that only
  // checks the stamp passes whether or not the reconciler ever reads it.
  const strip = stripAt({ stripId: 's1', state: 'DEPARTED', ownerPositionId: 'TWR' });
  const { sandbox, el } = renderStrip({ strip, fdr: FDR, held: ['TWR'] });
  const needsRebuild = sandbox._stripElNeedsRebuild;
  const unchanged = () => assert.equal(needsRebuild(el, strip, null, null), false, 'precondition: nothing changed yet');

  unchanged();

  // strip.nla moves with Position occupancy and with the clock, and crc-sync
  // deliberately does NOT bump rev to say so (bumping it outside a Mutation
  // would invalidate every controller's in-flight edit).
  assert.equal(
    needsRebuild(el, { ...strip, nla: { inhibited: 'no receiving Position present', reason: 'NLA_INHIBITED' } }, null, null),
    true, 'the NLA became inhibited and the panel would never have redrawn');

  // A sibling Strip appearing — a mission line fragged against this flight.
  sandbox.applyEfspDelta({
    strips: { updated: [{ ...strip, stripId: 's2', role: 'MISSION', ownerPositionId: 'TAC_C2', facilityId: 'TACTICAL' }] },
  });
  assert.equal(needsRebuild(el, strip, null, null), true, '+1 would never have appeared');
  sandbox.applyEfspDelta({ strips: { updated: [{ ...strip, stripId: 's2', state: 'DROPPED' }] } });
  unchanged();

  // An obligation alert, which lands in its own store and touches no Strip.
  sandbox.applyEfspAlerts({ conformance: [], stca: [], obligations: [{ facilityId: 'INCIRLIK', stripId: 's1', obligationType: 'VOID_TIME_EXPIRED', severity: 'OVERDUE', dueAt: 1, since: 1 }] });
  assert.equal(needsRebuild(el, strip, null, null), true, 'an alarm nobody is shown is not an alarm');
  sandbox.applyEfspAlerts({ conformance: [], stca: [], obligations: [] });
  unchanged();

  // The FDR behind the Strip — every Block value, and the separation regime
  // the TOFI exit gate reads.
  sandbox.applyEfspDelta({ fdrs: { updated: [{ ...FDR, rev: 2, tofi: { ifrActive: true, separationRegime: 'ATC' } }] } });
  assert.equal(needsRebuild(el, strip, null, null), true, 'the FDR moved under the Strip');
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

test('the Blocks the release and airspace sorties depend on are on the Strips of the Positions that work them', () => {
  // Each of these gates a scenario: the release state and void time drive
  // §3.8's holds at the airfield, and 22 is the frequency a flight is approved
  // onto by APP or CTR, who also own the TOFI fields.
  const want = {
    CD: ['14A', '14D'], GND: ['14A', '14D'],
    APP: ['22', 'SREG', '5A'], CTR: ['22', '24A', 'SREG', 'IFR', 'RSVC', '5A'],
  };
  for (const [positionId, blocks] of Object.entries(want)) {
    const compact = compactBlocksFor('DEPARTURE', positionId);
    for (const blockId of blocks) assert.ok(compact.includes(blockId), `Block ${blockId} is not on ${positionId}'s Strip`);
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

// Which stub element has "focus". The stub used to drop focus() on the floor,
// which made a whole rule untestable: an open Block edit protects its Strip
// from reconciliation only WHILE the controller is in it (bay-view.js's
// _isProtectedStripEl — leaving that unconditional is what froze a Strip
// somebody clicked away from, lane 2's F-204). Reset per renderStrip().
let _activeElement = null;

/** Move the stub's focus, the way clicking elsewhere or pressing Tab would. */
function focusStub(el) { _activeElement = el; }

/**
 * The shared DOM stub (tests/helpers/dom-stub.js, docs/adr/0054), plus the one
 * behaviour this harness needs that the shared one leaves out: focus() moves
 * _activeElement, which document.activeElement below reports. Without it the
 * _isProtectedStripEl tests further down cannot tell a focused edit from an
 * abandoned one.
 */
const domStub = require('./helpers/dom-stub.js');
function makeElement(tag) {
  const el = domStub.makeElement(tag);
  el.focus = () => { _activeElement = el; };
  return el;
}

/** Every descendant, flattened — the rendered Strip is a small tree. */
function descendants(el) { return domStub.descendants(el); }

// Where a popover goes. F-001 portals all six out of the Strip to
// document.body, because `.efsp-strip`'s `contain: layout` creates a stacking
// context and turns everything that overflows a Strip into ink overflow — a
// popover inside one is painted underneath the panel and is unreachable by
// scrolling. Set per renderStrip(), since each render builds its own sandbox.
let _portalRoot = null;

/**
 * Everything the controller can see and press for this Strip: the Strip, plus
 * whatever popover is open. Asserting on descendants(el) alone would say a
 * portalled popover does not exist.
 */
function visible(el) {
  return [...descendants(el), ...(_portalRoot ? descendants(_portalRoot) : [])];
}

function findByText(el, text) {
  return visible(el).find(c => c.textContent === text);
}

function click(el) {
  assert.ok(el, 'no such control on the Strip');
  assert.equal(el.disabled, false, `"${el.textContent}" is present but disabled`);
  for (const fn of el._listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
}

/**
 * The ⋯ menu item reading `text`, opening the menu first if it is not open.
 * Layout C (docs/adr/0056) moved everything a controller STARTS — Coordinate,
 * TOFI, Airspace, MARSA, Bind, Convert, Offset — off the Strip's face and into
 * that menu, which is portalled like every popover. Undefined when the Strip
 * has no menu at all, or the menu has no such item.
 */
function menuItem(el, text) {
  const isItem = (c) => c.textContent === text && (c.className || '').includes('efsp-strip-menu-item');
  const open = visible(el).find(isItem);
  if (open) return open;
  const more = descendants(el).find(c => (c.className || '').includes('efsp-strip-menu-btn'));
  if (!more) return undefined;
  click(more);
  return visible(el).find(isItem);
}

// The same move crc-sync's clearance-migration.js makes: the assigned altitude
// and heading used to be Strip annotations, and are the flight's now.
const _CLEARANCE_BLOCKS = {
  DEPARTURE: { '21': 'altitude', '20': 'heading' },
  ARRIVAL: { '7': 'altitude', '9A-VECTOR': 'heading' },
  OVERFLIGHT: { '7A': 'altitude', '9A-VECTOR': 'heading' },
};
function _clearanceFromAnnotations(strip, fdr) {
  const blocks = _CLEARANCE_BLOCKS[strip.role];
  if (!blocks || !strip.annotations) return { strip, fdr };
  const annotations = { ...strip.annotations };
  const clearance = { altitude: { entries: [] }, heading: { entries: [] }, ...(fdr.clearance || {}) };
  for (const [blockId, field] of Object.entries(blocks)) {
    if (!annotations[blockId]) continue;
    clearance[field] = { entries: annotations[blockId].entries };
    delete annotations[blockId];
  }
  return { strip: { ...strip, annotations }, fdr: { ...fdr, clearance } };
}

/**
 * Loads the real client modules into one sandbox and renders a Strip,
 * capturing whatever it would have sent. Returns the rendered element and the
 * captured dispatches.
 */
function renderStrip({ strip, fdr, held, airspaces = [], correlations = [], tracks = [], marsa = [], otherStrips = [], refusal = null }) {
  const sent = [];
  const docListeners = {};
  const winListeners = {};
  _activeElement = null; // every render starts with nothing focused
  const sandbox = {
    console, module: { exports: {} }, setTimeout, clearTimeout, Date, JSON, Math, Number, Set, Map,
    Array, Object, String, Boolean, isNaN, parseInt, parseFloat, crypto: { randomUUID: () => 'test-id' }, AbortController,
    // Document-level listeners are RECORDED, not dropped. The dismiss-on-
    // outside-click popovers register here in the capture phase, and a stub
    // that swallowed them made a whole class of bug — a popover that closes on
    // its own controls — structurally invisible to every test in this file.
    document: {
      getElementById: () => null, createElement: makeElement, body: makeElement('body'),
      get activeElement() { return _activeElement; },
      addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
      removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter(f => f !== fn); },
    },
    // The viewport a portalled popover is placed against, and the scroll/resize
    // listeners it keeps itself in place with. The numbers are a viewport, not
    // a layout: this stub reports the same 10x10 rect for every element, so
    // nothing here can say where a popover ENDED UP — that is what the
    // Playwright specs are for. What these prove is the wiring: portalled,
    // owned by a Strip, and taken down again.
    window: {
      prompt: () => 'a note', getSelection: () => ({ removeAllRanges() {} }),
      innerWidth: 1600, innerHeight: 1000,
      addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
      removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter(f => f !== fn); },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Every name a contact is shown with comes from track-label.js (crc-sync's docs/adr/0059).
  vm.runInContext(fs.readFileSync(path.join(CLIENT, '../../track-label.js'), 'utf8'), sandbox, { filename: 'track-label.js' });
  // time-chains.js and efsp-stereo-routes.js as index.html loads them: the
  // Strip's time Blocks and Block 9F's picker read them (docs/adr/0073).
  for (const file of ['efsp-nla.js', 'time-chains.js', 'efsp-stereo-routes.js', 'strip-template.js', 'efsp-state.js', 'efsp-arrivals.js', 'efsp-gestures.js',
    'annotation-editor.js', 'strip-drag.js', 'correlation-highlight.js', 'marsa-badge.js', 'strip-fields.js', 'bay-view.js', 'strip-view.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }

  // Stand in for the pieces the Strip dispatches through.
  sandbox.getActingPositions = () => held;
  // `strip` is recorded as well as the op: it carries the `rev` that
  // sendEfspMutation sends as the optimistic-concurrency base, which is the
  // whole of F-107.
  sandbox.sendEfspMutation = (actingPositionId, s, op) => { sent.push({ actingPositionId, strip: s, op }); return 'mid'; };
  sandbox.sendEfspAirspaceMutation = (actingPositionId, airspaceId, rev, op) => { sent.push({ actingPositionId, airspaceId, op }); };
  sandbox.convertStripToArrival = (s) => { sent.push({ op: { kind: 'ConvertToArrival' } }); };
  sandbox.getActiveEfspSearchQuery = () => null;
  sandbox.sendEfspCorrelationMutation = (actingPositionId, fdrId, rev, op) => { sent.push({ actingPositionId, fdrId, op }); };
  sandbox.sendEfspMarsaMutation = (actingPositionId, marsaId, rev, op) => { sent.push({ actingPositionId, marsaId, op }); };
  sandbox.updateMap = () => {};
  // The real one walks the open Bays and needs requestAnimationFrame and a
  // document that has Bays in it. Stubbed by default rather than in each test
  // that happens to trigger a render — closing a popover now asks for one
  // (F-108), so that is most of them. Tests that care about the render count
  // replace this with their own counter.
  sandbox.renderAllOpenEfspBays = () => {};
  // efsp-panel.js's accessor, stubbed the same way the senders are. bay-view.js
  // only ever READS it — the panel populates it before the render that follows
  // a refusal and nulls it before the render that follows a dismissal.
  sandbox.getCurrentEfspRefusal = () => refusal;
  const liveTracks = new Map(tracks.map(t => [String(t.id), t]));
  sandbox.window.getLatestTrack = (id) => liveTracks.get(String(id)) || null;
  sandbox.window.getAllTracks = () => [...liveTracks.values()];

  // Fixtures written before docs/adr/0058 put the assigned altitude/heading
  // history on the Strip; crc-sync moves such notes onto the flight on
  // restore (clearance-migration.js), and the harness does the same.
  ({ strip, fdr } = _clearanceFromAnnotations(strip, fdr));
  sandbox.applyEfspSnapshot({
    strips: [strip, ...otherStrips], fdrs: [fdr, ...otherStrips.map(s => ({ ...FDR, fdrId: s.fdrId, identity: { ...FDR.identity, callsign: s._callsign || s.fdrId } }))],
    positions: [], bays: [], airspaces, correlations, marsa,
  });
  _portalRoot = sandbox.document.body;
  const el = sandbox._buildStripEl(strip);
  // Fires what a real pointer press fires first: the document capture-phase
  // listeners, before the event would reach the element itself.
  const pointerDownOn = (target) => {
    for (const fn of docListeners.pointerdown || []) fn({ target, stopPropagation() {}, preventDefault() {} });
  };
  // Same shape for the key a controller presses to back out (F-109) — the
  // popover's Escape listener is on `document` in the capture phase, because
  // focus may be on the opener <button>, on a field inside the popover, or
  // nowhere at all, and it must reach the popover from all three.
  const keyDownOnDocument = (key) => {
    const seen = { defaultPrevented: false, propagationStopped: false };
    for (const fn of docListeners.keydown || []) {
      fn({ key, preventDefault() { seen.defaultPrevented = true; }, stopPropagation() { seen.propagationStopped = true; } });
    }
    return seen;
  };
  const portal = sandbox.document.body;
  return { el, sent, sandbox, pointerDownOn, keyDownOnDocument, portal, winListeners };
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
  click(menuItem(el, 'Coordinate…'));

  const select = visible(el).find(c => c.tagName === 'select');
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
    coordination: { primitive: 'OPERATIONAL_REQUEST', state: 'PROPOSED', mintedForCoordination: true, peerFacilityId: 'INCIRLIK', peerPositionId: 'APP' },
  });
  // A render each, because ACCEPT and REJECT now go through F-101's
  // board-wide double-tap window (bay-view.js's _swallowRepeatAdvance) and
  // three synchronous clicks are exactly what that window exists to discard.
  // Three renders is also the honest shape: these are three different answers
  // to one proposal, only one of which is ever actually given.
  const approve = renderStrip({ strip: replica, fdr: FDR, held: ['CTR'] });
  // An operational request is answered in the words a controller uses —
  // approve / unable / stand by (§4.6) — not generic accept/reject.
  click(findByText(approve.el, 'Approve'));
  assert.equal(approve.sent[0].op.action, 'ACCEPT');

  // An operational request's refusal is "Unable", not "Reject" — the word a
  // controller actually says.
  const unable = renderStrip({ strip: replica, fdr: FDR, held: ['CTR'] });
  click(findByText(unable.el, 'Unable'));
  assert.equal(unable.sent[0].op.action, 'REJECT');

  // Stand by is OPERATIONAL_REQUEST's alone — the sortie relies on it. It is
  // deliberately OUTSIDE the double-tap window: it moves nothing and takes no
  // control off the Strip, so it is not in F-101's class.
  const standBy = renderStrip({ strip: replica, fdr: FDR, held: ['CTR'] });
  click(findByText(standBy.el, 'Stand By'));
  assert.equal(standBy.sent[0].op.action, 'STAND_BY');
});

test('a controller can open tactical control, and the MRU side can accept it', () => {
  const ctr = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  click(menuItem(ctr.el, 'TOFI…'));
  const picker = visible(ctr.el).find(c => c.tagName === 'select');
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
  // One sentence for the precondition, shared with the badge (F-307). It names
  // the CURRENT regime as well as the required one — "SEP REG is MARSA" is
  // what tells the reader which Block to go and look at.
  assert.match(accept.title, /SEP REG is MARSA — CTR must set it back to ATC/);

  // And the proposer, who is the only one who can clear it, is told too — on
  // the badge, which renders on both sides. Before F-307 the reason existed
  // only in the `title` above, on the side that could do nothing about it.
  const ctrSide = stripAt({
    ownerPositionId: 'CTR', role: 'ARRIVAL', state: 'INBOUND',
    tofiCoordination: { direction: 'EXIT', state: 'PROPOSED', peerFacilityId: 'TACTICAL', peerPositionId: 'TAC_C2' },
  });
  const proposer = renderStrip({ strip: ctrSide, fdr: notYet, held: ['CTR'] });
  const badge = descendants(proposer.el).find(c => (c.className || '').includes('efsp-tofi-badge'));
  assert.match(badge.title, /SEP REG is MARSA — set it back to ATC before TAC_C2 can accept/);
  const rendered = descendants(proposer.el).find(c => (c.className || '').includes('efsp-coordination-blocked-reason'));
  assert.ok(rendered, 'a reason that lives only in a hover title has no touch equivalent');
  assert.match(rendered.textContent, /SEP REG is MARSA/);

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

  click(menuItem(el, 'Airspace…'));
  const picker = visible(el).find(c => c.tagName === 'select');
  assert.match(picker.children[0].textContent, /East MOA — ACTIVE/, 'the state is visible before committing');
  click(findByText(el, 'Approve entry'));
  assert.equal(sent[0].op.kind, 'ApproveAirspaceEntry');
  assert.equal(sent[0].op.airspaceId, 'MOA-EAST');

  const inside = stripAt({ ownerPositionId: 'CTR', airspaceEntry: { airspaceId: 'MOA-EAST', frequencyMhz: 134.25, altitudeBlock: null } });
  const out = renderStrip({ strip: inside, fdr: FDR, held: ['CTR'], airspaces });
  assert.ok(findByText(out.el, 'East MOA 134.250'), 'the Strip names where the flight is working');
  click(menuItem(out.el, 'Leave airspace'));
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
  // The inhibit is the SERVER's answer now (F-408's `strip.nla`), not a rule
  // this file keeps a second copy of — board-store.js's nlaStatusFor puts this
  // exact sentence on every Strip record it broadcasts. The fixture carries it
  // because a real Strip does.
  const underControl = stripAt({
    ownerPositionId: 'CTR',
    tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE', peerFacilityId: 'TACTICAL', peerPositionId: 'TAC_C2' },
    nla: { inhibited: 'cannot drop a Strip under active tactical control — complete a TOFI exit first', reason: 'VALIDATION_ERROR' },
  });
  const { el } = renderStrip({ strip: underControl, fdr: FDR, held: ['CTR'] });
  const drop = findByText(el, 'Drop');
  assert.equal(drop.disabled, true, '§4.6.3 rule 2 — and the button must not look pressable');
  assert.match(drop.title, /active tactical control/);
  // §3.5 rule 2 — RENDERED, not merely greyed out. A `title` on a disabled
  // button is a hover tooltip with no touch equivalent.
  const why = descendants(el).find(c => (c.className || '').includes('efsp-nla-inhibit-reason'));
  assert.ok(why, 'the reason the server would refuse is nowhere on the Strip');
  assert.match(why.textContent, /active tactical control/);
});

test('an NLA the server will refuse says so before it is pressed, and cannot be pressed', () => {
  // F-408: "before the press, button.efsp-nla-btn enabled, title=null, and the
  // Strip text contains no reason; after it, #efsp-mutation-error reads
  // NLA_INHIBITED: no receiving Position present and the state is unchanged."
  // A button the server will refuse looked exactly like one it will accept.
  const strip = stripAt({
    state: 'DEPARTED', ownerPositionId: 'TWR',
    nla: { inhibited: 'no receiving Position present', reason: 'NLA_INHIBITED' },
  });
  const { el, sent } = renderStrip({ strip, fdr: FDR, held: ['TWR'] });
  const btn = findByText(el, 'Hand Off to APP');
  assert.equal(btn.disabled, true);
  assert.equal(btn.dataset.nlaReason, 'NLA_INHIBITED', 'the machine code stays greppable against crc-sync');
  const why = descendants(el).find(c => (c.className || '').includes('efsp-nla-inhibit-reason'));
  assert.equal(why.textContent, 'no receiving Position present');
  for (const fn of btn._listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(sent, [], 'a disabled NLA has no handler to fire at all');
});

test("F-303: a rejected coordination replica's NLA reports itself inert", () => {
  // The server half landed in crc-sync (_applyInvokeNla and the drag route
  // both refuse a rejected replica); this is the whole of the client half.
  // Nothing here knows what a rejected replica is — rendering `strip.nla`
  // properly is all it takes, which is the point of having one source.
  const inert = 'this POINT_OUT was rejected — the replica is inert, and CTR still works the flight';
  const replica = stripAt({
    role: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'APP', bayId: 'app-coordination',
    coordination: { primitive: 'POINT_OUT', state: 'REJECTED', mintedForCoordination: true, peerFacilityId: 'CENTER', peerPositionId: 'CTR', dataOwnerPositionRef: { facilityId: 'CENTER', positionId: 'CTR' }, separationResponsibilityRef: { facilityId: 'CENTER', positionId: 'CTR' } },
    nla: { inhibited: inert, reason: 'VALIDATION_ERROR' },
  });
  const { el, sent } = renderStrip({ strip: replica, fdr: FDR, held: ['APP'] });
  const btn = findByText(el, 'Hand to Tower');
  assert.equal(btn.disabled, true, 'APP declined this flight; its NLA must not now hand it to Tower');
  assert.ok(descendants(el).some(c => c.textContent === inert), 'and the reason is on the Strip, not only in a title');
  for (const fn of btn._listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(sent, []);

  // Drop is how a controller clears a dead replica off their Board, so it stays.
  assert.ok(findByText(el, '✕'), 'Drop is the deliberate exception');
});

// The decision recorded above used to end "✕ / Airspace… / Bind… / MARSA… are
// FDR-level facts … deliberately left alone". Live testing reversed it: CTR
// rejected APP's handoff and then opened a TOFI on the dead copy, minting a
// MISSION Strip for a flight APP still worked. crc-sync now refuses every op on
// a rejected replica except Drop / the Drop NLA / moving it aside, and the
// Strip stops offering what would only be refused.
test('F-303: a rejected replica offers nothing but Drop', () => {
  const airspaces = [{
    airspaceId: 'MOA-EAST', state: 'ACTIVE', rev: 1, transitions: [],
    definition: { airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
  }];
  const replica = stripAt({
    ownerPositionId: 'CTR', bayId: 'ctr-app-coordination',
    coordination: { primitive: 'HANDOFF', state: 'REJECTED', mintedForCoordination: true, peerFacilityId: 'INCIRLIK', peerPositionId: 'APP' },
    nla: { toState: 'DROPPED' },
  });
  const { el, sent } = renderStrip({ strip: replica, fdr: FDR, held: ['CTR'], airspaces, correlations: [correlationOf({ state: 'UNCORRELATED', trackId: null })] });
  for (const label of ['TOFI…', 'Airspace…', 'Convert to Arrival →', 'MARSA…', 'Bind…', 'Coordinate…', '⇥']) {
    assert.equal(findByText(el, label), undefined, `${label} is offered on a dead replica`);
  }
  assert.ok(findByText(el, 'Drop'), 'the Drop NLA stays');

  // Double-click flip and the other gestures would each come back refused.
  fire(el, 'dblclick', { target: { closest: () => null } });
  assert.deepEqual(sent, [], 'a gesture on a dead replica sent a Mutation');
});

test('TOFI is not offered from a handoff replica that has not been answered yet', () => {
  const pending = stripAt({
    ownerPositionId: 'CTR', bayId: 'ctr-app-coordination',
    coordination: { primitive: 'HANDOFF', state: 'PROPOSED', mintedForCoordination: true, peerFacilityId: 'INCIRLIK', peerPositionId: 'APP' },
  });
  const { el } = renderStrip({ strip: pending, fdr: FDR, held: ['CTR'] });
  assert.ok(findByText(el, 'Accept Hand Off') || findByText(el, 'Accept HANDOFF') || findByText(el, 'Reject'), 'the answer buttons render');
  const tofi = menuItem(el, 'TOFI…');
  assert.ok(!tofi || tofi.disabled, 'APP still works this flight until CTR accepts');
});

// ── The TOFI regime picker keeps what the controller chose ────────────────

function pendingTofiEntry() {
  return stripAt({
    role: 'MISSION', state: 'TASKED', ownerPositionId: 'TAC_C2', bayId: 'tac-c2-coordination',
    tofiCoordination: { direction: 'ENTRY', state: 'PROPOSED', peerFacilityId: 'CENTER', peerPositionId: 'CTR' },
  });
}
const regimeSelectOf = (el) => descendants(el).find(c => (c.className || '').includes('efsp-tofi-regime-select'));

test('clicking the regime picker does not select the Strip (the click that used to reset it to MARSA)', () => {
  const { el, sandbox } = renderStrip({ strip: pendingTofiEntry(), fdr: FDR, held: ['TAC_C2'] });
  sandbox.renderAllOpenEfspBays = () => {};
  const select = regimeSelectOf(el);
  // The Strip's click handler sees a target inside a <select>. A real click on
  // the picker bubbles to it; the handler has to recognise the control.
  const insideSelect = { closest: (sel) => (sel.split(',').map(x => x.trim()).includes('select') ? select : null) };
  fire(el, 'click', { target: insideSelect });
  assert.equal(sandbox.getSelectedEfspStripId(), null, 'the Strip was selected, which rebuilds it and loses the choice');
});

test('the chosen regime survives a rebuild, and is what Accept sends', () => {
  const strip = pendingTofiEntry();
  const { el, sandbox, sent } = renderStrip({ strip, fdr: FDR, held: ['TAC_C2'] });
  const select = regimeSelectOf(el);
  select.value = 'ATC';
  fire(select, 'change');

  const rebuilt = sandbox._buildStripEl(strip);
  assert.equal(regimeSelectOf(rebuilt).value, 'ATC', 'a rebuild put MARSA back');
  click(findByText(rebuilt, 'Accept TOFI Entry'));
  assert.equal(sent[0].op.separationRegime, 'ATC');
});

test('a Strip whose regime picker has focus is protected from a rebuild', () => {
  const { el, sandbox } = renderStrip({ strip: pendingTofiEntry(), fdr: FDR, held: ['TAC_C2'] });
  assert.equal(sandbox._isProtectedStripEl(el), false);
  focusStub(regimeSelectOf(el));
  assert.equal(sandbox._isProtectedStripEl(el), true, 'the open dropdown would belong to a detached element');
  // A focused button is not: the NLA keeps focus after every press.
  focusStub(descendants(el).find(c => c.tagName === 'button'));
  assert.equal(sandbox._isProtectedStripEl(el), false);
});

test('Convert to Arrival is only offered to the Positions the server lets convert', () => {
  // TWR holds a Position, which was all the old gate asked for. The server
  // refuses TWR's press (no ConvertToArrival, no ARRIVAL creation).
  const { el } = renderStrip({ strip: stripAt({ ownerPositionId: 'APP' }), fdr: FDR, held: ['TWR'] });
  assert.equal(menuItem(el, 'Convert to Arrival →'), undefined);
});

test('an arrival or overflight Strip draws no chip for a Block its Role does not have', () => {
  for (const [role, state, owner] of [['ARRIVAL', 'INBOUND', 'CTR'], ['OVERFLIGHT', 'TRANSITING', 'CTR']]) {
    const { el } = renderStrip({ strip: stripAt({ role, state, ownerPositionId: owner, bayId: 'ctr-enroute' }), fdr: FDR, held: [owner] });
    for (const blockId of ['9F', '14A', '14D']) {
      assert.equal(blockCell(el, blockId), undefined, `${role} rendered departure-only Block ${blockId}`);
    }
  }
  assert.equal(blockCell(renderStrip({ strip: stripAt({ role: 'OVERFLIGHT', state: 'TRANSITING', ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] }).el, '8A'), undefined);
});

test('Convert to Arrival is offered for the return leg, and refused mid-exchange', () => {
  const ready = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  click(menuItem(ready.el, 'Convert to Arrival →'));
  assert.equal(ready.sent[0].op.kind, 'ConvertToArrival');

  const midExchange = stripAt({
    ownerPositionId: 'CTR',
    tofiCoordination: { direction: 'ENTRY', state: 'ACTIVE', peerFacilityId: 'TACTICAL', peerPositionId: 'TAC_C2' },
  });
  const blocked = renderStrip({ strip: midExchange, fdr: FDR, held: ['CTR'] });
  assert.equal(menuItem(blocked.el, 'Convert to Arrival →').disabled, true);
});

test('Convert to Arrival asks twice when it would clear annotations, and once when it would not', () => {
  const clean = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  click(menuItem(clean.el, 'Convert to Arrival →'));
  assert.equal(clean.sent[0].op.kind, 'ConvertToArrival', 'nothing to lose, so no ceremony');

  const annotated = stripAt({
    ownerPositionId: 'CTR',
    annotations: { 24: { entries: [{ value: 'MIT 10', at: 1, by: 'APP' }] } },
  });
  const careful = renderStrip({ strip: annotated, fdr: FDR, held: ['CTR'] });
  const btn = menuItem(careful.el, 'Convert to Arrival →');
  assert.match(btn.title, /archived and cleared/);
  click(btn);
  assert.deepEqual(careful.sent, [], 'the first press only warns');
  click(menuItem(careful.el, 'Convert — press again'));
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
  for (const file of ['efsp-state.js', 'efsp-arrivals.js', 'airspace-panel.js']) {
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

test('a normally correlated Strip shows nothing — only a problem with its track is drawn (docs/adr/0058)', () => {
  const { el } = renderStrip({
    strip: stripAt(), fdr: FDR, held: ['APP'],
    correlations: [correlationOf()],
    tracks: [{ id: '101', domain: 'AIR', label: { callsign: 'VIPER1', source: 'FDR', trackNumber: 'TN00001' }, ssr: { code: '0041' } }],
  });
  assert.equal(findByText(el, 'TRK 0041'), undefined, 'correlated is the normal case, and draws nothing');
  assert.equal(descendants(el).some(c => (c.className || '').includes('efsp-strip-slots')), false,
    'a Strip with nothing to say has no indicator row at all');
});

test('conformance and conflict alerts appear on the Strip only while they apply', () => {
  const strip = stripAt({ ownerPositionId: 'APP' });
  const r = renderStrip({ strip, fdr: FDR, held: ['APP'], correlations: [correlationOf()], tracks: [{ id: '101', domain: 'AIR', label: { callsign: 'VIPER1', source: 'FDR', trackNumber: 'TN00001' }, ssr: { code: '0041' } }] });
  r.sandbox.applyEfspAlerts({
    conformance: [{ fdrId: 'f1', alerts: [{ kind: 'HEADING', assigned: 50, actual: 72 }] }],
    stca: [{ id: '101|202', a: '101', b: '202', aCallsign: 'VIPER1', bCallsign: 'SNAKE21', timeToCpaSec: 55, minNm: 1.8, vertFt: 400 }],
  });
  const el = r.sandbox._buildStripEl(strip);
  assert.ok(findByText(el, 'HDG 072'));
  assert.ok(findByText(el, 'STCA SNAKE21 0:55'));
  assert.ok(findByText(el, 'Assigned heading 050, tracking 072.'));
  assert.ok(findByText(el, 'Conflict with SNAKE21 in 0:55: closest 1.8 NM / 400 ft.'));
  assert.ok(el.classList.contains('efsp-strip-alert'), 'a conflict gives the Strip its edge');
  const stcaNode = findByText(el, 'STCA SNAKE21 0:55');
  const confNode = findByText(el, 'HDG 072');
  const row = descendants(el).find(c => (c.className || '').includes('efsp-strip-slots'));
  assert.ok(row.children.indexOf(stcaNode) < row.children.indexOf(confNode), 'the conflict comes first');

  r.sandbox.applyEfspAlerts({ conformance: [], stca: [] });
  const quiet = r.sandbox._buildStripEl(strip);
  assert.equal(findByText(quiet, 'HDG 072'), undefined);
  assert.equal(quiet.classList.contains('efsp-strip-alert'), false);
});

test('an obligation badge shows while efsp-alerts lists it, and is gone after the next one does not (docs/adr/0067)', () => {
  const strip = stripAt({ ownerPositionId: 'APP' });
  const r = renderStrip({ strip, fdr: FDR, held: ['APP'], correlations: [correlationOf()], tracks: [{ id: '101', domain: 'AIR', label: { callsign: 'VIPER1', source: 'FDR', trackNumber: 'TN00001' }, ssr: { code: '0041' } }] });
  const badge = (el) => descendants(el).find(c => (c.className || '').includes('efsp-obligation-badge'));
  r.sandbox.applyEfspAlerts({ conformance: [], stca: [], obligations: [
    { facilityId: 'INCIRLIK', stripId: 's1', obligationType: 'VOID_TIME_EXPIRED', severity: 'OVERDUE', dueAt: 1, since: 1 },
  ] });
  const raised = badge(r.sandbox._buildStripEl(strip));
  assert.ok(raised, 'the badge is drawn while the obligation is due');
  assert.ok((raised.className || '').includes('efsp-obligation-badge-overdue'));

  r.sandbox.applyEfspAlerts({ conformance: [], stca: [], obligations: [] });
  assert.equal(badge(r.sandbox._buildStripEl(strip)), undefined, 'the next efsp-alerts without it clears it');
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
    tracks: [{ id: '101', domain: 'AIR', label: { callsign: 'SOMEONE', source: 'TAG', trackNumber: 'TN00001' }, ssr: { code: '0041' } }, { id: '102', domain: 'AIR', label: { callsign: 'SOMEONEELSE', source: 'TAG', trackNumber: 'TN00002' }, ssr: { code: '0041' } }],
  });

  assert.ok(findByText(el, 'TRK ×2'), 'the ambiguity must be visible');
  // Layout C: the indicator is not a control; the tab carries the exchange.
  click(findByText(el, 'Pick…'));
  const choice = findByText(el, 'SOMEONEELSE · 0041 · TN00002');
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
    tracks: [{ id: '303', domain: 'AIR', label: { callsign: 'MYSTERY', source: 'TAG', trackNumber: 'TN00303' }, ssr: null }],
  });
  const bindBtn = menuItem(uncorrelated.el, 'Bind…');
  assert.ok(bindBtn, 'an aircraft the controller can see but nothing matches needs a way in');
  click(bindBtn);
  click(findByText(uncorrelated.el, 'MYSTERY · TN00303'));
  assert.equal(uncorrelated.sent[0].op.kind, 'BindTrack');
  assert.equal(uncorrelated.sent[0].op.trackId, '303');

  const bound = renderStrip({
    strip: stripAt(), fdr: FDR, held: ['APP'],
    correlations: [correlationOf({ matchedBy: 'BINDING', binding: { trackId: '101', boundPositionId: 'APP' } })],
    tracks: [{ id: '101', domain: 'AIR', label: { callsign: 'VIPER1', source: 'FDR', trackNumber: 'TN00001' }, ssr: { code: '0041' } }],
  });
  click(menuItem(bound.el, 'Unbind'));
  assert.equal(bound.sent[0].op.kind, 'UnbindTrack');
});

test('a controller holding no Position can see the correlation but not change it', () => {
  const { el } = renderStrip({
    strip: stripAt(), fdr: FDR, held: [],
    correlations: [correlationOf({ state: 'UNCORRELATED', trackId: null, matchedBy: null })],
  });
  assert.ok(findByText(el, 'NO TRK'), 'still legible');
  assert.equal(menuItem(el, 'Bind…').disabled, true, 'but not actionable');
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
  assert.ok(menuItem(el, 'MARSA…'), 'a controller can start a relation from a Strip that has never been in one');
});

test('declaring MARSA sends DeclareMarsa with both flights and the declaring callsign', () => {
  const { el, sent } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'], otherStrips: [PEER_STRIP],
  });
  click(menuItem(el, 'MARSA…'));
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
  // Straight from the Strip's tab: the armed relation is an exchange in progress.
  click(findByText(el, 'Rendezvous'));
  assert.equal(sent[0].op.kind, 'MarkRendezvous');
  assert.equal(sent[0].marsaId, 'm-1');
  // And through the relation's own popover, from the ⋯ menu.
  click(menuItem(el, 'MARSA…'));
  click(findByText(el, 'Mark rendezvous'));
  assert.equal(sent[1].op.kind, 'MarkRendezvous');
});

test('ending and voiding are both reachable, and carry the relation id', () => {
  for (const [label, kind] of [['End MARSA', 'EndMarsa'], ['Void MARSA', 'VoidMarsa']]) {
    const { el, sent } = renderStrip({
      strip: stripAt({}), fdr: FDR, held: ['APP'],
      marsa: [marsaRelation({ rendezvousAt: 2000 })], otherStrips: [PEER_STRIP],
    });
    click(menuItem(el, 'MARSA…'));
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
  click(menuItem(el, 'MARSA…'));
  click(findByText(el, 'Remove this flight'));
  assert.equal(sent[0].op.kind, 'RemoveParticipant');
  assert.equal(sent[0].op.fdrId, 'f1', 'the Strip you pressed it on is the one leaving');
});

test('the popover names the other participants — rule 5\'s "visible as a link"', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation()], otherStrips: [PEER_STRIP],
  });
  click(menuItem(el, 'MARSA…'));
  assert.ok(findByText(el, 'SHELL71'), 'the other participant is named, not just counted');
});

test('the badge is disabled when the controller holds no Position that can act', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: [],
    marsa: [marsaRelation()], otherStrips: [PEER_STRIP],
  });
  assert.ok(findByText(el, 'MARSA ⚠'), 'still rendered — the relation is a fact whoever is watching');
  assert.equal(menuItem(el, 'MARSA…'), undefined, 'but not actionable from the menu');
  assert.equal(findByText(el, 'Rendezvous').disabled, true, 'nor from the tab');
});

test('an ENDED relation leaves no badge and offers a fresh declaration', () => {
  const { el } = renderStrip({
    strip: stripAt({}), fdr: FDR, held: ['APP'],
    marsa: [marsaRelation({ state: 'ENDED', endedBy: 'END_CONDITION', endedAt: 4000 })],
    otherStrips: [PEER_STRIP],
  });
  assert.equal(findByText(el, 'MARSA ⚠'), undefined);
  assert.ok(menuItem(el, 'MARSA…'), 'ready to declare a new one');
});

// ── the military extension namespace (crc-sync's docs/adr/0052) ───────────
//
// The server half is proved by efsp-scenario-military.test.mjs. This is the
// other half of the habit that keeps catching things: a green sortie says the
// server does the right thing and nothing about whether a controller can ask
// for it.

test('ordnance state is a picker on the Strip, and sends the Block the server routes', () => {
  // Tower's Strip: HOOK and ORDNANCE are its fields alone (docs/adr/0056).
  const { el, sent } = renderStrip({ strip: stripAt({ ownerPositionId: 'TWR', state: 'RUNWAY_QUEUE' }), fdr: FDR, held: ['TWR'] });

  const cell = blockCell(el, '3G');
  assert.ok(cell, 'Block 3G (ordnance state) is not rendered on the Strip at all');
  click(cell);

  const select = descendants(el).find(c => c.tagName === 'select');
  assert.ok(select, '3G opened no picker — free text would let a controller type an invalid state');
  // No leading '' — 3G's cleared value is 'CLEAN', which is in the list
  // already, so the "—" that could never clear it is not offered on a Block
  // that has a value (F-206; strip-template.js's ENUM_CLEARABLE_BLOCKS).
  assert.deepEqual(select.children.map(o => o.value), ['CLEAN', 'LOADED', 'HUNG', 'EXPENDED']);

  select.value = 'HUNG';
  for (const fn of select._listeners.change || []) fn({ stopPropagation() {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.kind, 'SetBlock');
  assert.equal(sent[0].op.blockId, '3G');
  assert.equal(sent[0].op.value, 'HUNG');
});

test('the hook requirement toggles, and a blank cell sends true rather than clearing', () => {
  const { el, sent } = renderStrip({ strip: stripAt({ ownerPositionId: 'TWR', state: 'RUNWAY_QUEUE' }), fdr: FDR, held: ['TWR'] });

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
  const { el } = renderStrip({ strip: stripAt({ ownerPositionId: 'TWR', state: 'RUNWAY_QUEUE' }), fdr: legacy, held: ['TWR'] });
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

/**
 * All six popovers, and how a controller opens each one.
 *
 * One fixture instead of one test per popover, because every defect these have
 * carried has been a CLASS defect discovered one instance at a time: the
 * dismiss-on-own-controls bug (four of them), _isProtectedStripEl's list
 * (found incomplete three separate times), and F-001's stacking/containment
 * fault (all six at once). The previous version of this section tested the
 * MARSA popover properly and then tested bind and airspace inside four nested
 * `if`s, so every assertion in that half was skipped and it reported green
 * while covering nothing. A seventh popover added without an entry here fails
 * the first of the tests below that iterates it.
 */
const POPOVER_CASES = [
  {
    label: 'coordinate',
    render: () => renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] }),
    open: (r) => click(menuItem(r.el, 'Coordinate…')),
  },
  {
    label: 'TOFI',
    render: () => renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] }),
    open: (r) => click(menuItem(r.el, 'TOFI…')),
  },
  {
    label: 'MARSA',
    render: () => renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'], otherStrips: [PEER_STRIP] }),
    open: (r) => click(menuItem(r.el, 'MARSA…')),
  },
  {
    label: 'airspace',
    render: () => renderStrip({
      strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'],
      airspaces: [{
        airspaceId: 'MOA-EAST', state: 'ACTIVE', rev: 1, transitions: [],
        definition: { airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
      }],
    }),
    open: (r) => click(menuItem(r.el, 'Airspace…')),
  },
  {
    label: 'bind',
    render: () => renderStrip({
      strip: stripAt(), fdr: FDR, held: ['APP'],
      correlations: [correlationOf({ state: 'UNCORRELATED', trackId: null, matchedBy: null })],
      tracks: [{ id: '303', domain: 'AIR', label: { callsign: 'MYSTERY', source: 'TAG', trackNumber: 'TN00303' }, ssr: null }],
    }),
    open: (r) => click(menuItem(r.el, 'Bind…')),
  },
  {
    // The only one not opened by a button: right-click on the Strip body
    // (guide §7.3). It has no anchor of its own, so it is also the case that
    // proves _mountPopover works from the Strip element itself.
    label: 'highlight',
    render: () => renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] }),
    open: (r) => fire(r.el, 'contextmenu', { target: r.el }),
  },
  {
    // Layout C's ⋯ menu is a popover too: portalled, owned by its Strip, and
    // holding it still while it is open (docs/adr/0056).
    label: 'strip menu',
    render: () => renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'] }),
    open: (r) => click(descendants(r.el).find(c => (c.className || '').includes('efsp-strip-menu-btn'))),
  },
];

/** The popover currently open, wherever it was put. */
function openPopoverIn(r) {
  return descendants(r.portal).find(c => (c.className || '').includes('popover'));
}

test('every popover is portalled out of its Strip, and still knows which Strip it belongs to', () => {
  // F-001. `.efsp-strip` carries `contain: layout style`, and `contain:
  // layout` creates a stacking context — so a popover inside a Strip is
  // painted underneath everything drawn after that Strip, and what overflows
  // the Strip is ink overflow the Bay cannot scroll to. Both are properties of
  // where the element IS, which is the part this stub can see; where it ends
  // up on screen it structurally cannot, and that half is proved in
  // e2e/l1-popovers.spec.js against a real browser.
  for (const c of POPOVER_CASES) {
    const r = c.render();
    c.open(r);
    const popover = openPopoverIn(r);
    assert.ok(popover, `${c.label}: no popover opened`);
    assert.equal(descendants(r.el).includes(popover), false,
      `${c.label}: still inside the Strip — it will paint under the panel`);
    assert.equal(popover.style.position, 'fixed', `${c.label}: not positioned against the viewport`);
    assert.ok(popover.style.zIndex, `${c.label}: no stacking order of its own`);
    // And the reason the Strip-id protection below can exist at all.
    assert.equal(r.sandbox._stripHasOpenPopover('s1'), true, `${c.label}: nothing records whose popover this is`);
  }
});

test('every popover protects its Strip from reconciliation', () => {
  // Enumerates the CLASS, not the instances. _isProtectedStripEl's list was
  // found incomplete three times after the same bug — a controller losing a
  // half-filled form to somebody else's board delta. It used to ask
  // `stripEl.contains(popoverEl)`, which a portalled popover answers false to
  // every time, so F-001 would have silently deleted the protection for all
  // six had it not been re-established by Strip id.
  for (const c of POPOVER_CASES) {
    const r = c.render();
    assert.equal(r.sandbox._isProtectedStripEl(r.el), false, `${c.label}: protected before anything is open`);
    c.open(r);
    assert.equal(r.sandbox._isProtectedStripEl(r.el), true,
      `${c.label} is open but its Strip is not protected — a remote delta would destroy it mid-interaction`);
  }
});

test('Escape closes any popover, and does not reach the Strip behind it', () => {
  // F-109. Not doctrine — no rule asks for Escape on a popover — but in this
  // same panel Escape reverts a Block edit and an enum <select> (§7.4 rule 2)
  // and collapses the expanded view, so a controller who has learned "Esc
  // backs out" found it worked on a Block and not on the popover beside it.
  for (const c of POPOVER_CASES) {
    const r = c.render();
    c.open(r);
    assert.ok(openPopoverIn(r), `${c.label}: precondition — a popover is open`);

    const seen = r.keyDownOnDocument('Escape');
    assert.equal(openPopoverIn(r), undefined, `${c.label}: Escape left the popover open`);
    // The same keypress must not ALSO revert the Block edit or collapse the
    // Strip underneath, which is why the listener is capture-phase.
    assert.equal(seen.propagationStopped, true, `${c.label}: Escape carried on to the Strip behind the popover`);
  }
});

test('a key that is not Escape leaves the popover alone', () => {
  const r = POPOVER_CASES[0].render();
  POPOVER_CASES[0].open(r);
  r.keyDownOnDocument('a');
  assert.ok(openPopoverIn(r), 'typing into a popover closed it');
});

test('closing a popover without acting asks for the render its Strip has been waiting for', async () => {
  // F-108. _reconcileRackStrips skips a protected Strip because "it reconciles
  // on a later render once unprotected" — and nothing ever requested that
  // later render, so on a quiet Board a Strip whose popover was closed without
  // acting kept showing what it showed when the popover opened, indefinitely.
  // Acting hid the defect, because the ack's own render caught the Strip up.
  for (const c of POPOVER_CASES) {
    const r = c.render();
    let renders = 0;
    r.sandbox.renderAllOpenEfspBays = () => { renders += 1; };
    c.open(r);
    await tick();
    assert.equal(renders, 0, `${c.label}: re-rendered while the popover was still open`);

    r.pointerDownOn(r.el); // clicked away without acting
    assert.equal(openPopoverIn(r), undefined, `${c.label}: the outside press did not close it`);
    await tick();
    assert.equal(renders, 1, `${c.label}: nothing asked for the render that reconciles the Strip`);
  }
});

test('re-opening a popover does not trigger the render that would tear out its anchor', async () => {
  // Every _open*Popover closes the previous one first, so the F-108 render has
  // to be deferred and then skipped when something is open again by the time
  // it runs — otherwise opening a popover re-renders the Strip mid-open and
  // destroys the very element the popover is anchored to.
  const r = POPOVER_CASES[0].render();
  let renders = 0;
  r.sandbox.renderAllOpenEfspBays = () => { renders += 1; };
  POPOVER_CASES[0].open(r);
  POPOVER_CASES[0].open(r);
  await tick();
  assert.equal(renders, 0, 'a re-opened popover asked for a render that would have destroyed its anchor');
  assert.ok(openPopoverIn(r), 'and it is still open');
});

test('every popover survives a press on its own controls, and closes on one outside', async () => {
  // The dismiss listener is on `document` in the CAPTURE phase, so a popover
  // whose listener does not test the event target is torn out between
  // pointerdown and pointerup and its buttons never see a click at all. That
  // was true of four of the six, and it is invisible to every other test in
  // this file because those call click handlers directly.
  for (const c of POPOVER_CASES) {
    const r = c.render();
    c.open(r);
    await tick(); // the listener is registered in a deferred setTimeout(…, 0)

    const popover = openPopoverIn(r);
    assert.ok(popover, `${c.label}: no popover opened`);
    const inner = descendants(popover)[0];
    assert.ok(inner, `${c.label}: the popover rendered no controls to press`);

    r.pointerDownOn(inner);
    assert.ok(openPopoverIn(r), `${c.label}: pressing a control inside the popover closed it`);

    r.pointerDownOn(r.el);
    assert.equal(openPopoverIn(r), undefined, `${c.label}: a press outside the popover must still dismiss it`);
  }
});

test('a click inside the MARSA popover does not rebuild it empty', async () => {
  // F-110. _openMarsaPopover appended the popover INTO the MARSA… <button>
  // whose click handler opens it, so a click anywhere inside — into the
  // declarer field, onto a candidate <select> — bubbled back to that button
  // and re-ran the opener, replacing every control with a fresh empty one. The
  // declarer is required (§9.2 rule 1), so Declare could never be reached.
  // Only Declare itself survived, because its own handler stopped propagation.
  //
  // The click handler is on the Strip element here rather than the button, but
  // the mechanism is the same one: what matters is that the popover is not a
  // descendant of anything that reopens it.
  const r = renderStrip({ strip: stripAt(), fdr: FDR, held: ['APP'], otherStrips: [PEER_STRIP] });
  click(menuItem(r.el, 'MARSA…'));
  const popover = openPopoverIn(r);
  const declaring = descendants(popover).find(c => c.tagName === 'input');
  assert.ok(declaring, 'no "who declared it" field — the declaration cannot be made');

  declaring.value = 'SHELL71';
  // Whatever the controller presses inside the popover, the field they already
  // filled in has to still be the same element with the same text in it.
  fire(declaring, 'click', { target: declaring });
  const stillThere = descendants(openPopoverIn(r)).find(c => c.tagName === 'input');
  assert.equal(stillThere, declaring, 'the popover was rebuilt — the field is a different element');
  assert.equal(stillThere.value, 'SHELL71', 'what the controller typed was thrown away');

  click(findByText(r.el, 'Declare'));
  assert.equal(r.sent[0].op.declaringCallsign, 'SHELL71');
});

test('acting from a popover uses the Strip as it is NOW, not as it was when the popover opened', () => {
  // F-107. The four dispatch helpers below all passed the `strip` object
  // CAPTURED when the popover opened, and sendEfspMutation sends its `rev` as
  // the optimistic-concurrency base. _isProtectedStripEl deliberately stops
  // the Strip being rebuilt while a popover is open, so that captured object
  // is *guaranteed* stale the moment anybody else touches the same Strip:
  // pressing Send returned a bare STALE_REV and took the typed note with it.
  // Exactly the case the popover protection exists for, ending in a refusal.
  //
  // Not MARSA or bind: _dispatchMarsa and _dispatchCorrelation send their own
  // relation's and correlation record's current rev, never the Strip's.
  const cases = [
    { ...POPOVER_CASES[0], act: (r) => click(findByText(r.el, 'Send')) },
    { ...POPOVER_CASES[1], act: (r) => click(findByText(r.el, 'Send TOFI')) },
    { ...POPOVER_CASES[3], act: (r) => click(findByText(r.el, 'Approve entry')) },
    { ...POPOVER_CASES[5], act: (r) => click(descendants(openPopoverIn(r))[0]) },
  ];
  for (const c of cases) {
    const r = c.render();
    c.open(r);
    // Somebody else works the same Strip. The element is deliberately left
    // alone — it is protected — so only the store moves.
    r.sandbox.applyEfspDelta({ strips: { updated: [{ ...r.sandbox.getEfspStrip('s1'), rev: 7 }] } });
    c.act(r);
    assert.equal(r.sent.length, 1, `${c.label}: nothing was sent`);
    assert.equal(r.sent[0].strip.rev, 7,
      `${c.label}: sent the rev captured when the popover opened — the controller gets STALE_REV`);
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
    state: 'PENDING_CLEARANCE', ownerPositionId: 'CD', bayId: 'cd-pending-clearance',
    annotations: { 21: { blockId: '21', entries } },
  });
}
const entry = (value, status) => ({ value, status, at: Date.now(), by: 'c-OPS' });
const historyIn = (el) => descendants(el).filter(c => (c.className || '').includes('efsp-annotation-entry'));

test('a Block written once shows no history at all', () => {
  // The common case by far. It must not sprout an empty container on every
  // unamended Block of every Strip.
  const { el } = renderStrip({ strip: cellWithHistory([entry('6000', 'ACTIVE')]), fdr: FDR, held: ['CD'] });
  assert.deepEqual(historyIn(el), []);
  assert.equal(descendants(el).filter(c => (c.className || '').includes('efsp-annotation-history')).length, 0);
});

test('an amended Block shows the prior value struck through, on the Strip', () => {
  const { el } = renderStrip({
    strip: cellWithHistory([entry('4000', 'SUPERSEDED'), entry('6000', 'ACTIVE')]),
    fdr: FDR, held: ['CD'],
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
    fdr: FDR, held: ['CD'],
  });
  assert.ok(historyIn(el)[0].className.includes('efsp-annotation-entry-struck'));
});

test('a much-amended Block shows its latest prior and counts the rest', () => {
  // §3.7 rule 2's own escape hatch — "where space does not permit, the Block
  // MUST render an overflow indicator and expose full history on tap",
  // modelled on ATOP's `*`. History is append-only for the life of the Strip,
  // so without this a long sortie grows a chip without limit.
  const strip = cellWithHistory([
    entry('2000', 'SUPERSEDED'), entry('3000', 'SUPERSEDED'),
    entry('4000', 'SUPERSEDED'), entry('5000', 'SUPERSEDED'), entry('6000', 'ACTIVE'),
  ]);
  const { el } = renderStrip({ strip, fdr: FDR, held: ['CD'] });

  // One prior, beside the label, so the value in force keeps the field to
  // itself — two struck priors used to push a much-amended ALT out of view.
  const shown = historyIn(el).map(c => c.textContent);
  assert.deepEqual(shown, ['5000'], 'the value just replaced, and only that');
  assert.equal(blockCell(el, '21').textContent, '6000');

  const overflow = descendants(el).find(c => (c.className || '').includes('efsp-annotation-overflow'));
  assert.ok(overflow, 'no overflow indicator');
  assert.equal(overflow.textContent, '+3');
  assert.match(overflow.title, /3 earlier entries/);
});

test('the expanded view shows the whole chain, which is what makes capping the chip legal', () => {
  const strip = cellWithHistory([
    entry('2000', 'SUPERSEDED'), entry('3000', 'SUPERSEDED'),
    entry('4000', 'SUPERSEDED'), entry('5000', 'SUPERSEDED'), entry('6000', 'ACTIVE'),
  ]);
  const r = renderStrip({ strip, fdr: FDR, held: ['CD'] });
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
  const { el, sent } = renderStrip({ strip, fdr: FDR, held: ['CD'] });
  const strike = descendants(el).find(c => (c.className || '').includes('efsp-confirm-vacated-btn'));
  assert.ok(strike, 'no confirm-vacated button on an ACTIVE altitude');
  click(strike);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.blockId, '21');
  assert.equal(sent[0].op.confirmVacated, true);
  assert.equal(sent[0].op.value, undefined, 'it marks the entry struck, it never amends');
});

// ── interactive state survives a remote re-render ────────────────────────

// The popover half of this section moved up to POPOVER_CASES, which
// enumerates all six rather than the three this used to name.

test('an open Block edit protects its Strip too — but only while it has focus', () => {
  const { el, sandbox } = renderStrip({ strip: stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'] });
  assert.equal(sandbox._isProtectedStripEl(el), false, 'nothing open yet');
  click(blockCell(el, '9'));
  assert.equal(sandbox._isProtectedStripEl(el), true, 'somebody is typing into this Strip');

  // F-204. Unconditional protection froze the Strip for good the moment they
  // clicked away: nobody else's changes to it ever appeared again, and a
  // hand-off left it drawn in a Bay it no longer belonged to, offering an NLA
  // that came back STALE_REV. An abandoned edit must not block the rebuild.
  focusStub(null);
  assert.equal(sandbox._isProtectedStripEl(el), false, 'an abandoned edit still freezes its Strip');
});

// ── the one open Block edit (F-204) ──────────────────────────────────────

/** Fires one listener type on a stub element, with whatever event fields the handler reads. */
function fire(el, type, ev) {
  assert.ok(el, 'no element to fire on');
  for (const fn of el._listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...ev });
}

/** Every open free-text input on a rendered Strip. */
function openInputs(el) {
  return descendants(el).filter(c => (c.className || '').split(/\s+/).includes('efsp-block-input') && c.tagName === 'input');
}

test('starting a second Block edit closes the first — one open input on the Board, not several', () => {
  // _buildBlockCell's comment claimed this for a long time and nothing
  // implemented it: clicking ALT and then DEP left TWO open inputs on one
  // Strip, each of which froze it (F-204's second half).
  const { el } = renderStrip({ strip: stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'] });
  click(blockCell(el, '9'));
  click(blockCell(el, '8'));
  assert.equal(openInputs(el).length, 1, 'two Blocks are open for editing at once');
});

test('an abandoned Block edit survives a rebuild with what was typed still in it', () => {
  const strip = stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' });
  const { el, sandbox } = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  click(blockCell(el, '9'));
  const input = openInputs(el)[0];
  input.value = 'DCT ALPHA DCT';
  fire(input, 'input');
  focusStub(null); // clicked away — blur neither commits nor reverts (§3.7 rule 5)

  // What the reconciler does to an unprotected Strip on the next board delta.
  const rebuilt = sandbox._buildStripEl(strip);
  const restored = openInputs(rebuilt);
  assert.equal(restored.length, 1, 'the rebuild lost the abandoned edit, or opened it twice');
  assert.equal(restored[0].value, 'DCT ALPHA DCT');
});

test('an abandoned edit is restored into exactly one cell, not into both the chip and the expanded row', () => {
  // A Block with more history than its chip can show appears in BOTH surfaces
  // (see _expandedBlockIdsFor), which is the one way a single edit could come
  // back twice.
  const entries = ['1000', '2000', '3000'].map(v => ({ value: v, status: 'SUPERSEDED', at: 1, by: null }));
  entries.push({ value: '4000', status: 'ACTIVE', at: 2, by: null });
  const strip = stripAt({ ownerPositionId: 'OPS', annotations: { 21: { blockId: '21', entries } } });
  const { el, sandbox } = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  sandbox.renderAllOpenEfspBays = () => {};
  click(descendants(el).find(c => (c.className || '').includes('efsp-expand-btn')));
  const expanded = sandbox._buildStripEl(strip);
  click(blockCell(expanded, '21'));
  focusStub(null);

  assert.equal(openInputs(sandbox._buildStripEl(strip)).length, 1);
});

// ── Space and Enter belong to the control, not to the Strip (F-201/203/205) ─

/** The Strip element's own keydown handler, as the browser would reach it. */
function stripKeydown(el, key, target) {
  let defaultPrevented = false;
  for (const fn of el._listeners.keydown || []) {
    fn({ key, target, currentTarget: el, preventDefault() { defaultPrevented = true; }, stopPropagation() {} });
  }
  return defaultPrevented;
}

test('Space and Enter inside a Block input never reach the Strip\'s selection toggle', () => {
  // One mechanism behind four findings: a Space typed into a Block was
  // preventDefault()ed and toggled selection instead of being typed (F-201),
  // and Enter committed the Block AND moved the selection that the Rack-header
  // move acts on (F-203). The enum <select> lost its picker to the same
  // handler (F-205).
  const { el, sandbox } = renderStrip({ strip: stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'] });
  sandbox.renderAllOpenEfspBays = () => {};
  click(blockCell(el, '9'));
  const input = openInputs(el)[0];

  for (const key of [' ', 'Enter']) {
    assert.equal(stripKeydown(el, key, input), false, `${key} was swallowed by the Strip`);
    assert.equal(sandbox.getSelectedEfspStripId(), null, `${key} toggled the Strip's selection`);
  }

  // The class, not the instance: anything focusable inside the Strip owns
  // these keys — a <select>, a <button>, and any popover field.
  for (const target of [{ tagName: 'SELECT' }, { tagName: 'BUTTON' }, { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }]) {
    assert.equal(stripKeydown(el, ' ', target), false, `${target.tagName} did not keep its own Space`);
  }

  // And the Strip itself still claims them — this is the keyboard half of the
  // non-drag move path (§7.8.1, WCAG 2.2 SC 2.5.7) and must not be lost.
  assert.equal(stripKeydown(el, ' ', el), true);
  assert.equal(sandbox.getSelectedEfspStripId(), 's1');
});

test('Escape collapses the expanded view, which is otherwise only closable from above it', () => {
  // F-208: 22 rows in a ~200px Bay, and the ▲ that closes them sits in the
  // actions row ABOVE them all.
  const strip = stripAt({ ownerPositionId: 'OPS' });
  const { el, sandbox } = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  sandbox.renderAllOpenEfspBays = () => {};
  click(descendants(el).find(c => (c.className || '').includes('efsp-expand-btn')));
  const expanded = sandbox._buildStripEl(strip);
  assert.ok(descendants(expanded).some(c => (c.className || '').includes('efsp-strip-expanded')), 'not expanded');

  // A second way out at the END of the rows, for a pointer.
  const bottom = descendants(expanded).find(c => (c.className || '').includes('efsp-expanded-collapse'));
  assert.ok(bottom, 'nothing collapses the view from the bottom of it');

  stripKeydown(expanded, 'Escape', expanded);
  assert.ok(!descendants(sandbox._buildStripEl(strip)).some(c => (c.className || '').includes('efsp-strip-expanded')),
    'Escape did not collapse the expanded view');
});

// ── the enum picker (F-205, F-206) ───────────────────────────────────────

/** Opens an enum Block's picker and returns the <select>. */
function openEnum(el, blockId) {
  click(blockCell(el, blockId));
  const select = descendants(el).find(c => (c.className || '').includes('efsp-block-enum-select'));
  assert.ok(select, `Block ${blockId} did not open a picker`);
  return select;
}

test('arrowing through an enum picker chooses nothing — Enter does', () => {
  // Chromium fires 'change' for every arrow press on a closed <select>, so
  // committing on 'change' amended a clearance the instant a controller
  // pressed ↓ to see the options, and took the picker away with it (F-205).
  const { el, sent } = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  const select = openEnum(el, '5A');

  fire(select, 'keydown', { key: 'ArrowDown' });
  select.value = 'CST';
  fire(select, 'change');
  assert.equal(sent.length, 0, 'an arrow key amended the Block');

  fire(select, 'keydown', { key: 'Enter' });
  assert.equal(sent.length, 1, 'Enter did not choose');
  assert.equal(sent[0].op.blockId, '5A');
  assert.equal(sent[0].op.value, 'CST');
});

test('a pointer pick still commits on change — that gesture IS the choice', () => {
  const { el, sent } = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'] });
  const select = openEnum(el, '5A');
  select.value = 'FAIL';
  fire(select, 'change');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.value, 'FAIL');
});

test('"—" is offered only where the server accepts a clear, and clears with ""', () => {
  // F-206: "—" was offered on all six enum Blocks and did nothing on any of
  // them — the change handler returned early on an empty value. Only RSVC and
  // SREG accept a clear; fdr-store.js's setTofi() normalizes the '' a <select>
  // sends to null, so "cleared" has one spelling server-side.
  // strip-template.js's ENUM_CLEARABLE_BLOCKS carries the per-Block answer.
  const held = ['CTR'];
  const strip = stripAt({ ownerPositionId: 'CTR' });
  const blankOption = (select) => select.children.find(o => o.value === '');

  const set = renderStrip({ strip, fdr: { ...FDR, tofi: { ifrActive: true, separationRegime: 'MARSA' } }, held });
  const sreg = openEnum(set.el, 'SREG');
  assert.ok(blankOption(sreg), 'SREG can be cleared, so "—" must be there to clear it with');
  sreg.value = '';
  fire(sreg, 'change');
  assert.equal(set.sent.length, 1, 'choosing "—" on a clearable Block sent nothing');
  assert.equal(set.sent[0].op.blockId, 'SREG');
  assert.equal(set.sent[0].op.value, '', 'a clear is the "" the <select> holds, normalized server-side');

  // 5A's cleared value is 'NONE', already one of its own options, so there is
  // nothing for "—" to do once the Block is set.
  const fixed = renderStrip({ strip, fdr: FDR, held });
  const degr = openEnum(fixed.el, '5A');
  assert.equal(blankOption(degr), undefined, '"—" is offered on a Block it can never clear');
  degr.value = '';
  fire(degr, 'change');
  assert.equal(fixed.sent.length, 0, 'a clear the server refuses was sent anyway');

  // But an UNSET Block keeps it: the picker has to be able to show "no value",
  // and without a blank the first real pick would not move selectedIndex and
  // so would fire no 'change' at all.
  const unset = renderStrip({ strip, fdr: FDR, held });
  assert.ok(blankOption(openEnum(unset.el, '24A')),
    'an unset Block with no "—" reads as its first option, and cannot be set to it');
});

// ── F-101: the double-tap that advances the NEXT Strip ───────────────────

test('a second advancing press inside the double-tap window is discarded, whichever Strip it lands on', () => {
  // F-101, and the class lanes 3 and 4 widened it to. The first press
  // transfers the Strip away, the Rack reflows, and the NEIGHBOUR's button is
  // now exactly where the pointer is — so the second tap is an ordinary FIRST
  // click on a different Strip, which crc-sync's per-stripId guard is
  // structurally incapable of seeing. Lane 4's worst case: a double-tap on
  // "Hand Off to APP" pressed "Line Up and Wait" for the jet that slid up.
  //
  // Hence board-wide. Both Strips are rendered from ONE sandbox so they share
  // the module state a real page shares.
  const tapped = stripAt({ stripId: 's1', state: 'DEPARTED', ownerPositionId: 'TWR' });
  const neighbour = stripAt({ stripId: 's2', fdrId: 'f2', state: 'RUNWAY_QUEUE', ownerPositionId: 'TWR' });
  const r = renderStrip({ strip: tapped, fdr: FDR, held: ['TWR'], otherStrips: [neighbour] });

  click(findByText(r.el, 'Hand Off to APP'));
  assert.deepEqual(r.sent.map(s => s.op.kind), ['InvokeNla']);

  const slidUp = r.sandbox._buildStripEl(neighbour);
  const luaw = findByText(slidUp, 'Line Up and Wait');
  for (const fn of luaw._listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(r.sent.length, 1, 'a runway clearance nobody gave');
});

test('the double-tap window covers the Drop and the coordination/TOFI answers too', () => {
  // "Any control whose success removes its Strip from the Bay you are looking
  // at" — lane 3's general rule. A Drop, an Accept and a TOFI Accept all do.
  const replica = stripAt({
    stripId: 's1', bayId: 'app-coordination', ownerPositionId: 'APP', role: 'ARRIVAL', state: 'INBOUND',
    coordination: { primitive: 'HANDOFF', state: 'PROPOSED', mintedForCoordination: true, peerFacilityId: 'CENTER', peerPositionId: 'CTR' },
  });
  const second = stripAt({ stripId: 's2', fdrId: 'f2', bayId: 'app-coordination', ownerPositionId: 'APP', role: 'ARRIVAL', state: 'INBOUND',
    coordination: { primitive: 'HANDOFF', state: 'PROPOSED', mintedForCoordination: true, peerFacilityId: 'CENTER', peerPositionId: 'CTR' } });
  const r = renderStrip({ strip: replica, fdr: FDR, held: ['APP'], otherStrips: [second] });

  click(findByText(r.el, 'Accept Hand Off'));
  assert.equal(r.sent.length, 1);
  const other = r.sandbox._buildStripEl(second);
  const accept = findByText(other, 'Accept Hand Off');
  for (const fn of accept._listeners.click || []) fn({ stopPropagation() {}, preventDefault() {} });
  assert.equal(r.sent.length, 1, 'the second replica was accepted by a tap nobody meant');
});

test('the NLA button goes dead on the press, without waiting for the ack', () => {
  // §7.9's "local input -> visual feedback < 50ms, never waiting on the
  // server" — the other half of what efsp-nla.js's double-tap exports were
  // written for, and never wired up either.
  const { el, sent } = renderStrip({ strip: stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'] });
  const btn = findByText(el, 'Send to Clearance');
  click(btn);
  assert.equal(sent.length, 1);
  assert.equal(btn.disabled, true);
});

// ── F-103 / F-207: a refusal, attributed ─────────────────────────────────

test('a refusal marks the Strip it was about, and only that Strip', () => {
  // F-103: "BBB22's Strip className was plain efsp-strip." Two Strips on
  // screen and nothing said which one the banner was about.
  const refusal = { stripId: 's1', blockId: null, reason: 'NO_RECEIVING_POSITION', detail: null, value: null, message: 'RFB103 — Nobody is holding the Position this would go to', at: 1 };
  const marked = renderStrip({ strip: stripAt({ stripId: 's1' }), fdr: FDR, held: ['APP'], refusal });
  assert.equal(marked.el.classList.contains('efsp-strip-refused'), true);
  assert.equal(marked.el.dataset.refusedReason, 'NO_RECEIVING_POSITION');
  assert.equal(marked.el.title, refusal.message);

  const bystander = renderStrip({ strip: stripAt({ stripId: 's2' }), fdr: FDR, held: ['APP'], refusal });
  assert.equal(bystander.el.classList.contains('efsp-strip-refused'), false);
});

test('a refusal that named no Strip marks NOTHING — not whatever is selected', () => {
  // The null-stripId case: a refused CreateStrip (there is no Strip yet), an
  // airspace op. getCurrentEfspRefusal's contract is explicit that this means
  // mark nothing, and marking the selection would be a false accusation.
  const refusal = { stripId: null, blockId: null, reason: 'VALIDATION_ERROR', detail: 'callsign already in use', value: null, message: 'callsign already in use', at: 1 };
  const { el } = renderStrip({ strip: stripAt({ stripId: 's1' }), fdr: FDR, held: ['APP'], refusal });
  assert.equal(el.classList.contains('efsp-strip-refused'), false);
});

test('a refused Block edit marks its cell and gives the typed text back', () => {
  // F-207: the input closes on Enter, BEFORE the server replies, so the Block
  // reverts and the typed text exists nowhere on screen. "To correct a long
  // route, the controller retypes all of it from memory."
  const refusal = { stripId: 's1', blockId: '9', reason: 'VALIDATION_ERROR', detail: 'no such fix', value: 'LTAG DCT ELVAN DCT LTAF', message: 'VIPER1 RTE “LTAG DCT ELVAN DCT LTAF” — no such fix', at: 7 };
  const { el } = renderStrip({ strip: stripAt({ stripId: 's1', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'], refusal });

  const reopened = descendants(el).find(c => (c.className || '').includes('efsp-block-input'));
  assert.ok(reopened, 'the editor was not re-opened, so the text is gone');
  assert.equal(reopened.value, 'LTAG DCT ELVAN DCT LTAF', 're-opened empty is no better than not at all');

  // And exactly one editor: an open edit is restored into one cell only
  // (_shouldRestoreBlockEdit), the F-204 rule this reuses.
  assert.equal(descendants(el).filter(c => (c.className || '').includes('efsp-block-input')).length, 1);
});

test('a refused confirmVacated marks the cell and seeds nothing', () => {
  // {blockId: '7', value: null} is a legitimate combination — which cell was
  // refused and whether there is text to put back are separate questions.
  const refusal = { stripId: 's1', blockId: '7', reason: 'STALE_REV', detail: null, value: null, message: 'VIPER1 — Somebody else changed this Strip', at: 3 };
  const { el } = renderStrip({ strip: stripAt({ stripId: 's1', ownerPositionId: 'OPS' }), fdr: FDR, held: ['OPS'], refusal });
  const cell = blockCell(el, '7');
  assert.equal(cell.classList.contains('efsp-block-refused'), true);
  assert.equal(descendants(el).some(c => (c.className || '').includes('efsp-block-input')), false, 'nothing to put back, so nothing opened');
});

test('the refused text is seeded once, not on every rebuild', () => {
  // The banner stands for 30s and the Strip rebuilds repeatedly underneath it
  // — re-seeding would overwrite the correction being typed.
  const refusal = { stripId: 's1', blockId: '9', reason: 'VALIDATION_ERROR', detail: null, value: 'FIRST', message: 'x', at: 11 };
  const strip = stripAt({ stripId: 's1', ownerPositionId: 'OPS' });
  const r = renderStrip({ strip, fdr: FDR, held: ['OPS'], refusal });
  const input = descendants(r.el).find(c => (c.className || '').includes('efsp-block-input'));
  input.value = 'CORRECTED';
  for (const fn of input._listeners.input || []) fn({});

  const again = r.sandbox._buildStripEl(strip);
  const restored = descendants(again).find(c => (c.className || '').includes('efsp-block-input'));
  assert.equal(restored.value, 'CORRECTED', 'the rebuild threw the correction away and put the refused text back');
});

// ── F-302 / F-304: the coordination a controller cannot see ──────────────

test("the sender's Strip says a coordination is pending, and then what became of it", () => {
  // F-302. TOFI has had "TOFI ENTRY: PROPOSED" since WP4A; the five
  // primitives had nothing on either side. "A refusal nobody sees is rule 2
  // exactly. A pending handoff nobody sees is how one gets forgotten."
  const sender = (state) => stripAt({
    ownerPositionId: 'CTR', role: 'ARRIVAL', state: 'INBOUND', bayId: 'ctr-arrivals',
    coordination: { primitive: 'HANDOFF', state, peerFacilityId: 'INCIRLIK', peerPositionId: 'APP' },
  });
  const badgeOf = (el) => descendants(el).find(c => (c.className || '').includes('efsp-coordination-state-badge'));
  // Layout C: a tab row — what and who on one line, the state under it.
  const stateOf = (el) => descendants(el).find(c => (c.className || '').includes('efsp-x-meta')).textContent;

  const pending = renderStrip({ strip: sender('PROPOSED'), fdr: FDR, held: ['CTR'] });
  assert.equal(badgeOf(pending.el).textContent, 'HAND OFF → APP');
  assert.equal(stateOf(pending.el), 'PROPOSED');
  const accepted = renderStrip({ strip: sender('ACTIVE'), fdr: FDR, held: ['CTR'] });
  assert.equal(stateOf(accepted.el), 'ACTIVE');
  // The rejection is the case that breaks rule 2: the server refused on the
  // controller's behalf and the only sign was the Coordinate button coming back.
  const rejected = renderStrip({ strip: sender('REJECTED'), fdr: FDR, held: ['CTR'] });
  assert.equal(stateOf(rejected.el), 'REJECTED by APP');
  // className, not classList: the badge sets its classes as one string.
  assert.match(badgeOf(rejected.el).className, /efsp-coordination-state-rejected/);
});

test('an operational request is reported in its own words, not accept/reject', () => {
  // The buttons say Approve/Unable (§4.6, coordination.js's acceptPhrase); a
  // chip saying REJECTED beside a button saying Unable would be two names for
  // one outcome.
  const strip = stripAt({
    ownerPositionId: 'CTR', role: 'ARRIVAL', state: 'INBOUND',
    coordination: { primitive: 'OPERATIONAL_REQUEST', state: 'REJECTED', peerFacilityId: 'INCIRLIK', peerPositionId: 'APP' },
  });
  const { el } = renderStrip({ strip, fdr: FDR, held: ['CTR'] });
  const badge = descendants(el).find(c => (c.className || '').includes('efsp-coordination-state-badge'));
  assert.equal(badge.textContent, 'OPERATIONAL REQUEST → APP');
  assert.equal(descendants(el).find(c => (c.className || '').includes('efsp-x-meta')).textContent, 'UNABLE by APP');
});

test("the proposer's note, and who proposed, reach the receiver", () => {
  // F-304: the note is sent, stored on the replica, and read by nothing —
  // bay-view.js had no reference to coordination.note anywhere except the two
  // popovers that WRITE one. On a degraded track the popover calls it
  // required and the server refuses without it.
  const note = 'climbing FL200 on request, verbal done';
  const replica = stripAt({
    role: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'APP', bayId: 'app-coordination',
    coordination: { primitive: 'HANDOFF', state: 'PROPOSED', mintedForCoordination: true, note, peerFacilityId: 'CENTER', peerPositionId: 'CTR' },
  });
  const { el } = renderStrip({ strip: replica, fdr: FDR, held: ['APP'] });
  const noteEl = descendants(el).find(c => (c.className || '').includes('efsp-coordination-note'));
  assert.ok(noteEl, 'the note is nowhere on the Strip it was written for');
  assert.match(noteEl.textContent, /CTR: “climbing FL200 on request, verbal done”/);
  // "Accept Hand Off does not say from CTR" — only POINT_OUT's DATA: chip has
  // ever named the peer.
  const badge = descendants(el).find(c => (c.className || '').includes('efsp-coordination-state-badge'));
  assert.equal(badge.textContent, 'HAND OFF ← CTR');
  assert.match(badge.title, /CTR proposed this/);
});

test("a TOFI note reaches the MRU controller, attributed", () => {
  const note = 'MOA 3 hot, block FL180-FL220';
  const mission = stripAt({
    role: 'MISSION', state: 'TASKED', ownerPositionId: 'TAC_C2', bayId: 'tac-c2-coordination',
    tofiCoordination: { direction: 'ENTRY', state: 'PROPOSED', note, peerFacilityId: 'CENTER', peerPositionId: 'CTR' },
  });
  const { el } = renderStrip({ strip: mission, fdr: FDR, held: ['TAC_C2'] });
  const noteEl = descendants(el).find(c => (c.className || '').includes('efsp-coordination-note'));
  assert.ok(noteEl, 'the TOFI note is rendered nowhere on the MRU side');
  assert.match(noteEl.textContent, /CTR: “MOA 3 hot, block FL180-FL220”/);
});

// ── §9.2 rule 2: the void, said out loud ─────────────────────────────────

test('a voided MARSA carries the alert as a sentence on every participant Strip', () => {
  // docs/efsp-wp6-plan.md §13's acceptance line. Measured: after the interlock
  // fired on an INIT ALT edit, no message anywhere said a void had happened —
  // the explanation lived only in the badge's hover `title`, and the
  // controller who caused it is looking at the Block they just typed into.
  const marsa = [{
    marsaId: 'm1', rev: 2, state: 'VOIDED', participants: ['f1', 'f2'],
    declaringCallsign: 'TEXACO1', rendezvousAt: null, endedAt: 5,
    voidedBy: 'CONTROLLER_ALTITUDE_CHANGE', voidedDetail: null,
  }];
  const { el } = renderStrip({ strip: stripAt({ ownerPositionId: 'CTR' }), fdr: FDR, held: ['CTR'], marsa });
  assert.equal(el.classList.contains('efsp-strip-marsa-voided'), true);
  const why = descendants(el).find(c => (c.className || '').includes('efsp-marsa-void-reason'));
  assert.ok(why, 'the void is an ALERT, not a tooltip');
  assert.match(why.textContent, /MARSA VOIDED — an altitude was assigned before rendezvous\. ATC is separating these aircraft again\./);
});

// ── Arrivals on the Strip (docs/adr/0057) ────────────────────────────────

test('a Strip that just arrived flashes on its first build only, and keeps its amber edge and "from" line', () => {
  const strip = stripAt({ ownerPositionId: 'TWR', state: 'RUNWAY_QUEUE', bayId: 'twr-runway-queue', updatedBy: 'c-gnd' });
  const r = renderStrip({ strip, fdr: FDR, held: ['TWR'] });
  r.sandbox.noteEfspArrivals(new Map([['s1', { bayId: 'gnd-taxi-out', ownerPositionId: 'GND' }]]), [strip],
    { heldPositions: ['TWR'], myControllerIds: ['c-twr'], visibleBayId: 'twr-runway-queue', now: Date.now(), callsignOf: () => 'VIPER1' });

  const first = r.sandbox._buildStripEl(strip);
  assert.ok(first.classList.contains('efsp-strip-arrived'));
  assert.ok(first.classList.contains('efsp-strip-arrived-flash'), 'the arrival flashes when first seen');
  assert.ok(descendants(first).some(c => c.textContent === 'from GND'), 'and says who it came from');

  // Something else changes and the Strip is rebuilt: no replay.
  const second = r.sandbox._buildStripEl(strip);
  assert.ok(second.classList.contains('efsp-strip-arrived'), 'still marked new');
  assert.equal(second.classList.contains('efsp-strip-arrived-flash'), false, 'the flash played again on an unrelated rebuild');

  // The controller touches it: noticed.
  fire(second, 'pointerdown', { target: second, currentTarget: second, button: 0, pointerType: 'mouse' });
  assert.equal(second.classList.contains('efsp-strip-arrived'), false);
  assert.equal(r.sandbox.efspArrivalFor('s1'), null);
});

test('an arrival is part of the render signature, so it appears (and clears) without the Strip\'s rev moving', () => {
  const strip = stripAt({ ownerPositionId: 'TWR', bayId: 'twr-runway-queue', updatedBy: 'c-gnd' });
  const { sandbox, el } = renderStrip({ strip, fdr: FDR, held: ['TWR'] });
  assert.equal(sandbox._stripElNeedsRebuild(el, strip, null, null), false);
  sandbox.noteEfspArrivals(new Map([['s1', { bayId: 'gnd-taxi-out', ownerPositionId: 'GND' }]]), [strip],
    { heldPositions: ['TWR'], myControllerIds: [], visibleBayId: 'twr-runway-queue', now: Date.now() });
  assert.equal(sandbox._stripElNeedsRebuild(el, strip, null, null), true);
});

// ── §9.4 MTR fields on the Strip (crc-sync's docs/adr/0062) ──────────────────
//
// Fixtures built here rather than in the shared FDR above: the MTR group is
// drawn only when the flight has MTR data, so most tests must keep seeing a
// flight without it.

const MTR_IDS = ['9G-MTR', '9G-ENTRY', '9G-TIME', '9H-EXIT', '9H-TIME', '9H-ALT'];
const mtrFdrWith = (mtr, extra = {}) => ({ ...FDR, military: { ...FDR.military, mtr }, ...extra });
const inFields = (el, blockId) => {
  const grid = descendants(el).find(c => (c.className || '').split(/\s+/).includes('efsp-strip-fields'));
  return !!grid && descendants(grid).some(c => c.dataset && c.dataset.block === blockId);
};
function expandedWith(strip, fdr, held) {
  const r = renderStrip({ strip, fdr, held });
  r.sandbox.renderAllOpenEfspBays = () => {};
  click(descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn')));
  return { ...r, expandedEl: r.sandbox._buildStripEl(strip) };
}

test('an APP ARRIVAL with an exit fix shows the M11 group as fields; without MTR data, none of them — all six in ▼', () => {
  const strip = stripAt({ role: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'APP' });
  const withMtr = renderStrip({ strip, fdr: mtrFdrWith({ exitFix: 'E' }), held: ['APP'] });
  for (const id of ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT']) assert.ok(inFields(withMtr.el, id), `${id} is not a field`);
  for (const id of ['9G-ENTRY', '9G-TIME']) assert.equal(inFields(withMtr.el, id), false, `${id}: entry is history on an arrival`);

  const { el, expandedEl } = expandedWith(strip, mtrFdrWith({}), ['APP']);
  for (const id of MTR_IDS) assert.equal(inFields(el, id), false, `${id} drawn on a flight with no MTR`);
  const rows = descendants(expandedEl).filter(c => c.dataset && c.dataset.expandedBlock).map(c => c.dataset.expandedBlock);
  for (const id of MTR_IDS) assert.ok(rows.includes(id), `${id} is not in the expanded view`);
});

test('with MTR data, the expanded view still shows exactly what the face does not, in Block Map order', () => {
  // Proves bay-view.js's _expandedBlockIdsFor got the FDR too: had only the
  // face learned about the MTR group, its Blocks would be on both.
  const fdr = mtrFdrWith({ designator: 'IR107' });
  for (const [role, positionId, state] of [['DEPARTURE', 'CTR', 'HANDED_OFF'], ['ARRIVAL', 'APP', 'INBOUND'], ['OVERFLIGHT', 'CTR', 'TRANSITING'], ['DEPARTURE', 'OPS', 'PROPOSED']]) {
    const strip = stripAt({ role, state, ownerPositionId: positionId });
    const { expandedEl, sandbox } = expandedWith(strip, fdr, [positionId]);
    const compact = Array.from(sandbox.compactBlocksFor(role, positionId, fdr));
    const expanded = descendants(expandedEl).filter(c => c.dataset && c.dataset.expandedBlock).map(c => c.dataset.expandedBlock);
    assert.ok(compact.includes('9G-MTR'), `${role} at ${positionId}: the MTR group is not on the face`);
    assert.deepEqual(expanded, Object.keys(BLOCK_MAPS[role]).filter(id => !compact.includes(id)), `${role} at ${positionId}`);
  }
});

test('the MTR times render as HHMM and edit through the ordinary click-to-edit cell', () => {
  const strip = stripAt({ role: 'OVERFLIGHT', state: 'TRANSITING', ownerPositionId: 'CTR' });
  const fdr = mtrFdrWith({ designator: 'IR107', exitEstimateUtc: Date.UTC(2016, 5, 21, 14, 32) });
  const { el, sent } = renderStrip({ strip, fdr, held: ['CTR'] });
  assert.equal(blockCell(el, '9H-TIME').textContent, '1432');

  click(blockCell(el, '9H-EXIT'));
  const input = openInputs(el)[0];
  assert.ok(input, '9H-EXIT opened no editor');
  input.value = 'E';
  fire(input, 'keydown', { key: 'Enter' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.kind, 'SetBlock');
  assert.equal(sent[0].op.blockId, '9H-EXIT');
  assert.equal(sent[0].op.value, 'E');
});

test('the lost-comms advisory is a grey note in ▼ only — no reason line, no indicator on the face', () => {
  const clearance = { altitude: { entries: [{ value: 'FL180', status: 'ACTIVE', at: 1, by: null }] }, heading: { entries: [] } };
  const strip = stripAt({ role: 'OVERFLIGHT', state: 'TRANSITING', ownerPositionId: 'CTR' });
  const cls = (c) => (c.className || '').split(/\s+/);

  const quiet = renderStrip({ strip, fdr: mtrFdrWith({}, { clearance }), held: ['CTR'] }).el;
  const withMtr = expandedWith(strip, mtrFdrWith({ exitFix: 'F', requestedAltitudeAfterExit: 'FL230' }, { clearance }), ['CTR']);
  const count = (el, c) => descendants(el).filter(n => cls(n).includes(c)).length;
  assert.equal(count(withMtr.el, 'efsp-strip-reason'), count(quiet, 'efsp-strip-reason'), 'MTR data added a reason line to the face');
  assert.equal(count(withMtr.el, 'efsp-ind'), count(quiet, 'efsp-ind'), 'MTR data added an indicator');
  assert.equal(count(withMtr.el, 'efsp-mtr-lostcomms'), 0, 'the advisory is on the collapsed face');

  const note = descendants(withMtr.expandedEl).find(n => cls(n).includes('efsp-mtr-lostcomms'));
  assert.ok(note, 'no lost-comms note in the expanded view');
  assert.equal(cls(note).includes('efsp-strip-reason'), false);
  assert.match(note.textContent, /FL180/);
  assert.match(note.textContent, /not available in this system/);
  assert.doesNotMatch(note.textContent, /FL230/, 'the pilot\'s request is not the last clearance');

  const none = expandedWith(strip, mtrFdrWith({}, { clearance }), ['CTR']).expandedEl;
  assert.equal(count(none, 'efsp-mtr-lostcomms'), 0, 'a flight with no MTR gets no advisory');
});

test('EXIT ALT\'s label carries the lost-comms rule as its hover title', () => {
  const strip = stripAt({ role: 'OVERFLIGHT', state: 'TRANSITING', ownerPositionId: 'CTR' });
  const { el } = renderStrip({ strip, fdr: mtrFdrWith({ designator: 'IR107' }), held: ['CTR'] });
  const chip = descendants(el).find(c => c.children && c.children.some(k => k.dataset && k.dataset.block === '9H-ALT'));
  const label = chip.children.find(k => (k.className || '').includes('efsp-block-label'));
  assert.match(label.title, /Lost comms \(§9\.4\)/);
});

test('an MTR write reaches the Strip through the FDR\'s rev — the group appears without the Strip\'s rev moving', () => {
  const strip = stripAt({ role: 'OVERFLIGHT', state: 'TRANSITING', ownerPositionId: 'CTR' });
  const { sandbox, el } = renderStrip({ strip, fdr: FDR, held: ['CTR'] });
  assert.equal(sandbox._stripElNeedsRebuild(el, strip, null, null), false);
  sandbox.applyEfspDelta({ fdrs: { updated: [mtrFdrWith({ exitFix: 'E' }, { rev: 2 })] } });
  assert.equal(sandbox._stripElNeedsRebuild(el, strip, null, null), true);
  assert.ok(inFields(sandbox._buildStripEl(strip), '9H-EXIT'));
});

// ── Block 9F's picker and §10.5's times on a rendered Strip (docs/adr/0073) ─

/** Fills the sandbox's stereo cache the way efsp-panel.js's snapshot re-fetch does. */
async function withStereoRoutes(sandbox, routes) {
  const res = { ok: true, json: async () => ({ ok: true, routes }) };
  await sandbox.listStereoRoutesClient({ fetchImpl: async () => res, authHeaders: () => ({}) });
}
const PACKS = [{ name: 'PACK 1', route: 'LTAG DCT A' }, { name: 'PACK 2', route: 'LTAG DCT B' }];

test('9F is a select of the configured stereo routes, never free text', async () => {
  const strip = stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' });
  const r = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  await withStereoRoutes(r.sandbox, PACKS);
  const el = r.sandbox._buildStripEl(strip);
  const select = openEnum(el, '9F');
  assert.deepEqual(select.children.map(o => o.value), ['', 'PACK 1', 'PACK 2']);
  assert.equal(openInputs(el).length, 0, 'a free-text input opened as well');

  // Arrowing is looking (F-205).
  fire(select, 'keydown', { key: 'ArrowDown' });
  select.value = 'PACK 1';
  fire(select, 'change');
  assert.equal(r.sent.length, 0, 'an arrow key re-filed the flight');
  // A pick sends exactly one SetBlock with the canonical name.
  fire(select, 'keydown', { key: 'Enter' });
  assert.equal(r.sent.length, 1);
  assert.deepEqual({ ...r.sent[0].op }, { kind: 'SetBlock', blockId: '9F', value: 'PACK 1' });
});

test('9F: "—" cancels the stereo by sending \'\', and a retired route stays shown and selected (T2, T3)', async () => {
  const strip = stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' });
  const fdr = { ...FDR, filed: { stereoRouteName: 'PACK 9', route: 'LTAG DCT OLD' } };
  const r = renderStrip({ strip, fdr, held: ['OPS'] });
  await withStereoRoutes(r.sandbox, PACKS);
  const el = r.sandbox._buildStripEl(strip);
  const select = openEnum(el, '9F');
  assert.deepEqual(select.children.map(o => o.value), ['', 'PACK 1', 'PACK 2', 'PACK 9']);
  assert.equal(select.value, 'PACK 9');
  select.value = '';
  fire(select, 'change');
  assert.equal(r.sent.length, 1);
  assert.deepEqual({ ...r.sent[0].op }, { kind: 'SetBlock', blockId: '9F', value: '' }, 'never a write to Block 9');
});

test('9F with no route table is a plain cell with a reason, not a control that cannot act (T1)', () => {
  const strip = stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' });
  const { el } = renderStrip({ strip, fdr: FDR, held: ['OPS'] });
  const cell = blockCell(el, '9F');
  assert.ok(cell, '9F is not on the OPS Strip');
  assert.equal(cell.classList.contains('efsp-block-editable'), false);
  assert.equal(cell.title, 'no stereo routes configured');
  click(cell);
  assert.equal(openInputs(el).length, 0);
  assert.equal(descendants(el).some(c => c.tagName === 'select'), false);
});

test('every writable DEPARTURE Block is reachable with a stereo table too — 9F included', async () => {
  for (const positionId of positionsFor('DEPARTURE')) {
    const strip = stripAt({ state: 'PROPOSED', ownerPositionId: positionId });
    const r = renderStrip({ strip, fdr: FDR, held: [positionId] });
    await withStereoRoutes(r.sandbox, PACKS);
    assert.ok(r.sandbox.enumSelectOptionsFor('9F', FDR), 'precondition: a table is cached');
    const compact = r.sandbox.compactBlocksFor('DEPARTURE', positionId);
    r.sandbox.renderAllOpenEfspBays = () => {};
    click(descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn')));
    const expanded = descendants(r.sandbox._buildStripEl(strip)).filter(c => c.dataset && c.dataset.expandedBlock).map(c => c.dataset.expandedBlock);
    assert.ok(compact.includes('9F') || expanded.includes('9F'), `9F unreachable at ${positionId}`);
    // Collapse again so the next Position's render starts closed.
    click(descendants(r.sandbox._buildStripEl(strip)).find(c => (c.className || '').includes('efsp-expanded-collapse')));
  }
});

test('§10.5: departure, off-block and takeoff time each follow an explicit ordered fallback, and the chosen source is visible on hover', () => {
  const Z = (hh, mm) => Date.UTC(2016, 5, 21, hh, mm);
  const strip = stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' });
  const fdr = { ...FDR, filed: {}, assigned: {}, ato: { departure: { timeUtc: Z(13, 10) } } };
  const r = renderStrip({ strip, fdr, held: ['OPS'] });

  // P-time on the OPS face: the ATO's time, not italic, the source on the value.
  const p = blockCell(r.el, '6');
  assert.equal(p.textContent, '1310');
  assert.equal(p.classList.contains('efsp-block-estimated'), false);
  assert.match(p.title, /from the ATO/);

  // TAXI and TAKEOFF live in ▼: italic estimates, with the source on the
  // value AND on the row's label.
  r.sandbox.renderAllOpenEfspBays = () => {};
  click(descendants(r.el).find(c => (c.className || '').includes('efsp-expand-btn')));
  const expanded = r.sandbox._buildStripEl(strip);
  const row = (id) => descendants(expanded).find(c => c.dataset && c.dataset.expandedBlock === id);
  for (const id of ['17', '18']) {
    const cell = descendants(row(id)).find(c => c.dataset && c.dataset.block === id);
    assert.equal(cell.textContent, '1310', id);
    assert.equal(cell.classList.contains('efsp-block-estimated'), true, `${id} is an estimate and is not marked`);
    const label = descendants(row(id)).find(c => (c.className || '').includes('efsp-expanded-label'));
    assert.match(label.title, /estimate/, `${id}'s label has no source`);
  }
  assert.match(descendants(row('17')).find(c => c.dataset && c.dataset.block === '17').title, /~1310Z estimate: P-time, from the ATO/);

  // Typing TAKEOFF 1402 (the server stores it as epoch ms): no italics, and the hover says who.
  r.sandbox.applyEfspDelta({ fdrs: { updated: [{ ...fdr, rev: 2, assigned: { takeoffTimeUtc: Z(14, 2) }, provenance: { 'assigned.takeoffTimeUtc': 'CONTROLLER_ENTERED' } }] } });
  const typed = descendants(r.sandbox._buildStripEl(strip)).find(c => c.dataset && c.dataset.block === '18');
  assert.equal(typed.textContent, '1402');
  assert.equal(typed.classList.contains('efsp-block-estimated'), false);
  assert.match(typed.title, /entered by a controller/);

  // Cleared: the estimate is back.
  r.sandbox.applyEfspDelta({ fdrs: { updated: [{ ...fdr, rev: 3, assigned: { takeoffTimeUtc: null } }] } });
  const cleared = descendants(r.sandbox._buildStripEl(strip)).find(c => c.dataset && c.dataset.block === '18');
  assert.equal(cleared.textContent, '1310');
  assert.equal(cleared.classList.contains('efsp-block-estimated'), true);
});

test('a refusal title on a time Block is not overwritten by its source', () => {
  const strip = stripAt({ state: 'PROPOSED', ownerPositionId: 'OPS' });
  const refusal = { stripId: 's1', blockId: '6', message: 'proposed departure time must be a UTC time as HHMM, e.g. 1432' };
  const { el } = renderStrip({ strip, fdr: { ...FDR, ato: { departure: { timeUtc: 1 } } }, held: ['OPS'], refusal });
  assert.equal(blockCell(el, '6').title, refusal.message);
});
