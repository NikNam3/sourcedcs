'use strict';
// The altitude an Alt+wheel is showing but has not sent yet (docs/adr/0164). A leaf: alt-wheel.js writes it, the two
// data blocks read it (geojson.js's tactical ASGN line, atc-scope.js's ATC line 3 through withAltPreview). One preview at
// a time, for one contact.

let _preview = null; // { trackId, lowFt, highFt, prefix }

export function setAltPreview(trackId, alt) {
  _preview = { trackId: String(trackId), lowFt: alt.lowFt, highFt: alt.highFt, prefix: alt.prefix || '' };
}

export function clearAltPreview() { _preview = null; }

/** The preview on this contact, or null. */
export function altPreviewFor(trackId) {
  return _preview && _preview.trackId === String(trackId) ? _preview : null;
}

/** The track's id the preview is on, or null. */
export function altPreviewTrackId() { return _preview ? _preview.trackId : null; }

/**
 * atc-scope.js's `atcAssigned` shape with the preview in place of the assigned altitude, marked `altPreview`; the
 * assigned value untouched when this contact has no preview.
 * @param {{altFt:number|null, altBlock:object|null, hdg:number|null}|null} assigned
 */
export function withAltPreview(trackId, assigned) {
  const p = altPreviewFor(trackId);
  if (!p) return assigned;
  const block = p.lowFt < p.highFt;
  return {
    ...(assigned || { hdg: null }),
    altFt: block ? null : p.lowFt,
    altBlock: block ? { lowFt: p.lowFt, highFt: p.highFt } : null,
    altPreview: true,
  };
}
