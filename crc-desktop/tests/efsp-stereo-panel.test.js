'use strict';

/* The reachability half of §9.10 stereo routes (docs/adr/0050) — a green
   sortie in crc-sync proves the server does the right thing and says
   nothing about whether a controller can ask for it.
   efsp-scenario-stereo.test.mjs is the server half; this is the other one.

   efsp-ui-reachability.test.js's own harness renders a STRIP, with
   `document.getElementById: () => null`, so it cannot reach the toolbar at
   all. This needs a getElementById backed by real stub elements. The
   makeElement stub below is a trimmed copy of that file's — lifting the
   shared one into tests/helpers/ is the obvious follow-up, and there is no
   tests/helpers/ directory in this package yet to lift it into. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require("vm");

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');

const ROUTES = [
  { name: 'PACK 1', description: 'north MOA', route: 'LTAG DCT ALPHA', requestedAltitude: '250' },
  { name: 'PACK 2', route: 'LTAG DCT BRAVO' },
];

function makeElement(tag) {
  return {
    tagName: tag, className: '', textContent: '', value: '', disabled: false, hidden: false,
    children: [], dataset: {}, style: {}, _listeners: {},
    classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); }, toggle() {} },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {},
    set innerHTML(v) { if (v === '') this.children = []; },
    get innerHTML() { return ''; },
  };
}

/**
 * Loads the real efsp-panel.js against a stubbed toolbar and returns handles
 * to the elements plus whatever CreateStrip it would have sent.
 *
 * `stereoRoutes` is what the (injected) client fetch resolves to, so the
 * empty-table case — which is the SHIPPED case — is just `[]`.
 */
function mountPanel({ held = ['OPS'], stereoRoutes = ROUTES, lookupSpy = null, liveStrips = [] } = {}) {
  const sent = [];
  const els = {};
  for (const id of ['efsp-panel', 'efsp-position-tabs', 'efsp-bay-tabs', 'efsp-bay-content',
    'efsp-new-strip-callsign', 'efsp-create-strip-btn', 'efsp-create-strip-msg',
    'efsp-create-strip-role', 'efsp-create-strip-stereo', 'efsp-dot-command-input',
    'efsp-dot-command-preview', 'efsp-mutation-error', 'efsp-mutation-warning',
    'efsp-connection-banner']) {
    els[id] = makeElement(id.endsWith('-btn') ? 'button' : id.includes('select') ? 'select' : 'input');
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
    'bay-view.js', 'efsp-stereo-routes.js', 'efsp-panel.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }

  sandbox.getActingPositions = () => held;
  // §3.6's duplicate-origination guard reads this; `liveStrips` lets a test
  // say "this callsign is already working somewhere".
  sandbox.liveStripsForCallsign = () => liveStrips;
  sandbox.sendEfspCreateStrip = (actingPositionId, op, facilityId) => { sent.push({ actingPositionId, op, facilityId }); return 'mid'; };
  sandbox.sendEfspMutation = () => 'mid';
  sandbox.updateMap = () => {};
  // The DD1801 lookup, so a test can assert it was NOT consulted.
  sandbox.lookupFlightPlanClient = lookupSpy || (async () => ({ found: false }));
  // Stand in for the fetch, resolved synchronously-enough that initEfspPanel's
  // fire-and-forget .then() has landed before the test acts (awaited below).
  let fetches = 0;
  sandbox.listStereoRoutesClient = async () => { fetches += 1; return currentRoutes; };

  let currentRoutes = stereoRoutes;

  sandbox.applyEfspSnapshot({ strips: [], fdrs: [], positions: [], bays: [], airspaces: [], correlations: [] });
  sandbox.initEfspPanel();
  return {
    els, sent, sandbox,
    fetchCount: () => fetches,
    setServerRoutes: (next) => { currentRoutes = next; },
  };
}

/** Lets the fire-and-forget fetch in _loadStereoRoutes() land. */
function mounted0(m) {
  return new Promise(resolve => setImmediate(() => resolve(m)));
}

/** The panel, after _loadStereoRoutes()'s fire-and-forget fetch has landed. */
function mounted(opts) {
  return mounted0(mountPanel(opts));
}

// ── the picker ───────────────────────────────────────────────────────────

test('with no table installed the toolbar is unchanged — the stereo picker never appears', async () => {
  // The SHIPPED state: config/efsp-stereo-routes.json is empty, and there
  // is no editor. A squadron that has not written a table must not be shown
  // an empty dropdown to puzzle over.
  const { els } = await mounted({ stereoRoutes: [] });
  assert.equal(els['efsp-create-strip-stereo'].hidden, true);
});

test('with a table installed the picker appears, blank-first, one option per route', async () => {
  const { els } = await mounted();
  const select = els['efsp-create-strip-stereo'];
  assert.equal(select.hidden, false);
  assert.deepEqual(select.children.map(o => o.value), ['', 'PACK 1', 'PACK 2']);
  // The description rides along where there is one — a bare "PACK 2" in a
  // list of eight is not a choice anybody can make.
  assert.equal(select.children[1].textContent, 'PACK 1 — north MOA');
  assert.equal(select.children[2].textContent, 'PACK 2');
});

test('the picker is hidden for an origin that cannot use a canned route', async () => {
  // CTR originates ARRIVAL Strips, whose filed shape is originAirport/
  // arrivalFix/estimatedArrivalTimeUtc — nothing a departure route seeds.
  const { els } = await mounted({ held: ['CTR'] });
  assert.equal(els['efsp-create-strip-stereo'].hidden, true);
});

// ── filing from the toolbar ──────────────────────────────────────────────

test('picking a stereo and pressing New Strip files by short name', async () => {
  const { els, sent } = await mounted();
  els['efsp-new-strip-callsign'].value = 'PACK11';
  els['efsp-create-strip-stereo'].value = 'PACK 1';
  for (const fn of els['efsp-create-strip-btn']._listeners.click) await fn({});

  assert.equal(sent.length, 1);
  assert.equal(sent[0].op.kind, 'CreateStrip');
  assert.equal(sent[0].op.fdr.callsign, 'PACK11');
  assert.equal(sent[0].op.fdr.stereoRouteName, 'PACK 1');
  // Route/altitude/airports are ABSENT, not blank — an empty string would
  // count as an explicit value server-side and beat the table's expansion.
  for (const key of ['route', 'requestedAltitude', 'departureAirport', 'destinationAirport']) {
    assert.equal(key in sent[0].op.fdr, false, `${key} should be left to the server`);
  }
});

test('a picked stereo skips the DD1801 lookup entirely rather than racing it', async () => {
  let lookups = 0;
  const { els, sent } = await mounted({ lookupSpy: async () => { lookups += 1; return { found: false }; } });
  els['efsp-new-strip-callsign'].value = 'PACK11';
  els['efsp-create-strip-stereo'].value = 'PACK 1';
  for (const fn of els['efsp-create-strip-btn']._listeners.click) await fn({});
  assert.equal(lookups, 0, 'the flight-plan lookup should not have been consulted');
  assert.equal(sent.length, 1);
});

test('with no stereo picked, the existing flight-plan pre-fill path is untouched', async () => {
  let lookups = 0;
  const { els, sent } = await mounted({
    lookupSpy: async () => { lookups += 1; return { found: true, seed: { route: 'DCT', requestedAltitude: '250' } }; },
  });
  els['efsp-new-strip-callsign'].value = 'VIPER1';
  els['efsp-create-strip-stereo'].value = '';
  for (const fn of els['efsp-create-strip-btn']._listeners.click) await fn({});
  assert.equal(lookups, 1);
  assert.equal(sent[0].op.fdr.route, 'DCT');
  assert.equal(sent[0].op.fdr.stereoRouteName, undefined);
});

test('the picker resets after a filing, so the next Strip is not silently on the same route', async () => {
  const { els } = await mounted();
  els['efsp-new-strip-callsign'].value = 'PACK11';
  els['efsp-create-strip-stereo'].value = 'PACK 1';
  for (const fn of els['efsp-create-strip-btn']._listeners.click) await fn({});
  assert.equal(els['efsp-create-strip-stereo'].value, '');
});

// ── .stereo ──────────────────────────────────────────────────────────────

async function runDotCommand(m, line) {
  m.els['efsp-dot-command-input'].value = line;
  for (const fn of m.els['efsp-dot-command-input']._listeners.keydown) await fn({ key: 'Enter' });
}

test('.stereo PACK1 VIPER11 files a Strip, resolving the name the controller actually typed', async () => {
  const m = await mounted();
  await runDotCommand(m, '.stereo pack1 VIPER11');
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].op.fdr.callsign, 'VIPER11');
  // The canonical spelling goes over the wire, not `pack1`.
  assert.equal(m.sent[0].op.fdr.stereoRouteName, 'PACK 1');
  // Byte-identical to what the button sends for the same origin, including
  // OPS's `role: undefined` (board-store.js defaults an absent role to
  // DEPARTURE). Two filing surfaces, one op — worth pinning, because the
  // easy mistake here is for the keyboard path to drift into sending
  // something subtly different from the pointer path.
  assert.equal(m.sent[0].op.role, undefined);
  assert.equal(m.sent[0].actingPositionId, 'OPS');
  assert.equal(m.sent[0].op.bayId, 'ops-proposed');
  assert.equal(m.sent[0].facilityId, 'INCIRLIK');
});

test('.stereo with an unknown route name says so in the preview and sends nothing', async () => {
  const m = await mounted();
  await runDotCommand(m, '.stereo PACK9 VIPER11');
  assert.equal(m.sent.length, 0);
  assert.match(m.els['efsp-dot-command-preview'].textContent, /PACK9 is not a configured stereo route/);
});

test('.stereo with a missing callsign explains the form instead of guessing one', async () => {
  const m = await mounted();
  await runDotCommand(m, '.stereo PACK1');
  assert.equal(m.sent.length, 0);
  assert.match(m.els['efsp-dot-command-preview'].textContent, /needs a route name and a callsign/);
});

test('.stereo refuses a malformed callsign client-side, same rule the button applies', async () => {
  const m = await mounted();
  await runDotCommand(m, '.stereo PACK1 TOOLONGCS');
  assert.equal(m.sent.length, 0);
  assert.match(m.els['efsp-dot-command-preview'].textContent, /not a valid callsign/);
});

test('.stereo refuses when the held Position cannot originate a DEPARTURE Strip', async () => {
  const m = await mounted({ held: ['CTR'] });
  await runDotCommand(m, '.stereo PACK1 VIPER11');
  assert.equal(m.sent.length, 0);
  assert.match(m.els['efsp-dot-command-preview'].textContent, /DEPARTURE/);
});

test('.stereo refuses when no origin Position is held at all', async () => {
  const m = await mounted({ held: [] });
  await runDotCommand(m, '.stereo PACK1 VIPER11');
  assert.equal(m.sent.length, 0);
  assert.match(m.els['efsp-dot-command-preview'].textContent, /OPS, APP or CTR only/);
});

test('every other dot-command verb still works — .stereo did not shadow the selection guard', async () => {
  // .stereo returns early, above the selected-Strip guard, exactly as .find
  // does. A regression here would look like .drop/.undo silently doing
  // nothing, which is the failure mode this whole file exists to catch.
  const m = await mounted();
  await runDotCommand(m, '.find VIPER');
  await runDotCommand(m, '.drop no strip selected');
  assert.equal(m.sent.length, 0); // nothing selected, so nothing dispatched — and no throw
});

// ── the two defects the scenario walk turned up ──────────────────────────

test('.stereo honours §3.6\'s duplicate-origination guard — it used to skip it', () => {
  // The original justification was that typing a verb, a route name and a
  // callsign is explicit enough. Wrong: the guard is not about how
  // deliberate the request was, it is about a replica already live at
  // another Facility that should be ACCEPTed, not re-originated.
  const m = mountPanel({ liveStrips: [{ facilityId: 'CENTER', ownerPositionId: 'CTR' }] });
  return mounted0(m).then(async () => {
    await runDotCommand(m, '.stereo PACK1 VIPER11');
    assert.equal(m.sent.length, 0, 'the first attempt warns instead of creating');
    assert.match(m.els['efsp-dot-command-preview'].textContent, /already has a live Strip at CENTER\/CTR/);

    // Repeating the command confirms, the same way a second button press does.
    await runDotCommand(m, '.stereo PACK1 VIPER11');
    assert.equal(m.sent.length, 1);
  });
});

test('the duplicate latch is shared with the button — confirming on one surface confirms on both', () => {
  const m = mountPanel({ liveStrips: [{ facilityId: 'INCIRLIK', ownerPositionId: 'OPS' }] });
  return mounted0(m).then(async () => {
    await runDotCommand(m, '.stereo PACK1 VIPER11');   // warns, latches VIPER11
    assert.equal(m.sent.length, 0);
    m.els['efsp-new-strip-callsign'].value = 'VIPER11';
    m.els['efsp-create-strip-stereo'].value = 'PACK 1';
    for (const fn of m.els['efsp-create-strip-btn']._listeners.click) await fn({});
    assert.equal(m.sent.length, 1, 'the button honours the warning the dot-command already gave');
  });
});

test('a fresh snapshot refetches the route table — a crc-sync restart is the only way it changes', async () => {
  // Fetched once at panel init, the picker went stale after a squadron edited
  // the table and restarted the service, and stayed stale until the whole app
  // was reloaded. A snapshot is exactly the "the server may have restarted"
  // signal, so it is the right trigger.
  const m = await mounted();
  assert.equal(m.fetchCount(), 1);
  assert.deepEqual(m.els['efsp-create-strip-stereo'].children.map(o => o.value), ['', 'PACK 1', 'PACK 2']);

  m.setServerRoutes([{ name: 'PACK 3', route: 'LTAG DCT CHARLIE' }]);
  m.sandbox.reloadEfspStereoRoutes();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(m.fetchCount(), 2);
  assert.deepEqual(m.els['efsp-create-strip-stereo'].children.map(o => o.value), ['', 'PACK 3']);
});

test('a burst of snapshots does not stack fetches — the in-flight latch holds', async () => {
  const m = await mounted();
  for (let i = 0; i < 5; i += 1) m.sandbox.reloadEfspStereoRoutes();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(m.fetchCount(), 2, 'one init fetch plus one for the burst');
});
