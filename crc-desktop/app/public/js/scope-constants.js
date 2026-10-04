'use strict';
import { NM_M } from './geo.js';
import { settings } from './settings.js';

// The scope's fixed colours, timings and label geometry, and the label-scale helpers. A leaf (DESK-GRAPH): moved out of
// `app.js` so geojson.js, map-setup.js, icons.js and the panels read them without importing the boot module.

export const COALITION_COLOR       = { 1: '#888888', 2: '#cc4444', 3: '#4488cc' };
export const LIGHT_COALITION_COLOR = { 1: '#505050', 2: '#cc0000', 3: '#004499' }; // higher contrast on light map
export const GROUND_COLOR          = { 1: '#7a7a68', 2: '#aa6644', 3: '#557799' };
export const HISTORY_MAX      = 10;
export const FADE_DURATION_MS = 10000;
export const STALE_MS         = 10000;
export const MIN_SPD_KT_PPL   = 30;

const CRC_RANGE_NM     = 200;
export const CRC_RANGE_M      = CRC_RANGE_NM * NM_M;

// Default label position and geometry constants (used by geojson.js + map-setup.js)
export const TEXT_SIZE_PX      = 11;
export const TEXT_OFFSET_EM    = [4.0, -0.5]; // em units [right, up] from icon
const LEADER_ICON_GAP   = 7;
const LABEL_HALF_W      = 30;
export const LABEL_EDGE_MARGIN = 2;

// ── Scale helpers ─────────────────────────────────────────────────────────

export function getScale()         { return settings.scale || 1.0; }
export function getTextSizePx()    { return TEXT_SIZE_PX    * getScale(); }
export function getLeaderIconGap() { return LEADER_ICON_GAP * getScale(); }
export function getLabelHalfW()    { return LABEL_HALF_W    * getScale(); }
