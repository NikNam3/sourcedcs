// The Strip's face: Layout C (docs/adr/0056).
//
//   ┌──────────── tab ────────────┬──────────── main ─────────────┬ tools ┐
//   │ DEP · HANDED OFF            │ CALLSIGN  TYPE  SQUAWK  …      │  ⋯     │
//   │ ── one row per exchange ──  │ [TRK] [MARSA] [TOFI] …         │  ▼     │
//   │ HANDOFF ← APP  [Rej][Acc]   │ ▲ reason, a full line          │  ✕     │
//   │ ── next step ──  [ NLA ]    │ (expanded view)                │        │
//   └─────────────────────────────┴───────────────────────────────┴────────┘
//
// Where a control goes is a rule, so the next feature lands without the layout
// changing:
//   tab row     an exchange in progress, with its own answer buttons
//   tab bottom  the one next step (the NLA)
//   ⋯ menu      everything the controller starts
//   indicators  standing state, always drawn, lit or dim, never clickable
//   tools       ⋯ ▼ ✕
//
// Loaded after bay-view.js and called from its _buildStripEl. Everything here
// is a function declaration in the shared script scope, so it reads bay-view.js's
// gates (_canProposeTofiEntry and friends) and state at call time, and those
// gates stay where efsp-coordination-client.test.js's drift checks find them.

const ROLE_ABBR = { DEPARTURE: 'DEP', ARRIVAL: 'ARR', OVERFLIGHT: 'OVF', MISSION: 'MSN', MARSHAL: 'MAR', FINAL: 'FNL', PATTERN: 'PAT' };

function _stripEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) _addClass(node, className);
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Adds classes through `className` AND `classList`. In a browser the second is
 * a no-op; the node tests' DOM stub keeps the two apart, and its assertions
 * read both (descendants by className, a node's own classList.contains).
 */
function _addClass(node, classes) {
  for (const c of String(classes).split(/\s+/).filter(Boolean)) {
    if (!(' ' + (node.className || '') + ' ').includes(' ' + c + ' ')) {
      node.className = node.className ? `${node.className} ${c}` : c;
    }
    if (node.classList) node.classList.add(c);
  }
}

/** One Strip button, in the single button style. `legacy` keeps the class tests and older CSS select on. */
function _stripButton(label, legacy, { go = false, disabled = false, title = '', action = '', onClick = null } = {}) {
  const btn = _stripEl('button', `efsp-sbtn${go ? ' efsp-sbtn-go' : ''}${legacy ? ' ' + legacy : ''}`, label);
  if (title) btn.title = title;
  if (action) btn.dataset.stripAction = action;
  if (disabled) btn.disabled = true;
  else if (onClick) {
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e, btn); });
  }
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  return btn;
}

function _waitingText(since) {
  if (!since) return '';
  // `since` is crc-sync's mission clock (docs/adr/0079), so the elapsed time
  // is measured against the same clock — topbar.js's missionNow().
  const now = typeof missionNow === 'function' ? missionNow() : Date.now();
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * An exchange's state line: the state word, then " · 0:42" for how long it has
 * waited when the record says when it started. The clock is its own span so
 * the ticker below can rewrite it without rebuilding the Strip.
 */
function _stateMeta(word, since) {
  const meta = _stripEl('div', 'efsp-x-meta', word);
  if (since) {
    const clock = _stripEl('span', 'efsp-x-waiting', ` · ${_waitingText(since)}`);
    clock.dataset.waitingSince = String(since);
    meta.appendChild(clock);
    _startWaitingTicker();
  }
  return meta;
}

// One interval for the whole panel, rewriting only the elapsed text. Never part
// of the render signature, so a ticking clock never rebuilds a Strip.
let _waitingTicker = null;
function _startWaitingTicker() {
  if (_waitingTicker || typeof setInterval !== 'function' || typeof document === 'undefined'
    || typeof document.querySelectorAll !== 'function') return;
  _waitingTicker = setInterval(() => {
    const nodes = document.querySelectorAll('[data-waiting-since]');
    if (nodes.length === 0) { clearInterval(_waitingTicker); _waitingTicker = null; return; }
    for (const n of nodes) n.textContent = ` · ${_waitingText(Number(n.dataset.waitingSince))}`;
  }, 1000);
}

// ── The tab ────────────────────────────────────────────────────────────────

function _exchangeRow({ incoming = false, kind, title = '' }) {
  const row = _stripEl('div', `efsp-x efsp-x-${kind}${incoming ? ' efsp-x-in' : ''}`);
  if (title) row.title = title;
  return row;
}

function _exchangeButtons(buttons) {
  const wrap = _stripEl('div', 'efsp-x-buttons');
  for (const b of buttons) wrap.appendChild(b);
  return wrap;
}

/** The five coordination primitives — both sides, every state. F-302's badge, as a row. */
function _coordinationExchange(strip) {
  const co = strip.coordination;
  if (!co) return null;
  const isReplica = _coordinationIsReplica(strip);
  const pendingIn = _isPendingCoordinationReplica(strip);
  const proposer = _coordinationProposerOf(strip, co);
  const primitiveLabel = (COORDINATION_PRIMITIVE_LABELS[co.primitive] || co.primitive).toUpperCase();

  const row = _exchangeRow({ incoming: pendingIn, kind: 'coordination' });
  const what = _stripEl('div', 'efsp-x-what efsp-coordination-state-badge'
    + (co.state === 'REJECTED' ? ' efsp-coordination-state-rejected' : ''),
  `${primitiveLabel} ${isReplica ? '←' : '→'} ${co.peerPositionId}`);
  what.title = `${proposer} proposed this ${primitiveLabel.toLowerCase()}`;
  row.appendChild(what);

  let meta;
  if (co.state === 'PROPOSED') {
    meta = _stateMeta(_coordinationStateWord(co), co.initiatedAt);
    // The requester's own Strip: a still-open request that was answered
    // "stand by" must not read as ignored (docs/adr/0022).
    if (!isReplica && co.primitive === 'OPERATIONAL_REQUEST' && co.lastStandByAt) {
      meta.appendChild(_stripEl('span', 'efsp-coordination-badge-standby', ' · STAND BY'));
    }
  } else if (co.state === 'REJECTED') {
    meta = _stateMeta(isReplica
      ? `Rejected by you. ${co.peerPositionId} still controls this flight.`
      : `${_coordinationStateWord(co)} by ${co.peerPositionId}`);
    _addClass(meta, 'efsp-x-meta-attn');
  } else {
    meta = _stateMeta(_coordinationStateWord(co));
  }
  row.appendChild(meta);

  // §4.6 rule 1: a Point Out's two halves, both always visible.
  if (co.primitive === 'POINT_OUT' && co.state !== 'REJECTED' && co.dataOwnerPositionRef && co.separationResponsibilityRef) {
    const halves = _stripEl('div', 'efsp-coordination-badges');
    halves.appendChild(_stripEl('span', 'efsp-coordination-badge-data', `DATA: ${co.dataOwnerPositionRef.positionId}`));
    halves.appendChild(_stripEl('span', 'efsp-coordination-badge-sep', `SEP: ${co.separationResponsibilityRef.positionId}`));
    row.appendChild(halves);
  }

  if (co.note) row.appendChild(_buildCoordinationNoteEl(co.note, proposer));

  if (pendingIn) {
    const isOpsRequest = co.primitive === 'OPERATIONAL_REQUEST';
    const buttons = [
      _stripButton(isOpsRequest ? 'Unable' : 'Reject', 'efsp-coordinate-reject-btn', {
        onClick: () => _dispatchCoordination(strip, co.primitive, 'REJECT'),
      }),
    ];
    if (isOpsRequest) {
      buttons.push(_stripButton('Stand By', 'efsp-coordinate-standby-btn', {
        onClick: () => _dispatchCoordination(strip, co.primitive, 'STAND_BY'),
      }));
    }
    buttons.push(_stripButton(isOpsRequest ? 'Approve' : `Accept ${COORDINATION_PRIMITIVE_LABELS[co.primitive] || co.primitive}`,
      'efsp-coordinate-accept-btn', { go: true, onClick: () => _dispatchCoordination(strip, co.primitive, 'ACCEPT') }));
    row.appendChild(_exchangeButtons(buttons));
  }
  return row;
}

/** TOFI (guide §4.6.3): the MRU's pending answer, the ATC side's pending proposal, and the comms-transfer step. */
function _tofiExchange(strip) {
  const tofi = strip.tofiCoordination;
  if (!tofi || tofi.state === 'REJECTED') return null;
  const awaitingComms = !!tofi.acceptedAt && !tofi.commsTransferred;
  if (tofi.state !== 'PROPOSED' && !awaitingComms) return null; // active and settled: the TOFI indicator says so

  const pendingIn = _isPendingTofiReplica(strip);
  const blocking = _tofiExitPrecondition(strip, tofi);
  const row = _exchangeRow({ incoming: pendingIn, kind: 'tofi',
    title: blocking || `${_tofiProposerOf(strip, tofi)} proposed this TOFI ${tofi.direction.toLowerCase()}` });
  _addClass(row, 'efsp-tofi-badge');
  if (blocking) _addClass(row, 'efsp-coordination-badge-blocked');
  row.appendChild(_stripEl('div', 'efsp-x-what', `TOFI ${tofi.direction} ${strip.role === 'MISSION' ? '←' : '→'} ${tofi.peerPositionId}`));

  let meta;
  if (awaitingComms && tofi.state !== 'PROPOSED') {
    meta = _stateMeta('ACCEPTED · comms not moved');
  } else if (blocking) {
    meta = _stateMeta(`${tofi.state} · blocked`);
    _addClass(meta, 'efsp-x-meta-attn');
  } else {
    meta = _stateMeta(tofi.state, tofi.initiatedAt);
  }
  row.appendChild(meta);
  if (tofi.note) row.appendChild(_buildCoordinationNoteEl(tofi.note, _tofiProposerOf(strip, tofi)));

  if (pendingIn) {
    const label = tofi.direction === 'EXIT' ? 'Exit' : 'Entry';
    let regimeSel = null;
    if (!blocking && tofi.direction === 'ENTRY') {
      // docs/adr/0053 — accepting an ENTRY states the regime. See F-008 for why
      // the choice is kept across rebuilds and the click never reaches the Strip.
      const field = _stripEl('label', 'efsp-x-regime', 'SEP REG');
      regimeSel = _stripEl('select', 'efsp-tofi-regime-select');
      regimeSel.dataset.stripAction = 'tofi-regime';
      regimeSel.title = 'under which regime is the MRU taking this aircraft (§4.6.3)';
      for (const value of TOFI_ACCEPT_REGIMES) {
        const opt = _stripEl('option', null, value);
        opt.value = value;
        regimeSel.appendChild(opt);
      }
      const remembered = _tofiRegimeChoice.get(strip.stripId);
      if (remembered && TOFI_ACCEPT_REGIMES.includes(remembered)) regimeSel.value = remembered;
      regimeSel.addEventListener('change', () => _tofiRegimeChoice.set(strip.stripId, regimeSel.value));
      regimeSel.addEventListener('pointerdown', (e) => e.stopPropagation());
      regimeSel.addEventListener('click', (e) => e.stopPropagation());
      field.appendChild(regimeSel);
      row.appendChild(field);
    }
    const accept = _stripButton(`Accept TOFI ${label}`, 'efsp-coordinate-accept-btn', {
      go: true,
      disabled: !!blocking,
      title: blocking || '',
      onClick: () => _dispatchTofi(strip, 'ACCEPT', undefined, regimeSel ? { separationRegime: regimeSel.value } : {}),
    });
    if (blocking) _addClass(accept, 'efsp-nla-btn-denied');
    row.appendChild(_exchangeButtons([
      _stripButton('Reject', 'efsp-coordinate-reject-btn', { onClick: () => _dispatchTofi(strip, 'REJECT') }),
      accept,
    ]));
  } else if (_canTransferTofiComms(strip)) {
    row.appendChild(_exchangeButtons([
      _stripButton('Transfer Comms', 'efsp-coordinate-btn efsp-tofi-transfer-comms-btn', {
        title: 'Guide §4.6.3 — a separate step from ACCEPT',
        onClick: () => _dispatchTofi(strip, 'TRANSFER_COMMS'),
      }),
    ]));
  }
  return row;
}

/** A MARSA relation declared but not yet joined: the interlock is armed, and the two answers are on the Strip. */
function _marsaExchange(strip) {
  if (typeof marsaForStrip !== 'function') return null;
  const relation = marsaForStrip(strip);
  if (!relation || relation.state !== 'ACTIVE' || relation.rendezvousAt) return null;
  const others = relation.participants.filter(id => id !== strip.fdrId).map((fdrId) => {
    const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(fdrId) : null;
    return (fdr && fdr.identity && fdr.identity.callsign) || fdrId;
  });
  const row = _exchangeRow({ kind: 'marsa', title: `declared by ${relation.declaringCallsign}` });
  row.appendChild(_stripEl('div', 'efsp-x-what', `MARSA · ${others.join(', ') || relation.declaringCallsign}`));
  row.appendChild(_stripEl('div', 'efsp-x-meta', 'armed, no rendezvous yet'));
  const acting = !!_resolveActingPositionId(strip);
  row.appendChild(_exchangeButtons([
    _stripButton('Void', 'efsp-marsa-void-btn', {
      disabled: !acting, onClick: () => _dispatchMarsa(strip, relation.marsaId, { kind: 'VoidMarsa' }),
    }),
    _stripButton('Rendezvous', 'efsp-marsa-rendezvous-btn', {
      disabled: !acting, onClick: () => _dispatchMarsa(strip, relation.marsaId, { kind: 'MarkRendezvous' }),
    }),
  ]));
  return row;
}

/** The server would not guess between two contacts; the controller picks one. */
function _trackExchange(strip) {
  if (typeof correlationBadgeFor !== 'function') return null;
  const badge = correlationBadgeFor(strip);
  if (!badge || !badge.ambiguous) return null;
  const n = (badge.candidateTrackIds || []).length;
  const row = _exchangeRow({ incoming: true, kind: 'track', title: badge.title });
  row.appendChild(_stripEl('div', 'efsp-x-what', `TRACK · ${n} CANDIDATES`));
  row.appendChild(_stripEl('div', 'efsp-x-meta', 'pick the contact this flight is'));
  const pick = _stripButton('Pick…', 'efsp-correlation-btn efsp-correlation-pick-btn', {
    disabled: !_resolveActingPositionId(strip),
    onClick: (e, btn) => _openBindPopover(strip, btn, badge.candidateTrackIds),
  });
  row.appendChild(_exchangeButtons([pick]));
  return row;
}

/** The NLA (§3.5), and the reason it is refused, from the server's own `strip.nla` (F-408). */
function _buildLifeBlock(strip) {
  const life = _stripEl('div', 'efsp-strip-life');
  const nlaStatus = strip.nla;
  const nlaLabel = nlaStatus === null ? null : (typeof nlaButtonLabel === 'function' ? nlaButtonLabel(strip) : nlaLabelFor(strip.state, strip.role)); // a carrier hand-over is labelled by its own name (docs/adr/0074)
  let inhibited = null;
  if (nlaLabel) {
    // Drop is the terminal step, not the one filled "go" button.
    const btn = _stripEl('button', `efsp-sbtn${nlaLabel === 'Drop' ? '' : ' efsp-sbtn-go'} efsp-nla-btn`, nlaLabel);
    inhibited = (nlaStatus && nlaStatus.inhibited) || null;
    if (inhibited) {
      btn.disabled = true;
      _addClass(btn, 'efsp-nla-btn-denied');
      btn.title = inhibited;
      btn.dataset.nlaReason = nlaStatus.reason || '';
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // §7.9: the button goes dead on the press rather than on the ack.
        if (_invokeNla(strip)) btn.disabled = true;
      });
    }
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (typeof carrierDecorateNlaButton === 'function') carrierDecorateNlaButton(btn, strip);
    life.appendChild(btn);
  }
  // The carrier's second hand-over, beside the NLA (crc-sync docs/adr/0074): "See you" in Case II.
  if (typeof carrierExtraNlaButtons === 'function') for (const extra of carrierExtraNlaButtons(strip)) life.appendChild(extra);
  // Single Frequency Approach (crc-sync docs/adr/0075): "Rotate to PAR" beside the NLA on a Strip on an SFA frequency.
  if (typeof sfaExtraNlaButtons === 'function') for (const extra of sfaExtraNlaButtons(strip)) life.appendChild(extra);
  return { life, inhibited };
}

function _buildStripTab(strip, arrival) {
  const tab = _stripEl('div', 'efsp-strip-tab');
  tab.appendChild(_stripEl('div', 'efsp-strip-tab-role',
    `${ROLE_ABBR[strip.role] || strip.role} · ${String(strip.state).replace(/_/g, ' ')}`));
  // Just arrived from another controller (docs/adr/0057): who from, in amber,
  // until the controller touches the Strip or 30 s after they first saw it.
  if (arrival) tab.appendChild(_stripEl('div', 'efsp-strip-from', `from ${arrival.from}`));
  const rows = [_coordinationExchange(strip), _tofiExchange(strip), _marsaExchange(strip), _trackExchange(strip)]
    .filter(Boolean);
  for (const row of rows) tab.appendChild(row);
  const { life, inhibited } = _buildLifeBlock(strip);
  tab.appendChild(life);
  return { tab, rows, inhibited };
}

// ── Fields ─────────────────────────────────────────────────────────────────

function _buildStripFields(strip) {
  const grid = _stripEl('div', 'efsp-strip-fields');
  for (const id of compactBlocksFor(strip.role, strip.ownerPositionId, getEfspFdr(strip.fdrId))) {
    const span = fieldSpanFor(id);
    const chip = _stripEl('span', `efsp-block-chip efsp-field${span > 1 ? ' efsp-field-w' + span : ''}`);
    const label = blockLabelFor(id, strip.role);
    const labelEl = _stripEl('span', 'efsp-block-label', label || '');
    const title = typeof blockTitleFor === 'function' ? blockTitleFor(id, getEfspFdr(strip.fdrId)) : null; if (title) labelEl.title = title; // docs/adr/0062
    // §3.7 rule 2's "in the same Block": the current value keeps the field; the
    // latest superseded value sits small and struck beside the label, with a
    // count of the rest. The whole chain is in the expanded view.
    _appendAnnotationHistory(labelEl, strip, id, CHIP_HISTORY_LIMIT);
    chip.appendChild(labelEl);
    chip.appendChild(_buildBlockCell(strip, id));
    grid.appendChild(chip);
  }
  return grid;
}

// ── Indicators ─────────────────────────────────────────────────────────────

// docs/adr/0058: nothing is drawn for what is normal. An indicator appears only
// when it has something to say — a warning, or a situation that currently
// applies (MARSA, TOFI, an airspace, other Strips on the flight). A quiet Strip
// has no indicator row at all. Warnings first, so they are always in the same
// place: the left end of the row.
const INDICATOR_ORDER = ['stca', 'conf', 'rwy', 'gear', 'ord', 'scram', 'trk', 'marsa', 'tofi', 'airspace', 'timer', 'siblings'];
// Keys whose chips come from _stripAlerts (warnings first, left end of the row). rwy/gear:
// field state (docs/adr/0068); ord: hung ordnance (0069); scram: alert/scramble (0070).
const ALERT_SLOT_KEYS = new Set(['stca', 'conf', 'rwy', 'gear', 'ord', 'scram']);

const _pad3 = (n) => String(Math.round(n)).padStart(3, '0');

/** An altitude the way a controller reads it: a flight level at and above transition, feet below. */
function _fmtAlt(ft) {
  const ta = (typeof settings === 'object' && settings && settings.transitionAltFt) || 18000;
  return ft >= ta ? `FL${_pad3(ft / 100)}` : `${Math.round(ft).toLocaleString('en-US')} ft`;
}
const _fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** This Strip's conformance alerts and conflicts, each as { key, text, tone, reason }. */
function _stripAlerts(strip) {
  const out = [];
  const trackId = typeof correlatedTrackIdForStrip === 'function' ? correlatedTrackIdForStrip(strip) : null;
  for (const c of (typeof stcaConflictsForTrack === 'function' ? stcaConflictsForTrack(trackId) : [])) {
    // crc-sync names the other aircraft the way it is labelled: its flight's
    // callsign when correlated, else its tag or track number (docs/adr/0059).
    const other = c.otherCallsign;
    out.push({
      key: 'stca', tone: 'bad', legacy: 'efsp-stca-indicator',
      text: `STCA ${other} ${_fmtClock(c.timeToCpaSec)}`,
      reason: `Conflict with ${other} in ${_fmtClock(c.timeToCpaSec)}: closest ${c.minNm} NM / ${c.vertFt} ft.`,
    });
  }
  if (typeof atoAlertsFor === 'function') out.push(...atoAlertsFor(strip)); // docs/adr/0071, §3.10.3 rule 3
  for (const a of (typeof conformanceAlertsForFdr === 'function' ? conformanceAlertsForFdr(strip.fdrId) : [])) {
    if (a.kind === 'HEADING') {
      out.push({ key: 'conf', tone: 'attn', legacy: 'efsp-conf-indicator', text: `HDG ${_pad3(a.actual)}`,
        reason: `Assigned heading ${_pad3(a.assigned)}, tracking ${_pad3(a.actual)}.` });
    } else if (a.kind === 'WRONG_WAY') {
      const down = a.fpm < 0;
      out.push({ key: 'conf', tone: 'bad', legacy: 'efsp-conf-indicator', text: `ALT ${down ? '↓' : '↑'}`,
        reason: `Assigned ${_fmtAlt(a.assigned)}, ${down ? 'descending' : 'climbing'} through ${_fmtAlt(a.altFt)} at ${Math.abs(a.fpm).toLocaleString('en-US')} ft/min.` });
    } else if (a.kind === 'LEVEL_BUST') {
      out.push({ key: 'conf', tone: 'bad', legacy: 'efsp-conf-indicator', text: `BUST ${a.deviationFt > 0 ? '+' : '−'}${Math.abs(a.deviationFt)}`,
        reason: `Reached ${_fmtAlt(a.assigned)}, now at ${_fmtAlt(a.altFt)}.` });
    }
  }
  // Wave-2 advisories, each defined in its own file (docs/adr/0068, 0069, 0070).
  if (typeof fieldStateAlertsFor === 'function') out.push(...fieldStateAlertsFor(strip));
  if (typeof ordnanceAlertsFor === 'function') out.push(...ordnanceAlertsFor(strip));
  if (typeof scrambleAlertsFor === 'function') out.push(...scrambleAlertsFor(strip));
  return out;
}

// WP7 (crc-sync docs/adr/0071, ato-strip.js): the ATO's Mode 3 conflict is an
// alert chip after the wave-2 advisories; the AR join a quiet badge after MARSA.
INDICATOR_ORDER.splice(INDICATOR_ORDER.indexOf('trk'), 0, 'ato');
INDICATOR_ORDER.splice(INDICATOR_ORDER.indexOf('marsa') + 1, 0, 'ar');
ALERT_SLOT_KEYS.add('ato');

function _indicator(key, text, tone, legacy, title) {
  const node = _stripEl('span', `efsp-ind efsp-ind-${tone}${legacy ? ' ' + legacy : ''}`, text);
  node.dataset.slot = key;
  if (title) node.title = title;
  return node;
}

function _litIndicator(strip, key, el, obligation, siblings) {
  if (key === 'trk') {
    const badge = typeof correlationBadgeFor === 'function' ? correlationBadgeFor(strip) : null;
    if (!badge) return null;
    if (badge.warned) el.classList.add('efsp-strip-correlation-warned');
    // Correlated and nothing wrong is the normal case: say nothing.
    if (/efsp-correlation-correlated/.test(badge.className) && !badge.warned) return null;
    const tone = /uncorrelated/.test(badge.className) ? 'bad' : (badge.ambiguous || badge.warned) ? 'attn' : 'on';
    return _indicator(key, badge.text, tone, badge.className, badge.title);
  }
  if (key === 'marsa') {
    const badge = typeof marsaBadgeFor === 'function' ? marsaBadgeFor(strip) : null;
    if (!badge) return null;
    if (badge.voided) el.classList.add('efsp-strip-marsa-voided');
    if (badge.armed) el.classList.add('efsp-strip-marsa-armed');
    const node = _indicator(key, badge.text, badge.voided ? 'bad' : badge.armed ? 'attn' : 'on', badge.className, badge.title);
    node.dataset.marsaId = badge.marsaId;
    return node;
  }
  if (key === 'tofi') {
    const tofi = strip.tofiCoordination;
    if (!tofi || (tofi.state !== 'PROPOSED' && tofi.state !== 'ACTIVE')) return null;
    return _indicator(key, 'TOFI', tofi.state === 'PROPOSED' ? 'attn' : 'on', 'efsp-tofi-indicator',
      `TOFI ${tofi.direction.toLowerCase()} with ${tofi.peerPositionId}: ${tofi.state}`);
  }
  if (key === 'airspace') {
    if (!strip.airspaceEntry) return null;
    const airspace = getEfspAirspace(strip.airspaceEntry.airspaceId);
    const name = (airspace && airspace.definition && airspace.definition.name) || strip.airspaceEntry.airspaceId;
    const mhz = strip.airspaceEntry.frequencyMhz;
    const block = strip.airspaceEntry.altitudeBlock;
    // The altitude restriction belongs on the Strip: two aircraft sharing one
    // block are only safe if each controller can see who is held to what.
    const text = [name, mhz ? mhz.toFixed(3) : null, block ? `${block.lowerFt}–${block.upperFt} ft` : null].filter(Boolean).join(' ');
    const cold = airspace && airspace.state !== 'ACTIVE';
    return _indicator(key, text, cold ? 'attn' : 'on',
      `efsp-airspace-badge${cold ? ' efsp-airspace-badge-unactivated' : ''}`,
      cold ? `${name} is ${airspace.state}, not active` : '');
  }
  if (key === 'timer') {
    if (!obligation) return null;
    const overdue = obligation.severity === 'OVERDUE';
    return _indicator(key, obligation.obligationType.replace(/_/g, ' '), overdue ? 'bad' : 'attn',
      `efsp-obligation-badge${overdue ? ' efsp-obligation-badge-overdue' : ''}`,
      `${obligation.obligationType} — ${obligation.severity}`);
  }
  if (key === 'ar') {
    // The AR join (docs/adr/0071): not MARSA, never a warning — tone 'on'.
    const join = typeof arJoinFor === 'function' ? arJoinFor(strip) : null;
    return join ? _indicator(key, join.text, 'on', 'efsp-ar-badge', join.title) : null;
  }
  if (key === 'siblings') {
    if (siblings.length === 0) return null;
    // A sortie that crosses a Facility boundary leaves several live Strips on
    // one flight. Advisory only; the title names each (crc-sync docs/adr/0054).
    return _indicator(key, `+${siblings.length}`, 'on', 'efsp-shared-fdr-badge',
      `this flight also has ${siblings.length === 1 ? 'a Strip' : `${siblings.length} Strips`} at ${siblings.map(s => `${s.facilityId || '?'}/${s.ownerPositionId} (${s.role})`).join(', ')}`);
  }
  return null;
}

/** The indicator row, or null when there is nothing to say (docs/adr/0058). */
function _buildIndicatorSlots(strip, el, obligation, alerts) {
  const slots = _stripEl('div', 'efsp-strip-slots');
  const siblings = otherLiveStripsForFdr(strip.fdrId, strip.stripId);
  for (const key of INDICATOR_ORDER) {
    if (ALERT_SLOT_KEYS.has(key)) {
      for (const a of alerts.filter(x => x.key === key)) slots.appendChild(_indicator(key, a.text, a.tone, a.legacy, a.reason));
      continue;
    }
    const node = _litIndicator(strip, key, el, obligation, siblings);
    if (node) slots.appendChild(node);
  }
  // A return leg's archived annotations: only drawn when there are some.
  if (strip.previousLeg && Object.keys(strip.previousLeg.annotations || {}).length > 0) {
    const count = Object.keys(strip.previousLeg.annotations).length;
    slots.appendChild(_indicator('prevLeg', `${strip.previousLeg.role} ×${count}`, 'on', 'efsp-previous-leg-badge',
      Object.entries(strip.previousLeg.annotations)
        .map(([blockId, cell]) => `${blockId}: ${(cell.entries || []).map(e => e.value).join(' / ')}`).join('\n')));
  }
  return slots.children && slots.children.length === 0 ? null : slots;
}

// ── Reasons ────────────────────────────────────────────────────────────────

/** Every sentence the Strip owes the controller, each a full line (F-006). */
function _buildReasonLines(strip, inhibited, alerts = []) {
  const lines = [];
  // Conflicts and conformance first: the most urgent thing on the Strip.
  for (const a of alerts) {
    lines.push(_stripEl('div', `efsp-strip-reason${a.tone === 'bad' ? ' efsp-strip-reason-bad' : ''} efsp-alert-reason`, a.reason));
  }
  if (inhibited) {
    const why = _stripEl('div', 'efsp-strip-reason efsp-nla-inhibit-reason', inhibited);
    why.title = inhibited;
    lines.push(why);
  }
  const tofi = strip.tofiCoordination;
  if (tofi && tofi.state !== 'REJECTED') {
    const blocking = _tofiExitPrecondition(strip, tofi);
    if (blocking) {
      const why = _buildCoordinationReasonEl(blocking);
      _addClass(why, 'efsp-strip-reason');
      lines.push(why);
    }
  }
  const marsa = typeof marsaBadgeFor === 'function' ? marsaBadgeFor(strip) : null;
  if (marsa && marsa.voidReason) {
    lines.push(_stripEl('div', 'efsp-strip-reason efsp-strip-reason-bad efsp-marsa-void-reason', marsa.voidReason));
  } else if (marsa && marsa.armed) {
    lines.push(_stripEl('div', 'efsp-strip-reason efsp-marsa-armed-reason',
      'MARSA is armed. Assigning a heading or altitude before rendezvous will void it.'));
  }
  return lines;
}

// ── The ⋯ menu ─────────────────────────────────────────────────────────────

/**
 * Everything the controller can START on this Strip, grouped. An item a
 * Position can never use is left out; one it can use but not right now is
 * listed, disabled, with the reason — so the menu teaches what exists.
 * @returns {{group:string, key:string, label:string, cls:string, enabled:boolean, reason?:string, run:(anchor:HTMLElement, item:HTMLElement)=>boolean|void}[]}
 */
function _stripMenuItems(strip) {
  if (_isRejectedCoordinationReplica(strip)) return [];
  const items = [];
  const acting = _resolveActingPositionId(strip);
  const pendingIn = _isPendingCoordinationReplica(strip);
  const answerFirst = 'answer the pending proposal first';

  // Start
  // H2 / H40 (docs/adr/0080): an AIC- or JTAC-held line goes back to TAC_C2
  // from here, since a controller holding only that Position has no TAC_C2 tab
  // to drag it to. One item per target.
  for (const to of HAND_BACK_TO[strip.ownerPositionId] || []) {
    const bay = _handBackBayFor(strip, to);
    const holdsOwner = acting === strip.ownerPositionId; // acting as another Position cannot transfer this line
    const ok = holdsOwner && !!bay && !pendingIn;
    items.push({ group: 'Start', key: `hand-back-${to}`, label: `Hand back to ${to}`, cls: 'efsp-hand-back-btn', enabled: ok,
      reason: !holdsOwner ? `you do not hold ${strip.ownerPositionId}` : !bay ? `${to} has no Bay for this line` : pendingIn ? answerFirst : '',
      title: `Transfer this line back to ${to}`,
      run: () => _dispatchHandBack(strip, to) });
  }
  // U7 (docs/adr/0080): the proposer can always leave its own exchange — a link
  // the other side can no longer answer must not strand the Strip.
  if (acting === strip.ownerPositionId && strip.coordination && !strip.coordination.mintedForCoordination
      && (strip.coordination.state === 'PROPOSED' || strip.coordination.state === 'ACTIVE')) {
    const open = strip.coordination.state === 'PROPOSED';
    items.push({ group: 'Start', key: 'coordination-cancel', label: open ? 'Cancel proposal' : 'End coordination', cls: 'efsp-coordinate-btn', enabled: true,
      title: open ? 'Withdraw the open proposal' : 'Close this exchange on your Strip (the other side keeps its own)',
      run: () => _dispatchCoordination(strip, strip.coordination.primitive, 'CANCEL') });
  }
  if (COORDINATION_TARGETS[strip.ownerPositionId]) {
    const ok = _canProposeCoordination(strip) && !!acting;
    let reason = '';
    if (!ok) {
      if (pendingIn) reason = answerFirst;
      else if (strip.coordination && strip.coordination.state === 'PROPOSED') reason = 'a proposal is already open';
      else if (strip.coordination && strip.coordination.state === 'ACTIVE') reason = 'already coordinated';
      else reason = `not from ${String(strip.state).replace(/_/g, ' ')}`;
    }
    items.push({ group: 'Start', key: 'coordinate', label: 'Coordinate…', cls: 'efsp-coordinate-btn', enabled: ok, reason,
      title: `Propose a cross-Facility coordination to ${COORDINATION_TARGETS[strip.ownerPositionId].positionId}`,
      run: (anchor) => _openCoordinatePopover(strip, anchor) });
  }
  if (TOFI_COUNTERPARTS[strip.ownerPositionId] && strip.role !== 'MISSION') {
    if (_canProposeTofiExit(strip)) {
      items.push({ group: 'Start', key: 'tofi-exit', label: 'TOFI Exit…', cls: 'efsp-coordinate-btn', enabled: true,
        title: `Propose returning separation to ${strip.tofiCoordination.peerPositionId}`,
        run: () => _dispatchTofi(strip, 'PROPOSE', 'EXIT') });
    } else {
      const ok = _canProposeTofiEntry(strip);
      const tofi = strip.tofiCoordination;
      const reason = ok ? '' : pendingIn ? answerFirst
        : tofi && tofi.state === 'PROPOSED' ? 'a TOFI proposal is already open'
          : `not from ${String(strip.state).replace(/_/g, ' ')}`;
      const counterparts = TOFI_COUNTERPARTS[strip.ownerPositionId];
      items.push({ group: 'Start', key: 'tofi', label: 'TOFI…', cls: 'efsp-coordinate-btn', enabled: ok, reason,
        title: 'Propose a Transfer of Flight Information to a Military Radar Unit',
        run: (anchor) => {
          if (counterparts.length === 1) _dispatchTofi(strip, 'PROPOSE', 'ENTRY', { target: counterparts[0] });
          else _openTofiEntryPopover(strip, anchor, counterparts);
        } });
    }
  }
  if (AIRSPACE_ENTRY_POSITIONS.includes(strip.ownerPositionId)) {
    const ok = _canApproveAirspaceEntry(strip) && !pendingIn;
    if (strip.airspaceEntry) {
      items.push({ group: 'Start', key: 'leave-airspace', label: 'Leave airspace', cls: 'efsp-coordinate-btn', enabled: ok,
        reason: ok ? '' : answerFirst,
        run: () => { if (acting) sendEfspMutation(acting, strip, { kind: 'ClearAirspaceEntry' }); } });
    } else {
      items.push({ group: 'Start', key: 'airspace', label: 'Airspace…', cls: 'efsp-coordinate-btn', enabled: ok,
        reason: ok ? '' : answerFirst, title: 'Approve this flight into an airspace, on its frequency',
        run: (anchor) => _openAirspaceEntryPopover(strip, anchor) });
    }
  }

  // Flight
  if (acting) {
    items.push({ group: 'Flight', key: 'marsa', label: 'MARSA…', cls: 'efsp-marsa-btn', enabled: true,
      title: 'declare, or manage, military authority separating this flight from another',
      run: (anchor) => _openMarsaPopover(strip, anchor) });
  }
  const record = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
  const correlation = typeof correlationBadgeFor === 'function' ? correlationBadgeFor(strip) : null;
  if (record && !(correlation && correlation.ambiguous)) {
    if (record.binding) {
      items.push({ group: 'Flight', key: 'unbind', label: 'Unbind', cls: 'efsp-correlation-btn', enabled: !!acting,
        title: 'give the contact back to the automatic matcher',
        run: () => _dispatchCorrelation(strip, { kind: 'UnbindTrack' }) });
    } else if (record.state === 'UNCORRELATED') {
      items.push({ group: 'Flight', key: 'bind', label: 'Bind…', cls: 'efsp-correlation-btn', enabled: !!acting,
        title: 'pick the contact this flight is',
        run: (anchor) => _openBindPopover(strip, anchor, null) });
    }
  }
  if (_canConvertToArrival(strip)) {
    const blockedBy = (strip.coordination && strip.coordination.state === 'PROPOSED') ? 'an open coordination proposal'
      : (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') ? 'an open TOFI proposal'
        : (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') ? 'active tactical control' : null;
    const annotated = Object.keys(strip.annotations || {}).length > 0;
    const armed = _pendingConvertStripId === strip.stripId;
    items.push({ group: 'Flight', key: 'convert', label: armed ? 'Convert — press again' : 'Convert to Arrival →',
      cls: 'efsp-spawn-return-btn' + (annotated ? ' efsp-confirm-needed' : ''), enabled: !blockedBy,
      reason: blockedBy ? `resolve ${blockedBy} first` : '',
      title: annotated
        ? `Turn this Strip into its return ARRIVAL leg at ${strip.ownerPositionId}. Its ${Object.keys(strip.annotations).length} annotation(s) are archived and cleared from the working Strip — press twice.`
        : `Turn this Strip into its return ARRIVAL leg at ${strip.ownerPositionId} — same Strip, same FDR, no duplicate`,
      // Two presses when it would clear annotations: there is no undo. The
      // first relabels the item in place and keeps the menu open.
      run: (anchor, itemEl) => {
        if (annotated && _pendingConvertStripId !== strip.stripId) {
          _pendingConvertStripId = strip.stripId;
          itemEl.textContent = 'Convert — press again';
          return false;
        }
        _pendingConvertStripId = null;
        convertStripToArrival(strip);
      } });
  }

  // Strip
  if (acting) {
    items.push({ group: 'Strip', key: 'offset', label: strip.flags.offset ? 'Un-offset ⇤' : 'Offset ⇥', cls: 'efsp-offset-btn',
      enabled: true, title: 'Offset (cock)', run: () => { const acting = _dispatchGesture(strip, toggleOffset); if (typeof noteEfspGesture === 'function') noteEfspGesture('OFFSET', 'menu', acting); } });
  }
  return items;
}

let _openStripMenuEl = null;

function _closeStripMenu() {
  _unmountPopover(_openStripMenuEl);
  _openStripMenuEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseStripMenu, true);
}

function _onDocPointerDownCloseStripMenu(e) {
  if (_openStripMenuEl && !_openStripMenuEl.contains(e.target)) _closeStripMenu();
}

function _openStripMenu(strip, anchor) {
  const wasOpenHere = _openStripMenuEl && _openStripMenuEl.dataset.stripId === strip.stripId;
  _closeStripMenu();
  if (wasOpenHere) return; // the ⋯ button toggles
  strip = getEfspStrip(strip.stripId) || strip; // F-107: act on the live record
  const items = _stripMenuItems(strip);
  if (items.length === 0) return;

  const menu = _stripEl('div', 'efsp-strip-menu efsp-strip-menu-popover');
  menu.dataset.stripId = strip.stripId;
  menu.setAttribute('role', 'menu');
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  let group = null;
  const buttons = [];
  for (const item of items) {
    if (item.group !== group) {
      group = item.group;
      menu.appendChild(_stripEl('div', 'efsp-strip-menu-group', group));
    }
    const btn = _stripEl('button', `efsp-strip-menu-item ${item.cls || ''}`, item.label);
    btn.setAttribute('role', 'menuitem');
    btn.dataset.stripAction = item.key;
    if (item.title) btn.title = item.title;
    if (!item.enabled) {
      btn.disabled = true;
      if (item.reason) {
        btn.title = item.reason;
        btn.appendChild(_stripEl('span', 'efsp-strip-menu-reason', item.reason));
      }
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Items that change the menu in place (Convert's first press) return false.
        const keepOpen = item.run(anchor, btn) === false;
        if (!keepOpen && _openStripMenuEl === menu) {
          // Close the menu unless the action opened a popover of its own, which
          // _open*Popover's own close-previous handling does not know about.
          _unmountPopover(menu);
          _openStripMenuEl = null;
          document.removeEventListener('pointerdown', _onDocPointerDownCloseStripMenu, true);
        }
      });
      buttons.push(btn);
    }
    menu.appendChild(btn);
  }
  // Arrow keys move between the items that can be pressed; Esc is the panel's
  // own popover handler.
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    if (buttons[next]) buttons[next].focus();
  });

  _openStripMenuEl = menu;
  _mountPopover(menu, anchor, strip, _closeStripMenu);
  if (buttons[0] && typeof buttons[0].focus === 'function') buttons[0].focus();
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseStripMenu, true), 0);
}

function _buildStripTools(strip) {
  const tools = _stripEl('div', 'efsp-strip-tools');
  if (_stripMenuItems(strip).length > 0) {
    const more = _stripEl('button', 'efsp-sbtn efsp-sbtn-icon efsp-strip-menu-btn', '⋯');
    more.title = 'More actions';
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', (e) => { e.stopPropagation(); _openStripMenu(strip, more); });
    more.addEventListener('pointerdown', (e) => e.stopPropagation());
    tools.appendChild(more);
  }
  _appendExpandButton(tools, strip);
  _appendDropButton(tools, strip);
  return tools;
}

// ── Assembly ───────────────────────────────────────────────────────────────

function _buildStripLayout(el, strip, obligation) {
  el.classList.add('efsp-strip-c');
  if (_isRejectedCoordinationReplica(strip)) el.classList.add('efsp-strip-inert');
  if (typeof isMarsaHighlighted === 'function' && isMarsaHighlighted(strip.stripId)) {
    el.classList.add('efsp-strip-marsa-participant');
  }
  if (typeof isArHighlighted === 'function' && isArHighlighted(strip.stripId)) el.classList.add('efsp-strip-ar-participant');

  const arrival = typeof efspArrivalFor === 'function' ? efspArrivalFor(strip.stripId) : null;
  if (arrival) {
    el.classList.add('efsp-strip-arrived');
    // The flash plays on the first build the controller can SEE, and never
    // again: rebuilding for any other reason shows the steady amber edge.
    const onScreen = typeof efspVisibleBayId !== 'function' || efspVisibleBayId() === strip.bayId;
    if (onScreen && consumeEfspArrivalFlash(strip.stripId)) {
      el.classList.add('efsp-strip-arrived-flash');
      if (typeof noteEfspArrivalShown === 'function') noteEfspArrivalShown();
    }
    // Touching the Strip is noticing it. Cleared in place rather than by a
    // re-render: this is also how a drag starts, and rebuilding the element
    // under a starting drag would drop it.
    const noticed = () => {
      if (!efspArrivalFor(strip.stripId)) return;
      clearEfspArrival(strip.stripId);
      el.classList.remove('efsp-strip-arrived', 'efsp-strip-arrived-flash');
      const from = el.querySelector && el.querySelector('.efsp-strip-from');
      if (from && from.remove) from.remove();
    };
    el.addEventListener('pointerdown', noticed, true);
    el.addEventListener('keydown', noticed, true);
  }

  const { tab, rows, inhibited } = _buildStripTab(strip, arrival);
  if (rows.some(r => r.classList.contains('efsp-x-in'))) el.classList.add('efsp-strip-needs');

  const alerts = _stripAlerts(strip);
  if (alerts.some(a => a.tone === 'bad')) el.classList.add('efsp-strip-alert');
  else if (alerts.length) el.classList.add('efsp-strip-alert-attn');

  const main = _stripEl('div', 'efsp-strip-main');
  main.appendChild(_buildStripFields(strip));
  const slots = _buildIndicatorSlots(strip, el, obligation, alerts);
  if (slots) main.appendChild(slots);
  for (const line of _buildReasonLines(strip, inhibited, alerts)) main.appendChild(line);
  _appendExpandedView(main, strip);

  // The grid is one level down because the Strip itself is the size container
  // (efsp-panel.css), and a container query cannot restyle its own container.
  const grid = _stripEl('div', 'efsp-strip-grid');
  grid.appendChild(tab);
  grid.appendChild(main);
  grid.appendChild(_buildStripTools(strip));
  el.appendChild(grid);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ROLE_ABBR, INDICATOR_ORDER };
}
