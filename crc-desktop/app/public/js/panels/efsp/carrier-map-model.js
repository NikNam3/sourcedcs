'use strict';

// The carrier map's geometry and rules (mockup docs/mockups/carrier-map-panel.html, revision 5; decisions H117-H119, S-ARCH-36, H121;
// lane note docs/wip/CARRIER-MAP.md). A leaf: it imports nothing, so node:test imports it directly.
//
// Everything is in the SHIP'S FRAME, nautical miles east (`e`) and north (`n`) of the ship, true north up (the map is always
// north-up, H119). The panel turns nm into pixels with one scale; nothing here knows about pixels except the label declutter, which
// works on the boxes the panel measured.
//
// Pattern geometry follows CV NATOPS (NAVAIR 00-80T-105, July 2009) where it gives a number; where it gives none the number is OURS
// and says so. Patterns are drawn only while occupied (S-ARCH-36), and carry no altitude or distance label.

export const RANGE_MIN_NM = 2.5;
export const RANGE_MAX_NM = 65;
export const RANGE_DEFAULT_NM = 30;
/** Pixels kept free between the range circle and the shorter side (the mockup's). */
export const EDGE_PX = 24;
/** The approach turn drawn for a bolter with none assigned (ours, as the MARSHAL picture). */
export const DEFAULT_TURN_NM = 6;

export const GEOMETRY = Object.freeze({
  // Case III bolter/waveoff (6.4.8, p. 6-17: straight ahead on the extended final bearing; downwind at 4 nm ahead when no
  // instructions; turn to final at the assigned approach turn, H118). Abeam distance of the downwind: 2 nm, ours.
  bolterUpwindNm: 4, bolterAbeamNm: 2,
  // Case I port holding (6.2.1, p. 6-2): left-hand, tangent to the BRC, ship at 3 o'clock, at most 5 nm across. Drawn at 5 nm.
  portHoldDiameterNm: 5,
  // The landing pattern (6.2.1, 6.2.4, pp. 6-2/6-3): the initial 3 nm astern; downwind 1 to 1.5 nm abeam (1.25 drawn, ours);
  // break at the bow (0.4 nm ahead drawn, ours; NATOPS: never more than 4 nm ahead); the 180 abeam the stern (0.6 nm astern, ours).
  initialAsternNm: 3, breakAheadNm: 0.4, downwindAbeamNm: 1.25, oneEightyAsternNm: 0.6,
  // The spin (6.2.1): 1,200 ft within 3 nm of the ship. Drawn as the 3 nm circle round the ship (the mockup's).
  spinRadiusNm: 3,
  // The recovery tanker (6.10.3, p. 6-39): racetrack near the ship, not more than 10 nm ahead, downwind 3 to 5 nm abeam, tanking
  // done before 6 nm astern. Drawn 10 ahead to 6 astern, 4 nm abeam (ours, within NATOPS' 3 to 5).
  tankerAheadNm: 10, tankerAsternNm: 6, tankerAbeamNm: 4,
  // The marshal holding pattern (6.4.1.1, p. 6-6): "a left-hand, 6-minute racetrack pattern. The inbound leg shall pass over the
  // holding fix." Two 1-minute standard-rate turns and two 2-minute legs at the 250 KIAS of 6.4.7.2: legs of 8 nm and a width of
  // 2.6 nm (both ours, worked from those numbers; NATOPS draws no size). Docs/adr/0137, live test U21.
  marshalLegNm: 8, marshalWidthNm: 2.6,
  // After marshal (6.4.7.2 and the glossary): 250 KIAS and 4,000 fpm to the platform (5,000 ft), then 2,000 fpm to the 10 nm DME fix;
  // the 6 nm DME fix at 1,200 ft on the final bearing. The platform's range is worked from the base altitude (6,000 ft at the first
  // fix): 1,000 ft at 4,000 fpm is 15 s, about 1 nm at 250 kt (ours).
  tenMileNm: 10, sixMileNm: 6, platformBeforeFixNm: 1,
});

// The fallback that tells a spin from the landing pattern when the Strip cannot (both are PATTERN IN_PATTERN): a contact within
// SPIN_WITHIN_NM of the ship at or above SPIN_MIN_FT is spinning (NATOPS: spin 1,200 ft within 3 nm; break 800, downwind 600).
// Both numbers ours.
export const SPIN_WITHIN_NM = 3.5;
export const SPIN_MIN_FT = 1000;

const RAD = Math.PI / 180;
const NM_PER_DEG_LAT = 60;

// ── zoom ──────────────────────────────────────────────────────────────────

export function clampRange(nm) {
  const v = Number(nm);
  if (!Number.isFinite(v)) return RANGE_DEFAULT_NM;
  return Math.min(RANGE_MAX_NM, Math.max(RANGE_MIN_NM, v));
}

/**
 * The range after a wheel step, with the radar map's feel (MapLibre's wheel zoom: a zoom level per 450 px of wheel delta; one zoom
 * level halves or doubles the range). Rounded to a tenth of a mile.
 */
export function wheelRange(range, deltaY) {
  const next = clampRange(range) * 2 ** (deltaY / 450);
  return Math.round(clampRange(next) * 10) / 10;
}

/** Pixels per nautical mile for a panel `w` x `h`: the range is the radius that fits the shorter side. */
export function scaleFor(w, h, range) {
  return Math.max(1, Math.min(w, h) / 2 - EDGE_PX) / clampRange(range);
}

// ── rings ─────────────────────────────────────────────────────────────────

/** The spacing in force: the controller's ('1', '2.5', '5', '10'), or by range ('auto', the mockup's table). */
export function ringSpacingFor(range, setting = 'auto') {
  const s = Number(setting);
  if (setting !== 'auto' && Number.isFinite(s) && s > 0) return s;
  return range <= 5 ? 1 : range <= 15 ? 2.5 : range <= 40 ? 5 : 10;
}

/**
 * The range rings out to `reachNm` (the corners), and the 10 nm ring always (H119). Labels: every ring at short range, else the
 * tens; the 10 nm ring always labelled.
 * @returns {{nm:number, ten:boolean, label:boolean}[]}
 */
export function ringsFor(range, reachNm, spacing) {
  const out = [];
  const step = spacing > 0 ? spacing : 5;
  const max = Math.min(reachNm, 400);
  for (let i = 1; i * step <= max + 1e-9 && i < 1000; i++) {
    const nm = Math.round(i * step * 1000) / 1000;
    const ten = Math.abs(nm - 10) < 1e-9;
    out.push({ nm, ten, label: ten || nm % 10 === 0 || range <= 12 });
  }
  if (!out.some((r) => r.ten)) out.push({ nm: 10, ten: true, label: true });
  return out.sort((a, b) => a.nm - b.nm);
}

// ── frames ────────────────────────────────────────────────────────────────

/** A position in the ship's frame (local tangent plane; at 65 nm the error is far below a pixel's worth of label). */
export function toFrame(ship, lat, lon) {
  const dLon = ((lon - ship.lon + 540) % 360) - 180;
  return { e: dLon * NM_PER_DEG_LAT * Math.cos(ship.lat * RAD), n: (lat - ship.lat) * NM_PER_DEG_LAT };
}

/** A point at a true bearing and range from the ship. */
export function polar(brgDeg, nm) {
  return { e: nm * Math.sin(brgDeg * RAD), n: nm * Math.cos(brgDeg * RAD) };
}

/** A point `along` nm ahead on the axis (negative astern), `lat` nm to starboard (negative to port). */
export function onAxis(axisDeg, along, lat) {
  const a = axisDeg * RAD;
  return { e: along * Math.sin(a) + lat * Math.cos(a), n: along * Math.cos(a) - lat * Math.sin(a) };
}

/** An arc in the axis frame: centre (`cAlong`, `cLat`), radius `r`, from `from` to `to` degrees (0 ahead, 90 starboard). */
export function arcOnAxis(axisDeg, cAlong, cLat, r, from, to, steps = 16) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (from + (to - from) * i / steps) * RAD;
    out.push(onAxis(axisDeg, cAlong + r * Math.cos(t), cLat + r * Math.sin(t)));
  }
  return out;
}

export function distanceNm(p) { return Math.hypot(p.e, p.n); }

// ── fixed lines ───────────────────────────────────────────────────────────

/**
 * The extended centreline: astern along the final bearing from the ship to the edge (`reachNm`), a tick every mile; and the final
 * bearing a short way ahead (2 nm, the mockup's). Ticks are given as points with the unit vector across the line; the panel draws
 * them a fixed number of pixels long.
 */
export function extendedCentreline(finalBearingDeg, reachNm) {
  const astern = (finalBearingDeg + 180) % 360;
  const ticks = [];
  for (let nm = 1; nm <= Math.floor(reachNm); nm++) ticks.push(polar(astern, nm));
  return { from: polar(finalBearingDeg, 2), to: polar(astern, reachNm), ticks, across: polar((finalBearingDeg + 90) % 360, 1) };
}

/**
 * The marshal radial and the stack: from the first fix out to the highest fix in use (the first fix + 1 when nobody holds), a mark at
 * each fix in use. The fixes are the server's (`marshalDme`, angels + 15); nothing is worked out here.
 */
export function marshalStack(radialDeg, firstFix, fixDmes) {
  const dmes = [...new Set((fixDmes || []).filter(Number.isFinite))].sort((a, b) => a - b);
  const top = Math.max(firstFix + 1, ...dmes);
  return {
    from: polar(radialDeg, firstFix), to: polar(radialDeg, top), top,
    fixes: dmes.map((d) => ({ dme: d, at: polar(radialDeg, d) })),
    across: polar((radialDeg + 90) % 360, 1),
    labelAt: polar(radialDeg, top + GEOMETRY.marshalLegNm + 2), // beyond the holding pattern's far turn (docs/adr/0137)
  };
}

// ── patterns ──────────────────────────────────────────────────────────────

/**
 * The marshal holding pattern (6.4.1.1): a left-hand racetrack whose inbound leg runs down the radial towards the ship and passes
 * over the fixes, the near turn at the first fix. Left-hand: inbound (heading to the ship) the turns are to the left, so the
 * outbound leg lies clockwise of the radial as seen from the ship. The far end is a leg beyond the highest fix in use.
 */
export function marshalHolding(radialDeg, firstFix, topFix, g = GEOMETRY) {
  const r = g.marshalWidthNm / 2;
  const near = firstFix;
  const far = Math.max(topFix, firstFix) + g.marshalLegNm;
  return [onAxis(radialDeg, far, 0), onAxis(radialDeg, near, 0)]
    .concat(arcOnAxis(radialDeg, near, r, r, 180 + 90, 90))
    .concat([onAxis(radialDeg, far, g.marshalWidthNm)])
    .concat(arcOnAxis(radialDeg, far, r, r, 90, -90));
}

/**
 * The Case III path after marshal (6.4.7.2): from the first fix in along the marshal radial to the platform, on to the 10 nm and
 * 6 nm DME fixes on the final bearing, and to the ship. When the radial is the final bearing's reciprocal (the default) this is
 * one straight line down the extended centreline; a radial typed elsewhere turns at the 10 nm fix.
 */
export function approachPath(radialDeg, finalBearingDeg, firstFix, g = GEOMETRY) {
  const astern = (finalBearingDeg + 180) % 360;
  const platformNm = Math.max(g.tenMileNm, firstFix - g.platformBeforeFixNm);
  const fix = polar(radialDeg, firstFix);
  const platform = polar(radialDeg, platformNm);
  const ten = polar(astern, g.tenMileNm);
  const six = polar(astern, g.sixMileNm);
  return { points: [fix, platform, ten, six, { e: 0, n: 0 }], marks: [
    { id: 'platform', at: platform, text: 'PLATFORM' }, { id: 'ten', at: ten, text: '10' }, { id: 'six', at: six, text: '6' },
  ] };
}

/** Case III bolter/waveoff racetrack: upwind to 4 nm on the final bearing, left to the downwind (port), left in at `turnNm`. */
export function bolterRacetrack(finalBearingDeg, turnNm, g = GEOMETRY) {
  const f = finalBearingDeg;
  const r = g.bolterAbeamNm / 2;
  return [onAxis(f, 0, 0), onAxis(f, g.bolterUpwindNm, 0)]
    .concat(arcOnAxis(f, g.bolterUpwindNm, -r, r, 90, -90))
    .concat([onAxis(f, -turnNm, -g.bolterAbeamNm)])
    .concat(arcOnAxis(f, -turnNm, -r, r, -90, -270));
}

/** Case I port holding: left-hand circle tangent to the BRC, the ship at its 3 o'clock. */
export function portHolding(brcDeg, g = GEOMETRY) {
  const r = g.portHoldDiameterNm / 2;
  return { centre: onAxis(brcDeg, 0, -r), r };
}

/** The break and landing pattern, and the initial point: initial 3 nm astern on the BRC, break at the bow, downwind to port, 180 to the angled deck. */
export function landingPattern(brcDeg, finalBearingDeg, g = GEOMETRY) {
  const half = g.downwindAbeamNm / 2;
  const initial = onAxis(brcDeg, -g.initialAsternNm, 0);
  const points = [initial, onAxis(brcDeg, g.breakAheadNm, 0)]
    .concat(arcOnAxis(brcDeg, g.breakAheadNm, -half, half, 90, -90))
    .concat([onAxis(brcDeg, -g.oneEightyAsternNm, -g.downwindAbeamNm)])
    .concat(arcOnAxis(finalBearingDeg, -(g.oneEightyAsternNm + 0.3), -half, half, -90, -270));
  return { points, initial };
}

/** The spin pattern: within 3 nm of the ship. */
export function spinCircle(g = GEOMETRY) { return { centre: { e: 0, n: 0 }, r: g.spinRadiusNm }; }

/** The recovery tanker's racetrack: along the BRC and abeam on the pattern side, 10 nm ahead to 6 nm astern, round ends. */
export function tankerRacetrack(brcDeg, side = 'port', g = GEOMETRY) {
  const s = side === 'starboard' || side === 'stbd' ? 1 : -1;
  const r = g.tankerAbeamNm / 2;
  const aheadC = g.tankerAheadNm - r;
  const asternC = -(g.tankerAsternNm - r);
  // left-hand on the port side, right-hand to starboard: outbound (into the BRC) on the ship's line, back on the far leg
  return [onAxis(brcDeg, asternC, 0), onAxis(brcDeg, aheadC, 0)]
    .concat(arcOnAxis(brcDeg, aheadC, s * r, r, s > 0 ? -90 : 90, s > 0 ? 90 : -90))
    .concat([onAxis(brcDeg, asternC, s * g.tankerAbeamNm)])
    .concat(arcOnAxis(brcDeg, asternC, s * r, r, s > 0 ? 90 : -90, s > 0 ? 270 : -270));
}

// ── what is occupied ──────────────────────────────────────────────────────

/**
 * Which patterns to draw. Strip state first (the board's rows, marshal-board-model.js `buildBoard`), geometry only where the Strip
 * cannot say (a PATTERN Strip is the same state in the break, the downwind and the spin):
 *   - a FINAL Strip in BOLTER_WAVEOFF (row kind `bolter`)  -> the bolter racetrack, one per assigned approach turn (any Case);
 *   - a MARSHAL Strip IN_STACK (kind `hold`) in Case I or II -> port holding;
 *   - a PATTERN Strip IN_PATTERN (kind `pattern`)           -> the landing pattern with the initial, unless its contact is within
 *     SPIN_WITHIN_NM at or above SPIN_MIN_FT: then the spin; no contact -> the landing pattern;
 *   - the tanker's racetrack while the carrier state says on station.
 *
 * @param {object} a
 * @param {string|null} a.caseValue 'I' | 'II' | 'III'
 * @param {object[]} a.rows          buildBoard().rows
 * @param {boolean} a.tankerOnStation
 * @param {(row:object)=>({at:{e:number,n:number}, altFt:number|null}|null)} [a.contactOf]
 */
export function occupancy({ caseValue, rows, tankerOnStation, contactOf }) {
  const out = { bolterTurns: [], portHolding: false, landing: false, spin: false, tanker: !!tankerOnStation, approach: false };
  const turns = new Set();
  const sequenced = caseValue === 'II' || caseValue === 'III';
  for (const r of rows || []) {
    // docs/adr/0137 (U21): the planned path after marshal while anyone is recovering in Case II/III, and in Case I/II the landing
    // pattern a holding flight will fly next (the pattern is where every recovery ends)
    if (sequenced && (r.kind === 'hold' || r.kind === 'comm' || r.kind === 'approach')) out.approach = true;
    if (r.kind === 'hold' && (caseValue === 'I' || caseValue === 'II')) out.landing = true;
    if (r.kind === 'bolter') turns.add([4, 6, 8].includes(r.turnNm) ? r.turnNm : DEFAULT_TURN_NM);
    else if (r.kind === 'hold' && (caseValue === 'I' || caseValue === 'II')) out.portHolding = true;
    else if (r.kind === 'pattern') {
      const c = contactOf ? contactOf(r) : null;
      if (c && c.at && distanceNm(c.at) <= SPIN_WITHIN_NM && Number.isFinite(c.altFt) && c.altFt >= SPIN_MIN_FT) out.spin = true;
      else out.landing = true;
    }
  }
  out.bolterTurns = [...turns].sort((a, b) => a - b);
  return out;
}

// ── labels ────────────────────────────────────────────────────────────────

/**
 * Places the labels so none overlaps another (the stack's fixes are a mile apart: at most zooms their labels would sit on each
 * other). Each label prefers its own place (`dx`, `dy` from its symbol); if that box is taken it tries the other three corners, then
 * steps up and down beside the symbol. Placed in the order given (the panel puts a problem first). A label that moved gets a leader.
 *
 * @param {{id:string, x:number, y:number, w:number, h:number}[]} labels  symbol position and label box size, pixels
 * @param {{dx?:number, dy?:number, maxSteps?:number, obstacles?:{x:number,y:number,w:number,h:number}[]}} [o] the label's own
 *   place: its box's left edge `dx` right of the symbol, its top `dy` above it; `obstacles`, boxes no label may cover (the ship,
 *   the symbols, the stack's name)
 * @returns {Map<string, {x:number, y:number, moved:boolean}>} each label box's top-left
 */
export function declutter(labels, { dx = 10, dy = 14, maxSteps = 8, obstacles = [] } = {}) {
  const placed = obstacles.map((b) => ({ ...b }));
  const out = new Map();
  const hits = (b) => placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
  for (const l of labels) {
    const cands = [
      { x: l.x + dx, y: l.y - dy },
      { x: l.x + dx, y: l.y + dy - l.h },
      { x: l.x - dx - l.w, y: l.y - dy },
      { x: l.x - dx - l.w, y: l.y + dy - l.h },
    ];
    for (let i = 1; i <= maxSteps; i++) {
      cands.push({ x: l.x + dx, y: l.y - dy - i * l.h });
      cands.push({ x: l.x + dx, y: l.y + dy - l.h + i * l.h });
      cands.push({ x: l.x - dx - l.w, y: l.y - dy - i * l.h });
      cands.push({ x: l.x - dx - l.w, y: l.y + dy - l.h + i * l.h });
    }
    let chosen = cands[0];
    let idx = 0;
    for (let i = 0; i < cands.length; i++) {
      if (!hits({ ...cands[i], w: l.w, h: l.h })) { chosen = cands[i]; idx = i; break; }
    }
    placed.push({ ...chosen, w: l.w, h: l.h });
    out.set(l.id, { x: chosen.x, y: chosen.y, moved: idx > 0 });
  }
  return out;
}
