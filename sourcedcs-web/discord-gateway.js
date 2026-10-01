'use strict';
const log = require('./logger');

/* Minimal Discord Gateway v10 client — hand-rolled over `ws`, mirroring this
   repo's existing style of hand-rolled REST over `https` (see server.js's
   discordRequest/discordPost) rather than pulling in discord.js for a single
   event type. Tracks voice-channel join/leave/move for one guild and turns
   it into per-member daily totals plus a guild-wide per-hour aggregate,
   persisted to data/voice-activity.json.

   Day bucketing uses a fixed 05:00 UTC boundary (the squadron-wide "day",
   per ACTIVITY_SCORE.md — no DST, so this offset never shifts) rather than
   UTC midnight, so a late-night session doesn't get split across two days.
   The hour-of-day aggregate stays on literal UTC hours (0-23) — that's an
   orthogonal guild-wide "when do people play" histogram, not tied to the
   day boundary. */

const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = 1 /* GUILDS */ | 128 /* GUILD_VOICE_STATES */;

const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
const PRUNE_INTERVAL_MS      = 60 * 60 * 1000;
const RETENTION_DAYS         = 370;
const MAX_BACKOFF_MS         = 30 * 1000;

/* Discord close codes that mean "config is broken, retrying won't help" */
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/* Close codes after which the next connection must IDENTIFY fresh, not RESUME */
const NEEDS_FRESH_IDENTIFY_CODES = new Set([4007, 4009]);

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/* The squadron-wide "day" boundary — 05:00 UTC, fixed (no DST). Every
   segment `creditMinutes` walks is already split on UTC-hour boundaries,
   and 05:00 UTC always lands exactly on one of those, so shifting only the
   date-key function (not the hour-splitting loop) is sufficient to make
   every session land in the right day bucket. */
const DAY_BOUNDARY_OFFSET_MS = 5 * 3600000;
function localDateKey(ms)   { return new Date(ms - DAY_BOUNDARY_OFFSET_MS).toISOString().slice(0, 10); }
function utcHourOfDay(ms)   { return new Date(ms).getUTCHours(); }
function utcHourBoundary(ms) { return Math.floor(ms / 3600000) * 3600000; }

function safe(fn) {
  return (...args) => {
    try { fn(...args); }
    catch (err) { log.error('[voice-gateway] handler error:', (err && err.stack) || err); }
  };
}

/* ─── Persisted store ───────────────────────────────────── */
let VOICE_ACTIVITY_FILE = null;
const store = { members: {}, overview: { byDateHour: {} } };

/* Live tracking state — not persisted verbatim; reconciled from Discord on
   every GUILD_CREATE rather than trusted across restarts. */
const lastKnownChannelId = new Map(); /* userId -> channelId | null */
const inCallSince        = new Map(); /* userId -> ms epoch, only while in a call */

function memberRecord(userId) {
  if (!store.members[userId]) store.members[userId] = { inCallSince: null, lastCallEnd: null, days: {} };
  return store.members[userId];
}

function addMinutes(userId, dateKey, hour, minutes) {
  const rounded = Math.round(minutes);
  if (rounded <= 0) return;
  const rec = memberRecord(userId);
  rec.days[dateKey] = (rec.days[dateKey] || 0) + rounded;
  if (!store.overview.byDateHour[dateKey]) store.overview.byDateHour[dateKey] = new Array(24).fill(0);
  store.overview.byDateHour[dateKey][hour] += rounded;
}

/* Splits [startMs, endMs) across UTC hour boundaries so a session spanning
   midnight or several hours lands in the right day/hour buckets. */
function creditMinutes(userId, startMs, endMs) {
  if (endMs <= startMs) return;
  let cursor = startMs;
  while (cursor < endMs) {
    const hourEnd = utcHourBoundary(cursor) + 3600000;
    const segmentEnd = Math.min(endMs, hourEnd);
    addMinutes(userId, localDateKey(cursor), utcHourOfDay(cursor), (segmentEnd - cursor) / 60000);
    cursor = segmentEnd;
  }
}

function closeCall(userId, endMs) {
  const startMs = inCallSince.get(userId);
  inCallSince.delete(userId);
  if (startMs == null) return;
  creditMinutes(userId, startMs, endMs);
  const rec = memberRecord(userId);
  rec.lastCallEnd = new Date(endMs).toISOString();
  rec.inCallSince = null;
}

/* Mirrors live in-call start times into the persisted record — informational
   only (reconciliation on reconnect always re-derives truth from Discord's
   live voice_states, never from this field), synced right before every write. */
function syncInCallField() {
  for (const [userId, startMs] of inCallSince.entries()) {
    memberRecord(userId).inCallSince = new Date(startMs).toISOString();
  }
}

function persist() {
  if (!VOICE_ACTIVITY_FILE) return;
  syncInCallField();
  saveJSON(VOICE_ACTIVITY_FILE, store);
}

/* Every 5 min, credit elapsed time for anyone still in a call so a long
   session shows up in "today" before they leave, and reset the clock so
   `closeCall` never has to credit more than one checkpoint interval at once.
   This tick and `closeCall` are the only two places that read/reset
   `inCallSince` entries for accounting purposes. */
function checkpointTick() {
  if (inCallSince.size === 0) return; /* nothing to credit — skip the write entirely */
  const now = Date.now();
  for (const [userId, startMs] of inCallSince.entries()) {
    creditMinutes(userId, startMs, now);
    inCallSince.set(userId, now);
  }
  persist();
}

function pruneVoiceActivityHistory() {
  const cutoff = localDateKey(Date.now() - RETENTION_DAYS * 86400000);
  let changed = false;
  for (const rec of Object.values(store.members)) {
    for (const dateKey of Object.keys(rec.days)) {
      if (dateKey < cutoff) { delete rec.days[dateKey]; changed = true; }
    }
  }
  for (const dateKey of Object.keys(store.overview.byDateHour)) {
    if (dateKey < cutoff) { delete store.overview.byDateHour[dateKey]; changed = true; }
  }
  if (changed) persist();
}

/* Flushes any in-progress calls (crediting elapsed time so far) and writes
   the store. Used by both the periodic checkpoint's caller (indirectly) and
   the SIGTERM/SIGINT graceful-shutdown handler server.js registers. */
function flushAndSave() {
  if (inCallSince.size > 0) {
    const now = Date.now();
    for (const [userId, startMs] of inCallSince.entries()) {
      creditMinutes(userId, startMs, now);
      inCallSince.set(userId, now);
    }
  }
  persist();
}

/* ─── Voice-state reconciliation & tracking ─────────────── */

/* Called on GUILD_CREATE for our guild — the authoritative live snapshot.
   Seeds newly-discovered in-call members (their true join time is unknown,
   so the clock starts now) and force-closes anyone our in-memory state still
   thinks is in a call but who has vanished from the fresh snapshot (e.g. a
   leave event was missed during a disconnect) — otherwise their "last
   online" would freeze forever and their next real call would be credited
   with the entire dead gap. */
function reconcileGuildVoiceStates(voiceStates) {
  const now = Date.now();
  const freshInCall = new Set();
  for (const vs of voiceStates) {
    if (!vs.channel_id || !vs.user_id) continue;
    freshInCall.add(vs.user_id);
    lastKnownChannelId.set(vs.user_id, vs.channel_id);
    if (!inCallSince.has(vs.user_id)) inCallSince.set(vs.user_id, now);
  }
  for (const userId of Array.from(inCallSince.keys())) {
    if (!freshInCall.has(userId)) {
      closeCall(userId, now);
      lastKnownChannelId.delete(userId);
    }
  }
  persist();
}

/* VOICE_STATE_UPDATE also fires for mute/deafen/video/stream toggles with
   channel_id unchanged — only a change in channel_id counts as join/leave/move. */
function handleVoiceStateUpdate(d) {
  const userId = d.user_id;
  if (!userId) return;
  const newChannel  = d.channel_id || null;
  const prevChannel = lastKnownChannelId.has(userId) ? lastKnownChannelId.get(userId) : null;
  if (newChannel === prevChannel) return;
  lastKnownChannelId.set(userId, newChannel);

  const now = Date.now();
  if (!prevChannel && newChannel) {
    if (!inCallSince.has(userId)) inCallSince.set(userId, now);
  } else if (prevChannel && !newChannel) {
    closeCall(userId, now);
    persist();
  }
  /* prevChannel && newChannel && different: a move between channels — still
     "in a call", inCallSince is left untouched. */
}

/* ─── Gateway connection ────────────────────────────────── */
let ws = null;
let botToken = null;
let identifiedGuildId = null;

let heartbeatIntervalMs = null;
let heartbeatTimer = null;
let ackReceived = true;

let sessionId = null;
let resumeGatewayUrl = null;
let lastSeq = null;

let reconnectAttempt = 0;
let reconnectTimer = null;

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function clearHeartbeatTimers() {
  if (heartbeatTimer) { clearTimeout(heartbeatTimer); clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function sendHeartbeat() {
  if (!ackReceived) {
    /* Zombie connection — no ACK since the last beat. Don't wait for TCP to
       notice; force-close and let the close handler schedule a reconnect. */
    log.warn('[voice-gateway] heartbeat ACK missing — terminating zombie connection');
    if (ws) ws.terminate();
    return;
  }
  ackReceived = false;
  send({ op: 1, d: lastSeq });
}

function startHeartbeat(intervalMs) {
  clearHeartbeatTimers();
  heartbeatIntervalMs = intervalMs;
  ackReceived = true;
  const jitter = Math.random() * intervalMs;
  heartbeatTimer = setTimeout(() => {
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, intervalMs);
  }, jitter);
}

function identify() {
  send({
    op: 2,
    d: {
      token: botToken,
      intents: INTENTS,
      properties: { os: process.platform, browser: 'sourcedcs-web', device: 'sourcedcs-web' },
    },
  });
}

function resume() {
  send({ op: 6, d: { token: botToken, session_id: sessionId, seq: lastSeq } });
}

function handleDispatch(t, d) {
  switch (t) {
    case 'READY':
      sessionId = d.session_id;
      resumeGatewayUrl = d.resume_gateway_url;
      reconnectAttempt = 0;
      log.info('[voice-gateway] READY');
      break;
    case 'RESUMED':
      reconnectAttempt = 0;
      log.info('[voice-gateway] RESUMED');
      break;
    case 'GUILD_CREATE':
      if (String(d.id) === String(identifiedGuildId)) reconcileGuildVoiceStates(d.voice_states || []);
      break;
    case 'VOICE_STATE_UPDATE':
      if (String(d.guild_id) === String(identifiedGuildId)) handleVoiceStateUpdate(d);
      break;
  }
}

function handleMessage(raw) {
  const msg = JSON.parse(raw);
  if (msg.s != null) lastSeq = msg.s;

  switch (msg.op) {
    case 10: /* HELLO */
      startHeartbeat(msg.d.heartbeat_interval);
      if (sessionId && lastSeq != null) resume(); else identify();
      break;
    case 0: /* DISPATCH */
      handleDispatch(msg.t, msg.d);
      break;
    case 7: /* RECONNECT — close so the close handler resumes on reconnect */
      if (ws) ws.close(4000, 'server requested reconnect');
      break;
    case 9: /* INVALID_SESSION */
      setTimeout(() => {
        if (msg.d === true && sessionId && lastSeq != null) resume();
        else { sessionId = null; lastSeq = null; identify(); }
      }, 1000 + Math.random() * 4000);
      break;
    case 11: /* HEARTBEAT ACK */
      ackReceived = true;
      break;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return; /* single-flight guard — never two live sockets */
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, reconnectAttempt++));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectGateway();
  }, delay);
}

function connectGateway() {
  const canResume = !!(sessionId && lastSeq != null);
  const url = canResume && resumeGatewayUrl ? resumeGatewayUrl + '/?v=10&encoding=json' : GATEWAY_URL;

  ws = new WebSocket(url);
  ws.on('message', safe((data) => handleMessage(data)));
  ws.on('error', safe((err) => log.error('[voice-gateway] socket error:', err.message)));
  ws.on('close', safe((code) => {
    clearHeartbeatTimers();
    log.warn('[voice-gateway] connection closed, code=' + code);
    if (FATAL_CLOSE_CODES.has(code)) {
      log.error('[voice-gateway] fatal close code ' + code + ' — not reconnecting; check DISCORD_BOT_TOKEN / intents');
      return;
    }
    if (NEEDS_FRESH_IDENTIFY_CODES.has(code)) { sessionId = null; lastSeq = null; }
    scheduleReconnect();
  }));
}

function startGateway(token, guildId) {
  botToken = token;
  identifiedGuildId = guildId;
  connectGateway();
  setInterval(checkpointTick, CHECKPOINT_INTERVAL_MS);
}

/* ─── Public accessors (for server.js API routes) ───────── */
function getMemberVoiceState(userId) {
  return {
    inCall: inCallSince.has(userId),
    lastCallEnd: store.members[userId] ? store.members[userId].lastCallEnd : null,
  };
}

function getMemberDays(userId) {
  return store.members[userId] ? store.members[userId].days : {};
}

function lastNDateKeys(n) {
  const keys = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) keys.push(localDateKey(now - i * 86400000));
  return keys;
}

function isoWeekStart(dateKey) {
  const d = new Date(dateKey + 'T00:00:00Z');
  const day = d.getUTCDay(); /* 0 = Sun .. 6 = Sat */
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

function getOverview(mode, rangeDays) {
  const dates = lastNDateKeys(rangeDays);

  if (mode === 'hourly') {
    const buckets = new Array(24).fill(0);
    for (const d of dates) {
      const arr = store.overview.byDateHour[d];
      if (arr) for (let h = 0; h < 24; h++) buckets[h] += arr[h];
    }
    return { mode: 'hourly', buckets };
  }

  const daily = dates.map((d) => {
    const arr = store.overview.byDateHour[d];
    return { date: d, minutes: arr ? arr.reduce((a, b) => a + b, 0) : 0 };
  });

  if (mode === 'weekly') {
    const map = new Map();
    for (const { date, minutes } of daily) {
      const wk = isoWeekStart(date);
      map.set(wk, (map.get(wk) || 0) + minutes);
    }
    const weeks = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, minutes]) => ({ weekStart, minutes }));
    return { mode: 'weekly', weeks };
  }

  return { mode: 'daily', days: daily };
}

/* ─── Init ──────────────────────────────────────────────── */
/* Always loads any existing store (so the API can serve historical data even
   if the gateway isn't currently configured to run); only opens the live
   Gateway connection when both token and guildId are provided — same guard
   refreshMembers() uses for the REST roster sync. */
function init({ dataDir, token, guildId }) {
  VOICE_ACTIVITY_FILE = path.join(dataDir, 'voice-activity.json');
  const loaded = loadJSON(VOICE_ACTIVITY_FILE, null);
  if (loaded && typeof loaded === 'object') {
    if (loaded.members && typeof loaded.members === 'object') Object.assign(store.members, loaded.members);
    if (loaded.overview && loaded.overview.byDateHour) Object.assign(store.overview.byDateHour, loaded.overview.byDateHour);
  }

  pruneVoiceActivityHistory();
  setInterval(pruneVoiceActivityHistory, PRUNE_INTERVAL_MS);

  if (token && guildId) {
    startGateway(token, guildId);
  } else {
    log.warn('[voice-gateway] DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set — voice activity tracking disabled');
  }
}

module.exports = { init, flushAndSave, getMemberVoiceState, getMemberDays, getOverview, localDateKey };
