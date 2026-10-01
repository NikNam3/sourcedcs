'use strict';

/* Static sanity checks on package.json's electron-builder config and on
   app/'s own dependency tree. Both encode real regressions hit while
   shipping crc-desktop's packaging pipeline -- see each test's comment for
   which bug it reproduces. These are cheap (no electron-builder run, no
   Electron download) so they run on every `npm test`; a full "actually
   package and inspect the asar" check would be far slower and isn't
   needed to catch either bug class here. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const appPkgPath = path.join(__dirname, '..', 'app', 'package.json');
const appPkg = fs.existsSync(appPkgPath) ? JSON.parse(fs.readFileSync(appPkgPath, 'utf8')) : null;

test('build.directories.app is pinned to the project root', () => {
  // Regression: app/ has its own package.json (app/server.js's "crc-server"
  // package), which matches electron-builder's built-in "two package.json
  // structure" convention -- left unset, it auto-detects app/ as the real
  // app root and packages everything relative to THAT, silently dropping
  // main.js (and config.json, and the root package.json's own "main"
  // entry) from the asar entirely. See computeDefaultAppDirectory in
  // electron-builder's own source for the auto-detection this overrides.
  assert.equal(pkg.build && pkg.build.directories && pkg.build.directories.app, '.');
});

test('build.files includes package.json and main.js explicitly', () => {
  // Regression: a custom `files` array replaces electron-builder's
  // defaults entirely rather than extending them. Without these listed,
  // electron-builder fell back to whatever package.json *did* get matched
  // by the glob (app/package.json, via `app/**/*`) as the app's entry-point
  // manifest, and it declares "main": "server.js" -- the exact symptom
  // hit was "Application entry file server.js ... was not found".
  const files = (pkg.build && pkg.build.files) || [];
  assert.ok(files.includes('package.json'), 'files must explicitly include package.json');
  assert.ok(files.includes('main.js'), 'files must explicitly include main.js');
});

test('build.files does not exclude app/node_modules', () => {
  // Regression: app/server.js does `require('dotenv')`, resolved from
  // app/node_modules/dotenv. An earlier version of this files array had
  // "!app/node_modules/**/*", which packaged an app/server.js that could
  // never find dotenv at runtime ("Cannot find module 'dotenv'").
  const files = (pkg.build && pkg.build.files) || [];
  const excludesAppNodeModules = files.some(f => /^!.*app\/node_modules/.test(f));
  assert.equal(excludesAppNodeModules, false);
});

test('app/package.json exists and declares at least one dependency', () => {
  // Sanity check the fixture the next test depends on hasn't drifted away
  // (e.g. app/ getting restructured without updating this suite).
  assert.ok(appPkg, 'app/package.json should exist -- app/server.js is packaged as its own "crc-server" package');
  assert.ok(Object.keys(appPkg.dependencies || {}).length > 0);
});

test('every app/package.json dependency is actually present in app/node_modules', () => {
  // Regression: app/node_modules is gitignored like any node_modules, so a
  // fresh CI checkout never has it. crc-desktop-release.yml originally
  // only ran `npm ci` at the crc-desktop root, never inside app/ -- the
  // packaged asar was missing app/node_modules/dotenv, and app/server.js
  // crashed on startup with "Cannot find module 'dotenv'". Run this
  // *after* `npm ci --prefix app` runs (see the CI workflow's "Install
  // app/ dependencies" step and this repo's own `npm test`, which needs
  // the same) -- on a clean checkout with no app/node_modules yet, this
  // test is *supposed* to fail loudly rather than let packaging silently
  // ship a broken app/server.js.
  if (!appPkg) return; // covered by the previous test
  const missing = Object.keys(appPkg.dependencies || {})
    .filter(dep => !fs.existsSync(path.join(__dirname, '..', 'app', 'node_modules', dep)));
  assert.deepEqual(missing, [], `app/node_modules is missing: ${missing.join(', ')} -- run "npm ci" inside crc-desktop/app first`);
});

test('every local require in main.js is covered by build.files', () => {
  // Regression: this is the general form of the "package.json and main.js
  // must be listed explicitly" bug above -- lxsrs-setup.js was extracted
  // out of main.js into its own file (to make it unit-testable) and never
  // added to `files`. Unlike the hardcoded check above, THIS test would
  // have caught that the moment the require() was added, without anyone
  // needing to remember to add a matching assertion for every new file --
  // it parses main.js's own require('./...') calls and checks each one
  // actually resolves to something covered by `files`, instead of hardcoding
  // filenames. The bug shipped a build that crashed instantly on launch
  // with "Cannot find module './lxsrs-setup'" on every platform.
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const localRequires = [...mainJs.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)].map(m => m[1]);
  assert.ok(localRequires.length > 0, 'sanity check: main.js should have at least one local require for this test to mean anything');

  const files = (pkg.build && pkg.build.files) || [];
  const root = path.join(__dirname, '..');

  for (const req of localRequires) {
    const resolved = ['', '.js', '.json']
      .map(ext => req + ext)
      .find(candidate => fs.existsSync(path.join(root, candidate)));
    assert.ok(resolved, `main.js requires './${req}' but no matching .js/.json file exists on disk`);

    const topLevelDir = resolved.includes('/') ? resolved.split('/')[0] : null;
    const covered = topLevelDir
      // Nested path (e.g. app/server.js) -- this repo only ever covers a
      // whole directory with a `<dir>/**/*` glob, never lists nested files
      // individually, so a prefix match is the right (and sufficient) check.
      ? files.some(f => f.startsWith(topLevelDir + '/'))
      // Flat top-level file -- a custom `files` array replaces
      // electron-builder's defaults rather than extending them, so it must
      // be listed explicitly; nothing here falls back to a default include.
      : files.includes(resolved);

    assert.ok(covered, `main.js requires './${req}' (resolves to ${resolved}) but it isn't covered by build.files -- the packaged app will crash with "Cannot find module './${req}'"`);
  }
});

test('linux.syncDesktopName is paired with a top-level desktopName', () => {
  // Regression: desktopName only takes effect when read from the *root*
  // package.json (app.isPackaged's `packager.info.metadata.desktopName`
  // in electron-builder's LinuxTargetHelper) -- it does nothing placed
  // under build.linux, where it's easy to mistakenly nest it alongside
  // syncDesktopName.
  const syncsDesktopName = !!(pkg.build && pkg.build.linux && pkg.build.linux.syncDesktopName);
  if (syncsDesktopName) {
    assert.ok(pkg.desktopName, 'syncDesktopName is set but no top-level desktopName exists for it to sync');
  }
});

test('build.files packs app/public/js/package.json (the client is ES modules)', () => {
  // ESM-1: app/public/js/package.json ({"type":"module"}) is what makes Node treat the client files as ES modules
  // for the unit tests. The browser does not need it (index.html loads js/main.js with type="module"), but it
  // must still ship, so the packaged tree is the tested tree. `app/**/*` packs it; `!app/package.json` excludes
  // only the top one.
  const rel = 'app/public/js/package.json';
  assert.ok(fs.existsSync(path.join(__dirname, '..', rel)), `${rel} is missing`);
  const toRe = (glob) => new RegExp('^' + glob.split('**/').map(part => part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('(?:.*/)?') + '$');
  const files = (pkg.build && pkg.build.files) || [];
  let included = false;
  for (const f of files) {
    if (f.startsWith('!')) { if (toRe(f.slice(1)).test(rel)) included = false; }
    else if (toRe(f).test(rel)) included = true;
  }
  assert.ok(included, `build.files does not pack ${rel}`);
});
