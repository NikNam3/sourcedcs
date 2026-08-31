// ═══════════════════════════════════════════════════════════
// state.js — skills-admin shared state
//
// Loaded first (see skills-admin.html's <script> order) so every other
// skills-admin/*.js file can read/write these plain globals directly —
// no bundler here, just <script src> order + shared window scope, same
// convention atobrief/public/js/editor/ uses (EDITOR in editor-core.js).
//
// Public API:
//   _tree, _treeIndex               — last-saved-from-server document + its index
//   _treeEditor, _treeEditorIndex   — working copy mutated by the GUI editor + its index
//   _outlineExpanded, _outlineSelectedId, _outlineSquadronFilter
//   _pendingImportTarget
//   _allGrades, _pilots, _requests, _squadrons, _pilotSquadrons, _members
//   _activeSub, _gradeOutlineExpanded, _sqGroupCollapsed, _currentUserSub
//   jwtSub(token)
// ═══════════════════════════════════════════════════════════

'use strict';

/* setTheme, getUser, logout, esc, showToast provided by /js/auth.js */

/* ── State ──────────────────────────────────────────────── */
var _tree               = null;   /* last-saved-from-server document { version, tree } */
var _treeIndex          = null;   /* skillsCore.buildIndex(_tree) — used for pilot detail (published data only) */
var _treeEditor          = null;  /* working copy mutated by the GUI editor */
var _treeEditorIndex     = null;  /* skillsCore.buildIndex(_treeEditor), rebuilt after structural mutations */
var _outlineExpanded     = {};    /* { [moduleId]: bool } outline expand state */
var _outlineSelectedId   = null;
var _outlineSquadronFilter = null; /* squadron id, or null = ALL SQUADRONS — session-only, filters the outline + scopes import */
var _pendingImportTarget   = null; /* 'whole' | 'root' | { nodeId } — set right before triggering the shared hidden file input */
var _allGrades          = {};     /* { [sub]: { [gradingItemId]: gradeRec } } */
var _pilots             = {};     /* { [sub]: { sub, name, callsign, registered_at } } */
var _requests            = [];
var _squadrons          = [];     /* squadron list from /api/squadrons */
var _pilotSquadrons     = {};     /* { [sub]: squadronId | null } — server-resolved (auto+override) */
var _members            = [];     /* full Discord roster from /api/members — the squadron-management source of truth */
var _activeSub          = null;
var _gradeOutlineExpanded = {};   /* { [moduleId]: bool } expand state for the grading outline — default: root expanded, deeper collapsed */
var _sqGroupCollapsed   = {};     /* { [squadronId|'__unassigned']: bool } collapse state for pilot list groups */
var _currentUserSub     = null;   /* JWT sub of the logged-in admin */

function jwtSub(token) {
  try {
    var parts   = token.split('.');
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || null;
  } catch (e) { return null; }
}
