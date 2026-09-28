'use strict';

// MARSA on the Strip (EFSPImplementationGuide.md §9.2 rules 2, 5 and 6) —
// crc-sync's docs/adr/0051.
//
// Two requirements shape this file:
//
//   rule 5: "MARSA MUST render on EVERY participant Strip, with the relation
//            visible as a link — selecting one participant MUST highlight the
//            others."
//   rule 2: a pre-rendezvous course or altitude assignment voids the relation
//            "and alerts every participant Strip."
//
// Both fall out of the record's shape rather than needing machinery. The
// relation carries its own participant list and is broadcast whole, so every
// participant Strip renders the same record, and the alert is a field on it
// (`voidedBy`) rather than a message anybody has to route. That is
// docs/adr/0045's shape, and deliberately not the obligation-alert shape, which
// cannot retract.
//
// A BADGE, NOT A BLOCK — the same three reasons correlation-highlight.js lists,
// and they apply harder here. A relation is keyed by its own id and its
// participants are fdrIds, so there is no Block target kind that could hold it
// without inventing one whose only member is something no controller types; the
// reachability test holds only WRITABLE Blocks, so a read-only one would be
// invisible to the test that exists to catch invisible fields; and the airspace,
// obligation and correlation badges are all this exact shape already.

// The fdrIds of the other participants in the selected Strip's relation, for
// rule 5's highlight. Module state rather than a DOM mutation, mirroring
// correlation-highlight.js's `_correlatedTrackId` — the renderer reads it while
// building each Strip, so it survives a re-render with no extra bookkeeping.
let _marsaHighlightStripIds = new Set();

function getMarsaHighlightStripIds() { return [..._marsaHighlightStripIds]; }

function isMarsaHighlighted(stripId) { return _marsaHighlightStripIds.has(stripId); }

/**
 * Selecting a participant highlights the others (rule 5). Called from
 * bay-view.js's _afterSelectionChanged — the one place every selection change
 * runs through.
 *
 * Passing null clears it, for correlation-highlight.js's stated reason: the
 * highlight says "these fly with the Strip you have selected", so with no
 * selection it has nothing to say.
 *
 * @returns {boolean} whether the set changed — the caller re-renders only then.
 */
function highlightMarsaParticipants(stripId) {
  const strip = stripId && typeof getEfspStrip === 'function' ? getEfspStrip(stripId) : null;
  const next = new Set(
    strip && typeof marsaParticipantStripIds === 'function' ? marsaParticipantStripIds(strip) : [],
  );
  if (next.size === _marsaHighlightStripIds.size && [...next].every(id => _marsaHighlightStripIds.has(id))) {
    return false;
  }
  _marsaHighlightStripIds = next;
  return true;
}

/** Re-resolves the highlight against the current records — called when a MARSA delta lands. */
function refreshMarsaHighlight() {
  if (typeof getSelectedEfspStripId !== 'function') return false;
  return highlightMarsaParticipants(getSelectedEfspStripId());
}

// §9.2 rule 6 — "Use the Pilot/Controller Glossary expansion in UI text." Kept
// in one place so every tooltip spells it the same way; crc-sync exports the
// identical string from marsa-store.js, and the two are checked against each
// other by test rather than by being imported across the package boundary (the
// Block Map parity precedent — crc-sync and crc-desktop are separately
// deployed).
const MARSA_EXPANSION = 'Military Authority Assumes Responsibility for Separation of Aircraft';

/**
 * The badge for a Strip, from whichever relation its flight is in.
 *
 * Four states, and the VOIDED one is the whole point of the deliverable:
 *
 *   ACTIVE, pre-rendezvous   MARSA ⚠  — the interlock is armed. Saying so is
 *                            what stops a controller issuing a vector and only
 *                            then discovering they broke the join-up.
 *   ACTIVE, post-rendezvous  MARSA    — joined up, interlock spent.
 *   VOIDED                   MARSA ✕  — rule 2's alert. Carries WHY.
 *   ENDED                    nothing  — a finished AR is not news. A flight
 *                            that landed, or an AR that completed normally,
 *                            must not leave a badge sitting on the Strip
 *                            forever; that is the unretractable-badge problem
 *                            this codebase already has once and should not
 *                            grow a second instance of.
 */
function marsaBadgeFor(strip) {
  const relation = typeof marsaForStrip === 'function' ? marsaForStrip(strip) : null;
  if (!relation) return null;

  const others = relation.participants.filter(id => strip && id !== strip.fdrId);
  const withText = others.length === 1 ? 'with 1 other flight' : `with ${others.length} other flights`;

  if (relation.state === 'VOIDED') {
    const why = _voidSentence(relation);
    return {
      marsaId: relation.marsaId,
      text: 'MARSA ✕',
      className: 'efsp-marsa-badge efsp-marsa-voided',
      title: `MARSA VOIDED — ${why}. ATC is separating these aircraft again.`,
      voided: true,
      // The alert as a SENTENCE, not only as a `title`. Rule 2 calls a void an
      // alert and docs/efsp-wp6-plan.md §13's acceptance line is that "every
      // participant Strip carries the alert" — a hover tooltip on a badge has
      // no touch equivalent and is not one (the point lane 3's F-307 makes
      // about the TOFI exit reason, and it applies harder here: the interlock
      // fires on an ordinary INIT ALT edit, so the controller who caused the
      // void is looking at the Block they just typed into, not at the badge).
      voidReason: `MARSA VOIDED — ${why}. ATC is separating these aircraft again.`,
      participantFdrIds: relation.participants,
    };
  }

  if (relation.state === 'ENDED') return null;

  const armed = !relation.rendezvousAt;
  return {
    marsaId: relation.marsaId,
    text: armed ? 'MARSA ⚠' : 'MARSA',
    className: `efsp-marsa-badge ${armed ? 'efsp-marsa-armed' : 'efsp-marsa-active'}`,
    title: armed
      ? `${MARSA_EXPANSION} — declared by ${relation.declaringCallsign}, ${withText}. Before rendezvous: assigning a heading or altitude VOIDS this.`
      : `${MARSA_EXPANSION} — declared by ${relation.declaringCallsign}, ${withText}. Rendezvous marked.`,
    armed,
    active: true,
    participantFdrIds: relation.participants,
  };
}

function _voidSentence(relation) {
  if (relation.voidedBy === 'CONTROLLER_COURSE_CHANGE') return 'a course was assigned before rendezvous';
  if (relation.voidedBy === 'CONTROLLER_ALTITUDE_CHANGE') return 'an altitude was assigned before rendezvous';
  if (relation.voidedBy === 'MANUAL') return relation.voidedDetail || 'a controller voided it';
  return relation.voidedDetail || 'voided';
}

/**
 * Which MARSA controls a Strip should offer, given the relation it is in.
 *
 * Pure and DOM-free so it is testable on its own and so bay-view.js's popover
 * has nothing to decide — airspace-panel.js's `airspaceActionsFor` precedent.
 * Proactive only: the server still decides, and a control offered here can
 * still be refused.
 */
function marsaActionsFor(strip) {
  const relation = typeof marsaForStrip === 'function' ? marsaForStrip(strip) : null;
  const active = relation && relation.state === 'ACTIVE' ? relation : null;
  if (!active) {
    return [{ kind: 'DeclareMarsa', label: 'Declare MARSA…' }];
  }
  const actions = [];
  if (!active.rendezvousAt) actions.push({ kind: 'MarkRendezvous', label: 'Mark rendezvous', marsaId: active.marsaId });
  actions.push({ kind: 'AddParticipant', label: 'Add a flight…', marsaId: active.marsaId });
  actions.push({ kind: 'RemoveParticipant', label: 'Remove this flight', marsaId: active.marsaId });
  actions.push({ kind: 'EndMarsa', label: 'End MARSA', marsaId: active.marsaId });
  actions.push({ kind: 'VoidMarsa', label: 'Void MARSA', marsaId: active.marsaId });
  return actions;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    marsaBadgeFor, marsaActionsFor,
    highlightMarsaParticipants, refreshMarsaHighlight,
    getMarsaHighlightStripIds, isMarsaHighlighted,
    MARSA_EXPANSION,
  };
}
