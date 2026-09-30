'use strict';

// What an imported ATO shows on a Strip (crc-sync's docs/adr/0071, guide §9.8,
// §9.9 part 2, §3.10.3). Three things, all read-only:
//
//  - the AR JOIN: a tanker's line and its receivers' Strips carry an `AR` badge
//    naming each other, and selecting one highlights the others. It is NOT
//    MARSA (docs/adr/0051): it declares nothing, writes nothing and says
//    nothing about separation. Its own class, never the word MARSA, never the
//    MARSA colour, and no control on it dispatches anything.
//  - the Mode 3 CONFLICT (§3.10.3 rule 3): when the ATO tasks one code and ATC
//    has assigned another, every Strip of the flight says so, until the codes
//    agree. Nothing prefers either code silently.
//  - the ▼ rows: Mode 1/2 (displayed, never edited — rule 1), the ATO's Mode 3,
//    datalink, SCL, mission type, agency, on-station time, AR detail and the
//    missing acceptance fields, on EVERY Role of the flight's Strips.
//
// A badge, not a Block — marsa-badge.js's three reasons: the join is keyed by
// fdrId, no Block target kind could hold it, and a read-only Block would be
// invisible to the reachability test.
//
// SOURCE CAVEAT (EFSPImplementationGuide.md §9.9): the ATO these values come
// from was read by a layout taken from a DCS community wiki, not MIL-STD-6040.

let _arHighlightStripIds = new Set();

function _atoFdr(fdrId) { return typeof getEfspFdr === 'function' ? getEfspFdr(fdrId) : null; }

function _liveStripIdsOfFdr(fdrId) {
  const all = typeof getAllEfspStrips === 'function' ? getAllEfspStrips() : [];
  return all.filter(s => s.fdrId === fdrId && s.state !== 'DROPPED').map(s => s.stripId);
}

function _atoHhmm(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

function _arLinksOf(fdr) {
  const ar = fdr && fdr.military && fdr.military.arInfo;
  return ar && Array.isArray(ar.links) ? ar.links : [];
}

function _arTacan(fdr) {
  const ar = fdr && fdr.military && fdr.military.arInfo;
  if (!ar) return null;
  if (ar.asTanker && ar.asTanker.tacan) return ar.asTanker.tacan;
  const rx = (ar.asReceiver || []).find(r => r.tacan);
  return rx ? rx.tacan : null;
}

/**
 * The AR join for a Strip, or null. Only peers that still have a live Strip
 * somewhere are in the group: a dropped receiver leaves it, and a tanker that
 * is cancelled leaves its receivers with no group at all. The flight's own
 * record is never edited for that.
 * @returns {{role:'TANKER'|'RECEIVER', peers:{fdrId,callsign,stripIds}[], text:string, title:string}|null}
 */
function arJoinFor(strip) {
  const fdr = strip ? _atoFdr(strip.fdrId) : null;
  const links = _arLinksOf(fdr);
  if (links.length === 0) return null;
  const role = links[0].role;
  const peers = [];
  const lines = [];
  for (const l of links) {
    if (!l.peerFdrId) continue;
    const stripIds = _liveStripIdsOfFdr(l.peerFdrId);
    if (stripIds.length === 0) continue;
    const pf = _atoFdr(l.peerFdrId);
    const callsign = (pf && pf.identity && pf.identity.callsign) || l.peerCallsign || l.peerFdrId;
    peers.push({ fdrId: l.peerFdrId, callsign, stripIds });
    const tacan = _arTacan(role === 'TANKER' ? fdr : pf) || _arTacan(fdr);
    for (const w of (l.windows && l.windows.length ? l.windows : [{}])) {
      lines.push([
        `${role === 'TANKER' ? 'Receiver' : 'Tanker'} ${callsign}`,
        w.arctUtc != null ? `ARCT ${_atoHhmm(w.arctUtc)}${w.endArUtc != null ? `–${_atoHhmm(w.endArUtc)}` : ''}` : null,
        w.offloadKlb != null ? `${w.offloadKlb} klb` : null,
        l.arcp ? `ARCP ${l.arcp}` : null,
        tacan ? `TACAN ${tacan}` : null,
      ].filter(Boolean).join(' · '));
    }
  }
  if (peers.length === 0) return null;
  const text = role === 'TANKER' ? `AR ×${peers.length}` : `AR ${peers.map(p => p.callsign).join('/')}`;
  return { role, peers, text, title: `Air refuelling (from the ATO)\n${lines.join('\n')}` };
}

function isArHighlighted(stripId) { return _arHighlightStripIds.has(stripId); }
function getArHighlightStripIds() { return [..._arHighlightStripIds]; }

/**
 * Selecting any participant highlights the others. Called from bay-view.js's
 * _afterSelectionChanged beside MARSA's; null clears it.
 * @returns {boolean} whether the set changed
 */
function highlightArParticipants(stripId) {
  const strip = stripId && typeof getEfspStrip === 'function' ? getEfspStrip(stripId) : null;
  const join = strip ? arJoinFor(strip) : null;
  const next = new Set(join ? join.peers.flatMap(p => p.stripIds) : []);
  if (next.size === _arHighlightStripIds.size && [...next].every(id => _arHighlightStripIds.has(id))) return false;
  _arHighlightStripIds = next;
  return true;
}

/**
 * What bay-view.js's render signature needs to know about the join: it is
 * resolved from OTHER flights' Strips (a peer dropped, a peer filed), which no
 * part of this Strip's own record changes, plus whether it is highlighted.
 */
function arSignatureFor(strip) {
  const join = arJoinFor(strip);
  const peers = join ? join.peers.map(p => `${p.fdrId}:${p.stripIds.join(',')}`).join(';') : '';
  return `${join ? join.text : ''}|${peers}|${isArHighlighted(strip.stripId) ? 1 : 0}`;
}

/** Re-resolves the highlight against the current records — after a snapshot. */
function refreshArHighlight() {
  if (typeof getSelectedEfspStripId !== 'function') return false;
  return highlightArParticipants(getSelectedEfspStripId());
}

/**
 * §3.10.3 rule 3 — the ATO's code against the one ATC assigned, as a
 * strip-view.js alert ({ key, tone, text, reason }). Empty when they agree or
 * the flight has no ATO.
 */
function atoAlertsFor(strip) {
  const fdr = strip ? _atoFdr(strip.fdrId) : null;
  const atoCode = fdr && fdr.ato && fdr.ato.iff ? fdr.ato.iff.modeThree : null;
  if (!atoCode) return [];
  const atc = fdr.identity ? fdr.identity.beaconAssigned : null;
  if (atoCode === atc) return [];
  return [{
    key: 'ato', tone: 'attn', legacy: 'efsp-ato-mode3-conflict',
    text: `M3 ATO ${atoCode}`,
    reason: `ATO tasks Mode 3 ${atoCode}; ATC assigned ${atc || 'none'}. The ATC code stands unless coordinated.`,
  }];
}

/** The read-only ▼ rows, as [label, value] pairs — [] for a flight no ATO tasked. */
function atoExpandedRowsFor(strip) {
  const fdr = strip ? _atoFdr(strip.fdrId) : null;
  if (!fdr || !fdr.ato) return [];
  const a = fdr.ato;
  const id = fdr.identity || {};
  const mil = fdr.military || {};
  const dl = a.datalink || {};
  const ctl = a.control || {};
  const freq = (f) => (f && f.freqMhz != null ? Number(f.freqMhz).toFixed(3) : f && f.designator ? f.designator : null);
  const rows = [
    ['Mode 1', id.modeOne || '—'],
    ['Mode 2', id.modeTwo || '—'],
    ['ATO Mode 3', (a.iff && a.iff.modeThree) || '—'],
    ['Datalink', [dl.l16Callsign, dl.ju ? `JU ${dl.ju}` : null, dl.tacan ? `TACAN ${dl.tacan}` : null].filter(Boolean).join(' · ') || '—'],
    ['SCL', mil.scl ? [mil.scl.primary, mil.scl.secondary].filter(Boolean).join(' / ') : '—'],
    ['Mission type', a.missionType ? [a.missionType.primary, a.missionType.secondary].filter(Boolean).join(' / ') : '—'],
    ['Agency', [ctl.type, ctl.callsign, freq(ctl.primary), freq(ctl.secondary), (ctl.reportInPoint || a.reportInPoint) ? `RIP ${ctl.reportInPoint || a.reportInPoint}` : null].filter(Boolean).join(' · ') || '—'],
    ['On station', a.onStationUtc != null ? _atoHhmm(a.onStationUtc) : '—'],
  ];
  const join = arJoinFor(strip);
  if (join) rows.push(['AR', join.title.split('\n').slice(1).join('; ')]);
  if (Array.isArray(a.missingAcceptanceFields) && a.missingAcceptanceFields.length) rows.push(['ATO missing', a.missingAcceptanceFields.join(', ')]);
  const ref = a.atoRef || {};
  const msg = ref.msgId ? [ref.msgId.originator, ref.msgId.serial].filter(Boolean).join(' ') : '';
  rows.push(['ATO', [msg, a.lineId].filter(Boolean).join(' · ') || '—']);
  return rows;
}

/** Appends the ▼ rows to an expanded Strip's panel. Plain text, no editor. */
function appendAtoExpandedRows(panel, strip) {
  for (const [label, value] of atoExpandedRowsFor(strip)) {
    const row = document.createElement('div');
    row.className = 'efsp-expanded-row efsp-ato-row';
    row.dataset.atoRow = label;
    const l = document.createElement('span');
    l.className = 'efsp-expanded-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'efsp-expanded-value efsp-ato-readonly';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    panel.appendChild(row);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    arJoinFor, arSignatureFor, highlightArParticipants, refreshArHighlight, isArHighlighted, getArHighlightStripIds,
    atoAlertsFor, atoExpandedRowsFor, appendAtoExpandedRows,
  };
}
