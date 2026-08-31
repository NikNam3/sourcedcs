'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

/* ─── Discord scheduled events sync ─────────────────────── */
/* Fetches guild scheduled events from Discord and merges them into the
   local events list. Completed events are logged with status 'complete'. */
let eventsSyncAt = 0;

function mapDiscordEventStatus(discordStatus) {
  /* Discord statuses: 1=SCHEDULED, 2=ACTIVE, 3=COMPLETED, 4=CANCELED */
  switch (discordStatus) {
    case 1: return 'planned';
    case 2: return 'active';
    case 3: return 'complete';
    case 4: return 'cancelled';
    default: return 'planned';
  }
}

async function syncDiscordScheduledEvents() {
  if (!discordClient.DISCORD_BOT_TOKEN || !discordClient.DISCORD_GUILD_ID) return;
  try {
    const discordEvents = await discordClient.discordRequest(
      '/guilds/' + discordClient.DISCORD_GUILD_ID + '/scheduled-events'
    );
    if (!Array.isArray(discordEvents)) return;

    const events = store.state.events;
    let changed = false;
    for (const de of discordEvents) {
      const discordId = 'discord-' + de.id;
      const status = mapDiscordEventStatus(de.status);
      const idx = events.findIndex(e => e.discordEventId === discordId);

      if (idx !== -1) {
        /* Update existing synced event */
        const existing = events[idx];
        if (existing.status !== status || existing.name !== de.name) {
          events[idx] = {
            ...existing,
            name: de.name || existing.name,
            status: status,
            date: de.scheduled_start_time || existing.date,
            description: de.description || existing.description,
          };
          changed = true;
          console.debug('[events-sync] Updated event', discordId, '→', status);
        }
      } else {
        /* Create new event from Discord */
        const ev = {
          id: store.state.nextEventId++,
          discordEventId: discordId,
          name: String(de.name || 'Discord Event').trim(),
          type: 'campaign',
          status: status,
          date: de.scheduled_start_time || new Date().toISOString(),
          map: (de.entity_metadata && de.entity_metadata.location) || '',
          airframes: [],
          description: String(de.description || '').trim(),
          slots: 0,
          filledSlots: 0,
        };
        events.push(ev);
        changed = true;
        console.debug('[events-sync] Created event', discordId, ':', ev.name);
      }
    }

    if (changed) {
      store.saveJSON(store.EVENTS_FILE, events);
    }
    eventsSyncAt = Date.now();
    console.debug('[events-sync] Sync complete, ' + discordEvents.length + ' Discord event(s) processed');
  } catch (err) {
    console.error('[events-sync] Discord fetch failed:', err.message);
  }
}

router.get('/events', async (_req, res) => {
  /* Auto-sync from Discord scheduled events (cached) */
  if (Date.now() - eventsSyncAt > store.EVENTS_SYNC_TTL) {
    await syncDiscordScheduledEvents();
  }
  res.json(store.state.events);
});

router.post('/events', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const { name, type, status, date, map, airframes, description, slots } = req.body;
  if (!name || !type || !date) {
    return res.status(400).json({ error: 'name, type and date are required' });
  }
  const ev = {
    id: store.state.nextEventId++,
    name: String(name).trim(),
    type,
    status: status || 'planned',
    date,
    map: map || '',
    airframes: Array.isArray(airframes) ? airframes : [String(airframes || 'Any')],
    description: String(description || '').trim(),
    slots: Number(slots) || 0,
    filledSlots: 0,
  };
  store.state.events.push(ev);
  store.saveJSON(store.EVENTS_FILE, store.state.events);
  res.status(201).json(ev);
});

router.put('/events/:id', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const events = store.state.events;
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  events[idx] = { ...events[idx], ...req.body, id };
  store.saveJSON(store.EVENTS_FILE, events);
  res.json(events[idx]);
});

router.delete('/events/:id', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const events = store.state.events;
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  events.splice(idx, 1);
  store.saveJSON(store.EVENTS_FILE, events);
  res.json({ ok: true });
});

/* Admin: force-refresh Discord scheduled events sync */
router.post('/events/sync', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, async (_req, res) => {
  eventsSyncAt = 0;
  await syncDiscordScheduledEvents();
  res.json({ ok: true, message: 'Discord events synced.', count: store.state.events.length });
});

module.exports = router;
