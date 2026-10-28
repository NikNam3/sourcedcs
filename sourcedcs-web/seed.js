'use strict';
/* Copy seed files into the data dir ONLY where the target does not exist.
   Never overwrites, never deletes: a prod volume that already holds a file
   (skill-tree.json, ...) keeps it byte-for-byte. A missing seed dir is a no-op,
   so this does nothing until seed files are actually shipped (docs/wip/INFRA2.md). */
const fs = require('fs');
const path = require('path');

function seedDataDir(dataDir, seedDir) {
  const copied = [];
  let names;
  try { names = fs.readdirSync(seedDir); } catch { return copied; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const dest = path.join(dataDir, name);
    try {
      /* COPYFILE_EXCL fails if dest exists: atomic "create only if absent". */
      fs.copyFileSync(path.join(seedDir, name), dest, fs.constants.COPYFILE_EXCL);
      copied.push(name);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return copied;
}

module.exports = { seedDataDir };
