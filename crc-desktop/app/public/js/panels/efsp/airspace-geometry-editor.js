'use strict';

// The geometry section of the airspace editor: the AREA outline and the ROUTE leg table (docs/adr/0098 §5).
//
// THIS IS 2P-A's STUB. AIRSP-2P-B owns the real file and replaces it whole, keeping this export and its contract:
//
//   mountGeometryEditor(container, definition, onChange) -> { destroy(), setReadOnly(reason|null) }
//
//   container   the element inside the editor card to draw into
//   definition  the definition being edited (`kind`, and `geometry` for an AREA, `segments`/`defaultWidthNm` for a ROUTE)
//   onChange    called with a patch of the geometry fields that changed, e.g. { geometry: {...} } or { segments, defaultWidthNm }
//
// Until then the section says what is there: a count, and that drawing arrives with the map editor.

export function mountGeometryEditor(container, definition, onChange) { // eslint-disable-line no-unused-vars
  const note = document.createElement('div');
  note.className = 'airspace-geometry-stub';
  const geometry = definition && definition.geometry;
  const segments = definition && definition.segments;
  if (definition && definition.kind === 'ROUTE') {
    note.textContent = `Route: ${Array.isArray(segments) ? segments.length : 0} fixes. The route editor is not built yet.`;
  } else if (geometry && Array.isArray(geometry.points)) {
    note.textContent = `Outline: ${geometry.points.length} points (${geometry.source === 'DCS_DRAWING' ? 'DCS drawing' : 'drawn'}). The outline editor is not built yet.`;
  } else {
    note.textContent = 'Outline: none. The outline editor is not built yet.';
  }
  container.appendChild(note);
  return { destroy() { note.remove(); }, setReadOnly() {} };
}
