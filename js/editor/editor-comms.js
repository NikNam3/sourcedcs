// ═══════════════════════════════════════════════════════════
// editor-comms.js — COMMS editor
//
// Handles editing of the COMMS section.
// Supports both per-flight comms (comms.flights[]) and the
// legacy flat format (comms.uhf_presets / comms.vhf_presets).
// ═══════════════════════════════════════════════════════════

'use strict';

// ═════════════════════════════════════════════════════════════
// COMMS EDITOR
// ═════════════════════════════════════════════════════════════

function openCommsEditor() {
  var cm = editorEnsureSection('comms');

  openEditorDialog('EDIT COMMS', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fOp   = editorField(body, 'Operation',      cm.operation);
    var fLead = editorField(body, 'Wing Lead',       cm.wing_lead);
    var fCls  = editorField(body, 'Classification',  cm.classification);

    body._commsHeader = { op: fOp, lead: fLead, cls: fCls };

    // Per-flight comms (new format)
    if (Array.isArray(cm.flights) && cm.flights.length > 0) {
      editorSectionTitle(body, 'FLIGHT PRESETS (per DTC cartridge)');
      body._commsFlights = cm.flights.map(function (flt) { return Object.assign({}, flt); });
      var listEl = el('div', 'ef-list-items');
      body._commsFlightListEl = listEl;
      _renderCommsFlightList(listEl, body._commsFlights);
      body.appendChild(listEl);
    } else {
      // Legacy flat format
      editorSectionTitle(body, 'UHF PRESETS');
      body._uhfFields = _buildPresetFields(body, cm.uhf_presets || {});
      editorSectionTitle(body, 'VHF PRESETS');
      body._vhfFields = _buildPresetFields(body, cm.vhf_presets || {});
    }

  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._commsHeader;
    var cm = editorEnsureSection('comms');
    cm.operation      = h.op.value || undefined;
    cm.wing_lead      = h.lead.value || undefined;
    cm.classification = h.cls.value || undefined;

    if (body._commsFlights) {
      cm.flights = body._commsFlights;
    } else {
      cm.uhf_presets = _collectPresets(body._uhfFields);
      cm.vhf_presets = _collectPresets(body._vhfFields);
    }
    editorReRender('comms');
  });
}

function _renderCommsFlightList(container, flights) {
  container.innerHTML = '';
  flights.forEach(function (flt, i) {
    var label = (flt.callsign || flt.group || 'Flight ' + (i + 1));
    if (flt.dtc_cartridge) label += ' [' + flt.dtc_cartridge + ']';
    editorItemRow(container, label,
      function () { _editCommsFlight(flights, i); },
      null  // no delete — per-flight comms are auto-derived
    );
  });
}

function _editCommsFlight(flights, index) {
  var flt = flights[index];

  openEditorDialog('EDIT FLIGHT COMMS — ' + (flt.callsign || flt.group || ''), function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO COMMS');
    backBtn.addEventListener('click', function () {
      editorEnsureSection('comms').flights = flights;
      openCommsEditor();
    });
    body.appendChild(backBtn);

    var READONLY = { disabled: true };
    editorField(body, 'Group',         flt.group,         READONLY);
    editorField(body, 'Callsign',      flt.callsign,      READONLY);
    editorField(body, 'DTC Cartridge', flt.dtc_cartridge, READONLY);

    var hint = el('div', 'ef-hint', 'Channel assignments — enter freq (MHz). Callsign & role are set in Registry → Frequencies.');
    body.appendChild(hint);

    editorSectionTitle(body, 'UHF PRESETS');
    body._fltUhfFields = _buildPresetFields(body, flt.uhf_presets || {});
    editorSectionTitle(body, 'VHF PRESETS');
    body._fltVhfFields = _buildPresetFields(body, flt.vhf_presets || {});

    body._editFltFlights = flights;
    body._editFltIndex   = index;
  }, function () {
    var body  = document.getElementById('editorBody');
    var flt   = body._editFltFlights[body._editFltIndex];
    flt.uhf_presets = _collectPresets(body._fltUhfFields);
    flt.vhf_presets = _collectPresets(body._fltVhfFields);
    editorEnsureSection('comms').flights = body._editFltFlights;
    editorReRender('comms');
  });
}

function _buildPresetFields(parent, presets) {
  var fields = [];
  for (var ch = 1; ch <= 20; ch++) {
    var val = presets[ch];
    var freqVal = '';
    if (val !== undefined && val !== null) {
      if (typeof val === 'object' && val.freq_mhz != null) {
        freqVal = String(val.freq_mhz);
      } else {
        freqVal = String(val);
      }
    }

    var row = el('div', 'ef-preset-row');
    row.appendChild(el('span', 'ef-preset-ch', 'CH ' + String(ch).padStart(2, '0')));

    var fFreq = el('input', 'ef-input ef-input-sm');
    fFreq.placeholder = 'MHz';
    fFreq.value = freqVal;

    row.appendChild(fFreq);
    parent.appendChild(row);

    fields.push({ ch: ch, freq: fFreq });
  }
  return fields;
}

function _collectPresets(fields) {
  var presets = {};
  fields.forEach(function (f) {
    if (f.freq.value) {
      var freq = parseFloat(f.freq.value);
      if (!isNaN(freq)) presets[f.ch] = freq;
    }
  });
  return presets;
}
