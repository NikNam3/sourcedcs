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
//   §7.2.5 — insertion index computed from ONE cached set of rects, never
//            re-measured per pointermove. Cached the instant the dragged
//            Strip leaves the flow rather than at pointerdown, and read
//            through the scroll offset it was taken at — see strip-drag.js's
//            module comment (F-402, F-404).
//   §7.8.1 — every drag has a non-drag alternative: click-to-select, then
//            click a Rack to move there (WCAG 2.2 SC 2.5.7).
//   §7.8 rule 3 — a re-render restores focus by Strip ID, and ONLY when the
//            element that had it is gone (renderBay); Space and Enter belong
//            to whatever control inside the Strip has focus, so the Strip's
//            own selection keys stand aside for it (_onStripKeydown).
//   §3.7 rule 5 / §7.4 rule 2 — an edited Block commits on Enter, reverts on
//            Esc, and does NEITHER on blur. One edit is open at a time
//            (_openBlockEdit); an abandoned one survives a rebuild rather
//            than blocking it.

let _selectedStripId = null; // click-to-select state for the non-drag move path

function getSelectedEfspStripId() { return _selectedStripId; }

/**
 * The refusal currently on screen, if it is about THIS Strip (lane 1's F-103).
 *
 * efsp-panel.js's getCurrentEfspRefusal() owns the record and its lifetime —
 * it is populated before the render that follows a refusal and nulled before
 * the render that follows a dismissal, so this file only ever READS it and
 * never clears anything.
 *
 * A null `stripId` means the refused op named no single Strip (a CreateStrip,
 * an airspace op). That means MARK NOTHING. It emphatically does not mean
 * "mark whatever is selected" — the selected Strip is usually not the one that
 * was refused, and marking it would be a false accusation.
 */
function _refusalForStrip(strip) {
  const refusal = typeof getCurrentEfspRefusal === 'function' ? getCurrentEfspRefusal() : null;
  if (!refusal || !refusal.stripId || !strip) return null;
  return refusal.stripId === strip.stripId ? refusal : null;
}

// The `at` of the refusal whose thrown-away text has already been put back
// into a Block editor. Seeding is once per refusal, not once per render: the
// Strip rebuilds repeatedly while the banner is up (30s), and re-seeding would
// overwrite the correction the controller is in the middle of typing.
let _seededRefusalAt = null;

/**
 * Re-opens the Block editor a refused edit closed, holding the refused text
 * (lane 2's F-207).
 *
 * The input closes on Enter, BEFORE the server replies, so on a refusal the
 * Block reverts to its old value and the typed text exists nowhere on screen
 * at all: "to correct a long route, the controller retypes all of it from
 * memory." The refusal carries it (`value`), so it goes back into the cell to
 * be corrected rather than retyped.
 *
 * `{blockId: '7', value: null}` is a legitimate combination — a refused
 * confirmVacated names a cell but threw no text away. The cell is still marked
 * (see _buildBlockCell); there is simply nothing to seed.
 *
 * Seeds a placeholder into _openBlockEdit and lets the existing restore path
 * do the rest: _shouldRestoreBlockEdit picks it up, _startBlockEdit re-opens
 * the input with the draft and WITHOUT stealing focus, exactly as it does for
 * an edit somebody walked away from.
 */
function _maybeSeedRefusedBlockEdit(strip, refusedBlockId, blockId = refusedBlockId) {
  const refusal = _refusalForStrip(strip);
  if (!refusal || refusal.blockId !== refusedBlockId || refusal.value == null) return;
  if (_seededRefusalAt === refusal.at) return;
  // Never over the top of an edit the controller has open somewhere else —
  // one open edit on the Board is the standing rule (_openBlockEdit).
  if (_openBlockEdit) return;
  _seededRefusalAt = refusal.at;
  _openBlockEdit = { stripId: strip.stripId, blockId, draft: refusal.value, input: null, close: () => {} };
}

// The board-wide double-tap guard (guide §3.5 rule 3, lane 1's F-101).
//
// crc-sync has a 400ms guard too, keyed per stripId, and that is the right key
// for the bug it was written for: one controller pressing one Strip's button
// twice. It is structurally incapable of catching this one. The first press
// transfers the Strip away, the Rack reflows, and the NEIGHBOUR's button is
// now exactly where the pointer is — so the second tap is an ordinary first
// click on a different Strip, which no per-Strip guard can see.
//
// Lane 4 measured it on every transfer-shaped step, and the worst case is the
// one to design against: a double-tap on "Hand Off to APP" pressed "Line Up
// and Wait" for the jet that slid up underneath. The Strip that arrives under
// the pointer need not even be in the same state as the one tapped, so this is
// a runway clearance nobody gave.
//
// Hence a board-wide window: any advancing press within DOUBLE_TAP_MS of
// another advancing press is discarded. Silently, and raising no banner —
// §3.5 rule 3 is explicit that a double tap is "success, not an error", and
// the server's own guard was deliberately left as a silent no-op for the same
// reason. The cost is that a controller who genuinely meant two presses inside
// 400ms presses once more.
//
// efsp-nla.js has exported isWithinDoubleTapWindow/DOUBLE_TAP_MS for exactly
// this since Phase 1 ("so the button visibly disables … without waiting on a
// round trip") and nothing in app/public/js had ever called it.
let _lastAdvancingPressAt = null;

/** @returns {boolean} true when this press is the tail of a double tap and must be dropped. */
function _swallowRepeatAdvance() {
  const now = Date.now();
  if (typeof isWithinDoubleTapWindow === 'function' && isWithinDoubleTapWindow(_lastAdvancingPressAt, now)) return true;
  _lastAdvancingPressAt = now;
  return false;
}

function _blockLabel(fdr, strip, blockId) {
  const { value } = resolveBlockValue(blockId, fdr, strip);
  if (value == null || value === '') return '';
  if (typeof value === 'boolean') return value ? '✓' : '';
  return String(value);
}

/**
 * Renders one Block as a span, or — for editable Blocks — a click-to-edit
 * cell (guide §3.7 rule 5 / §7.4 rule 2: Enter commits, Esc reverts, NO
 * auto-commit on blur).
 *
 * At most ONE free-text edit is open on the whole Board, held in
 * _openBlockEdit: starting a second one closes the first without sending
 * anything, since blur must never commit. That is now enforced rather than
 * merely claimed — this comment asserted it for a long time while nothing
 * implemented it, and clicking ALT then DEP left two open inputs on one
 * Strip, each of which froze it (lane 2's F-204).
 *
 * If the Block being built is the one with that open edit, the input is
 * rebuilt in place of the span carrying whatever had been typed — the edit
 * survives the rebuild rather than blocking it (see _isProtectedStripEl).
 */
function _buildBlockCell(strip, blockId) {
  const fdr = getEfspFdr(strip.fdrId);
  const span = document.createElement('span');
  span.className = 'efsp-block efsp-block-' + blockId;
  span.dataset.block = blockId;
  span.textContent = _blockLabel(fdr, strip, blockId);

  // F-103, at cell resolution — a refused SetBlock names the Block it was
  // about, so the cell that was rejected says so rather than leaving the
  // banner to be matched against a Strip by eye. Marked whether or not there
  // is text to put back: a refused confirmVacated carries no value, and which
  // cell was refused is a separate question from what was in it.
  const redirect = typeof editRedirectFor === 'function' ? editRedirectFor(blockId, strip.role, fdr) : null; // UI-A U4
  const refusal = _refusalForStrip(strip);
  if (refusal && refusal.blockId === (redirect ? redirect.blockId : blockId)) {
    span.classList.add('efsp-block-refused');
    span.title = refusal.message;
  }
  const hint = typeof blockValueHintFor === 'function' ? blockValueHintFor(blockId, fdr, strip) : null; if (hint) { if (hint.estimated) span.classList.add('efsp-block-estimated'); if (hint.behindPlan) span.classList.add('efsp-block-behind-plan'); if (hint.title && !span.title) span.title = hint.title; } // docs/adr/0073: §10.5's source on hover, an estimate in italics

  // WP4A gap-closure (docs/adr/0022) — restricted-enum Blocks (airspace
  // ownership, track-degradation flag) get a <select>, never the generic
  // free-text click-to-edit path below — this is the first UI either field
  // has ever had (both had a working server-side setter and zero way to
  // reach it). Checked before isBlockEditable() since these Blocks are
  // deliberately excluded from that generic path (see strip-template.js's
  // isBlockEditable comment).
  const enumOptions = enumSelectOptionsFor(blockId, fdr); // the FDR: 9F offers a retired route its flight still flies (docs/adr/0073)
  if (enumOptions) return _buildEnumSelectCell(strip, blockId, span, enumOptions);

  // WP4A second slice — IFR (a boolean, not a restricted-value string enum)
  // gets a click-to-toggle affordance instead, same "checked before
  // isBlockEditable()" reasoning as the enum-<select> case above.
  if (isBooleanToggleBlock(blockId)) return _buildBooleanToggleCell(strip, blockId, span);

  // UI-A U4: TYPE (3) is a composite; editing it edits the aircraft type (3A).
  if (redirect) {
    span.dataset.editBlock = redirect.blockId;
    span.dataset.editValue = redirect.value;
    span.title = span.title || 'Aircraft type (3A). Click to edit.';
  }
  if (!redirect && !isBlockEditable(blockId, strip.role)) return span;

  span.classList.add('efsp-block-editable');
  span.tabIndex = 0;
  // F-207 — if this is the cell a refusal just emptied, put the text back into
  // an open editor before either _shouldRestoreBlockEdit call below.
  _maybeSeedRefusedBlockEdit(strip, redirect ? redirect.blockId : blockId, blockId);
  const startEdit = (e) => {
    e.stopPropagation(); // never trigger _selectStrip/drag on the parent Strip
    _startBlockEdit(strip, blockId, span);
  };
  span.addEventListener('click', startEdit);
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(e); }
  });
  // This cell used to stopPropagation() its pointerdown so the Strip's
  // drag-start handler could not see it — a <span> is not caught by
  // _onStripPointerDown's `button, input, …` guard. It no longer needs to, and
  // must not: with F-105's 44x44 targets that guard covered most of the Strip
  // and left it barely draggable. The Strip now defers its pointer capture to
  // the drag threshold instead, so a press here is an ordinary click until it
  // becomes a real drag — see _capturePointer for the whole argument.

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
    // `span` has a parent here (the wrapper), so the restored input swaps
    // itself in and the ⌿ button beside it is left alone — exactly what a
    // live click-to-edit on this cell does.
    if (_shouldRestoreBlockEdit(strip, blockId)) _startBlockEdit(strip, blockId, span, _openBlockEdit.draft);
    return wrapper;
  }

  // A detached `span` cannot replaceWith() itself, so the restored input is
  // returned in its place; closing the edit puts the same span back.
  if (_shouldRestoreBlockEdit(strip, blockId)) return _startBlockEdit(strip, blockId, span, _openBlockEdit.draft);

  return span;
}

/**
 * Is this cell the one open Block edit, being rebuilt underneath it?
 *
 * Once per built Strip: a Block with more history than its chip can show
 * appears BOTH as a chip and as an expanded-view row (see
 * _expandedBlockIdsFor), and restoring the edit into both would put two
 * inputs on the Strip — the state F-204's second half is about.
 */
function _shouldRestoreBlockEdit(strip, blockId) {
  if (_restoredEditInThisStrip) return false;
  if (!_openBlockEdit) return false;
  if (_openBlockEdit.stripId !== strip.stripId || _openBlockEdit.blockId !== blockId) return false;
  _restoredEditInThisStrip = true;
  return true;
}

// The keys that move the highlight on a CLOSED <select> — every one of them
// fires a 'change' event in Chromium without the controller having chosen
// anything. See _buildEnumSelectCell.
const ENUM_SELECT_NAV_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp'];

/**
 * WP4A gap-closure (docs/adr/0022) — a click-to-reveal <select> for a
 * restricted-enum Block (airspace ownership, track-degradation flag).
 * Mirrors _buildBlockCell's click-to-edit shape (span -> input swap) but
 * with a fixed option list instead of free text, so an invalid value is
 * structurally unreachable from the UI, not just server-rejected.
 *
 * ONE contract with the free-text cell (lane 2's F-205 asked for the split to
 * be resolved): Enter commits, Esc reverts, and blur never sends a Mutation.
 * The one difference that remains is what happens to the widget on blur — a
 * free-text cell stays open, because it holds text the controller typed and
 * throwing it away is a loss; a picker holds nothing they authored, so it
 * closes. A mouse pick still commits on 'change', because that gesture IS the
 * choice.
 */
function _buildEnumSelectCell(strip, blockId, span, options) {
  span.classList.add('efsp-block-editable', 'efsp-block-enum');
  span.tabIndex = 0;
  const open = (e) => {
    e.stopPropagation();
    const select = document.createElement('select');
    select.className = 'efsp-block-input efsp-block-enum-select';
    const currentValue = span.textContent || '';
    const clearable = typeof isEnumBlockClearable === 'function' && isEnumBlockClearable(blockId);
    // "—" was offered on all six enum Blocks and did nothing on any of them —
    // the change handler returned early on an empty value, so a Block set by
    // mistake could never be put back and the picker just closed (F-206,
    // standing rule 1: an enabled choice that does nothing). Only RSVC and
    // SREG accept a clear; the other four either have a cleared value already
    // in their own option list ('NONE', 'CLEAN') or cannot meaningfully be
    // blank at all — strip-template.js's ENUM_CLEARABLE_BLOCKS carries the
    // server's per-Block answer.
    //
    // So for those four "—" is not offered once there is something to clear.
    // It stays while the Block is UNSET, and has to: the picker must be able
    // to show an unset Block rather than silently reading as its first option,
    // and without it the first real pick would not change selectedIndex and so
    // would fire no 'change' at all.
    if (clearable || !currentValue) {
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '—';
      select.appendChild(blank);
    }
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    }
    select.value = currentValue;
    // Removing a focused element from the DOM fires 'blur' on it — so
    // select.replaceWith(span) inside the 'change' handler below ALWAYS
    // triggers the 'blur' listener's revert() right after, which then tried
    // to replaceWith() an already-detached `select` a second time and threw
    // ("the node to be removed is no longer a child of this node"). Guard
    // both paths with a single-fire flag instead of relying on either one
    // running at most once on its own.
    let closed = false;
    const revert = () => { if (closed) return; closed = true; select.replaceWith(span); };
    const commit = () => {
      if (closed) return;
      closed = true;
      const value = select.value;
      select.replaceWith(span);
      if (value === currentValue) return; // no-op pick, don't send a Mutation for nothing
      if (!value && !clearable) return;   // "—" on a Block that has no clear; not offered, so not reachable
      const actingPositionId = _resolveActingPositionId(strip);
      if (!actingPositionId) return;
      const currentStrip = getEfspStrip(strip.stripId) || strip;
      // A clear is the '' the <select> itself holds, not a null spelled here:
      // fdr-store.js's setTofi() normalizes it, so "cleared" has one spelling
      // server-side rather than two.
      sendEfspMutation(actingPositionId, currentStrip, { kind: 'SetBlock', blockId, value });
    };
    // Chromium fires 'change' for EVERY arrow press on a CLOSED <select>, so
    // committing on 'change' alone amended a clearance the instant a
    // controller pressed ↓ to see what the options were, and took the picker
    // away with it (F-205). Arrowing is looking; Enter is choosing. The flag
    // is cleared again whenever the picker itself is being opened (Space, or
    // Alt+↓, or a pointer press), because the 'change' that a pick inside the
    // open popup produces IS a choice — and while that popup is open Chromium
    // delivers no keydown to the page at all, so nothing else can set it.
    let navigating = false;
    select.addEventListener('change', () => { if (!navigating) commit(); });
    select.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); revert(); return; }
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); return; }
      if (ev.key === ' ' || ev.altKey) { navigating = false; return; }
      if (ENUM_SELECT_NAV_KEYS.includes(ev.key)) navigating = true;
    });
    select.addEventListener('blur', revert);
    select.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); navigating = false; });
    span.replaceWith(select);
    select.focus();
  };
  span.addEventListener('click', open);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  // No pointerdown guard — see _buildBlockCell and _capturePointer.
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
  // No pointerdown guard — see _buildBlockCell and _capturePointer.
  return span;
}

// The ONE free-text Block edit open anywhere on the Board, and the draft in
// it. `{ stripId, blockId, draft, input, close }`.
//
// Two things need it (both lane 2's F-204, which are one defect):
//  - starting an edit closes any other, so a controller cannot leave an open
//    input behind on Strip after Strip. _buildBlockCell's comment promised
//    this for a long time and nothing implemented it.
//  - an ABANDONED edit survives a rebuild instead of blocking one. The Strip
//    is only protected from reconciliation while its input actually has focus
//    (_isProtectedStripEl); once focus has left, the Strip rebuilds normally
//    — picking up everyone else's changes, moving Bay on a hand-off — and the
//    input is put back from here with what had been typed still in it. Blur
//    still neither commits nor reverts (§3.7 rule 5 / §7.4 rule 2): nothing
//    below sends a Mutation, and nothing discards the draft.
let _openBlockEdit = null;

// Set while ONE Strip element is being built, so the open edit is restored
// into exactly one of its cells. See _shouldRestoreBlockEdit.
let _restoredEditInThisStrip = false;

/** Closes the open edit, if any, sending nothing — the cell goes back to showing its value. */
function _closeOpenBlockEdit() {
  const open = _openBlockEdit;
  if (!open) return;
  _openBlockEdit = null;
  open.close();
}

/**
 * Opens (or, with `draft`, re-opens) the click-to-edit input for one Block.
 *
 * `draft` is passed only by _buildBlockCell rebuilding a Strip underneath an
 * edit somebody walked away from. The input then comes back holding what they
 * had typed and does NOT take focus — focus is somewhere else entirely, which
 * is precisely why the Strip was rebuildable at all.
 *
 * @returns {HTMLInputElement} the input, for the caller that has to place it.
 */
function _startBlockEdit(strip, blockId, span, draft) {
  const restoring = draft !== undefined;
  if (!restoring) _closeOpenBlockEdit(); // one open edit on the Board, never two

  // UI-A U4: a redirected cell (TYPE) edits another Block's value.
  const sendBlockId = span.dataset.editBlock || blockId;
  const currentValue = span.dataset.editValue != null ? span.dataset.editValue : span.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'efsp-block-input';
  // Carry the refusal mark onto the input, not just the span it replaces.
  // The reopened editor IS the F-207 path — the controller is looking at the
  // very text the server rejected — and _buildBlockCell had put the mark on a
  // span that replaceWith() takes off screen at exactly that moment, so the
  // cell said nothing while it mattered most. The Strip-level outline was
  // still up, but "which cell" is the question F-103 exists to answer.
  if (span.classList.contains('efsp-block-refused')) {
    input.classList.add('efsp-block-refused');
    if (span.title) input.title = span.title;
  }
  input.value = restoring ? draft : currentValue;

  let closed = false;
  const revert = () => {
    if (closed) return;
    closed = true;
    if (_openBlockEdit && _openBlockEdit.input === input) _openBlockEdit = null;
    input.replaceWith(span);
  };
  const commit = () => {
    if (closed) return;
    const value = input.value.trim();
    revert();
    // S-L16 W5: retyping a SHOWN ESTIMATE is not a no-op, it accepts the estimate as the actual.
    if (value === currentValue && !span.classList.contains('efsp-block-estimated')) return; // no-op edit, don't send a Mutation for nothing
    const actingPositionId = _resolveActingPositionId(strip);
    if (!actingPositionId) return;
    // Read the CURRENT Strip (for its rev) rather than the `strip` this
    // cell's DOM was built against — editing two different Blocks on the
    // same Strip back-to-back (e.g. 3A then 3B) otherwise sends the second
    // edit's baseRev from a snapshot the first edit's own ack had already
    // moved past, and it comes back rejected as STALE_REV even though
    // nothing else touched the Strip in between.
    const currentStrip = getEfspStrip(strip.stripId) || strip;
    sendEfspMutation(actingPositionId, currentStrip, { kind: 'SetBlock', blockId: sendBlockId, value });
  };

  // Keeps the draft where a rebuild can find it. Enter/Esc are handled on the
  // Strip's own keydown listener too (selection) — that handler stands aside
  // for anything focused inside the Strip, see _onStripKeydown.
  input.addEventListener('input', () => {
    if (_openBlockEdit && _openBlockEdit.input === input) _openBlockEdit.draft = input.value;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
  // Deliberately NO 'blur' handler at all — guide §3.7 rule 5 / §7.4 rule 2
  // is explicit that blur must never amend a clearance, and reverting on blur
  // would throw away what was typed just as silently. Blur leaves the input
  // open with its draft intact; Escape and Enter are the only two ways it
  // closes on purpose, and starting a different edit closes it too.

  _openBlockEdit = { stripId: strip.stripId, blockId, draft: input.value, input, close: revert };
  if (span.parentNode) span.replaceWith(input);
  if (!restoring) { input.focus(); input.select(); }
  return input;
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
    // A Drop removes the Strip from the Bay outright, so it both arms and is
    // caught by F-101's board-wide window. The two-press arming above already
    // makes an accidental FIRST press harmless; this covers the second press
    // landing on a Strip that slid up under the pointer.
    if (_swallowRepeatAdvance()) return;
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
const CHIP_HISTORY_LIMIT = 1;

/**
 * Renders §3.7's struck-through history into `container`.
 *
 * Rule 2:
 *
 *   "A superseded value MUST remain visible in the same Block, rendered
 *    struck through, until the Strip is DROPPED. Where space does not permit,
 *    the Block MUST render an overflow indicator and expose full history on
 *    tap — modelled on ATOP's `*` convention."
 *
 * Two shapes. In the expanded view (`limit` Infinity) the whole chain, oldest
 * first, above the current value. On a field (`limit` CHIP_HISTORY_LIMIT) it
 * goes in the LABEL line instead: the latest superseded value, small and
 * struck, then `+N` for the rest. The current value keeps the field to itself —
 * it used to share it with two struck priors, which on a much-amended ALT
 * pushed the altitude actually in force out of view.
 *
 * Renders NOTHING when there is no prior entry — the common case is a Block
 * written once or never, and it must not sprout an empty container.
 */
function _appendAnnotationHistory(container, strip, blockId, limit) {
  if (typeof supersededAnnotationEntries !== 'function') return;
  const prior = supersededAnnotationEntries(strip, blockId);
  if (prior.length === 0) return;

  const chip = Number.isFinite(limit);
  // Newest first on a field, so the one shown is the value just replaced.
  const shown = chip ? prior.slice(-limit).reverse() : prior;
  const hidden = prior.length - shown.length;

  const history = document.createElement('span');
  history.className = 'efsp-annotation-history';

  for (const entry of shown) {
    const span = document.createElement(chip ? 's' : 'span');
    // PREPLANNED gets its own muted state rather than being lumped in with
    // SUPERSEDED: it is a distinct status the server can produce.
    const suffix = entry.status === 'STRUCK' ? 'struck'
      : entry.status === 'PREPLANNED' ? 'preplanned'
        : 'superseded';
    span.className = 'efsp-annotation-entry efsp-annotation-entry-' + suffix;
    span.textContent = entry.value == null ? '' : String(entry.value);
    span.title = `${entry.status.toLowerCase()}${entry.by ? ' by ' + entry.by : ''}`;
    history.appendChild(span);
  }

  if (hidden > 0) {
    // ATOP's convention for state the field cannot render. It opens the
    // expanded view, which is the "full history on tap" the rule requires.
    const overflow = document.createElement('button');
    overflow.className = 'efsp-annotation-overflow';
    overflow.textContent = `+${hidden}`;
    overflow.title = `${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'} — open the full history`;
    overflow.addEventListener('click', (e) => {
      e.stopPropagation();
      _expandedStripId = strip.stripId;
      renderAllOpenEfspBays();
    });
    overflow.addEventListener('pointerdown', (e) => e.stopPropagation());
    history.appendChild(overflow);
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
  btn.title = expanded ? 'Collapse (Esc)' : 'Show every Block for this Strip';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _expandedStripId = expanded ? null : strip.stripId;
    renderAllOpenEfspBays();
  });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  container.appendChild(btn);
}

/**
 * The Blocks that have no chip, with their full §3.7 history.
 *
 * The surface `DELIBERATELY_NOT_IN_COMPACT_VIEW` has been promising since it
 * was written: its entries said "annotation editor" for a thing that did not
 * exist, so a fully implemented, guide-required Block could be excused from
 * the reachability test and reachable from nowhere.
 *
 * Shows only what the chips do not — see _expandedBlockIdsFor. Rendered in
 * BLOCK MAP ORDER, deliberately rather than by default: that is the order of
 * the paper strip and of the guide's own §6.2/§6.3 tables, so it is learnable
 * and stable — unlike any ordering derived from a property that changes as the
 * Strip is worked.
 *
 * The editable cell is _buildBlockCell unchanged, so free text, the enum
 * <select>, the boolean toggle and the confirmVacated button all arrive with
 * their Enter-commits / Esc-reverts / never-on-blur contract intact rather
 * than being reimplemented in a second surface.
 */
/**
 * Which Blocks the expanded view lists — what is NOT already on the Strip.
 *
 * It listed every Block for the Role at first, which made it mostly a second
 * copy of the chips a controller was already looking at: 26 of ~30 rows said
 * nothing new, and the handful that did were buried. The panel's job is
 * reaching what the chips cannot, so that is all it shows.
 *
 * One exception, and it is load-bearing rather than a nicety: a chip whose
 * history is truncated renders a `*` that promises "full history on tap"
 * (§3.7 rule 2), and this panel is where that tap lands. Filtering such a
 * Block out because it already has a chip would make the indicator point at
 * nothing — so a Block with more priors than the chip can show stays in,
 * precisely because the chip is not telling the whole story.
 */
function _expandedBlockIdsFor(strip, map) {
  const onStrip = new Set(compactBlocksFor(strip.role, strip.ownerPositionId, getEfspFdr(strip.fdrId)));
  return Object.keys(map).filter((blockId) => {
    if (!onStrip.has(blockId)) return true;
    return typeof supersededAnnotationEntries === 'function'
      && supersededAnnotationEntries(strip, blockId).length > CHIP_HISTORY_LIMIT;
  });
}

function _appendExpandedView(el, strip) {
  if (_expandedStripId !== strip.stripId) return;
  const map = (typeof BLOCK_MAPS === 'object' && BLOCK_MAPS[strip.role]) || null;
  if (!map) return;

  const blocks = _expandedBlockIdsFor(strip, map);
  // §9.4's lost-comms rule (crc-sync's docs/adr/0062): a grey note, first in
  // the expanded view, for a flight with MTR data. Not a reason line and not
  // on the collapsed face — an MTR flight with working radios is not wrong
  // (docs/adr/0058).
  const advisory = typeof mtrLostCommsAdvisory === 'function' ? mtrLostCommsAdvisory(getEfspFdr(strip.fdrId)) : null;
  if (blocks.length === 0 && !advisory) return;

  const panel = document.createElement('div');
  panel.className = 'efsp-strip-expanded';
  if (advisory) {
    const note = document.createElement('div');
    note.className = 'efsp-expanded-note efsp-mtr-lostcomms';
    note.textContent = advisory;
    panel.appendChild(note);
  }

  for (const blockId of blocks) {
    const row = document.createElement('div');
    row.className = 'efsp-expanded-row';
    row.dataset.expandedBlock = blockId;

    const label = document.createElement('span');
    label.className = 'efsp-expanded-label';
    label.textContent = blockLabelFor(blockId, strip.role) || blockId;
    const labelTitle = typeof blockTitleFor === 'function' ? blockTitleFor(blockId, getEfspFdr(strip.fdrId), strip) : null; if (labelTitle) label.title = labelTitle; // docs/adr/0073
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

  // A second way out, at the END of the rows (lane 2's F-208). The expanded
  // view is ~22 rows on a DEPARTURE Strip — 684px in a Bay viewport a third
  // of that — and the only control that closed it was the ▲ in the actions
  // row ABOVE them all, 423px off the top of the Bay by the time a controller
  // had scrolled down to read the last row. Escape on the Strip closes it too
  // (_onStripKeydown); this is the pointer half of the same fix, and it is
  // labelled rather than a bare glyph because at the bottom of a long list
  // there is no actions row beside it to say what it belongs to.
  const collapse = document.createElement('button');
  collapse.className = 'efsp-expanded-collapse';
  collapse.textContent = '\u25b2 Collapse';
  collapse.title = 'Collapse this Strip (Esc)';
  collapse.addEventListener('click', (e) => {
    e.stopPropagation();
    _expandedStripId = null;
    renderAllOpenEfspBays();
  });
  collapse.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (typeof appendAtoExpandedRows === 'function') appendAtoExpandedRows(panel, strip); // docs/adr/0071 — read-only
  panel.appendChild(collapse);

  el.appendChild(panel);
}

function _buildStripEl(strip) {
  _restoredEditInThisStrip = false; // an open Block edit is restored into exactly one cell of this Strip
  const fdr = getEfspFdr(strip.fdrId);
  const el = document.createElement('div');
  el.className = 'efsp-strip';
  el.dataset.stripId = strip.stripId;
  el.dataset.rev = String(strip.rev); // renderBay()'s keyed reconciliation reuse check
  // Expansion is CLIENT-LOCAL state and does not move `rev`, so the
  // reconciler cannot see a toggle unless the rendered element records what it
  // was built as — exactly the problem selection already had, solved the same
  // way. Without this the toggle set _expandedStripId, asked for a re-render,
  // and the reconciler reused every element unchanged: nothing on screen moved.
  el.dataset.expanded = _expandedStripId === strip.stripId ? '1' : '0';
  // Everything this element renders that lives OUTSIDE the Strip record —
  // strip.nla, the FDR, siblings, obligation, MARSA, correlation, airspace,
  // the refusal. Same mechanism as `expanded` above, generalized: see
  // _stripRenderSignature for the six surfaces that were stale without it.
  el.dataset.sig = _stripRenderSignature(strip);
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

  // F-103 — a refusal left no mark at all on the Strip it was about, so the
  // banner had to be matched to a Strip by reading the callsign back off it.
  // Honours a null stripId as "mark nothing" (see _refusalForStrip).
  const refusal = _refusalForStrip(strip);
  if (refusal) {
    el.classList.add('efsp-strip-refused');
    el.dataset.refusedReason = refusal.reason || '';
    el.title = refusal.message;
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
    // Layout C (docs/adr/0056): tab | fields | tools. strip-view.js.
    _buildStripLayout(el, strip, obligation);
  }

  // Flip: dblclick. Highlight: right-click (contextmenu) opens a 3-swatch
  // popover, or Ctrl+click steps the colour. Offset: Alt+click. Attention: Shift+click. All three guarded the same way the
  // NLA/offset buttons are guarded against drag-start (_onStripPointerDown
  // already ignores pointerdown on interactive children; these fire on the
  // Strip body itself, so they're gated here instead by checking e.target
  // isn't an editable Block cell — clicking IN a Block cell must never also
  // toggle Attention).
  el.addEventListener('click', (e) => {
    if (e.target.closest(STRIP_CONTROL_SELECTOR)) return;
    if (e.shiftKey) { const acting = _dispatchGesture(strip, setAttention, 'red'); if (typeof noteEfspGesture === 'function') noteEfspGesture('ATTENTION', 'shift-click', acting); return; }
    // S-L15 (§7.3 one-input ceiling): OFFSET and HIGHLIGHT each get a one-input entry point.
    // The ⋯ menu item and the right-click swatches stay for whoever prefers them (2 inputs).
    if (e.altKey) { e.preventDefault(); const acting = _dispatchGesture(strip, toggleOffset); if (typeof noteEfspGesture === 'function') noteEfspGesture('OFFSET', 'alt-click', acting); return; }
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const acting = _cycleHighlight(strip); if (typeof noteEfspGesture === 'function') noteEfspGesture('HIGHLIGHT', 'ctrl-click', acting); return; }
    _selectStrip(strip.stripId);
  });
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest(STRIP_CONTROL_SELECTOR)) return;
    const acting = _dispatchGesture(strip, toggleFlip); if (typeof noteEfspGesture === 'function') noteEfspGesture('FLIP', 'dblclick', acting);
  });
  el.addEventListener('contextmenu', (e) => {
    if (e.target.closest(STRIP_CONTROL_SELECTOR)) return;
    e.preventDefault();
    _openHighlightPopover(strip, el);
  });
  el.addEventListener('pointerdown', (e) => _onStripPointerDown(e, strip));
  el.addEventListener('keydown', (e) => _onStripKeydown(e, strip));

  return el;
}


// ── The popover portal (F-001, F-108, F-109) ─────────────────────────────
//
// All six popovers used to be appended INSIDE the Strip that opened them, and
// every one of them was painted underneath the rest of the panel. It is not a
// z-index that lost a fight: `.efsp-strip` carries `contain: layout style`,
// and `contain: layout` CREATES A STACKING CONTEXT — so a popover's
// `z-index: 50` only ever competed with its own Strip's children, while the
// Strip itself is `z-index: auto` and everything painted after it (the next
// Strip down, the dot-command input, dockview's own containers) sat on top.
// Measured with elementFromPoint at each popover's centre: six popovers, six
// other elements. The CSS comment on `.efsp-strip` records `contain: paint`
// being dropped because it CLIPPED popovers — that fixed the visible half and
// left this one, so re-examining `paint` alone would have missed it entirely.
//
// The same containment has two further consequences, and a fix that only wins
// the stacking contest leaves both standing:
//   - what overflows a contained Strip is INK overflow, so the Bay's
//     scrollHeight never grew to include the popover: scrolling to the bottom
//     of the Bay still did not reach a popover hanging below it (lane 3
//     measured scrollHeight 211 against a popover bottom ~330 px in);
//   - a popover opened from a Strip near the bottom of a short Bay ran off the
//     end of the panel altogether, into dockview — the Coordinate popover was
//     not in a screenshot of #efsp-panel at all.
//
// `contain: layout style` is load-bearing (§7.5 rule 5's reflow isolation, and
// F-208's sticky trailing row now depends on the containing block it makes) so
// it stays and the popover leaves instead: `position: fixed` on document.body,
// placed from the anchor's viewport rect, flipped above the anchor when it
// would run off the bottom and clamped into the viewport otherwise. One move
// escapes the stacking context, the containment and the Bay's overflow, and it
// needs no CSS — every placement declaration here is an inline style.
//
// It dissolves F-110 and the MARSA/bind half of F-201 as a side effect. Those
// two anchored the popover inside the <button> that opens it, so any click in
// the popover bubbled back to that button and rebuilt the popover empty (and a
// Space typed in a field activated the button, with the same result). A
// portalled popover is not a descendant of anything that handles its clicks.

// Which Strip each open popover belongs to, and how to close it.
// _isProtectedStripEl used to ask `stripEl.contains(popoverEl)`, which a
// portalled popover answers false to every time — the protection all six rely
// on would have evaporated silently. It is keyed on the Strip id now.
const _openPopovers = new Map(); // popover element -> { stripId, anchorEl, close }

// Above the panel chrome (.efsp-bay-tabs and the topbar are 50, the airport
// selector 100) and below srs-radio.css's full-screen modal at 200, which
// genuinely should cover a Strip popover.
const POPOVER_Z_INDEX = '150';
const POPOVER_VIEWPORT_MARGIN = 4;

let _popoverTracking = false;
let _postPopoverRenderTimer = null;

function _popoverRoot(anchorEl) {
  return (typeof document !== 'undefined' && document.body) || anchorEl;
}

/**
 * Place a portalled popover against its anchor, in viewport coordinates.
 *
 * Two passes, because the flip decision needs the popover's own height and
 * nothing knows that until it has been laid out. Both happen inside one call,
 * before the browser paints, so there is no visible jump.
 */
function _placePopover(popover, anchorEl) {
  if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return;
  const a = anchorEl.getBoundingClientRect();
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
  const m = POPOVER_VIEWPORT_MARGIN;

  // The CSS puts these at `top: 100%` with `left`/`right` offsets against the
  // Strip; fixed positioning has to neutralise the axis it does not set.
  popover.style.position = 'fixed';
  popover.style.right = 'auto';
  popover.style.bottom = 'auto';
  popover.style.left = '0px';
  popover.style.top = '0px';

  const r = popover.getBoundingClientRect();
  const w = r.width || 0;
  const h = r.height || 0;

  // Below the anchor by default; above it when that would run off the bottom
  // of the viewport, which is the case that made Coordinate and TOFI invisible
  // on a short Bay. Clamped if it fits neither way — a popover pinned to the
  // bottom edge overlapping its anchor still beats one nobody can see.
  let top = a.bottom + m;
  if (vh && top + h > vh - m) {
    const above = a.top - m - h;
    top = above >= m ? above : Math.max(m, vh - m - h);
  }
  let left = a.left;
  if (vw) left = Math.min(left, vw - m - w);
  left = Math.max(m, left);

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function _mountPopover(popover, anchorEl, strip, close) {
  popover.style.zIndex = POPOVER_Z_INDEX;
  _popoverRoot(anchorEl).appendChild(popover);
  _openPopovers.set(popover, { stripId: strip && strip.stripId, anchorEl, close });
  _placePopover(popover, anchorEl);
  _startPopoverTracking();
}

function _unmountPopover(popover) {
  if (!popover) return;
  if (popover.parentNode) popover.parentNode.removeChild(popover);
  _openPopovers.delete(popover);
  if (_openPopovers.size === 0) _stopPopoverTracking();
  _requestPostPopoverRender();
}

/** Does any open popover belong to this Strip? The portalled replacement for six `el.contains(...)` checks. */
function _stripHasOpenPopover(stripId) {
  if (!stripId) return false;
  for (const entry of _openPopovers.values()) if (entry.stripId === stripId) return true;
  return false;
}

function _closeAllPopovers() {
  for (const entry of [..._openPopovers.values()]) entry.close();
}

// A fixed element does not move when the Bay scrolls or the window resizes,
// so it has to be told. Capture phase on `scroll`: the Bay scrolls, not the
// window, and a scroll event on an inner element does not bubble — capture is
// the only way one listener sees every scroller between here and the root.
function _startPopoverTracking() {
  if (_popoverTracking || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  _popoverTracking = true;
  window.addEventListener('scroll', _onPopoverViewportChange, true);
  window.addEventListener('resize', _onPopoverViewportChange);
  document.addEventListener('keydown', _onDocKeydownClosePopover, true);
}

function _stopPopoverTracking() {
  if (!_popoverTracking) return;
  _popoverTracking = false;
  window.removeEventListener('scroll', _onPopoverViewportChange, true);
  window.removeEventListener('resize', _onPopoverViewportChange);
  document.removeEventListener('keydown', _onDocKeydownClosePopover, true);
}

function _onPopoverViewportChange() {
  for (const [popover, entry] of [..._openPopovers]) {
    // The anchor went with its Strip (a Bay closed, a Strip transferred away).
    // A popover left floating over the panel with nothing behind it is worse
    // than one that closes.
    if (entry.anchorEl && entry.anchorEl.isConnected === false) { entry.close(); continue; }
    _placePopover(popover, entry.anchorEl);
  }
}

/**
 * Escape closes the popover (F-109).
 *
 * Not a doctrine requirement — no rule asks for it — but in this same panel
 * Escape reverts a Block edit and an enum <select> (§7.4 rule 2) and collapses
 * the expanded view, so a controller who has learned "Esc backs out" finds it
 * works on a Block and not on the popover next to it.
 *
 * On `document` in the CAPTURE phase for both halves of that: it fires wherever
 * focus happens to be (the opener <button>, a field in the popover, or nothing
 * at all), and stopping it here is what keeps the same keypress from ALSO
 * reverting the Block edit or collapsing the Strip behind the popover.
 */
function _onDocKeydownClosePopover(e) {
  if (e.key !== 'Escape' || _openPopovers.size === 0) return;
  e.preventDefault();
  e.stopPropagation();
  _closeAllPopovers();
}

/**
 * F-108 — a popover closed WITHOUT acting left its Strip out of date.
 *
 * _reconcileRackStrips skips a protected Strip on the grounds that "it
 * reconciles on a later render once unprotected", and nothing ever asked for
 * that later render: on a quiet Board the Strip kept showing whatever it
 * showed when the popover opened, indefinitely. Acting hid it, because the
 * ack's own render caught the Strip up.
 *
 * Deferred rather than called from _unmountPopover directly: every
 * _open*Popover closes the previous popover first, and a synchronous render
 * there would tear out the anchor element mid-open. By the time the timer
 * runs, a reopened popover is registered again and the render is correctly
 * skipped — the Strip is still protected.
 */
function _requestPostPopoverRender() {
  if (_postPopoverRenderTimer) return;
  _postPopoverRenderTimer = setTimeout(() => {
    _postPopoverRenderTimer = null;
    if (_openPopovers.size > 0) return;
    if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
  }, 0);
}

let _openBindPopoverEl = null;

function _closeBindPopover() {
  _unmountPopover(_openBindPopoverEl);
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
      ? window.getAllTracks().filter(t => t.domain === 'AIR').map(t => String(t.id))
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
    row.textContent = track ? pickerText(track) : String(trackId);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      _dispatchCorrelation(strip, { kind: 'BindTrack', trackId: String(trackId) });
      _closeBindPopover();
    });
    popover.appendChild(row);
  }

  _openBindPopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeBindPopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseBindPopover, true), 0);
}


let _openMarsaPopoverEl = null;

function _closeMarsaPopover() {
  _unmountPopover(_openMarsaPopoverEl);
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

  _openMarsaPopoverEl = popover;
  // F-110 lived here: `anchorEl.appendChild(popover)`, where anchorEl is the
  // MARSA… <button> whose own click handler opens it. Every click inside the
  // popover — into the declarer field, onto a candidate <select> — bubbled to
  // that button and re-ran this function, so the form was rebuilt empty on
  // every interaction and the declaration could never be completed. The
  // popover is portalled out now (see _mountPopover) and is no longer a
  // descendant of anything that reopens it. It also stops an <input> and two
  // <select>s being nested inside a <button>, which was invalid HTML.
  _mountPopover(popover, anchorEl, strip, _closeMarsaPopover);
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
  if (typeof noteEfspStripSelected === 'function') noteEfspStripSelected(_selectedStripId); // docs/adr/0072
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
  if (typeof noteEfspStripSelected === 'function') noteEfspStripSelected(_selectedStripId); // docs/adr/0072
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
  if (typeof highlightArParticipants === 'function') highlightArParticipants(_selectedStripId); // docs/adr/0071
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

/**
 * Space and Enter on a Strip toggle its selection — the keyboard half of the
 * non-drag move path (§7.8.1, WCAG 2.2 SC 2.5.7), which _onRackHeaderClick
 * then acts on.
 *
 * They belong to whatever control the controller is actually IN, though, and
 * this listener sits on the Strip element, so every key pressed inside a Block
 * input, an enum <select> or a popover field used to bubble up to it. That one
 * omission produced four catalogued defects (lane 2's F-201, F-203, F-205, and
 * half of F-202): a Space typed into a Block was preventDefault()ed and
 * toggled selection instead of being typed, and Enter committed a Block AND
 * moved the selection, so the next click on a Rack header moved a Strip nobody
 * had meant to select.
 *
 * Guarding on the event's TARGET rather than patching the four call sites is
 * deliberate: it covers every popover's fields without any of them knowing
 * about this handler, and any control added later. Neither half of the
 * mechanism could simply be deleted — this one is the drag-free move path, and
 * renderBay()'s refocus keeps focus off <body>.
 *
 * It could not reach the MARSA and bind popovers, which were a separate defect
 * rather than a gap here: those two appended their popover INTO the <button>
 * that opens it, so a Space typed in a field bubbled to the button and
 * ACTIVATED it, re-opening the popover with an empty form — no guard on this
 * handler could have helped, since the keypress never reached this handler at
 * all. Fixed where it belonged, in the anchoring: every popover is portalled
 * out of the Strip now (F-001's _mountPopover), and none of them is a
 * descendant of a control that handles its events.
 *
 * Escape collapses the expanded view (F-208) — see _appendExpandedView for
 * why that surface needs more than one way out.
 */
function _onStripKeydown(e, strip) {
  if (_keyTargetIsStripControl(e)) return;
  if (e.key === 'Escape' && _expandedStripId === strip.stripId) {
    e.preventDefault();
    _expandedStripId = null;
    renderAllOpenEfspBays();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    _selectStrip(strip.stripId);
  }
}

/**
 * Did this keydown start on a control INSIDE the Strip rather than on the
 * Strip element itself? Anything that handles Space or Enter on its own owns
 * them while it has focus: a text input, a <select>, a <button>, and the
 * click-to-edit Block cell, which is a <span tabindex="0"> with its own
 * Enter/Space handler rather than a native control.
 */
function _keyTargetIsStripControl(e) {
  const t = e.target;
  if (!t || t === e.currentTarget) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || tag === 'option') return true;
  return !!(t.classList && t.classList.contains('efsp-block-editable'));
}

// The Position a controller acts as for a Mutation on this Strip — its
// current Owner if held, else whichever held Position happens to be first.
// Shared by every dispatch helper below (NLA, move, transfer, gestures).
function _resolveActingPositionId(strip) {
  const positions = getActingPositions();
  return positions.includes(strip.ownerPositionId) ? strip.ownerPositionId : positions[0];
}

/**
 * @returns {boolean} whether a Mutation was actually sent — the caller uses it
 *   to give the press its <50ms feedback (§7.9) without lying about a press
 *   that went nowhere.
 */
function _invokeNla(strip) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return false;
  // F-101 — board-wide, because the Strip this press lands on after a reflow
  // is not the Strip the previous press was about. See _swallowRepeatAdvance.
  if (_swallowRepeatAdvance()) return false;
  sendEfspMutation(actingPositionId, strip, { kind: 'InvokeNla' });
  return true;
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

/**
 * F-107 applies to this function and to _dispatchTofi/_dispatchGesture below,
 * and to the airspace popover's "Approve entry".
 *
 * The `strip` these four are handed is the object captured when the popover
 * OPENED, and its `rev` is what sendEfspMutation sends as the optimistic-
 * concurrency base. _isProtectedStripEl deliberately stops the Strip being
 * rebuilt while a popover is open — so that captured object is *guaranteed*
 * stale the moment anyone else touches the same Strip, and pressing Send
 * returned a bare STALE_REV with the typed note gone. Exactly the case the
 * popover protection exists for, ending in a refusal.
 *
 * Re-reading the Strip at dispatch time is what the Block editor already does
 * (`getEfspStrip(strip.stripId) || strip`). Deliberately NOT applied to
 * _dispatchMarsa/_dispatchCorrelation: those two send their own relation's or
 * correlation record's current rev, not the Strip's.
 */
function _dispatchCoordination(strip, primitive, action, note) {
  strip = getEfspStrip(strip.stripId) || strip;
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  // Answering a proposal resolves the replica — ACCEPT relocates it out of the
  // Coordination Bay, REJECT takes its answer buttons away — so both reflow
  // the Rack and both are in F-101's class (lane 3 measured a double-tap on
  // Accept Hand Off accepting a second replica). PROPOSE and STAND_BY are not:
  // neither moves the Strip and neither removes a control from it.
  if ((action === 'ACCEPT' || action === 'REJECT') && _swallowRepeatAdvance()) return;
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
// H2 / H40 (docs/adr/0080): the Positions a working tactical Position may hand
// a line back to — the only place it may transfer one. A mirror of
// permission.js's TACTICAL_CAPABILITIES[*].handBackTo, held to it by
// efsp-tactical-client.test.js (the efsp-nla-client.test.js precedent). A
// holder of only JTAC has no TAC_C2 tab to drag to, so the ⋯ menu offers it.
const HAND_BACK_TO = { AIC: ['TAC_C2'], JTAC: ['TAC_C2'] };

/**
 * The Bay a hand-back lands in: the receiving Position's Bay implying the
 * Strip's state, else its first Bay implying none — the client mirror of
 * board-store.js's _bayForNewOwner (the server rule is authoritative).
 * @returns {{bayId:string, rackId:string}|null}
 */
function _handBackBayFor(strip, toPositionId) {
  const bays = getEfspBays().filter(b => b.positionId === toPositionId && (!b.facilityId || b.facilityId === strip.facilityId));
  const bay = bays.find(b => b.impliesState === strip.state) || bays.find(b => !b.impliesState) || null;
  return bay ? { bayId: bay.bayId, rackId: (bay.rackIds && bay.rackIds[0]) || 'main' } : null;
}

function _dispatchHandBack(strip, toPositionId) {
  strip = getEfspStrip(strip.stripId) || strip; // F-107 — see _dispatchCoordination
  const actingPositionId = _resolveActingPositionId(strip);
  if (actingPositionId !== strip.ownerPositionId) return; // only its owner hands a line on
  const bay = _handBackBayFor(strip, toPositionId);
  if (!bay) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'TransferStrip', toPositionId, bayId: bay.bayId, rackId: bay.rackId });
}

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
  if (_isRejectedCoordinationReplica(strip)) return false;
  // Not while a coordination is still open — a handoff replica CTR has not
  // accepted is a flight APP still works (board-store.js's _applyTofiPropose).
  if (strip.coordination && strip.coordination.state === 'PROPOSED') return false;
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
  if (_isRejectedCoordinationReplica(strip)) return false;
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

// stripId -> the regime picked in that Strip's accept select, so a rebuild
// shows what the controller chose rather than the default. Cleared when the
// exchange is answered.
const _tofiRegimeChoice = new Map();

// Anything on a Strip that is a control of its own. A click, double-click or
// right-click that lands on one of these belongs to the control, never to the
// Strip's select / flip / highlight gestures underneath it.
const STRIP_CONTROL_SELECTOR = '.efsp-block-editable, .efsp-block-input, button, select, option, label, input, textarea';

// B2 (docs/adr/0080): AIC "works under TAC_C2's TOFI", so on an AIC-held line
// the TOFI dialogue is TAC_C2's. Mirror of permission.js's TACTICAL_CAPABILITIES
// `tofiAnsweredBy`, held to it by the drift test in efsp-ui-reachability.test.js.
const TOFI_ANSWERED_BY = { AIC: 'TAC_C2' };

/** The Position a TOFI answer is sent as: the owner's TOFI answerer when this controller holds it, else the usual resolution. */
function _tofiActingPositionId(strip) {
  const answerer = strip.role === 'MISSION' ? TOFI_ANSWERED_BY[strip.ownerPositionId] : null;
  if (answerer && getActingPositions().includes(answerer)) return answerer;
  return _resolveActingPositionId(strip);
}

function _dispatchTofi(strip, action, direction, overrides = {}) {
  strip = getEfspStrip(strip.stripId) || strip; // F-107 — see _dispatchCoordination
  const actingPositionId = action === 'PROPOSE' ? _resolveActingPositionId(strip) : _tofiActingPositionId(strip);
  if (!actingPositionId) return;
  // Same class as the coordination responses above (F-101) — accepting or
  // rejecting a TOFI takes the answer buttons off the Strip and reflows the
  // Rack under the pointer. PROPOSE and TRANSFER_COMMS leave the Strip where
  // it is and take no control off it.
  if ((action === 'ACCEPT' || action === 'REJECT') && _swallowRepeatAdvance()) return;
  if (action === 'ACCEPT' || action === 'REJECT') _tofiRegimeChoice.delete(strip.stripId);
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
  _unmountPopover(_openTofiPopoverEl);
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

  _openTofiPopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeTofiPopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseTofiPopover, true), 0);
}

// Only the Positions that hold an airborne flight approve one into an
// airspace — the client mirror of permission.js's AIRSPACE_ENTRY_OP_KINDS
// grant. A range Position never appears here: it works no Strips at all.
// The Strip awaiting a second press on Convert to Arrival. Module-level
// rather than per-render, since a re-render rebuilds the button.
let _pendingConvertStripId = null;

const AIRSPACE_ENTRY_POSITIONS = ['APP', 'CTR'];

// The Positions the server lets convert a DEPARTURE into its return ARRIVAL:
// they need both the ConvertToArrival op (permission.js) and the right to
// create an ARRIVAL Strip (canCreateStripRole). efsp-coordination-client.test.js
// holds this to the server's tables.
const CONVERT_TO_ARRIVAL_POSITIONS = ['APP', 'CTR'];

/** Whether this client should offer Convert to Arrival at all (the button may still render disabled for an open link). */
function _canConvertToArrival(strip) {
  if (strip.role !== 'DEPARTURE' || strip.state !== 'HANDED_OFF') return false;
  if (!CONVERT_TO_ARRIVAL_POSITIONS.includes(strip.ownerPositionId)) return false;
  if (!getActingPositions().includes(strip.ownerPositionId)) return false;
  return !_isRejectedCoordinationReplica(strip);
}

// The field lists (COMPACT_BLOCKS_*, compactBlocksFor) live in strip-fields.js,
// loaded before this file. They are per-Position now, not only per-Role.

function _canApproveAirspaceEntry(strip) {
  if (!AIRSPACE_ENTRY_POSITIONS.includes(strip.ownerPositionId)) return false;
  if (_isRejectedCoordinationReplica(strip)) return false;
  return !!_resolveActingPositionId(strip);
}

let _openAirspacePopoverEl = null;

function _closeAirspacePopover() {
  _unmountPopover(_openAirspacePopoverEl);
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
    _openAirspacePopoverEl = popover;
    _mountPopover(popover, anchorEl, strip, _closeAirspacePopover);
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
      // F-107 — the Strip as it is NOW, not as it was when the popover opened.
      // See _dispatchCoordination.
      sendEfspMutation(actingPositionId, getEfspStrip(strip.stripId) || strip, { kind: 'ApproveAirspaceEntry', airspaceId: select.value });
    }
    _closeAirspacePopover();
  });
  popover.appendChild(sendBtn);

  _openAirspacePopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeAirspacePopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseAirspacePopover, true), 0);
}

const COORDINATION_PRIMITIVE_LABELS = {
  HANDOFF: 'Hand Off', POINT_OUT: 'Point Out', TRAFFIC: 'Traffic',
  OPERATIONAL_REQUEST: 'Operational Request', AIT: 'AIT',
};

// ── F-302/F-304 display helpers ─────────────────────────────────────────

/**
 * Is this Strip the RECEIVER's replica of the exchange, rather than the
 * sender's own flight record?
 *
 * `mintedForCoordination` is board-store.js's authoritative answer and is
 * stamped by receiveCoordinationProposal. The Bay check is the same fallback
 * the server keeps (_isRejectedReplica) for a replica minted before the field
 * existed and restored from a persisted Board.
 */
function _coordinationIsReplica(strip) {
  const co = strip.coordination;
  if (!co) return false;
  if (co.mintedForCoordination) return true;
  return strip.bayId.endsWith('-coordination');
}

/**
 * F-303: the receiver's copy of a coordination it rejected. It is inert — the
 * sender still works the flight — so it offers nothing but Drop and moving it
 * aside. board-store.js's _rejectedReplicaOpRefusal refuses the rest; this
 * keeps the controls that would only be refused off the Strip in the first
 * place. MARSA and correlation are flight-level on the server, so for those
 * two this is the only guard there is.
 */
function _isRejectedCoordinationReplica(strip) {
  return !!strip.coordination && strip.coordination.state === 'REJECTED' && _coordinationIsReplica(strip);
}

/** Which Position asked. The replica's `peerPositionId` IS the proposer; on the sender's own Strip the proposer is its owner. */
function _coordinationProposerOf(strip, co) {
  return _coordinationIsReplica(strip) ? co.peerPositionId : strip.ownerPositionId;
}

/**
 * The state in the words the primitive is actually answered in.
 *
 * OPERATIONAL_REQUEST alone is approved/unable rather than accepted/rejected
 * (coordination.js's acceptPhrase, and the Approve/Unable buttons this file
 * already renders) — a status chip that said REJECTED next to a button that
 * said Unable would be two names for one outcome.
 */
function _coordinationStateWord(co) {
  if (co.primitive !== 'OPERATIONAL_REQUEST') return co.state;
  if (co.state === 'ACTIVE') return 'APPROVED';
  if (co.state === 'REJECTED') return 'UNABLE';
  return co.state;
}

/** Which Position proposed a TOFI. The MISSION-side Strip is always the receiving MRU's record, for both directions — _isPendingTofiReplica's own split. */
function _tofiProposerOf(strip, tofi) {
  return strip.role === 'MISSION' ? tofi.peerPositionId : strip.ownerPositionId;
}

/**
 * What is stopping a proposed TOFI EXIT from being accepted, worded for the
 * side that is reading it (lane 3's F-307).
 *
 * Guide §4.6.3 rule 3 — the server refuses ACCEPT until separation_regime is
 * back to ATC. Only the ATC-side controller can do that (SREG exists on their
 * Strip alone), and until now only the MRU side was told, in the `title` of a
 * disabled button they could do nothing about.
 */
function _tofiExitPrecondition(strip, tofi) {
  if (!tofi || tofi.direction !== 'EXIT' || tofi.state !== 'PROPOSED') return null;
  const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(strip.fdrId) : null;
  const regime = (fdr && fdr.tofi && fdr.tofi.separationRegime) || null;
  if (regime === 'ATC') return null;
  const shown = regime || 'unset';
  return strip.role === 'MISSION'
    ? `SEP REG is ${shown} — ${tofi.peerPositionId} must set it back to ATC before this exit can be accepted`
    : `SEP REG is ${shown} — set it back to ATC before ${tofi.peerPositionId} can accept this exit`;
}

/** A coordination note, attributed. Rendered rather than hidden in a `title`: with a degraded track it is the mandatory record of the verbal coordination. */
function _buildCoordinationNoteEl(note, proposer) {
  const el = document.createElement('span');
  el.className = 'efsp-coordination-note';
  el.textContent = `${proposer}: “${note}”`;
  el.title = `note from ${proposer}`;
  return el;
}

/** A blocking precondition, on the Strip rather than only on a hover `title` — a tooltip has no touch equivalent (F-307). */
function _buildCoordinationReasonEl(text) {
  const el = document.createElement('span');
  el.className = 'efsp-coordination-blocked-reason';
  el.textContent = text;
  el.title = text;
  return el;
}

let _openCoordinatePopoverEl = null;

function _closeCoordinatePopover() {
  if (!_openCoordinatePopoverEl) return;
  _unmountPopover(_openCoordinatePopoverEl);
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

  _openCoordinatePopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeCoordinatePopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseCoordinatePopover, true), 0);
}

// The four paper gestures (guide §7.3, defect D4) — efsp-gestures.js's
// toggleOffset/toggleFlip/setHighlight/setAttention are pure and each
// already dispatch exactly one Mutation; this is the one shared plumbing
// point that resolves actingPositionId and hands them a bound
// sendMutation(strip, op), matching _invokeNla/_moveStrip/_transferStrip's
// own pattern. `extraArgs` covers setHighlight/setAttention's `color` param.
function _dispatchGesture(strip, gestureFn, ...extraArgs) {
  // F-107 — see _dispatchCoordination. Highlight is dispatched from a popover,
  // and setHighlight reads strip.flags to decide whether this colour clears or
  // replaces, so a stale capture gets that wrong as well as the rev.
  strip = getEfspStrip(strip.stripId) || strip;
  // A dead replica refuses every Flag write (F-303) — say nothing rather than
  // raise a refusal banner for a double-click.
  if (_isRejectedCoordinationReplica(strip)) return;
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  gestureFn(strip, ...extraArgs, (s, op) => sendEfspMutation(actingPositionId, s, op));
  return actingPositionId; // truthy only when dispatched — what the gesture metric counts (docs/adr/0072)
}

// Small, fixed swatch set for Highlight (guide §7.3) — deliberately NOT
// red, which §7.7 rule 4 reserves for Attention alone ("reserve saturated
// colour for exceptions" — if both gestures could paint the same colour,
// a controller scanning the Board couldn't tell which one they're looking
// at). setHighlight replaces a different active colour in one Mutation and
// clears on a repeat of the same colour (see efsp-gestures.test.js).
//
// Inputs, counted honestly (S-L15; the comment here used to say the swatch met the
// one-input ceiling, which it does not: right-click + swatch is TWO). The one-input
// entry point is Ctrl+click on the Strip, which steps the colour through the swatches
// and then off (_cycleHighlight). The popover remains for choosing a colour directly.
const HIGHLIGHT_SWATCHES = ['yellow', 'cyan', 'lime'];

/** The colour one Ctrl+click moves a Strip to: the next swatch, or (past the last) the last again, which clears it. */
function _nextHighlightColor(current) {
  const i = HIGHLIGHT_SWATCHES.indexOf(current);
  return i < 0 ? HIGHLIGHT_SWATCHES[0] : HIGHLIGHT_SWATCHES[Math.min(i + 1, HIGHLIGHT_SWATCHES.length - 1)];
}

function _cycleHighlight(strip) {
  const live = getEfspStrip(strip.stripId) || strip;
  return _dispatchGesture(strip, setHighlight, _nextHighlightColor(live.flags.highlight));
}

let _openHighlightPopoverEl = null;

function _closeHighlightPopover() {
  if (!_openHighlightPopoverEl) return;
  _unmountPopover(_openHighlightPopoverEl);
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
      const acting = _dispatchGesture(strip, setHighlight, color); if (typeof noteEfspGesture === 'function') noteEfspGesture('HIGHLIGHT', 'contextmenu+swatch', acting);
      _closeHighlightPopover();
    });
    popover.appendChild(swatch);
  }
  _openHighlightPopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeHighlightPopover);
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

let _efspDrag = null; // { strip, bayId, rackEl, rects, scrollEl, cacheScrollTop, insertionEl, dragEl, dragWidth, lastClientY, dropTargetEl, hasMoved }

/** The element the Rack scrolls inside — renderBay() appends every Rack straight into the Bay's own `#efsp-bay-content`, which is the `overflow-y: auto` box. Guarded because the unit-test DOM stub has neither `parentElement` nor `scrollTop`. */
function _scrollParentOfRack(rackEl) {
  return rackEl.parentElement || rackEl.parentNode || null;
}

function _scrollTopOf(el) {
  return el && typeof el.scrollTop === 'number' ? el.scrollTop : 0;
}

/**
 * Measure the Racks's other Strips, once, and remember the scroll offset the
 * measurement was taken at (F-402/F-404 — see strip-drag.js's module comment
 * for why the cache is taken here rather than at pointerdown, and why the
 * scroll offset has to travel with it).
 *
 * Also the only place `_efspDrag.rackEl` changes: a drag that crosses into a
 * second Rack (F-406) re-measures against that Rack and commits there.
 */
function _cacheRackRects(rackEl) {
  const drag = _efspDrag;
  drag.rackEl = rackEl;
  drag.scrollEl = _scrollParentOfRack(rackEl);
  drag.cacheScrollTop = _scrollTopOf(drag.scrollEl);
  drag.rects = [...rackEl.querySelectorAll('.efsp-strip')]
    .filter(el => el.dataset.stripId !== drag.strip.stripId)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { stripId: el.dataset.stripId, top: r.top, height: r.height };
    });
}

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

  // setPointerCapture is deliberately NOT called here — see _capturePointer.

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
  //
  // The other Strips' rects are not measured here either, and for the same
  // reason turned into a defect: measuring them before that class is applied
  // measures a layout the drag is about to invalidate (F-402). _cacheRackRects
  // runs from _onStripPointerMove instead, immediately after the class. The
  // one thing that MUST be read now is the dragged Strip's own width, which is
  // only available while it is still in the flow.

  _efspDrag = {
    strip, insertionEl, dragEl: e.currentTarget,
    // F-403 — `position: fixed` resolves against the nearest ancestor with
    // `contain: layout`, which here is dockview's `.dv-grid-view`: the whole
    // dock grid, not the panel. With `width: auto` the ghost then shrink-to-
    // fits against THAT and is drawn ~700px wide over the map beside the
    // panel. Nothing in CSS can name this number (see .efsp-strip-dragging's
    // comment in efsp-panel.css, which records the two rules that were tried),
    // so it is pinned here and cleared in _finishDrag.
    dragWidth: e.currentTarget.getBoundingClientRect().width,
    // The Bay a cross-Rack drag may not leave: a move to another BAY is what
    // the Position/Bay tabs are for (_findDropTargetAt), and they carry
    // ownership semantics a bare Rack element does not.
    bayId: rackEl.dataset.bayId,
    rackEl, rects: [], scrollEl: null, cacheScrollTop: 0, // filled by _cacheRackRects once the drag is real
    startX: e.clientX, startY: e.clientY, lastClientY: e.clientY,
    pointerId: e.pointerId,
    captured: false, // see _capturePointer
    dropTargetEl: null,
    hasMoved: false, // set true in _onStripPointerMove once movement exceeds DRAG_THRESHOLD_PX
  };

  // On `document`, not on the Strip, because the pointer is NOT captured yet
  // and a fast flick can put the cursor outside the Strip before the drag
  // threshold is crossed — listeners on the Strip would simply stop hearing
  // about it and the drag would hang half-started.
  document.addEventListener('pointermove', _onStripPointerMove);
  document.addEventListener('pointerup', _onStripPointerUp);
  document.addEventListener('pointercancel', _onStripPointerCancel);
}

/**
 * Take the pointer capture — at the drag THRESHOLD, not at pointerdown.
 *
 * Capturing retargets the compatibility mouse events too, `click` included:
 * with capture held by the Strip, a click on a Block cell inside it is
 * delivered to the STRIP and the cell's own click handler never runs, so the
 * cell cannot be opened for editing at all. Measured in Chromium, not assumed.
 *
 * That is why every editable cell used to stopPropagation() its pointerdown —
 * the Strip's drag-start had to be kept away from it. F-105 then grew those
 * cells from 28x20 to 44x44 of border box, overhanging 12px vertically and 3px
 * horizontally past the box a controller can see, and the guard grew with
 * them: in twr-runway-queue, a pointerdown 8px into a Strip lands inside Block
 * 14D's target (border box from x=15, visible box from x=18) and started no
 * drag at all. Most of a Strip had quietly stopped being draggable, which is
 * what lane 4's F-406 spec actually trips over.
 *
 * Deferring the capture resolves both at once, and needs neither side to give
 * anything up: below DRAG_THRESHOLD_PX nothing is captured, so a press on a
 * cell is an ordinary click on that cell and the editor opens; past it the
 * Strip captures, the click is retargeted away from the cell, and the gesture
 * is a drag. The threshold was always the thing that told those two apart
 * (see strip-drag.js's hasExceededDragThreshold) — it just was not being
 * asked until after the decision had been made.
 */
function _capturePointer() {
  if (!_efspDrag || _efspDrag.captured) return;
  _efspDrag.captured = true;
  if (typeof _efspDrag.dragEl.setPointerCapture === 'function') {
    _efspDrag.dragEl.setPointerCapture(_efspDrag.pointerId);
  }
}

// "Other Bays reachable through header drop zones that double as drag
// targets" (guide §4.2) — the always-visible Position/Bay tabs (rendered
// by efsp-panel.js, marked with data-efsp-drop-position/data-efsp-drop-bay)
// accept a drop as a cross-Position TransferStrip or cross-Bay MoveStrip.
// setPointerCapture (see _capturePointer) means pointer events keep
// targeting the dragged Strip element even when the cursor is over a tab
// elsewhere in the panel — elementFromPoint is what actually finds what's
// visually underneath the cursor instead.
function _findDropTargetAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return el ? el.closest('[data-efsp-drop-position]') : null;
}

/**
 * Which Rack is under the pointer (F-406).
 *
 * _finishDrag used to commit unconditionally to the Rack the drag STARTED in,
 * and rects were cached only for that Rack, so a Strip dragged from RWY-05
 * onto RWY-23 in twr-runway-queue snapped back into RWY-05 and said nothing.
 * The only drop targets that changed a Strip's location were the Position and
 * Bay tabs, which are per Bay — nothing was per Rack, even though this
 * module's own header has always claimed "within/between Racks" and a runway
 * change for a queued departure is an ordinary pilot request
 * (docs/efsp-wp6-plan.md §Verification 5).
 *
 * Returns null over anything that is not a Rack of the same Bay — the gap
 * between two Racks, the Bay's own padding — and the caller then keeps the
 * Rack it already had, so letting go there reorders where the insertion line
 * is drawn rather than doing nothing.
 */
function _findRackAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const rackEl = el ? el.closest('.efsp-rack') : null;
  if (!rackEl || !_efspDrag || rackEl.dataset.bayId !== _efspDrag.bayId) return null;
  return rackEl;
}

// Holding a dragged Strip near the top or bottom edge of the Bay scrolls it.
// This used to happen only by accident: Chromium's text-selection autoscroll,
// when the press landed on a field's text. Layout C put the grab area in the
// tab, which has no text there, and the Bay stopped scrolling at all — so a
// slot below the fold could not be reached. Scroll changes are compensated
// the same way a wheel scroll mid-drag is (F-404).
const DRAG_AUTOSCROLL_EDGE_PX = 32;
const DRAG_AUTOSCROLL_MAX_PX = 14;
let _dragAutoscrollFrame = null;

function _dragAutoscrollStep() {
  _dragAutoscrollFrame = null;
  const drag = _efspDrag;
  if (!drag || !drag.hasMoved || !drag.scrollEl || typeof drag.lastClientX !== 'number') return;
  const r = drag.scrollEl.getBoundingClientRect();
  const y = drag.lastClientY;
  let speed = 0;
  if (y > r.bottom - DRAG_AUTOSCROLL_EDGE_PX) speed = Math.min(1, (y - (r.bottom - DRAG_AUTOSCROLL_EDGE_PX)) / DRAG_AUTOSCROLL_EDGE_PX);
  else if (y < r.top + DRAG_AUTOSCROLL_EDGE_PX) speed = -Math.min(1, ((r.top + DRAG_AUTOSCROLL_EDGE_PX) - y) / DRAG_AUTOSCROLL_EDGE_PX);
  if (speed === 0) return;
  const before = drag.scrollEl.scrollTop;
  drag.scrollEl.scrollTop = before + Math.max(1, Math.round(Math.abs(speed) * DRAG_AUTOSCROLL_MAX_PX)) * Math.sign(speed);
  if (drag.scrollEl.scrollTop === before) return; // at the end of the Bay
  // Redraw the insertion line against the new scroll position.
  _onStripPointerMove({ clientX: drag.lastClientX, clientY: y });
  _requestDragAutoscroll();
}

function _requestDragAutoscroll() {
  if (_dragAutoscrollFrame || typeof requestAnimationFrame !== 'function') return;
  _dragAutoscrollFrame = requestAnimationFrame(_dragAutoscrollStep);
}

function _onStripPointerMove(e) {
  if (!_efspDrag) return;
  _efspDrag.lastClientY = e.clientY;
  _efspDrag.lastClientX = e.clientX;
  const dy = e.clientY - _efspDrag.startY;

  if (!_efspDrag.hasMoved) {
    // A click with negligible movement must never commit a reorder or
    // transfer (a controller hit exactly this: clicking a newly-created
    // Strip relocated it to another Bay with no deliberate drag at all —
    // see strip-drag.js's hasExceededDragThreshold for the full reasoning).
    const dx = e.clientX - _efspDrag.startX;
    if (!hasExceededDragThreshold(dx, dy)) return; // still just a click so far — no capture, no visual drag feedback at all yet
    _efspDrag.hasMoved = true;
    _capturePointer(); // only now — see _capturePointer
    _efspDrag.dragEl.classList.add('efsp-strip-dragging'); // semi-transparent while moving, §7.2.3 — see _onStripPointerDown's comment on why this is deferred to here
    _efspDrag.dragEl.style.width = `${_efspDrag.dragWidth}px`; // F-403 — see _onStripPointerDown's dragWidth
    // F-402 — NOW, not on pointerdown. The class above is `position: fixed`,
    // so this is the first moment the Rack's other Strips are where the
    // controller will actually see them for the rest of the drag; the
    // getBoundingClientRect() inside flushes the pending layout, so it reads
    // the closed-up Rack rather than the one that was there a line ago. Still
    // exactly one measurement per drag (§7.2 rule 5).
    _cacheRackRects(_efspDrag.rackEl);
  }

  // transform-only movement (§7.2.4) — never top/left.
  _efspDrag.dragEl.style.transform = `translate3d(0, ${dy}px, 0)`;
  _requestDragAutoscroll();

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
  // F-406 — follow the pointer into a second Rack of the same Bay. Only when
  // it is actually over one: over the gap between two Racks the drag keeps
  // whichever Rack it last resolved, which is where the line is drawn.
  const rackUnder = _findRackAt(e.clientX, e.clientY);
  if (rackUnder && rackUnder !== _efspDrag.rackEl) {
    rackUnder.appendChild(_efspDrag.insertionEl); // `top` is relative to the Rack (see .efsp-rack's `position: relative`)
    _cacheRackRects(rackUnder);
  }

  _efspDrag.insertionEl.style.display = '';

  const { rects, rackEl, cacheScrollTop, scrollEl } = _efspDrag;
  const scrollNow = _scrollTopOf(scrollEl);
  const { index } = computeInsertionIndex(rects, scrollCompensatedY(e.clientY, cacheScrollTop, scrollNow));
  const rackTop = rackEl.getBoundingClientRect().top;
  let lineY;
  if (rects.length === 0) {
    // An empty Rack — reachable now that a drag can cross into one (F-406).
    // Under the header, not at the Rack's very top edge, which is where
    // `targetTop = 0` used to put the line: above the Rack entirely.
    const header = rackEl.querySelector('.efsp-rack-header');
    lineY = header ? header.getBoundingClientRect().bottom - rackTop : 0;
  } else {
    const last = rects[rects.length - 1];
    const cachedTop = index < rects.length ? rects[index].top : last.top + last.height;
    lineY = cachedTopToViewportY(cachedTop, cacheScrollTop, scrollNow) - rackTop;
  }
  _efspDrag.insertionEl.style.top = `${lineY}px`;
}

function _finishDrag(commit) {
  if (!_efspDrag) return;
  const { strip, rackEl, rects, dragEl, insertionEl, lastClientY, dropTargetEl, hasMoved, scrollEl, cacheScrollTop } = _efspDrag;
  if (_dragAutoscrollFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_dragAutoscrollFrame);
  _dragAutoscrollFrame = null;
  document.removeEventListener('pointermove', _onStripPointerMove);
  document.removeEventListener('pointerup', _onStripPointerUp);
  document.removeEventListener('pointercancel', _onStripPointerCancel);
  dragEl.classList.remove('efsp-strip-dragging');
  dragEl.style.transform = '';
  dragEl.style.width = ''; // F-403 — pinned in _onStripPointerMove alongside the class above
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
    //
    // Mapped into the cache's coordinate space against the scroll offset read
    // HERE rather than the one the last pointermove saw, because the Bay can
    // scroll with no pointermove at all: Chromium autoscrolls the overflow
    // container on its own while the button is held at its edge (F-404's
    // second route), and the release then lands in a Rack that has moved since
    // the app last heard about it. `rackEl` is whichever Rack the pointer was
    // last over, which is the one the insertion line was drawn in (F-406).
    const { afterStripId, beforeStripId } = computeInsertionIndex(
      rects, scrollCompensatedY(lastClientY, cacheScrollTop, _scrollTopOf(scrollEl)),
    );
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
  const activeEl = document.activeElement || null;
  const activeStripEl = activeEl ? activeEl.closest('.efsp-strip') : null;
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
  if (focusedStripId && activeEl && !container.contains(activeEl)) {
    // Re-focus by Strip ID, never DOM index (guide §7.8 rule 3) — a
    // reconciled/rebuilt element is a different node than the one that had
    // focus before this call.
    //
    // ONLY when the node that had focus is actually gone, though. Refocusing
    // unconditionally also TOOK focus: a Strip that survived reconciliation
    // still holds whatever was focused inside it, and focusing the Strip
    // element moved focus off it — so every board delta, ack and selection
    // change emptied the Block input a controller was in the middle of typing
    // into, and the rest of what they typed went nowhere (lane 2's F-202,
    // and the half of F-201 that swallows everything after the space).
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

/** A Strip element is protected from removal/rebuild while it's mid-drag, is being typed into, or has any of the six popovers open — reconciling around it (never through it) is what actually fixes defect D6 here. */
function _isProtectedStripEl(el) {
  if (_efspDrag && _efspDrag.strip.stripId === el.dataset.stripId) return true;
  // An open Block edit or picker holds the Strip still — but only while the
  // controller is actually IN it. Unconditional, this froze a Strip for good
  // the moment somebody clicked away from a half-typed Block (lane 2's
  // F-204): other controllers' changes to it never appeared again, a hand-off
  // left it drawn in the wrong Bay still offering its old NLA (which then came
  // back STALE_REV), and the only way out was to find the input, refocus it
  // and press Esc. Nothing ended the edit otherwise — _startBlockEdit's own
  // comment used to claim the next re-render would replace it, and the
  // protection here was exactly what stopped that re-render happening.
  //
  // An abandoned edit is not lost by the rebuild: _buildBlockCell puts it back
  // from _openBlockEdit with what was typed still in it. Blur still neither
  // commits nor reverts.
  const editEl = el.querySelector('.efsp-block-input');
  if (editEl && document.activeElement === editEl) return true;
  // Same for any other form control the controller is in — the TOFI regime
  // select above all, whose open dropdown belongs to the element a rebuild
  // would detach. Buttons deliberately do not count: a focused NLA button
  // would otherwise freeze its Strip after every press.
  const active = document.activeElement;
  if (active && active !== editEl && typeof el.contains === 'function' && el.contains(active)
      && /^(select|input|textarea)$/i.test(active.tagName || '')) return true;
  // An open popover holds its Strip still. This was six separate
  // `el.contains(_open*PopoverEl)` lines, and the list was found incomplete
  // three separate times after the same bug — highlight, coordinate, TOFI and
  // airspace were each added one at a time, and bind and MARSA were both still
  // missing at the third discovery. So the rule is enumerated rather than
  // listed: _mountPopover records which Strip every popover belongs to, and a
  // seventh popover is protected by having been mounted at all.
  //
  // Containment is no longer the question and cannot be: F-001 portals every
  // popover out to document.body, so `el.contains(popover)` is false for all
  // six. efsp-ui-reachability.test.js opens each popover in turn and asserts
  // its Strip is protected, which is what holds this to the class.
  if (_stripHasOpenPopover(el.dataset.stripId)) return true;
  return false;
}

/**
 * Everything a Strip RENDERS that does not live on the Strip record, as one
 * short string the reconciler can compare.
 *
 * `rev` is the Strip's own optimistic-concurrency counter and it moves only
 * when a Mutation changes THAT Strip. _buildStripEl reads a great deal more
 * than that, all of it keyed somewhere else and all of it able to change while
 * `rev` stands still (lane 3's F-305, measured on six separate surfaces):
 *
 *   strip.nla      what pressing the NLA would do right now. crc-sync moves it
 *                  when Position occupancy or a clock deadline changes, and
 *                  deliberately does NOT bump `rev` to say so — `rev` is
 *                  concurrency control, and bumping it outside a Mutation
 *                  would invalidate every controller's in-flight edit.
 *   the FDR        every Block value, and fdr.tofi.separationRegime, which is
 *                  what the TOFI exit gate reads. A regime set on the ATC-side
 *                  Strip left the MRU's "Accept TOFI Exit" disabled forever.
 *   siblings       the +N shared-FDR badge is computed from OTHER Strips.
 *   obligation     §4.6.1's alerts live in their own store. An OVERDUE
 *                  obligation that only appears once the controller happens to
 *                  touch that Strip is not an alarm.
 *   MARSA          the relation and rule 5's participant highlight.
 *   correlation    §6.6's badge, and the Bind… button that comes with it — so
 *                  on a fresh Strip the bind popover could not be opened at all.
 *   airspace       a range controller activates and returns an airspace
 *                  without touching any Strip.
 *   the refusal    F-103's Strip-level marker is panel chrome (efsp-panel.js's
 *                  getCurrentEfspRefusal) and moves on its own.
 *
 * The answer for client-local state was already established — selection and
 * expansion are stamped on the element so the reconciler can see them. This is
 * that answer generalized rather than a sixth special case, and it is a
 * signature rather than a full rebuild because guide §7.5.4 and defect D6
 * require keyed reconciliation: a rebuild destroys in-progress work.
 *
 * Cheap on purpose — it runs for every Strip on every board delta. Every line
 * is a field read or a Map lookup bar the sibling walk, which _buildStripEl
 * already does once per Strip anyway.
 */
function _stripRenderSignature(strip) {
  const parts = [];

  // `undefined` (a record from a server that does not compute it) and `null`
  // (this State has no NLA at all) are different answers and must compare
  // differently.
  parts.push('nla:' + (strip.nla === undefined ? '?' : JSON.stringify(strip.nla)));
  // Which Position the controller is acting as decides which controls render.
  parts.push('act:' + (_resolveActingPositionId(strip) || ''));

  const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(strip.fdrId) : null;
  parts.push('fdr:' + (fdr ? fdr.rev : ''));
  parts.push('stereo:' + (typeof stereoRoutesCacheKey === 'function' ? stereoRoutesCacheKey() : '')); // Block 9F's options (docs/adr/0073)

  const siblings = typeof otherLiveStripsForFdr === 'function' ? otherLiveStripsForFdr(strip.fdrId, strip.stripId) : [];
  // Not just the count: the badge's title names each sibling's Facility,
  // Position and Role, and a sibling that moves desk changes it.
  parts.push('sib:' + siblings.map(s => `${s.stripId}/${s.facilityId || '?'}/${s.ownerPositionId}/${s.role}`).sort().join(','));

  const obligation = typeof getEfspObligation === 'function' ? getEfspObligation(strip.stripId) : null;
  parts.push('obl:' + (obligation ? `${obligation.obligationType}/${obligation.severity}` : ''));

  const relation = typeof marsaForStrip === 'function' ? marsaForStrip(strip) : null;
  parts.push('mrs:' + (relation
    ? `${relation.marsaId}/${relation.rev}/${relation.state}/${relation.rendezvousAt ? 1 : 0}/${relation.voidedBy || ''}`
    : ''));
  parts.push('mhl:' + (typeof isMarsaHighlighted === 'function' && isMarsaHighlighted(strip.stripId) ? 1 : 0));
  parts.push('tx:' + (typeof tofiExitSignatureFor === 'function' ? tofiExitSignatureFor(strip) : '')); // UI-A U8 — the mission line's state decides CTR's primary action
  parts.push('ar:' + (typeof arSignatureFor === 'function' ? arSignatureFor(strip) : '')); // docs/adr/0071 — the AR join lives on OTHER flights' Strips

  const correlation = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
  if (!correlation) {
    parts.push('cor:');
  } else {
    // Whether the bound contact is inside THIS controller's coverage is part
    // of what the badge says (`TRK ··`), and coverage is per-controller
    // (crc-sync's docs/adr/0042) — so the track has to be looked at, not just
    // the record. A Map lookup, and Strips are not re-rendered on radar
    // sweeps, so this costs nothing per sweep.
    const track = correlation.trackId && typeof window !== 'undefined' && typeof window.getLatestTrack === 'function'
      ? window.getLatestTrack(correlation.trackId) : null;
    parts.push('cor:' + [
      correlation.rev, correlation.state, correlation.trackId || '', correlation.matchedBy || '',
      correlation.binding ? 1 : 0,
      (correlation.warning && correlation.warning.kind) || '',
      ((correlation.warning && correlation.warning.candidateTrackIds) || []).join('+'),
      track ? trackRef(track) : '·',
    ].join('/'));
  }

  const entry = strip.airspaceEntry;
  const airspace = entry && typeof getEfspAirspace === 'function' ? getEfspAirspace(entry.airspaceId) : null;
  parts.push('asp:' + (airspace ? `${airspace.rev}/${airspace.state}` : ''));

  const refusal = _refusalForStrip(strip);
  parts.push('ref:' + (refusal ? `${refusal.at}/${refusal.blockId || ''}` : ''));

  // Whether it carries the just-arrived edge (docs/adr/0057). Only the fact,
  // never the flash: marking the flash played must not itself rebuild the
  // Strip, or the next render would replay it.
  parts.push('arr:' + (typeof efspArrivalFor === 'function' && efspArrivalFor(strip.stripId) ? 1 : 0));

  // Conformance and conflict alerts (docs/adr/0058). A conflict's countdown is
  // part of what the Strip says, so it rebuilds each second while one lasts —
  // only the Strips actually in a conflict.
  const conf = typeof conformanceAlertsForFdr === 'function' ? conformanceAlertsForFdr(strip.fdrId) : [];
  const trackId = typeof correlatedTrackIdForStrip === 'function' ? correlatedTrackIdForStrip(strip) : null;
  const stca = typeof stcaConflictsForTrack === 'function' ? stcaConflictsForTrack(trackId) : [];
  parts.push('alr:' + conf.map(a => `${a.kind}/${a.assigned}/${a.actual ?? ''}/${a.deviationFt ?? ''}/${a.fpm ?? ''}`).join(',')
    + ';' + stca.map(c => `${c.id}/${c.timeToCpaSec}/${c.minNm}/${c.vertFt}`).join(','));
  // Field state (docs/adr/0068): the RWY/HOOK chips read the Facility's runway record, not the Strip.
  parts.push('fld:' + (typeof fieldStateSignatureFor === 'function' ? fieldStateSignatureFor(strip) : ''));

  return parts.join('|');
}

/**
 * Does this already-rendered Strip element differ from what it should be?
 *
 * Every input is an argument rather than read from module state, so the rule
 * can be tested directly — the reconciler that calls it needs a Rack, a Bay
 * and a populated store, and a rule buried inside it is a rule nothing checks.
 *
 * Four ways a Strip goes stale, and only the first is the Strip's own record:
 *  - `rev` moved — somebody changed the Strip.
 *  - selection changed — client-local, does not move `rev`.
 *  - expansion changed — client-local, does not move `rev` either. This one
 *    was missing, so the expand toggle set its state, asked for a re-render,
 *    and the reconciler reused every element unchanged. The button did
 *    nothing visible at all.
 *  - something the Strip RENDERS but does not own changed — the FDR, a
 *    sibling, an obligation, a MARSA relation, a correlation, the airspace,
 *    a refusal, or `strip.nla`. See _stripRenderSignature; this was the same
 *    omission as expansion, six more times over (F-305).
 */
function _stripElNeedsRebuild(el, wanted, selectedStripId, expandedStripId) {
  const id = el.dataset.stripId;
  if (el.dataset.rev !== String(wanted.rev)) return true;
  if (el.classList.contains('efsp-strip-selected') !== (id === selectedStripId)) return true;
  if ((el.dataset.expanded === '1') !== (id === expandedStripId)) return true;
  if (el.dataset.sig !== _stripRenderSignature(wanted)) return true;
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
        return _stripElNeedsRebuild(el, w, _selectedStripId, _expandedStripId);
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
