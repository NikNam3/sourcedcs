// Which Blocks a Strip shows as fields, and which indicator slots it draws.
// Pure data plus lookups — no DOM — so the node tests can hold it to the Block
// Maps and to the rules below without rendering anything. Everything left off a
// Strip here is still reachable in its expanded view (bay-view.js's
// _appendExpandedView), which is what makes trimming these lists legal.
//
// The layout these feed, and why the lists are per-Position rather than
// per-strip-type, is docs/adr/0056.

// ── Fallback lists, by strip type ────────────────────────────────────────────────
//
// **The criterion is EDIT FREQUENCY, not interlock-ness.** Every Block is
// reachable from the expanded view, so reachability cannot be why these earn a
// field — what earns one is being read or edited on most Strips. A heading and
// an initial altitude are issued with every departure clearance; a radar vector
// is issued constantly. Every field costs Strip height, and Strip height costs
// Strips-visible-per-Bay. Keep these lists earned.
//
// Used for any (strip type, Position) pair COMPACT_BLOCKS_BY_POSITION does not name.
// STATE (25 / M25) is on no list: the Strip's tab header already says it.
//
// Filtered by the strip type's own Block Map before use (compactBlocksFor), so a
// Block listed here that a strip type does not have is dropped rather than drawn
// as an unlabelled field.
import { BLOCK_MAPS } from './strip-template.js';
import { hasMtrData } from './mtr-advisory.js';
import { facilityOfPosition } from './facility-topology.js';

export const COMPACT_BLOCKS_SHARED = [
  '1', '3', '5', '5A', '7', '8', '8A', '8B', '9', '22', '24A', 'IFR', 'RSVC', 'SREG',
];

export const COMPACT_BLOCKS_BY_STRIP_TYPE = {
  // Heading and initial altitude: the two things a departure clearance issues
  // beyond the route.
  DEPARTURE:  [...COMPACT_BLOCKS_SHARED, '20', '21', '9A-SPEED'],
  // '7' is the ASSIGNED altitude on this strip type (annotation-routed, append-only);
  // the vector is the other constant.
  ARRIVAL:    [...COMPACT_BLOCKS_SHARED, '9A-VECTOR', '9A-SPEED'],
  // '7' stays as the FILED request here; '7A' is the assignment beside it.
  OVERFLIGHT: [...COMPACT_BLOCKS_SHARED, '7A', '9A-VECTOR', '9A-SPEED'],
  MISSION:    ['M3', 'M1', 'M2', 'M4', 'M5', 'M6', 'M7'],
  // The carrier (crc-sync's docs/adr/0074, guide §9.12). MARSHAL shows the
  // marshal message: the derived stack fields first (CASE, ANGELS, DME,
  // EAT/PUSH, RADIAL, FINAL BEARING: read, never typed), then what the Marshal
  // enters for the flight (approach, button, low state, bingo, EEAT). EEAT is on
  // the face because it is "the field most likely to be missed" (§9.12 rule 7).
  // FINAL: callsign, type, final bearing, deck, distance, and the two the final controller types, HDG and ALT
  // (crc-sync docs/adr/0117).
  // PATTERN's SIDE (C18) is read-only and drawn only once it leads (SIDE_ONLY_WHEN_LEADING).
  MARSHAL:    ['C1', 'C2', 'C18', 'C3', 'C7', 'C6', 'C8', 'C5', 'C9', 'C4', 'C10', 'C12', 'C13', 'C14', 'C15', 'C19'],
  FINAL:      ['C1', 'C2', 'C18', 'C9', 'C16', 'C17', 'C19', '9A-VECTOR', '7A'],
  PATTERN:    ['C1', 'C2', 'C18', 'C24'],
};

// ── Per-Position lists ─────────────────────────────────────────────────────
//
// What each Position actually works. The rules they follow, so the next edit
// keeps to them (efsp-strip-fields.test.mjs holds every one):
//  - TYPE (3) already reads count/type/wake, so ACFT (3A) and WAKE (3B) never
//    get a field of their own.
//  - CID (4) and TAIL (3C) are on no Strip: nothing reads either at a glance.
//  - HOOK (3F) is Tower's alone (carrier control later). ORDNANCE (3G) is on
//    Tower's and OPS's face always (OPS records the load state, UI-A U1); on AP, CTR and every tactical Position it is on the
//    face only once it is set to something other than CLEAN — see
//    ORDNANCE_WHEN_SET below (decisions.md H55 and S-L12, crc-sync's
//    docs/adr/0069).
//  - A runway field only for the airfield Positions: OPS, CD, GC, LC, AP.
//  - FREQ (22) only where a controller works more than one frequency: AP and
//    CTR. OPS, CD, GC and LC each sit on one.
//  - The assigned altitude (ALT) wherever a clearance is issued or worked: CD,
//    LC, AP, CTR. The assigned heading (HDG) only where aircraft are
//    vectored: AP and CTR (docs/adr/0058) — a departure clearance rarely
//    carries one.
//  - The TOFI fields (IFR, RSVC, SREG) and airspace ownership (24A) where TOFI
//    and airspace entry happen: CTR. SREG stays at AP too, because MARSA —
//    which AP can declare — writes it.
//  - TAXI (17) on GC's face and TAKEOFF (18) on LC's: the off-block call and the takeoff call are
//    what those two Positions receive and type (S-L16 W2, ADR 0073), and neither was on any face.
//  - RELEASE (14A, the release state) on a DEPARTURE at AP and CTR, because the release
//    travels CTR -> AP -> LC (guide §4.6.2) and each of them reads and passes it (UI-A U5).
//  - ALERT (14E) where an alert aircraft is ordered and moved: OPS sets it
//    (decisions.md H56), and every ground Position shows it: CD, GC, LC
//    (crc-sync docs/adr/0070).
export const COMPACT_BLOCKS_BY_POSITION = {
  DEPARTURE: {
    OPS: ['1', '3', '5', '6', '7', '8', '8A', '8B', '9', '9F', '3D', '3E', '3G', '14E'],
    CD:  ['1', '3', '5', '7', '8', '8A', '8B', '9', '9F', '10', '14A', '14D', '21', '14E'],
    GC: ['1', '3', '5', '8', '8A', '14A', '14D', '17', '14E'],
    LC: ['1', '3', '5', '8A', '21', '14D', '18', '3F', '3G', '14E'],
    AP: ['1', '3', '5', '7', '8A', '9', '20', '21', '9A-SPEED', '14A', '22', '5A', 'SREG'],
    CTR: ['1', '3', '5', '7', '21', '20', '9A-SPEED', '8B', '9', '14A', '22', '24A', 'IFR', 'RSVC', 'SREG', '5A'],
  },
  ARRIVAL: {
    GC: ['1', '3', '5', '8B'],
    LC: ['1', '3', '5', '7', '8B', '9A-FUEL', '3F', '3G'],
    AP: ['1', '3', '5', '6', '7', '8A', '8B', '9A-VECTOR', '9A-SPEED', '22', '5A', 'SREG'],
    CTR: ['1', '3', '5', '6', '7', '9A-VECTOR', '9A-SPEED', '22', '24A', 'IFR', 'RSVC', 'SREG', '5A'],
  },
  OVERFLIGHT: {
    AP: ['1', '3', '5', '7A', '8B', '9', '9A-VECTOR', '9A-SPEED', '22', '5A', 'SREG'],
    CTR: ['1', '3', '5', '7A', '8B', '9', '9A-VECTOR', '9A-SPEED', '22', '24A', 'IFR', 'RSVC', 'SREG', '5A'],
  },
};

// Grid columns a field spans. Everything else takes one.
export const FIELD_SPANS = { '1': 2, '3': 2, '9': 3, '24A': 2, M1: 2, M3: 2, M5: 2, C1: 2, C2: 1, C24: 2 };

function _blockMapFor(stripType) {
  return (BLOCK_MAPS && BLOCK_MAPS[stripType]) || null;
}

/**
 * The fields a Strip of this strip type shows when `positionId` owns it, in render
 * order. The per-Position list if there is one, else the strip type's; either way
 * only Blocks the strip type's Block Map actually has.
 */
export function compactBlocksFor(stripType, positionId, flightData) {
  const byPosition = COMPACT_BLOCKS_BY_POSITION[stripType];
  let list = (byPosition && positionId && byPosition[positionId])
    || COMPACT_BLOCKS_BY_STRIP_TYPE[stripType] || COMPACT_BLOCKS_SHARED;
  // Hung ordnance (crc-sync's docs/adr/0069): ORDNANCE, only once it says something —
  // before the MTR group, which starts its own grid row.
  if (_ordnanceWhenSet(stripType, positionId) && isOrdnanceSet(flightData) && !list.includes('3G')) list = [...list, '3G'];
  // §9.4 (docs/adr/0062): the flight's MTR group, only when it has MTR data.
  const mtr = flightData && hasMtrData(flightData) && MTR_BLOCKS_BY_POSITION[stripType] && positionId
    ? MTR_BLOCKS_BY_POSITION[stripType][positionId] : null;
  if (mtr) list = [...list, ...mtr];
  const map = _blockMapFor(stripType);
  let out = map ? list.filter(id => Object.prototype.hasOwnProperty.call(map, id)) : list;
  const sideLeads = sideNumberLeads(stripType, positionId, flightData);
  if (!sideLeads && SIDE_ONLY_WHEN_LEADING.includes(stripType)) out = out.filter(id => id !== 'C18');
  return sideLeads ? _swapSideAndCallsign(out) : out;
}

// ── The carrier's side number (decisions.md H122, H117; crc-sync's docs/adr/0114) ──
//
// The carrier regime names an aircraft by its side number, so on a carrier Strip
// the side number (C18) takes the callsign's slot (C1's place and width) and the
// callsign takes the side number's. Only once a side number is typed: until then
// the callsign keeps the big slot, so a Strip is never led by an empty field.
// A carrier Strip is one owned by a CARRIER Position (MARSHAL, FINAL, PATTERN):
// FINAL and PATTERN are also Incirlik's strip types (PAR, RSU), which never swap.
// PATTERN's SIDE is read-only, so it is on the face only while it leads: an RSU
// Strip, or a carrier one with no side number, looks as it always did.
export const SIDE_ONLY_WHEN_LEADING = ['PATTERN'];

export function sideNumberLeads(stripType, positionId, flightData) {
  const map = _blockMapFor(stripType);
  if (!map || !map.C1 || !map.C18) return false;
  if (facilityOfPosition(positionId) !== 'CARRIER') return false;
  const carrier = flightData && flightData.military && flightData.military.carrier;
  return !!(carrier && String(carrier.sideNumber || '').trim());
}

/**
 * The name a carrier view gives a flight (decisions H124: "on every carrier operation the side number is more important than
 * the callsign"): the side number when it leads on the Strip (`sideNumberLeads`), else the callsign. Every view off the Strip
 * that names a flight (the PriFly pattern chip, the MARSHAL board, the FINAL Bay line, toasts and menus) uses this, so it
 * agrees with the Strip face; Incirlik's Strips name the callsign as before.
 */
export function leadingFlightName(strip, flightData) {
  const callsign = (flightData && flightData.identity && flightData.identity.callsign) || '';
  if (!strip || !sideNumberLeads(strip.stripType, strip.ownerPositionId, flightData)) return callsign;
  return String(flightData.military.carrier.sideNumber).trim();
}

function _swapSideAndCallsign(list) {
  const c1 = list.indexOf('C1');
  const c18 = list.indexOf('C18');
  if (c1 < 0 || c18 < 0) return list;
  const out = [...list];
  out[c1] = 'C18';
  out[c18] = 'C1';
  return out;
}

// ── Ordnance (guide §9.5, crc-sync's docs/adr/0069) ────────────────────────
//
// A pilot reports hung ordnance to whoever they are talking to, so AP, CTR and
// every tactical Position may record it (decisions.md H55). A field on every
// Strip those Positions work would cost Strip height on every flight for a value
// that is almost always CLEAN, so — as the MTR group does (H51) — ORDNANCE goes
// on their face only while it says something other than CLEAN (S-L12). Before
// that it is one tap away in the expanded view (▼), where every Block off the
// face is. Tower keeps it on its face unconditionally (COMPACT_BLOCKS_BY_POSITION).
export const ORDNANCE_WHEN_SET = { positions: ['AP', 'CTR'], roles: ['MISSION'] };

function _ordnanceWhenSet(stripType, positionId) {
  return ORDNANCE_WHEN_SET.roles.includes(stripType) || (!!positionId && ORDNANCE_WHEN_SET.positions.includes(positionId));
}

/** True when the flight's ordnance state is anything but CLEAN or empty. */
export function isOrdnanceSet(flightData) {
  const state = flightData && flightData.military ? flightData.military.ordnanceState : null;
  return !!state && state !== 'CLEAN';
}

/** `sideLeads` (sideNumberLeads): the side number has the callsign's slot, so it takes the callsign's width too. */
export function fieldSpanFor(blockId, sideLeads = false) {
  if (sideLeads && blockId === 'C18') return fieldSpanFor('C1');
  if (sideLeads && blockId === 'C1') return fieldSpanFor('C18');
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
//  - GC and LC: none — ground movement and the runway do not use MTR data.
//  - AP and CTR release the aircraft into the route and take the call on
//    exit: the whole group, M11 first. An ARRIVAL is past the route, so its
//    entry is history and stays in the expanded view.
//  - MISSION: no MTR Blocks at all. Any Position not named: the expanded view.
export const MTR_BLOCKS_BY_POSITION = {
  DEPARTURE: {
    OPS: ['9G-MTR', '9G-ENTRY', '9G-TIME'],
    CD:  ['9G-MTR'],
    AP: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
    CTR: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
  },
  ARRIVAL: {
    AP: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT'],
    CTR: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT'],
  },
  OVERFLIGHT: {
    AP: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
    CTR: ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME'],
  },
};

