'use strict';

/* The ATO import dialog (crc-sync docs/adr/0071, guide §9.8).
 *
 * Wiring, not layout: the button exists only while TAC_C2 is held, the preview
 * renders what the server said (warnings, missing fields, the bind choices),
 * Import sends exactly ONE efsp-ato-mutation carrying the previewed text's hash
 * and the chosen actions, and a line with no callsign that fits cannot be
 * imported until one is typed (H60 has already shortened what it could).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeElement, descendants } = require('./helpers/dom-stub.js');

const FILE = path.join(__dirname, '../app/public/js/panels/efsp/ato-import.js');

function mount({ held = ['TAC_C2'] } = {}) {
  const sent = [];
  const errors = [];
  let n = 0;
  const sandbox = {
    console, module: { exports: {} }, Date, JSON, Math, Number, Set, Map, Array, Object, String, RegExp,
    document: { createElement: makeElement },
    crypto: { randomUUID: () => `id-${++n}` },
    getActingPositions: () => held,
    _sendEfsp: (msg) => sent.push(msg),
    _showMutationError: (reason, detail) => errors.push({ reason, detail }),
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'ato-import.js' });
  const root = makeElement('div');
  const toolbar = makeElement('div');
  toolbar.className = 'efsp-toolbar';
  root.appendChild(toolbar);
  sandbox.initAtoImport(root);
  const button = toolbar.children.find(c => c.className === 'efsp-ato-import-btn');
  return { sandbox, sent, errors, root, toolbar, button, api: sandbox.module.exports };
}

const PREVIEW = {
  ok: true, textSha1: 'a'.repeat(40),
  header: { operation: { name: 'IRON FLAG 26-3' }, msgId: { serial: 'ATO C' } },
  warnings: [{ code: 'ATO_DATE_DIFFERS', severity: 'info', message: 'ATO dated 14 SEP 2026; its times are placed on the mission\'s calendar from 21 JUN 2016.' }],
  lines: [
    { lineId: '1101A#0', missionNumber: '1101A', callsign: 'VIPER11', callsignRaw: 'VIPER 11', seedable: true, action: 'BIND',
      bindCandidates: [{ fdrId: 'f1', key: 'MODE3', callsign: 'VIPER11', beaconAssigned: '4521', strips: [] }], existingFdrId: null, changes: [],
      missing: ['packageId'], warnings: [], summary: { vul: { startUtc: Date.UTC(2016, 5, 21, 13), endUtc: Date.UTC(2016, 5, 21, 15) }, agency: 'MAGIC11', iff: { modeOne: '12', modeTwo: '0011', modeThree: '4521' } } },
    { lineId: '1901T#0', missionNumber: '1901T', callsign: null, callsignRaw: 'BDRKSTRX 71', seedable: false, action: 'CREATE',
      bindCandidates: [], existingFdrId: null, changes: [], missing: ['callsign', 'modeOne'],
      warnings: [{ code: 'CALLSIGN_INVALID', severity: 'warning', message: 'Callsign "BDRKSTRX 71" … needs a callsign typed.' }], summary: { vul: {}, iff: {} } },
  ],
  arLinks: [{ tankerCallsign: 'SHELL71', receiverCallsign: 'VIPER11', arctUtc: Date.UTC(2016, 5, 21, 13, 45), offloadKlb: 12, arcp: 'ANCHOR BLUE' }],
  notInThisAto: [],
};

function previewed(m) {
  m.api.openAtoImportDialog();
  m.api.setAtoImportText('UNCLAS\nEXER/IRON FLAG//');
  m.api.requestAtoPreview();
  const req = m.sent[m.sent.length - 1];
  m.api.onAtoPreviewResult({ type: 'efsp-ato-preview-result', requestId: req.requestId, ok: true, preview: PREVIEW });
  return req;
}

test('the Import ATO button is there only while TAC_C2 is held', () => {
  assert.equal(mount().button.hidden, false);
  const gci = mount({ held: ['GCI'] });
  assert.equal(gci.button.hidden, true);
  gci.api.openAtoImportDialog();
  assert.equal(gci.api.getAtoImportState().open, false, 'no dialog for a Position that cannot import');
});

test('the dialog mounts under the panel root, not in Bay content (T15)', () => {
  const m = mount();
  m.api.openAtoImportDialog();
  assert.ok(m.root.children.some(c => c.className === 'efsp-ato-dialog'));
});

test('Preview sends the text as a read-only efsp-ato-preview, and the preview renders warnings and missing fields', () => {
  const m = mount();
  const req = previewed(m);
  assert.equal(req.type, 'efsp-ato-preview');
  assert.equal(req.actingPositionId, 'TAC_C2');
  assert.equal(req.text, 'UNCLAS\nEXER/IRON FLAG//');
  const dialog = m.root.children.find(c => c.className === 'efsp-ato-dialog');
  const text = descendants(dialog).map(e => e.textContent).join('\n');
  assert.match(text, /ATO dated 14 SEP 2026/);
  assert.match(text, /missing: packageId/);
  assert.match(text, /missing: callsign, modeOne/);
  assert.match(text, /Bind to VIPER11 · 4521 \(Mode 3\)/);
  assert.match(text, /SHELL71 → VIPER11 · ARCT 1345Z/);
  assert.match(text, /1300Z–1500Z/);
});

test('a stale preview answer is ignored', () => {
  const m = mount();
  m.api.openAtoImportDialog();
  m.api.setAtoImportText('x');
  m.api.requestAtoPreview();
  m.api.onAtoPreviewResult({ requestId: 'someone-else', ok: true, preview: PREVIEW });
  assert.equal(m.api.getAtoImportState().preview, null);
});

test('an unseedable line cannot be imported until a callsign is typed', () => {
  const m = mount();
  previewed(m);
  const before = m.sent.length;
  assert.equal(m.api.sendAtoImport(), null);
  assert.equal(m.sent.length, before, 'nothing sent');
  assert.match(m.api.getAtoImportState().message, /1901T#0/);
  const dialog = m.root.children.find(c => c.className === 'efsp-ato-dialog');
  const go = descendants(dialog).find(e => e.className === 'efsp-ato-import-go');
  assert.equal(go.disabled, true);
  const input = descendants(dialog).find(e => e.className === 'efsp-ato-callsign');
  input.value = 'tex71';
  for (const fn of input._listeners.input) fn({});
  assert.ok(m.api.sendAtoImport());
});

test('Import sends exactly one efsp-ato-mutation carrying the preview\'s textSha1 and the chosen actions', () => {
  const m = mount();
  previewed(m);
  m.api.setAtoLineChoice('1901T#0', { action: 'SKIP' });
  const before = m.sent.length;
  const id = m.api.sendAtoImport();
  assert.equal(m.sent.length, before + 1);
  const msg = m.sent[m.sent.length - 1];
  assert.equal(msg.type, 'efsp-ato-mutation');
  assert.equal(msg.clientMutationId, id);
  assert.equal(msg.facilityId, 'TACTICAL');
  assert.equal(msg.actingPositionId, 'TAC_C2');
  assert.equal(msg.op.kind, 'ImportAto');
  assert.equal(msg.op.textSha1, PREVIEW.textSha1);
  assert.equal(msg.op.text, 'UNCLAS\nEXER/IRON FLAG//');
  assert.deepEqual(JSON.parse(JSON.stringify(msg.op.choices)), [
    { lineId: '1101A#0', action: 'BIND', fdrId: 'f1' },
    { lineId: '1901T#0', action: 'SKIP' },
  ]);
  assert.equal(m.api.sendAtoImport(), null, 'a second press while pending sends nothing');
  assert.equal(m.sent.length, before + 1);
});

test('the ack closes the dialog when every line imported, and lists the refusals otherwise', () => {
  const ok = mount();
  previewed(ok);
  ok.api.setAtoLineChoice('1901T#0', { action: 'SKIP' });
  const id = ok.api.sendAtoImport();
  ok.api.onAtoAck({ clientMutationId: id, ok: true, results: [{ lineId: '1101A#0', ok: true, action: 'BIND' }, { lineId: '1901T#0', ok: true, action: 'SKIP' }] });
  assert.equal(ok.api.getAtoImportState().open, false);

  const bad = mount();
  previewed(bad);
  bad.api.setAtoLineChoice('1901T#0', { action: 'SKIP' });
  const id2 = bad.api.sendAtoImport();
  bad.api.onAtoAck({ clientMutationId: id2, ok: true, results: [{ lineId: '1101A#0', ok: false, action: 'BIND', reason: 'VALIDATION_ERROR', detail: 'VIPER11 already has a live MISSION Strip' }] });
  const state = bad.api.getAtoImportState();
  assert.equal(state.open, true);
  assert.match(state.message, /1 line/);

  const refused = mount();
  previewed(refused);
  refused.api.setAtoLineChoice('1901T#0', { action: 'SKIP' });
  const id3 = refused.api.sendAtoImport();
  refused.api.onAtoAck({ clientMutationId: id3, ok: false, reason: 'STALE_REV', detail: 'the ATO changed since the preview' });
  assert.deepEqual(refused.errors.map(e => e.reason), ['STALE_REV']);
  assert.equal(refused.api.getAtoImportState().preview, null, 'preview again before importing');
});

test('Esc closes; Enter previews, then imports; Enter in the paste area is a newline', () => {
  const m = mount();
  m.api.openAtoImportDialog();
  m.api.setAtoImportText('x');
  const dialog = m.root.children.find(c => c.className === 'efsp-ato-dialog');
  const key = (k, target) => { for (const fn of dialog._listeners.keydown) fn({ key: k, target: target || {}, preventDefault() {} }); };
  const before = m.sent.length;
  key('Enter', { tagName: 'textarea' });
  assert.equal(m.sent.length, before);
  key('Enter');
  assert.equal(m.sent[m.sent.length - 1].type, 'efsp-ato-preview');
  key('Escape');
  assert.equal(m.api.getAtoImportState().open, false);
});
