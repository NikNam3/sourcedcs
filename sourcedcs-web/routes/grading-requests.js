'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

const MAX_MODULE_TITLE_LEN = 128;
const MAX_PILOT_NAME_LEN = 64;
const MAX_PILOT_CALLSIGN_LEN = 32;

/* Build the Discord embed for a grading request (used for both POST and PATCH) */
function buildGradingEmbed(request) {
  const pilot = request.pilot_callsign || request.pilot_name || request.pilot_id;
  const module = request.module_title || request.module_id || '—';
  const claimed = request.status === 'claimed';

  const color = claimed ? 0x57f287 : 0xf0a500; /* green if claimed, amber if open */
  const status = claimed
    ? '✅  Claimed by **' + (request.claimed_by_name || '—') + '**'
    : '🟡  Open — awaiting instructor';

  return {
    title: '🎯 Grading Request',
    color,
    fields: [
      { name: 'Pilot', value: pilot, inline: true },
      { name: 'Module', value: module, inline: true },
      { name: 'Status', value: status, inline: false },
    ],
    timestamp: request.requested_at,
    footer: { text: 'Request ID: ' + request.id },
  };
}

/* Post a new grading request to Discord; returns the Discord message ID or null */
async function sendGradingRequestToDiscord(request) {
  if (!discordClient.DISCORD_BOT_TOKEN) {
    console.warn('[grading] DISCORD_BOT_TOKEN not set — cannot post grading request to Discord');
    return null;
  }
  if (!discordClient.GRADING_CHANNEL_ID) {
    console.warn('[grading] GRADING_CHANNEL_ID not set — skipping Discord notification');
    return null;
  }
  const msg = await discordClient.discordPost('/channels/' + discordClient.GRADING_CHANNEL_ID + '/messages', { embeds: [buildGradingEmbed(request)] });
  console.debug('[grading] Request ' + request.id + ' posted to Discord channel ' + discordClient.GRADING_CHANNEL_ID);
  return msg && msg.id ? msg.id : null;
}

/* Edit an existing Discord message to reflect the current request state */
async function updateGradingRequestOnDiscord(request) {
  if (!discordClient.DISCORD_BOT_TOKEN || !discordClient.GRADING_CHANNEL_ID || !request.discord_message_id) return;
  await discordClient.discordPatch(
    '/channels/' + discordClient.GRADING_CHANNEL_ID + '/messages/' + request.discord_message_id,
    { embeds: [buildGradingEmbed(request)] }
  );
  console.debug('[grading] Request ' + request.id + ' Discord message updated');
}

/* ── Grading Requests ── */
router.get('/grading-requests', auth.requireAuth, (req, res) => {
  const sub = req.user.sub;
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdm = roles.some(r => auth.SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));
  if (isAdm) {
    res.json(store.state.gradingRequests);
  } else {
    res.json(store.state.gradingRequests.filter(r => r.pilot_id === sub));
  }
});

router.post('/grading-requests', writeOpsLimiter, auth.requireAuth, async (req, res) => {
  const sub = req.user.sub;
  if (!sub) return res.status(401).json({ error: 'User sub claim missing from token' });

  /* 409 if the pilot already has an open or claimed request */
  const existing = store.state.gradingRequests.find(r => r.pilot_id === sub && (r.status === 'open' || r.status === 'claimed'));
  if (existing) {
    return res.status(409).json({ error: 'You already have an open grading request (id ' + existing.id + ')' });
  }

  const rawName = req.user.name || req.user.preferred_username || sub || '';
  const callsign = store.parseCallsign(rawName) || rawName;

  const moduleId = store.sanitizeStr(req.body.module_id || '', 64);
  const moduleTitle = store.sanitizeStr(req.body.module_title || '', MAX_MODULE_TITLE_LEN);

  const request = {
    id: store.state.nextGradingReqId++,
    pilot_id: sub,
    pilot_name: store.sanitizeStr(rawName, MAX_PILOT_NAME_LEN),
    pilot_callsign: store.sanitizeStr(callsign, MAX_PILOT_CALLSIGN_LEN),
    module_id: moduleId || null,
    module_title: moduleTitle || null,
    requested_at: new Date().toISOString(),
    status: 'open',
    claimed_by: null,
    claimed_by_name: null,
    discord_message_id: null,
  };

  store.state.gradingRequests.push(request);
  store.saveJSON(store.GRADING_REQS_FILE, store.state.gradingRequests);

  /* Await Discord so the message ID is included in the 201 response */
  try {
    const msgId = await sendGradingRequestToDiscord(request);
    if (msgId) {
      request.discord_message_id = msgId;
      store.saveJSON(store.GRADING_REQS_FILE, store.state.gradingRequests);
    }
  } catch (err) {
    console.error('[grading] Discord post failed:', err.message);
  }

  res.status(201).json(request);
});

router.put('/grading-requests/:id/claim', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = Number(req.params.id);
  const gradingRequests = store.state.gradingRequests;
  const idx = gradingRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Grading request not found' });

  const graderSub = req.user.sub;
  const graderName = req.user.name || req.user.preferred_username || graderSub || '';

  gradingRequests[idx] = {
    ...gradingRequests[idx],
    status: 'claimed',
    claimed_by: graderSub,
    claimed_by_name: store.sanitizeStr(graderName, MAX_PILOT_NAME_LEN),
  };
  store.saveJSON(store.GRADING_REQS_FILE, gradingRequests);

  /* Update Discord message to show claimed state */
  updateGradingRequestOnDiscord(gradingRequests[idx]).catch(err => {
    console.error('[grading] Discord message update (claim) failed:', err.message);
  });

  res.json(gradingRequests[idx]);
});

router.put('/grading-requests/:id/unclaim', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const id = Number(req.params.id);
  const gradingRequests = store.state.gradingRequests;
  const idx = gradingRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Grading request not found' });
  if (gradingRequests[idx].status !== 'claimed') {
    return res.status(400).json({ error: 'Request is not currently claimed' });
  }
  if (gradingRequests[idx].claimed_by !== req.user.sub) {
    return res.status(403).json({ error: 'Only the person who claimed this request can unclaim it' });
  }

  gradingRequests[idx] = {
    ...gradingRequests[idx],
    status: 'open',
    claimed_by: null,
    claimed_by_name: null,
  };
  store.saveJSON(store.GRADING_REQS_FILE, gradingRequests);

  /* Update Discord message to show open state again */
  updateGradingRequestOnDiscord(gradingRequests[idx]).catch(err => {
    console.error('[grading] Discord message update (unclaim) failed:', err.message);
  });

  res.json(gradingRequests[idx]);
});

router.delete('/grading-requests/:id', writeOpsLimiter, auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const sub = req.user.sub;
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdm = roles.some(r => auth.SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));

  const gradingRequests = store.state.gradingRequests;
  const idx = gradingRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Grading request not found' });

  const request = gradingRequests[idx];
  if (!isAdm && request.pilot_id !== sub) {
    return res.status(403).json({ error: 'You can only delete your own grading requests' });
  }

  const msgId = request.discord_message_id;
  gradingRequests.splice(idx, 1);
  store.saveJSON(store.GRADING_REQS_FILE, gradingRequests);
  res.json({ ok: true });

  /* Delete the Discord message after responding */
  if (msgId && discordClient.DISCORD_BOT_TOKEN && discordClient.GRADING_CHANNEL_ID) {
    discordClient.discordDelete('/channels/' + discordClient.GRADING_CHANNEL_ID + '/messages/' + msgId).catch(err => {
      console.error('[grading] Discord message delete failed:', err.message);
    });
  }
});

module.exports = router;
