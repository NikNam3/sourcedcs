// The Casdoor login popup (sync.js openSyncLogin -> Casdoor -> auth-callback.html).
//
// 1. The authorize URL must not carry prompt=none. With prompt=none Casdoor never shows its login page: a user with no
//    live Casdoor session in the app (any fresh install) is sent straight back with error=login_required, so they can
//    never sign in (seen in prod 2026-11-04, two users stuck, no CRC-started login completing since 2026-10-29).
// 2. auth-callback.html must report Casdoor's error itself. It used to check the saved state first, so a missing state
//    hid the real error behind "Session state missing — possible CSRF attack or session expired."
// 3. The saved state lives in localStorage, not sessionStorage. sessionStorage only reaches the popup as a copy made
//    at window.open, and one Windows install (CRC 2.0.0) lost it; localStorage is shared by every localhost:<port>
//    window, so the callback reads the same value the main window wrote.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const CALLBACK_HTML = path.join(import.meta.dirname, '../app/public/auth-callback.html');

test('the authorize URL lets Casdoor show its login page (no prompt=none)', async () => {
  const { casdoorAuthorizeUrl } = await freshGraph().import('sync.js');
  const url = new URL(casdoorAuthorizeUrl({
    endpoint: 'https://auth.example.org', clientId: 'cid', redirectUri: 'http://localhost:3100/auth-callback.html', state: 'st1',
  }));
  assert.equal(url.origin + url.pathname, 'https://auth.example.org/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3100/auth-callback.html');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.equal(url.searchParams.get('state'), 'st1');
  assert.equal(url.searchParams.has('prompt'), false);
});

/** Runs auth-callback.html's inline script against a query string and a saved state; returns what the page shows. */
function runCallback(search, savedState) {
  const html = fs.readFileSync(CALLBACK_HTML, 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(inline.length, 1, 'auth-callback.html has one inline script');
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', style: {} });
  const store = (init) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
  const localStorage = store(savedState == null ? {} : { 'crc-desktop-oauth-state': savedState });
  const sessionStorage = store({ 'crc-desktop-oauth-state': 'from-sessionStorage' }); // must be ignored
  const fetchCalls = [];
  const ctx = {
    document: { getElementById: el },
    sessionStorage, localStorage,
    fetch: (...a) => { fetchCalls.push(a); return new Promise(() => {}); },
    setTimeout: () => 0,
    CRCSYNC_URL: 'wss://sync.example.org',
  };
  ctx.window = Object.assign(ctx, { location: { search, origin: 'http://localhost:3100' }, close() {} });
  vm.runInNewContext(inline[0], ctx);
  return { status: el('cbStatus').textContent, error: el('cbError').textContent, fetchCalls, savedAfter: localStorage.getItem('crc-desktop-oauth-state') };
}

test('a Casdoor error is shown as itself, even when the saved state is missing', () => {
  const r = runCallback('?error=login_required&state=abc&iss=https%3A%2F%2Fauth.example.org', null);
  assert.equal(r.status, 'AUTHENTICATION FAILED');
  assert.match(r.error, /login_required/);
  assert.equal(r.fetchCalls.length, 0);
});

test('a Casdoor error_description wins over the bare error code', () => {
  const r = runCallback('?error=access_denied&error_description=User%20is%20forbidden&state=abc', 'abc');
  assert.match(r.error, /User is forbidden/);
  assert.equal(r.savedAfter, null, 'the saved state is single-use either way');
});

test('a code with a missing or wrong saved state is still refused (CSRF check kept)', () => {
  const missing = runCallback('?code=c1&state=abc', null);
  assert.match(missing.error, /Session state missing/);
  assert.equal(missing.fetchCalls.length, 0);
  const wrong = runCallback('?code=c1&state=abc', 'xyz');
  assert.match(wrong.error, /State mismatch/);
  assert.equal(wrong.fetchCalls.length, 0);
});

test('a code with the matching state goes to crc-sync for the exchange', () => {
  const r = runCallback('?code=c1&state=abc', 'abc');
  assert.equal(r.fetchCalls.length, 1);
  assert.equal(r.fetchCalls[0][0], 'https://sync.example.org/api/auth/token');
  assert.deepEqual(JSON.parse(r.fetchCalls[0][1].body), { code: 'c1', redirectUri: 'http://localhost:3100/auth-callback.html' });
  assert.equal(r.savedAfter, null);
});

test('the main window and the callback keep the state in localStorage under the same key', () => {
  const sync = fs.readFileSync(path.join(import.meta.dirname, '../app/public/js/sync.js'), 'utf8');
  const html = fs.readFileSync(CALLBACK_HTML, 'utf8');
  assert.match(sync, /localStorage\.setItem\('crc-desktop-oauth-state'/);
  assert.doesNotMatch(sync, /sessionStorage[^\n]*crc-desktop-oauth-state/);
  assert.match(html, /localStorage\.getItem\('crc-desktop-oauth-state'\)/);
  assert.doesNotMatch(html, /sessionStorage/);
});
