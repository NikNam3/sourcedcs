'use strict';

/* DD Form 1801 (ICAO IFR Flight Plan). Config reuses fpConfig /
   fpIsControllerUser / fpIsAdminUser from the DD 175 (flight-plans)
   section — see fp-shared.js. */

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const fpShared = require('../fp-shared');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

/* Parse DOF/YYMMDD from field 18 otherInfo; returns a UTC Date or null */
function parseFpl1801Dof(otherInfo) {
  const m = (otherInfo || '').match(/\bDOF\/(\d{2})(\d{2})(\d{2})\b/i);
  if (!m) return null;
  return new Date(Date.UTC(2000 + parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
}

/* Delete plans whose DOF is more than 2 days in the past */
function cleanupExpiredFpl1801() {
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const before = store.state.fpl1801Plans.length;
  store.state.fpl1801Plans = store.state.fpl1801Plans.filter(fp => {
    const dof = parseFpl1801Dof(fp.otherInfo);
    return !dof || dof.getTime() >= cutoff;
  });
  const removed = before - store.state.fpl1801Plans.length;
  if (removed > 0) {
    store.saveJSON(store.FPL1801_FILE, store.state.fpl1801Plans);
    console.debug('[fpl1801] Removed ' + removed + ' expired plan(s)');
  }
}

/* Run cleanup on startup and every hour */
cleanupExpiredFpl1801();
setInterval(cleanupExpiredFpl1801, 60 * 60 * 1000);

/* Send a plain-text FPL message to the configured notify channel */
async function sendFpl1801ToDiscord(plan) {
  if (!discordClient.DISCORD_BOT_TOKEN) return;
  const chId = store.state.fpConfig.notifyChannelId;
  if (!chId) return;
  const msg = (plan.fplMessage || '').trim();
  if (!msg) return;
  await discordClient.discordPost('/channels/' + chId + '/messages', { content: '```\n' + msg + '\n```' });
  console.debug('[fpl1801] FPL-' + plan.id + ' posted to Discord channel ' + chId);
}

/* GET /api/fpl1801/by-callsign/:callsign — public, returns active plan for a callsign */
router.get('/fpl1801/by-callsign/:callsign', (req, res) => {
  const callsign = (req.params.callsign || '').toUpperCase().trim();
  if (!callsign) return res.status(400).json({ error: 'callsign is required' });
  const plan = store.state.fpl1801Plans.find(fp => fp.aircraftId === callsign);
  if (!plan) return res.status(404).json({ error: 'No active flight plan for callsign ' + callsign });
  res.json({ ...plan, submittedBy: plan.submittedBy ? { name: plan.submittedBy.name } : null });
});

/* GET /api/fpl1801/service/all — every currently-filed plan, for crc-sync's
   EFSP "filed but not yet an active Strip" queue (OPS's ops-filed Bay).
   Gated by the FLIGHT_PLAN_SERVICE_TOKEN shared secret (auth.js) instead
   of a Casdoor session, same shape as /api/releases/upload -- crc-sync has
   no interactive login of its own, and the alternative (asking it to
   impersonate an admin/controller via requireAuth's unsigned JWT decode)
   was deliberately rejected. submittedBy is redacted to .name only,
   matching by-callsign's existing redaction above -- the caller only ever
   needs "who filed this" for display, never the Casdoor sub. */
router.get('/fpl1801/service/all', auth.requireFlightPlanService, (req, res) => {
  const plans = store.state.fpl1801Plans.map(fp => ({
    ...fp,
    submittedBy: fp.submittedBy ? { name: fp.submittedBy.name } : null,
  }));
  res.json(plans);
});

/* GET /api/fpl1801 */
router.get('/fpl1801', auth.requireAuth, (req, res) => {
  if (fpShared.fpIsAdminUser(req) || fpShared.fpIsControllerUser(req)) return res.json(store.state.fpl1801Plans);
  const sub = req.user.sub;
  res.json(store.state.fpl1801Plans.filter(fp => fp.submittedBy && fp.submittedBy.sub === sub));
});

/* POST /api/fpl1801 */
router.post('/fpl1801', writeOpsLimiter, auth.requireAuth, (req, res) => {
  const b = req.body;
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Invalid request body' });

  const aircraftId = store.sanitizeStr(b.aircraftId, 7).toUpperCase();
  if (!aircraftId) return res.status(400).json({ error: 'Field 7 (Aircraft Identification) is required.' });
  if (!b.depAerodrome) return res.status(400).json({ error: 'Field 13 (Departure Aerodrome) is required.' });
  if (!b.destAerodrome) return res.status(400).json({ error: 'Field 16 (Destination Aerodrome) is required.' });

  const existing = store.state.fpl1801Plans.find(fp => fp.aircraftId === aircraftId);
  if (existing) {
    return res.status(409).json({ error: 'An active flight plan already exists for callsign ' + aircraftId + ' (FPL-' + existing.id + '). Delete it before filing a new one.' });
  }

  const plan = {
    id: store.state.nextFpl1801Id++,
    submittedAt: new Date().toISOString(),
    submittedBy: { sub: req.user.sub, name: req.user.name || req.user.sub },
    aircraftId,
    flightRules: store.sanitizeStr(b.flightRules, 1).toUpperCase() || 'I',
    typeOfFlight: store.sanitizeStr(b.typeOfFlight, 1).toUpperCase() || 'M',
    numAircraft: Math.max(1, Math.min(99, parseInt(b.numAircraft, 10) || 1)),
    aircraftType: store.sanitizeStr(b.aircraftType, 4).toUpperCase(),
    wtc: store.sanitizeStr(b.wtc, 1).toUpperCase() || 'M',
    equipment: store.sanitizeStr(b.equipment, 64).toUpperCase(),
    transponder: store.sanitizeStr(b.transponder, 8).toUpperCase(),
    depAerodrome: store.sanitizeStr(b.depAerodrome, 4).toUpperCase(),
    depTime: store.sanitizeStr(b.depTime, 4),
    speedUnit: store.sanitizeStr(b.speedUnit, 1).toUpperCase(),
    speedValue: store.sanitizeStr(b.speedValue, 4),
    levelUnit: store.sanitizeStr(b.levelUnit, 1).toUpperCase(),
    levelValue: store.sanitizeStr(b.levelValue, 4),
    route: store.sanitizeStr(b.route, 1000).toUpperCase(),
    destAerodrome: store.sanitizeStr(b.destAerodrome, 4).toUpperCase(),
    eet: store.sanitizeStr(b.eet, 4),
    altn1: store.sanitizeStr(b.altn1, 4).toUpperCase(),
    altn2: store.sanitizeStr(b.altn2, 4).toUpperCase(),
    otherInfo: store.sanitizeStr(b.otherInfo, 500).toUpperCase(),
    worldTour: Boolean(b.worldTour),
    liveStreaming: Boolean(b.liveStreaming),
    endurance: store.sanitizeStr(b.endurance, 4),
    pob: store.sanitizeStr(b.pob, 8),
    pic: store.sanitizeStr(b.pic, 56).toUpperCase(),
    fplMessage: store.sanitizeStr(b.fplMessage, 2000),
    status: 'submitted',
  };

  store.state.fpl1801Plans.push(plan);
  store.saveJSON(store.FPL1801_FILE, store.state.fpl1801Plans);
  console.debug('[fpl1801] Plan ' + plan.id + ' submitted by ' + plan.submittedBy.name);
  res.status(201).json(plan);

  sendFpl1801ToDiscord(plan).catch(err =>
    console.error('[fpl1801] Discord notify failed:', err.message)
  );
});

/* DELETE /api/fpl1801/:id */
router.delete('/fpl1801/:id', writeOpsLimiter, auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const idx = store.state.fpl1801Plans.findIndex(fp => fp.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Flight plan not found' });
  const plan = store.state.fpl1801Plans[idx];
  const isOwner = plan.submittedBy && plan.submittedBy.sub === req.user.sub;
  if (!fpShared.fpIsAdminUser(req) && !fpShared.fpIsControllerUser(req) && !isOwner) {
    return res.status(403).json({ error: 'Access denied' });
  }
  store.state.fpl1801Plans.splice(idx, 1);
  store.saveJSON(store.FPL1801_FILE, store.state.fpl1801Plans);
  console.debug('[fpl1801] Plan ' + id + ' deleted by ' + (req.user.name || req.user.sub));
  res.json({ ok: true });
});

module.exports = router;
