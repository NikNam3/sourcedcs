#!/usr/bin/env node
'use strict';

// Order-key growth sanity check (briefing §3.4 / §6 step 4): N pairs of
// same-slot MoveStrips in one Rack, through the same host the soak uses, and
// the max key length after each milestone. The briefing's scratch run saw
// 25 / 45 / 94 characters after 50 / 100 / 200 pairs and no rebalance.
//
//   node tools/soak/orderkey-probe.js [--pairs 200] [--seed 1]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { InprocHost, writeFixtures } = require('./host-client');

async function main() {
  const args = process.argv.slice(2);
  const pairs = Number(args[args.indexOf('--pairs') + 1] || 0) || 200;
  const seed = Number(args[args.indexOf('--seed') + 1] || 0) || 1;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-soak-okprobe-'));
  writeFixtures(stateDir);
  let now = Date.now();
  const host = new InprocHost({ stateDir, seed, startNow: now, logPath: path.join(stateDir, 'host.log') });
  await host.start();
  const call = (type, body = {}) => host.call({ type, now: (now += 50), ...body });
  let n = 0;
  const send = async (msg) => {
    if (msg.type === 'efsp-mutation') msg.clientMutationId = `probe-${++n}`;
    const r = await call('send', { clientId: 'ops', msg });
    return r.out.map(([, p]) => JSON.parse(p)).find(m => m.type === 'efsp-mutation-ack');
  };
  await call('connect', { clientId: 'ops', user: { name: 'ops', sub: 'ops' } });
  await call('send', { clientId: 'ops', msg: { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['OPS'] } });
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const ack = await send({ version: 1, type: 'efsp-mutation', facilityId: 'INCIRLIK', actingPositionId: 'OPS', op: { kind: 'CreateStrip', bayId: 'ops-filed', rackId: 'main', role: 'DEPARTURE', fdr: { callsign: `OKP${i}`, aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' } } });
    ids.push(ack.strip.stripId);
  }
  const rows = [];
  const refusals = {};
  for (let p = 1; p <= pairs; p++) {
    for (const mover of [ids[1], ids[2]]) {
      const rack = (await call('rack', { facilityId: 'INCIRLIK', bayId: 'ops-filed', rackId: 'main' })).rack;
      const anchor = rack.find(x => x.stripId !== mover);
      const rest = rack.filter(x => x.stripId !== mover);
      const next = rest[rest.indexOf(anchor) + 1];
      const self = rack.find(x => x.stripId === mover);
      const ack = await send({ version: 1, type: 'efsp-mutation', facilityId: 'INCIRLIK', actingPositionId: 'OPS', stripId: mover, baseRev: self.rev, op: { kind: 'MoveStrip', bayId: 'ops-filed', rackId: 'main', afterStripId: anchor.stripId, beforeStripId: next ? next.stripId : null } });
      if (!ack.ok) refusals[ack.reason] = (refusals[ack.reason] || 0) + 1;
    }
    if ([10, 25, 50, 100, 150, 200, 300, 400].includes(p) || p === pairs) {
      const s = (await call('sample', { heavy: false })).sample.orderKeys;
      rows.push({ pairs: p, maxLen: s.maxLen, rebalances: s.rebalances, exhaustedThrows: s.exhaustedThrows });
    }
  }
  await host.shutdown();
  fs.rmSync(stateDir, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ seed, pairs, rows, refusals }, null, 2) + '\n');
}

main().catch((e) => { process.stderr.write(String(e.stack || e) + '\n'); process.exit(2); });
