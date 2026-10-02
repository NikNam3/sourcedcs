// The local server serves crc-desktop/app/data/*.json and app.js parses them with r.json() inside one Promise.all:
// one malformed file silently drops every static table (aircraft types AND airports). Pin that they all parse.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(import.meta.dirname, '../app/data');

test('every static data file the client fetches is valid JSON', () => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  assert.ok(files.includes('aircraft-types.json') && files.includes('airports.json'));
  for (const f of files) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')), `${f} is not valid JSON`);
  }
});
