// ═══════════════════════════════════════════════════════════
// state.js — wing-admin shared state
//
// Plain globals, same convention as atobrief/public/js/editor/ — every
// other wing-admin/*.js file reads/writes these directly, no bundler.
//
// Public API:
//   _members, _squadrons, _roleLabels, _pilots
//   _search, _filter, _sortKey, _sortDir
// ═══════════════════════════════════════════════════════════

'use strict';

/* setTheme, logout, esc, showToast provided by /js/auth.js */

/* ── State ──────────────────────────────────────────────── */
var _members    = [];
var _squadrons  = [];
var _roleLabels = [];
var _pilots     = [];
var _search     = '';
var _filter     = '';
var _sortKey    = null;
var _sortDir    = 1; /* 1 = ascending, -1 = descending */
