'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const fpShared = require('../fp-shared');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

const FP_MAX_LEGS = 20;
const FP_MAX_CREW = 50;

/* GET /api/flight-plans/config — public, returns config + isController for authed users */
router.get('/flight-plans/config', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = token ? auth.decodeJWT(token) : null;
  const isCtrl = payload ? fpShared.fpIsControllerUser({ user: payload }) : false;
  const isAdm = payload ? fpShared.fpIsAdminUser({ user: payload }) : false;
  const out = {
    controllerSquadron: store.state.fpConfig.controllerSquadron || '',
    availableSquadrons: fpShared.fpAvailableSquadrons(),
    isController: isCtrl,
  };
  if (isAdm) out.notifyChannelId = store.state.fpConfig.notifyChannelId || '';
  res.json(out);
});

/* PUT /api/flight-plans/config — admin only */
router.put('/flight-plans/config', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  const sq = store.sanitizeStr(b.controllerSquadron, 64);
  const ch = store.sanitizeStr(b.notifyChannelId, 32).replace(/\D/g, ''); /* digits only */
  store.state.fpConfig.controllerSquadron = sq;
  store.state.fpConfig.notifyChannelId = ch;
  store.saveJSON(store.FLIGHT_PLANS_CFG_FILE, store.state.fpConfig);
  console.debug('[flight-plans] Controller squadron set to:', sq || '(none)');
  console.debug('[flight-plans] Notify channel set to:', ch || '(none)');
  res.json({ controllerSquadron: store.state.fpConfig.controllerSquadron, notifyChannelId: store.state.fpConfig.notifyChannelId });
});

/* Send a submitted flight plan as a Discord embed to the configured notify channel */
async function sendFlightPlanToDiscord(plan) {
  if (!discordClient.DISCORD_BOT_TOKEN) {
    console.warn('[flight-plans] DISCORD_BOT_TOKEN not set — skipping Discord notify');
    return;
  }
  const chId = store.state.fpConfig.notifyChannelId;
  if (!chId) return;

  const legsText = (plan.legs || []).map((leg, i) =>
    'Leg ' + (i + 1) + ': ' + (leg.departure || '?') + ' → ' + (leg.destination || '?') +
    ' | ' + (leg.flightRules || '—') +
    ' | TAS ' + (leg.trueAirspeed || '—') +
    ' | ' + (leg.departureTime || '—') + 'Z' +
    ' | Alt ' + (leg.altitude || '—') +
    ' | ETE ' + (leg.ete || '—') +
    (leg.route ? '\n  ' + leg.route : '')
  ).join('\n');

  const crewText = (plan.crew || []).filter(c => c.nameInitials).map(c =>
    (c.rank ? c.rank + ' ' : '') + c.nameInitials +
    ' — ' + (c.dutyPosition || '—') +
    (c.orgStation ? ' / ' + c.orgStation : '') +
    (c.memberId ? ' (' + c.memberId + ')' : '')
  ).join('\n');

  const fields = [
    { name: '1. Date', value: plan.date || '—', inline: true },
    { name: '2. Call Sign', value: plan.callSign || '—', inline: true },
    { name: '3. Aircraft', value: plan.aircraftDesig || '—', inline: true },
    { name: '13. Rank/Honor Code', value: plan.rankHonorCode || '—', inline: true },
    { name: '14. Fuel on Board', value: plan.fuelOnBoard || '—', inline: true },
    { name: '15. Alt Airfield', value: plan.alternateAirfield || '—', inline: true },
    { name: '16. ETE to Altn', value: plan.eteToAlternate || '—', inline: true },
    { name: '17. NOTAMs', value: plan.notamsChecked ? '✅ Reviewed' : '—', inline: true },
    { name: '18. Weather', value: plan.weatherBrief || '—', inline: true },
    { name: '19. Wt & Balance', value: plan.weightBalance || '—', inline: true },
    { name: '20. A/C Serial / Unit / Station', value: plan.aircraftSerial || '—', inline: false },
  ];
  if (plan.remarks) fields.push({ name: '12. Remarks', value: plan.remarks.slice(0, 1024), inline: false });
  if (legsText) fields.push({ name: '9. Route of Flight', value: legsText.slice(0, 1024), inline: false });
  if (crewText) fields.push({ name: 'Crew / Passengers', value: crewText.slice(0, 1024), inline: false });

  const embed = {
    title: '✈️ Flight Plan FP-' + plan.id + ' — ' + (plan.callSign || ''),
    color: 0x2b6cb0,
    fields,
    timestamp: plan.submittedAt,
    footer: { text: 'Submitted by ' + (plan.submittedBy && plan.submittedBy.name ? plan.submittedBy.name : 'Unknown') + ' · ' + (plan.authority || '10 USC 8012 AND EO 9397') },
  };

  await discordClient.discordPost('/channels/' + chId + '/messages', { embeds: [embed] });
  console.debug('[flight-plans] FP-' + plan.id + ' posted to Discord channel ' + chId);
}

/* GET /api/flight-plans — returns all plans for admin/controller, own plans otherwise */
router.get('/flight-plans', auth.requireAuth, (req, res) => {
  if (fpShared.fpIsAdminUser(req) || fpShared.fpIsControllerUser(req)) {
    return res.json(store.state.flightPlans);
  }
  const sub = req.user.sub;
  res.json(store.state.flightPlans.filter(fp => fp.submittedBy && fp.submittedBy.sub === sub));
});

router.post('/flight-plans', writeOpsLimiter, auth.requireAuth, (req, res) => {
  const b = req.body;
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Invalid request body' });

  const date = store.sanitizeStr(b.date, 12);
  const callSign = store.sanitizeStr(b.callSign, 16);
  const aircraftDesig = store.sanitizeStr(b.aircraftDesig, 32);
  const authority = store.sanitizeStr(b.authority, 64);

  if (!date || !callSign || !aircraftDesig) {
    return res.status(400).json({ error: 'date, callSign, and aircraftDesig are required' });
  }

  if (!Array.isArray(b.legs) || !b.legs.length) {
    return res.status(400).json({ error: 'At least one route leg is required' });
  }
  if (b.legs.length > FP_MAX_LEGS) {
    return res.status(400).json({ error: 'Too many legs (max ' + FP_MAX_LEGS + ')' });
  }

  const legs = b.legs.map(leg => ({
    flightRules: store.sanitizeStr(leg.flightRules, 1),
    trueAirspeed: store.sanitizeStr(leg.trueAirspeed, 6),
    departure: store.sanitizeStr(leg.departure, 4),
    departureTime: store.sanitizeStr(leg.departureTime, 4),
    altitude: store.sanitizeStr(leg.altitude, 6),
    route: store.sanitizeStr(leg.route, 500),
    destination: store.sanitizeStr(leg.destination, 4),
    ete: store.sanitizeStr(leg.ete, 5),
  }));

  const crew = Array.isArray(b.crew) ? b.crew.slice(0, FP_MAX_CREW).map(c => ({
    dutyPosition: store.sanitizeStr(c.dutyPosition, 32),
    nameInitials: store.sanitizeStr(c.nameInitials, 32),
    rank: store.sanitizeStr(c.rank, 8),
    memberId: store.sanitizeStr(c.memberId, 32),
    orgStation: store.sanitizeStr(c.orgStation, 64),
  })) : [];

  const plan = {
    id: store.state.nextFlightPlanId++,
    submittedAt: new Date().toISOString(),
    submittedBy: { sub: req.user.sub, name: req.user.name || req.user.sub },
    date,
    callSign,
    aircraftDesig,
    authority,
    legs,
    remarks: store.sanitizeStr(b.remarks, 1000),
    rankHonorCode: store.sanitizeStr(b.rankHonorCode, 32),
    fuelOnBoard: store.sanitizeStr(b.fuelOnBoard, 5),
    alternateAirfield: store.sanitizeStr(b.alternateAirfield, 4),
    eteToAlternate: store.sanitizeStr(b.eteToAlternate, 5),
    notamsChecked: Boolean(b.notamsChecked),
    weatherBrief: store.sanitizeStr(b.weatherBrief, 64),
    weightBalance: store.sanitizeStr(b.weightBalance, 64),
    aircraftSerial: store.sanitizeStr(b.aircraftSerial, 128),
    crew,
    baseOps: {
      approvalSignature: '',
      actualDepartureTime: '',
      crewListAttached: false,
      approvedAt: null,
    },
    status: 'submitted',
  };

  store.state.flightPlans.push(plan);
  store.saveJSON(store.FLIGHT_PLANS_FILE, store.state.flightPlans);
  console.debug('[flight-plans] Plan ' + plan.id + ' submitted by ' + plan.submittedBy.name);
  res.status(201).json(plan);

  sendFlightPlanToDiscord(plan).catch(err =>
    console.error('[flight-plans] Discord notify failed:', err.message)
  );
});

router.patch('/flight-plans/:id/baseops', writeOpsLimiter, auth.requireAuth, (req, res) => {
  if (!fpShared.fpIsAdminUser(req) && !fpShared.fpIsControllerUser(req)) {
    return res.status(403).json({ error: 'Controller squadron or admin access required' });
  }
  const id = Number(req.params.id);
  const flightPlans = store.state.flightPlans;
  const idx = flightPlans.findIndex(fp => fp.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Flight plan not found' });

  const b = req.body || {};
  flightPlans[idx].baseOps = {
    approvalSignature: store.sanitizeStr(b.approvalSignature, 64),
    actualDepartureTime: store.sanitizeStr(b.actualDepartureTime, 4),
    crewListAttached: Boolean(b.crewListAttached),
    approvedAt: new Date().toISOString(),
  };
  if (b.approvalSignature) flightPlans[idx].status = 'approved';
  store.saveJSON(store.FLIGHT_PLANS_FILE, flightPlans);
  res.json(flightPlans[idx]);
});

router.delete('/flight-plans/:id', writeOpsLimiter, auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const flightPlans = store.state.flightPlans;
  const idx = flightPlans.findIndex(fp => fp.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Flight plan not found' });
  const isOwner = flightPlans[idx].submittedBy && flightPlans[idx].submittedBy.sub === req.user.sub;
  if (!fpShared.fpIsAdminUser(req) && !fpShared.fpIsControllerUser(req) && !isOwner) {
    return res.status(403).json({ error: 'You can only delete your own flight plans' });
  }
  flightPlans.splice(idx, 1);
  store.saveJSON(store.FLIGHT_PLANS_FILE, flightPlans);
  console.debug('[flight-plans] Plan ' + id + ' deleted by ' + (req.user.name || req.user.sub));
  res.json({ ok: true });
});

module.exports = router;
