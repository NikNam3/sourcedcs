'use strict';
import { _combinationEl } from './state.js';
import { getActingPositions, sendEfspSetPositions } from '../efsp-ws.js';
import { getAllEfspPositions, getAllEfspStrips } from '../efsp-state.js';
import { combinationLine, combinationOf, luawInUse, offerStands, offerText } from '../combination-rules.js';

// crc-sync docs/adr/0105 (H104): the line above the Position tabs that says LC is combined with GC/CD (and which
// frequencies to monitor), and the offer "Take GC as well?" made to LC's Primary when GC signs off holding Strips.
// Accepting is an ordinary sign-on to GC. Nothing here blocks anything.

let _offer = null; // { facilityId, offer, count }

/** `efsp-position-offer`. */
export function noteEfspPositionOffer(msg) {
  _offer = { facilityId: msg.facilityId, offer: msg.offer, count: msg.count };
  renderCombination();
}

export function dismissEfspPositionOffer() { _offer = null; renderCombination(); }

export function acceptEfspPositionOffer() {
  if (!_offer) return;
  const { facilityId, offer } = _offer;
  _offer = null;
  sendEfspSetPositions(facilityId, [...new Set([...getActingPositions(facilityId), offer])]);
  renderCombination();
}

export function _resetCombinationForTest() { _offer = null; }

/** Redraws the line. A no-op until initEfspPanel() has cached the element. */
export function renderCombination() {
  if (!_combinationEl) return;
  const el = _combinationEl;
  el.replaceChildren();
  const positions = getAllEfspPositions();
  const acting = getActingPositions();
  const facilityOf = (id) => (positions.find(p => p.positionId === id) || {}).facilityId;
  const lcFacility = facilityOf('LC');
  const facilityPositions = positions.filter(p => !p.facilityId || p.facilityId === lcFacility);
  const line = combinationLine(combinationOf(facilityPositions, acting), luawInUse(getAllEfspStrips(), lcFacility));
  if (line) {
    const row = document.createElement('div');
    row.className = 'efsp-combination-line' + (line.severe ? ' efsp-combination-severe' : '');
    row.textContent = line.text;
    el.appendChild(row);
  }
  if (_offer && !offerStands(_offer, positions.filter(p => !p.facilityId || p.facilityId === _offer.facilityId), acting)) _offer = null;
  if (_offer) {
    const row = document.createElement('div');
    row.className = 'efsp-position-offer';
    const text = document.createElement('span');
    text.textContent = offerText(_offer);
    const take = document.createElement('button');
    take.type = 'button'; take.className = 'efsp-offer-take'; take.textContent = `Take ${_offer.offer}`;
    take.addEventListener('click', acceptEfspPositionOffer);
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'efsp-offer-dismiss'; no.textContent = 'Not now';
    no.addEventListener('click', dismissEfspPositionOffer);
    row.append(text, take, no);
    el.appendChild(row);
  }
  el.hidden = el.childElementCount === 0;
}
