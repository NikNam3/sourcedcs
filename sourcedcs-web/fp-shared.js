'use strict';

/* Shared between routes/flight-plans.js and routes/fpl1801.js — the FPL1801
   section of the original server.js explicitly reused these from the DD 175
   (flight-plans) section rather than duplicating them. */

const store = require('./store');
const discordClient = require('./discord-client');

/* Returns unique squadron names from the discord-roles config */
function fpAvailableSquadrons() {
  const seen = new Set();
  for (const v of Object.values(store.state.discordRoles)) {
    if (v.squadron) seen.add(v.squadron);
  }
  return [...seen].sort();
}

/* Best-effort: match a JWT user to their squadron via the members store */
function fpUserSquadron(userName) {
  if (!userName) return null;
  const lower = String(userName).toLowerCase().trim();
  const member = Object.values(store.state.members).find(m =>
    m.active !== false &&
    ((m.callsign || '').toLowerCase() === lower || (m.username || '').toLowerCase() === lower)
  );
  return member ? (discordClient.resolvedSquadron(member) || null) : null;
}

function fpIsControllerUser(req) {
  const cs = store.state.fpConfig.controllerSquadron;
  if (!cs) return false;
  return fpUserSquadron(req.user.name || '') === cs;
}

function fpIsAdminUser(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  return roles.some(r => (typeof r === 'string' ? r : (r?.name || '')) === 'admin');
}

module.exports = { fpAvailableSquadrons, fpUserSquadron, fpIsControllerUser, fpIsAdminUser };
