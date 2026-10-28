'use strict';
import { nlaLabelFor } from '../efsp-nla.js';
import { sendEfspMutation } from '../efsp-ws.js';
import { getAllEfspAirspaces, getEfspFlightData, getEfspStrip } from '../efsp-state.js';
import { BLOCK_MAPS, blockLabelFor, isParFinalOnlyOnCarrier, blockTitleFor, remarksBlockFor, remarksOf, supersededAnnotationEntries } from '../strip-template.js';
import { compactBlocksFor } from '../strip-fields.js';
import { mtrLostCommsAdvisory } from '../mtr-advisory.js';
import { mtrRouteNote } from '../mtr-route-note.js';
import { appendAtoExpandedRows } from '../ato-strip.js';
import { _resolveActingPositionId, _swallowRepeatAdvance } from './dispatch.js';
import { _buildBlockCell } from './block-edit.js';
import { markEfspChanged } from '../efsp-change-bus.js';

// The Strip element's expand/collapse view, annotation history and Drop button (DESK-SPLIT, split out of strip-element.js so
// strip-view.js can use them without a cycle: strip-element.js imports strip-view.js's layout.



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
 * every strip type's TERMINAL transition and appears nowhere else. So a fully
 * implemented, permitted operation had no affordance at all.
 *
 * Invisible to efsp-ui-reachability.test.mjs because that test holds every
 * writable BLOCK to being reachable and says nothing about OPS — the same
 * blind spot that hid the boolean-toggle Blocks, one level up.
 *
 * Deliberately NOT rendered when:
 *  - the terminal NLA already says "Drop" — one question, one control.
 *  - an exchange is open or live on this Strip. crc-sync refuses those
 *    (`_applyDropStrip`'s two guards in board/ops/drop-strip.js, and
 *    `retire`'s ACTIVE-TOFI refusal in board/strip-ops.js), and a control
 *    that always fails is worse than no control — the rule _marsaCandidates already follows.
 */
function _canDropStrip(strip) {
  if (!_resolveActingPositionId(strip)) return false;
  if (strip.state === 'DROPPED') return false;
  if (nlaLabelFor(strip.state, strip.stripType) === 'Drop') return false;
  const co = strip.coordination;
  if (co && co.state === 'INITIATED') return false;
  const tofi = strip.tofiCoordination;
  if (tofi && (tofi.state === 'INITIATED' || tofi.state === 'ACTIVE')) return false;
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
      markEfspChanged('bays');
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
    markEfspChanged('bays');
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
 * It listed every Block for the strip type at first, which made it mostly a second
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
  const flightData = getEfspFlightData(strip.flightDataId);
  const onStrip = new Set(compactBlocksFor(strip.stripType, strip.ownerPositionId, flightData));
  // H138 U2: remarks that are there have the face's own row (strip-remarks.js), which opens the whole text.
  if (remarksOf(flightData)) onStrip.add(remarksBlockFor(strip.stripType));
  return Object.keys(map).filter((blockId) => {
    if (isParFinalOnlyOnCarrier(strip.stripType, blockId, strip.facilityId)) return false; // the PAR final's HDG/ALT, not the carrier's
    if (!onStrip.has(blockId)) return true;
    return supersededAnnotationEntries(strip, blockId).length > CHIP_HISTORY_LIMIT;
  });
}

export function _appendExpandedView(el, strip) {
  if (_expandedStripId !== strip.stripId) return;
  const map = BLOCK_MAPS[strip.stripType] || null;
  if (!map) return;

  const blocks = _expandedBlockIdsFor(strip, map);
  // §9.4's lost-comms rule (crc-sync's docs/adr/0062): a grey note, first in
  // the expanded view, for a flight with MTR data. Not a reason line and not
  // on the collapsed face — an MTR flight with working radios is not wrong
  // (docs/adr/0058).
  const advisory = mtrLostCommsAdvisory(getEfspFlightData(strip.flightDataId));
  const routeNote = mtrRouteNote(getEfspFlightData(strip.flightDataId), getAllEfspAirspaces()); // 2P-B: the registry's ROUTE for this designator
  if (blocks.length === 0 && !advisory && !routeNote) return;

  const panel = document.createElement('div');
  panel.className = 'efsp-strip-expanded';
  if (advisory) {
    const note = document.createElement('div');
    note.className = 'efsp-expanded-note efsp-mtr-lostcomms';
    note.textContent = advisory;
    panel.appendChild(note);
  }

  if (routeNote) {
    const note = document.createElement('div');
    note.className = 'efsp-expanded-note mtr-route-note';
    note.textContent = routeNote;
    panel.appendChild(note);
  }

  for (const blockId of blocks) {
    const row = document.createElement('div');
    row.className = 'efsp-expanded-row';
    row.dataset.expandedBlock = blockId;

    const label = document.createElement('span');
    label.className = 'efsp-expanded-label';
    label.textContent = blockLabelFor(blockId, strip.stripType) || blockId;
    const labelTitle = blockTitleFor(blockId, getEfspFlightData(strip.flightDataId), strip); if (labelTitle) label.title = labelTitle; // docs/adr/0073
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
    markEfspChanged('bays');
  });
  collapse.addEventListener('pointerdown', (e) => e.stopPropagation());
  appendAtoExpandedRows(panel, strip); // docs/adr/0071 — read-only
  panel.appendChild(collapse);

  el.appendChild(panel);
}


// ESM-1 (S-ESM1c): test seams for state the unit tests set directly in the old shared scope.
export function _setExpandedStripId(v) { _expandedStripId = v; }
