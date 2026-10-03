'use strict';
/* The one place sourcedcs-web reads and writes its JSON files.
   saveJSON is atomic: a sibling temp file is written and fsynced, then renamed over the live one,
   so a crash or SIGKILL mid-write leaves the previous intact file (rename is atomic within a filesystem).
   loadJSON returns the fallback for a missing file only. A file that exists but does not parse is
   renamed to <name>.corrupt-<timestamp> and logged, so the next save cannot overwrite the evidence. */
const fs = require('fs');
const log = require('./logger');

function loadJSON(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err && err.code !== 'ENOENT') log.error(`[json-file] cannot read ${file}: ${err.message}`);
    return fallback;
  }
  try { return JSON.parse(raw); }
  catch (err) {
    const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      fs.renameSync(file, aside);
      log.error(`[json-file] ${file} is not valid JSON (${err.message}); set aside as ${aside}`);
    } catch (renameErr) {
      log.error(`[json-file] ${file} is not valid JSON (${err.message}) and could not be set aside: ${renameErr.message}`);
    }
    return fallback;
  }
}

function saveJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(data, null, 2), null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
}

module.exports = { loadJSON, saveJSON };
