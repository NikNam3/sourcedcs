'use strict';

// Bay/Rack rendering + Pointer Events drag (guide §7.1-7.2, §7.5). DOM-only
// — not unit tested (crc-desktop's test suite has no DOM harness; see the
// implementation plan's explicit "manual QA, not Playwright" decision).
// The math this file calls (computeInsertionIndex) IS unit tested, in
// strip-drag.js.
//
// Rendering rules followed here, from the guide:
//   §7.5.2 — no virtualization; a Bay is tens of Strips.
//   §7.5.3 — batch incoming updates into one rAF commit.
//   §7.5.4 — keyed by stable stripId, never destroy-and-recreate on reorder.
//   §7.5.5 — contain: layout style paint per Strip (see efsp-panel.css).
//   §7.2.1 — a single insertion line, not live list reflow.
//   §7.2.3 — the dragged Strip is semi-transparent while moving.
//   §7.2.4 — dragged element moves via `transform: translate3d()` only,
//            `position: fixed`, never top/left.
//   §7.2.5 — insertion index computed from rects cached at pointerdown,
//            never re-measured per pointermove.
//   §7.8.1 — every drag has a non-drag alternative: click-to-select, then
//            click a Rack to move there (WCAG 2.2 SC 2.5.7).

let _selectedStripId = null; // click-to-select state for the non-drag move path

function getSelectedEfspStripId() { return _selectedStripId; }

function _blockLabel(fdr, strip, blockId) {
  const { value } = resolveBlockValue(blockId, fdr, strip);
  if (value == null || value === '') return '';
  if (typeof value === 'boolean') return value ? '✓' : '';
  return String(value);
}

/**
 * Renders one Block as a span, or — for editable Blocks — a click-to-edit
 * cell (guide §3.7 rule 5 / §7.4 rule 2: Enter commits, Esc reverts, NO
 * auto-commit on blur). Editing is scoped to one Strip at a time via
 * _editingBlock; starting a new edit or clicking elsewhere reverts any
 * other cell still open, since blur must never commit.
 */
function _buildBlockCell(strip, blockId) {
  const fdr = getEfspFdr(strip.fdrId);
  const span = document.createElement('span');
  span.className = 'efsp-block efsp-block-' + blockId;
  span.dataset.block = blockId;
  span.textContent = _blockLabel(fdr, strip, blockId);

  if (!isBlockEditable(blockId, strip.role)) return span;

  span.classList.add('efsp-block-editable');
  span.tabIndex = 0;
  const startEdit = (e) => {
    e.stopPropagation(); // never trigger _selectStrip/drag on the parent Strip
    _startBlockEdit(strip, blockId, span);
  };
  span.addEventListener('click', startEdit);
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(e); }
  });
  // pointerdown must not reach the Strip's own drag-start handler either —
  // same reasoning as the NLA button (see _onStripPointerDown's guard),
  // spelled out again here since this is a span, not a <button>, and
  // wouldn't otherwise be caught by that selector.
  span.addEventListener('pointerdown', (e) => e.stopPropagation());

  if ((CONFIRM_VACATED_ELIGIBLE_BLOCKS[strip.role] || []).includes(blockId) && hasActiveAnnotationEntry(strip, blockId)) {
    // confirmVacated (guide §3.7 rule 3) — a SIBLING action to the
    // click-to-edit flow above, not part of it, so Enter/Esc semantics of
    // free-text editing stay untouched. Sends confirmVacated:true with no
    // value: this marks the current ACTIVE entry STRUCK, it never amends.
    const wrapper = document.createElement('span');
    wrapper.className = 'efsp-block-with-strike';
    wrapper.appendChild(span);

    const strikeBtn = document.createElement('button');
    strikeBtn.className = 'efsp-confirm-vacated-btn';
    strikeBtn.title = 'Confirm vacated (mark struck)';
    strikeBtn.textContent = '⌿';
    strikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const actingPositionId = _resolveActingPositionId(strip);
      if (!actingPositionId) return;
      sendEfspMutation(actingPositionId, strip, { kind: 'SetBlock', blockId, confirmVacated: true });
    });
    wrapper.appendChild(strikeBtn);
    return wrapper;
  }

  return span;
}

function _startBlockEdit(strip, blockId, span) {
  const currentValue = span.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'efsp-block-input';
  input.value = currentValue;

  const revert = () => { input.replaceWith(span); };
  const commit = () => {
    const value = input.value.trim();
    input.replaceWith(span);
    if (value === currentValue) return; // no-op edit, don't send a Mutation for nothing
    const positions = getActingPositions();
    const actingPositionId = positions.includes(strip.ownerPositionId) ? strip.ownerPositionId : positions[0];
    if (!actingPositionId) return;
    sendEfspMutation(actingPositionId, strip, { kind: 'SetBlock', blockId, value });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
  // Deliberately NO 'blur' handler that commits — guide §3.7 rule 5 / §7.4
  // rule 2 is explicit that blur must never amend a clearance. Blur just
  // leaves the input open; the next click elsewhere (which starts a
  // different edit, or _selectStrip) will naturally replace it once
  // re-rendered, and Escape/Enter are the only two ways this ever closes
  // on purpose. (A stray still-open input surviving a re-render is
  // rebuilt fresh by _buildBlockCell on the next renderBay() pass anyway.)

  span.replaceWith(input);
  input.focus();
  input.select();
}

function _buildStripEl(strip) {
  const fdr = getEfspFdr(strip.fdrId);
  const el = document.createElement('div');
  el.className = 'efsp-strip';
  el.dataset.stripId = strip.stripId;
  el.dataset.rev = String(strip.rev); // renderBay()'s keyed reconciliation reuse check
  el.dataset.positionId = strip.ownerPositionId; // read during drag drop-target resolution
  if (strip.flags.offset) el.classList.add('efsp-strip-offset');
  if (strip.flags.flipped) el.classList.add('efsp-strip-flipped');
  if (strip.flags.highlight) el.style.setProperty('--efsp-highlight', strip.flags.highlight);
  if (strip.flags.attention) el.classList.add('efsp-strip-attention');
  el.classList.toggle('efsp-strip-selected', strip.stripId === _selectedStripId);

  // WP4A (docs/adr/0021) — a distinct third alert tier, deliberately NOT
  // reusing efsp-strip-attention's red (reserved, guide §7.7 rule 4) or
  // the mutation-error red — a due-but-not-yet-catastrophic obligation
  // reads differently from "this Strip needs your attention right now."
  const obligation = typeof getEfspObligation === 'function' ? getEfspObligation(strip.stripId) : null;
  if (obligation) {
    el.classList.add('efsp-strip-obligation-due');
    if (obligation.severity === 'OVERDUE') el.classList.add('efsp-strip-obligation-overdue');
  }
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'listitem');
  el.setAttribute('aria-label', `Strip ${_blockLabel(fdr, strip, '1')}`);

  if (strip.flags.flipped) {
    // Flip (guide §7.3): hides all Blocks except aircraft ID — content
    // only. Event listeners are still attached below UNCONDITIONALLY — a
    // flipped Strip must remain double-clickable (to un-flip it),
    // selectable and draggable. An earlier version of this function
    // returned early right here, before any listener was ever attached,
    // which made a flipped Strip permanently inert with no way back
    // through the UI at all — this is that fix.
    el.appendChild(_buildBlockCell(strip, '1'));
  } else {
    // '9' (route) is included so the fields guide §8.5's flight-plan
    // validation actually requires (route/altitude/departure/destination —
    // nla.js's REQUIRED_FOR_CLEARANCE) are all reachable for editing
    // directly on the Strip, not just at CreateStrip time.
    //
    // Reused unmodified for ARRIVAL Strips (Phase 2) rather than a separate
    // per-role compact list: every one of these Block IDs is deliberately
    // ALSO present in ARRIVAL_BLOCK_MAP (see strip-template.js), so
    // _buildBlockCell resolves each one correctly per strip.role — '8'/'8A'/
    // '8B'/'7' mean different fields on an ARRIVAL Strip, but the compact-
    // view layout position is the same. A genuinely arrival-tailored compact
    // layout (e.g. surfacing ETA/Block 6 here too) is a nice-to-have, not
    // built in Phase 2.
    const blocks = ['1', '3', '4', '5', '7', '8', '8A', '8B', '9', '25'];
    for (const id of blocks) el.appendChild(_buildBlockCell(strip, id));

    // Offset (guide §7.3) — one input, a dedicated button so it's reachable
    // from keyboard/touch per §7.1 rule 4, not just a drag/dblclick gesture.
    const offsetBtn = document.createElement('button');
    offsetBtn.className = 'efsp-offset-btn';
    offsetBtn.title = 'Offset (cock)';
    offsetBtn.textContent = '⇥';
    offsetBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchGesture(strip, toggleOffset); });
    el.appendChild(offsetBtn);

    // WP4A (docs/adr/0014): a CENTER-facility INBOUND ARRIVAL Strip's real
    // next action is the Coordinate button below, never the ordinary
    // intrafacility NLA (server-side, nla.js's computeArrivalNla already
    // always inhibits this case with "cross-Facility HANDOFF required" —
    // known client-side so the button doesn't render at all here, rather
    // than rendering enabled and failing on every click).
    const isCenterInbound = strip.role === 'ARRIVAL' && strip.state === 'INBOUND' && strip.facilityId === 'CENTER';
    const nlaLabel = isCenterInbound ? null : nlaLabelFor(strip.state, strip.role);
    if (nlaLabel) {
      const btn = document.createElement('button');
      btn.className = 'efsp-nla-btn';
      btn.textContent = nlaLabel;

      // Per-State authority (guide §3.4 "normally owned by", docs/adr/0010)
      // — the SERVER already rejects this if strip.ownerPositionId isn't
      // authorized for strip.state; this is purely the proactive half, so
      // the button never LOOKS pressable when it isn't. Keyed on the
      // Strip's actual owner, not on which Position the viewing controller
      // happens to be acting as — the authority question is about the
      // Strip itself ("whose job is this state"), the same for every
      // viewer looking at it.
      if (!canActOnState(strip.ownerPositionId, strip.role, strip.state)) {
        btn.disabled = true;
        btn.classList.add('efsp-nla-btn-denied');
        btn.title = `${strip.state} is not ${strip.ownerPositionId}'s to advance`;
      } else {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          _invokeNla(strip);
        });
      }
      el.appendChild(btn);
    }

    // ── WP4A coordination affordances ────────────────────────────────
    if (_isPendingCoordinationReplica(strip)) {
      // This Strip IS a proposal awaiting response — accept/reject
      // REPLACE the normal NLA slot conceptually (there is no ordinary
      // NLA for a Strip still sitting in a Coordination Bay), rendered
      // alongside whatever (if anything) nlaLabelFor returned above.
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'efsp-coordinate-accept-btn';
      acceptBtn.textContent = `Accept ${COORDINATION_PRIMITIVE_LABELS[strip.coordination.primitive] || strip.coordination.primitive}`;
      acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchCoordination(strip, strip.coordination.primitive, 'ACCEPT'); });
      el.appendChild(acceptBtn);

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'efsp-coordinate-reject-btn';
      rejectBtn.textContent = 'Reject';
      rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchCoordination(strip, strip.coordination.primitive, 'REJECT'); });
      el.appendChild(rejectBtn);
    } else if (_canProposeCoordination(strip)) {
      const coordBtn = document.createElement('button');
      coordBtn.className = 'efsp-coordinate-btn';
      coordBtn.textContent = 'Coordinate…';
      coordBtn.title = `Propose a cross-Facility coordination to ${COORDINATION_TARGETS[strip.ownerPositionId].positionId}`;
      coordBtn.addEventListener('click', (e) => { e.stopPropagation(); _openCoordinatePopover(strip, el); });
      el.appendChild(coordBtn);
    }

    // POINT_OUT dual-half rendering (guide §4.6 rule 1: "the UI MUST
    // render both halves unambiguously") — two distinct, always-visible
    // chips, never a toggle. Shown for any coordination primitive whose
    // data-ownership and separation-responsibility refs can differ, but
    // only POINT_OUT ever actually splits them (coordination.js's table).
    if (strip.coordination && strip.coordination.primitive === 'POINT_OUT' && strip.coordination.state !== 'REJECTED') {
      const badges = document.createElement('div');
      badges.className = 'efsp-coordination-badges';
      const dataChip = document.createElement('span');
      dataChip.className = 'efsp-coordination-badge efsp-coordination-badge-data';
      dataChip.textContent = `DATA: ${strip.coordination.dataOwnerPositionRef.positionId}`;
      const sepChip = document.createElement('span');
      sepChip.className = 'efsp-coordination-badge efsp-coordination-badge-sep';
      sepChip.textContent = `SEP: ${strip.coordination.separationResponsibilityRef.positionId}`;
      badges.appendChild(dataChip);
      badges.appendChild(sepChip);
      el.appendChild(badges);
    }

    if (obligation) {
      const badge = document.createElement('span');
      badge.className = 'efsp-obligation-badge' + (obligation.severity === 'OVERDUE' ? ' efsp-obligation-badge-overdue' : '');
      badge.textContent = obligation.obligationType.replace(/_/g, ' ');
      badge.title = `${obligation.obligationType} — ${obligation.severity}`;
      el.appendChild(badge);
    }
  }

  // Flip: dblclick. Highlight: right-click (contextmenu) opens a 3-swatch
  // popover. Attention: Shift+click. All three guarded the same way the
  // NLA/offset buttons are guarded against drag-start (_onStripPointerDown
  // already ignores pointerdown on interactive children; these fire on the
  // Strip body itself, so they're gated here instead by checking e.target
  // isn't an editable Block cell — clicking IN a Block cell must never also
  // toggle Attention).
  el.addEventListener('click', (e) => {
    if (e.target.closest('.efsp-block-editable, .efsp-block-input, button')) return;
    if (e.shiftKey) { _dispatchGesture(strip, setAttention, 'red'); return; }
    _selectStrip(strip.stripId);
  });
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.efsp-block-editable, .efsp-block-input, button')) return;
    _dispatchGesture(strip, toggleFlip);
  });
  el.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.efsp-block-editable, .efsp-block-input, button')) return;
    e.preventDefault();
    _openHighlightPopover(strip, el);
  });
  el.addEventListener('pointerdown', (e) => _onStripPointerDown(e, strip));
  el.addEventListener('keydown', (e) => _onStripKeydown(e, strip));

  return el;
}

function _selectStrip(stripId) {
  _selectedStripId = _selectedStripId === stripId ? null : stripId;
  renderAllOpenEfspBays();
}

// Non-drag move path (WCAG 2.2 SC 2.5.7): select a Strip, then click a
// Rack's header to move the selection there — no pointer drag required.
function _onRackHeaderClick(bayId, rackId) {
  if (bayId.endsWith('-search')) return; // the search pseudo-Bay isn't a real destination server-side (guide §4.3) — nothing to move "into"
  if (!_selectedStripId) return;
  const strip = getEfspStrip(_selectedStripId);
  if (!strip) return;
  _moveStrip(strip, bayId, rackId, null, null);
  _selectedStripId = null;
}

function _onStripKeydown(e, strip) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    _selectStrip(strip.stripId);
  }
}

// The Position a controller acts as for a Mutation on this Strip — its
// current Owner if held, else whichever held Position happens to be first.
// Shared by every dispatch helper below (NLA, move, transfer, gestures).
function _resolveActingPositionId(strip) {
  const positions = getActingPositions();
  return positions.includes(strip.ownerPositionId) ? strip.ownerPositionId : positions[0];
}

function _invokeNla(strip) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'InvokeNla' });
}

function _moveStrip(strip, bayId, rackId, afterStripId, beforeStripId) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'MoveStrip', bayId, rackId, afterStripId, beforeStripId });
}

// Owning Position hand-off (guide §4.5) — distinct from _moveStrip, which
// only ever reorders/relocates a Strip within its CURRENT owner's own Bay
// set. Appends to the end of the destination Bay/Rack; the guide doesn't
// mandate letting the sender pick an exact insertion point mid-transfer,
// and the receiving controller can always reorder locally afterward.
function _transferStrip(strip, toPositionId, bayId, rackId) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'TransferStrip', toPositionId, bayId, rackId });
}

// ── WP4A: cross-Facility coordination (guide §4.6, docs/adr/0015-0016) ──
//
// Only HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/AIT — the 5 primitives
// permission.js grants exclusively to APP/CTR (§4.6, this slice's civil
// ATC<->ATC scope). No MRU-refusal audit is needed yet: no MRU Position
// exists this slice (docs/adr/0012's deferral) — gating the Coordinate
// button to APP/CTR only is what D12 will extend once one does.
//
// Target Facility/Position is DETERMINISTIC this slice — there are only
// two Facilities, and each of APP/CTR has exactly one counterpart on the
// other side. A real multi-Facility topology would need a picker; this
// slice deliberately doesn't build one it can't yet exercise.
const COORDINATION_TARGETS = {
  APP: { facilityId: 'CENTER', positionId: 'CTR' },
  CTR: { facilityId: 'INCIRLIK', positionId: 'APP' },
};

/**
 * A cross-Facility coordination replica lands in the receiving Position's
 * Coordination Bay (bayId ends '-coordination') with coordination.state
 * PROPOSED — that combination is what actually distinguishes "this Strip
 * IS the pending proposal awaiting my response" from the SENDER's own
 * Strip, which also carries coordination.state:'PROPOSED' but stays in
 * its normal working Bay. Accepting/rejecting your own just-sent proposal
 * makes no sense, so this check is load-bearing, not decorative.
 */
function _isPendingCoordinationReplica(strip) {
  return !!(strip.coordination && strip.coordination.state === 'PROPOSED' && strip.bayId.endsWith('-coordination'));
}

/** A Strip may open a NEW coordination proposal only while it has no already-open one (server-enforced too — board-store.js's _applyCoordinationPropose). */
function _canProposeCoordination(strip) {
  if (strip.role !== 'ARRIVAL') return false;
  if (!COORDINATION_TARGETS[strip.ownerPositionId]) return false;
  if (!strip.coordination) return true;
  return strip.coordination.state === 'REJECTED'; // ACTIVE/PROPOSED are open links; REJECTED can be retried
}

function _dispatchCoordination(strip, primitive, action, note) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  if (action === 'PROPOSE') {
    const target = COORDINATION_TARGETS[strip.ownerPositionId];
    if (!target) return;
    sendEfspMutation(actingPositionId, strip, { kind: primitive, action: 'PROPOSE', toFacilityId: target.facilityId, toPositionId: target.positionId, note: note || undefined });
  } else {
    sendEfspMutation(actingPositionId, strip, { kind: primitive, action });
  }
}

const COORDINATION_PRIMITIVE_LABELS = {
  HANDOFF: 'Hand Off', POINT_OUT: 'Point Out', TRAFFIC: 'Traffic',
  OPERATIONAL_REQUEST: 'Operational Request', AIT: 'AIT',
};

let _openCoordinatePopoverEl = null;

function _closeCoordinatePopover() {
  if (!_openCoordinatePopoverEl) return;
  _openCoordinatePopoverEl.remove();
  _openCoordinatePopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseCoordinatePopover, true);
}

function _onDocPointerDownCloseCoordinatePopover(e) {
  if (_openCoordinatePopoverEl && !_openCoordinatePopoverEl.contains(e.target)) _closeCoordinatePopover();
}

/** Opens the primitive-choice popover — mirrors _openHighlightPopover's exact pattern (anchor, outside-click close, deferred listener). */
function _openCoordinatePopover(strip, anchorEl) {
  _closeCoordinatePopover();
  const fdr = getEfspFdr(strip.fdrId);
  const degraded = !!(fdr && fdr.identity && fdr.identity.trackDegradationFlag && fdr.identity.trackDegradationFlag !== 'NONE');

  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (degraded) {
    const warn = document.createElement('div');
    warn.className = 'efsp-coordinate-degraded-warning';
    warn.textContent = `Track degraded (${fdr.identity.trackDegradationFlag}) — verbal coordination required, note mandatory`;
    popover.appendChild(warn);
  }

  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const primitive of ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) {
    const opt = document.createElement('option');
    opt.value = primitive;
    opt.textContent = COORDINATION_PRIMITIVE_LABELS[primitive];
    select.appendChild(opt);
  }
  popover.appendChild(select);

  const note = document.createElement('textarea');
  note.className = 'efsp-coordinate-note';
  note.placeholder = degraded ? 'Verbal coordination note (required)' : 'Note (optional)';
  popover.appendChild(note);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (degraded && !note.value.trim()) {
      note.classList.add('efsp-coordinate-note-required');
      return;
    }
    _dispatchCoordination(strip, select.value, 'PROPOSE', note.value.trim());
    _closeCoordinatePopover();
  });
  popover.appendChild(sendBtn);

  anchorEl.appendChild(popover);
  _openCoordinatePopoverEl = popover;
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseCoordinatePopover, true), 0);
}

// The four paper gestures (guide §7.3, defect D4) — efsp-gestures.js's
// toggleOffset/toggleFlip/setHighlight/setAttention are pure and each
// already dispatch exactly one Mutation; this is the one shared plumbing
// point that resolves actingPositionId and hands them a bound
// sendMutation(strip, op), matching _invokeNla/_moveStrip/_transferStrip's
// own pattern. `extraArgs` covers setHighlight/setAttention's `color` param.
function _dispatchGesture(strip, gestureFn, ...extraArgs) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  gestureFn(strip, ...extraArgs, (s, op) => sendEfspMutation(actingPositionId, s, op));
}

// Small, fixed swatch set for Highlight (guide §7.3) — deliberately NOT
// red, which §7.7 rule 4 reserves for Attention alone ("reserve saturated
// colour for exceptions" — if both gestures could paint the same colour,
// a controller scanning the Board couldn't tell which one they're looking
// at). One click on a swatch is the ENTIRE interaction (setHighlight
// itself replaces a different active colour in one Mutation, and clears
// on a repeat click of the same colour — see efsp-gestures.test.js) so
// this satisfies the one-input cost ceiling even though it's a popover.
const HIGHLIGHT_SWATCHES = ['yellow', 'cyan', 'lime'];

let _openHighlightPopoverEl = null;

function _closeHighlightPopover() {
  if (!_openHighlightPopoverEl) return;
  _openHighlightPopoverEl.remove();
  _openHighlightPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseHighlightPopover, true);
}

function _onDocPointerDownCloseHighlightPopover(e) {
  if (_openHighlightPopoverEl && !_openHighlightPopoverEl.contains(e.target)) _closeHighlightPopover();
}

function _openHighlightPopover(strip, anchorEl) {
  _closeHighlightPopover();
  const popover = document.createElement('div');
  popover.className = 'efsp-highlight-popover';
  for (const color of HIGHLIGHT_SWATCHES) {
    const swatch = document.createElement('button');
    swatch.className = 'efsp-highlight-swatch';
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('pointerdown', (e) => e.stopPropagation());
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      _dispatchGesture(strip, setHighlight, color);
      _closeHighlightPopover();
    });
    popover.appendChild(swatch);
  }
  anchorEl.appendChild(popover);
  _openHighlightPopoverEl = popover;
  // Deferred so the contextmenu event that opened this doesn't immediately
  // close it via the same pointerdown-outside listener.
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseHighlightPopover, true), 0);
}

/** The first configured Bay for a Position — used as the transfer landing spot when the drop target is a Position tab rather than a specific Bay tab. Facility-config.js's Bay ordering intentionally puts each Position's "entry" Bay first (e.g. CD's Pending Clearance, GND's Pushback). */
function _defaultBayFor(positionId) {
  return getEfspBays().find(b => b.positionId === positionId) || null;
}

// ── Pointer Events drag ──────────────────────────────────────────────────
// Named _efspDrag, not _drag — app.js already declares a top-level `let
// _drag` for the map's label-offset dragging (map-setup.js), and every
// script here shares one global scope (no bundler, no modules). Reusing
// `_drag` would redeclare that `let` in a later-loaded script, which is a
// SyntaxError that kills the ENTIRE script it occurs in — this exact
// collision (with app.js) previously broke the whole renderer silently
// (app.js failed to parse, so initDock()/the WS connection never ran).

let _efspDrag = null; // { stripId, rackEl, rects, insertionEl, dragEl, lastClientY, dropTargetEl, hasMoved }

function _onStripPointerDown(e, strip) {
  // pointerdown fires (and bubbles) BEFORE click — a button/input inside
  // the Strip (the NLA button, future gesture buttons, an annotation
  // cell) would have its click hijacked into a drag-start every time,
  // even with stopPropagation() on the button's own click handler, since
  // the drag has already begun by the time click fires. Let interactive
  // children handle their own pointer events entirely.
  if (e.target.closest('button, input, textarea, select, [contenteditable]')) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const rackEl = e.currentTarget.closest('.efsp-rack');
  if (!rackEl) return;

  e.currentTarget.setPointerCapture(e.pointerId);

  const rects = [...rackEl.querySelectorAll('.efsp-strip')]
    .filter(el => el.dataset.stripId !== strip.stripId)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { stripId: el.dataset.stripId, top: r.top, height: r.height };
    });

  const insertionEl = document.createElement('div');
  insertionEl.className = 'efsp-insertion-line';
  insertionEl.style.display = 'none'; // hidden until real movement — see _onStripPointerMove
  rackEl.appendChild(insertionEl);

  // .efsp-strip-dragging (semi-transparent + position:fixed, §7.2.3) is
  // NOT applied here — deliberately deferred to _onStripPointerMove, only
  // once real movement crosses DRAG_THRESHOLD_PX. Applying it immediately
  // on pointerdown made even a plain click visually "pop" the Strip out of
  // the flow for an instant (position:fixed kicking in with no actual
  // drag), and a double-click — two independent pointerdown/pointerup
  // cycles — popped it twice in quick succession, which read as a glitch.

  _efspDrag = {
    strip, rackEl, rects, insertionEl, dragEl: e.currentTarget,
    startX: e.clientX, startY: e.clientY, lastClientY: e.clientY,
    dropTargetEl: null,
    hasMoved: false, // set true in _onStripPointerMove once movement exceeds DRAG_THRESHOLD_PX
  };

  e.currentTarget.addEventListener('pointermove', _onStripPointerMove);
  e.currentTarget.addEventListener('pointerup', _onStripPointerUp);
  e.currentTarget.addEventListener('pointercancel', _onStripPointerCancel);
}

// "Other Bays reachable through header drop zones that double as drag
// targets" (guide §4.2) — the always-visible Position/Bay tabs (rendered
// by efsp-panel.js, marked with data-efsp-drop-position/data-efsp-drop-bay)
// accept a drop as a cross-Position TransferStrip or cross-Bay MoveStrip.
// setPointerCapture (in _onStripPointerDown) means pointer events keep
// targeting the dragged Strip element even when the cursor is over a tab
// elsewhere in the panel — elementFromPoint is what actually finds what's
// visually underneath the cursor instead.
function _findDropTargetAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return el ? el.closest('[data-efsp-drop-position]') : null;
}

function _onStripPointerMove(e) {
  if (!_efspDrag) return;
  _efspDrag.lastClientY = e.clientY;
  const dy = e.clientY - _efspDrag.startY;

  if (!_efspDrag.hasMoved) {
    // A click with negligible movement must never commit a reorder or
    // transfer (a controller hit exactly this: clicking a newly-created
    // Strip relocated it to another Bay with no deliberate drag at all —
    // see strip-drag.js's hasExceededDragThreshold for the full reasoning).
    const dx = e.clientX - _efspDrag.startX;
    if (!hasExceededDragThreshold(dx, dy)) return; // still just a click so far — no visual drag feedback at all yet
    _efspDrag.hasMoved = true;
    _efspDrag.dragEl.classList.add('efsp-strip-dragging'); // semi-transparent while moving, §7.2.3 — see _onStripPointerDown's comment on why this is deferred to here
  }

  // transform-only movement (§7.2.4) — never top/left.
  _efspDrag.dragEl.style.transform = `translate3d(0, ${dy}px, 0)`;

  const dropTargetEl = _findDropTargetAt(e.clientX, e.clientY);
  if (dropTargetEl !== _efspDrag.dropTargetEl) {
    if (_efspDrag.dropTargetEl) _efspDrag.dropTargetEl.classList.remove('efsp-drop-target');
    if (dropTargetEl) dropTargetEl.classList.add('efsp-drop-target');
    _efspDrag.dropTargetEl = dropTargetEl;
  }

  if (dropTargetEl) {
    // Over a tab — hide the in-rack insertion line, the drop is going
    // somewhere else entirely.
    _efspDrag.insertionEl.style.display = 'none';
    return;
  }
  _efspDrag.insertionEl.style.display = '';

  const { index } = computeInsertionIndex(_efspDrag.rects, e.clientY);
  const before = index < _efspDrag.rects.length ? _efspDrag.rects[index] : null;
  const targetTop = before ? before.top : (_efspDrag.rects.length ? _efspDrag.rects[_efspDrag.rects.length - 1].top + _efspDrag.rects[_efspDrag.rects.length - 1].height : 0);
  _efspDrag.insertionEl.style.top = `${targetTop - _efspDrag.rackEl.getBoundingClientRect().top}px`;
}

function _finishDrag(commit) {
  if (!_efspDrag) return;
  const { strip, rackEl, rects, dragEl, insertionEl, lastClientY, dropTargetEl, hasMoved } = _efspDrag;
  dragEl.removeEventListener('pointermove', _onStripPointerMove);
  dragEl.removeEventListener('pointerup', _onStripPointerUp);
  dragEl.removeEventListener('pointercancel', _onStripPointerCancel);
  dragEl.classList.remove('efsp-strip-dragging');
  dragEl.style.transform = '';
  insertionEl.remove();
  if (dropTargetEl) dropTargetEl.classList.remove('efsp-drop-target');

  // hasMoved gates BOTH branches below — a click with no real movement
  // (DRAG_THRESHOLD_PX) commits nothing at all; the Strip's own separate
  // 'click' listener handles selection instead. Without this gate,
  // computeInsertionIndex() always resolves to SOME neighbor position
  // whenever the Rack has other Strips in it (it never itself reports "no
  // change"), so a plain click could silently reorder or relocate a Strip.
  if (commit && hasMoved && dropTargetEl) {
    const toPositionId = dropTargetEl.dataset.efspDropPosition;
    const explicitBayId = dropTargetEl.dataset.efspDropBay || null;
    if (toPositionId === strip.ownerPositionId && explicitBayId) {
      // Dropped on one of your OWN Bay tabs — same-owner relocation, no handoff.
      _moveStrip(strip, explicitBayId, _defaultRackFor(explicitBayId), null, null);
    } else if (toPositionId && toPositionId !== strip.ownerPositionId) {
      const targetBay = explicitBayId ? { bayId: explicitBayId, rackIds: [_defaultRackFor(explicitBayId)] } : _defaultBayFor(toPositionId);
      if (targetBay) _transferStrip(strip, toPositionId, targetBay.bayId, targetBay.rackIds[0]);
    }
  } else if (commit && hasMoved && !rackEl.dataset.bayId.endsWith('-search')) {
    // Use the last known pointer Y directly, captured on every pointermove
    // above — NOT parsed back out of the CSS transform string, which is
    // already cleared by the time we'd read it here.
    const { afterStripId, beforeStripId } = computeInsertionIndex(rects, lastClientY);
    const bayId = rackEl.dataset.bayId;
    const rackId = rackEl.dataset.rackId;
    if (bayId !== strip.bayId || rackId !== strip.rackId || afterStripId !== null || beforeStripId !== null) {
      _moveStrip(strip, bayId, rackId, afterStripId, beforeStripId);
    }
  }
  // A drop back inside the search pseudo-Bay itself (no dropTargetEl, and
  // the source rack IS the search Rack) is deliberately a no-op — there is
  // nothing to reorder in a synthetic Rack that doesn't exist server-side
  // (guide §4.3). Dropping a search-result Strip onto a REAL Position/Bay
  // tab still works fully — that's the `dropTargetEl` branch above, keyed
  // off the destination, not the source Rack.
  _efspDrag = null;
  renderAllOpenEfspBays();
}

function _defaultRackFor(bayId) {
  const bay = getEfspBays().find(b => b.bayId === bayId);
  return bay ? bay.rackIds[0] : 'main';
}

function _onStripPointerUp() { _finishDrag(true); }
function _onStripPointerCancel() { _finishDrag(false); }

// ── Bay/Rack rendering ───────────────────────────────────────────────────
// renderBay() takes an ELEMENT reference, not an id string — no
// document.getElementById() here on purpose. The container element is
// cached once by efsp-panel.js's initEfspPanel() and passed through; a
// fresh id lookup would fail whenever the panel isn't the active tab in
// its dockview group (dockview detaches inactive tabs' DOM from
// `document` — see efsp-panel.js's module comment for the full story of
// the bug this caused).
//
// Keyed reconciliation, not destroy-and-rebuild (§7.5.4, §4.8.5 rule 3,
// defect D6) — this fires on every incoming Board delta from ANY connected
// client (via renderAllOpenEfspBays()'s rAF batching below), not just on a
// local action, so a naive full rebuild here would silently discard an
// in-progress drag or an open annotation/Block edit belonging to THIS
// controller every time any OTHER controller's Mutation broadcasts.
// computeRackReconciliation() (strip-drag.js) makes the remove/rebuild
// decision; this function walks it and does the actual DOM surgery.

function renderBay(container, bayId) {
  if (!container) return;
  // The search pseudo-Bay (guide §4.3) is client-local — efsp-panel.js
  // synthesizes it, it's never in getEfspBays()'s server-driven list, so
  // it needs its own lookup instead of falling through to "unknown bayId,
  // clear the container".
  const bay = bayId.endsWith('-search')
    ? { bayId, rackIds: ['results'] }
    : getEfspBays().find(b => b.bayId === bayId);
  if (!bay) { container.innerHTML = ''; return; }

  const scrollTop = container.scrollTop;
  const activeStripEl = document.activeElement ? document.activeElement.closest('.efsp-strip') : null;
  const focusedStripId = activeStripEl && container.contains(activeStripEl) ? activeStripEl.dataset.stripId : null;

  // Keyed by rackId ALONE would be wrong: multiple Bays share the literal
  // Rack id "main" (e.g. OPS's ops-filed AND ops-proposed both use
  // rackIds:['main']). A leftover Rack element from whichever Bay was
  // rendered into this container before still passes "rackId is in
  // bay.rackIds" and would get silently REUSED for the new Bay — with its
  // dataset.bayId never updated, since only _buildRackShell sets it, only
  // on creation. That's a real bug that shipped: switching from ops-filed
  // to ops-proposed reused ops-filed's stale "main" Rack element, so every
  // drag inside the (correctly strip-populated, but wrongly bay-tagged)
  // Rack silently targeted ops-filed regardless of drag direction. Keying
  // — and clearing — by the (bayId, rackId) PAIR is what actually fixes it.
  const existingRackEls = new Map();
  for (const el of [...container.children]) {
    if (el.dataset.bayId === bayId && bay.rackIds.includes(el.dataset.rackId)) {
      existingRackEls.set(el.dataset.rackId, el);
    } else {
      el.remove(); // a different Bay's leftover Rack (or a Rack no longer in this Bay's rackIds)
    }
  }
  for (const rackId of bay.rackIds) {
    let rackEl = existingRackEls.get(rackId);
    if (!rackEl) {
      rackEl = _buildRackShell(bayId, rackId);
      container.appendChild(rackEl);
    }
    _reconcileRackStrips(rackEl, bayId, rackId);
  }

  container.scrollTop = scrollTop;
  if (focusedStripId) {
    // Re-focus by Strip ID, never DOM index (guide §7.8 rule 3) — a
    // reconciled/rebuilt element is a different node than the one that had
    // focus before this call.
    const el = container.querySelector(`.efsp-strip[data-strip-id="${CSS.escape(focusedStripId)}"]`);
    if (el) el.focus();
  }
}

function _buildRackShell(bayId, rackId) {
  const rackEl = document.createElement('div');
  rackEl.className = 'efsp-rack';
  rackEl.dataset.bayId = bayId;
  rackEl.dataset.rackId = rackId;
  rackEl.setAttribute('role', 'list');

  const header = document.createElement('div');
  header.className = 'efsp-rack-header';
  header.textContent = rackId;
  header.addEventListener('click', () => _onRackHeaderClick(bayId, rackId));
  rackEl.appendChild(header);

  return rackEl;
}

/** A Strip element is protected from removal/rebuild while it's mid-drag, has an open Block edit, or has its Highlight popover open — reconciling around it (never through it) is what actually fixes defect D6 here. */
function _isProtectedStripEl(el) {
  if (_efspDrag && _efspDrag.strip.stripId === el.dataset.stripId) return true;
  if (el.querySelector('.efsp-block-input')) return true;
  if (_openHighlightPopoverEl && el.contains(_openHighlightPopoverEl)) return true;
  if (_openCoordinatePopoverEl && el.contains(_openCoordinatePopoverEl)) return true;
  return false;
}

function _reconcileRackStrips(rackEl, bayId, rackId) {
  const wanted = bayId.endsWith('-search') ? searchEfspStrips(getActiveEfspSearchQuery()) : getEfspRack(bayId, rackId);
  const wantedById = new Map(wanted.map(s => [s.stripId, s]));
  const existingEls = new Map(
    [...rackEl.children].filter(el => el.classList.contains('efsp-strip')).map(el => [el.dataset.stripId, el])
  );

  const protectedIds = new Set([...existingEls].filter(([, el]) => _isProtectedStripEl(el)).map(([id]) => id));
  const dirtyIds = new Set(
    [...existingEls]
      .filter(([id, el]) => {
        const w = wantedById.get(id);
        if (!w) return false; // no longer wanted — toRemove handles it, not a rebuild
        const revChanged = el.dataset.rev !== String(w.rev);
        const selectionChanged = el.classList.contains('efsp-strip-selected') !== (id === _selectedStripId);
        return revChanged || selectionChanged;
      })
      .map(([id]) => id)
  );

  const { toRemove, order } = computeRackReconciliation(
    [...existingEls.keys()], wanted.map(s => s.stripId), dirtyIds, protectedIds,
  );

  for (const stripId of toRemove) {
    existingEls.get(stripId).remove();
    existingEls.delete(stripId);
  }

  let cursor = rackEl.firstElementChild.nextSibling; // first element after the header, or null
  for (const { stripId, rebuild } of order) {
    if (protectedIds.has(stripId)) continue; // never move OR rebuild — leave it exactly where it is; it reconciles on a later render once unprotected

    let el = existingEls.get(stripId);
    if (!el) {
      const fresh = _buildStripEl(wantedById.get(stripId));
      rackEl.insertBefore(fresh, cursor);
      existingEls.set(stripId, fresh);
      cursor = fresh.nextSibling; // unchanged in practice — fresh was inserted right before the old cursor
      continue;
    }
    if (rebuild) {
      // If `el` (about to be replaced) IS the current cursor, replaceWith()
      // is about to detach the exact node `cursor` points to — capture a
      // stable successor FIRST. Skipping this is what caused a live
      // "Failed to execute 'insertBefore': the node before which the new
      // node is to be inserted is not a child of this node" crash on
      // every ordinary rebuild (an offset toggle, any Mutation ack): cursor
      // kept referencing the now-detached old element, and the very next
      // insertBefore(el, cursor) call below failed because that node was
      // no longer attached to rackEl at all.
      if (el === cursor) cursor = el.nextSibling;
      const fresh = _buildStripEl(wantedById.get(stripId));
      el.replaceWith(fresh);
      el = fresh;
      existingEls.set(stripId, el);
    }
    if (el !== cursor) rackEl.insertBefore(el, cursor);
    cursor = el.nextSibling;
  }
}

// rAF-batched multi-Bay re-render (§7.5.3) — coalesces bursts of Board
// deltas into one paint rather than one per incoming message.
let _renderScheduled = false;
let _openBayContainers = []; // [{containerEl, bayId}] — element references, not ids; set by efsp-panel.js as the user switches Bay tabs

function setOpenEfspBays(containers) { _openBayContainers = containers; }

function renderAllOpenEfspBays() {
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => {
    _renderScheduled = false;
    for (const { containerEl, bayId } of _openBayContainers) renderBay(containerEl, bayId);
  });
}
