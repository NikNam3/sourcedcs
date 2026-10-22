#!/usr/bin/env node
'use strict';

// The two human-run terrain commands (docs/adr/0133):
//   npm run terrain:build    -- --theater Syria [--spacing 500] [--chunk 4000] [--pause 500] [--out <dir>]
//                               [--dry-run] [--max-chunks <n>]
//   npm run terrain:validate -- --theater Syria [--spacings 1000,500,250] [--pairs 200] [--seed 1] [--pause 500]
// Both talk to the DCS server CRCSYNC_DCS_GRPC_HOST (else DCS_GRPC_HOST) names, through CustomService.Eval, and need a
// mission running on that theater. Run them only against a server you may load: each Eval runs on the sim thread.

require('dotenv').config({ quiet: true });
const { loadTheaters } = require('../../src/theaters');
const { terrainCacheDir } = require('../../src/terrain-grid');
const { buildTerrain, DEFAULTS: BUILD } = require('./build-core');
const { validateTerrain, DEFAULTS: VALIDATE } = require('./validate-core');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`unexpected argument ${argv[i]}`);
    out[m[1]] = m[2] !== undefined ? m[2] : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return out;
}

const int = (v, name) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};

async function main([command, ...rest], env = process.env) {
  const args = parseArgs(rest);
  if (!args.theater || args.theater === 'true') throw new Error('--theater <name> is required (the name DCS-gRPC GetTheatre returns, e.g. Syria)');
  const theaters = loadTheaters(undefined, env);
  const extent = theaters[args.theater] && theaters[args.theater].terrainExtent;
  const { createEvalClient } = require('./eval-client');
  const client = createEvalClient(env);
  process.stdout.write(`DCS-gRPC at ${client.host}\n`);
  try {
    if (command === 'build') {
      await buildTerrain({
        evalLua: client.evalLua, theater: args.theater, extent,
        outDir: args.out || terrainCacheDir(env),
        spacingM: int(args.spacing, 'spacing') ?? BUILD.spacingM,
        chunkPoints: int(args.chunk, 'chunk') ?? BUILD.chunkPoints,
        pauseMs: int(args.pause, 'pause') ?? BUILD.pauseMs,
        dryRun: args['dry-run'] === 'true',
        maxChunks: int(args['max-chunks'], 'max-chunks'),
      });
    } else if (command === 'validate') {
      await validateTerrain({
        evalLua: client.evalLua, theater: args.theater, extent,
        spacings: args.spacings ? args.spacings.split(',').map((s) => int(s, 'spacings')) : VALIDATE.spacings,
        pairs: int(args.pairs, 'pairs'), seed: int(args.seed, 'seed'), pauseMs: int(args.pause, 'pause'),
      });
    } else {
      throw new Error('usage: cli.js build|validate --theater <name> ...');
    }
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`terrain: ${e.message}\n`); process.exit(1); });
}

module.exports = { parseArgs, main };
