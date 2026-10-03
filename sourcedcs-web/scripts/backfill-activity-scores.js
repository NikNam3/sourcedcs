#!/usr/bin/env node
'use strict';

/* One-shot (and safely re-runnable) backfill: recomputes every roster
   member's full activity-score history from data/voice-activity.json and
   writes data/activity-scores.json — the same output the daily job
   (activity-daily-job.js) produces, just triggered on demand rather than
   on the once-per-day tick. Useful after a fresh deploy, or any time the
   scoring constants change and history needs to be recomputed from
   scratch (see ACTIVITY_SCORE.md §4, "recompute, don't accumulate" — this
   is cheap: recomputing ~90 days for ~80 members is trivial work).

   Usage: node scripts/backfill-activity-scores.js
   Reads directly from the data/ JSON files — does not start the Express
   server or open a Discord Gateway connection. */

const fs = require('fs');
const path = require('path');
const activityScore = require('../activity-score');
const { localDateKey } = require('../discord-gateway');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const VOICE_FILE = path.join(DATA_DIR, 'voice-activity.json');
const OUT_FILE = path.join(DATA_DIR, 'activity-scores.json');

const { loadJSON, saveJSON } = require('../json-file');

/* Same conversion activity-daily-job.js does: raw { from, until } ISO
   entries -> { fromDay, untilDay } 'YYYY-MM-DD' ranges, using the same
   day-boundary function the voice_day store itself uses. */
function toVacationDayRanges(vacations) {
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

function main() {
  const members = loadJSON(MEMBERS_FILE, {});
  const voice = loadJSON(VOICE_FILE, { members: {} });
  const todayKey = localDateKey(Date.now());

  const memberIds = Object.keys(members);
  if (memberIds.length === 0) {
    console.warn('[backfill] No members found in ' + MEMBERS_FILE + ' — nothing to do.');
    return;
  }

  const store = {};
  for (const id of memberIds) {
    const days = (voice.members[id] && voice.members[id].days) || {};
    const vacationDayRanges = toVacationDayRanges(members[id].vacations);
    const { rows, current, delta7d } = activityScore.recomputeMember(days, todayKey, null, vacationDayRanges);
    store[id] = { rows, current, delta7d, updatedAt: new Date().toISOString() };
  }

  saveJSON(OUT_FILE, store);
  console.log('[backfill] Rebuilt activity scores for ' + memberIds.length + ' member(s) -> ' + OUT_FILE);
}

main();
