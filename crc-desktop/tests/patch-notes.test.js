'use strict';

/* Regression/behavior tests for the "what's new" patch-notes system: an
   update-downloaded event fires in the OLD process, before restart, so
   there's no window left to show the notes in by the time the app is
   actually running the new version -- patch-notes.js persists them to a
   file and reads+clears it on the next launch instead. See patch-notes.js's
   own top comment for the full flow. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeReleaseNotes, notesSince, writePendingPatchNotes, readAndClearPendingPatchNotes,
} = require('../patch-notes');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-notes-test-'));
  return path.join(dir, 'pending-patch-notes.json');
}

/* ══════════════════════════════════════════════════════════
   normalizeReleaseNotes -- electron-updater's UpdateInfo.releaseNotes is
   typed as string | ReleaseNoteInfo[] | null depending on provider/config.
══════════════════════════════════════════════════════════ */

test('normalizeReleaseNotes: plain string is trimmed', () => {
  assert.equal(normalizeReleaseNotes('  - fixed a bug\n'), '- fixed a bug');
});

test('normalizeReleaseNotes: null/undefined/empty string is null', () => {
  assert.equal(normalizeReleaseNotes(null), null);
  assert.equal(normalizeReleaseNotes(undefined), null);
  assert.equal(normalizeReleaseNotes('   '), null);
});

test('normalizeReleaseNotes: ReleaseNoteInfo[] is joined into one block', () => {
  const result = normalizeReleaseNotes([
    { version: '1.2.0', note: 'Added thing A' },
    { version: '1.1.0', note: 'Fixed thing B' },
  ]);
  assert.equal(result, 'Added thing A\n\nFixed thing B');
});

test('normalizeReleaseNotes: array entries with no note are skipped, empty array is null', () => {
  assert.equal(normalizeReleaseNotes([{ version: '1.0.0', note: null }]), null);
  assert.equal(normalizeReleaseNotes([]), null);
});

/* ══════════════════════════════════════════════════════════
   writePendingPatchNotes / readAndClearPendingPatchNotes roundtrip
══════════════════════════════════════════════════════════ */

test('roundtrip: notes written for a version are read back and the file is cleared', () => {
  const file = tmpFile();
  writePendingPatchNotes(file, { version: '1.2.0', notes: 'New stuff' });

  const result = readAndClearPendingPatchNotes(file, '1.2.0');
  assert.deepEqual(result, { version: '1.2.0', notes: 'New stuff' });
  assert.equal(fs.existsSync(file), false, 'pending file must be cleared after being read');
});

test('writePendingPatchNotes: no file written when notes are empty', () => {
  const file = tmpFile();
  writePendingPatchNotes(file, { version: '1.2.0', notes: null });
  assert.equal(fs.existsSync(file), false);
});

test('readAndClearPendingPatchNotes: missing file returns null', () => {
  const file = tmpFile();
  assert.equal(readAndClearPendingPatchNotes(file, '1.2.0'), null);
});

test('readAndClearPendingPatchNotes: version mismatch discards the stale file and returns null', () => {
  // A second update landed (or the user reinstalled an older build) before
  // ever relaunching into the version the pending notes were written for --
  // showing them now would be misleading, and leaving the file behind would
  // let it resurface on some unrelated future launch.
  const file = tmpFile();
  writePendingPatchNotes(file, { version: '1.2.0', notes: 'New stuff' });

  const result = readAndClearPendingPatchNotes(file, '1.3.0');
  assert.equal(result, null);
  assert.equal(fs.existsSync(file), false, 'stale file must still be cleared even when not shown');
});

test('readAndClearPendingPatchNotes: corrupt JSON is treated as absent, not a crash', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not valid json');
  assert.equal(readAndClearPendingPatchNotes(file, '1.2.0'), null);
  assert.equal(fs.existsSync(file), false);
});

const ALL_NOTES = ['### Changed in 2.3.1', '- new A', '', '### Changed in 2.3.0', '- new B', '', '### Fixed in 2.1.5', '- fix C'].join('\n');

test('notesSince: only the versions this update brings, newest first', () => {
  assert.equal(notesSince(ALL_NOTES, '2.3.0', '2.3.1'), '### Changed in 2.3.1\n- new A');
  assert.equal(notesSince(ALL_NOTES, '2.1.5', '2.3.1'), '### Changed in 2.3.1\n- new A\n\n### Changed in 2.3.0\n- new B');
  assert.equal(notesSince(ALL_NOTES, null, '2.3.0'), '### Changed in 2.3.0\n- new B', 'no previous version: the new one only');
  assert.equal(notesSince('- just a line', '2.3.0', '2.3.1'), '- just a line', 'no headings: whole');
  assert.equal(notesSince(ALL_NOTES, '2.3.1', '2.3.1'), '### Changed in 2.3.1\n- new A', 'nothing newer: the newest section');
});

test('writePendingPatchNotes keeps only the sections after fromVersion', () => {
  const file = require('path').join(require('os').tmpdir(), `pn-${process.pid}-${Date.now()}.json`);
  writePendingPatchNotes(file, { version: '2.3.1', notes: ALL_NOTES, fromVersion: '2.3.0' });
  assert.deepEqual(JSON.parse(require('fs').readFileSync(file, 'utf8')), { version: '2.3.1', notes: '### Changed in 2.3.1\n- new A', fromVersion: '2.3.0' });
  require('fs').unlinkSync(file);
});

test('a pending file from an older CRC (all notes, no fromVersion) shows only the new version', () => {
  const file = require('path').join(require('os').tmpdir(), `pn-old-${process.pid}-${Date.now()}.json`);
  require('fs').writeFileSync(file, JSON.stringify({ version: '2.3.1', notes: ALL_NOTES }));
  assert.deepEqual(readAndClearPendingPatchNotes(file, '2.3.1'), { version: '2.3.1', notes: '### Changed in 2.3.1\n- new A' });
});
