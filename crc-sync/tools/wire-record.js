#!/usr/bin/env node
'use strict';

const HELP = `wire:record (docs/adr/0103)

Usage: npm run wire:record [-- --bump] [-- --help]

Run it after any change to the wire: a message type, an EFSP op kind, the top-level keys of a frame. tests/wire-protocol.test.mjs
fails until you do. It:
  1. re-records the wire surface into tests/fixtures/wire-surface.json;
  2. reads the protocol of the last released client: the newest 'crc-desktop-v*' tag, then
     crc-desktop/app/public/js/wire-protocol.js at that tag;
  3. bumps WIRE_PROTOCOL in BOTH copies (crc-sync/src/wire-protocol.js and crc-desktop/app/public/js/wire-protocol.js) by one only if
     the current number equals the released one. If the number is already ahead of the release it leaves it: several lanes between
     two releases share one bump. No tag, or no file at the tag, counts as "bump".

--bump  Also bump for an incompatible change the surface scan cannot see (a value's meaning, say). Same rule: it never bumps twice
        between releases, because a number already ahead of the last release is already unreleased.
`;

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { computeSurface } = require('./wire-surface');

const ROOT = path.join(__dirname, '..', '..');
const SYNC_FILE = path.join(ROOT, 'crc-sync', 'src', 'wire-protocol.js');
const DESK_FILE = path.join(ROOT, 'crc-desktop', 'app', 'public', 'js', 'wire-protocol.js');
const DESK_REL = 'crc-desktop/app/public/js/wire-protocol.js';
const FIXTURE = path.join(__dirname, '..', 'tests', 'fixtures', 'wire-surface.json');
const NUMBER_RE = /WIRE_PROTOCOL\s*[:=]\s*(\d+)/;

/** @returns {number|null} */
function parseProtocol(text) {
  const m = NUMBER_RE.exec(text || '');
  return m ? Number(m[1]) : null;
}

/** The released protocol, or null when it cannot be known (no tag, or no file at the tag). */
function releasedProtocol(git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) {
  let tag;
  try { tag = git(['tag', '-l', 'crc-desktop-v*', '--sort=-v:refname']).split('\n').map(s => s.trim()).find(Boolean); } catch (_) { return null; }
  if (!tag) return null;
  try { return parseProtocol(git(['show', `${tag}:${DESK_REL}`])); } catch (_) { return null; }
}

/** Whether the current number must go up by one (see --help). */
function shouldBump(current, released) {
  return released === null || current === released;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return 0; }
  const force = argv.includes('--bump');
  const surface = computeSurface();
  let fixture = null;
  try { fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')); } catch (_) { /* first record */ }
  const changed = !fixture || JSON.stringify(fixture.surface) !== JSON.stringify(surface);

  const current = parseProtocol(fs.readFileSync(SYNC_FILE, 'utf8'));
  const deskCurrent = parseProtocol(fs.readFileSync(DESK_FILE, 'utf8'));
  if (current === null || deskCurrent === null) throw new Error('could not read WIRE_PROTOCOL from one of the two copies');
  if (current !== deskCurrent) throw new Error(`the two copies differ (crc-sync ${current}, crc-desktop ${deskCurrent}); make them equal first`);

  const released = releasedProtocol();
  let protocol = current;
  // With no fixture yet there is no earlier surface to have changed from: the first record never bumps.
  if (fixture && (changed || force) && shouldBump(current, released)) {
    protocol = current + 1;
    for (const f of [SYNC_FILE, DESK_FILE]) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(NUMBER_RE, (m) => m.replace(/\d+$/, String(protocol))));
  }
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  fs.writeFileSync(FIXTURE, JSON.stringify({ protocol, surface }, null, 2) + '\n');

  const rel = released === null ? 'no released client found' : `last release speaks ${released}`;
  if (protocol !== current) console.log(`wire:record: WIRE_PROTOCOL ${current} -> ${protocol} in both copies (${rel}); surface recorded.`);
  else console.log(`wire:record: WIRE_PROTOCOL stays ${current} (${rel}${changed || force ? ', already ahead of it' : ''}); surface ${changed ? 'recorded' : 'unchanged'}.`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error('wire:record: ' + e.message); process.exitCode = 1; }
}

module.exports = { parseProtocol, releasedProtocol, shouldBump, FIXTURE };
