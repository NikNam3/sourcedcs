'use strict';
import { fuelText } from './marshal-board-model.js';

// The Case III picture beside the recovery board (mockup docs/mockups/marshal-stack-panel.html, revision 7; crc-sync docs/adr/0114).
// After the CV NATOPS / Hornet pocket-checklist profile: the ship at the top, one line along the final bearing (the reciprocal of the
// marshal radial, corrected onto the final bearing by 12 nm), 0 to 12 nm to scale with a mark every two miles, compressed beyond
// that out to the first marshal fix; the stack along the marshal radial, each fix at angels + 15 DME (the server's `marshalDme`,
// the first fix being the Marshal's to move), the racetrack's inbound leg on the radial and its outbound leg on the hot side;
// aircraft by DME labelled side number, lane and fuel; the bolter racetrack to port, turning in at each flight's assigned approach
// turn (4, 6 or 8 nm, decisions H118; 6 when none is assigned: ours). No milestone is labelled: the controller knows them.
//
// `pictureModel` is pure (node:test imports it); `renderMarshalPicture` draws it into an <svg>. Nothing is worked out here that the
// server has already worked out: the DME of a commenced or inbound flight is the board's (radar), the fixes are the server's.

export const PICTURE = Object.freeze({ X: 230, TOP: 46, PER: 30, LIN: 12, GAP: 48, PERF: 15, ABEAM: 60, HOT: 34, DEFAULT_TURN_NM: 6 });

/** Pixels down the page for a DME: to scale to 12 nm, compressed to the first fix, then 15 px a mile. */
export function yOfDme(d, firstFix, g = PICTURE) {
  if (d <= g.LIN) return g.TOP + d * g.PER;
  if (d <= firstFix) return g.TOP + g.LIN * g.PER + (d - g.LIN) * g.GAP / (firstFix - g.LIN);
  return g.TOP + g.LIN * g.PER + g.GAP + (d - firstFix) * g.PERF;
}

/**
 * What to draw, from the board's rows.
 * @param {object[]} rows  marshal-board-model.js buildBoard().rows
 * @param {{firstFix:number, radialText:string}} ctx
 */
export function pictureModel(rows, ctx) {
  const firstFix = Number.isFinite(ctx.firstFix) ? ctx.firstFix : 21;
  const holding = rows.filter((r) => r.kind === 'hold');
  const topFix = Math.max(firstFix + 1, ...holding.map((r) => (Number.isFinite(r.marshalDme) ? r.marshalDme : 0)));
  const aircraft = [];
  for (const r of rows) {
    if (r.kind === 'hold' || r.kind === 'pattern') continue;
    // Without a radar contact an aircraft cannot be placed by DME: it is not drawn rather than drawn in the wrong place.
    if (!Number.isFinite(r.dme)) continue;
    aircraft.push({
      flightDataId: r.flightDataId, kind: r.kind, dme: r.dme, label: `${r.side || r.callsign}${r.lane ? ` ${r.lane}` : ''}`,
      fuel: fuelText(r.fuelLb), fuelLevel: r.fuelLevel, onRacetrack: r.kind === 'bolter', turnNm: r.turnNm || PICTURE.DEFAULT_TURN_NM,
    });
  }
  const fixes = holding.map((r) => ({
    flightDataId: r.flightDataId, dme: r.marshalDme, label: `${r.side || r.callsign}  A${r.angels}  ${r.marshalDme}`, fuelLevel: r.fuelLevel,
  })).filter((f) => Number.isFinite(f.dme));
  // One bolter racetrack per distinct turn-in among the flights on it; with nobody on it, the reference one at the default.
  const turns = [...new Set(aircraft.filter((a) => a.onRacetrack).map((a) => a.turnNm))].sort((a, b) => a - b);
  if (turns.length === 0) turns.push(PICTURE.DEFAULT_TURN_NM);
  return { firstFix, topFix, aircraft, fixes, turns, radialText: ctx.radialText || '', height: Math.max(600, yOfDme(topFix + 1, firstFix) + 40) };
}

function sv(name, attrs, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

const PLANE = 'M0 -11 L2.3 -3.2 L12 1.4 L12 3.7 L2.3 1.8 L1.6 7.8 L4.6 10 L4.6 11.5 L0 10 L-4.6 11.5 L-4.6 10 L-1.6 7.8 L-2.3 1.8 L-12 3.7 L-12 1.4 L-2.3 -3.2 Z';

/** The bolter / waveoff racetrack: straight on past the ship, left to `ABEAM` abeam, downwind, turning in at `turnNm`. */
export function racetrackPath(turnNm, firstFix, g = PICTURE) {
  const { X, ABEAM } = g;
  const y0 = yOfDme(0, firstFix, g);
  const yt = yOfDme(turnNm, firstFix, g);
  return `M ${X} ${y0} L ${X} ${y0 - 20} C ${X} ${y0 - 52}, ${X - ABEAM} ${y0 - 52}, ${X - ABEAM} ${y0 - 20}`
    + ` L ${X - ABEAM} ${yt} C ${X - ABEAM} ${yt + 40}, ${X} ${yt + 40}, ${X} ${yt + 8}`;
}

/** Draws the model into `svg` (emptied first). */
export function renderMarshalPicture(svg, model) {
  const g = PICTURE;
  const { X } = g;
  const MF = model.firstFix;
  const Y = (d) => yOfDme(d, MF, g);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 360 ${model.height}`);

  const lines = sv('g', { class: 'mp-ref', fill: 'none' });
  lines.appendChild(sv('line', { x1: X, y1: Y(0), x2: X, y2: Y(g.LIN) }));
  lines.appendChild(sv('line', { x1: X, y1: Y(g.LIN), x2: X, y2: Y(MF), 'stroke-dasharray': '4 4' }));
  lines.appendChild(sv('line', { x1: X, y1: Y(MF), x2: X, y2: Y(model.topFix + 1) }));
  for (const turn of model.turns) {
    lines.appendChild(sv('path', { d: racetrackPath(turn, MF, g), class: 'mp-bolter', 'stroke-dasharray': '2 4', 'data-turn-nm': String(turn) }));
  }
  svg.appendChild(lines);

  // the ship, angled deck
  const y0 = Y(0);
  svg.appendChild(sv('path', { class: 'mp-ship', d: `M ${X - 7} ${y0 + 12} L ${X - 9} ${y0 - 18} L ${X + 1} ${y0 - 26} L ${X + 9} ${y0 - 14} L ${X + 7} ${y0 + 12} Z` }));
  for (const d of [2, 4, 6, 8, 10, 12]) {
    svg.appendChild(sv('line', { class: 'mp-tick', x1: X - 5, x2: X + 5, y1: Y(d), y2: Y(d) }));
    svg.appendChild(sv('text', { class: 'mp-scale', x: X + 10, y: Y(d) + 4 }, String(d)));
  }
  svg.appendChild(sv('text', { class: 'mp-scale', x: X + 10, y: Y(MF) + 4 }, String(MF)));

  for (const a of model.aircraft) {
    const x = a.onRacetrack ? X - g.ABEAM : X;
    const y = Y(a.dme);
    svg.appendChild(sv('path', { class: 'mp-plane', d: PLANE, transform: `translate(${x} ${y}) rotate(${a.onRacetrack ? 180 : 0})`, 'data-side': a.label }));
    const lx = x - (a.onRacetrack ? 16 : 18);
    svg.appendChild(sv('text', { class: 'mp-label', x: lx, y: y - 1, 'text-anchor': 'end' }, a.label));
    svg.appendChild(sv('text', { class: `mp-fuel${a.fuelLevel ? ` mp-${a.fuelLevel}` : ''}`, x: lx, y: y + 14, 'text-anchor': 'end' }, a.fuel));
  }

  // the stack along the marshal radial: the racetrack's inbound leg on the radial, its outbound leg on the hot side
  const ya = Y(MF) - 6;
  const yb = Y(model.topFix + 1);
  svg.appendChild(sv('path', {
    class: 'mp-stack', fill: 'none', 'stroke-dasharray': '3 3',
    d: `M ${X} ${ya} L ${X} ${yb} C ${X} ${yb + 22}, ${X - g.HOT} ${yb + 22}, ${X - g.HOT} ${yb} L ${X - g.HOT} ${ya} C ${X - g.HOT} ${ya - 22}, ${X} ${ya - 22}, ${X} ${ya}`,
  }));
  for (const f of model.fixes) {
    const y = Y(f.dme);
    svg.appendChild(sv('line', { class: 'mp-fix', x1: X - 4, x2: X + 4, y1: y, y2: y }));
    svg.appendChild(sv('text', { class: `mp-fixlabel${f.fuelLevel ? ` mp-${f.fuelLevel}` : ''}`, x: X + 10, y: y + 4 }, f.label));
  }
  if (model.radialText) {
    svg.appendChild(sv('text', { class: 'mp-radial', x: X - g.HOT - 8, y: (ya + yb) / 2 + 4, 'text-anchor': 'end' }, `MARSHAL ${model.radialText}`));
  }
}
