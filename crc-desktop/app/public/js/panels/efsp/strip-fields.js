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
//  - HOOK (3F) and ORDNANCE (3G) are Tower's alone (carrier control later).
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
const COMPACT_BLOCKS_BY_POSITION = {
  DEPARTURE: {
    OPS: ['1', '3', '5', '6', '7', '8', '8A', '8B', '9', '9F', '3D', '3E'],
    CD:  ['1', '3', '5', '7', '8', '8A', '8B', '9', '9F', '10', '14A', '14D', '21'],
    GND: ['1', '3', '5', '8', '8A', '14A', '14D'],
    TWR: ['1', '3', '5', '8A', '21', '14D', '3F', '3G'],
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
function compactBlocksFor(role, positionId) {
  const byPosition = COMPACT_BLOCKS_BY_POSITION[role];
  const list = (byPosition && positionId && byPosition[positionId])
    || COMPACT_BLOCKS_BY_ROLE[role] || COMPACT_BLOCKS_SHARED;
  const map = _blockMapFor(role);
  return map ? list.filter(id => Object.prototype.hasOwnProperty.call(map, id)) : list;
}

function fieldSpanFor(blockId) {
  return FIELD_SPANS[blockId] || 1;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COMPACT_BLOCKS_SHARED, COMPACT_BLOCKS_BY_ROLE, COMPACT_BLOCKS_BY_POSITION,
    FIELD_SPANS,
    compactBlocksFor, fieldSpanFor,
  };
}
