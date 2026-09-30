'use strict';

// Child-process entry for the soak host (briefing D1). The driver forks this
// with --expose-gc and `serialization: 'advanced'`; heap numbers then measure
// crc-sync alone, not the driver's ledger, and a restart is a real SIGKILL
// followed by a fresh process that restores from disk.
//
// argv: <stateDir> <seed> <startNow> <logPath> <lifetime>

const { setupHostEnv } = require('./host-env');

const [stateDir, seedArg, startArg, logPath, lifeArg] = process.argv.slice(2);
const env = setupHostEnv({ stateDir, seed: Number(seedArg), startNow: Number(startArg), logPath, lifetime: Number(lifeArg) || 1 });

// Only now may anything under src/ be required (T4).
const { createHost } = require('./host-core');

let host;
try {
  host = createHost(env, { stateDir });
} catch (err) {
  process.send({ id: 0, fatal: String(err && err.stack || err) });
  process.exit(3);
}

process.on('message', (cmd) => {
  if (cmd.type === 'shutdown') {
    host.shutdown();
    env.closeLog();
    process.send({ id: cmd.id, out: [] }, () => process.disconnect());
    return;
  }
  let reply;
  try {
    reply = host.handle(cmd);
  } catch (err) {
    reply = { id: cmd.id, out: [], hostError: String(err && err.stack || err) };
  }
  process.send(reply);
});

process.send({ id: 0, ready: true });
