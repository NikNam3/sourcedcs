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

  // WP4A gap-closure (docs/adr/0022) — restricted-enum Blocks (airspace
  // ownership, track-degradation flag) get a <select>, never the generic
  // free-text click-to-edit path below — this is the first UI either field
  // has ever had (both had a working server-side setter and zero way to
  // reach it). Checked before isBlockEditable() since these Blocks are
  // deliberately excluded from that generic path (see strip-template.js's
  // isBlockEditable comment).
  const enumOptions = enumSelectOptionsFor(blockId);
  if (enumOptions) return _buildEnumSelectCell(strip, blockId, span, enumOptions);

  // WP4A second slice — IFR (a boolean, not a restricted-value string enum)
  // gets a click-to-toggle affordance instead, same "checked before
  // isBlockEditable()" reasoning as the enum-<select> case above.
  if (isBooleanToggleBlock(blockId)) return _buildBooleanToggleCell(strip, blockId, span);

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
      // The LIVE Strip for its rev, not the one this cell's DOM was built
      // against — the same stale-baseRev fix _startBlockEdit and
      // _buildEnumSelectCell already carry. Without it, striking a vacated
      // altitude straight after any other edit to the same Strip comes back
      // STALE_REV for no reason a controller could see.
      sendEfspMutation(actingPositionId, getEfspStrip(strip.stripId) || strip, { kind: 'SetBlock', blockId, confirmVacated: true });
    });
    wrapper.appendChild(strikeBtn);
    return wrapper;
  }

  return span;
}

/**
 * WP4A gap-closure (docs/adr/0022) — a click-to-reveal <select> for a
 * restricted-enum Block (airspace ownership, track-degradation flag).
 * Mirrors _buildBlockCell's click-to-edit shape (span -> input swap) but
 * with a fixed option list instead of free text, so an invalid value is
 * structurally unreachable from the UI, not just server-rejected.
 */
function _buildEnumSelectCell(strip, blockId, span, options) {
  span.classList.add('efsp-block-editable', 'efsp-block-enum');
  span.tabIndex = 0;
  const open = (e) => {
    e.stopPropagation();
    const select = document.createElement('select');
    select.className = 'efsp-block-input efsp-block-enum-select';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '—';
    select.appendChild(blank);
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    }
    select.value = span.textContent || '';
    // Removing a focused element from the DOM fires 'blur' on it — so
    // select.replaceWith(span) inside the 'change' handler below ALWAYS
    // triggers the 'blur' listener's revert() right after, which then tried
    // to replaceWith() an already-detached `select` a second time and threw
    // ("the node to be removed is no longer a child of this node"). Guard
    // both paths with a single-fire flag instead of relying on either one
    // running at most once on its own.
    let closed = false;
    const revert = () => { if (closed) return; closed = true; select.replaceWith(span); };
    select.addEventListener('change', () => {
      if (closed) return;
      closed = true;
      const value = select.value;
      select.replaceWith(span);
      if (!value || value === span.textContent) return;
      const actingPositionId = _resolveActingPositionId(strip);
      if (!actingPositionId) return;
      const currentStrip = getEfspStrip(strip.stripId) || strip;
      sendEfspMutation(actingPositionId, currentStrip, { kind: 'SetBlock', blockId, value });
    });
    select.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); revert(); } });
    select.addEventListener('blur', revert);
    select.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    span.replaceWith(select);
    select.focus();
  };
  span.addEventListener('click', open);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  span.addEventListener('pointerdown', (e) => e.stopPropagation());
  return span;
}

/**
 * WP4A second slice — a click-to-toggle boolean affordance for IFR
 * (guide §4.6.3's ifr_active). Simpler than _buildEnumSelectCell's
 * span<->select swap since there's no third value to pick from: a click
 * just sends the flipped value directly, reusing the existing ✓/blank
 * boolean-render convention (_blockLabel) for display.
 */
function _buildBooleanToggleCell(strip, blockId, span) {
  span.classList.add('efsp-block-editable', 'efsp-block-toggle');
  span.tabIndex = 0;
  const toggle = (e) => {
    e.stopPropagation();
    const actingPositionId = _resolveActingPositionId(strip);
    if (!actingPositionId) return;
    const currentStrip = getEfspStrip(strip.stripId) || strip;
    const currentValue = span.textContent === '✓';
    sendEfspMutation(actingPositionId, currentStrip, { kind: 'SetBlock', blockId, value: !currentValue });
  };
  span.addEventListener('click', toggle);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  span.addEventListener('pointerdown', (e) => e.stopPropagation());
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
    const actingPositionId = _resolveActingPositionId(strip);
    if (!actingPositionId) return;
    // Read the CURRENT Strip (for its rev) rather than the `strip` this
    // cell's DOM was built against — editing two different Blocks on the
    // same Strip back-to-back (e.g. 3A then 3B) otherwise sends the second
    // edit's baseRev from a snapshot the first edit's own ack had already
    // moved past, and it comes back rejected as STALE_REV even though
    // nothing else touched the Strip in between.
    const currentStrip = getEfspStrip(strip.stripId) || strip;
    sendEfspMutation(actingPositionId, currentStrip, { kind: 'SetBlock', blockId, value });
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

// Two presses, not one, and not a modal. Dropping is the one Strip action with
// no Undo outside the terminal NLA's 30s window (§3.5 rule 5 covers that path,
// not this one), so it needs a speed bump — but the §3.6 duplicate-origination
// warning already established two-press as this panel's shape for "are you
// sure", and a second shape for the same question would be worse than none.
let _pendingDropStripId = null;
let _dropDisarmTimer = null;
const DROP_ARM_MS = 5000;

/**
 * Is `DropStrip` worth offering on this Strip?
 *
 * The gap this closes: `DropStrip` has never been state-gated server-side and
 * OPS has always held the permission, so an OPS controller who proposed the
 * wrong Strip could always drop it — but the ONLY way to ask was the `.drop`
 * dot-command. The NLA button reads "Send to Clearance" at PROPOSED; "Drop" is
 * every Role's TERMINAL transition and appears nowhere else. So a fully
 * implemented, permitted operation had no affordance at all.
 *
 * Invisible to efsp-ui-reachability.test.js because that test holds every
 * writable BLOCK to being reachable and says nothing about OPS — the same
 * blind spot that hid the boolean-toggle Blocks, one level up.
 *
 * Deliberately NOT rendered when:
 *  - the terminal NLA already says "Drop" — one question, one control.
 *  - an exchange is open or live on this Strip. board-store refuses those
 *    (`_applyDropStrip`'s two guards, and `_retireStrip`'s ACTIVE-TOFI
 *    refusal), and a control that always fails is worse than no control —
 *    the rule _marsaCandidates already follows.
 */
function _canDropStrip(strip) {
  if (!_resolveActingPositionId(strip)) return false;
  if (strip.state === 'DROPPED') return false;
  if (nlaLabelFor(strip.state, strip.role) === 'Drop') return false;
  const co = strip.coordination;
  if (co && co.state === 'PROPOSED') return false;
  const tofi = strip.tofiCoordination;
  if (tofi && (tofi.state === 'PROPOSED' || tofi.state === 'ACTIVE')) return false;
  return true;
}

function _appendDropButton(el, strip) {
  if (!_canDropStrip(strip)) return;
  const armed = _pendingDropStripId === strip.stripId;
  const btn = document.createElement('button');
  btn.className = 'efsp-drop-btn' + (armed ? ' efsp-drop-btn-armed' : '');
  btn.textContent = armed ? 'Drop?' : '✕';
  btn.title = armed
    ? 'press again to drop this Strip — this cannot be undone'
    : 'Drop this Strip (e.g. proposed in error)';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const actingPositionId = _resolveActingPositionId(strip);
    if (!actingPositionId) return;
    if (_pendingDropStripId !== strip.stripId) {
      // Arm IN PLACE rather than re-rendering the Bay: the label has to say
      // what the next press does, and rebuilding every Strip to change one
      // word would also throw away any open annotation cell on the Board.
      _pendingDropStripId = strip.stripId;
      btn.textContent = 'Drop?';
      btn.title = 'press again to drop this Strip — this cannot be undone';
      btn.classList.add('efsp-drop-btn-armed');
      // Disarms itself. An armed control left sitting on the Board is a trap
      // for the next person to click it, and a Strip is not reliably
      // re-rendered on any particular schedule.
      clearTimeout(_dropDisarmTimer);
      _dropDisarmTimer = setTimeout(() => {
        if (_pendingDropStripId !== strip.stripId) return;
        _pendingDropStripId = null;
        btn.textContent = '✕';
        btn.title = 'Drop this Strip (e.g. proposed in error)';
        btn.classList.remove('efsp-drop-btn-armed');
      }, DROP_ARM_MS);
      return;
    }
    clearTimeout(_dropDisarmTimer);
    _pendingDropStripId = null;
    sendEfspMutation(actingPositionId, getEfspStrip(strip.stripId) || strip, { kind: 'DropStrip', reason: 'dropped from the Strip' });
  });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.appendChild(btn);
}

// How many superseded entries a COMPACT chip shows before it gives up and
// points at the expanded view. §3.7 rule 2 wants the superseded value in the
// same Block, but history is append-only for the life of the Strip, so a
// much-amended altitude would grow a chip without limit. Two, then the
// overflow indicator the rule itself prescribes.
const CHIP_HISTORY_LIMIT = 2;

/**
 * Renders §3.7's struck-through history into `container`, oldest first, above
 * whatever current value the caller appends after it.
 *
 * This is the half of §3.7 that has never existed on screen. The server has
 * kept, persisted and broadcast every superseded entry since Phase 1;
 * resolveBlockValue collapsed each cell to its one ACTIVE entry and the rest
 * was thrown away by the renderer. Rule 2:
 *
 *   "A superseded value MUST remain visible in the same Block, rendered
 *    struck through, until the Strip is DROPPED. Where space does not permit,
 *    the Block MUST render an overflow indicator and expose full history on
 *    tap — modelled on ATOP's `*` convention."
 *
 * `limit` is Infinity in the expanded view and CHIP_HISTORY_LIMIT on a chip.
 *
 * Renders NOTHING when there is no prior entry — the common case is a Block
 * written once or never, and it must not sprout an empty container.
 */
function _appendAnnotationHistory(container, strip, blockId, limit) {
  if (typeof supersededAnnotationEntries !== 'function') return;
  const prior = supersededAnnotationEntries(strip, blockId);
  if (prior.length === 0) return;

  const shown = Number.isFinite(limit) && prior.length > limit ? prior.slice(-limit) : prior;
  const hidden = prior.length - shown.length;

  const history = document.createElement('span');
  history.className = 'efsp-annotation-history';

  if (hidden > 0) {
    // ATOP's own convention for state the strip cannot render. Clicking it
    // opens the expanded view, which is the "full history on tap" the rule
    // requires — the indicator is only legal because that surface exists.
    const overflow = document.createElement('button');
    overflow.className = 'efsp-annotation-overflow';
    overflow.textContent = '*';
    overflow.title = `${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'} — open the full history`;
    overflow.addEventListener('click', (e) => {
      e.stopPropagation();
      _expandedStripId = strip.stripId;
      renderAllOpenEfspBays();
    });
    overflow.addEventListener('pointerdown', (e) => e.stopPropagation());
    history.appendChild(overflow);
  }

  for (const entry of shown) {
    const span = document.createElement('span');
    // PREPLANNED gets its own muted state rather than being lumped in with
    // SUPERSEDED: it is a distinct status the server can produce, and nothing
    // has ever shown it.
    const suffix = entry.status === 'STRUCK' ? 'struck'
      : entry.status === 'PREPLANNED' ? 'preplanned'
        : 'superseded';
    span.className = 'efsp-annotation-entry efsp-annotation-entry-' + suffix;
    span.textContent = entry.value == null ? '' : String(entry.value);
    span.title = `${entry.status.toLowerCase()}${entry.by ? ' by ' + entry.by : ''}`;
    history.appendChild(span);
  }
  container.appendChild(history);
}

// ONE Strip expanded at a time, and a single id rather than a Set.
//
// DEPARTURE's Block Map is ~30 entries. Several Strips expanded at once means
// 30 x N rows rebuilt on every board delta, in a panel whose rendering rules
// exist to keep Bays cheap — a plausible candidate for the first thing that
// makes the board feel slow. Bounded by construction rather than by hoping.
// It also matches the "detail view" mental model and removes any need for a
// collapse-on-delta special case.
//
// Keyed by stripId, not by DOM state, so expansion SURVIVES a re-render —
// board deltas rebuild Strips constantly. Deliberately not the popover
// pattern: a popover has to be added to _isProtectedStripEl or a remote delta
// destroys it mid-interaction, and this has no such requirement.
let _expandedStripId = null;

function _appendExpandButton(container, strip) {
  const expanded = _expandedStripId === strip.stripId;
  const btn = document.createElement('button');
  btn.className = 'efsp-expand-btn';
  btn.textContent = expanded ? '\u25b2' : '\u25bc';
  btn.title = expanded ? 'Collapse' : 'Show every Block for this Strip';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _expandedStripId = expanded ? null : strip.stripId;
    renderAllOpenEfspBays();
  });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  container.appendChild(btn);
}

/**
 * Every Block for this Strip's Role, with its full §3.7 history.
 *
 * The surface `DELIBERATELY_NOT_IN_COMPACT_VIEW` has been promising since it
 * was written: its entries said "annotation editor" for a thing that did not
 * exist, so a fully implemented, guide-required Block could be excused from
 * the reachability test and reachable from nowhere.
 *
 * Rendered in BLOCK MAP ORDER, deliberately rather than by default: that is
 * the order of the paper strip and of the guide's own §6.2/§6.3 tables, so it
 * is learnable and stable — unlike any ordering derived from a property that
 * changes as the Strip is worked.
 *
 * The editable cell is _buildBlockCell unchanged, so free text, the enum
 * <select>, the boolean toggle and the confirmVacated button all arrive with
 * their Enter-commits / Esc-reverts / never-on-blur contract intact rather
 * than being reimplemented in a second surface.
 */
function _appendExpandedView(el, strip) {
  if (_expandedStripId !== strip.stripId) return;
  const map = (typeof BLOCK_MAPS === 'object' && BLOCK_MAPS[strip.role]) || null;
  if (!map) return;

  const panel = document.createElement('div');
  panel.className = 'efsp-strip-expanded';

  for (const blockId of Object.keys(map)) {
    const row = document.createElement('div');
    row.className = 'efsp-expanded-row';
    row.dataset.expandedBlock = blockId;

    const label = document.createElement('span');
    label.className = 'efsp-expanded-label';
    label.textContent = blockLabelFor(blockId, strip.role) || blockId;
    row.appendChild(label);

    const value = document.createElement('span');
    value.className = 'efsp-expanded-value';
    // The whole chain here, unbounded — this is the "expose full history on
    // tap" half of §3.7 rule 2, and it is what makes capping the chip legal.
    _appendAnnotationHistory(value, strip, blockId, Infinity);
    value.appendChild(_buildBlockCell(strip, blockId));
    row.appendChild(value);

    panel.appendChild(row);
  }
  el.appendChild(panel);
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
    // '5A'/'24A' (docs/adr/0022) — track-degradation flag and airspace
    // ownership, both newly-editable enum Blocks; included so they're
    // actually reachable somewhere in the compact view, not just present
    // in the Block Map with no render path (the bug this closes).
    // '3A'-'3E' (docs/adr/0023) — aircraft type/wake category/tail number/
    // unit/home station: all five were already validated and writable
    // server-side but had no Block anywhere routing a SetBlock at them,
    // found live when "Spawn Return Strip" had nothing to actually copy.
    // WP4A second slice — MISSION's fields (mission number/package/beacon/
    // vul window) are structurally different from the callsign-runway-taxi
    // shape every other role shares, so it gets its own compact-view list
    // (the first role-conditional branch this array has ever needed —
    // strip-template.js's MISSION_BLOCK_MAP uses an entirely M-prefixed
    // namespace, none of which exists in the shared list below).
    const blocks = compactBlocksFor(strip.role);
    // docs/adr/0024 — a small muted label stacked above each Block's value so
    // a bare '0001'/'LTAG' isn't left to memory. Wrapping happens HERE, at
    // the call site, rather than inside _buildBlockCell itself, so its
    // click-to-edit/enum-<select> internals need zero changes.
    for (const id of blocks) {
      const chip = document.createElement('span');
      chip.className = 'efsp-block-chip';
      const label = blockLabelFor(id, strip.role);
      if (label) {
        const labelEl = document.createElement('span');
        labelEl.className = 'efsp-block-label';
        labelEl.textContent = label;
        chip.appendChild(labelEl);
      }
      // §3.7 rule 2's "in the same Block", not one click away in the
      // expanded view — bounded, with the overflow indicator the rule itself
      // prescribes once it stops fitting.
      _appendAnnotationHistory(chip, strip, id, CHIP_HISTORY_LIMIT);
      chip.appendChild(_buildBlockCell(strip, id));
      el.appendChild(chip);
    }

    // Every trailing control lives on its OWN final row (`flex-basis: 100%`,
    // the idiom the badges already use), rather than floating to wherever the
    // chips happen to stop wrapping.
    //
    // This is load-bearing, not tidiness. `.efsp-nla-btn { margin-left: auto }`
    // on a wrapping flex container puts the NLA button on whichever row it
    // lands on — which differs between Strips in the SAME Bay, depending on
    // callsign length and which optional Blocks are populated. NLA is the
    // primary affordance: one input, double-tap guarded, reached for without
    // looking. Making its position a function of chip count would have made
    // adding chips a net loss.
    const actions = document.createElement('div');
    actions.className = 'efsp-strip-actions';

    // Offset (guide §7.3) — one input, a dedicated button so it's reachable
    // from keyboard/touch per §7.1 rule 4, not just a drag/dblclick gesture.
    const offsetBtn = document.createElement('button');
    offsetBtn.className = 'efsp-offset-btn';
    offsetBtn.title = 'Offset (cock)';
    offsetBtn.textContent = '⇥';
    offsetBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchGesture(strip, toggleOffset); });
    actions.appendChild(offsetBtn);

    _appendExpandButton(actions, strip);
    _appendDropButton(actions, strip);

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
      // docs/adr/0022 bug fix — server-authoritative, this is the
      // proactive half: an open (PROPOSED) coordination link means a peer
      // Facility is waiting on this Strip, so its own NLA (Drop, for a
      // DEPARTURE Strip at HANDED_OFF) must not look pressable — dropping
      // out from under an open proposal orphaned the receiver's replica.
      const hasOpenCoordination = (strip.coordination && strip.coordination.state === 'PROPOSED')
        || (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED');
      // A terminal NLA IS a Drop (every Role's last step is labelled that),
      // and guide §4.6.3 rule 2 forbids dropping a Strip under live tactical
      // control on either side of the exchange. The server enforces this on
      // the shared retire path; this is the proactive half, so the button
      // doesn't look pressable. Deliberately narrowed to the terminal step —
      // a MISSION Strip's own lifecycle advances freely during an ACTIVE
      // exchange (docs/adr/0026), it just cannot END during one.
      const isTerminalDrop = nlaLabel === 'Drop';
      const underTacticalControl = strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE';
      if (!canActOnState(strip.ownerPositionId, strip.role, strip.state)) {
        btn.disabled = true;
        btn.classList.add('efsp-nla-btn-denied');
        btn.title = `${strip.state} is not ${strip.ownerPositionId}'s to advance`;
      } else if (hasOpenCoordination) {
        btn.disabled = true;
        btn.classList.add('efsp-nla-btn-denied');
        btn.title = 'a coordination proposal is still open on this Strip — accept, reject, or wait for a response first';
      } else if (isTerminalDrop && underTacticalControl) {
        btn.disabled = true;
        btn.classList.add('efsp-nla-btn-denied');
        btn.title = 'this Strip is under active tactical control — complete a TOFI exit first';
      } else {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          _invokeNla(strip);
        });
      }
      actions.appendChild(btn);
    }
    el.appendChild(actions);

    // ── WP4A coordination affordances ────────────────────────────────
    if (_isPendingCoordinationReplica(strip)) {
      // This Strip IS a proposal awaiting response — accept/reject
      // REPLACE the normal NLA slot conceptually (there is no ordinary
      // NLA for a Strip still sitting in a Coordination Bay), rendered
      // alongside whatever (if anything) nlaLabelFor returned above.
      //
      // OPERATIONAL_REQUEST gets a 3-way response (guide §4.6: APPROVED/
      // UNABLE/STAND BY, docs/adr/0022) — ACCEPT/REJECT already carry that
      // meaning for it (coordination.js's acceptPhrase:'APPROVED'), so only
      // the label and the extra Stand By button differ; every other
      // primitive keeps its original 2-button Accept/Reject wording.
      const isOpsRequest = strip.coordination.primitive === 'OPERATIONAL_REQUEST';
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'efsp-coordinate-accept-btn';
      acceptBtn.textContent = isOpsRequest ? 'Approve' : `Accept ${COORDINATION_PRIMITIVE_LABELS[strip.coordination.primitive] || strip.coordination.primitive}`;
      acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchCoordination(strip, strip.coordination.primitive, 'ACCEPT'); });
      el.appendChild(acceptBtn);

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'efsp-coordinate-reject-btn';
      rejectBtn.textContent = isOpsRequest ? 'Unable' : 'Reject';
      rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchCoordination(strip, strip.coordination.primitive, 'REJECT'); });
      el.appendChild(rejectBtn);

      if (isOpsRequest) {
        const standByBtn = document.createElement('button');
        standByBtn.className = 'efsp-coordinate-standby-btn';
        standByBtn.textContent = 'Stand By';
        standByBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchCoordination(strip, strip.coordination.primitive, 'STAND_BY'); });
        el.appendChild(standByBtn);
      }
    } else if (_canProposeCoordination(strip)) {
      const coordBtn = document.createElement('button');
      coordBtn.className = 'efsp-coordinate-btn';
      coordBtn.textContent = 'Coordinate…';
      coordBtn.title = `Propose a cross-Facility coordination to ${COORDINATION_TARGETS[strip.ownerPositionId].positionId}`;
      coordBtn.addEventListener('click', (e) => { e.stopPropagation(); _openCoordinatePopover(strip, el); });
      el.appendChild(coordBtn);
    }

    // ── WP4A second slice: TOFI affordances (guide §4.6.3) ──────────────
    if (_isPendingTofiReplica(strip)) {
      // Always the MISSION-side Strip — the receiving MRU controller's own
      // record, for both ENTRY and EXIT (mirrors board-store.js's side
      // split exactly).
      const label = strip.tofiCoordination.direction === 'EXIT' ? 'Exit' : 'Entry';
      const tofiAcceptBtn = document.createElement('button');
      tofiAcceptBtn.className = 'efsp-coordinate-accept-btn';
      tofiAcceptBtn.textContent = `Accept TOFI ${label}`;
      // Guide rule 3 — exit is the safety-critical direction, so the server
      // refuses ACCEPT until separation_regime is back to ATC. Surfaced here
      // because the MRU controller cannot fix it themselves: SREG lives on
      // the ATC-side Strip only (MISSION_BLOCK_MAP has no such Block), so
      // without being told what is missing they are left guessing at a
      // generic rejection for something only the other controller can do.
      const fdr = getEfspFdr(strip.fdrId);
      const exitBlocked = strip.tofiCoordination.direction === 'EXIT'
        && !(fdr && fdr.tofi && fdr.tofi.separationRegime === 'ATC');
      if (exitBlocked) {
        tofiAcceptBtn.disabled = true;
        tofiAcceptBtn.classList.add('efsp-nla-btn-denied');
        tofiAcceptBtn.title = `${strip.tofiCoordination.peerPositionId} must set separation regime back to ATC before this exit can be accepted`;
      } else if (strip.tofiCoordination.direction === 'ENTRY') {
        // ENTRY needs the regime stated as part of accepting (docs/adr/0053),
        // so this is a picker rather than a bare button — the MRU controller
        // says what they heard agreed, and the accept carries it. A <select>
        // beside the button rather than a popover: it is one field, and the
        // whole affordance is already a pair of buttons on the Strip.
        const regimeSel = document.createElement('select');
        regimeSel.className = 'efsp-tofi-regime-select';
        regimeSel.title = 'under which regime is the MRU taking this aircraft (§4.6.3)';
        for (const value of TOFI_ACCEPT_REGIMES) {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = value;
          regimeSel.appendChild(opt);
        }
        regimeSel.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.appendChild(regimeSel);
        tofiAcceptBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _dispatchTofi(strip, 'ACCEPT', undefined, { separationRegime: regimeSel.value });
        });
      } else {
        tofiAcceptBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchTofi(strip, 'ACCEPT'); });
      }
      el.appendChild(tofiAcceptBtn);

      const tofiRejectBtn = document.createElement('button');
      tofiRejectBtn.className = 'efsp-coordinate-reject-btn';
      tofiRejectBtn.textContent = 'Reject';
      tofiRejectBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchTofi(strip, 'REJECT'); });
      el.appendChild(tofiRejectBtn);
    } else if (_canProposeTofiExit(strip)) {
      // EXIT's target is already known (tofiCoordination.peerFacilityId/
      // peerPositionId) — no picker needed, unlike ENTRY.
      const tofiExitBtn = document.createElement('button');
      tofiExitBtn.className = 'efsp-coordinate-btn';
      tofiExitBtn.textContent = 'TOFI Exit…';
      tofiExitBtn.title = `Propose returning separation to ${strip.tofiCoordination.peerPositionId}`;
      tofiExitBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchTofi(strip, 'PROPOSE', 'EXIT'); });
      el.appendChild(tofiExitBtn);
    } else if (_canProposeTofiEntry(strip)) {
      const counterparts = TOFI_COUNTERPARTS[strip.ownerPositionId];
      const tofiEntryBtn = document.createElement('button');
      tofiEntryBtn.className = 'efsp-coordinate-btn';
      tofiEntryBtn.textContent = 'TOFI…';
      tofiEntryBtn.title = 'Propose a Transfer of Flight Information to a Military Radar Unit';
      tofiEntryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Single-candidate case (TAC_C2/GCI -> CTR) skips the picker
        // entirely — behaves like today's deterministic COORDINATION_TARGETS
        // stub. CTR's 2-candidate case always opens the popover.
        if (counterparts.length === 1) _dispatchTofi(strip, 'PROPOSE', 'ENTRY', { target: counterparts[0] });
        else _openTofiEntryPopover(strip, el, counterparts);
      });
      el.appendChild(tofiEntryBtn);
    }

    if (_canTransferTofiComms(strip)) {
      const commsBtn = document.createElement('button');
      commsBtn.className = 'efsp-coordinate-btn efsp-tofi-transfer-comms-btn';
      commsBtn.textContent = 'Transfer Comms';
      commsBtn.title = 'Guide §4.6.3 — a separate step from ACCEPT';
      commsBtn.addEventListener('click', (e) => { e.stopPropagation(); _dispatchTofi(strip, 'TRANSFER_COMMS'); });
      el.appendChild(commsBtn);
    }

    // ── The RANGE slice: working an airspace ────────────────────────────
    //
    // Approving a flight onto an airspace's frequency. Deliberately not a
    // coordination affordance: nothing crosses a Facility boundary and no
    // jurisdiction moves (§4.7 / D17 — "the frequency is an attribute of the
    // Strip; the controller is what moves"), so the controller keeps the
    // Strip throughout and this sits apart from the Coordinate/TOFI buttons.
    if (strip.airspaceEntry) {
      const airspace = getEfspAirspace(strip.airspaceEntry.airspaceId);
      const name = (airspace && airspace.definition && airspace.definition.name) || strip.airspaceEntry.airspaceId;

      const inBadge = document.createElement('span');
      inBadge.className = 'efsp-coordination-badge efsp-airspace-badge';
      const mhz = strip.airspaceEntry.frequencyMhz;
      const block = strip.airspaceEntry.altitudeBlock;
      // The altitude restriction belongs HERE, not only on the airspace
      // board: two aircraft sharing one block are only safe if the
      // controller working each of them can see who is held to what, and
      // the Strip is what they are looking at.
      inBadge.textContent = [name, mhz ? mhz.toFixed(3) : null,
        block ? `${block.lowerFt}–${block.upperFt} ft` : null].filter(Boolean).join(' ');
      // §9.11's alert condition, shown on the Strip itself rather than only
      // as an obligation badge — the controller who approved it is the one
      // who can do something about it.
      if (airspace && airspace.state !== 'ACTIVE') {
        inBadge.classList.add('efsp-airspace-badge-unactivated');
        inBadge.title = `${name} is ${airspace.state}, not active`;
      }
      el.appendChild(inBadge);

      if (_canApproveAirspaceEntry(strip)) {
        const leaveBtn = document.createElement('button');
        leaveBtn.className = 'efsp-coordinate-btn';
        leaveBtn.textContent = 'Leave airspace';
        leaveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const actingPositionId = _resolveActingPositionId(strip);
          if (actingPositionId) sendEfspMutation(actingPositionId, strip, { kind: 'ClearAirspaceEntry' });
        });
        el.appendChild(leaveBtn);
      }
    } else if (_canApproveAirspaceEntry(strip)) {
      const airspaceBtn = document.createElement('button');
      airspaceBtn.className = 'efsp-coordinate-btn';
      airspaceBtn.textContent = 'Airspace…';
      airspaceBtn.title = 'Approve this flight into an airspace, on its frequency';
      airspaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _openAirspaceEntryPopover(strip, el);
      });
      el.appendChild(airspaceBtn);
    }

    if (strip.tofiCoordination && strip.tofiCoordination.state !== 'REJECTED') {
      const tofiBadge = document.createElement('span');
      tofiBadge.className = 'efsp-coordination-badge efsp-tofi-badge';
      tofiBadge.textContent = `TOFI ${strip.tofiCoordination.direction}: ${strip.tofiCoordination.state}`;
      el.appendChild(tofiBadge);
    }

    // "Convert to Arrival" (docs/adr/0023) — a DEPARTURE Strip at its
    // terminus (HANDED_OFF, whether still at APP or handed off further to
    // CTR) turns into its return-leg ARRIVAL Strip IN PLACE: same stripId,
    // same fdrId, throughout — never a second Strip. Two earlier versions
    // of this button spawned a separate ARRIVAL Strip instead (per guide
    // §3.6's turnaround rule); abandoned after live testing found that left
    // a stale departure Strip behind, a duplicated beacon code, and needed
    // every field copied by hand. board-store.js's _applyConvertToArrival
    // is authoritative for the state/role/Bay/permission rules.
    //
    // Gated on an unresolved link as well as role/state, mirroring the
    // server: the conversion discards both coordination records, and because
    // TOFI never changes this Strip's own state, HANDED_OFF is exactly where
    // a Strip sits for the whole of a tactical-control exchange — so this
    // button was live mid-exchange and silently broke the link. An ACTIVE
    // *coordination* link is fine (that handoff is complete; converting for
    // the return leg is the normal next step) — only a pending one, or live
    // tactical control, blocks it.
    const convertBlockedBy = (strip.coordination && strip.coordination.state === 'PROPOSED')
      ? 'an open coordination proposal'
      : (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED')
        ? 'an open TOFI proposal'
        : (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE')
          ? 'active tactical control'
          : null;
    if (strip.role === 'DEPARTURE' && strip.state === 'HANDED_OFF' && _resolveActingPositionId(strip)) {
      const spawnBtn = document.createElement('button');
      spawnBtn.className = 'efsp-spawn-return-btn';
      spawnBtn.textContent = 'Convert to Arrival →';
      if (convertBlockedBy) {
        spawnBtn.disabled = true;
        spawnBtn.classList.add('efsp-nla-btn-denied');
        spawnBtn.title = `cannot convert this Strip while it has ${convertBlockedBy} — resolve it first`;
      } else {
        // Two presses, because this clears the live annotation set in one
        // click and there is no undo for it (the archive keeps the values —
        // see board-store's previousLeg — but the working Strip is reset).
        const annotated = Object.keys(strip.annotations || {}).length > 0;
        spawnBtn.title = annotated
          ? `Turn this Strip into its return ARRIVAL leg at ${strip.ownerPositionId}. Its ${Object.keys(strip.annotations).length} annotation(s) are archived and cleared from the working Strip — press twice.`
          : `Turn this Strip into its return ARRIVAL leg at ${strip.ownerPositionId} — same Strip, same FDR, no duplicate`;
        if (annotated && _pendingConvertStripId !== strip.stripId) spawnBtn.classList.add('efsp-confirm-needed');
        spawnBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (annotated && _pendingConvertStripId !== strip.stripId) {
            _pendingConvertStripId = strip.stripId;
            spawnBtn.textContent = 'Convert — press again';
            spawnBtn.classList.add('efsp-confirm-needed');
            return;
          }
          _pendingConvertStripId = null;
          convertStripToArrival(strip);
        });
      }
      el.appendChild(spawnBtn);
    }

    // A return leg carries its departure leg's annotations, archived. Shown
    // as a chip rather than hidden in the Mutation log, because "what did
    // Ground tell them on the way out" is a question asked at the Strip.
    if (strip.previousLeg && Object.keys(strip.previousLeg.annotations || {}).length > 0) {
      const priorBadge = document.createElement('span');
      priorBadge.className = 'efsp-coordination-badge efsp-previous-leg-badge';
      const count = Object.keys(strip.previousLeg.annotations).length;
      priorBadge.textContent = `${strip.previousLeg.role} ×${count}`;
      priorBadge.title = Object.entries(strip.previousLeg.annotations)
        .map(([blockId, cell]) => `${blockId}: ${(cell.entries || []).map(e => e.value).join(' / ')}`)
        .join('\n');
      el.appendChild(priorBadge);
    }

    // Shared-FDR indicator. A sortie that crosses a Facility boundary leaves
    // several live Strips on one flight — the sender keeps its own, the
    // receiver gets a replica, TOFI adds a MISSION Strip — and each holder
    // retires theirs on their own schedule (guide §4.6). That is the design,
    // but nothing on screen said a Strip had siblings, so a sender-side one
    // would sit stale indefinitely and its beacon code stay held. Advisory
    // only: never blocks anything, and never suggests which one is "right."
    const siblings = otherLiveStripsForFdr(strip.fdrId, strip.stripId);
    if (siblings.length > 0) {
      const sharedBadge = document.createElement('span');
      sharedBadge.className = 'efsp-coordination-badge efsp-shared-fdr-badge';
      sharedBadge.textContent = `+${siblings.length}`;
      // The Role is named, not just the Position. Since a mission line can be
      // fragged against a flight at tasking time (crc-sync's docs/adr/0054),
      // this badge is how the ATC controller sees that one exists — and they
      // are the one best placed to catch it being bound to the wrong jet. A
      // bare "TACTICAL/TAC_C2" does not distinguish a mission line from a
      // coordination replica, which is the whole question being asked.
      sharedBadge.title = `this flight also has ${siblings.length === 1 ? 'a Strip' : `${siblings.length} Strips`} at ${siblings.map(s => `${s.facilityId || '?'}/${s.ownerPositionId} (${s.role})`).join(', ')}`;
      el.appendChild(sharedBadge);
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

    // OPERATIONAL_REQUEST STAND BY indicator (docs/adr/0022) — on the
    // REQUESTER's own Strip, so a still-open request doesn't read as
    // silently ignored. Cleared the moment the request actually resolves
    // (state leaves PROPOSED), same as the badges above.
    if (strip.coordination && strip.coordination.primitive === 'OPERATIONAL_REQUEST'
      && strip.coordination.state === 'PROPOSED' && strip.coordination.lastStandByAt) {
      const standByBadge = document.createElement('span');
      standByBadge.className = 'efsp-coordination-badge efsp-coordination-badge-standby';
      standByBadge.textContent = 'STAND BY';
      el.appendChild(standByBadge);
    }

    if (obligation) {
      const badge = document.createElement('span');
      badge.className = 'efsp-obligation-badge' + (obligation.severity === 'OVERDUE' ? ' efsp-obligation-badge-overdue' : '');
      badge.textContent = obligation.obligationType.replace(/_/g, ' ');
      badge.title = `${obligation.obligationType} — ${obligation.severity}`;
      el.appendChild(badge);
    }

    // WP5 (guide §6.6 rule 5) — which surveillance contact this flight is,
    // and on what evidence. A Strip-level badge rather than a Block: see
    // correlation-highlight.js's correlationBadgeFor for the three reasons.
    _appendCorrelationBadge(el, strip);

    // WP6 (guide §9.2 rules 2, 5 and 6) — whether military authority is
    // separating this flight, and whether the pre-rendezvous interlock is
    // armed. Same badge-not-Block reasoning as the correlation badge above.
    _appendMarsaBadge(el, strip);

    // Last, so it sits below every chip, badge and control — a detail panel
    // under the Strip rather than something threaded through it.
    _appendExpandedView(el, strip);
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

/**
 * The correlation badge, plus the bind/unbind affordances that go with it.
 *
 * Ambiguity is the case worth the extra control: the server refuses to guess
 * between two contacts that match a flight equally well, so the badge becomes
 * a button that lists them and lets the controller settle it. That is guide
 * §6.6 rule 1's top rung — an explicit binding — becoming reachable, and it is
 * also the only route for an aircraft with its transponder off that nothing
 * matches by callsign.
 */
function _appendCorrelationBadge(el, strip) {
  if (typeof correlationBadgeFor !== 'function') return;
  const badge = correlationBadgeFor(strip);
  if (!badge) return;

  if (badge.warned) el.classList.add('efsp-strip-correlation-warned');

  const node = document.createElement(badge.ambiguous ? 'button' : 'span');
  node.className = badge.className;
  node.textContent = badge.text;
  node.title = badge.title;
  if (badge.ambiguous) {
    node.disabled = !_resolveActingPositionId(strip);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      _openBindPopover(strip, node, badge.candidateTrackIds);
    });
  }
  el.appendChild(node);

  // A "Bind…" control for the uncorrelated case, and "Unbind" once bound.
  const record = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
  if (!record || badge.ambiguous) return;

  if (record.binding) {
    const unbind = document.createElement('button');
    unbind.className = 'efsp-correlation-btn';
    unbind.textContent = 'Unbind';
    unbind.title = 'give the contact back to the automatic matcher';
    unbind.disabled = !_resolveActingPositionId(strip);
    unbind.addEventListener('click', (e) => {
      e.stopPropagation();
      _dispatchCorrelation(strip, { kind: 'UnbindTrack' });
    });
    el.appendChild(unbind);
    return;
  }

  if (record.state === 'UNCORRELATED') {
    const bind = document.createElement('button');
    bind.className = 'efsp-correlation-btn';
    bind.textContent = 'Bind…';
    bind.title = 'pick the contact this flight is';
    bind.disabled = !_resolveActingPositionId(strip);
    bind.addEventListener('click', (e) => {
      e.stopPropagation();
      _openBindPopover(strip, bind, null);
    });
    el.appendChild(bind);
  }
}

let _openBindPopoverEl = null;

function _closeBindPopover() {
  if (_openBindPopoverEl && _openBindPopoverEl.parentNode) {
    _openBindPopoverEl.parentNode.removeChild(_openBindPopoverEl);
  }
  _openBindPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseBindPopover, true);
}

// The dismiss-on-outside-click listener MUST test the target, the way
// _onDocPointerDownCloseTofiPopover and its Coordinate/Highlight peers always
// have. This one was registered as a bare `_closeBindPopover`, so it closed on
// ANY pointerdown — including one inside its own popover.
//
// The popover's own `pointerdown` -> stopPropagation() looks like it should
// prevent that and cannot: this listener is on `document` in the CAPTURE
// phase, so it runs BEFORE the event ever reaches the popover to be stopped.
// The candidate row was therefore torn out of the DOM between pointerdown and
// pointerup, and a `click` never fired on it at all — so binding by pointer
// silently did nothing, while `.bind` worked and every dispatch test passed
// (the DOM stub invokes click handlers directly and fires no pointerdown).
function _onDocPointerDownCloseBindPopover(e) {
  if (_openBindPopoverEl && !_openBindPopoverEl.contains(e.target)) _closeBindPopover();
}

/**
 * A picker of candidate contacts. `candidateTrackIds` narrows it to the ones
 * the server called ambiguous; null offers everything currently on the scope,
 * which is the uncorrelated case where the controller knows something the
 * matcher cannot.
 */
function _openBindPopover(strip, anchorEl, candidateTrackIds) {
  _closeBindPopover();
  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  const ids = candidateTrackIds && candidateTrackIds.length
    ? candidateTrackIds
    : (typeof window !== 'undefined' && typeof window.getAllTracks === 'function'
      ? window.getAllTracks().filter(t => t.category === 1 || t.category === 2).map(t => String(t.id))
      : []);

  if (ids.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    // Under the station-derived picture an empty scope has a cause worth
    // naming (crc-sync's docs/adr/0042) — a Position with no radar sees
    // nothing, so there is nothing to bind.
    empty.textContent = 'No contacts in your coverage to bind.';
    popover.appendChild(empty);
  }

  for (const trackId of ids) {
    const track = typeof window !== 'undefined' && typeof window.getLatestTrack === 'function'
      ? window.getLatestTrack(trackId) : null;
    const row = document.createElement('button');
    row.className = 'efsp-coordinate-submit';
    row.textContent = track ? `${track.callsign || trackId}${track.squawk != null ? ` · ${String(track.squawk).padStart(4, '0')}` : ''}` : String(trackId);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      _dispatchCorrelation(strip, { kind: 'BindTrack', trackId: String(trackId) });
      _closeBindPopover();
    });
    popover.appendChild(row);
  }

  anchorEl.appendChild(popover);
  _openBindPopoverEl = popover;
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseBindPopover, true), 0);
}

/**
 * MARSA (§9.2) — the badge, the participant highlight, and the control that
 * opens the relation's actions.
 *
 * The highlight (rule 5, "selecting one participant MUST highlight the others")
 * is a class on the Strip rather than anything drawn here: the selected Strip's
 * participants are resolved once in _afterSelectionChanged and read back while
 * each Strip is built, which is the same shape the correlation ring uses.
 */
function _appendMarsaBadge(el, strip) {
  if (typeof marsaBadgeFor !== 'function') return;

  if (typeof isMarsaHighlighted === 'function' && isMarsaHighlighted(strip.stripId)) {
    el.classList.add('efsp-strip-marsa-participant');
  }

  const badge = marsaBadgeFor(strip);
  if (!badge) {
    // No relation and no history: offer the declaration itself, since a
    // controller has to be able to start one from a Strip that has never been
    // in one. Left out entirely when nobody can act, rather than rendered
    // disabled — a Strip nobody holds should not grow a control.
    if (!_resolveActingPositionId(strip)) return;
    const declare = document.createElement('button');
    declare.className = 'efsp-marsa-btn';
    declare.textContent = 'MARSA…';
    declare.title = 'declare that military authority is separating this flight from another';
    declare.addEventListener('click', (e) => {
      e.stopPropagation();
      _openMarsaPopover(strip, declare);
    });
    el.appendChild(declare);
    return;
  }

  // A VOIDED relation flags the whole Strip, not just the badge — §9.2 rule 2
  // calls it an ALERT, and an alert that reads as one more chip among six is
  // not one.
  if (badge.voided) el.classList.add('efsp-strip-marsa-voided');
  if (badge.armed) el.classList.add('efsp-strip-marsa-armed');

  const node = document.createElement('button');
  node.className = badge.className;
  node.textContent = badge.text;
  node.title = badge.title;
  node.dataset.marsaId = badge.marsaId;
  // A button in every state, including VOIDED: rule 5 wants the relation
  // "visible as a link", and after a void the controller most needs to see who
  // else was in it.
  node.disabled = !_resolveActingPositionId(strip);
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    _openMarsaPopover(strip, node);
  });
  el.appendChild(node);
}

let _openMarsaPopoverEl = null;

function _closeMarsaPopover() {
  if (_openMarsaPopoverEl && _openMarsaPopoverEl.parentNode) {
    _openMarsaPopoverEl.parentNode.removeChild(_openMarsaPopoverEl);
  }
  _openMarsaPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseMarsaPopover, true);
}

// Tests the target, for the reason spelled out on
// _onDocPointerDownCloseBindPopover above. This popover is the one where it
// hurt most: it is the only one carrying <select>s and a text input, so
// pressing ANY of its own controls dismissed it, and Declare / Rendezvous /
// End / Void could never be clicked at all.
function _onDocPointerDownCloseMarsaPopover(e) {
  if (_openMarsaPopoverEl && !_openMarsaPopoverEl.contains(e.target)) _closeMarsaPopover();
}

/**
 * The relation's actions, and — for a declaration — who is in it.
 *
 * `declaringCallsign` is a required free-text field and that is doctrine, not
 * an oversight: §9.2 rule 1 says "the declaration is the tanker's, and it is
 * verbal — the EFSP records it, it does not decide it." So the form asks who
 * said it rather than guessing from the Strip.
 */
function _openMarsaPopover(strip, anchorEl) {
  _closeMarsaPopover();
  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover efsp-marsa-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  const relation = typeof marsaForStrip === 'function' ? marsaForStrip(strip) : null;
  const active = relation && relation.state === 'ACTIVE' ? relation : null;

  if (relation) {
    // Rule 5's link, made concrete: naming the other participants, and letting
    // the controller jump to one.
    const heading = document.createElement('div');
    heading.className = 'efsp-marsa-popover-heading';
    heading.textContent = relation.state === 'VOIDED'
      ? `MARSA voided — declared by ${relation.declaringCallsign}`
      : `MARSA — declared by ${relation.declaringCallsign}`;
    heading.title = typeof MARSA_EXPANSION === 'string' ? MARSA_EXPANSION : '';
    popover.appendChild(heading);

    for (const fdrId of relation.participants) {
      if (fdrId === strip.fdrId) continue;
      const peer = getAllEfspStrips().find(s => s.fdrId === fdrId && s.state !== 'DROPPED');
      const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(fdrId) : null;
      const label = (fdr && fdr.identity && fdr.identity.callsign) || fdrId;
      const row = document.createElement('button');
      row.className = 'efsp-marsa-participant-btn';
      row.textContent = label;
      row.title = peer ? 'select this participant' : 'this participant has no live Strip on your board';
      row.disabled = !peer;
      if (peer) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          _closeMarsaPopover();
          selectEfspStripById(peer.stripId);
        });
      }
      popover.appendChild(row);
    }
  }

  for (const action of (typeof marsaActionsFor === 'function' ? marsaActionsFor(strip) : [])) {
    if (action.kind === 'DeclareMarsa') {
      popover.appendChild(_buildMarsaDeclareForm(strip));
      continue;
    }
    if (action.kind === 'AddParticipant') {
      popover.appendChild(_buildMarsaAddForm(strip, active));
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'efsp-coordinate-submit';
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _closeMarsaPopover();
      const op = action.kind === 'RemoveParticipant'
        ? { kind: 'RemoveParticipant', fdrId: strip.fdrId }
        : { kind: action.kind };
      _dispatchMarsa(strip, action.marsaId, op);
    });
    popover.appendChild(btn);
  }

  anchorEl.appendChild(popover);
  _openMarsaPopoverEl = popover;
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseMarsaPopover, true), 0);
}

/** Which other live flights this one could be put into a relation with. */
function _marsaCandidates(strip) {
  return getAllEfspStrips().filter((s) => {
    if (s.state === 'DROPPED' || s.fdrId === strip.fdrId) return false;
    // A flight already under MARSA cannot be in a second relation — crc-sync
    // refuses it, and offering it here would be a control that always fails.
    return !(typeof activeMarsaForFdr === 'function' && activeMarsaForFdr(s.fdrId));
  });
}

function _marsaCandidateSelect(strip) {
  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const s of _marsaCandidates(strip)) {
    const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(s.fdrId) : null;
    const option = document.createElement('option');
    option.value = s.fdrId;
    option.textContent = (fdr && fdr.identity && fdr.identity.callsign) || s.fdrId;
    select.appendChild(option);
  }
  return select;
}

function _buildMarsaDeclareForm(strip) {
  const wrap = document.createElement('div');
  const candidates = _marsaCandidates(strip);
  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    empty.textContent = 'no other live flight is available to declare MARSA with';
    wrap.appendChild(empty);
    return wrap;
  }

  const other = _marsaCandidateSelect(strip);
  wrap.appendChild(other);

  const startEvent = document.createElement('select');
  startEvent.className = 'efsp-coordinate-primitive-select';
  for (const [value, label] of [
    ['TANKER_ACCEPTED', 'tanker accepted MARSA'],
    ['MTR_ENTRY', 'MTR entry'],
    ['LOCAL_DECLARATION', 'local declaration'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    startEvent.appendChild(option);
  }
  wrap.appendChild(startEvent);

  const endCondition = document.createElement('select');
  endCondition.className = 'efsp-coordinate-primitive-select';
  for (const [value, label] of [
    ['VERTICALLY_POSITIONED', 'until vertically positioned'],
    ['MTR_COMPLETE', 'until MTR complete'],
    ['ATC_SEPARATION_ESTABLISHED', 'until ATC separation is re-established'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    endCondition.appendChild(option);
  }
  wrap.appendChild(endCondition);

  const declaring = document.createElement('input');
  declaring.className = 'efsp-coordinate-note';
  declaring.placeholder = 'who declared it (heard on frequency)';
  wrap.appendChild(declaring);

  const send = document.createElement('button');
  send.className = 'efsp-coordinate-send-btn';
  send.textContent = 'Declare';
  send.addEventListener('click', (e) => {
    e.stopPropagation();
    _closeMarsaPopover();
    _dispatchMarsa(strip, undefined, {
      kind: 'DeclareMarsa',
      participants: [strip.fdrId, other.value],
      startEvent: startEvent.value,
      endCondition: endCondition.value,
      declaringCallsign: (declaring.value || '').trim(),
    });
  });
  wrap.appendChild(send);
  return wrap;
}

function _buildMarsaAddForm(strip, active) {
  const wrap = document.createElement('div');
  const candidates = _marsaCandidates(strip);
  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    empty.textContent = 'no other live flight is available to join this relation';
    wrap.appendChild(empty);
    return wrap;
  }
  const other = _marsaCandidateSelect(strip);
  wrap.appendChild(other);
  const add = document.createElement('button');
  add.className = 'efsp-coordinate-send-btn';
  add.textContent = 'Add to MARSA';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    _closeMarsaPopover();
    _dispatchMarsa(strip, active && active.marsaId, { kind: 'AddParticipant', fdrId: other.value });
  });
  wrap.appendChild(add);
  return wrap;
}

function _dispatchMarsa(strip, marsaId, op) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  const relation = marsaId && typeof getEfspMarsa === 'function' ? getEfspMarsa(marsaId) : null;
  sendEfspMarsaMutation(actingPositionId, marsaId, relation ? relation.rev : undefined, op);
}

function _dispatchCorrelation(strip, op) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  const record = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
  sendEfspCorrelationMutation(actingPositionId, strip.fdrId, record ? record.rev : 0, op);
}

function _selectStrip(stripId) {
  _selectedStripId = _selectedStripId === stripId ? null : stripId;
  _afterSelectionChanged();
}

/**
 * Selects a Strip without the toggle. Called when a click on the MAP resolves
 * to this Strip (correlation-highlight.js's selectStripForTrack) — clicking a
 * contact twice must not deselect its Strip, which is what _selectStrip's
 * toggle would do.
 */
function selectEfspStripById(stripId) {
  if (!getEfspStrip(stripId)) return false;
  _selectedStripId = stripId;
  _afterSelectionChanged();
  const el = _stripElById(stripId);
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest' });
  }
  return true;
}

function _afterSelectionChanged() {
  // §9.2 rule 5 — "selecting one participant MUST highlight the others."
  // Resolved BEFORE the re-render below, not after, because the highlight is a
  // class each Strip element reads while it is being built. Doing it the other
  // way round would leave the highlight one selection behind, which is the kind
  // of off-by-one that looks like a race and is not.
  if (typeof highlightMarsaParticipants === 'function') highlightMarsaParticipants(_selectedStripId);
  renderAllOpenEfspBays();
  // Ring the selected Strip's contact on the map (guide §6.6 rule 4). One Map
  // lookup plus the existing rAF-batched updateMap() — see
  // correlation-highlight.js on why the 1s budget is not a concern here.
  if (typeof highlightCorrelatedTrack === 'function') highlightCorrelatedTrack(_selectedStripId);
}

function _stripElById(stripId) {
  for (const { containerEl } of _openBayContainers || []) {
    const el = containerEl && containerEl.querySelector
      && containerEl.querySelector(`[data-strip-id="${stripId}"]`);
    if (el) return el;
  }
  return null;
}

/** The Bays currently on screen — correlation-highlight.js prefers a Strip in one. */
function getOpenEfspBayIds() {
  return (_openBayContainers || []).map(entry => entry.bayId).filter(Boolean);
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
// exists this slice (docs/adr/0020's deferral) — gating the Coordinate
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

// COORDINATION_ELIGIBLE_STATES (docs/adr/0022) lives in efsp-nla.js, loaded
// before this file — the established pattern for small doctrinal tables
// that need a server/client drift test (see that module's own comment).
// Was previously hardcoded to ARRIVAL-only here, which is what made the
// Coordinate button unreachable for any DEPARTURE Strip — this fix closes
// both the missing APP->CTR handoff AND the other 4 primitives' same
// ARRIVAL-only gate.

/**
 * A Strip may open a NEW coordination proposal only while it has no
 * already-open one (server-enforced too — board-store.js's
 * _applyCoordinationPropose). REJECTED can be retried — but ONLY from the
 * SENDER's own Strip, which stays in its normal working Bay the whole time
 * (guide's real flight record). A Strip sitting in a Coordination Bay is
 * always the RECEIVER-side replica/proposal artifact — jurisdiction never
 * actually transferred there even once accepted (accept relocates it OUT
 * of the Coordination Bay, board-store.js's _applyCoordinationAccept), so
 * one still sitting there (PROPOSED awaiting response, or REJECTED and
 * left inert) is never a legitimate flight record to propose FROM. Bug
 * found in live testing: without this, a rejected receiver-side replica
 * offered Coordinate again — letting a controller "hand off" CTR's own
 * dead copy of a flight back to the very Position that sent it in the
 * first place, an entirely spurious third replica.
 */
function _canProposeCoordination(strip) {
  if (!COORDINATION_TARGETS[strip.ownerPositionId]) return false;
  if (COORDINATION_ELIGIBLE_STATES[strip.role] !== strip.state) return false;
  if (strip.bayId.endsWith('-coordination')) return false;
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

// ── WP4A second slice: TOFI (guide §4.6.3) — a genuinely different
// sub-protocol from the 5 primitives above, not a 6th COORDINATION_TARGETS
// entry (see crc-sync's board-store.js module comment for the full list of
// structural differences: two independent exchanges per Strip, a distinct
// comms-transfer action, no jurisdiction transfer ever, a different Strip
// Role on the receiving side sharing one fdrId).
//
// Unlike COORDINATION_TARGETS' fixed 1:1 stub, TOFI genuinely needs a
// picker: per the guide's own §4.1 Position table, TOFI is listed only for
// CTR among the ATC Positions built so far (not APP), but the MRU side has
// TWO candidates (TAC_C2, GCI) — CTR-initiated TOFI must let the controller
// choose. TAC_C2/GCI-initiated TOFI has exactly one candidate (CTR) and
// skips the picker, behaving like today's deterministic stub.
const TOFI_COUNTERPARTS = {
  CTR:    [{ facilityId: 'TACTICAL', positionId: 'TAC_C2' }, { facilityId: 'TACTICAL', positionId: 'GCI' }],
  TAC_C2: [{ facilityId: 'CENTER', positionId: 'CTR' }],
  GCI:    [{ facilityId: 'CENTER', positionId: 'CTR' }],
};
// D12 audit note: TAC_C2/AIC/GCI/JTAC must NEVER appear as keys in
// COORDINATION_TARGETS above — that's what structurally prevents a
// HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/AIT button from ever
// rendering for them, regardless of Position combination (see
// efsp-coordination-client.test.js's permanent regression guard). TOFI's
// OWN button (below) is the only coordination-shaped affordance any of
// those 4 Positions ever get, and it only ever dispatches kind:'TOFI' —
// structurally incapable of offering one of the 5 forbidden primitives.

/** ENTRY may be proposed from a fresh Strip, or retried after a REJECTED one — always from the ATC-side Strip, never the MISSION-side replica. */
function _canProposeTofiEntry(strip) {
  if (!TOFI_COUNTERPARTS[strip.ownerPositionId]) return false;
  if (strip.role === 'MISSION') return false;
  // The (role, state) gate the 5 primitives have had since docs/adr/0022 and
  // TOFI never did — a flight has to actually be airborne and enroute before
  // it can enter tactically controlled airspace. Client mirror of
  // coordination.js's TOFI_ELIGIBLE_STATES, kept in lockstep by
  // efsp-coordination-client.test.js.
  if (TOFI_ELIGIBLE_STATES[strip.role] !== strip.state) return false;
  if (!strip.tofiCoordination) return true;
  return strip.tofiCoordination.state === 'REJECTED';
}

/** EXIT is only ever proposed from the ATC-side Strip, and only while tactical control is genuinely ACTIVE. */
function _canProposeTofiExit(strip) {
  if (strip.role === 'MISSION') return false;
  return !!(strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE');
}

/** Accept/Reject always render on the MISSION-side Strip — the receiving MRU controller's own record — for BOTH ENTRY and EXIT (mirrors board-store.js's own side-split exactly). */
function _isPendingTofiReplica(strip) {
  return strip.role === 'MISSION' && !!strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED';
}

/** Transfer Comms is invocable on EITHER side of an accepted exchange that hasn't transferred comms yet. */
function _canTransferTofiComms(strip) {
  return !!(strip.tofiCoordination && strip.tofiCoordination.acceptedAt && !strip.tofiCoordination.commsTransferred);
}

// The regimes offered when accepting tactical control (docs/adr/0053).
// Mirrors fdr-store.js's SEPARATION_REGIMES; the server validates, this is
// the picker so nobody types one of five exact strings by hand. MARSA is
// first because it is the common military case — but it is a default nobody
// can accept without seeing, which is the point.
const TOFI_ACCEPT_REGIMES = ['MARSA', 'ATC', 'USING_AGENCY', 'DUE_REGARD', 'SEE_AND_AVOID'];

function _dispatchTofi(strip, action, direction, overrides = {}) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  if (action === 'PROPOSE') {
    const op = { kind: 'TOFI', action: 'PROPOSE', direction, note: overrides.note || undefined };
    if (direction === 'ENTRY') {
      const target = overrides.target;
      if (!target) return;
      op.toFacilityId = target.facilityId;
      op.toPositionId = target.positionId;
    }
    sendEfspMutation(actingPositionId, strip, op);
  } else {
    const op = { kind: 'TOFI', action };
    // docs/adr/0053 — accepting an ENTRY means saying under which regime the
    // MRU is taking the aircraft. The server refuses an accept without one,
    // deliberately: §4.6.3 rule 1 and defect D14 put the regime in the
    // governing agreement, so it is asked for rather than derived.
    if (overrides.separationRegime) op.separationRegime = overrides.separationRegime;
    sendEfspMutation(actingPositionId, strip, op);
  }
}

let _openTofiPopoverEl = null;

function _closeTofiPopover() {
  if (!_openTofiPopoverEl) return;
  _openTofiPopoverEl.remove();
  _openTofiPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseTofiPopover, true);
}

function _onDocPointerDownCloseTofiPopover(e) {
  if (_openTofiPopoverEl && !_openTofiPopoverEl.contains(e.target)) _closeTofiPopover();
}

/**
 * TOFI ENTRY's popover — structurally simpler than _openCoordinatePopover:
 * no primitive choice (TOFI is the only thing this button ever sends), a
 * target picker ONLY when more than one counterpart exists (CTR's case —
 * TAC_C2/GCI's single-candidate case skips this popover entirely, see the
 * click handler below). Reuses the same degraded-track warning/required-
 * note pattern as the Coordinate popover (guide §4.6 rule 5 applies to
 * TOFI too — crc-sync's board-store.js enforces this identically for both).
 */
function _openTofiEntryPopover(strip, anchorEl, counterparts) {
  _closeTofiPopover();
  const fdr = getEfspFdr(strip.fdrId);
  const degraded = !!(fdr && fdr.identity && fdr.identity.trackDegradationFlag && fdr.identity.trackDegradationFlag !== 'NONE');

  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover efsp-tofi-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (degraded) {
    const warn = document.createElement('div');
    warn.className = 'efsp-coordinate-degraded-warning';
    warn.textContent = `Track degraded (${fdr.identity.trackDegradationFlag}) — verbal coordination required, note mandatory`;
    popover.appendChild(warn);
  }

  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const c of counterparts) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(c);
    opt.textContent = `${c.positionId} (${c.facilityId})`;
    select.appendChild(opt);
  }
  popover.appendChild(select);

  const note = document.createElement('textarea');
  note.className = 'efsp-coordinate-note';
  note.placeholder = degraded ? 'Verbal coordination note (required)' : 'Note (optional)';
  popover.appendChild(note);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Send TOFI';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (degraded && !note.value.trim()) {
      note.classList.add('efsp-coordinate-note-required');
      return;
    }
    _dispatchTofi(strip, 'PROPOSE', 'ENTRY', { target: JSON.parse(select.value), note: note.value.trim() });
    _closeTofiPopover();
  });
  popover.appendChild(sendBtn);

  anchorEl.appendChild(popover);
  _openTofiPopoverEl = popover;
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseTofiPopover, true), 0);
}

// Only the Positions that hold an airborne flight approve one into an
// airspace — the client mirror of permission.js's AIRSPACE_ENTRY_OP_KINDS
// grant. A range Position never appears here: it works no Strips at all.
// The Strip awaiting a second press on Convert to Arrival. Module-level
// rather than per-render, since a re-render rebuilds the button.
let _pendingConvertStripId = null;

const AIRSPACE_ENTRY_POSITIONS = ['APP', 'CTR'];

// Blocks a controller can reach on a Strip, by role. Deliberately exported:
// a Block present in the Block Map but absent here is editable in principle
// and invisible in practice, which is how §3.8's release model shipped
// unreachable. efsp-ui-reachability.test.js holds this to the Block Maps.
//
// '9F' (STEREO, docs/adr/0050) is here by choice rather than by that test's
// insistence — the test holds only WRITABLE Blocks, and 9F is read-only, so
// nothing would have failed had it been left out. That is precisely the
// blind spot the briefing's §6 names, so: a controller needs to see which
// canned route a flight filed, not least because it is what decides whether
// a standing release covers the flight.
// Blocks the three ATC Roles all show, in render order. Everything a
// controller reads at a glance on any Strip.
const COMPACT_BLOCKS_SHARED = [
  '1', '3', '3A', '3B', '3C', '3D', '3E', '3F', '3G', '4', '5', '5A', '7', '8', '8A', '8B', '9', '9F',
  '14A', '14D', '22', '24A', 'IFR', 'RSVC', 'SREG', '25',
];

/**
 * Which Blocks get a chip on the Strip, per Role.
 *
 * **The criterion is EDIT FREQUENCY, not interlock-ness.** Every Block is
 * reachable from the expanded view now, so reachability cannot be why these
 * earn a chip — what earns one is being edited on most Strips of that Role. A
 * heading and an initial altitude are issued with every departure clearance; a
 * radar vector is issued constantly. Interlock-ness was considered and
 * rejected as the test: it describes what happens WHEN you edit a Block, not
 * how often, and adopting it would have the next slice adding chips for the
 * wrong reason.
 *
 * Per-Role because the same Block id means different things by Role — 20/21
 * are guide §6.2's "Heading"/"Initial altitude" on DEPARTURE and §6.3's radar
 * scratchpads on the airborne Roles, which is exactly why they could not live
 * in the shared list.
 *
 * Every chip costs Strip height, and Strip height costs Strips-visible-per-Bay.
 * Keep this list earned.
 */
const COMPACT_BLOCKS_BY_ROLE = {
  // Heading and initial altitude: the two things a departure clearance issues
  // beyond the route.
  DEPARTURE:  [...COMPACT_BLOCKS_SHARED, '20', '21'],
  // '7' is already shared and is the ASSIGNED altitude on this Role
  // (annotation-routed, append-only); the vector is the other constant.
  ARRIVAL:    [...COMPACT_BLOCKS_SHARED, '9A-VECTOR'],
  // '7' stays as the FILED request here; '7A' is the assignment beside it.
  OVERFLIGHT: [...COMPACT_BLOCKS_SHARED, '7A', '9A-VECTOR'],
  MISSION:    ['M3', 'M1', 'M2', 'M4', 'M5', 'M6', 'M7', 'M25'],
};

function compactBlocksFor(role) {
  return COMPACT_BLOCKS_BY_ROLE[role] || COMPACT_BLOCKS_SHARED;
}

function _canApproveAirspaceEntry(strip) {
  if (!AIRSPACE_ENTRY_POSITIONS.includes(strip.ownerPositionId)) return false;
  return !!_resolveActingPositionId(strip);
}

let _openAirspacePopoverEl = null;

function _closeAirspacePopover() {
  if (_openAirspacePopoverEl && _openAirspacePopoverEl.parentNode) _openAirspacePopoverEl.parentNode.removeChild(_openAirspacePopoverEl);
  _openAirspacePopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseAirspacePopover, true);
}

// Same fix, same reason (see _onDocPointerDownCloseBindPopover). This one
// took no event argument at all, so it closed on every pointerdown — which
// made the airspace <select> and its Send button unreachable by pointer.
function _onDocPointerDownCloseAirspacePopover(e) {
  if (_openAirspacePopoverEl && !_openAirspacePopoverEl.contains(e.target)) _closeAirspacePopover();
}

function _openAirspaceEntryPopover(strip, anchorEl) {
  _closeAirspacePopover();
  const airspaces = getAllEfspAirspaces();

  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (airspaces.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    empty.textContent = 'No airspaces configured';
    popover.appendChild(empty);
    anchorEl.appendChild(popover);
    _openAirspacePopoverEl = popover;
    setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseAirspacePopover, true), 0);
    return;
  }

  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const a of airspaces) {
    const definition = a.definition || {};
    const frequency = definition.controlFrequencyMhz || definition.workingFrequencyMhz;
    const opt = document.createElement('option');
    opt.value = a.airspaceId;
    // The state is in the label because entry into an unactivated airspace
    // is allowed but alerts (§9.11) — worth seeing before clicking, not
    // only afterwards.
    opt.textContent = `${definition.name || a.airspaceId} — ${a.state}${frequency ? ` · ${frequency.toFixed(3)}` : ''}`;
    select.appendChild(opt);
  }
  popover.appendChild(select);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Approve entry';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const actingPositionId = _resolveActingPositionId(strip);
    if (actingPositionId) {
      sendEfspMutation(actingPositionId, strip, { kind: 'ApproveAirspaceEntry', airspaceId: select.value });
    }
    _closeAirspacePopover();
  });
  popover.appendChild(sendBtn);

  anchorEl.appendChild(popover);
  _openAirspacePopoverEl = popover;
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseAirspacePopover, true), 0);
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

  // AIT is configuration, not a default (guide §4.6 rule 7, docs/adr/0022)
  // — disabled here rather than letting a PROPOSE submit-and-silently-fail
  // against the authoritative server-side check in board-store.js.
  const aitAuthorized = isAitAuthorizedFor(strip.facilityId);

  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const primitive of ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) {
    const opt = document.createElement('option');
    opt.value = primitive;
    opt.textContent = COORDINATION_PRIMITIVE_LABELS[primitive];
    if (primitive === 'AIT' && !aitAuthorized) {
      opt.disabled = true;
      opt.textContent += ' (no written directive)';
    }
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

// ── ops-filed: the "filed but not yet an active Strip" queue ────────────
// A real server-defined Bay (unlike the search pseudo-Bay below), but its
// CONTENT is deliberately NOT Board state — mirrors the search Bay's own
// "client-local view, not a server concept" precedent exactly. A filed
// DD1801 plan isn't a Strip (no stripId/ownerPositionId/lifecycle state at
// all) until a controller actually presses "Create Strip" on it, so
// inventing a server-side pseudo-Strip type for it would be a bigger,
// unnecessary model change — see docs/efsp-usage-guide.md §4.

let _opsFiledPlans = [];
let _opsFiledFetchedAt = 0;
let _opsFiledFetching = false;
let _opsFiledUsedPlanIds = new Set(); // this-session-only, cleared on reload — see the card's "already created" note below
const OPS_FILED_REFRESH_MS = 10000;

function _renderOpsFiledCards(container) {
  container.innerHTML = '';
  if (_opsFiledFetching && _opsFiledFetchedAt === 0) {
    const loading = document.createElement('div');
    loading.className = 'efsp-empty';
    loading.textContent = 'Loading filed flight plans…';
    container.appendChild(loading);
    return;
  }
  if (_opsFiledPlans.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-empty';
    empty.textContent = 'No filed flight plans waiting.';
    container.appendChild(empty);
    return;
  }
  for (const plan of _opsFiledPlans) {
    const card = document.createElement('div');
    card.className = 'efsp-filed-plan-card';

    const callsignEl = document.createElement('div');
    callsignEl.className = 'efsp-filed-plan-callsign';
    callsignEl.textContent = plan.callsign;
    card.appendChild(callsignEl);

    const summaryEl = document.createElement('div');
    summaryEl.className = 'efsp-filed-plan-summary';
    const seed = plan.seed || {};
    summaryEl.textContent = [seed.departureAirport, seed.destinationAirport, seed.route].filter(Boolean).join(' → ') || 'No route filed';
    card.appendChild(summaryEl);

    if (plan.submittedByName) {
      const byEl = document.createElement('div');
      byEl.className = 'efsp-filed-plan-by';
      byEl.textContent = 'Filed by ' + plan.submittedByName;
      card.appendChild(byEl);
    }

    const used = _opsFiledUsedPlanIds.has(plan.id);
    if (used) {
      const usedEl = document.createElement('div');
      usedEl.className = 'efsp-filed-plan-used';
      usedEl.textContent = 'Strip already created this session';
      card.appendChild(usedEl);
    }

    const btn = document.createElement('button');
    btn.className = 'efsp-filed-plan-create-btn';
    btn.textContent = used ? 'Create Again' : 'Create Strip';
    btn.addEventListener('click', () => {
      _opsFiledUsedPlanIds.add(plan.id);
      createStripFromFiledPlan(plan);
      _renderOpsFiledCards(container);
    });
    card.appendChild(btn);

    container.appendChild(card);
  }
}

/** Called from renderBay() whenever ops-filed is the Bay actually being shown — fetches (throttled) and (re)renders. Never blocks renderBay() itself; the fetch is fire-and-forget, re-rendering once it lands. */
function _refreshOpsFiledIfStale(container) {
  const stale = Date.now() - _opsFiledFetchedAt > OPS_FILED_REFRESH_MS;
  if (_opsFiledFetching || !stale) return;
  if (typeof listFiledFlightPlansClient !== 'function') return;
  _opsFiledFetching = true;
  listFiledFlightPlansClient().then((plans) => {
    _opsFiledPlans = plans;
    _opsFiledFetchedAt = Date.now();
  }).finally(() => {
    _opsFiledFetching = false;
    renderAllOpenEfspBays(); // picks up the fresh list if ops-filed is still the open Bay; a no-op otherwise
  });
}

function renderBay(container, bayId) {
  if (!container) return;
  if (bayId === 'ops-filed') {
    _renderOpsFiledCards(container);
    _refreshOpsFiledIfStale(container);
    return;
  }
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
  // WP4A second slice — the TOFI ENTRY popover was missing from this list
  // entirely, so ANY board update (even an unrelated heartbeat/delta on a
  // different Strip) rebuilt this Strip's DOM out from under it mid-
  // interaction, destroying the popover before a controller could pick a
  // non-default target and click Send. Same protection every other popover
  // already gets above.
  if (_openTofiPopoverEl && el.contains(_openTofiPopoverEl)) return true;
  if (_openAirspacePopoverEl && el.contains(_openAirspacePopoverEl)) return true;
  // The bind and MARSA popovers were BOTH missing, which is the third time
  // this list has been found incomplete after the same bug — highlight,
  // coordinate, TOFI and airspace were each added the same way. The rule is
  // that interactive state survives a remote re-render; adding two more
  // entries fixes two instances of a class, so the test that comes with this
  // enumerates the class instead (efsp-ui-reachability.test.js opens each
  // popover in turn and asserts its Strip is protected). A seventh cannot
  // repeat this without failing.
  if (_openBindPopoverEl && el.contains(_openBindPopoverEl)) return true;
  if (_openMarsaPopoverEl && el.contains(_openMarsaPopoverEl)) return true;
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
