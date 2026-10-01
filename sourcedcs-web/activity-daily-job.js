'use strict';
const log = require('./logger');

/* Rebuilds every member's activity-score history once per squadron-wide
   "day" (05:00 UTC, see discord-gateway.js's localDateKey), from
   data/voice-activity.json — the voice_day source of truth — and caches
   the result both in memory (for server.js's API routes) and on disk at
   data/activity-scores.json.

   Always a full recompute, never an incremental update to a stored S_raw
   (see ACTIVITY_SCORE.md §4, "recompute, don't accumulate") — a missed
   tick just means the next one recomputes the same history again, so
   nothing can corrupt a member's score across restarts or a skipped run. */

const fs = require('fs');
const path = require('path');
const activityScore = require('./activity-score');

let ACTIVITY_SCORES_FILE = null;
const cache = {}; /* memberId -> { rows, current, delta7d, updatedAt } */

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/* Converts a member's raw vacation entries ({ from, until } ISO datetimes,
   as stored in members.json) into the { fromDay, untilDay } 'YYYY-MM-DD'
   day-ranges activity-score.js's recomputeMember expects, using the same
   day-boundary function (`localDateKey`) the voice_day store itself uses —
   so a vacation day and a voice_day bucket always mean the same "day". */
function toVacationDayRanges(vacations, localDateKey) {
  if (!Array.isArray(vacations)) return [];
  return vacations
    .map((v) => {
      const fromMs = Date.parse(v.from);
      const untilMs = Date.parse(v.until);
      if (isNaN(fromMs) || isNaN(untilMs)) return null;
      return { fromDay: localDateKey(fromMs), untilDay: localDateKey(untilMs) };
    })
    .filter(Boolean);
}

/* Rebuilds and persists the full store for `memberIds`. `getMemberDays(id)`
   must return that member's { 'YYYY-MM-DD': minutes } voice_day map, and
   `getMemberVacations(id)` their raw vacation entries (or undefined/[]).
   No `startDateKey` is available per member in this deployment (see the
   caveat on activity-score.js's recomputeMember), so this falls back to
   each member's earliest recorded voice day. */
function rebuildAll({ dataDir, memberIds, getMemberDays, getMemberVacations, localDateKey, todayKey }) {
  const store = {};
  for (const id of memberIds) {
    const days = getMemberDays(id) || {};
    const vacationDayRanges = toVacationDayRanges(getMemberVacations ? getMemberVacations(id) : null, localDateKey);
    const { rows, current, delta7d } = activityScore.recomputeMember(days, todayKey, null, vacationDayRanges);
    store[id] = { rows, current, delta7d, updatedAt: new Date().toISOString() };
    cache[id] = store[id];
  }
  for (const id of Object.keys(cache)) {
    if (!store[id]) delete cache[id]; /* member no longer present — drop stale cache entry */
  }
  if (dataDir) saveJSON(path.join(dataDir, 'activity-scores.json'), store);
  return store;
}

/* Rebuilds and re-persists just one member — used right after a vacation
   edit (server.js) so the score/status reflect it immediately rather than
   waiting for the next once-per-day tick. */
function rebuildOne({ dataDir, id, getMemberDays, getMemberVacations, localDateKey, todayKey }) {
  const days = getMemberDays(id) || {};
  const vacationDayRanges = toVacationDayRanges(getMemberVacations ? getMemberVacations(id) : null, localDateKey);
  const { rows, current, delta7d } = activityScore.recomputeMember(days, todayKey, null, vacationDayRanges);
  const rec = { rows, current, delta7d, updatedAt: new Date().toISOString() };
  cache[id] = rec;
  if (dataDir) saveJSON(path.join(dataDir, 'activity-scores.json'), cache);
  return rec;
}

/* Public accessor for server.js's API routes — mirrors discord-gateway.js's
   getMemberVoiceState/getMemberDays accessor style. Returns null if the
   member has never been through a rebuild yet (e.g. right after a fresh
   deploy, before the first tick has run). */
function getMemberScore(id) {
  const rec = cache[id];
  if (!rec) return null;
  return { current: rec.current, delta7d: rec.delta7d, updatedAt: rec.updatedAt };
}

/* Starts the once-per-day rebuild. Checks every `checkIntervalMs` (default
   15 min) whether the local-day key has changed since the last run, and
   reruns exactly once per day shortly after the 05:00 UTC boundary passes
   — the same "cheap interval poll, not a real cron" style discord-gateway.js
   already uses for its checkpoint/prune ticks. Runs once immediately at
   startup too, so scores are available right after a deploy rather than
   only after the first boundary crossing. */
function init({ dataDir, memberIds, getMemberDays, getMemberVacations, localDateKey, checkIntervalMs }) {
  ACTIVITY_SCORES_FILE = path.join(dataDir, 'activity-scores.json');
  const loaded = loadJSON(ACTIVITY_SCORES_FILE, null);
  if (loaded && typeof loaded === 'object') Object.assign(cache, loaded);

  let lastRunDay = null;
  function tick() {
    const todayKey = localDateKey(Date.now());
    if (todayKey === lastRunDay) return;
    lastRunDay = todayKey;
    try {
      rebuildAll({ dataDir, memberIds: memberIds(), getMemberDays, getMemberVacations, localDateKey, todayKey });
    } catch (err) {
      log.error('[activity-score] daily rebuild failed:', (err && err.stack) || err);
    }
  }
  tick();
  setInterval(tick, checkIntervalMs || 15 * 60 * 1000);
}

module.exports = { init, rebuildAll, rebuildOne, getMemberScore };
