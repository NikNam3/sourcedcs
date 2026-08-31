'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const voiceGateway = require('../discord-gateway');
const activityDailyJob = require('../activity-daily-job');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

const MAX_PILOT_NAME_LEN = 64;
const MAX_PILOT_CALLSIGN_LEN = 32;

/* Re-runs the activity-score rebuild for a single member right away —
   used after a vacation edit so the score/status reflect it immediately
   instead of waiting for the next once-per-day tick. */
function rebuildMemberScore(id) {
  activityDailyJob.rebuildOne({
    dataDir: store.DATA_DIR,
    id,
    getMemberDays: (mid) => voiceGateway.getMemberDays(mid),
    getMemberVacations: (mid) => store.state.members[mid] && store.state.members[mid].vacations,
    localDateKey: voiceGateway.localDateKey,
    todayKey: voiceGateway.localDateKey(Date.now()),
  });
}

/* ── My squadron (resolves the logged-in pilot's squadron from the roster) ── */
router.get('/my-squadron', auth.requireAuth, async (req, res) => {
  const sub = req.user.sub;
  const pilot = store.state.pilotRegistry[sub];
  if (!pilot) return res.json({ squadron: null });

  await discordClient.ensureMembersFresh();

  const entry = discordClient.findRosterEntry(pilot);
  res.json({ squadron: entry ? (discordClient.resolvedSquadron(entry) || null) : null });
});

/* ── Pilot Registry (admin read / delete) ── */
router.get('/skill-pilots', auth.requireAuth, auth.requireSkillAdmin, (_req, res) => {
  res.json(store.state.pilotRegistry);
});

/* Returns { [sub]: squadronId | null } — resolves each registered pilot's squadron
   via the unified members store (auto-assignment + admin override), matched
   by callsign/name (same logic as /my-squadron). */
router.get('/skill-pilots-squadrons', auth.requireAuth, auth.requireSkillAdmin, async (_req, res) => {
  await discordClient.ensureMembersFresh();
  const result = {};
  for (const [sub, pilot] of Object.entries(store.state.pilotRegistry)) {
    const entry = discordClient.findRosterEntry(pilot);
    result[sub] = entry ? (discordClient.resolvedSquadron(entry) || null) : null;
  }
  res.json(result);
});

/* ── Members (unified Discord roster + squadron assignment) ──
   Single source of truth for squadron membership: consumed by the wing
   admin page, the public roster/squadron pages, and the skills page. */
router.get('/members', auth.requireAuth, auth.requireSkillAdmin, async (_req, res) => {
  await discordClient.ensureMembersFresh();
  const list = Object.values(store.state.members).map(m => {
    const linkedPilot = discordClient.findLinkedPilot(m);
    const nameMismatch = !!(linkedPilot && !linkedPilot.manual && linkedPilot.callsign && m.callsign &&
      linkedPilot.callsign.toLowerCase() !== m.callsign.toLowerCase());
    const voice = voiceGateway.getMemberVoiceState(m.id);
    const scoreRec = activityDailyJob.getMemberScore(m.id);
    return {
      id: m.id,
      username: m.username,
      globalName: m.globalName,
      callsign: m.callsign,
      role: discordClient.resolvedRole(m) || null,
      autoRole: m.autoRole || m.role || null,
      roleOverride: m.roleOverride || null,
      autoSquadron: m.autoSquadron || null,
      squadronOverride: m.squadronOverride || null,
      squadron: discordClient.resolvedSquadron(m) || null,
      active: m.active !== false,
      status: discordClient.computeMemberStatus(m, scoreRec),
      vacations: Array.isArray(m.vacations) ? m.vacations : [],
      lastSeen: m.lastSeen || null,
      inCall: voice.inCall,
      lastCallEnd: voice.lastCallEnd,
      activityScore: scoreRec ? scoreRec.current.score : null,
      activityLabel: scoreRec ? scoreRec.current.label : null,
      activityDelta7d: scoreRec ? scoreRec.delta7d : null,
      activityProvisional: scoreRec ? scoreRec.current.provisional : null,
      linkedPilot,
      nameMismatch,
    };
  }).sort((a, b) => a.callsign.localeCompare(b.callsign));
  res.json(list);
});

/* Per-member voice-activity heatmap source: { "YYYY-MM-DD": minutes } for
   whatever history is retained (rolling ~1 year). */
router.get('/voice-activity/member/:id', auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  if (!store.state.members[id]) return res.status(404).json({ error: 'Member not found' });
  res.json({ days: voiceGateway.getMemberDays(id) });
});

/* Per-member activity score: current score/label/7-day trend, and whether
   it's still provisional (<21 days of history). See ACTIVITY_SCORE.md. */
router.get('/activity-score/:id', auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  if (!store.state.members[id]) return res.status(404).json({ error: 'Member not found' });
  res.json(activityDailyJob.getMemberScore(id) || { current: null, delta7d: null, updatedAt: null });
});

/* Squadron-wide activity graph: daily/weekly totals or an hour-of-day
   aggregate, over a trailing window of `range` days. */
router.get('/voice-activity/overview', auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const mode = ['daily', 'weekly', 'hourly'].includes(req.query.mode) ? req.query.mode : 'daily';
  const range = [30, 90, 365].includes(Number(req.query.range)) ? Number(req.query.range) : 90;
  res.json(voiceGateway.getOverview(mode, range));
});

/* Admin: force-refresh the members store from Discord */
router.post('/members/refresh', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, async (_req, res) => {
  try {
    await discordClient.refreshMembers();
    store.state.membersCacheAt = Date.now();
    res.json({ ok: true, count: Object.keys(store.state.members).length });
  } catch (err) {
    res.status(502).json({ error: 'Discord refresh failed: ' + err.message });
  }
});

/* Set or clear (squadron_id null/empty) a member's squadron override */
router.put('/members/:id/squadron', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  const members = store.state.members;
  if (!members[id]) return res.status(404).json({ error: 'Member not found' });
  const sqId = req.body.squadron_id;
  if (sqId === null || sqId === undefined || sqId === '') {
    delete members[id].squadronOverride;
  } else {
    members[id].squadronOverride = String(sqId);
  }
  store.saveJSON(store.MEMBERS_FILE, members);
  res.json({ id, squadron_id: members[id].squadronOverride || null, squadron: discordClient.resolvedSquadron(members[id]) || null });
});

/* Fixed list of role labels selectable as a manual override (see store.ROLE_LABELS) */
router.get('/role-labels', auth.requireAuth, auth.requireSkillAdmin, (_req, res) => {
  res.json(store.ROLE_LABELS);
});

/* Set or clear (role null/empty) a member's role override */
router.put('/members/:id/role', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  const members = store.state.members;
  if (!members[id]) return res.status(404).json({ error: 'Member not found' });
  const roleLabel = req.body.role;
  if (roleLabel === null || roleLabel === undefined || roleLabel === '') {
    delete members[id].roleOverride;
  } else {
    if (!store.ROLE_LABELS.includes(roleLabel)) {
      return res.status(400).json({ error: 'Invalid role label. Must be one of: ' + store.ROLE_LABELS.join(', ') });
    }
    members[id].roleOverride = roleLabel;
  }
  store.saveJSON(store.MEMBERS_FILE, members);
  res.json({ id, role_override: members[id].roleOverride || null, role: discordClient.resolvedRole(members[id]) || null });
});

/* Manually link (or clear) a Discord roster member to a specific Casdoor
   account by `sub`. Exists for accounts the automatic callsign/username/
   global-name matching can never resolve — e.g. a Casdoor account whose
   display name shares nothing with the member's Discord identity. The
   target sub must already be a known Casdoor login (present in the pilot
   registry — populated at login, see auth.registerPilot()), so an admin can
   only link to a real, already-seen account, not an arbitrary string. */
router.put('/members/:id/casdoor-link', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  const members = store.state.members;
  if (!members[id]) return res.status(404).json({ error: 'Member not found' });
  const sub = typeof req.body.sub === 'string' ? req.body.sub.trim() : '';

  if (!sub) {
    delete members[id].casdoorSub;
  } else {
    if (!store.state.pilotRegistry[sub]) {
      return res.status(400).json({ error: 'Unknown Casdoor account — ask them to log in to the site at least once first' });
    }
    const conflict = Object.values(members).find(m => m.id !== id && m.casdoorSub === sub);
    if (conflict) {
      return res.status(409).json({ error: 'That Casdoor account is already linked to ' + (conflict.callsign || conflict.id) });
    }
    members[id].casdoorSub = sub;
  }

  store.saveJSON(store.MEMBERS_FILE, members);
  const linkedPilot = discordClient.findLinkedPilot(members[id]);
  res.json({ id, casdoor_sub: members[id].casdoorSub || null, linkedPilot });
});

/* Vacation marking — a history of { id, from, until } ranges per member
   (not a single slot), admin-only. Days inside any range are excluded from
   the activity score entirely (see activity-score.js's recomputeMember)
   and, while today falls inside one, the member's merged status shows
   ON_VACATION regardless of their score (see computeMemberStatus). */
router.post('/members/:id/vacation', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  const members = store.state.members;
  if (!members[id]) return res.status(404).json({ error: 'Member not found' });
  const from = typeof req.body.from === 'string' && req.body.from ? req.body.from : new Date().toISOString();
  const until = typeof req.body.until === 'string' && req.body.until ? req.body.until : new Date(Date.now() + 7 * 86400000).toISOString();
  const check = discordClient.validateVacationRange(from, until);
  if (!check.ok) return res.status(400).json({ error: check.error });

  if (!Array.isArray(members[id].vacations)) members[id].vacations = [];
  const entry = { id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), from, until };
  members[id].vacations.push(entry);
  store.saveJSON(store.MEMBERS_FILE, members);
  rebuildMemberScore(id);
  res.json({ id: entry.id, vacations: members[id].vacations });
});

router.put('/members/:id/vacation/:vacationId', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  const members = store.state.members;
  if (!members[id]) return res.status(404).json({ error: 'Member not found' });
  const list = Array.isArray(members[id].vacations) ? members[id].vacations : [];
  const entry = list.find((v) => v.id === req.params.vacationId);
  if (!entry) return res.status(404).json({ error: 'Vacation entry not found' });

  const from = typeof req.body.from === 'string' && req.body.from ? req.body.from : entry.from;
  const until = typeof req.body.until === 'string' && req.body.until ? req.body.until : entry.until;
  const check = discordClient.validateVacationRange(from, until);
  if (!check.ok) return res.status(400).json({ error: check.error });

  entry.from = from;
  entry.until = until;
  store.saveJSON(store.MEMBERS_FILE, members);
  rebuildMemberScore(id);
  res.json({ id: entry.id, vacations: members[id].vacations });
});

router.delete('/members/:id/vacation/:vacationId', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = req.params.id;
  const members = store.state.members;
  if (!members[id]) return res.status(404).json({ error: 'Member not found' });
  const before = (members[id].vacations || []).length;
  members[id].vacations = (members[id].vacations || []).filter((v) => v.id !== req.params.vacationId);
  if (members[id].vacations.length === before) return res.status(404).json({ error: 'Vacation entry not found' });
  store.saveJSON(store.MEMBERS_FILE, members);
  rebuildMemberScore(id);
  res.json({ id: req.params.vacationId, vacations: members[id].vacations });
});

/* Fix a registered pilot's display name/callsign to match their Discord
   identity (surfaced as a mismatch on the wing admin page). Does not
   touch skill grades or the pilot's sub — only the display fields. */
router.put('/skill-pilots/:sub/name', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const sub = req.params.sub;
  const pilotRegistry = store.state.pilotRegistry;
  if (!pilotRegistry[sub]) return res.status(404).json({ error: 'Pilot not found' });
  const { name, callsign } = req.body;
  if (name !== undefined) pilotRegistry[sub].name = store.sanitizeStr(name, MAX_PILOT_NAME_LEN);
  if (callsign !== undefined) pilotRegistry[sub].callsign = store.sanitizeStr(callsign, MAX_PILOT_CALLSIGN_LEN);
  store.saveJSON(store.PILOT_REGISTRY_FILE, pilotRegistry);
  res.json(pilotRegistry[sub]);
});

router.delete('/skill-pilots/:sub', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const sub = req.params.sub;
  const pilotRegistry = store.state.pilotRegistry;
  if (!pilotRegistry[sub]) return res.status(404).json({ error: 'Pilot not found' });

  delete pilotRegistry[sub];
  delete store.state.skillGrades[sub];

  const before = store.state.gradingRequests.length;
  store.state.gradingRequests = store.state.gradingRequests.filter(r => r.pilot_id !== sub);
  if (store.state.gradingRequests.length !== before) store.saveJSON(store.GRADING_REQS_FILE, store.state.gradingRequests);

  store.saveJSON(store.PILOT_REGISTRY_FILE, pilotRegistry);
  store.saveJSON(store.SKILL_GRADES_FILE, store.state.skillGrades);

  res.json({ ok: true });
});

module.exports = router;
