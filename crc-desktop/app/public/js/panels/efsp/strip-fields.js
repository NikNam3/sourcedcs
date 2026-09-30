// Which Blocks a Strip shows as fields, and which indicator slots it draws.
// Pure data plus lookups — no DOM — so the node tests can hold it to the Block
// Maps and to the rules below without rendering anything. Everything left off a
// Strip here is still reachable in its expanded view (bay-view.js's
// _appendExpandedView), which is what makes trimming these lists legal.
//
// The layout these feed, and why the lists are per-Position rather than
// per-Role, is docs/adr/0056.

// ── Fallback lists, by Role ────────────────────────────────────────────────
//
// **The criterion is EDIT FREQUENCY, not interlock-ness.** Every Block is
// reachable from the expanded view, so reachability cannot be why these earn a
// field — what earns one is being read or edited on most Strips. A heading and
// an initial altitude are issued with every departure clearance; a radar vector
// is issued constantly. Every field costs Strip height, and Strip height costs
// Strips-visible-per-Bay. Keep these lists earned.
//
// Used for any (Role, Position) pair COMPACT_BLOCKS_BY_POSITION does not name.
// STATE (25 / M25) is on no list: the Strip's tab header already says it.
//
// Filtered by the Role's own Block Map before use (compactBlocksFor), so a
// Block listed here that a Role does not have is dropped rather than drawn
// as an unlabelled field.
const COMPACT_BLOCKS_SHARED = [
  '1', '3', '5', '5A', '7', '8', '8A', '8B', '9', '22', '24A', 'IFR', 'RSVC', 'SREG',
];

const COMPACT_BLOCKS_BY_ROLE = {
  // Heading and initial altitude: the two things a departure clearance issues
  // beyond the route.
  DEPARTURE:  [...COMPACT_BLOCKS_SHARED, '20', '21'],
  // '7' is the ASSIGNED altitude on this Role (annotation-routed, append-only);
  // the vector is the other constant.
  ARRIVAL:    [...COMPACT_BLOCKS_SHARED, '9A-VECTOR'],
  // '7' stays as the FILED request here; '7A' is the assignment beside it.
  OVERFLIGHT: [...COMPACT_BLOCKS_SHARED, '7A', '9A-VECTOR'],
  MISSION:    ['M3', 'M1', 'M2', 'M4', 'M5', 'M6', 'M7'],
};

// ── Per-Position lists ─────────────────────────────────────────────────────
//
// What each Position actually works. The rules they follow, so the next edit
// keeps to them (efsp-strip-fields.test.js holds every one):
//  - TYPE (3) already reads count/type/wake, so ACFT (3A) and WAKE (3B) never
//    get a field of their own.
//  - CID (4) and TAIL (3C) are on no Strip: nothing reads either at a glance.
//  - HOOK (3F) is Tower's alone (carrier control later). ORDNANCE (3G) is on
//    Tower's face always; on APP, CTR and every tactical Position it is on the
//    face only once it is set to something other than CLEAN — see
//    ORDNANCE_WHEN_SET below (decisions.md H55 and S-L12, crc-sync's
//    docs/adr/0069).
//  - A runway field only for the airfield Positions: OPS, CD, GND, TWR, APP.
//  - FREQ (22) only where a controller works more than one frequency: APP and
//    CTR. OPS, CD, GND and TWR each sit on one.
//  - The assigned altitude (ALT) wherever a clearance is issued or worked: CD,
//    TWR, APP, CTR. The assigned heading (HDG) only where aircraft are
//    vectored: APP and CTR (docs/adr/0058) — a departure clearance rarely
//    carries one.
//  - The TOFI fields (IFR, RSVC, SREG) and airspace ownership (24A) where TOFI
//    and airspace entry happen: CTR. SREG stays at APP too, because MARSA —
//    which APP can declare — writes it.
//  - ALERT (14E) where an alert aircraft is ordered and moved: OPS sets it
//    (decisions.md H56), and every ground Position shows it: CD, GND, TWR
//    (crc-sync docs/adr/0070).
const COMPACT_BLOCKS_BY_POSITION = {
  DEPARTURE: {
    OPS: ['1', '3', '5', '6', '7', '8', '8A', '8B', '9', '9F', '3D', '3E', '14E'],
    CD:  ['1', '3', '5', '7', '8', '8A', '8B', '9', '9F', '10', '14A', '14D', '21', '14E'],
    GND: ['1', '3', '5', '8', '8A', '14A', '14D', '14E'],
    TWR: ['1', '3', '5', '8A', '21', '14D', '3F', '3G', '14E'],
    APP: ['1', '3', '5', '7', '8A', '9', '20', '21', '22', '5A', 'SREG'],
    CTR: ['1', '3', '5', '7', '21', '20', '8B', '9', '22', '24A', 'IFR', 'RSVC', 'SREG', '5A'],
  },
  ARRIVAL: {
    GND: ['1', '3', '5', '8B'],
    TWR: ['1', '3', '5', '7', '8B', '9A-FUEL', '3F', '3G'],
    APP: ['1', '3', '5', '6', '7', '8A', '8B', '9A-VECTOR', '9A-SPEED', '22', '5A', 'SREG'],
    CTR: ['1', '3', '5', '6', '7', '9A-VECTOR', '22', '24A', 'IFR', 'RSVC', 'SREG', '5A'],
  },
  OVERFLIGHT: {
    APP: ['1', '3', '5', '7A', '8B', '9', '9A-VECTOR', '22', '5A', 'SREG'],
    CTR: ['1', '3', '5', '7A', '8B', '9', '9A-VECTOR', '22', '24A', 'IFR', 'RSVC', 'SREG', '5A'],
  },
};

// Grid columns a field spans. Everything else takes one.
const FIELD_SPANS = { '1': 2, '3': 2, '9': 3, '24A': 2, M1: 2, M3: 2, M5: 2 };

function _blockMapFor(role) {
  return (typeof BLOCK_MAPS === 'object' && BLOCK_MAPS && BLOCK_MAPS[role]) || null;
}

/**
 * The fields a Strip of this Role shows when `positionId` owns it, in render
 * order. The per-Position list if there is one, else the Role's; either way
 * only Blocks the Role's Block Map actually has.
 */
function compactBlocksFor(role, positionId, fdr) {
  const byPosition = COMPACT_BLOCKS_BY_POSITION[role];
  let list = (byPosition && positionId && byPosition[positionId])
    || COMPACT_BLOCKS_BY_ROLE[role] || COMPACT_BLOCKS_SHARED;
  // Hung ordnance (crc-sync's docs/adr/0069): ORDNANCE, only once it says something —
  // before the MTR group, which starts its own grid row.
  if (_ordnanceWhenSet(role, positionId) && isOrdnanceSet(fdr) && !list.includes('3G')) list = [...list, '3G'];
  // §9.4 (docs/adr/0062): the flight's MTR group, only when it has MTR data.
  const mtr = fdr && hasMtrData(fdr) && MTR_BLOCKS_BY_POSITION[role] && positionId
    ? MTR_BLOCKS_BY_POSITION[role][positionId] : null;
  if (mtr) list = [...list, ...mtr];
  const map = _blockMapFor(role);
  return map ? list.filter(id => Object.prototype.hasOwnProperty.call(map, id)) : list;
}

// ── Ordnance (guide §9.5, crc-sync's docs/adr/0069) ────────────────────────
//
// A pilot reports hung ordnance to whoever they are talking to, so APP, CTR and
// every tactical Position may record it (decisions.md H55). A field on every
// Strip those Positions work would cost Strip height on every flight for a value
// that is almost always CLEAN, so — as the MTR group does (H51) — ORDNANCE goes
// on their face only while it says something other than CLEAN (S-L12). Before
// that it is one tap away in the expanded view (▼), where every Block off the
// face is. Tower keeps it on its face unconditionally (COMPACT_BLOCKS_BY_POSITION).
const ORDNANCE_WHEN_SET = { positions: ['APP', 'CTR'], roles: ['MISSION'] };

function _ordnanceWhenSet(role, positionId) {
  return ORDNANCE_WHEN_SET.roles.includes(role) || (!!positionId && ORDNANCE_WHEN_SET.positions.includes(positionId));
}

/** True when the flight's ordnance state is anything but CLEAN or empty. */
function isOrdnanceSet(fdr) {
  const state = fdr && fdr.military ? fdr.military.ordnanceState : null;
  return !!state && state !== 'CLEAN';
}

function fieldSpanFor(blockId) {
  return FIELD_SPANS[blockId] || 1;
}

// ── §9.4 Military Training Routes (crc-sync's docs/adr/0062) ───────────────
//
// Drawn only when the flight has MTR data posted — most flights never fly one,
// and a field every Strip pays for must be earned (the criterion above). The
// group starts its own grid row (efsp-panel.css, keyed on 9G-MTR, which is
// why every list begins with it), so it sits in the same columns on every MTR
// Strip of a Bay. M11's exit fix and estimate come straight after it: §9.4's
// one explicit instruction is that they are what a controller asks for by
// voice and posts. Prominence is place, never colour (docs/adr/0056).
//
// [SOURCE-DEFINED] which Positions work MTR traffic (H24 took this default):
//  - OPS files the flight: designator and entry.
//  - CD reads the designator into the clearance, nothing else.
//  - GND and TWR: none — ground movement and the runway do not use MTR data.
//  - APP and CTR release the aircraft into the route and take the call on
//    exit: the whole group, M11 first. An ARRIVAL is past the route, so its
//    entry is history and stays in the expanded view.
//  - MISSION: no MTR Blocks at all. Any Position not named: the expanded view.
const MTR_BLOCKS_BY_POSITION = {
  DEPARTURE: {
    OPS: ['9G-MTR', '9G-ENTRY', '9G-TIME'],
    CD:  ['9G-MTR'],
    APP: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
    CTR: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
  },
  ARRIVAL: {
    APP: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT'],
    CTR: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT'],
  },
  OVERFLIGHT: {
    APP: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
    CTR: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
  },
};

const MTR_FIELDS = ['designator', 'entryFix', 'entryTimeUtc', 'exitFix', 'exitEstimateUtc', 'requestedAltitudeAfterExit'];

/**
 * True when ANY of the six MTR fields holds a value — not only the designator.
 * A controller who clears the designator but leaves an exit fix must still see
 * that exit fix on the Strip, rather than have it vanish into the expanded
 * view while it still sits on the flight.
 */
function hasMtrData(fdr) {
  const mtr = fdr && fdr.military && fdr.military.mtr;
  if (!mtr) return false;
  return MTR_FIELDS.some(k => mtr[k] != null && mtr[k] !== '');
}

/**
 * §9.4's lost-comms rule as a sentence, for a flight with MTR data; null
 * otherwise. An advisory, not a computation: it states the rule, shows the half
 * this system holds (the ACTIVE assigned altitude, docs/adr/0058) and says the
 * other half — the minimum IFR altitude for each remaining segment — is not
 * here. It never reads 9H-ALT: that is the pilot's request, and the rule says
 * "last clearance". [SOURCE-DEFINED] the wording; the rule is the guide's.
 */
function mtrLostCommsAdvisory(fdr) {
  if (!hasMtrData(fdr)) return null;
  const cell = fdr.clearance && fdr.clearance.altitude;
  const active = cell && Array.isArray(cell.entries) ? cell.entries.find(e => e.status === 'ACTIVE') : null;
  const cleared = active && active.value != null && active.value !== ''
    ? String(active.value) : 'none posted (ALT is empty)';
  return 'Lost comms (§9.4): separate assuming the higher of the minimum IFR altitude for each '
    + 'remaining segment — not available in this system — or the altitude in the last clearance: '
    + `${cleared}.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COMPACT_BLOCKS_SHARED, COMPACT_BLOCKS_BY_ROLE, COMPACT_BLOCKS_BY_POSITION,
    FIELD_SPANS,
    compactBlocksFor, fieldSpanFor,
    MTR_BLOCKS_BY_POSITION, hasMtrData, mtrLostCommsAdvisory,
    ORDNANCE_WHEN_SET, isOrdnanceSet,
  };
}
