'use strict';

/* Data-file paths, JSON load/save helpers, and the shared mutable
   application state — pulled out of server.js so every routes/*.js module
   can `require('../store')` and read/write the *same* live objects (e.g.
   `state.members`) instead of each capturing its own stale copy.

   `state` is one object; routes mutate its properties in place
   (`state.events.push(...)`, `state.nextEventId++`, etc.) exactly as
   server.js used to mutate its own module-scope `let` variables. */

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const skillsCore = require('./public/js/skills-core.js');

const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const APPS_FILE = path.join(DATA_DIR, 'applications.json');
const SQUADRONS_FILE = path.join(DATA_DIR, 'squadrons.json');
const DISCORD_ROLES_FILE = path.join(DATA_DIR, 'discord-roles.json');
const ROLE_SORT_ORDER_FILE = path.join(DATA_DIR, 'role-sort-order.json');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const HERO_FILE = path.join(DATA_DIR, 'hero-image.json');
const SKILL_TREE_FILE = path.join(DATA_DIR, 'skill-tree.json');
const SKILL_GRADES_FILE = path.join(DATA_DIR, 'skill-grades.json');
const GRADING_REQS_FILE = path.join(DATA_DIR, 'grading-requests.json');
const PILOT_REGISTRY_FILE = path.join(DATA_DIR, 'pilot-registry.json');
const FLIGHT_PLANS_FILE = path.join(DATA_DIR, 'flight-plans.json');
const FLIGHT_PLANS_CFG_FILE = path.join(DATA_DIR, 'flight-plans-config.json');
const FPL1801_FILE = path.join(DATA_DIR, 'fpl1801.json');
const PILOT_SQ_OVERRIDES_FILE = path.join(DATA_DIR, 'pilot-squadron-overrides.json'); /* legacy — read once for migration */
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const BOOKING_RESOURCES_FILE = path.join(DATA_DIR, 'booking-resources.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const RELEASES_DIR = path.join(DATA_DIR, 'releases');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(RELEASES_DIR)) fs.mkdirSync(RELEASES_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function sanitizeStr(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

/**
 * Parse a Discord nickname in the format:  (foo) bar "CALLSIGN"
 * Returns the callsign from the quotes, or falls back to the bare display
 * name (the word after the parenthetical), or the whole nick as a last
 * resort. Pure string parsing — lives here (rather than discord-client.js)
 * so both discord-client.js and auth.js (registerPilot) can use it without
 * creating a require cycle between those two modules.
 */
/* Matches: (prefix) displayName "CALLSIGN" — captures CALLSIGN */
const RE_FULL_FORMAT = /^\([^)]*\)\s+[^"]+?\s+"([^"]*)"/;
/* Matches: (prefix) displayName (optionally followed by "CALLSIGN") — captures displayName */
const RE_BARE_FORMAT = /^\([^)]*\)\s+([^"]+?)(?:\s+"[^"]*")?$/;

function parseCallsign(nick) {
  if (!nick) return '';
  const full = nick.match(RE_FULL_FORMAT);
  if (full) {
    const cs = full[1].trim();
    if (cs) return cs;
  }
  const bare = nick.match(RE_BARE_FORMAT);
  if (bare) return bare[1];
  return nick.trim();
}

/* Skill tree migration: the old shape was { categories: [{ id, name, weight,
   squadrons?, modules: [{ id, title, description, min_pass_grade,
   prerequisites }] }] }. The new shape is a single recursive Module type —
   see public/js/skills-core.js. Each old category becomes a root Module
   (weight dropped); each old module becomes a child Module with exactly one
   grading item whose id equals the module's own id, so skill-grades.json
   needs no changes at all. Runs once at boot and persists the upgrade, so
   it's idempotent on every subsequent boot. */
function normalizeSkillTree(raw) {
  if (raw && raw.version === 2 && Array.isArray(raw.tree)) return raw;

  const cats = (raw && Array.isArray(raw.categories)) ? raw.categories : [];
  const tree = cats.map(cat => ({
    id: cat.id,
    title: cat.name || cat.id,
    description: cat.description || '',
    squadrons: (Array.isArray(cat.squadrons) && cat.squadrons.length) ? cat.squadrons : undefined,
    requirements: [],
    subModules: (cat.modules || []).map(mod => ({
      id: mod.id,
      title: mod.title || mod.id,
      description: mod.description || '',
      requirements: Array.isArray(mod.prerequisites) ? mod.prerequisites : [],
      subModules: [],
      gradingItems: [{
        id: mod.id,
        min_pass_grade: skillsCore.VALID_GRADES.includes(mod.min_pass_grade) ? mod.min_pass_grade : 'G',
      }],
    })),
    gradingItems: [],
  }));

  return { version: 2, tree };
}

/* Default gallery (used when gallery.json does not yet exist in the volume) */
const DEFAULT_GALLERY = [
  { src: 'gallery/shot-01.svg', alt: 'Formation Flight — Dawn Patrol over Caucasus', caption: 'FORMATION FLIGHT · CAUCASUS THEATRE · DAWN PATROL' },
  { src: 'gallery/shot-02.svg', alt: 'Night Operations — Overwatch over the Gulf',   caption: 'NIGHT OPERATIONS · PERSIAN GULF · OVERWATCH' },
  { src: 'gallery/shot-03.svg', alt: 'Dusk Intercept — Afterburner Run',              caption: 'DUSK INTERCEPT · COASTAL SWEEP · AFTERBURNER RUN' },
  { src: 'gallery/shot-04.svg', alt: 'CAS Mission — Mountain Valley Run',             caption: 'CAS MISSION · CAUCASUS WINTER · MOUNTAIN VALLEY RUN' },
  { src: 'gallery/shot-05.svg', alt: 'Carrier Approach — Case I Recovery',            caption: 'CARRIER APPROACH · PERSIAN GULF · CASE I RECOVERY' },
  { src: 'gallery/shot-06.svg', alt: 'Precision Strike — GBU-12 Delivery',            caption: 'PRECISION STRIKE · SYRIAN THEATRE · GBU-12 DELIVERY' },
];
const DEFAULT_HERO = { src: 'gallery/shot-01.svg', alt: 'Formation Flight — Dawn Patrol over Caucasus', caption: 'FORMATION FLIGHT · CAUCASUS THEATRE · DAWN PATROL' };

const rawGallery = loadJSON(GALLERY_FILE, null);
const rawHero = loadJSON(HERO_FILE, null);
const rawRoleSortOrder = loadJSON(ROLE_SORT_ORDER_FILE, null);

const DEFAULT_ROLE_SORT_ORDER = ['Project Lead', 'Squadron Lead', 'Flight Lead', 'Element Lead', 'RIO', 'Pilot'];
/* Fixed set of role labels selectable as a manual override on the squadron
   admin page. The auto-derived role (from Discord role mapping) remains
   free text, same as before — this list only constrains manual overrides. */
const ROLE_LABELS = ['Member', 'Pilot', 'Element Lead', 'Flight Lead', 'Squadron Lead', 'Admin'];

const VALID_GRADES = new Set(['U', 'F', 'G', 'E']);
const ROSTER_CACHE_TTL = 5 * 60 * 1000; /* 5 minutes */
const EVENTS_SYNC_TTL = 5 * 60 * 1000; /* 5 minutes */

/* ─── External link config (read from env) ──────────────── */
const DISCORD_URL = process.env.DISCORD_URL || 'https://discord.gg/sourcedcs';
const WIKI_URL = process.env.WIKI_URL || 'https://wiki.sourcedcs.page';
const ATO_URL = process.env.ATO_URL || 'https://ato.sourcedcs.page';
const OLYMPUS_URL = process.env.OLYMPUS_URL || 'https://olympus.sourcedcs.page';
const ASACS_URL = process.env.ASACS_URL || 'https://asacs.sourcedcs.page';
const GITHUB_URL = process.env.GITHUB_URL || 'https://github.com/NikNam3/sourcedcs';

const events = loadJSON(EVENTS_FILE, []);
const bookings = loadJSON(BOOKINGS_FILE, []);
const gradingRequests = loadJSON(GRADING_REQS_FILE, []);
const flightPlans = loadJSON(FLIGHT_PLANS_FILE, []);
const skillTreeLoaded = normalizeSkillTree(loadJSON(SKILL_TREE_FILE, { version: 2, tree: [] }));
saveJSON(SKILL_TREE_FILE, skillTreeLoaded); /* persist the upgrade once; no-op if already current */

/* Single shared mutable state object — every routes/*.js module reads and
   writes these properties directly (e.g. `state.events.push(x)`,
   `state.skillTree = newTree`, `state.nextEventId++`). Because Node caches
   `require('./store')`, every module sees this exact same object. */
const state = {
  events,
  nextEventId: events.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1,
  applications: loadJSON(APPS_FILE, []),
  squadrons: loadJSON(SQUADRONS_FILE, []),
  bookingResources: loadJSON(BOOKING_RESOURCES_FILE, { ranges: [], controllers: [], notifyChannelId: '' }),
  bookings,
  nextBookingId: bookings.reduce((m, b) => Math.max(m, b.id || 0), 0) + 1,
  skillTree: skillTreeLoaded,
  skillGrades: loadJSON(SKILL_GRADES_FILE, {}),
  gradingRequests,
  nextGradingReqId: gradingRequests.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1,
  pilotRegistry: loadJSON(PILOT_REGISTRY_FILE, {}),
  flightPlans,
  nextFlightPlanId: flightPlans.reduce((m, fp) => Math.max(m, fp.id || 0), 0) + 1,
  fpConfig: loadJSON(FLIGHT_PLANS_CFG_FILE, { controllerSquadron: '' }),
  fpl1801Plans: loadJSON(FPL1801_FILE, []),
  discordRoles: loadJSON(DISCORD_ROLES_FILE, {}),
  roleSortOrder: Array.isArray(rawRoleSortOrder) ? rawRoleSortOrder : DEFAULT_ROLE_SORT_ORDER,
  members: loadJSON(MEMBERS_FILE, {}),
  membersCacheAt: 0,
  gallery: Array.isArray(rawGallery) ? rawGallery : DEFAULT_GALLERY,
  heroImage: (rawHero && typeof rawHero === 'object' && !Array.isArray(rawHero)) ? rawHero : DEFAULT_HERO,
};
state.nextFpl1801Id = state.fpl1801Plans.reduce((m, fp) => Math.max(m, fp.id || 0), 0) + 1;

/* Multer — images land in the data volume (not in the Docker image) */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      /* Use timestamp + random suffix; strip any path components from the extension */
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, /* 20 MB */
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only JPEG, PNG, WebP or GIF files are allowed'), ok);
  },
});

/* Release installers/manifests — CI-uploaded, land in the data volume under
   their real filenames (not randomized) so electron-updater's generic
   provider can find latest.yml/latest-linux.yml and the installer they
   reference by exact name. */
const uploadRelease = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RELEASES_DIR),
    filename: (_req, file, cb) => cb(null, path.basename(file.originalname)),
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, /* 300 MB */
  fileFilter: (_req, file, cb) => {
    const ok = /\.(exe|AppImage|yml|blockmap)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .exe, .AppImage, .yml or .blockmap files are allowed'), ok);
  },
});

module.exports = {
  upload, uploadRelease,
  DATA_DIR, EVENTS_FILE, APPS_FILE, SQUADRONS_FILE, DISCORD_ROLES_FILE,
  ROLE_SORT_ORDER_FILE, GALLERY_FILE, HERO_FILE, SKILL_TREE_FILE,
  SKILL_GRADES_FILE, GRADING_REQS_FILE, PILOT_REGISTRY_FILE,
  FLIGHT_PLANS_FILE, FLIGHT_PLANS_CFG_FILE, FPL1801_FILE,
  PILOT_SQ_OVERRIDES_FILE, MEMBERS_FILE, BOOKING_RESOURCES_FILE,
  BOOKINGS_FILE, UPLOADS_DIR, RELEASES_DIR,
  loadJSON, saveJSON, sanitizeStr, parseCallsign, normalizeSkillTree,
  VALID_GRADES, ROLE_LABELS, DEFAULT_ROLE_SORT_ORDER,
  ROSTER_CACHE_TTL, EVENTS_SYNC_TTL,
  DISCORD_URL, WIKI_URL, ATO_URL, OLYMPUS_URL, ASACS_URL, GITHUB_URL,
  state,
};
