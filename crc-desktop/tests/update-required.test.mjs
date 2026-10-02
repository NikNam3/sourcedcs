// The decision table of the "Update required" overlay (crc-sync docs/adr/0103): older, newer, no updater, not available.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFor, UPDATE_REQUIRED_CLOSE } from '../app/public/js/update-required.js';

const older = { serverProtocol: 5, clientProtocol: 4 };

test('close code is 4426', () => assert.equal(UPDATE_REQUIRED_CLOSE, 4426));

test('older client, updater present, not asked yet: offers Check for update', () => {
  const v = viewFor({ ...older, hasUpdater: true, phase: 'idle' });
  assert.equal(v.kind, 'older');
  assert.equal(v.button, 'check');
  assert.match(v.text, /^Update required\. This crc-sync speaks a newer protocol \(server 5, CRC 4\)\./);
  assert.equal(v.retry, true);
});

test('older client follows the updater: checking, downloading, ready', () => {
  assert.equal(viewFor({ ...older, hasUpdater: true, phase: 'checking' }).button, null);
  const d = viewFor({ ...older, hasUpdater: true, phase: 'downloading', percent: 40 });
  assert.match(d.text, /40%/);
  assert.equal(d.button, null);
  assert.equal(viewFor({ ...older, hasUpdater: true, phase: 'ready' }).button, 'restart');
});

test('older client, updater says not available: no update published, link when given', () => {
  const v = viewFor({ ...older, hasUpdater: true, phase: 'none', downloadUrl: 'https://sourcedcs.page/download.html' });
  assert.match(v.text, /No update is published yet\. Ask the server admin\./);
  assert.equal(v.button, null);
  assert.equal(v.showLink, true);
  assert.equal(viewFor({ ...older, hasUpdater: true, phase: 'none' }).showLink, false);
});

test('older client without an updater (dev, Playwright): no update published, no updater call offered', () => {
  const v = viewFor({ ...older, hasUpdater: false, phase: 'idle', downloadUrl: 'https://x.test/d' });
  assert.match(v.text, /No update is published yet/);
  assert.equal(v.button, null);
  assert.equal(v.showLink, true);
});

test('newer client: the server must be updated first, no updater button', () => {
  const v = viewFor({ serverProtocol: 3, clientProtocol: 4, hasUpdater: true, phase: 'idle', downloadUrl: 'https://x.test/d' });
  assert.equal(v.kind, 'newer');
  assert.equal(v.text, 'This CRC is newer than the server (server 3, CRC 4). The server must be updated first.');
  assert.equal(v.button, null);
  assert.equal(v.showLink, false);
  assert.equal(v.retry, true);
});

test('only the close code arrived (no frame): treated as older, protocol numbers omitted', () => {
  const v = viewFor({ serverProtocol: null, clientProtocol: 4, hasUpdater: true, phase: 'idle' });
  assert.equal(v.kind, 'older');
  assert.doesNotMatch(v.text, /server \d/);
});
