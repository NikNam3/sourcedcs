'use strict';

// S-2PA0: the only link the app opens in the user's browser is the airspace booking page, on the origin crc-sync sent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createExternalLinkGate, httpOriginOf, isCasdoorLoginUrl, isLocalAppUrl, CASDOOR_POPUP_WEB_PREFERENCES } = require('../external-link');

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

// ── B12: the update-required download link ─────────────────────────────────────────────────────────────────────
const DOWNLOAD = 'https://downloads.example.org/download.html';

test('the download origin opens alongside the booking origin, and nothing else', () => {
  const g = gate();
  g.allowDownload(DOWNLOAD);
  assert.equal(g.canOpen('https://downloads.example.org/download.html'), true);
  assert.equal(g.canOpen('https://downloads.example.org/other?x=1'), true);
  assert.equal(g.canOpen(BOOKING), true, 'the booking origin still opens');
  assert.equal(g.canOpen('https://example.com/'), false);
  assert.equal(g.downloadOrigin(), 'https://downloads.example.org');
});

test('download origin: lookalikes, other scheme/port and non-http schemes stay denied', () => {
  const g = createExternalLinkGate();
  g.allowDownload(DOWNLOAD);
  for (const u of ['https://downloads.example.org.evil.com/', 'https://downloads.example.org@evil.com/', 'https://evildownloads.example.org/',
    'http://downloads.example.org/', 'https://downloads.example.org:8443/', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
    assert.equal(g.canOpen(u), false, u);
  }
});

test('no download URL: only the booking origin opens; an absent or bad URL clears an earlier one', () => {
  const g = gate();
  assert.equal(g.canOpen(DOWNLOAD), false, 'never reported');
  g.allowDownload(DOWNLOAD);
  for (const bad of ['', undefined, null, 'javascript:1', 'not a url']) {
    g.allowDownload(DOWNLOAD);
    g.allowDownload(bad);
    assert.equal(g.canOpen(DOWNLOAD), false, `after allowDownload(${String(bad)})`);
    assert.equal(g.canOpen(BOOKING), true);
  }
  const only = createExternalLinkGate();
  only.allowDownload(undefined);
  assert.equal(only.canOpen(DOWNLOAD), false);
  assert.equal(only.canOpen(BOOKING), false);
});

test('a new booking URL does not forget the download origin', () => {
  const g = createExternalLinkGate();
  g.allowDownload(DOWNLOAD);
  g.allow(BOOKING);
  g.allow('');
  assert.equal(g.canOpen(DOWNLOAD), true);
  assert.equal(g.canOpen(BOOKING), false);
});

// ── B13: the Casdoor popup and the main window ───────────────────────────────────────────────────────────────
const CASDOOR = 'https://auth.example.org';

test('the Casdoor popup needs the endpoint origin and the authorize path', () => {
  assert.equal(isCasdoorLoginUrl(`${CASDOOR}/login/oauth/authorize?client_id=x&state=y`, CASDOOR), true);
  assert.equal(isCasdoorLoginUrl(`${CASDOOR}/login/oauth/authorize`, `${CASDOOR}/`), true, 'a trailing slash on the endpoint');
  assert.equal(isCasdoorLoginUrl(`${CASDOOR}/login/oauth/authorize2`, CASDOOR), false);
  assert.equal(isCasdoorLoginUrl(`${CASDOOR}/other`, CASDOOR), false);
  // the old startsWith matched these:
  assert.equal(isCasdoorLoginUrl('https://auth.example.org.evil.com/login/oauth/authorize', CASDOOR), false);
  assert.equal(isCasdoorLoginUrl('https://auth.example.org@evil.com/login/oauth/authorize', CASDOOR), false);
  assert.equal(isCasdoorLoginUrl('http://auth.example.org/login/oauth/authorize', CASDOOR), false);
});

test('the Casdoor endpoint is read per call, so a runtime change takes effect', () => {
  const url = 'https://other.example.net/login/oauth/authorize?client_id=x';
  assert.equal(isCasdoorLoginUrl(url, CASDOOR), false);
  assert.equal(isCasdoorLoginUrl(url, 'https://other.example.net'), true);
  assert.equal(isCasdoorLoginUrl(`${CASDOOR}/login/oauth/authorize`, 'https://other.example.net'), false);
});

test('no or invalid Casdoor endpoint allows no popup', () => {
  for (const ep of ['', undefined, null, 'not a url', 'javascript:1']) {
    assert.equal(isCasdoorLoginUrl(`${CASDOOR}/login/oauth/authorize`, ep), false, String(ep));
  }
  assert.equal(isCasdoorLoginUrl('javascript:1', CASDOOR), false);
});

test('the main window may navigate only on its own local origin', () => {
  assert.equal(isLocalAppUrl('http://localhost:3100/', 3100), true);
  assert.equal(isLocalAppUrl('http://localhost:3100/auth-callback.html?code=1', 3100), true);
  for (const u of ['http://localhost:3101/', 'https://localhost:3100/', 'http://localhost.evil.com:3100/', 'http://localhost:3100@evil.com/',
    'https://evil.com/', 'file:///x', 'javascript:1', 'garbage']) {
    assert.equal(isLocalAppUrl(u, 3100), false, u);
  }
});

test('popup webPreferences are isolated and sandboxed with no preload', () => {
  assert.deepEqual({ ...CASDOOR_POPUP_WEB_PREFERENCES }, { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: undefined });
  assert.ok(Object.isFrozen(CASDOOR_POPUP_WEB_PREFERENCES));
});

test('main.js wires the popup preferences, the live endpoint, will-navigate and the download channel', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /isCasdoorLoginUrl\(url, localServer\.getSyncConfig\(\)\.casdoorEndpoint\)/);
  assert.match(main, /webPreferences: \{ \.\.\.CASDOOR_POPUP_WEB_PREFERENCES \}/);
  assert.match(main, /on\('will-navigate'/);
  assert.match(main, /nodeIntegration: false,\s+sandbox: true,/);
  assert.match(main, /ipcMain\.on\('external-link-allow-download'/);
  assert.equal(main.includes('startsWith(process.env.CASDOOR_ENDPOINT'), false);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8');
  assert.match(preload, /allowDownloadUrl/);
});
