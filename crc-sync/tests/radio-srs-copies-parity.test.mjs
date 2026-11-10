import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// docs/adr/0160: crc-sync's relay speaks SRS with a hand copy of crc-desktop's protocol code (no shared package). The
// copies in src/radio/srs/ must stay byte for byte crc-desktop's app/srs/ files: change one, copy it to the other.

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '..', 'src', 'radio', 'srs');
const CLIENT = path.join(here, '..', '..', 'crc-desktop', 'app', 'srs');
const COPIES = ['srs-guid.js', 'voice-packet.js', 'sync-message.js', 'sync-link.js', 'voice-link.js'];

test('every protocol copy is the same bytes as crc-desktop\'s', () => {
  for (const f of COPIES) {
    assert.equal(fs.readFileSync(path.join(SERVER, f), 'utf8'), fs.readFileSync(path.join(CLIENT, f), 'utf8'), `${f} differs: copy it across`);
  }
});

test('the copy directory holds the copies and nothing else', () => {
  assert.deepEqual(fs.readdirSync(SERVER).sort(), [...COPIES].sort());
});
