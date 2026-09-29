'use strict';

/* What a refusal says, and who it says it about.
 *
 * docs/ui-findings F-103: "#efsp-mutation-error reads 'NLA_INHIBITED: no
 * receiving Position present'; contains 'BBB22'? no" — one shared banner,
 * every rejection of every op on every Strip through it, none of them
 * attributable, and a raw machine code as the sentence.
 * docs/ui-findings F-207: a refused Block edit closes its input before the
 * server replies, so the typed value exists nowhere on screen afterwards.
 *
 * Mounts the real efsp-panel.js against the shared DOM stub, the way
 * efsp-mission-line-panel.test.js does — the banner is panel chrome, so
 * efsp-ui-reachability's Strip-rendering harness cannot reach it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { makeElement } = require('./helpers/dom-stub.js');

function unrefTimeout(fn, ms, ...args) {
  const t = setTimeout(fn, ms, ...args);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}
const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');

const TOOLBAR_IDS = [
  'efsp-panel', 'efsp-position-tabs', 'efsp-bay-tabs', 'efsp-bay-content',
  'efsp-new-strip-callsign', 'efsp-create-strip-btn', 'efsp-create-strip-msg',
  'efsp-create-strip-role', 'efsp-create-strip-stereo', 'efsp-create-strip-bind',
  'efsp-dot-command-input', 'efsp-dot-command-preview',
  'efsp-mutation-error', 'efsp-mutation-warning', 'efsp-connection-banner',
];

function fdrFor(fdrId, callsign) {
  return {
    fdrId, rev: 1, provenance: {},
    identity: { callsign, beaconAssigned: '0001', trackDegradationFlag: 'NONE' },
    filed: {}, assigned: {}, tofi: {}, airspace: {}, comms: {},
    military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr: {} },
  };
}

function stripFor(stripId, fdrId, overrides = {}) {
  return {
    stripId, cid: '001', fdrId, rev: 3, role: 'DEPARTURE', state: 'PROPOSED',
    ownerPositionId: 'OPS', facilityId: 'INCIRLIK', bayId: 'ops-proposed', rackId: 'main', orderKey: 'V',
    annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
    correlation: { state: 'UNCORRELATED' }, coordination: null, tofiCoordination: null, airspaceEntry: null,
    ...overrides,
  };
}

const BOARD = {
  strips: [stripFor('sA', 'fA'), stripFor('sB', 'fB')],
  fdrs: [fdrFor('fA', 'AAA11'), fdrFor('fB', 'BBB22')],
};

function mountPanel() {
  const els = {};
  for (const id of TOOLBAR_IDS) els[id] = makeElement(id.endsWith('-btn') ? 'button' : 'input');

  const sandbox = {
    // Unref'd, so a panel timer — the refusal banner's 30 s auto-clear above
    // all — never holds the test process open until it fires. That one timer
    // kept `npm test` (and so `npm run dev-check`) waiting 30 s after the last
    // assertion had passed.
    console, module: { exports: {} }, setTimeout: unrefTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
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

  let rerenders = 0;
  sandbox.getActingPositions = () => ['OPS'];
  sandbox.renderAllOpenEfspBays = () => { rerenders += 1; };
  sandbox.updateMap = () => {};
  sandbox.listStereoRoutesClient = async () => [];
  sandbox.applyEfspSnapshot({ ...BOARD, positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  sandbox.initEfspPanel();
  // `const` at the top level of a vm script lands in the context's lexical
  // scope, not on the sandbox object — the module-level constants are read
  // by evaluating their names in the context rather than off `sandbox`.
  const evalIn = expr => vm.runInContext(expr, sandbox);
  return { els, sandbox, evalIn, banner: els['efsp-mutation-error'], rerenders: () => rerenders };
}

const settled = (m) => new Promise(resolve => setImmediate(() => resolve(m)));

/** Sends `op` against `stripId` the way efsp-ws.js does, then acks it as refused. */
function refuse(sandbox, { stripId, op, reason, detail }) {
  const clientMutationId = 'cm-1';
  sandbox.registerPendingMutation({
    version: 1, type: 'efsp-mutation', clientMutationId,
    facilityId: 'INCIRLIK', actingPositionId: 'OPS', stripId, baseRev: 3, op,
  });
  const result = sandbox.applyEfspMutationAck({
    clientMutationId, ok: false, reason, detail,
    strip: stripId ? sandbox.getEfspStrip(stripId) : undefined,
  });
  sandbox.notifyEfspMutationAck(clientMutationId, result);
  return result;
}

// ── F-103: attribution ───────────────────────────────────────────────────

test('a refused op names the Strip it refused, by callsign', async () => {
  const { sandbox, banner } = await settled(mountPanel());
  refuse(sandbox, {
    stripId: 'sB', op: { kind: 'InvokeNla' },
    reason: 'NLA_INHIBITED', detail: 'no receiving Position present',
  });
  // Measured before the fix: "NLA_INHIBITED: no receiving Position present",
  // with AAA11 and BBB22 both on screen and nothing saying which.
  assert.match(banner.textContent, /BBB22/);
  assert.doesNotMatch(banner.textContent, /AAA11/);
  assert.match(banner.textContent, /no receiving Position present/);
});

test('a refused CreateStrip names the callsign from the request — there is no Strip yet', async () => {
  const { sandbox, banner } = await settled(mountPanel());
  const clientMutationId = 'cm-create';
  sandbox.registerPendingMutation({
    version: 1, type: 'efsp-mutation', clientMutationId, facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr: { callsign: 'NEW777' } },
  });
  sandbox.notifyEfspMutationAck(clientMutationId, sandbox.applyEfspMutationAck({
    clientMutationId, ok: false, reason: 'VALIDATION_ERROR', detail: 'beacon code pool exhausted',
  }));
  assert.match(banner.textContent, /NEW777/);
});

test('an ack whose request is unknown still says something, rather than nothing', async () => {
  // The banner exists because a refusal with no other surface would otherwise
  // be indistinguishable from the control not registering at all. A replayed
  // or duplicated ack must not cost it that property.
  const { sandbox, banner } = await settled(mountPanel());
  sandbox.notifyEfspMutationAck('never-sent', sandbox.applyEfspMutationAck({
    clientMutationId: 'never-sent', ok: false, reason: 'STALE_REV',
  }));
  assert.match(banner.textContent, /changed this Strip/);
});

// ── F-103: reason wording ────────────────────────────────────────────────

test('STALE_REV says somebody else changed the Strip, and keeps the code greppable', async () => {
  const { sandbox, banner } = await settled(mountPanel());
  refuse(sandbox, { stripId: 'sA', op: { kind: 'SetBlock', blockId: '7' }, reason: 'STALE_REV' });
  assert.match(banner.textContent, /AAA11/);
  assert.match(banner.textContent, /Somebody else changed this Strip while you were working on it/);
  assert.doesNotMatch(banner.textContent, /STALE_REV/, 'the raw code is not what a controller reads first');
  // But it is still there for whoever is grepping crc-sync's src/efsp/.
  assert.match(banner.title, /STALE_REV/);
  assert.equal(banner.dataset.reason, 'STALE_REV');
  assert.equal(banner.dataset.stripId, 'sA');
});

test("VALIDATION_ERROR's detail is the sentence — no canned prefix talking over it", async () => {
  const { sandbox, banner } = await settled(mountPanel());
  refuse(sandbox, {
    stripId: 'sA', op: { kind: 'SetBlock', blockId: '9F', value: 'NOSUCH' },
    reason: 'VALIDATION_ERROR', detail: 'NOSUCH is not a configured stereo route',
  });
  assert.match(banner.textContent, /NOSUCH is not a configured stereo route/);
  assert.doesNotMatch(banner.textContent, /VALIDATION_ERROR/);
});

test('every reason code crc-sync can reject with has a plain sentence, and an unknown one still renders', async () => {
  const { sandbox, banner, evalIn } = await settled(mountPanel());
  const messages = evalIn('MUTATION_ERROR_MESSAGES');
  // Enumerated from `ok: false, reason:` across crc-sync/src/efsp/.
  for (const code of ['VALIDATION_ERROR', 'NOT_FOUND', 'PERMISSION_DENIED', 'STALE_REV',
    'NOT_HOLDING_POSITION', 'NLA_INHIBITED', 'NOT_OCCUPIED', 'NOT_OBSERVER', 'NOT_OWNER',
    'NO_RECEIVING_POSITION', 'ALREADY_PRIMARY']) {
    assert.ok(Object.prototype.hasOwnProperty.call(messages, code), `${code} has no mapping`);
  }
  // A code this client has never heard of is not swallowed.
  refuse(sandbox, { stripId: 'sA', op: { kind: 'DropStrip' }, reason: 'SOMETHING_NEW' });
  assert.match(banner.textContent, /SOMETHING_NEW/);
});

// ── F-207: the typed value survives the refusal ──────────────────────────

test('a refused Block edit carries the Block and the value that was typed', async () => {
  const { sandbox, banner } = await settled(mountPanel());
  refuse(sandbox, {
    stripId: 'sA', op: { kind: 'SetBlock', blockId: '9F', value: 'NOSUCH' },
    reason: 'VALIDATION_ERROR', detail: 'NOSUCH is not a configured stereo route',
  });
  // The input closed on Enter before the reply, and the Block reverted — this
  // banner is the only place NOSUCH still exists.
  assert.match(banner.textContent, /AAA11/);
  assert.match(banner.textContent, /STEREO/, 'named by its Block label, not "9F"');
  assert.match(banner.textContent, /NOSUCH/);
  const refusal = sandbox.getCurrentEfspRefusal();
  assert.equal(refusal.value, 'NOSUCH');
  // What a re-opened Block editor keys off, so it need not remember which
  // cell it closed.
  assert.equal(refusal.blockId, '9F');
});

test('a refused Block edit with no value (confirmVacated) says no value was typed', async () => {
  const { sandbox, banner } = await settled(mountPanel());
  refuse(sandbox, {
    stripId: 'sA', op: { kind: 'SetBlock', blockId: '7', confirmVacated: true },
    reason: 'STALE_REV',
  });
  assert.equal(sandbox.getCurrentEfspRefusal().value, null);
  assert.doesNotMatch(banner.textContent, /“”/);
});

// ── the accessor bay-view.js reads, and dismissal ────────────────────────

test('getCurrentEfspRefusal names the Strip and the reason for the Strip-level marker', async () => {
  const { sandbox } = await settled(mountPanel());
  assert.equal(sandbox.getCurrentEfspRefusal(), null);
  refuse(sandbox, { stripId: 'sB', op: { kind: 'InvokeNla' }, reason: 'NLA_INHIBITED', detail: 'no receiving Position present' });
  const refusal = sandbox.getCurrentEfspRefusal();
  assert.equal(refusal.stripId, 'sB');
  assert.equal(refusal.blockId, null, 'only a SetBlock names a Block');
  assert.equal(refusal.reason, 'NLA_INHIBITED');
  assert.equal(refusal.detail, 'no receiving Position present');
  assert.match(refusal.message, /BBB22/);
  assert.ok(Number.isFinite(refusal.at));
});

test('clicking the banner dismisses the refusal, and takes the Strip marker with it', async () => {
  const { sandbox, banner, rerenders } = await settled(mountPanel());
  refuse(sandbox, { stripId: 'sB', op: { kind: 'InvokeNla' }, reason: 'NLA_INHIBITED' });
  const before = rerenders();
  for (const fn of banner._listeners.click || []) fn({});
  assert.equal(banner.textContent, '');
  assert.equal(banner.title, '');
  assert.equal(sandbox.getCurrentEfspRefusal(), null);
  assert.equal(rerenders(), before + 1, 'the Bays redraw so the Strip marker goes too');
});

test('the auto-clear is a named constant, and long enough to read a route back off', async () => {
  const { evalIn } = await settled(mountPanel());
  const visibleMs = evalIn('MUTATION_ERROR_VISIBLE_MS');
  // F-103 measured the old one gone at 6.9 s; F-207 adds that for a refused
  // Block edit this is the only surviving copy of what was typed. Whether a
  // refusal should time out AT ALL is the workflow question F-103 leaves
  // open, so there is still a timer — just not a six-second one.
  assert.ok(visibleMs >= 20000,
    `refusals must outlive the 6 s that F-103 measured, got ${visibleMs}`);
});

// ── F-103, the one-argument bug in app.js ────────────────────────────────

test('app.js never calls _showMutationError with the whole ack message', () => {
  // Measured: `_showMutationError(msg)` at two call sites against a
  // `(reason, detail, context)` signature, so a refused efsp-correlation-ack
  // or efsp-marsa-ack rendered "[object Object]". A static check because
  // app.js is the WebSocket front door and cannot be mounted in the stub.
  const src = fs.readFileSync(path.join(__dirname, '../app/public/js/app.js'), 'utf8');
  const calls = src.match(/_showMutationError\([^)]*\)/g) || [];
  assert.ok(calls.length > 0, 'the call sites moved — this guard needs updating');
  for (const call of calls) {
    assert.doesNotMatch(call, /^_showMutationError\(\s*msg\s*\)$/, `still passes the whole message: ${call}`);
  }
});

test('the struct always carries every documented field, so a reader never has to feature-detect', async () => {
  const { sandbox } = await settled(mountPanel());
  refuse(sandbox, {
    stripId: 'sA', op: { kind: 'SetBlock', blockId: '9F', value: 'NOSUCH' },
    reason: 'VALIDATION_ERROR', detail: 'NOSUCH is not a configured stereo route',
  });
  assert.deepEqual(Object.keys(sandbox.getCurrentEfspRefusal()).sort(),
    ['at', 'blockId', 'detail', 'message', 'reason', 'stripId', 'value']);
});

test('a refusal that targets no single Strip nulls both stripId and blockId', async () => {
  // A CreateStrip has no Strip yet, and an airspace op has none at all —
  // getCurrentEfspRefusal's contract is "a null stripId means mark nothing".
  const { sandbox } = await settled(mountPanel());
  sandbox._showMutationError('PERMISSION_DENIED', 'CTR may not release BLUE RANGE', { subject: 'BLUE RANGE' });
  const refusal = sandbox.getCurrentEfspRefusal();
  assert.equal(refusal.stripId, null);
  assert.equal(refusal.blockId, null);
  assert.match(refusal.message, /BLUE RANGE/);
});
