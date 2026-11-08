'use strict';

// The Case I picture (crc-sync docs/adr/0156): the overhead holding stack as a circle around the ship, ship-up (BRC up),
// each Case I flight at its live bearing and range from the ship, labelled side number and angels. A flight with no track
// bound is listed in the table and not drawn (Case I gets no radar service; the controller binds one if they want it).
// The pure part (circleModel) is node-testable; renderMarshalCircle only draws it.

export const CIRCLE = Object.freeze({ SIZE: 360, RING_NM: 2.5, VIEW_NM: 6 });

/**
 * @param {object[]} rows   marshal-board-model.js buildBoard().caseI
 * @param {{brcDeg:number|null}} ctx  the ship's BRC (true), or null (then north-up)
 * @returns {{ringR:number, center:number, aircraft:{flightDataId:string, x:number, y:number, label:string}[]}}
 */
export function circleModel(rows, { brcDeg = null } = {}) {
  const c = CIRCLE.SIZE / 2;
  const k = c / CIRCLE.VIEW_NM;
  const up = Number.isFinite(brcDeg) ? brcDeg : 0;
  const aircraft = [];
  for (const r of rows || []) {
    if (!Number.isFinite(r.bearingDeg) || !Number.isFinite(r.dme)) continue;
    const rel = ((r.bearingDeg - up) * Math.PI) / 180;
    const nm = Math.min(r.dme, CIRCLE.VIEW_NM);
    aircraft.push({
      flightDataId: r.flightDataId,
      x: c + Math.sin(rel) * nm * k,
      y: c - Math.cos(rel) * nm * k,
      label: `${r.side}${r.angels != null ? ` A${r.angels}` : ''}`,
    });
  }
  return { ringR: CIRCLE.RING_NM * k, center: c, aircraft };
}

function sv(name, attrs, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderMarshalCircle(svg, model) {
  svg.textContent = '';
  const c = model.center;
  svg.appendChild(sv('circle', { class: 'mp-stack', cx: c, cy: c, r: model.ringR, fill: 'none', 'stroke-dasharray': '3 3' }));
  // the ship, pointing up (BRC up)
  svg.appendChild(sv('path', { class: 'mp-ship', d: `M ${c} ${c - 9} L ${c + 5} ${c + 7} L ${c - 5} ${c + 7} Z` }));
  for (const a of model.aircraft) {
    svg.appendChild(sv('circle', { class: 'mp-plane', cx: a.x, cy: a.y, r: 4, 'data-flight': a.flightDataId }));
    svg.appendChild(sv('text', { class: 'mp-label', x: a.x + 7, y: a.y + 4 }, a.label));
  }
}
