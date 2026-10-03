'use strict';
// The wire protocol deploy gate (.github/scripts/protocol-gate.sh), run against a temp git repo with release tags, a file://
// releases JSON and a stub for `docker buildx imagetools`. Run: node --test infra/tests/*.test.js (needs bash, git, curl, jq).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '../../.github/scripts/protocol-gate.sh');
const DESK = 'crc-desktop/app/public/js/wire-protocol.js';
const DIGEST = 'sha256:' + 'a'.repeat(64);

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
}

// tags: { 'crc-desktop-v1.0.0': 'export const WIRE_PROTOCOL = 2;\n' | null (no file at that tag) }
function run({ tags = {}, releases, digest = DIGEST, label = '2', labelShape = 'flat', env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.writeFileSync(path.join(dir, 'README'), 'x');
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  for (const [tag, file] of Object.entries(tags)) {
    fs.mkdirSync(path.join(dir, path.dirname(DESK)), { recursive: true });
    if (file === null) fs.rmSync(path.join(dir, DESK), { force: true }); else fs.writeFileSync(path.join(dir, DESK), file);
    fs.writeFileSync(path.join(dir, 'README'), tag);
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', tag, '--allow-empty'); git(dir, 'tag', tag);
  }
  const relFile = path.join(dir, 'releases.json');
  if (releases !== undefined) fs.writeFileSync(relFile, typeof releases === 'string' ? releases : JSON.stringify(releases));
  const cfg = { config: { Labels: label === null ? {} : { 'org.sourcedcs.wire-protocol': label } } };
  const image = labelShape === 'flat' ? cfg : { 'linux/amd64': cfg };
  const stub = path.join(dir, 'imagetools');
  fs.writeFileSync(stub, `#!/usr/bin/env bash
case "$*" in
  *Manifest.Digest*) ${digest ? `echo ${digest}` : 'exit 1'} ;;
  *"{{json .Image}}"*) cat "$0.image" ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(stub + '.image', JSON.stringify(image));
  const out = path.join(dir, 'out');
  const r = spawnSync('bash', [SCRIPT], {
    cwd: dir, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: dir, GITHUB_OUTPUT: out, IMAGE_REPO: 'ghcr.io/o/r/crc-sync', IMAGE_REF: 'sha-abc1234',
      IMAGETOOLS: stub, RELEASES_URL: 'file://' + relFile, ...env },
  });
  const o = Object.fromEntries((fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...o, log: r.stdout + r.stderr, status: r.status };
}

const P = (n) => `export const WIRE_PROTOCOL = ${n};\n`;
const rel = (win, linux) => ({ win: win && { version: win }, linux: linux && { version: linux } });
const IMG = 'ghcr.io/o/r/crc-sync@' + DIGEST;

const table = [
  ['equal protocols: deploy, by digest', { tags: { 'crc-desktop-v1.0.0': P(2) }, releases: rel('1.0.0', '1.0.0') }, { hold: 'false', image: IMG, server_protocol: '2' }],
  ['equal, label inside a per-platform map', { tags: { 'crc-desktop-v1.0.0': P(2) }, releases: rel('1.0.0', '1.0.0'), labelShape: 'platforms' }, { hold: 'false', image: IMG }],
  ['different protocols: hold', { tags: { 'crc-desktop-v1.0.0': P(1) }, releases: rel('1.0.0', '1.0.0') }, { hold: 'true', log: /speaks protocol 2.*speaks 1/ }],
  ['tag without wire-protocol.js is protocol 1; server 2 holds', { tags: { 'crc-desktop-v0.9.0': null }, releases: rel('0.9.0', '0.9.0') }, { hold: 'true', log: /speaks 1/ }],
  ['tag without wire-protocol.js is protocol 1; server 1 passes', { tags: { 'crc-desktop-v0.9.0': null }, releases: rel('0.9.0', '0.9.0'), label: '1' }, { hold: 'false' }],
  ['published version has no tag: hold', { tags: {}, releases: rel('3.0.0', '3.0.0') }, { hold: 'true', log: /no tag crc-desktop-v3\.0\.0/ }],
  ['unreadable wire-protocol.js at the tag: hold', { tags: { 'crc-desktop-v1.0.0': 'export const WIRE_PROTOCOL = twelve;\n' }, releases: rel('1.0.0', '1.0.0') }, { hold: 'true', log: /no WIRE_PROTOCOL number/ }],
  ['releases API unreachable: fail closed', { tags: { 'crc-desktop-v1.0.0': P(2) } }, { hold: 'true', log: /could not read the published crc-desktop release/ }],
  ['releases JSON garbled: fail closed', { tags: { 'crc-desktop-v1.0.0': P(2) }, releases: '<html>502</html>' }, { hold: 'true' }],
  ['releases JSON lists no version: fail closed', { tags: { 'crc-desktop-v1.0.0': P(2) }, releases: rel(null, null) }, { hold: 'true' }],
  ['half-published (win newer): judged by the NEWEST version, not held on the older', { tags: { 'crc-desktop-v1.9.0': P(1), 'crc-desktop-v1.10.0': P(2) }, releases: rel('1.10.0', '1.9.0') }, { hold: 'false', log: /v1\.10\.0/ }],
  ['half-published (win newer) and newest differs: hold', { tags: { 'crc-desktop-v1.9.0': P(2), 'crc-desktop-v1.10.0': P(3) }, releases: rel('1.10.0', '1.9.0') }, { hold: 'true', log: /v1\.10\.0 speaks 3/ }],
  ['image has no label: hold', { tags: { 'crc-desktop-v1.0.0': P(2) }, releases: rel('1.0.0', '1.0.0'), label: null }, { hold: 'true', log: /no readable org\.sourcedcs\.wire-protocol label/ }],
  ['image cannot be resolved: hold, no image', { tags: { 'crc-desktop-v1.0.0': P(2) }, releases: rel('1.0.0', '1.0.0'), digest: '' }, { hold: 'true', image: '', log: /could not resolve/ }],
  ['skip: deploy despite a mismatch, still by digest', { tags: { 'crc-desktop-v1.0.0': P(1) }, releases: rel('1.0.0', '1.0.0'), env: { SKIP_PROTOCOL_GATE: 'true' } }, { hold: 'false', image: IMG, log: /skipped/ }],
  ['skip: releases API down is tolerated', { tags: {}, env: { SKIP_PROTOCOL_GATE: 'true' } }, { hold: 'false', image: IMG }],
  ['skip: but an unresolvable image still holds', { tags: {}, digest: '', env: { SKIP_PROTOCOL_GATE: 'true' } }, { hold: 'true', image: '' }],
  ['skip=false string does not skip', { tags: { 'crc-desktop-v1.0.0': P(1) }, releases: rel('1.0.0', '1.0.0'), env: { SKIP_PROTOCOL_GATE: 'false' } }, { hold: 'true' }],
];

for (const [name, input, want] of table) {
  test(`protocol-gate: ${name}`, () => {
    const got = run(input);
    assert.strictEqual(got.status, 0, 'the gate never fails the job: ' + got.log);
    for (const [k, v] of Object.entries(want)) {
      if (k === 'log') assert.match(got.log, v);
      else assert.strictEqual(got[k], v, `${k}\n${got.log}`);
    }
  });
}

test('protocol-gate: the client file may use "WIRE_PROTOCOL: n" or "= n" (one regex for both spellings)', () => {
  const got = run({ tags: { 'crc-desktop-v1.0.0': 'module.exports = { WIRE_PROTOCOL: 2 };\n' }, releases: rel('1.0.0', '1.0.0') });
  assert.strictEqual(got.hold, 'false', got.log);
});
