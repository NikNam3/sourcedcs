'use strict';
/* Shared harness for the bookings route tests: the real router over a real
   express app on an ephemeral port, the real store state with saveJSON stubbed
   (so no file under data/ is written), and a fake crc-sync client. */
const express = require('express');
const store = require('../store');
const crcsync = require('../crcsync-client');

function jwt(payload) {
  return 'h.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.s';
}
const tokens = {
  member: jwt({ sub: 'u-member', name: 'Member', roles: ['member'] }),
  member2: jwt({ sub: 'u-member2', name: 'Member Two', roles: ['member'] }),
  admin: jwt({ sub: 'u-admin', name: 'Admin Name', roles: ['admin'] }),
};

function fakeRegistry(theaters) {
  const calls = { list: [], fresh: [] };
  return {
    calls,
    listTheaters: async () => ({ ok: true, theaters: Object.keys(theaters).map(t => ({ theater: t, count: theaters[t].length })) }),
    listAirspaces: async (t, o) => {
      calls.list.push(t); if (o && o.fresh) calls.fresh.push(t);
      if (theaters === null || theaters[t] === 'DOWN') return { ok: false, reason: 'crc-sync unreachable: ECONNREFUSED' };
      return { ok: true, theater: t, airspaces: (theaters[t] || []).map(d => ({ definition: d, defRev: 1, state: 'RETURNED' })) };
    },
    mutateAirspace: async () => ({ ok: true, status: 200, ack: {} }),
  };
}
const def = (airspaceId, lo, hi, extra) => Object.assign({ airspaceId, name: airspaceId + ' NAME', kind: 'AREA', altLowerFt: lo, altUpperFt: hi, workingFrequencyMhz: 251 }, extra);

async function boot(registry, fixture) {
  const saved = {};
  const saves = [];
  saved.saveJSON = store.saveJSON;
  store.saveJSON = (file, data) => { saves.push(file); };
  const st = store.state;
  saved.state = { bookings: st.bookings, bookingResources: st.bookingResources, nextBookingId: st.nextBookingId, pilotRegistry: st.pilotRegistry };
  st.bookings = (fixture && fixture.bookings) || [];
  st.bookingResources = { ranges: [], controllers: [], notifyChannelId: '', ...((fixture && fixture.resources) || {}) };
  st.nextBookingId = 1000;
  st.pilotRegistry = {};
  crcsync.setClient(registry);
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/bookings'));
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port + '/api';
  const call = async (method, path, token, body) => {
    const res = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  const stop = () => {
    srv.close(); crcsync.setClient(null);
    store.saveJSON = saved.saveJSON;
    Object.assign(st, saved.state);
  };
  return { call, stop, st, saves };
}

const iso = (offsetH) => new Date(Date.now() + offsetH * 3600 * 1000).toISOString();

module.exports = { tokens, boot, fakeRegistry, def, iso };
