'use strict';
import { nlaLabelFor } from '../efsp-nla.js';
import { sendEfspMutation } from '../efsp-ws.js';
import { getEfspFlightData, getEfspObligation, getEfspStrip } from '../efsp-state.js';
import { BLOCK_MAPS, blockLabelFor, blockTitleFor, supersededAnnotationEntries } from '../strip-template.js';
import { compactBlocksFor, mtrLostCommsAdvisory } from '../strip-fields.js';
import { appendAtoExpandedRows } from '../ato-strip.js';
import { _buildStripLayout } from '../strip-view.js';
import { setAttention, toggleFlip, toggleOffset } from '../efsp-gestures.js';
import { noteEfspGesture } from '../efsp-metrics-client.js';
import {
  STRIP_CONTROL_SELECTOR, _dispatchGesture, _onStripKeydown, _resolveActingPositionId, _selectStrip,
  _selectedStripId, _stripRenderSignature, _swallowRepeatAdvance, renderAllOpenEfspBays
} from '../bay-view.js';
import { _blockLabel, _buildBlockCell, _refusalForStrip, _setRestoredEditInThisStrip } from './block-edit.js';
import { _cycleHighlight, _openHighlightPopover } from './popovers/highlight.js';
import { _onStripPointerDown } from './drag.js';


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

export function _appendDropButton(el, strip) {
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
export const CHIP_HISTORY_LIMIT = 1;

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
export function _appendAnnotationHistory(container, strip, blockId, limit) {
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
export let _expandedStripId = null;

export function _appendExpandButton(container, strip) {
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
  const onStrip = new Set(compactBlocksFor(strip.role, strip.ownerPositionId, getEfspFlightData(strip.fdrId)));
  return Object.keys(map).filter((blockId) => {
    if (!onStrip.has(blockId)) return true;
    return typeof supersededAnnotationEntries === 'function'
      && supersededAnnotationEntries(strip, blockId).length > CHIP_HISTORY_LIMIT;
  });
}

export function _appendExpandedView(el, strip) {
  if (_expandedStripId !== strip.stripId) return;
  const map = (typeof BLOCK_MAPS === 'object' && BLOCK_MAPS[strip.role]) || null;
  if (!map) return;

  const blocks = _expandedBlockIdsFor(strip, map);
  // §9.4's lost-comms rule (crc-sync's docs/adr/0062): a grey note, first in
  // the expanded view, for a flight with MTR data. Not a reason line and not
  // on the collapsed face — an MTR flight with working radios is not wrong
  // (docs/adr/0058).
  const advisory = typeof mtrLostCommsAdvisory === 'function' ? mtrLostCommsAdvisory(getEfspFlightData(strip.fdrId)) : null;
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
    const labelTitle = typeof blockTitleFor === 'function' ? blockTitleFor(blockId, getEfspFlightData(strip.fdrId), strip) : null; if (labelTitle) label.title = labelTitle; // docs/adr/0073
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

export function _buildStripEl(strip) {
  _setRestoredEditInThisStrip(false); // an open Block edit is restored into exactly one cell of this Strip
  const fdr = getEfspFlightData(strip.fdrId);
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

// ESM-1 (S-ESM1c): test seams for state the unit tests set directly in the old shared scope.
export function _setExpandedStripId(v) { _expandedStripId = v; }
