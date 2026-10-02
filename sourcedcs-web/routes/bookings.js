'use strict';
const log = require('../logger');

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const { writeOpsLimiter, bookingLimiter } = require('../rate-limiters');
const crcsync = require('../crcsync-client');
const ab = require('../airspace-bookings');

const router = express.Router();

const RANGE_ALTITUDE_SEPARATION_FT = ab.SEPARATION_FT;
const LEGACY_REFUSAL = 'legacy range: migrate it to an airspace';
const REGISTRY_DOWN = 'crc-sync unreachable: airspace limits cannot be checked right now';

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
    log.warn('[bookings] DISCORD_BOT_TOKEN not set — cannot post booking to Discord');
    return;
  }
  const chId = store.state.bookingResources.notifyChannelId;
  if (!chId) return;

  const isAirspace = booking.resourceType === 'airspace';
  const fields = [];
  if (isAirspace) {
    fields.push({ name: 'Theater', value: booking.airspaceRef.theater, inline: true });
    fields.push({ name: 'Airspace', value: resource && resource.name ? resource.name + ' (' + booking.airspaceRef.airspaceId + ')' : booking.airspaceRef.airspaceId, inline: true });
  } else {
    fields.push({ name: booking.resourceType === 'range' ? 'Range' : 'Controller Position', value: resource ? resource.name : booking.resourceId, inline: true });
  }
  fields.push(
    { name: 'Frequency', value: resource && resource.frequency ? resource.frequency : '—', inline: true },
    { name: 'Window (Z)', value: booking.startTime + ' → ' + booking.endTime, inline: false },
  );
  if (booking.resourceType === 'range' || isAirspace) {
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
  log.debug('[bookings] Booking ' + booking.id + ' posted to Discord channel ' + chId);
}

/* Post a short plain-text notice when a booking is cancelled */
async function sendBookingCancelledToDiscord(booking, resource) {
  if (!discordClient.DISCORD_BOT_TOKEN) return;
  const chId = store.state.bookingResources.notifyChannelId;
  if (!chId) return;
  const label = booking.resourceType === 'airspace'
    ? booking.airspaceRef.theater + ' / ' + booking.airspaceRef.airspaceId
    : (resource ? resource.name : booking.resourceId);
  await discordClient.discordPost('/channels/' + chId + '/messages', {
    content: '🗑️ Booking cancelled — ' + label + ' (' + booking.startTime + ' → ' + booking.endTime + ') by ' + (booking.bookedBy.name || 'unknown'),
  });
  log.debug('[bookings] Booking ' + booking.id + ' cancellation posted to Discord channel ' + chId);
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

/* ── Legacy ranges ──
   Ranges are legacy since the airspace registry (docs/adr/0098): no new range is created, and
   once the last one is migrated or deleted the update/delete routes answer 410 too. A follow-up
   chore removes this section and the migration once production has been migrated. */
const GONE = { error: 'Legacy ranges are retired: book registry airspaces instead' };
function legacyGone(req, res, next) {
  if (!store.state.bookingResources.ranges.length) return res.status(410).json(GONE);
  next();
}

router.post('/booking-resources/ranges', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, (_req, res) => {
  res.status(410).json(GONE);
});

function countsForRange(id, nowMs) {
  const mine = store.state.bookings.filter(b => b.resourceType === 'range' && b.resourceId === id);
  return { bookingCount: mine.length, futureBookingCount: mine.filter(b => new Date(b.endTime).getTime() > nowMs).length };
}

router.get('/booking-resources/ranges/legacy', auth.requireAuth, auth.requireBookingAdmin, (_req, res) => {
  const nowMs = Date.now();
  res.json({ ranges: store.state.bookingResources.ranges.map(r => Object.assign({}, r, countsForRange(r.id, nowMs))) });
});

/* One-time migration of a legacy range to a registry airspace (H100 DA-5 b): all or nothing. */
router.post('/booking-resources/ranges/:id/migrate', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, async (req, res) => {
  const id = req.params.id;
  const resources = store.state.bookingResources;
  const body = req.body || {};
  const theater = typeof body.theater === 'string' ? body.theater : '';
  const airspaceId = typeof body.airspaceId === 'string' ? body.airspaceId : '';

  const done = resources.migratedRanges && resources.migratedRanges[id];
  const idx = resources.ranges.findIndex(r => r.id === id);
  if (idx === -1) {
    if (done) return res.json({ ok: true, alreadyMigrated: true, moved: done.count, airspaceRef: done.airspaceRef });
    return res.status(404).json({ error: 'Range not found' });
  }
  if (!theater || !airspaceId) return res.status(400).json({ error: 'theater and airspaceId are required' });

  const r = await crcsync.getClient().listAirspaces(theater, { fresh: true });
  if (!r.ok) return res.status(503).json({ error: 'crc-sync unreachable', reason: r.reason });
  const entry = r.airspaces.find(a => a.definition && a.definition.airspaceId === airspaceId);
  const ref = { theater, airspaceId };
  const plan = ab.planMigration({ rangeId: id, ref, def: entry && entry.definition, bookings: store.state.bookings, allowOutOfBand: body.allowOutOfBand === true, nowMs: Date.now() });
  if (plan.refusals.length) {
    return res.status(409).json({ error: 'Migration refused; nothing was changed', refusals: plan.refusals });
  }

  const oldBookings = store.state.bookings;
  const oldResources = { ranges: resources.ranges, migratedRanges: resources.migratedRanges };
  const moved = new Set(plan.moved);
  const by = req.user.name || req.user.sub;
  store.state.bookings = oldBookings.map(b => {
    if (!moved.has(b.id)) return b;
    const nb = Object.assign({}, b, { resourceType: 'airspace', airspaceRef: { theater, airspaceId }, migratedFromRangeId: id });
    delete nb.resourceId;
    return nb;
  });
  resources.ranges = oldResources.ranges.filter(x => x.id !== id);
  resources.migratedRanges = Object.assign({}, oldResources.migratedRanges, { [id]: { airspaceRef: { theater, airspaceId }, count: plan.moved.length, at: new Date().toISOString(), by } });
  try {
    store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
    store.saveJSON(store.BOOKING_RESOURCES_FILE, resources);
  } catch (err) {
    store.state.bookings = oldBookings;
    resources.ranges = oldResources.ranges;
    resources.migratedRanges = oldResources.migratedRanges;
    try { store.saveJSON(store.BOOKINGS_FILE, oldBookings); } catch { /* best effort rollback */ }
    log.error('[bookings] Range migration failed to save:', err.message);
    return res.status(500).json({ error: 'Could not save the migration; nothing was changed' });
  }
  log.info('[bookings] Range ' + id + ' migrated to ' + theater + '/' + airspaceId + ' by ' + by + ' (' + plan.moved.length + ' bookings)');
  res.json({ ok: true, moved: plan.moved.length, airspaceRef: { theater, airspaceId }, remainingLegacy: resources.ranges.length });
});

router.put('/booking-resources/ranges/:id', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, legacyGone, (req, res) => {
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

router.delete('/booking-resources/ranges/:id', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, legacyGone, (req, res) => {
  const idx = store.state.bookingResources.ranges.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Range not found' });
  const id = req.params.id;
  store.state.bookingResources.ranges.splice(idx, 1);
  store.state.bookings = store.state.bookings.filter(b => !(b.resourceType === 'range' && b.resourceId === id));
  store.saveJSON(store.BOOKING_RESOURCES_FILE, store.state.bookingResources);
  store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
  log.debug('[bookings] Range ' + id + ' deleted (cascaded any bookings) by ' + (req.user.name || req.user.sub));
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
  log.debug('[bookings] Controller position ' + id + ' deleted (cascaded any bookings) by ' + (req.user.name || req.user.sub));
  res.json({ ok: true });
});

/* ── Bookings CRUD ── */
router.get('/bookings', auth.requireAuth, (_req, res) => {
  res.json(store.state.bookings);
});

/* Looks up one airspace definition through the 30 s read cache; { err: {status, error} } when it cannot. */
async function lookupAirspace(ref) {
  const r = await crcsync.getClient().listAirspaces(ref.theater);
  if (!r.ok) return { err: { status: 503, error: REGISTRY_DOWN } };
  const entry = r.airspaces.find(a => a.definition && a.definition.airspaceId === ref.airspaceId);
  if (!entry) return { err: { status: 404, error: 'Airspace not found in the ' + ref.theater + ' registry' } };
  return { def: entry.definition };
}

function checkAirspaceAltitude(def, altitude) {
  if (!Number.isFinite(altitude) || !ab.altitudeInBand(altitude, def)) {
    return 'altitude must be within the airspace limits (' + ab.bandText(def) + ')';
  }
  return null;
}

router.post('/bookings', bookingLimiter, auth.requireAuth, async (req, res) => {
  const b = req.body || {};
  const resourceType = ['range', 'controller', 'airspace'].includes(b.resourceType) ? b.resourceType : null;
  if (!resourceType) return res.status(400).json({ error: 'resourceType must be "airspace" or "controller"' });
  if (resourceType === 'range') return res.status(409).json({ error: LEGACY_REFUSAL });

  const start = new Date(b.startTime);
  const end = new Date(b.endTime);
  const timesOk = !(isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start);

  let resourceId, resource, airspaceRef, altitude;
  if (resourceType === 'airspace') {
    const r = b.airspaceRef || {};
    if (typeof r.theater !== 'string' || typeof r.airspaceId !== 'string' || !r.theater || !r.airspaceId || r.theater.length > 64 || r.airspaceId.length > 64) {
      return res.status(400).json({ error: 'airspaceRef { theater, airspaceId } is required' });
    }
    if (!timesOk) return res.status(400).json({ error: 'startTime/endTime must be valid, with endTime after startTime' });
    airspaceRef = { theater: r.theater, airspaceId: r.airspaceId };
    const found = await lookupAirspace(airspaceRef);
    if (found.err) return res.status(found.err.status).json({ error: found.err.error });
    altitude = Number(b.altitude);
    const altErr = checkAirspaceAltitude(found.def, altitude);
    if (altErr) return res.status(400).json({ error: altErr });
    const conflict = ab.findAirspaceConflict(store.state.bookings, airspaceRef, start, end, altitude, null);
    if (conflict) {
      return res.status(409).json({ error: 'Airspace already booked at ' + conflict.altitude + 'ft in an overlapping time window — choose an altitude at least ' + RANGE_ALTITUDE_SEPARATION_FT + 'ft away' });
    }
    resource = { name: found.def.name, frequency: found.def.workingFrequencyMhz != null ? String(found.def.workingFrequencyMhz) : '' };
  } else {
    resourceId = store.sanitizeStr(b.resourceId, 32);
    resource = findBookingResource(resourceType, resourceId);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    if (!timesOk) return res.status(400).json({ error: 'startTime/endTime must be valid, with endTime after startTime' });
    const conflict = findControllerConflict(resourceId, start, end, null);
    if (conflict) {
      return res.status(409).json({ error: 'Controller position already booked for an overlapping time window' });
    }
  }

  const booking = {
    id: store.state.nextBookingId++,
    resourceType,
    bookedBy: { sub: req.user.sub, name: bookingDisplayName(req) },
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    createdAt: new Date().toISOString(),
  };
  if (resourceType === 'airspace') { booking.airspaceRef = airspaceRef; booking.altitude = altitude; }
  else booking.resourceId = resourceId;

  store.state.bookings.push(booking);
  store.saveJSON(store.BOOKINGS_FILE, store.state.bookings);
  log.debug('[bookings] Booking ' + booking.id + ' created by ' + booking.bookedBy.name);
  res.status(201).json(booking);

  sendBookingToDiscord(booking, resource).catch(err =>
    log.error('[bookings] Discord notify failed:', err.message)
  );
});

/* crc-sync's calendar read (docs/adr/0098 section 9, DA-6): airspace bookings that have not ended.
   Display name only, no user ids. Registered before any /bookings/:id route. */
router.get('/bookings/service/upcoming', auth.requireAirspaceService, (_req, res) => {
  const now = Date.now();
  res.json(store.state.bookings
    .filter(b => b.resourceType === 'airspace' && new Date(b.endTime).getTime() > now)
    .sort((x, y) => new Date(x.startTime) - new Date(y.startTime))
    .map(b => ({ airspaceRef: b.airspaceRef, startUtc: b.startTime, endUtc: b.endTime, by: (b.bookedBy && b.bookedBy.name) || '', altitudeFt: b.altitude })));
});

router.put('/bookings/:id', writeOpsLimiter, auth.requireAuth, async (req, res) => {
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

  let altitude = booking.altitude;
  if (booking.resourceType === 'airspace') {
    const found = await lookupAirspace(booking.airspaceRef);
    if (found.err) return res.status(found.err.status).json({ error: found.err.error });
    /* the registry read awaited: the booking may have been moved/cancelled meanwhile */
    if (!store.state.bookings.includes(booking)) return res.status(409).json({ error: 'Booking changed while saving; reload and try again' });
    if (b.altitude !== undefined) altitude = Number(b.altitude);
    const altErr = checkAirspaceAltitude(found.def, altitude);
    if (altErr) return res.status(400).json({ error: altErr });
    const conflict = ab.findAirspaceConflict(store.state.bookings, booking.airspaceRef, start, end, altitude, booking.id);
    if (conflict) {
      return res.status(409).json({ error: 'Airspace already booked at ' + conflict.altitude + 'ft in an overlapping time window — choose an altitude at least ' + RANGE_ALTITUDE_SEPARATION_FT + 'ft away' });
    }
  } else {
    const resource = findBookingResource(booking.resourceType, booking.resourceId);
    if (!resource) return res.status(404).json({ error: 'Resource no longer exists' });
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
  }

  booking.startTime = start.toISOString();
  booking.endTime = end.toISOString();
  if (booking.resourceType !== 'controller') booking.altitude = altitude;

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
  log.debug('[bookings] Booking ' + id + ' cancelled by ' + (req.user.name || req.user.sub));
  res.json({ ok: true });

  sendBookingCancelledToDiscord(booking, resource).catch(err =>
    log.error('[bookings] Discord cancel notify failed:', err.message)
  );
});

module.exports = router;
