'use strict';
import { _combinationEl } from './state.js';
import { getActingPositions, getAckedPositions, getSignedOnPositions, sendEfspSetPositions, setSignOnNoticeListener } from '../efsp-ws.js';
import { getAllEfspPositions, getAllEfspStrips, getEfspFlightData, getEfspSelf } from '../efsp-state.js';
import { combinationLine, combinationOf, hatRows, luawInUse, vacatedBetween } from '../combination-rules.js';

// crc-sync docs/adr/0105, 0110 (H104, H111): the line above the Position tabs that says LC is combined with a non-local Position
// (and which frequencies to monitor), and the hat rows: "CD is unstaffed with 3 Strips. Take CD as well?" for the Primary of the
// Position the server offers it to, and "Take it?" for an Observer of a Position with no Primary. The offers are standing server state
// (each Position entry's `hatOffers`), so a late sign-on or a reconnect shows them. Taking one is an ordinary sign-on. Nothing here blocks anything.

let _signOnNotice = ''; // the one line a reconnect shows when a Position could not be kept (docs/wip/DESK-SIGNON.md)
setSignOnNoticeListener((text) => { _signOnNotice = text; renderCombination(); });

// Position -> { count, onRunway }: a row hidden by "Not now", or for a Position this controller left itself, until its count grows.
const _hidden = new Map();
let _heldBefore = {}; // facility -> Positions acked last render, to see what this controller vacated

const _liveCount = (positionId) => getAllEfspStrips().filter(s => s.ownerPositionId === positionId && s.state !== 'DROPPED').length;
const _callsignOf = (strip) => {
  const fd = getEfspFlightData(strip.flightDataId);
  return (fd && fd.identity && fd.identity.callsign) || strip.stripId;
};

function _hide(row) { _hidden.set(row.positionId, { count: row.count, onRunway: row.onRunway }); renderCombination(); }

/** Taking a hat: the controller's declared set plus the Position; for an Observer the same set again (the server makes them Primary). */
function _take(row) {
  const held = getSignedOnPositions(row.facilityId);
  _hidden.delete(row.positionId);
  sendEfspSetPositions(row.facilityId, [...new Set([...held, row.positionId])]);
  renderCombination();
}

/** Redraws the line and the rows. A no-op until initEfspPanel() has cached the element. */
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
  if (_signOnNotice) {
    const row = document.createElement('div');
    row.className = 'efsp-signon-notice efsp-combination-line efsp-combination-severe';
    row.textContent = _signOnNotice;
    el.appendChild(row);
  }
  // What this controller just left stays quiet until its Strips grow in number (the sign-off ack already said who was left).
  const held = {};
  for (const f of new Set(positions.map(p => p.facilityId).filter(Boolean))) held[f] = getAckedPositions(f);
  for (const id of vacatedBetween(_heldBefore, held)) _hidden.set(id, { count: _liveCount(id), onRunway: Infinity });
  _heldBefore = held;
  const rows = hatRows(positions, getEfspSelf() && getEfspSelf().controllerId, getAllEfspStrips(), acting, { hidden: _hidden, callsignOf: _callsignOf });
  // A hidden row whose offer has lapsed is forgotten, so the same count coming back later is shown.
  for (const id of [..._hidden.keys()]) if (!rows.some(r => r.positionId === id) && !_stillHidden(positions, id)) _hidden.delete(id);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'efsp-position-offer' + (r.severe ? ' efsp-combination-severe' : '');
    row.dataset.offerFor = r.positionId;
    row.dataset.offerKind = r.kind;
    const text = document.createElement('span');
    text.textContent = r.text;
    const take = document.createElement('button');
    take.type = 'button'; take.className = 'efsp-offer-take'; take.textContent = r.label;
    take.addEventListener('click', () => _take(r));
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'efsp-offer-dismiss'; no.textContent = 'Not now';
    no.addEventListener('click', () => _hide(r));
    row.append(text, take, no);
    el.appendChild(row);
  }
  el.hidden = el.childElementCount === 0;
}

// True while some Position's `hatOffers` (or an Observer prompt) still names `id`, so a hidden entry for it must be kept.
function _stillHidden(positions, id) {
  const selfId = (getEfspSelf() || {}).controllerId;
  return positions.some(p => (p.hatOffers || []).some(o => o.positionId === id) && p.primary && p.primary.controllerId === selfId)
    || (_liveCount(id) > 0 && positions.some(p => p.positionId === id && !p.primary));
}
