'use strict';

/* Removes the throwaway state directory the runner made (playwright.config.js), and the reset marker inside it. Only the process
 * that created the directory removes it; a directory the caller supplied through E2E_STATE_DIR is theirs to keep. */

const fs = require('fs');

module.exports = async () => {
  if (process.env.E2E_STATE_DIR_OWNER !== String(process.pid)) return;
  fs.rmSync(process.env.E2E_STATE_DIR, { recursive: true, force: true });
};
