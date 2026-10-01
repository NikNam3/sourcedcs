'use strict';

// crc-desktop release manifest parsing + upload auth, pulled out of
// server.js so it can be unit tested as pure functions without requiring
// server.js (which has side effects on load -- reading env-derived config,
// creating data directories, etc).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* Minimal reader for electron-builder's latest.yml/latest-linux.yml — both
   are a small, flat, known schema (version/path/sha512/size/releaseDate at
   the top level, plus a `files` array with the same per-file fields), so a
   couple of regexes cover it without pulling in a YAML dependency this repo
   doesn't otherwise need. Takes the raw file content directly (not a path)
   so it's trivial to unit test. */
function parseReleaseManifest(raw) {
  if (raw == null) return null;
  // `size` only appears nested under the `files:` list entries, not at the
  // top level, so this intentionally doesn't anchor to line-start like
  // version/path do.
  // `.+` (not `\S+`) for path — electron-builder's Windows installer
  // filenames contain spaces (e.g. "CRC Setup 1.0.7.exe"), which a
  // whitespace-delimited match would truncate at the first space. This
  // exact bug shipped once already: /api/releases/latest returned
  // "/downloads/CRC" instead of the real installer.
  const version = (raw.match(/^version:\s*(\S+)/m) || [])[1];
  const file     = (raw.match(/^path:\s*(.+?)\r?$/m) || [])[1];
  const size     = (raw.match(/\bsize:\s*(\d+)/) || [])[1];
  if (!version || !file) return null;
  return { version, url: '/downloads/' + encodeURIComponent(file), size: size ? parseInt(size, 10) : null };
}

/* Constant-time bearer-token check for POST /api/releases/upload (crc-desktop
   release CI has no interactive Casdoor session, so this is a separate
   shared-secret check rather than requireAuth/requireAdmin). Returns false
   (never throws) for an empty/unset expectedToken, an empty provided token,
   or a length mismatch -- crypto.timingSafeEqual throws on unequal-length
   buffers, which a naive direct call would need to guard anyway. */
function checkReleaseUploadToken(providedToken, expectedToken) {
  if (!expectedToken) return false;
  const expected = Buffer.from(expectedToken);
  const actual   = Buffer.from(providedToken || '');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/* Installer retention. Every release uploads an installer (+ blockmap) of up
   to 300 MB into the data volume under its real filename, so without pruning
   the volume only grows. Keeps the newest `keep` versions per platform (by
   the version in the filename, compared numerically) and deletes the older
   installers and their .blockmap files. Never deletes: the manifests
   (*.yml), a file the latest manifest names (or its .blockmap), or anything
   not recognisably an installer. Returns the deleted filenames. */
const INSTALLER_RE = /^(.*?)(\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?)\.(exe|AppImage)(\.blockmap)?$/;

function compareVersions(a, b) {
  const pa = a.split('-')[0].split('.').map(Number), pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function pruneReleases(dir, { keep = 3 } = {}) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const protectedNames = new Set();
  for (const m of ['latest.yml', 'latest-linux.yml']) {
    let raw;
    try { raw = fs.readFileSync(path.join(dir, m), 'utf8'); } catch { continue; }
    const file = (raw.match(/^path:\s*(.+?)\r?$/m) || [])[1];
    if (file) { protectedNames.add(file); protectedNames.add(file + '.blockmap'); }
  }
  const byPlatform = { exe: new Map(), AppImage: new Map() };
  for (const name of names) {
    const m = INSTALLER_RE.exec(name);
    if (!m) continue;
    const versions = byPlatform[m[3]];
    if (!versions.has(m[2])) versions.set(m[2], []);
    versions.get(m[2]).push(name);
  }
  const deleted = [];
  for (const versions of Object.values(byPlatform)) {
    const ordered = [...versions.keys()].sort(compareVersions).reverse();
    for (const v of ordered.slice(keep)) {
      for (const name of versions.get(v)) {
        if (protectedNames.has(name)) continue;
        try { fs.unlinkSync(path.join(dir, name)); deleted.push(name); } catch { /* best effort */ }
      }
    }
  }
  return deleted;
}

module.exports = { parseReleaseManifest, checkReleaseUploadToken, pruneReleases };
