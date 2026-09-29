'use strict';

// AtoDocument → what L14 needs to build mission lines (docs/adr/0063):
// one MissionLine per MSNACFT, a document-level AR join table, and packages.
//
// Output shape, per decision S-Q50: every line carries
//   fdrSeed  — ONLY keys FdrStore.createFdr(seed) reads today (fdr-store.js,
//              createFdr's flat seed). Nothing else: createFdr silently
//              ignores unknown keys, so a key here that it does not read would
//              be a promise nobody keeps.
//   military — the fdr.military fields the ATO owns (alertStatus, scl,
//              arInfo), shaped as fdr.military holds them. setMilitary() can
//              write alertStatus today; it refuses scl and arInfo by name.
//   extras   — { ato, identityAto } (S-R2-8): everything with no FDR home
//              yet — identityAto the IFF Mode 1/2/3 and datalink, ato the
//              mission type, departure/recovery, on-station time, control
//              detail, remarks… — verbatim, for L14's UI.
//   warnings — this line's warnings, including its mission's.
// plus the metadata keys lineId, sourceLines and provenance (S-R2-8).
//
// Times: every *Utc value is epoch ms resolved against the ATO's own TIMEFRAM
// (the ATO date). The raw DTG always rides beside it (vulRaw, departure.raw,
// onStationRaw, arctRaw…) because how the ATO date relates to the DCS mission
// date is not decided here (R2-9, pending the human): L14 applies that policy.
// ATO_FIELD_TARGETS below names, for every value, the FDR path it targets
// and whether a write path exists today, so L14 applies it without
// re-deriving anything.
//
// Deliberately NOT here: any Board wiring, any beacon-code allocation, any
// Mode 3 reconciliation (the ATO's Mode 3 is reported in extras.identityAto and never
// seeded as a beacon — guide §3.10.3 rule 3 makes ATO-vs-ATC Mode 3 a
// reconciliation L14 owns, ADR 0054), and anything that reads as a MARSA
// declaration (an ArLink is a join, not a separation regime — ADR 0051).
//
// Guide §6.4 M-numbers appear in comments only. They are NOT Block ids:
// block-map.js's MISSION_BLOCK_MAP (ADR 0026) numbers M1–M8 differently, and
// ADR 0052 settled that field names are the contract.
//
// Pure: requires nothing with load-time I/O.

// createFdr's flat seed keys this mapping fills (a subset of
// fdr-store.js createFdr's whole list; the test pins it).
const SEED_KEYS = Object.freeze(['callsign', 'flightSize', 'aircraftType', 'unit', 'homeStation',
  'missionNumber', 'packageId', 'controllingAgency', 'vulWindowStartUtc', 'vulWindowEndUtc']);

// WP7 bullet 1's acceptance fields (mission number, package, vul window,
// controlling agency, IFF codes). A line lists each one it lacks (decision H1)
// so L14 can fall back to callsign binding.
const ACCEPTANCE_FIELDS = Object.freeze(['packageId', 'vulWindowStartUtc', 'vulWindowEndUtc',
  'controllingAgency', 'modeOne', 'modeTwo', 'modeThree']);

// Every ATO value, where it lands on the MissionLine (`out`), the FDR path it
// targets, the guide §6.4 M-number (comment-level only), today's Block id,
// and whether anything can write it today.
//   writePathToday: 'createFdr' — rides in fdrSeed, createFdr writes it
//                   'setMilitary' — FdrStore.setMilitary() accepts it
//                   'none' — a named hand-off to L14 (or a supervisor ruling)
const ATO_FIELD_TARGETS = Object.freeze([
  { set: 'AMSNDAT', field: 'missionNumber', out: 'fdrSeed.missionNumber', fdrPath: 'mission.missionNumber', guideM: 'M1', blockId: 'M1', writePathToday: 'createFdr' },
  { set: 'AMSNDAT|PKGCMD|9PKGDAT', field: 'packageId', out: 'fdrSeed.packageId', fdrPath: 'mission.packageId', guideM: 'M2', blockId: 'M2', writePathToday: 'createFdr' },
  { set: 'AMSNDAT', field: 'missionType', out: 'extras.ato.missionType', fdrPath: null, guideM: 'M3', blockId: null, writePathToday: 'none' },
  { set: 'AMSNDAT', field: 'alertStatus', out: 'military.alertStatus', fdrPath: 'military.alertStatus', guideM: 'M16', blockId: null, writePathToday: 'setMilitary' },
  { set: 'AMSNDAT', field: 'DEPLOC/ARRLOC', out: 'extras.ato.departure', fdrPath: null, guideM: 'departure/recovery', blockId: null, writePathToday: 'none' },
  { set: 'AMSNDAT|PKGCMD|9PKGDAT', field: 'packageCommander', out: 'extras.ato.packageCommander', fdrPath: null, guideM: 'M2', blockId: null, writePathToday: 'none' },
  { set: 'MSNACFT', field: 'count', out: 'fdrSeed.flightSize', fdrPath: 'identity.flightSize', guideM: null, blockId: null, writePathToday: 'createFdr' },
  { set: 'MSNACFT', field: 'aircraftType', out: 'fdrSeed.aircraftType', fdrPath: 'identity.aircraftType', guideM: null, blockId: '3A', writePathToday: 'createFdr' },
  { set: 'MSNACFT', field: 'callsign', out: 'fdrSeed.callsign', fdrPath: 'identity.callsign', guideM: null, blockId: 'M3', writePathToday: 'createFdr' },
  { set: 'MSNACFT', field: 'iffModeOne', out: 'extras.identityAto.modeOne', fdrPath: 'identity.modeOne', guideM: 'M4', blockId: null, writePathToday: 'none' },
  { set: 'MSNACFT', field: 'iffModeTwo', out: 'extras.identityAto.modeTwo', fdrPath: 'identity.modeTwo', guideM: 'M4', blockId: null, writePathToday: 'none' },
  // NOT identity.beaconAssigned: the ATO side of §3.10.3 rule 3's reconciliation.
  { set: 'MSNACFT', field: 'iffModeThree', out: 'extras.identityAto.modeThree', fdrPath: null, guideM: '§9.8 bridge field', blockId: null, writePathToday: 'none' },
  { set: 'MSNACFT', field: 'datalink', out: 'extras.identityAto.datalink', fdrPath: null, guideM: 'M5', blockId: null, writePathToday: 'none' },
  { set: 'MSNACFT', field: 'config', out: 'military.scl', fdrPath: 'military.scl', guideM: 'M13', blockId: null, writePathToday: 'none' },
  { set: 'AMSNLOC|GTGTLOC|7CONTROL', field: 'vulStart', out: 'fdrSeed.vulWindowStartUtc', fdrPath: 'mission.vulWindowStartUtc', guideM: 'M6', blockId: 'M6', writePathToday: 'createFdr' },
  { set: 'AMSNLOC|GTGTLOC', field: 'vulEnd', out: 'fdrSeed.vulWindowEndUtc', fdrPath: 'mission.vulWindowEndUtc', guideM: 'M6', blockId: 'M7', writePathToday: 'createFdr' },
  { set: 'AMSNLOC', field: 'altitude', out: 'extras.ato.missionAltitudeFt', fdrPath: null, guideM: 'M6', blockId: null, writePathToday: 'none' },
  { set: '7CONTROL', field: 'TOSTA', out: 'extras.ato.onStationUtc', fdrPath: null, guideM: 'M6', blockId: null, writePathToday: 'none' },
  { set: 'CONTROLA|7CONTROL', field: 'reportInPoint', out: 'extras.ato.reportInPoint', fdrPath: null, guideM: 'M6', blockId: null, writePathToday: 'none' },
  { set: 'CONTROLA|7CONTROL', field: 'agencyCallsign', out: 'fdrSeed.controllingAgency', fdrPath: 'mission.controllingAgency', guideM: 'M7', blockId: 'M5', writePathToday: 'createFdr' },
  { set: 'CONTROLA', field: 'typeAndFrequencies', out: 'extras.ato.control', fdrPath: null, guideM: 'M7', blockId: null, writePathToday: 'none' },
  { set: 'ARINFO', field: 'receiverAr', out: 'military.arInfo.asReceiver', fdrPath: 'military.arInfo', guideM: 'M12', blockId: null, writePathToday: 'none' },
  { set: 'REFTSK|5REFUEL', field: 'tankerAr', out: 'military.arInfo.asTanker', fdrPath: 'military.arInfo', guideM: 'M12', blockId: null, writePathToday: 'none' },
  { set: 'TASKUNIT', field: 'unit', out: 'fdrSeed.unit', fdrPath: 'identity.unit', guideM: 'M20', blockId: '3D', writePathToday: 'createFdr' },
  { set: 'TASKUNIT', field: 'location', out: 'fdrSeed.homeStation', fdrPath: 'identity.homeStation', guideM: 'M20', blockId: '3E', writePathToday: 'createFdr' },
  // NOT filed.remarks: that is controller text (ADR 0040's erasure lesson).
  { set: 'AMPN|NARR|GENTEXT|RMKS', field: 'text', out: 'extras.ato.remarks', fdrPath: null, guideM: null, blockId: null, writePathToday: 'none' },
].map((r) => Object.freeze(r)));

function W(code, severity, line, set, message) {
  return { code, severity, line, set, field: null, message };
}
function warnKey(w) { return `${w.code}|${w.line}|${w.set}|${w.message}`; }
function strip(o) { const { warnings, ...rest } = o; return rest; }

function commanderFrom(m) {
  const a = m.aircraft[0];
  return {
    unit: m.taskUnit ? m.taskUnit.unit : null,
    missionNumber: m.missionNumber,
    callsign: a ? a.callsign : null,
    callsignRaw: a ? a.callsignRaw : null,
  };
}

function buildPackages(missions, byNumber, docWarnings) {
  const pk = new Map();
  const get = (id) => {
    if (!pk.has(id)) pk.set(id, { packageId: id, commander: null, memberMissionNumbers: [], cands: [] });
    return pk.get(id);
  };
  const member = (p, msn) => { if (msn && !p.memberMissionNumbers.includes(msn)) p.memberMissionNumbers.push(msn); };
  for (const m of missions) {
    const a = m.amsndat;
    if (a.packageId) {
      const p = get(a.packageId);
      member(p, m.missionNumber);
      if (a.isPackageCommander) p.cands.push({ from: 'AMSNDAT', line: m.line, ...commanderFrom(m) });
    }
    for (const r of m.packageRows) {
      if (!r.packageId) continue;
      const p = get(r.packageId);
      member(p, r.missionNumber);
      p.cands.push({ from: '9PKGDAT', line: r.line, ...commanderFrom(m) });
    }
    if (m.packageCommand && m.packageCommand.packageId) {
      const c = m.packageCommand;
      const p = get(c.packageId);
      member(p, m.missionNumber);
      const cm = c.missionNumber ? byNumber.get(c.missionNumber) : null;
      p.cands.push({
        from: 'PKGCMD', line: c.line,
        unit: c.unit ?? (cm && cm.taskUnit ? cm.taskUnit.unit : null),
        missionNumber: c.missionNumber,
        callsign: c.callsign, callsignRaw: c.callsignRaw,
      });
    }
  }
  const order = { AMSNDAT: 0, PKGCMD: 1, '9PKGDAT': 2 };
  for (const p of pk.values()) {
    const cands = [...p.cands].sort((x, y) => order[x.from] - order[y.from]);
    if (cands.length) {
      const best = cands[0];
      p.commander = { unit: best.unit, missionNumber: best.missionNumber, callsign: best.callsign, callsignRaw: best.callsignRaw, source: best.from };
      const others = new Set(cands.map((c) => c.missionNumber).filter(Boolean));
      if (others.size > 1) {
        docWarnings.push(W('PACKAGE_COMMANDER_CONFLICT', 'warning', best.line, best.from,
          `Package ${p.packageId} names more than one commander (${[...others].join(', ')}); ${best.missionNumber} (from ${best.from}) was used.`));
      }
      if (best.from === '9PKGDAT') {
        docWarnings.push(W('PACKAGE_COMMANDER_INFERRED', 'info', best.line, '9PKGDAT',
          `Package ${p.packageId} has no MC or PKGCMD; its commander was taken to be the mission carrying 9PKGDAT (${best.missionNumber}).`));
      }
    }
    delete p.cands;
  }
  return pk;
}

/**
 * @param {object} doc AtoDocument from ato-structure.parseStructure
 * @returns {object} AtoIngestResult
 */
function mapAtoDocument(doc) {
  const warnings = [...(doc.warnings || [])];
  const missions = doc.missions || [];
  const byNumber = new Map();
  const byCallsign = new Map();
  for (const m of missions) {
    if (!byNumber.has(m.missionNumber)) byNumber.set(m.missionNumber, m);
    for (const a of m.aircraft) if (a.callsign && !byCallsign.has(a.callsign)) byCallsign.set(a.callsign, m);
  }
  const resolveMission = (msn, cs) => (msn ? byNumber.get(msn) : null) || (cs ? byCallsign.get(cs) : null) || null;

  const packages = buildPackages(missions, byNumber, warnings);
  const packageOfRow = new Map(); // missionNumber → { packageId, line } from a 9PKGDAT row
  for (const m of missions) for (const r of m.packageRows) {
    if (r.missionNumber && r.packageId && !packageOfRow.has(r.missionNumber)) packageOfRow.set(r.missionNumber, { packageId: r.packageId, line: r.line });
  }

  // 7CONTROL rows, by controlled mission number (callsign as a fallback).
  const ctlByMission = new Map();
  for (const cm of missions) for (const row of cm.controlledRows) {
    const target = resolveMission(row.missionNumber, row.callsign);
    if (target && !ctlByMission.has(target)) ctlByMission.set(target, { row, controller: cm });
  }

  const missionLines = [];
  const linesByMission = new Map();
  for (const m of missions) {
    const lines = [];
    linesByMission.set(m, lines);
    if (m.aircraft.length === 0) { warnings.push(...m.warnings); continue; }
    const a0 = m.amsndat;
    const extraMission = [];

    // Package id: AMSNDAT, else PKGCMD, else a 9PKGDAT row naming this mission.
    let packageId = a0.packageId; let packageSrc = packageId ? { set: 'AMSNDAT', line: m.line } : null;
    const pc = m.packageCommand;
    if (pc && pc.packageId && packageId && pc.packageId !== packageId) {
      extraMission.push(W('PACKAGE_ID_CONFLICT', 'warning', pc.line, 'PKGCMD',
        `Mission ${m.missionKey}: AMSNDAT says package ${packageId}, PKGCMD says ${pc.packageId}; AMSNDAT was used.`));
    }
    if (!packageId && pc && pc.packageId) { packageId = pc.packageId; packageSrc = { set: 'PKGCMD', line: pc.line }; }
    if (!packageId && packageOfRow.has(m.missionNumber)) {
      const r = packageOfRow.get(m.missionNumber);
      packageId = r.packageId; packageSrc = { set: '9PKGDAT', line: r.line };
    }
    const pkg = packageId ? packages.get(packageId) : null;

    // Vul window (M6): AMSNLOC, else GTGTLOC NET/NLT, else 7CONTROL's time on station (start only).
    const ctl = ctlByMission.get(m) || null;
    let vul = { start: null, end: null, source: null, line: null, raw: { start: null, stop: null } };
    if (m.location && (m.location.start.utc != null || m.location.stop.utc != null)) {
      vul = { start: m.location.start.utc, end: m.location.stop.utc, source: 'AMSNLOC', line: m.location.line,
        raw: { start: m.location.start.raw, stop: m.location.stop.raw } };
    } else {
      const starts = m.targets.map((t) => t.net.utc ?? t.tot.utc).filter((v) => v != null);
      const ends = m.targets.map((t) => t.nlt.utc ?? t.tot.utc).filter((v) => v != null);
      if (starts.length || ends.length) {
        const t0 = m.targets[0];
        vul = { start: starts.length ? Math.min(...starts) : null, end: ends.length ? Math.max(...ends) : null,
          source: 'GTGTLOC', line: t0.line, raw: { start: (t0.net.raw ?? t0.tot.raw), stop: (t0.nlt.raw ?? t0.tot.raw) } };
        if (m.targets.length > 1) {
          extraMission.push(W('VUL_FROM_SEVERAL_TARGETS', 'info', t0.line, 'GTGTLOC',
            `Mission ${m.missionKey}: the vul window spans the earliest NET to the latest NLT of ${m.targets.length} targets.`));
        }
      } else if (ctl && ctl.row.onStationUtc != null) {
        vul = { start: ctl.row.onStationUtc, end: null, source: '7CONTROL', line: ctl.row.line, raw: { start: ctl.row.onStationRaw, stop: null } };
        extraMission.push(W('VUL_FROM_7CONTROL', 'info', ctl.row.line, '7CONTROL',
          `Mission ${m.missionKey}: no AMSNLOC or GTGTLOC; the vul start is the time on station from 7CONTROL, with no end.`));
      }
    }

    // Controlling agency (M7): CONTROLA, else the mission whose 7CONTROL names this one.
    let agency = null; let agencySrc = null;
    if (m.control) { agency = m.control.callsign; agencySrc = { set: 'CONTROLA', line: m.control.line }; }
    else if (ctl && ctl.controller.aircraft[0] && ctl.controller.aircraft[0].callsign) {
      agency = ctl.controller.aircraft[0].callsign;
      agencySrc = { set: '7CONTROL', line: ctl.row.line };
      extraMission.push(W('AGENCY_FROM_7CONTROL', 'info', ctl.row.line, '7CONTROL',
        `Mission ${m.missionKey} has no CONTROLA; its controlling agency is ${agency}, whose 7CONTROL lists it.`));
    }

    const asReceiver = m.arReceiving.map(strip);
    const rt = m.tanker.reftsk;
    const asTanker = (rt || m.tanker.receivers.length) ? {
      system: rt ? rt.system : (m.tanker.receivers[0] ? m.tanker.receivers[0].system : null),
      totalOffloadKlb: rt ? rt.totalOffloadKlb : null,
      alertOffloadKlb: rt ? rt.alertOffloadKlb : null,
      primary: rt ? rt.primary : null,
      secondary: rt ? rt.secondary : null,
      tacan: rt ? rt.tacan : null,
      receivers: m.tanker.receivers.map((r) => ({ ...r })),
    } : null;

    m.aircraft.forEach((a, idx) => {
      const lineId = `${m.missionKey}#${idx}`;
      const own = [];
      if (!a.callsignValid) {
        own.push(W('CALLSIGN_INVALID', 'warning', a.line, 'MSNACFT',
          `Callsign "${a.callsignRaw ?? ''}" becomes "${a.callsign ?? ''}", which is not 1–7 letters and digits; this flight needs a callsign typed before it can become a Strip.`));
      }
      if (m.aircraft.length > 1) {
        own.push(W('MULTIPLE_FLIGHTS_IN_MISSION', 'info', a.line, 'MSNACFT',
          `Mission ${m.missionKey} has ${m.aircraft.length} MSNACFT sets; each is its own line.`));
      }
      const fdrSeed = {
        callsign: a.callsignValid ? a.callsign : null,
        flightSize: a.count,
        aircraftType: a.aircraftType,
        unit: m.taskUnit ? m.taskUnit.unit : null,
        homeStation: m.taskUnit ? m.taskUnit.location : null,
        missionNumber: m.missionNumber,
        packageId: packageId || null,
        controllingAgency: agency,
        vulWindowStartUtc: vul.start,
        vulWindowEndUtc: vul.end,
      };
      const scl = (a.config.primary || a.config.secondary) ? { ...a.config } : null;
      const military = {
        alertStatus: a0.alertStatusRaw ? 'ALERT' : 'NONE', // [SOURCE-DEFINED] Q8: any value = ALERT; the ATO never yields SCRAMBLE
        scl,
        arInfo: (asReceiver.length || asTanker) ? { asReceiver: asReceiver.map((x) => ({ ...x })), asTanker } : null,
      };
      // extras = { ato, identityAto } (decision S-R2-8). identityAto holds the
      // identity values the ATO owns with no FDR write path (IFF, datalink);
      // ato holds the rest, plus this line's normalised callsign, whether it
      // can seed, and which acceptance fields it lacks (decision H1).
      const identityAto = {
        modeOne: a.iff.modeOne, modeTwo: a.iff.modeTwo, modeThree: a.iff.modeThree,
        datalink: { ...a.datalink },
      };
      const missing = [];
      for (const k of ACCEPTANCE_FIELDS) {
        const v = k.startsWith('mode') ? identityAto[k] : fdrSeed[k];
        if (v == null) missing.push(k);
      }
      if (!fdrSeed.callsign) missing.unshift('callsign');
      const ato = {
        missionNumber: m.missionNumber,
        missionKey: m.missionKey,
        callsign: a.callsign, // always the normalised callsign, even when it cannot seed (H1)
        callsignRaw: a.callsignRaw,
        seedable: !!fdrSeed.callsign,
        missingAcceptanceFields: missing,
        taskUnit: m.taskUnit ? { unit: m.taskUnit.unit, location: m.taskUnit.location, country: m.taskUnit.country, service: m.taskUnit.service } : null,
        missionType: { ...a0.missionType },
        amcMissionNumber: a0.amcMissionNumber,
        isPackageCommander: a0.isPackageCommander,
        packageCommander: pkg && pkg.commander ? { ...pkg.commander } : null,
        departure: { ...a0.departure },
        recovery: { ...a0.recovery },
        missionLocation: m.location ? m.location.locationName : null,
        missionAltitudeFt: m.location ? m.location.altitudeFt : null,
        priority: m.location ? m.location.priority : null,
        vulSource: vul.source,
        vulRaw: vul.raw,
        targets: m.targets.map((t) => ({ name: t.name, targetId: t.targetId, totUtc: t.tot.utc, netUtc: t.net.utc, nltUtc: t.nlt.utc, raw: { tot: t.tot.raw, net: t.net.raw, nlt: t.nlt.raw } })),
        onStationUtc: ctl ? ctl.row.onStationUtc : null,
        onStationRaw: ctl ? ctl.row.onStationRaw : null,
        reportInPoint: (m.control && m.control.reportInPoint) || (ctl ? ctl.row.reportInPoint : null),
        control: m.control ? {
          type: m.control.type, typeRaw: m.control.typeRaw, callsign: m.control.callsign, callsignRaw: m.control.callsignRaw,
          primary: m.control.primary, secondary: m.control.secondary, reportInPoint: m.control.reportInPoint, comments: m.control.comments,
        } : null,
        alertStatusRaw: a0.alertStatusRaw,
        remarks: m.remarks.map((r) => r.text),
      };
      const P = (set, line) => ({ source: 'ATO', set, line });
      const provenance = {};
      provenance['mission.missionNumber'] = P('AMSNDAT', m.line);
      if (fdrSeed.callsign) provenance['identity.callsign'] = P('MSNACFT', a.line);
      provenance['identity.flightSize'] = P('MSNACFT', a.line);
      if (fdrSeed.aircraftType) provenance['identity.aircraftType'] = P('MSNACFT', a.line);
      if (fdrSeed.unit) provenance['identity.unit'] = P('TASKUNIT', m.taskUnit.line);
      if (fdrSeed.homeStation) provenance['identity.homeStation'] = P('TASKUNIT', m.taskUnit.line);
      if (packageSrc) provenance['mission.packageId'] = P(packageSrc.set, packageSrc.line);
      if (agencySrc) provenance['mission.controllingAgency'] = P(agencySrc.set, agencySrc.line);
      if (vul.start != null) provenance['mission.vulWindowStartUtc'] = P(vul.source, vul.line);
      if (vul.end != null) provenance['mission.vulWindowEndUtc'] = P(vul.source, vul.line);
      provenance['military.alertStatus'] = P('AMSNDAT', m.line);

      const lw = [...m.warnings, ...extraMission, ...a.warnings, ...own].sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
      const line = {
        // metadata (S-R2-8)
        lineId,
        sourceLines: { ...m.lines, MSNACFT: a.line },
        provenance,
        // S-Q50's four keys
        fdrSeed,
        military,
        extras: { ato, identityAto },
        warnings: lw,
      };
      lines.push(line);
      missionLines.push(line);
    });
  }

  // ── AR join table ───────────────────────────────────────────────────────
  const lineIdFor = (mission, cs) => {
    const ls = mission ? linesByMission.get(mission) : null;
    if (!ls || !ls.length) return null;
    const hit = cs ? ls.find((l) => l.extras.ato.callsign === cs) : null;
    return (hit || ls[0]).lineId;
  };
  const warnOn = (mission, w) => {
    const ls = mission ? linesByMission.get(mission) : null;
    if (ls && ls.length) ls.forEach((l) => l.warnings.push(w)); else warnings.push(w);
  };
  const links = new Map();
  const idOf = (mission, msn, cs) => (mission ? `M:${mission.missionKey}` : (msn ? `N:${msn}` : `C:${cs}`));

  for (const R of missions) for (const ar of R.arReceiving) {
    const T = resolveMission(ar.tankerMissionNumber, ar.tankerCallsign);
    const rcs = R.aircraft[0] ? R.aircraft[0].callsign : null;
    const key = `${idOf(T, ar.tankerMissionNumber, ar.tankerCallsign)}|${idOf(R, R.missionNumber, rcs)}`;
    if (!T && ar.tankerMissionNumber) {
      warnOn(R, W('AR_TANKER_NOT_IN_ATO', 'info', ar.line, 'ARINFO',
        `Tanker ${ar.tankerCallsignRaw ?? ''} (${ar.tankerMissionNumber}) is not a mission in this ATO.`));
    }
    if (T && ar.tankerModeThree) {
      const tl = (linesByMission.get(T) || []).find((l) => l.extras.ato.callsign === ar.tankerCallsign) || (linesByMission.get(T) || [])[0];
      if (tl && tl.extras.identityAto.modeThree && tl.extras.identityAto.modeThree !== ar.tankerModeThree) {
        warnOn(R, W('AR_TANKER_IFF_MISMATCH', 'warning', ar.line, 'ARINFO',
          `ARINFO gives tanker ${ar.tankerCallsign} Mode 3 ${ar.tankerModeThree}; its own MSNACFT says ${tl.extras.identityAto.modeThree}.`));
      }
    }
    if (links.has(key)) continue; // a second ARINFO for the same pair adds nothing new
    links.set(key, {
      tankerMissionNumber: ar.tankerMissionNumber || (T ? T.missionNumber : null),
      tankerCallsign: ar.tankerCallsign || (T && T.aircraft[0] ? T.aircraft[0].callsign : null),
      receiverMissionNumber: R.missionNumber,
      receiverCallsign: rcs,
      arctUtc: ar.arctUtc, offloadKlb: ar.offloadKlb, arcp: ar.arcp,
      sources: ['ARINFO'],
      tankerLineId: lineIdFor(T, ar.tankerCallsign),
      receiverLineId: lineIdFor(R, rcs),
      _T: T, _R: R,
    });
  }
  for (const T of missions) for (const row of T.tanker.receivers) {
    const R = resolveMission(row.receiverMissionNumber, row.receiverCallsign);
    const tcs = T.aircraft[0] ? T.aircraft[0].callsign : null;
    const key = `${idOf(T, T.missionNumber, tcs)}|${idOf(R, row.receiverMissionNumber, row.receiverCallsign)}`;
    const existing = links.get(key);
    if (existing) {
      if (!existing.sources.includes('5REFUEL')) existing.sources.push('5REFUEL');
      const diffs = [];
      if (row.arctUtc != null && existing.arctUtc != null && row.arctUtc !== existing.arctUtc) diffs.push('ARCT');
      if (row.offloadKlb != null && existing.offloadKlb != null && row.offloadKlb !== existing.offloadKlb) diffs.push('offload');
      if (diffs.length) {
        warnOn(R, W('AR_LINK_CONFLICT', 'warning', row.line, '5REFUEL',
          `The tanker's 5REFUEL and the receiver's ARINFO disagree on ${diffs.join(' and ')} for ${existing.receiverCallsign ?? existing.receiverMissionNumber}; the receiver's ARINFO was used.`));
      }
      if (existing.arctUtc == null) existing.arctUtc = row.arctUtc;
      if (existing.offloadKlb == null) existing.offloadKlb = row.offloadKlb;
      continue;
    }
    if (!R) {
      warnOn(T, W('AR_RECEIVER_NOT_IN_ATO', 'info', row.line, '5REFUEL',
        `Receiver ${row.receiverCallsignRaw ?? ''} (${row.receiverMissionNumber ?? 'no mission number'}) is not a mission in this ATO.`));
    }
    links.set(key, {
      tankerMissionNumber: T.missionNumber,
      tankerCallsign: tcs,
      receiverMissionNumber: row.receiverMissionNumber || (R ? R.missionNumber : null),
      receiverCallsign: row.receiverCallsign,
      arctUtc: row.arctUtc, offloadKlb: row.offloadKlb, arcp: null,
      sources: ['5REFUEL'],
      tankerLineId: lineIdFor(T, tcs),
      receiverLineId: lineIdFor(R, row.receiverCallsign),
      _T: T, _R: R,
    });
  }
  const arLinks = [...links.values()].map((l) => {
    const { _T, _R, ...rest } = l;
    let resolved;
    if (_T && _R) resolved = 'BOTH';
    else if (_T) resolved = 'TANKER_ONLY';
    else if (rest.tankerMissionNumber) resolved = 'RECEIVER_ONLY';
    else resolved = 'TANKER_NOT_A_MISSION';
    return { ...rest, resolved };
  });

  for (const l of missionLines) l.warnings.sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
  if (!doc.fatal && missions.length === 0) {
    warnings.push(W('NO_MISSIONS', 'error', null, null, 'No mission (AMSNDAT with a mission number) was found in this ATO.'));
  }
  warnings.sort((x, y) => (x.line ?? 0) - (y.line ?? 0));

  return {
    ok: !doc.fatal && missionLines.length > 0,
    source: doc.source || 'USMTF',
    header: doc.header ? { ...doc.header } : null,
    packages: [...packages.values()],
    missionLines,
    arLinks,
    unmappedSets: doc.unmappedSets || [],
    warnings,
    heuristics: doc.heuristics || [],
  };
}

/** Every warning in a result — document-level and per line — once each, in line order. */
function collectWarnings(result) {
  const seen = new Set();
  const out = [];
  for (const w of [...(result.warnings || []), ...(result.missionLines || []).flatMap((l) => l.warnings)]) {
    const k = warnKey(w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out.sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
}

module.exports = { mapAtoDocument, collectWarnings, ATO_FIELD_TARGETS, SEED_KEYS, ACCEPTANCE_FIELDS };
