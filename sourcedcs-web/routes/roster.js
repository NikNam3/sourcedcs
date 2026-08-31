'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

const MAX_ROLE_NAME_LEN = 100;
const MAX_SQUADRON_ID_LEN = 16;
const MAX_ROLE_LABEL_LEN = 100;
const MAX_ROLE_SORT_ENTRIES = 32;

/* ── Roster (live from Discord, merged with persisted squadron overrides
   and active/inactive status — see /api/members for the full admin view) ── */
router.get('/roster', async (_req, res) => {
  await discordClient.ensureMembersFresh();
  /* Only show members who are still in the guild and either auto-matched a
     Discord role mapping or were manually assigned a squadron. */
  const visible = Object.values(store.state.members).filter(m => m.active !== false && (m.matched || !!m.squadronOverride));
  res.json(visible.map(function (m) {
    return { id: m.id, callsign: m.callsign, role: discordClient.resolvedRole(m), squadron: discordClient.resolvedSquadron(m) || '' };
  }));
});

/* Admin: force-refresh the roster from Discord */
router.post('/roster/refresh', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, async (_req, res) => {
  try {
    await discordClient.refreshMembers();
    store.state.membersCacheAt = Date.now();
    res.json({ ok: true, message: 'Roster refreshed from Discord.' });
  } catch (err) {
    res.status(502).json({ error: 'Discord refresh failed: ' + err.message });
  }
});

/* ── Discord roles mapping (admin read/write) ── */
router.get('/discord-roles', auth.requireAuth, auth.requireAdmin, (_req, res) => {
  res.json(store.state.discordRoles);
});

router.put('/discord-roles', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }
  /* Validate and sanitize entries; strip the _comment key */
  const sanitized = {};
  for (const [roleName, mapping] of Object.entries(body)) {
    if (roleName === '_comment') continue;
    if (roleName.trim().length === 0) {
      return res.status(400).json({ error: 'Role name must not be empty or whitespace' });
    }
    if (typeof mapping !== 'object' || mapping === null) {
      return res.status(400).json({ error: 'Each mapping value must be an object with "squadron" and/or "role" fields' });
    }
    const hasSq = mapping.squadron && String(mapping.squadron).trim().length > 0;
    const hasRole = mapping.role && String(mapping.role).trim().length > 0;
    if (!hasSq && !hasRole) {
      return res.status(400).json({ error: 'Each mapping must have at least one of "squadron" or "role" fields' });
    }
    const entry = {};
    if (hasSq) entry.squadron = store.sanitizeStr(mapping.squadron, MAX_SQUADRON_ID_LEN);
    if (hasRole) entry.role = store.sanitizeStr(mapping.role, MAX_ROLE_LABEL_LEN);
    sanitized[store.sanitizeStr(roleName, MAX_ROLE_NAME_LEN)] = entry;
  }
  store.state.discordRoles = sanitized;
  store.saveJSON(store.DISCORD_ROLES_FILE, store.state.discordRoles);
  /* Bust the member cache so the new mapping takes effect immediately */
  store.state.membersCacheAt = 0;
  res.json(store.state.discordRoles);
});

/* ── Roster role sort order (public read, admin write) ──
   Ordered list of role labels, most senior first. The public roster page
   sorts pilots by matching each member's role string (case-insensitive)
   against this list; unmatched roles sort after everything listed here. */
router.get('/role-sort-order', (_req, res) => res.json(store.state.roleSortOrder));

router.put('/role-sort-order', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array of role labels' });
  if (req.body.length > MAX_ROLE_SORT_ENTRIES) return res.status(400).json({ error: 'Too many role entries' });
  const sanitized = req.body.map(r => store.sanitizeStr(r, MAX_ROLE_LABEL_LEN)).filter(r => r.length > 0);
  store.state.roleSortOrder = sanitized;
  try { store.saveJSON(store.ROLE_SORT_ORDER_FILE, store.state.roleSortOrder); } catch (err) {
    return res.status(500).json({ error: 'Failed to save role sort order: ' + err.message });
  }
  res.json(store.state.roleSortOrder);
});

module.exports = router;
