'use strict';
import { getCurrentEfspRefusal } from '../panel/refusal.js';
import {
  CONFIRM_VACATED_ELIGIBLE_BLOCKS, blockValueHintFor, editRedirectFor, enumSelectOptionsFor, blockInputPlaceholderFor,
  hasActiveAnnotationEntry, isBlockEditable, isBooleanToggleBlock, isEnumBlockClearable, resolveBlockValue,
  isCycleBlock, cycleBlockLabel, nextCycleValue, formatVfrAltitude
} from '../strip-template.js';
import { getEfspFlightData, getEfspStrip } from '../efsp-state.js';
import { sendEfspMutation } from '../efsp-ws.js';
import { _resolveActingPositionId } from './dispatch.js';


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
export function _refusalForStrip(strip) {
  const refusal = getCurrentEfspRefusal();
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

export function _blockLabel(flightData, strip, blockId) {
  const { value } = resolveBlockValue(blockId, flightData, strip);
  // crc-sync docs/adr/0146: the VFR strip says VFR in its altitude cell (ERAM's VFR/055); the edit still shows the value.
  if (strip && strip.stripType === 'VFR' && blockId === '7A') return formatVfrAltitude(value);
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
/**
 * SEP REG with a regime waiting for the airspace (crc-sync docs/adr/0102): the cell keeps the EFFECTIVE regime (the
 * picker reads its text), and a marker beside it says what takes effect on entry.
 */
export function _buildBlockCell(strip, blockId) {
  const cell = _buildBlockCellInner(strip, blockId);
  if (blockId !== 'SREG') return cell;
  const flightData = getEfspFlightData(strip.flightDataId);
  const pending = flightData && flightData.tofi && flightData.tofi.pendingSeparationRegime;
  if (!pending) return cell;
  const wrapper = document.createElement('span');
  wrapper.className = 'efsp-block-with-pending';
  wrapper.appendChild(cell);
  const marker = document.createElement('span');
  marker.className = 'efsp-sreg-pending';
  marker.dataset.pendingRegime = pending;
  marker.textContent = `→ ${pending} on entry`;
  marker.title = `${pending} was agreed at the TOFI accept and takes effect when the flight is inside an active airspace, or when the MRU marks it entered. Until then ATC separates.`;
  wrapper.appendChild(marker);
  return wrapper;
}

function _buildBlockCellInner(strip, blockId) {
  const flightData = getEfspFlightData(strip.flightDataId);
  const span = document.createElement('span');
  span.className = 'efsp-block efsp-block-' + blockId;
  span.dataset.block = blockId;
  span.textContent = _blockLabel(flightData, strip, blockId);

  // F-103, at cell resolution — a refused SetBlock names the Block it was
  // about, so the cell that was rejected says so rather than leaving the
  // banner to be matched against a Strip by eye. Marked whether or not there
  // is text to put back: a refused confirmVacated carries no value, and which
  // cell was refused is a separate question from what was in it.
  const redirect = editRedirectFor(blockId, strip.stripType, flightData); // UI-A U4
  const refusal = _refusalForStrip(strip);
  if (refusal && refusal.blockId === (redirect ? redirect.blockId : blockId)) {
    span.classList.add('efsp-block-refused');
    span.title = refusal.message;
  }
  // U1 (H138): a value cut to its cell shows the whole of it on hover. Measured when the pointer arrives, since only the
  // laid-out cell knows whether it was cut; a title the cell already has (a refusal, a time's source) is kept.
  span.addEventListener('pointerenter', () => {
    if (!span.title && span.textContent && span.scrollWidth > span.clientWidth) span.title = span.textContent;
  });
  const hint = blockValueHintFor(blockId, flightData, strip); if (hint) { if (hint.estimated) span.classList.add('efsp-block-estimated'); if (hint.behindPlan) span.classList.add('efsp-block-behind-plan'); if (hint.title && !span.title) span.title = hint.title; } // docs/adr/0073: §10.5's source on hover, an estimate in italics

  // WP4A gap-closure (docs/adr/0022) — restricted-enum Blocks (airspace
  // ownership, track-degradation flag) get a <select>, never the generic
  // free-text click-to-edit path below — this is the first UI either field
  // has ever had (both had a working server-side setter and zero way to
  // reach it). Checked before isBlockEditable() since these Blocks are
  // deliberately excluded from that generic path (see strip-template.js's
  // isBlockEditable comment).
  // crc-sync docs/adr/0126: LC's pattern cells, one click per step (PAT -> STR -> empty; T&G -> FS -> LA -> empty).
  if (isCycleBlock(blockId)) return _buildCycleCell(strip, blockId, span, flightData);
  // A cell this controller cannot write (it holds neither the Strip nor a Position allowed beside its Owner) stays read-only.
  if (!_resolveActingPositionId(strip, { kind: 'SetBlock', blockId: redirect ? redirect.blockId : blockId })) return span;

  const enumOptions = enumSelectOptionsFor(blockId, flightData); // the FLIGHT_DATA: 9F offers a retired route its flight still flies (docs/adr/0073)
  if (enumOptions) return _buildEnumSelectCell(strip, blockId, span, enumOptions);

  // WP4A second slice — IFR (a boolean, not a restricted-value string enum)
  // gets a click-to-toggle affordance instead, same "checked before
  // isBlockEditable()" reasoning as the enum-<select> case above.
  if (isBooleanToggleBlock(blockId)) return _buildBooleanToggleCell(strip, blockId, span);

  // TYPE (3) shows the suffix but is typed without it (T7): the editor opens on [count/]TYPE[/WAKE].
  if (redirect) {
    span.dataset.editBlock = redirect.blockId;
    span.dataset.editValue = redirect.value;
  }
  if (!redirect && !isBlockEditable(blockId, strip.stripType, strip.facilityId)) return span;

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

  if ((CONFIRM_VACATED_ELIGIBLE_BLOCKS[strip.stripType] || []).includes(blockId) && hasActiveAnnotationEntry(strip, blockId)) {
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
      const actingPositionId = _resolveActingPositionId(strip, { kind: 'SetBlock', blockId });
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
    const clearable = isEnumBlockClearable(blockId);
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
      const actingPositionId = _resolveActingPositionId(strip, { kind: 'SetBlock', blockId });
      if (!actingPositionId) return;
      const currentStrip = getEfspStrip(strip.stripId) || strip;
      // A clear is the '' the <select> itself holds, not a null spelled here:
      // flight-data-store.js's setTofi() normalizes it, so "cleared" has one spelling
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
    const actingPositionId = _resolveActingPositionId(strip, { kind: 'SetBlock', blockId });
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

/**
 * crc-sync docs/adr/0126: a click-to-cycle cell (CYCLE_BLOCKS). The span shows the short form; a click (or Enter / Space)
 * sends the next value as an ordinary SetBlock as the Position holding the Strip. Read-only for anyone else.
 */
function _buildCycleCell(strip, blockId, span, flightData) {
  const { value } = resolveBlockValue(blockId, flightData, strip);
  span.textContent = cycleBlockLabel(blockId, value);
  span.dataset.value = value || '';
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId || actingPositionId !== strip.ownerPositionId) return span;
  span.classList.add('efsp-block-editable', 'efsp-block-cycle');
  span.tabIndex = 0;
  const step = (e) => {
    e.stopPropagation();
    const currentStrip = getEfspStrip(strip.stripId) || strip;
    sendEfspMutation(actingPositionId, currentStrip, { kind: 'SetBlock', blockId, value: nextCycleValue(blockId, value || null) });
  };
  span.addEventListener('click', step);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(e); } });
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
  const placeholder = blockInputPlaceholderFor(blockId); // T31 a: the format before a refusal, not after
  if (placeholder) input.placeholder = placeholder;
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
    const actingPositionId = _resolveActingPositionId(strip, { kind: 'SetBlock', blockId: sendBlockId });
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

// ESM-2a: strip-element.js cannot assign this module's binding; it calls this.
export function _setRestoredEditInThisStrip(v) { _restoredEditInThisStrip = v; }
