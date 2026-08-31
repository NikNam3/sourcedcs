'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const { writeOpsLimiter, bookingLimiter } = require('../rate-limiters');

const router = express.Router();

const RANGE_ALTITUDE_SEPARATION_FT = 999;

function timeWindowsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/* Controller positions: exclusive per overlapping time window (any other
   booking on the same position with an overlapping window is a conflict) */
function findControllerConflict(resourceId, start, end, excludeBookingId) {
  return store.state.bookings.find(b =>
    b.resourceType === 'controller' &&
    b.resourceId === resourceId &&
    b.id !== excludeBookingId &&
    timeWindowsOverlap(start, end, new Date(b.startTime), new Date(b.endTime))
  );
}

/* Ranges: multiple overlapping-window bookings are allowed as long as their
   deconfliction altitudes are at least 999ft apart */
function findRangeConflict(resourceId, start, end, altitude, excludeBookingId) {
  return store.state.bookings.find(b =>
    b.resourceType === 'range' &&
    b.resourceId === resourceId &&
    b.id !== excludeBookingId &&
    timeWindowsOverlap(start, end, new Date(b.startTime), new Date(b.endTime)) &&
    Math.abs(altitude - b.altitude) < RANGE_ALTITUDE_SEPARATION_FT
  );
}

/* Resolves the display name to attribute a booking to: roster callsign if
   the pilot is linked, else the registered pilot's callsign, else the raw
   Casdoor name */
function bookingDisplayName(req) {
  const pilot = store.state.pilotRegistry[req.user.sub];
  const entry = pilot ? discordClient.findRosterEntry(pilot) : null;
  return (entry && entry.callsign) || (pilot && pilot.callsign) || req.user.name || req.user.sub;
}

function findBookingResource(resourceType, resourceId) {
  const list = resourceType === 'range' ? store.state.bookingResources.ranges : store.state.bookingResources.controllers;
  return list.find(r => r.id === resourceId);
}

/* Send a new booking as a Discord embed to the configured notify channel */
async function sendBookingToDiscord(booking, resource) {
  if (!discordClient.DISCORD_BOT_TOKEN) {
    console.warn('[bookings] DISCORD_BOT_TOKEN not set — cannot post booking to Discord');
    return;
  }
  const chId = store.state.bookingResources.notifyChannelId;
  if (!chId) return;

  const fields = [
    { name: booking.resourceType === 'range' ? 'Range' : 'Controller Position', value: resource ? resource.name : booking.resourceId, inline: true },
    { name: 'Frequency', value: resource ? resource.frequency : '—', inline: true },
    { name: 'Window (Z)', value: booking.startTime + ' → ' + booking.endTime, inline: false },
  ];
  if (booking.resourceType === 'range') {
    fields.push({ name: 'Deconfliction Altitude', value: booking.altitude + ' ft', inline: true });
  }
  fields.push({ name: 'Booked By', value: booking.bookedBy.name || '—', inline: true });

  const embed = {
    title: '🗓️ New Booking',
    color: 0x2b6cb0,
    fields,
    timestamp: booking.createdAt,
    footer: { text: 'Booking ID: ' + booking.id },
  };
  await discordClient.discordPost('/channels/' + chId + '/messages', { embeds: [embed] });
  console.debug('[bookings] Booking ' + booking.id + ' posted to Discord channel ' + chId);
}

/* Post a short plain-text notice when a booking is cancelled */
async function sendBookingCancelledToDiscord(booking, resource) {
  if (!discordClient.DISCORD_BOT_TOKEN) return;
  const chId = store.state.bookingResources.notifyChannelId;
  if (!chId) return;
  const label = resource ? resource.name : booking.resourceId;
  await discordClient.discordPost('/channels/' + chId + '/messages', {
    content: '🗑️ Booking cancelled — ' + label + ' (' + booking.startTime + ' → ' + booking.endTime + ') by ' + (booking.bookedBy.name || 'unknown'),
  });
  console.debug('[bookings] Booking ' + booking.id + ' cancellation posted to Discord channel ' + chId);
}

/* GET /api/booking-resources — members-only read; notifyChannelId only
   included for booking admins (mirrors /flight-plans/config) */
router.get('/booking-resources', auth.requireAuth, (req, res) => {
  const out = { ranges: store.state.bookingResources.ranges, controllers: store.state.bookingResources.controllers };
  if (auth.isBookingAdminUser(req)) out.notifyChannelId = store.state.bookingResources.notifyChannelId || '';
  res.json(out);
});

router.put('/booking-resources/config', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (req, res) => {
  const ch = store.sanitizeStr((req.body || {}).notifyChannelId, 32).replace(/\D/g, '');
  store.state.bookingResources.notifyChannelId = ch;
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  res.json({ notifyChannelId: store.state.bookingResources.notifyChannelId });
});

/* ── Ranges CRUD ── */
router.post('/booking-resources/ranges', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (req, res) => {
  const { id, name, frequency, minAltitude, maxAltitude } = req.body || {};
  if (!id || !name || !frequency) return res.status(400).json({ error: 'id, name and frequency are required' });
  const min = Number(minAltitude), max = Number(maxAltitude);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return res.status(400).json({ error: 'minAltitude must be a number less than maxAltitude' });
  }
  const cleanId = store.sanitizeStr(id, 32);
  if (store.state.bookingResources.ranges.find(r => r.id === cleanId)) return res.status(409).json({ error: 'Range ID already exists' });
  const range = { id: cleanId, name: store.sanitizeStr(name, 64), frequency: store.sanitizeStr(frequency, 16), minAltitude: min, maxAltitude: max };
  store.state.bookingResources.ranges.push(range);
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  res.status(201).json(range);
});

router.put('/booking-resources/ranges/:id', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (req, res) => {
  const idx = store.state.bookingResources.ranges.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Range not found' });
  const { name, frequency, minAltitude, maxAltitude } = req.body || {};
  const range = store.state.bookingResources.ranges[idx];
  if (name !== undefined) range.name = store.sanitizeStr(name, 64);
  if (frequency !== undefined) range.frequency = store.sanitizeStr(frequency, 16);
  if (minAltitude !== undefined || maxAltitude !== undefined) {
    const min = minAltitude !== undefined ? Number(minAltitude) : range.minAltitude;
    const max = maxAltitude !== undefined ? Number(maxAltitude) : range.maxAltitude;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      return res.status(400).json({ error: 'minAltitude must be a number less than maxAltitude' });
    }
    range.minAltitude = min;
    range.maxAltitude = max;
  }
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  res.json(range);
});

router.delete('/booking-resources/ranges/:id', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (req, res) => {
  const idx = store.state.bookingResources.ranges.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Range not found' });
  const id = req.params.id;
  store.state.bookingResources.ranges.splice(idx, 1);
  store.state.bookings = store.state.bookings.filter(b => !(b.resourceType === 'range' && b.resourceId === id));
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
  console.debug('[bookings] Range ' + id + ' deleted (cascaded any bookings) by ' + (req.user.name || req.user.sub));
  res.json({ ok: true });
});

/* ── Controller positions CRUD ── */
router.post('/booking-resources/controllers', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (req, res) => {
  const { id, name, frequency } = req.body || {};
  if (!id || !name || !frequency) return res.status(400).json({ error: 'id, name and frequency are required' });
  const cleanId = store.sanitizeStr(id, 32);
  if (store.state.bookingResources.controllers.find(c => c.id === cleanId)) return res.status(409).json({ error: 'Controller position ID already exists' });
  const ctrl = { id: cleanId, name: store.sanitizeStr(name, 64), frequency: store.sanitizeStr(frequency, 16) };
  store.state.bookingResources.controllers.push(ctrl);
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  res.status(201).json(ctrl);
});

router.put('/booking-resources/controllers/:id', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (req, res) => {
  const idx = store.state.bookingResources.controllers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Controller position not found' });
  const { name, frequency } = req.body || {};
  const ctrl = store.state.bookingResources.controllers[idx];
  if (name !== undefined) ctrl.name = store.sanitizeStr(name, 64);
  if (frequency !== undefined) ctrl.frequency = store.sanitizeStr(frequency, 16);
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  res.json(ctrl);
});

router.delete('/booking-resources/controllers/:id', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (req, res) => {
  const idx = store.state.bookingResources.controllers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Controller position not found' });
  const id = req.params.id;
  store.state.bookingResources.controllers.splice(idx, 1);
  store.state.bookings = store.state.bookings.filter(b => !(b.resourceType === 'controller' && b.resourceId === id));
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
  console.debug('[bookings] Controller position ' + id + ' deleted (cascaded any bookings) by ' + (req.user.name || req.user.sub));
  res.json({ ok: true });
});

/* ── Bookings CRUD ── */
router.get('/bookings', auth.requireAuth, (_req, res) => {
  res.json(store.state.bookings);
});

router.post('/bookings', bookingLimiter, auth.requireAuth, (req, res) => {
  const b = req.body || {};
  const resourceType = (b.resourceType === 'range' || b.resourceType === 'controller') ? b.resourceType : null;
  if (!resourceType) return res.status(400).json({ error: 'resourceType must be "range" or "controller"' });
  const resourceId = store.sanitizeStr(b.resourceId, 32);
  const resource = findBookingResource(resourceType, resourceId);
  if (!resource) return res.status(404).json({ error: 'Resource not found' });

  const start = new Date(b.startTime);
  const end = new Date(b.endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'startTime/endTime must be valid, with endTime after startTime' });
  }

  let altitude;
  if (resourceType === 'range') {
    altitude = Number(b.altitude);
    if (!Number.isFinite(altitude) || altitude < resource.minAltitude || altitude > resource.maxAltitude) {
      return res.status(400).json({ error: 'altitude must be between ' + resource.minAltitude + ' and ' + resource.maxAltitude });
    }
    const conflict = findRangeConflict(resourceId, start, end, altitude, null);
    if (conflict) {
      return res.status(409).json({ error: 'Range already booked at ' + conflict.altitude + 'ft in an overlapping time window — choose an altitude at least ' + RANGE_ALTITUDE_SEPARATION_FT + 'ft away' });
    }
  } else {
    const conflict = findControllerConflict(resourceId, start, end, null);
    if (conflict) {
      return res.status(409).json({ error: 'Controller position already booked for an overlapping time window' });
    }
  }

  const booking = {
    id: store.state.nextBookingId++,
    resourceType,
    resourceId,
    bookedBy: { sub: req.user.sub, name: bookingDisplayName(req) },
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    createdAt: new Date().toISOString(),
  };
  if (resourceType === 'range') booking.altitude = altitude;

  store.state.bookings.push(booking);
  store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
  console.debug('[bookings] Booking ' + booking.id + ' created by ' + booking.bookedBy.name);
  res.status(201).json(booking);

  sendBookingToDiscord(booking, resource).catch(err =>
    console.error('[bookings] Discord notify failed:', err.message)
  );
});

router.put('/bookings/:id', writeOpsLimiter, auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const idx = store.state.bookings.findIndex(bk => bk.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  const booking = store.state.bookings[idx];
  const isOwner = booking.bookedBy && booking.bookedBy.sub === req.user.sub;
  if (!isOwner && !auth.isBookingAdminUser(req)) {
    return res.status(403).json({ error: 'You can only edit your own bookings' });
  }

  const b = req.body || {};
  const start = b.startTime !== undefined ? new Date(b.startTime) : new Date(booking.startTime);
  const end = b.endTime !== undefined ? new Date(b.endTime) : new Date(booking.endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'startTime/endTime must be valid, with endTime after startTime' });
  }

  const resource = findBookingResource(booking.resourceType, booking.resourceId);
  if (!resource) return res.status(404).json({ error: 'Resource no longer exists' });

  let altitude = booking.altitude;
  if (booking.resourceType === 'range') {
    if (b.altitude !== undefined) altitude = Number(b.altitude);
    if (!Number.isFinite(altitude) || altitude < resource.minAltitude || altitude > resource.maxAltitude) {
      return res.status(400).json({ error: 'altitude must be between ' + resource.minAltitude + ' and ' + resource.maxAltitude });
    }
    const conflict = findRangeConflict(booking.resourceId, start, end, altitude, booking.id);
    if (conflict) {
      return res.status(409).json({ error: 'Range already booked at ' + conflict.altitude + 'ft in an overlapping time window — choose an altitude at least ' + RANGE_ALTITUDE_SEPARATION_FT + 'ft away' });
    }
  } else {
    const conflict = findControllerConflict(booking.resourceId, start, end, booking.id);
    if (conflict) {
      return res.status(409).json({ error: 'Controller position already booked for an overlapping time window' });
    }
  }

  booking.startTime = start.toISOString();
  booking.endTime = end.toISOString();
  if (booking.resourceType === 'range') booking.altitude = altitude;

  store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
  res.json(booking);
});

router.delete('/bookings/:id', writeOpsLimiter, auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const idx = store.state.bookings.findIndex(bk => bk.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  const booking = store.state.bookings[idx];
  const isOwner = booking.bookedBy && booking.bookedBy.sub === req.user.sub;
  if (!isOwner && !auth.isBookingAdminUser(req)) {
    return res.status(403).json({ error: 'You can only cancel your own bookings' });
  }
  const resource = findBookingResource(booking.resourceType, booking.resourceId);
  store.state.bookings.splice(idx, 1);
  store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
  console.debug('[bookings] Booking ' + id + ' cancelled by ' + (req.user.name || req.user.sub));
  res.json({ ok: true });

  sendBookingCancelledToDiscord(booking, resource).catch(err =>
    console.error('[bookings] Discord cancel notify failed:', err.message)
  );
});

module.exports = router;
