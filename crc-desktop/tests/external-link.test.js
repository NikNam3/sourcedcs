'use strict';

// S-2PA0: the only link the app opens in the user's browser is the airspace booking page, on the origin crc-sync sent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createExternalLinkGate, httpOriginOf } = require('../external-link');

const BOOKING = 'https://sourcedcs.page/bookings.html';

function gate(url = BOOKING) { const g = createExternalLinkGate(); g.allow(url); return g; }

test('a URL on the booking origin opens (any path, query or fragment)', () => {
  const g = gate();
  assert.equal(g.canOpen('https://sourcedcs.page/bookings.html'), true);
  assert.equal(g.canOpen('https://sourcedcs.page/bookings.html?airspace=MOA-1#top'), true);
  assert.equal(g.canOpen('https://sourcedcs.page/'), true);
});

test('another origin does not open', () => {
  const g = gate();
  assert.equal(g.canOpen('https://example.com/bookings.html'), false);
  assert.equal(g.canOpen('http://sourcedcs.page/bookings.html'), false, 'another scheme is another origin');
  assert.equal(g.canOpen('https://sourcedcs.page:8443/bookings.html'), false, 'another port is another origin');
  assert.equal(g.canOpen('https://www.sourcedcs.page/'), false);
});

test('javascript:, file: and data: URLs never open', () => {
  const g = gate();
  for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script>1</script>', 'blob:https://sourcedcs.page/x',
    'vbscript:x', 'ftp://sourcedcs.page/x', 'about:blank']) {
    assert.equal(g.canOpen(u), false, u);
  }
});

test('a lookalike host does not open', () => {
  const g = gate();
  for (const u of ['https://sourcedcs.page.evil.com/bookings.html', 'https://evilsourcedcs.page/', 'https://sourcedcs.page@evil.com/',
    'https://evil.com/?https://sourcedcs.page/', 'https://sourcedcs.page.evil.com@sourcedcs.page.evil.com/']) {
    assert.equal(g.canOpen(u), false, u);
  }
});

test('with no bookingUrl known, nothing opens', () => {
  const g = createExternalLinkGate();
  assert.equal(g.canOpen(BOOKING), false);
  assert.equal(g.canOpen('https://example.com/'), false);
  assert.equal(g.allowedOrigin(), null);
});

test('a booking URL that is not http(s), or not a URL, allows nothing and clears an earlier one', () => {
  const g = gate();
  assert.equal(g.canOpen(BOOKING), true);
  for (const bad of ['javascript:alert(1)', 'file:///x', 'not a url', '', null, undefined, 42, { toString: () => BOOKING }]) {
    g.allow(BOOKING);
    g.allow(bad);
    assert.equal(g.canOpen(BOOKING), false, `after allow(${String(bad)})`);
  }
});

test('a malformed or oversized candidate does not open and does not throw', () => {
  const g = gate();
  assert.equal(g.canOpen('::::'), false);
  assert.equal(g.canOpen(null), false);
  assert.equal(g.canOpen(undefined), false);
  assert.equal(g.canOpen('https://sourcedcs.page/' + 'a'.repeat(3000)), false);
});

test('httpOriginOf answers the origin of http(s) only', () => {
  assert.equal(httpOriginOf('https://a.b/c?d'), 'https://a.b');
  assert.equal(httpOriginOf('file:///x'), null);
});

test('main.js uses the gate and opens nothing else, and the helper is packaged', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /externalLinks\.canOpen\(url\)/);
  assert.equal((main.match(/shell\.openExternal/g) || []).length, 1, 'exactly one openExternal, behind the gate');
  assert.ok(/shell\.openExternal\(url\)/.test(main.slice(main.indexOf('externalLinks.canOpen(url)'), main.indexOf('externalLinks.canOpen(url)') + 80)));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('external-link.js'));
});
