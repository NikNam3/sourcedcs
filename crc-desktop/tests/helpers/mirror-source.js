'use strict';

// Test-only helpers for the parity tests (docs/wip/PARITY.md). Classic browser
// scripts keep some mirrored tables un-exported (module-scope `const`s), so a
// parity test reads the literal out of the shipped source and evaluates just
// that literal. If the declaration moves or is renamed the helper throws, which
// is a loud failure rather than a silent skip.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..', '..', '..');
const CLIENT_JS = path.join(REPO, 'crc-desktop/app/public/js');
const SERVER_SRC = path.join(REPO, 'crc-sync/src');

const readClient = (rel) => fs.readFileSync(path.join(CLIENT_JS, rel), 'utf8');
const readServer = (rel) => fs.readFileSync(path.join(SERVER_SRC, rel), 'utf8');

/** Evaluates `const|let NAME = <literal>;` out of `src`; the literal must end at the first `;` at line end. */
function constLiteral(src, name, where = '') {
  const re = new RegExp(`^(?:const|let)\\s+${name}\\s*=\\s*([\\s\\S]*?);[ \\t]*(?://.*)?$`, 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`${where}: cannot find "const ${name} = ...;" — it was renamed or moved; update the parity test`);
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${m[1]})`, {})));
}

/** All `type: 'x'` literals matching `re` (one capture group) in src, as a sorted unique array. */
function matchAll(src, re) {
  const out = new Set();
  for (const m of src.matchAll(re)) out.add(m[1]);
  return [...out].sort();
}

module.exports = { REPO, CLIENT_JS, SERVER_SRC, readClient, readServer, constLiteral, matchAll };
