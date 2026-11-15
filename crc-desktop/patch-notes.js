'use strict';

/* "What's new" system for the auto-updater.
 *
 * electron-builder auto-picks up build-assets/release-notes.md at build
 * time (package.json's build.directories.buildResources points there --
 * the default "build/" is repo-wide gitignored, see that config's comment)
 * and embeds its content into latest.yml/latest-linux.yml as UpdateInfo's
 * releaseNotes field (see app-builder-lib's getResource() convention).
 *
 * electron-updater's 'update-downloaded' event fires in the *old* process,
 * before restart -- there's no window left to show a "what's new" dialog
 * in once the new version is actually running. So we persist the notes to
 * a small file in userData at download time, then read+clear it on the
 * next launch once app.getVersion() confirms we're actually on that
 * version (kept Electron-free like lxsrs-setup.js, for unit testing
 * without a real Electron process).
 */

const fs = require('fs');

function normalizeReleaseNotes(releaseNotes) {
  if (releaseNotes == null) return null;
  if (typeof releaseNotes === 'string') {
    const trimmed = releaseNotes.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(releaseNotes)) {
    // electron-updater's ReleaseNoteInfo[] shape (one entry per version
    // skipped since the last install) -- join into one block.
    const joined = releaseNotes
      .map(entry => (entry && typeof entry.note === 'string' ? entry.note.trim() : ''))
      .filter(Boolean)
      .join('\n\n');
    return joined.length > 0 ? joined : null;
  }
  return null;
}

// build-assets/release-notes.md carries every version's section ("### Changed in 2.3.1", "### Fixed in 2.1.5", ...),
// newest first. What's New shows only the versions this update brings: newer than the one the controller had
// (`fromVersion`) up to the new one. Without a usable `fromVersion`, only the new version's own sections. Notes with no
// such headings are shown whole.
const SECTION_RE = /^#{1,6}\s.*?\bin\s+v?(\d+\.\d+\.\d+)\b.*$/;

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

function notesSince(notes, fromVersion, toVersion) {
  const lines = String(notes).split(/\r?\n/);
  const sections = [];
  for (const line of lines) {
    const m = SECTION_RE.exec(line);
    if (m) sections.push({ version: m[1], lines: [line] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
  }
  if (!sections.length) return notes;
  const valid = (v) => typeof v === 'string' && /^v?\d+\.\d+\.\d+/.test(v);
  const to = valid(toVersion) ? toVersion.replace(/^v/, '') : null;
  const from = valid(fromVersion) ? fromVersion.replace(/^v/, '') : null;
  const keep = sections.filter(sec => (to ? compareVersions(sec.version, to) <= 0 : true)
    && (from ? compareVersions(sec.version, from) > 0 : (to ? compareVersions(sec.version, to) === 0 : sec === sections[0])));
  const chosen = keep.length ? keep : [sections[0]];
  return chosen.map(sec => sec.lines.join('\n').trim()).join('\n\n');
}

function writePendingPatchNotes(filePath, { version, notes, fromVersion = null }) {
  const all = normalizeReleaseNotes(notes);
  const normalized = all && notesSince(all, fromVersion, version);
  if (!version || !normalized) return;
  fs.writeFileSync(filePath, JSON.stringify({ version, notes: normalized, fromVersion: fromVersion || null }));
}

function readAndClearPendingPatchNotes(filePath, currentVersion) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  // Clear unconditionally: whether we're about to show these notes (version
  // matches) or they're stale (a second update landed, or the user
  // downgraded, before the app was ever relaunched), a leftover file must
  // never resurface on some unrelated future launch.
  try { fs.unlinkSync(filePath); } catch {}

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || parsed.version !== currentVersion || typeof parsed.notes !== 'string') return null;
  // Trimmed here too: a file written by a version before this rule holds every version's notes.
  return { version: parsed.version, notes: notesSince(parsed.notes, parsed.fromVersion || null, parsed.version) };
}

// Separate from the one-shot "pending" file above: this copy is never
// cleared, so a "what's new" button in the UI can re-show the last update's
// notes at any time instead of the controller having to catch the one-time
// dialog on the exact launch after an autoupdate lands.
function readLastPatchNotes(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed.version !== 'string' || typeof parsed.notes !== 'string') return null;
  return { version: parsed.version, notes: notesSince(parsed.notes, parsed.fromVersion || null, parsed.version) };
}

module.exports = {
  normalizeReleaseNotes, notesSince, writePendingPatchNotes, readAndClearPendingPatchNotes,
  readLastPatchNotes,
};
