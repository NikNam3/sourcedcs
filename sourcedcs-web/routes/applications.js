'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const { applyLimiter } = require('../rate-limiters');

const router = express.Router();

/* Send a new application as a Discord embed to the configured channel */
async function sendApplicationToDiscord(application) {
  if (!discordClient.DISCORD_BOT_TOKEN) {
    console.warn('[apply] DISCORD_BOT_TOKEN not set — cannot post application to Discord');
    return;
  }
  if (!discordClient.APPLY_CHANNEL_ID) {
    console.warn('[apply] APPLY_CHANNEL_ID not set — cannot post application to Discord');
    return;
  }
  const embed = {
    title: '📋 New Application',
    color: 0x00b0f4,
    fields: [
      { name: 'Callsign', value: application.callsign || '—', inline: true },
      { name: 'Discord', value: application.discordHandle || '—', inline: true },
      { name: 'Age Group', value: String(application.age) || '—', inline: true },
      { name: 'Timezone', value: application.timezone || '—', inline: true },
      { name: 'Preferred Squadron', value: application.subSquadron || '—', inline: true },
      { name: 'Experience', value: application.experience || 'N/A', inline: false },
      { name: 'Modules', value: application.modules || 'N/A', inline: false },
    ],
    timestamp: application.submittedAt,
    footer: { text: 'Application ID: ' + application.id },
  };
  await discordClient.discordPost('/channels/' + discordClient.APPLY_CHANNEL_ID + '/messages', { embeds: [embed] });
  console.debug('[apply] Application ' + application.id + ' posted to Discord channel ' + discordClient.APPLY_CHANNEL_ID);
}

router.post('/apply', applyLimiter, (req, res) => {
  const { callsign, discordHandle, age, timezone, subSquadron, experience, modules } = req.body;
  if (!callsign || !discordHandle || !age || !timezone || !subSquadron) {
    return res.status(400).json({ error: 'Required fields are missing' });
  }
  if (typeof callsign !== 'string' || callsign.length > 32 || callsign.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid callsign' });
  }
  if (typeof discordHandle !== 'string' || discordHandle.length > 64) {
    return res.status(400).json({ error: 'Invalid Discord handle' });
  }

  const application = {
    id: Date.now(),
    callsign: callsign.trim(),
    discordHandle: discordHandle.trim(),
    age,
    timezone: String(timezone).trim(),
    subSquadron,
    experience: experience || '',
    modules: typeof modules === 'string' ? modules.slice(0, 500) : '',
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };

  /* Send application to the configured Discord channel.
     Falls back to JSON storage if APPLY_CHANNEL_ID is not set or if posting fails. */
  if (discordClient.APPLY_CHANNEL_ID) {
    sendApplicationToDiscord(application).catch(err => {
      console.error('[apply] Failed to post application to Discord:', err.message, '— falling back to JSON storage');
      store.state.applications.push(application);
      store.saveJSON(store.APPS_FILE, store.state.applications);
    });
  } else {
    store.state.applications.push(application);
    store.saveJSON(store.APPS_FILE, store.state.applications);
  }

  res.status(201).json({
    ok: true,
    message: 'Application received! Join our Discord to get started:',
    discord: store.DISCORD_URL,
  });
});

/* Admin: list applications */
router.get('/applications', auth.requireAuth, auth.requireAdmin, (_req, res) => {
  res.json(store.state.applications);
});

module.exports = router;
