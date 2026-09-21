'use strict';

// Where runtime state lives, as opposed to where shipped defaults live.
//
// Everything this service writes used to be written into `config/`, next to
// the hand-edited squadron data — and `config/` is baked into the Docker image
// with no volume, so every `docker compose up -d` that recreated the container
// discarded all of it. docs/adr/0002 makes the Board durable and
// docs/adr/0041 went to some trouble to make `_persist` atomic; neither
// survived the deployment. Seven separate things were affected, not one:
//
//   efsp-board.json       the whole Board — Strips, FDRs, airspace, correlation
//   efsp-mutations.jsonl  the entire audit trail
//   squawk-map.json       squadron squawk->callsign edits, made live from any client
//   theater-settings.json transition altitude, heading correction, game-time offset
//   apt-config.json       per-airport ATIS frequency/runway/info/manual weather
//   efsp-facility-*.json  facility config edits
//   efsp-airspaces.json   the MOA and range definitions
//
// Two of them were also COMMITTED TO GIT, which is worse than losing them: a
// deploy shipped an old snapshot of somebody's board into the image, and a
// recreated container restored that instead of what controllers had actually
// done. Silently reverting is a nastier failure than starting empty.
//
// So: two directories, and a read rule.
//
//   config/  shipped defaults. Baked into the image, effectively read-only.
//   data/    everything written at runtime. A volume in the compose stack.
//
// Reads prefer `data/`, falling back to the shipped default in `config/`.
// Writes always go to `data/`. That gives three properties worth having:
//
//   - first boot reads the shipped default and writes to the volume;
//   - later boots read the volume;
//   - an image update that adds a NEW default file lands without a migration,
//     because a file not yet in the volume still falls back to the image.
//
// That last one is docs/adr/0041's question answered in advance — "what
// happens to this the next time the code grows" — for the deployment rather
// than for a config list.
//
// Every caller keeps its own explicit env override (CRCSYNC_EFSP_BOARD_
// SNAPSHOT_PATH and friends), and an override wins for BOTH read and write.
// Every test file in this package sets one to point at a temp file, and they
// must keep behaving identically.

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = process.env.CRCSYNC_CONFIG_DIR || path.join(__dirname, '../config');
const DATA_DIR = process.env.CRCSYNC_DATA_DIR || path.join(__dirname, '../data');

/** Where a runtime-mutable file is written. Always the data directory. */
function writePath(name, override) {
  return override || path.join(DATA_DIR, name);
}

/**
 * Where to read it from: the live copy in `data/` if one exists, otherwise the
 * shipped default in `config/`.
 *
 * Resolved per call rather than once at load, because "does the live copy
 * exist" changes the first time anything writes one.
 */
function readPath(name, override) {
  if (override) return override;
  const live = path.join(DATA_DIR, name);
  try {
    if (fs.existsSync(live)) return live;
  } catch {
    // An unreadable data directory is a deployment problem, not a reason to
    // fail: fall back to the shipped default, which is better than nothing.
  }
  return path.join(CONFIG_DIR, name);
}

/**
 * Both, for a module that reads once at load and writes later.
 * @returns {{read:string, write:string}}
 */
function statePaths(name, override) {
  return { read: readPath(name, override), write: writePath(name, override) };
}

/**
 * Makes sure the directory a state file is about to be written to exists.
 * Called before every write rather than once at startup: the data directory is
 * a volume mount, so it can be absent, and a service that cannot persist
 * should say which file it failed on rather than failing at boot for a file
 * nobody has touched yet.
 */
function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

module.exports = { CONFIG_DIR, DATA_DIR, readPath, writePath, statePaths, ensureDirFor };
