'use strict';

/* Discord REST client (guild members/roles, posting/editing/deleting
   messages) + roster-merge logic — pulled out of server.js. Sibling to
   discord-gateway.js, which covers the *other* half of Discord integration
   (the voice-activity Gateway websocket). */

const auth = require('./auth');
const store = require('./store');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const APPLY_CHANNEL_ID = process.env.APPLY_CHANNEL_ID || '';
const GRADING_CHANNEL_ID = process.env.GRADING_CHANNEL_ID || '';

const USER_AGENT = 'SourceDCS-Web/1.0 (https://github.com/NikNam3/sourcedcs)';

/* ─── Discord REST helpers ──────────────────────────────── */
function discordRequest(apiPath) {
  console.debug('[discord] GET /api/v10' + apiPath);
  const options = {
    hostname: 'discord.com',
    path: '/api/v10' + apiPath,
    method: 'GET',
    headers: {
      'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
      'User-Agent': USER_AGENT,
    },
  };
  return auth.rawRequest(options).then(({ statusCode, headers, raw }) => {
    console.debug('[discord] GET /api/v10' + apiPath + ' → HTTP ' + statusCode);
    if (statusCode === 429) {
      const retry = headers['retry-after'];
      console.warn('[discord] Rate limited — retry-after: ' + retry + 's');
    }
    if (statusCode >= 200 && statusCode < 300) {
      try { return JSON.parse(raw); }
      catch (e) {
        console.error('[discord] Failed to parse JSON from GET /api/v10' + apiPath + ':', e.message, '| raw:', raw.slice(0, 200));
        throw new Error('Discord: invalid JSON response');
      }
    }
    const msg = 'Discord API ' + statusCode + ': ' + raw.slice(0, 200);
    console.error('[discord] Error on GET /api/v10' + apiPath + ':', msg);
    throw new Error(msg);
  }, (err) => {
    console.error('[discord] Network error on GET /api/v10' + apiPath + ':', err.message);
    throw err;
  });
}

/* POST to a Discord API endpoint (e.g. send a message to a channel) */
function discordPost(apiPath, body) {
  const payload = JSON.stringify(body);
  console.debug('[discord] POST /api/v10' + apiPath);
  const options = {
    hostname: 'discord.com',
    path: '/api/v10' + apiPath,
    method: 'POST',
    headers: {
      'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  return auth.rawRequest(options, payload).then(({ statusCode, raw }) => {
    console.debug('[discord] POST /api/v10' + apiPath + ' → HTTP ' + statusCode);
    if (statusCode >= 200 && statusCode < 300) {
      try { return JSON.parse(raw); }
      catch (e) {
        console.error('[discord] Failed to parse JSON from POST /api/v10' + apiPath + ':', e.message, '| raw:', raw.slice(0, 200));
        return {};
      }
    }
    const msg = 'Discord API ' + statusCode + ': ' + raw.slice(0, 400);
    console.error('[discord] Error on POST /api/v10' + apiPath + ':', msg);
    throw new Error(msg);
  }, (err) => {
    console.error('[discord] Network error on POST /api/v10' + apiPath + ':', err.message);
    throw err;
  });
}

/* PATCH a Discord message (edit in place) */
function discordPatch(apiPath, body) {
  const payload = JSON.stringify(body);
  console.debug('[discord] PATCH /api/v10' + apiPath);
  const options = {
    hostname: 'discord.com',
    path: '/api/v10' + apiPath,
    method: 'PATCH',
    headers: {
      'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  return auth.rawRequest(options, payload).then(({ statusCode, raw }) => {
    console.debug('[discord] PATCH /api/v10' + apiPath + ' → HTTP ' + statusCode);
    if (statusCode >= 200 && statusCode < 300) {
      try { return JSON.parse(raw); } catch (e) { return {}; }
    }
    throw new Error('Discord API ' + statusCode + ': ' + raw.slice(0, 400));
  });
}

/* DELETE a Discord message */
function discordDelete(apiPath) {
  console.debug('[discord] DELETE /api/v10' + apiPath);
  const options = {
    hostname: 'discord.com',
    path: '/api/v10' + apiPath,
    method: 'DELETE',
    headers: {
      'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
      'User-Agent': USER_AGENT,
    },
  };
  return auth.rawRequest(options).then(({ statusCode, raw }) => {
    console.debug('[discord] DELETE /api/v10' + apiPath + ' → HTTP ' + statusCode);
    if (statusCode === 204 || (statusCode >= 200 && statusCode < 300)) return;
    throw new Error('Discord API DELETE ' + statusCode);
  });
}

async function fetchAllGuildMembers(guildId) {
  const members = [];
  let after = '0';
  let page = 0;
  console.debug('[roster] Fetching guild members for guild', guildId);
  for (;;) {
    page++;
    const batch = await discordRequest(
      '/guilds/' + guildId + '/members?limit=1000&after=' + after
    );
    console.debug('[roster] Page ' + page + ': received ' + batch.length + ' members (after=' + after + ')');
    members.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  console.debug('[roster] Total members fetched:', members.length);
  return members;
}

/* A member's effective squadron: an admin-set override always wins over the
   auto-assignment derived from their Discord roles. */
function resolvedSquadron(m) {
  return (m && (m.squadronOverride || m.autoSquadron)) || '';
}

/* A member's effective role label: an admin-set override always wins over the
   auto-assignment derived from their Discord roles. `m.role` is read as a
   fallback for entries persisted before the autoRole/roleOverride split. */
function resolvedRole(m) {
  return (m && (m.roleOverride || m.autoRole || m.role)) || '';
}

/* True if `nowMs` falls inside any of the member's vacation ranges
   (inclusive). Vacation days are excluded from the activity score itself —
   this is purely a status-display check, unrelated to scoring. */
function isCurrentlyOnVacation(vacations, nowMs) {
  if (!Array.isArray(vacations)) return false;
  return vacations.some((v) => {
    const from = Date.parse(v.from);
    const until = Date.parse(v.until);
    return !isNaN(from) && !isNaN(until) && nowMs >= from && nowMs <= until;
  });
}

/* Single merged status field: LEFT_DISCORD (guild membership) and
   ON_VACATION (admin-marked) both override the activity-score-derived
   label (ACTIVE/INACTIVE/STALE, see activity-score.js). A member with no
   score record yet (e.g. right after a fresh deploy, before the first
   daily-job tick) falls back to ACTIVE rather than showing a blank status. */
function computeMemberStatus(m, scoreRec) {
  if (m.active === false) return 'LEFT_DISCORD';
  if (isCurrentlyOnVacation(m.vacations, Date.now())) return 'ON_VACATION';
  if (scoreRec && scoreRec.current) return scoreRec.current.label.toUpperCase();
  return 'ACTIVE';
}

function validateVacationRange(from, until) {
  const f = Date.parse(from);
  const u = Date.parse(until);
  if (isNaN(f) || isNaN(u)) return { ok: false, error: 'Invalid date' };
  if (u <= f) return { ok: false, error: '"Until" must be after "from"' };
  return { ok: true };
}

/* Re-fetches the members store from Discord if the cache has expired. */
async function ensureMembersFresh() {
  const now = Date.now();
  if (!store.state.membersCacheAt || (now - store.state.membersCacheAt) > store.ROSTER_CACHE_TTL) {
    try {
      await refreshMembers();
      store.state.membersCacheAt = now;
    } catch (err) {
      console.error('[members] Refresh failed:', err.message);
    }
  }
}

/* Fetches the live Discord guild roster and merges it into the persisted
   `members` store: existing squadron overrides and active pilots' history
   survive, new members are added, and members no longer in the guild are
   flagged inactive (never deleted) so their squadron assignment and any
   linked skill records are preserved. */
async function refreshMembers() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    console.warn('[members] DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set — cannot refresh from Discord');
    return;
  }

  const members = store.state.members;
  const discordRoles = store.state.discordRoles;

  console.debug('[members] Starting member refresh from Discord (guild=' + DISCORD_GUILD_ID + ')');

  /* Resolve role IDs → names */
  const guildRoles = await discordRequest('/guilds/' + DISCORD_GUILD_ID + '/roles');
  const roleIdToName = {};
  for (const r of guildRoles) roleIdToName[r.id] = r.name;
  console.debug('[members] Guild has ' + guildRoles.length + ' roles; configured mapping covers ' + Object.keys(discordRoles).length + ' role name(s)');

  const discordMembers = await fetchAllGuildMembers(DISCORD_GUILD_ID);

  const seenIds = new Set();
  let matchedCount = 0;
  let skippedCount = 0;

  for (const member of discordMembers) {
    if (!member.user || member.user.bot) continue;

    /* Scan all of the member's Discord roles.
       One role may supply the squadron, another may supply the role label —
       or a single role may supply both (backward compatible). */
    let squadron = '';
    let roleLabel = '';
    let anyMatch = false;
    for (const roleId of (member.roles || [])) {
      const roleName = roleIdToName[roleId];
      const mapping = roleName ? discordRoles[roleName] : null;
      if (!mapping) continue;
      anyMatch = true;
      if (!squadron && mapping.squadron) squadron = mapping.squadron;
      if (!roleLabel && mapping.role) roleLabel = mapping.role;
      if (squadron && roleLabel) break; /* both resolved — no need to continue */
    }
    if (anyMatch) matchedCount++; else skippedCount++;

    const id = member.user.id;
    const nick = member.nick || member.user.global_name || member.user.username || '';
    const callsign = store.parseCallsign(nick);

    seenIds.add(id);
    const existing = members[id] || {};
    members[id] = {
      ...existing,                                                /* preserves squadronOverride, if any set */
      id,
      callsign,
      nick,
      username: (member.user.username || '').toLowerCase(),        /* discord @username — always lowercase */
      globalName: (member.user.global_name || ''),                 /* discord display name */
      autoRole: roleLabel,
      autoSquadron: squadron,
      matched: anyMatch,
      active: true,
      lastSeen: new Date().toISOString(),
    };
  }

  /* Anyone previously known but absent from this fetch has left the guild —
     flag inactive rather than deleting, so squadron history is preserved. */
  for (const id of Object.keys(members)) {
    if (!seenIds.has(id)) members[id].active = false;
  }

  store.saveJSON(store.MEMBERS_FILE, members);
  console.debug('[members] Refresh complete — matched: ' + matchedCount + ', unmatched: ' + skippedCount + ', total known: ' + Object.keys(members).length);
}

/* Finds a roster entry for a pilot. An admin-set `casdoorSub` link (see
   PUT /members/:id/casdoor-link) always wins — it exists precisely for
   accounts the name/callsign heuristic below can never match (e.g. a
   Casdoor account not registered under the member's Discord identity).
   Otherwise falls back to matching by any of:
   - their parsed callsign (from server nickname)
   - their Discord @username
   - their Discord global display name
   The pilot arg has { callsign, name } both coming from the Casdoor JWT name,
   which is usually the Discord username or global_name — NOT the server nickname. */
function findRosterEntry(pilot) {
  const members = store.state.members;
  if (pilot.sub) {
    const linked = Object.values(members).find(m => m.casdoorSub === pilot.sub);
    if (linked) return linked;
  }

  const candidates = [
    (pilot.callsign || '').toLowerCase(),
    (pilot.name || '').toLowerCase(),
  ].filter(Boolean);

  for (const entry of Object.values(members)) {
    if (entry.active === false) continue;
    const rosterCallsign = (entry.callsign || '').toLowerCase();
    const rosterUsername = (entry.username || '').toLowerCase();  /* already stored lowercase */
    const rosterGlobalName = (entry.globalName || '').toLowerCase();
    for (const c of candidates) {
      if (c && (c === rosterCallsign || c === rosterUsername || c === rosterGlobalName)) {
        return entry;
      }
    }
  }
  return null;
}

/* Reverse lookup: given a Discord member, find the matching registered
   website pilot (if any). An admin-set `casdoorSub` link is authoritative
   (`manual: true`) — the pilot may not have used any pilot-specific feature
   yet, in which case it's flagged `pending` until they show up in the
   registry. Otherwise falls back to the same name/callsign heuristics used
   by findRosterEntry, which the wing admin page uses to flag mismatches. */
function findLinkedPilot(member) {
  const pilotRegistry = store.state.pilotRegistry;
  if (member.casdoorSub) {
    const pilot = pilotRegistry[member.casdoorSub];
    return pilot
      ? { sub: member.casdoorSub, name: pilot.name, callsign: pilot.callsign, manual: true }
      : { sub: member.casdoorSub, name: null, callsign: null, manual: true, pending: true };
  }

  const candidates = [
    (member.callsign || '').toLowerCase(),
    (member.username || '').toLowerCase(),
    (member.globalName || '').toLowerCase(),
  ].filter(Boolean);

  for (const [sub, pilot] of Object.entries(pilotRegistry)) {
    const pilotCandidates = [
      (pilot.callsign || '').toLowerCase(),
      (pilot.name || '').toLowerCase(),
    ].filter(Boolean);
    if (pilotCandidates.some(c => candidates.includes(c))) {
      return { sub, name: pilot.name, callsign: pilot.callsign };
    }
  }
  return null;
}

module.exports = {
  DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, APPLY_CHANNEL_ID, GRADING_CHANNEL_ID,
  discordRequest, discordPost, discordPatch, discordDelete,
  fetchAllGuildMembers, resolvedSquadron, resolvedRole,
  isCurrentlyOnVacation, computeMemberStatus, validateVacationRange,
  ensureMembersFresh, refreshMembers, findRosterEntry, findLinkedPilot,
};
