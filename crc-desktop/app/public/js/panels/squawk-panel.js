'use strict';

// ── Squawk → callsign mapping panel ("Calls" tab). Split out of the former
// ui.js "god file" — see panels/topbar.js for why this stays a plain script
// rather than an IIFE.

function renderSquawkMapList(listEl, inp, inpN, seqToggle) {
  listEl.innerHTML = '';

  const exact = settings.squawkMap || {};
  const seq   = settings.squawkSeq || {};
  const allKeys  = Object.keys(exact).sort((a, b) => Number(a) - Number(b));
  const seqKeys  = Object.keys(seq).sort((a, b) => Number(a) - Number(b));

  if (allKeys.length === 0 && seqKeys.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'sqmap-empty';
    empty.textContent = 'No mappings defined.';
    listEl.appendChild(empty);
    return;
  }

  const makeRow = (code, displayName, isSeq) => {
    const row = document.createElement('div');
    row.className = 'sqmap-row';
    row.innerHTML =
      `<span class="sqmap-code">${code}</span>` +
      `<span class="sqmap-arrow">${isSeq ? '⇒' : '→'}</span>` +
      `<span class="sqmap-name">${displayName}${isSeq ? '<span class="sqmap-seq-badge"> SEQ</span>' : ''}</span>` +
      `<button class="sqmap-edit" data-code="${code}" data-seq="${isSeq}">✎</button>` +
      `<button class="sqmap-del"  data-code="${code}" data-seq="${isSeq}">×</button>`;

    row.querySelector('.sqmap-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSeq) delete settings.squawkSeq[code];
      else       delete settings.squawkMap[code];
      saveSettings();
      sendToSync({ type: 'squawkMapDelete', kind: isSeq ? 'seq' : 'exact', code });
      renderSquawkMapList(listEl, inp, inpN, seqToggle);
      updateMap();
    });

    row.querySelector('.sqmap-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      if (inp && inpN) {
        inp.value  = code;
        inpN.value = isSeq ? seq[code] : exact[code];
        if (seqToggle) seqToggle.checked = isSeq;
        inp.focus();
      }
      if (isSeq) delete settings.squawkSeq[code];
      else       delete settings.squawkMap[code];
      saveSettings();
      sendToSync({ type: 'squawkMapDelete', kind: isSeq ? 'seq' : 'exact', code });
      renderSquawkMapList(listEl, inp, inpN, seqToggle);
      updateMap();
    });

    return row;
  };

  for (const code of allKeys) listEl.appendChild(makeRow(code, exact[code], false));
  for (const code of seqKeys)  listEl.appendChild(makeRow(code, seq[code],  true));
}

// Re-renders the Calls panel's mapping list from current `settings` state —
// called from app.js when a 'squawk-map' broadcast arrives from crc-sync
// (someone, possibly this client, changed a mapping) so every connected
// controller's list stays live, not just the one who made the edit. Always
// re-renders regardless of whether the tab is currently active: dockview
// keeps hidden tab content live in the DOM, and the list is cheap enough
// that gating on visibility (as the old fixed-panel code did) isn't worth
// the complexity of asking dockview whether this tab happens to be active.
function refreshCallsPanel() {
  renderSquawkMapList(
    document.getElementById('sqmap-list'),
    document.getElementById('sqmap-code-input'),
    document.getElementById('sqmap-name-input'),
    document.getElementById('sqmap-seq-toggle'),
  );
}

// Returns { onShow } for dock.js's mountExistingPanel to call whenever this
// panel's tab becomes active, so the list reflects any edits made while it
// was in the background — same refresh-on-open behavior the old toggle-open
// handler used to trigger.
function initCallsPanel() {
  const list     = document.getElementById('sqmap-list');
  const inp      = document.getElementById('sqmap-code-input');
  const inpN     = document.getElementById('sqmap-name-input');
  const addBtn   = document.getElementById('sqmap-add');
  const seqToggle = document.getElementById('sqmap-seq-toggle');

  addBtn.addEventListener('click', () => {
    const raw  = inp.value.trim().replace(/\D/g, '');
    const code = String(Number(raw)); // normalise: "7700" → "7700", "07700" → "7700"
    const name = inpN.value.trim().toUpperCase();
    if (!code || code === 'NaN' || !name) return;

    const kind = (seqToggle && seqToggle.checked) ? 'seq' : 'exact';
    if (kind === 'seq') {
      if (!settings.squawkSeq) settings.squawkSeq = {};
      settings.squawkSeq[code] = name;
    } else {
      if (!settings.squawkMap) settings.squawkMap = {};
      settings.squawkMap[code] = name;
    }
    saveSettings();
    sendToSync({ type: 'squawkMapSet', kind, code, name });
    inp.value  = '';
    inpN.value = '';
    renderSquawkMapList(list, inp, inpN, seqToggle);
    updateMap();
  });

  // Allow Enter key in inputs to trigger add
  [inp, inpN].forEach(el => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  }));

  return { onShow: () => renderSquawkMapList(list, inp, inpN, seqToggle) };
}
