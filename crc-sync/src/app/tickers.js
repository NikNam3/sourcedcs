'use strict';

// Every timer the service runs, by name. start() (app.js) installs them, stop() clears them; the soak drives them by name
// instead of by clock.

const { CORRELATION_TICK_MS } = require('../efsp/correlation-reconciler');
const log = require('../log').logger('app');

// One sweep for the whole server, over only the radars somebody is actually looking through — an unattended airfield's radar
// costs nothing. Illumination instants are computed rather than sampled (docs/adr/0043), so this interval is a delivery
// choice: it bounds how late a contact can appear, not whether it appears at all. 250ms against real scan periods of 2-3s is
// well inside the noise.
const COVERAGE_TICK_MS = 250;

/**
 * @param {object} d everything a tick reads or drives: wsHub, efsp, trackStore, collabStore, atisStore, surveillance, theaterContext,
 *   missionClock, picture (`{sensorSpecs, coverageEngine, positionCoverage, currentRadars, datalink}`), monitors (monitors.js),
 *   airportWeather, airspaceCalendar, archive (archive.js), `missionState` (`{ lastMissionData }`, kept by the gRPC handlers)
 * @returns {{name: string, periodMs: number, tick: Function}[]}
 */
function buildTickers({ wsHub, efsp, trackStore, collabStore, atisStore, surveillance, theaterContext, missionClock, picture, monitors, airportWeather, airspaceCalendar, archive, missionState }) {
  const { obligationMonitor, correlationReconciler, efspInstrumentation, conformanceMonitor, surveillanceHints, conflictAlertMonitor, airspaceEntryAlertMonitor, tofiRegimeMonitor, carrierTick, parMonitor, broadcastEfspAlerts } = monitors;
  const { sensorSpecs, coverageEngine, positionCoverage, currentRadars, datalink } = picture;

  // The radar list itself changes under everyone — an AWACS takes off or lands, a ship spawns — and until this existed nothing
  // told a client about it. A GCI controller whose AWACS had just got airborne started receiving contacts through it while their
  // coverage panel still listed nothing and the "NO RADAR COVERAGE" banner stayed up, because coverage was only re-sent on
  // efsp-set-positions and on mission load. Compared by id set so the refresh fires once per takeoff, not once per tick.
  let lastRadarIds = '';
  let lastClockSource = missionClock.source;
  return [
    { name: 'signon-grace', periodMs: 1000, tick: () => wsHub.sweepPendingSignOffs() },
    { name: 'datalink-locks', periodMs: sensorSpecs.datalink.lockPollMs, tick: () => datalink.pollLocks() },
    { name: 'coverage', periodMs: COVERAGE_TICK_MS, tick: () => {
      const radars = currentRadars();
      const ids = radars.map(r => r.id).sort().join(',');
      if (ids !== lastRadarIds) {
        lastRadarIds = ids;
        wsHub.refreshAllCoverage();
      }
      coverageEngine.tick(positionCoverage.activeRadars(), trackStore.getAll(), wsHub.getMissionData());
    } },
    // With DCS gone there are no samples to broadcast on, and the clock has fallen
    // back to the wall clock — clients still need to hear that, and when.
    { name: 'clock-source', periodMs: 5000, tick: () => {
      const source = missionClock.source;
      if (source === 'WALL' || source !== lastClockSource) wsHub.broadcastGameTime();
      if (theaterContext.noteClock()) wsHub.broadcastTheater();
      lastClockSource = source;
    } },
    { name: 'airport-weather', periodMs: 60000, tick: () => airportWeather.refresh(missionState.lastMissionData) },
    { name: 'airspace-calendar', periodMs: 60000, tick: () => airspaceCalendar.refresh() },
    { name: 'efsp-metrics', periodMs: 60000, tick: () => efspInstrumentation.tick() },
    { name: 'efsp-archiver', periodMs: 60 * 1000, tick: () => archive(efsp.archiver.sweep()) },
    // ── Stale reaper — mirrors crc-desktop's original 12s track eviction, now
    // also evicts orphaned CollaborativeStore entries in the same tick. Also
    // re-broadcasts AtisStore's active list so a client that crashed without
    // ever POSTing {stop:true} still clears from everyone else's "in use"
    // display once its presence entry lapses (see AtisStore.getActive()). ─────
    { name: 'stale-reaper', periodMs: 5000, tick: () => {
      const n = trackStore.expireStale();
      const activeIds = new Set(trackStore.getAll().map(t => String(t.id)));
      const evicted = collabStore.evictStale(activeIds);
      surveillance.forget(activeIds);
      if (n > 0 || evicted > 0) log.info('expired stale tracks and evicted overlay entries', { tracks: n, overlayEntries: evicted });
      wsHub.setAtisActive(atisStore.getActive());
    } },
    { name: 'obligations-nla', periodMs: 15000, tick: () => {
      if (obligationMonitor.tick()) broadcastEfspAlerts();
      efsp.nlaStatusMonitor.tick();
    } },
    { name: 'correlation', periodMs: CORRELATION_TICK_MS, tick: () => correlationReconciler.tick() },
    // docs/adr/0122 (H142): a not-released handoff the receiver has checked in moves control once the aircraft is inside the
    // receiver's airspace. Its board-deltas go through the one delivery path, whose post-change hook re-runs the obligations.
    { name: 'handoff-control', periodMs: 1000, tick: () => {
      const { messages } = efsp.settleHandoffControl();
      if (messages.length) wsHub.deliverEfsp(messages);
    } },
    // docs/adr/0128: a transit ends when its flight's last live Strip goes (a decline stays until acknowledged, ADR 0136).
    { name: 'airspace-transits', periodMs: 5000, tick: () => {
      const { messages } = efsp.sweepTransits();
      if (messages.length) wsHub.deliverEfsp(messages);
    } },
    { name: 'carrier', periodMs: 1000, tick: () => carrierTick.tick() },
    // docs/adr/0112: the PAR sample, to the Position working each final only (config/par.json sampleMs, under 1 s, H115),
    // with the approach each final's next aircraft flies, so its values can be set on an empty final (H161 V2-Q1 a).
    { name: 'par', periodMs: parMonitor.sampleMs, tick: () => wsHub.sendParSamples(parMonitor.tick(), parMonitor.finalApproaches()) },
    // Conformance and the hints stamp mission time (the `since` they report is shown to
    // controllers); their pure durations (the heading grace, the airborne hold, staleness)
    // run on the injected wall clock (docs/adr/0096). CA stays on the wall clock: it only
    // compares track ages, which tracks.js stamps in wall time, and shows no time
    // of day at all.
    // docs/adr/0102: a pending regime becomes effective on the 2nd consecutive inside tick; the outside grace is wall time.
    { name: 'tofi-regime', periodMs: 1000, tick: () => { if (tofiRegimeMonitor.tick()) broadcastEfspAlerts(); } },
    { name: 'conformance-conflict-alert', periodMs: 1000, tick: () => {
      const conformanceChanged = conformanceMonitor.tick();
      const hintsChanged = surveillanceHints ? surveillanceHints.tick() : false;
      const conflictAlertChanged = conflictAlertMonitor.tick(Date.now());
      // docs/adr/0119: after CA, whose formation members it reads.
      const airspaceEntryChanged = airspaceEntryAlertMonitor.tick();
      if (conformanceChanged || conflictAlertChanged || hintsChanged || airspaceEntryChanged) {
        broadcastEfspAlerts();
      }
    } },
  ];
}

module.exports = { buildTickers, COVERAGE_TICK_MS };
