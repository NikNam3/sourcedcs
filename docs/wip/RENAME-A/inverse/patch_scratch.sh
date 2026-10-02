#!/bin/sh
# S-RENA1 proof: patch a SCRATCH copy of crc-sync (never the worktree) so the raw-text hashes go through the inverse.
set -e
cd "$1"
sed -i "s|const raw = fs.readFileSync(this.boardPath, 'utf8');|const raw = globalThis.__renameInv(fs.readFileSync(this.boardPath, 'utf8'));|" tests/freeze/freeze-world.mjs
sed -i "s|    this.digest.update(line);|    this.digest.update(globalThis.__renameInv ? globalThis.__renameInv(line) : line);|" tools/soak/driver.js
grep -c "__renameInv" tests/freeze/freeze-world.mjs tools/soak/driver.js
