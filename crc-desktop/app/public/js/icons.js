'use strict';
import { COALITION_COLOR, GROUND_COLOR, LIGHT_COALITION_COLOR, map, mapReady, settings } from './app.js';

// ── Track icon factories ───────────────────────────────────────────────────
// Each function renders to a canvas and returns raw ImageData for MapLibre.

// Hollow diamond (rotated square) — airborne aircraft
function createSquareIcon(color, size = 14) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const m   = 3;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.lineJoin    = 'miter';
  const half = (size - m * 2) / 2;
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.rect(-half, -half, half * 2, half * 2);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

// Top-down aircraft silhouette — on-ground aircraft (MapLibre rotates it)
function createAircraftIcon(color, size = 20) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx  = size / 2, cy = size / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.lineCap     = 'round';
  // Fuselage
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.44);
  ctx.lineTo(cx, cy + size * 0.34);
  ctx.stroke();
  // Wings
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.40, cy - size * 0.04);
  ctx.lineTo(cx + size * 0.40, cy - size * 0.04);
  ctx.stroke();
  // Tail fins
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.20, cy + size * 0.28);
  ctx.lineTo(cx + size * 0.20, cy + size * 0.28);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

// Hollow circle with centre dot — surface vessels / ships
function createShipIcon(color, size = 13) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx  = size / 2, cy = size / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.3;
  ctx.beginPath();
  ctx.arc(cx, cy, (size / 2) - 1.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

// Small axis-aligned filled square — ground vehicles
function createGroundIcon(color, size = 10) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const m   = 2;
  ctx.fillStyle = color;
  ctx.fillRect(m, m, size - m * 2, size - m * 2);
  return ctx.getImageData(0, 0, size, size);
}

// Blinking emergency square — drawn over the track icon position.
// Larger than track symbols so it's clearly visible as an overlay ring.
function createEmergencySquare(color, size = 22) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx     = canvas.getContext('2d');
  const m = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5;
  ctx.strokeRect(m, m, size - m * 2, size - m * 2);
  return ctx.getImageData(0, 0, size, size);
}

// Bullseye: dot inside two concentric circles
function createBullseyeIcon(color, size = 26) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx  = size / 2, cy = size / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

// Filled upward-pointing triangle — BANDIT / HOSTILE tracks
function createTriangleIcon(color, size = 14) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const m   = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size / 2, m);
  ctx.lineTo(size - m, size - m);
  ctx.lineTo(m,        size - m);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

// Small hollow upward-pointing triangle — nav/waypoints
export function createNavpointIcon(color, size = 11) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const m   = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.lineJoin    = 'miter';
  ctx.beginPath();
  ctx.moveTo(size / 2, m);           // apex
  ctx.lineTo(size - m, size - m);    // bottom-right
  ctx.lineTo(m,        size - m);    // bottom-left
  ctx.closePath();
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

export function initIcons() {
  map.addImage('sq-neutral',   createSquareIcon('#888888'));
  map.addImage('sq-red',       createSquareIcon('#cc4444'));
  map.addImage('sq-blue',      createSquareIcon('#4488cc'));
  map.addImage('ac-neutral',   createAircraftIcon('#888888'));
  map.addImage('ac-red',       createAircraftIcon('#cc4444'));
  map.addImage('ac-blue',      createAircraftIcon('#4488cc'));
  map.addImage('gnd-neutral',  createGroundIcon('#7a7a68'));
  map.addImage('gnd-red',      createGroundIcon('#aa6644'));
  map.addImage('gnd-blue',     createGroundIcon('#557799'));
  map.addImage('ship-neutral', createShipIcon('#7a7a68'));
  map.addImage('ship-red',     createShipIcon('#cc4444'));
  map.addImage('ship-blue',    createShipIcon('#4488cc'));
  map.addImage('be-blue',      createBullseyeIcon('#4488cc'));
  map.addImage('be-red',       createBullseyeIcon('#cc4444'));
  map.addImage('navpt', createNavpointIcon((settings && settings.colNavpoint) || '#3a5a3a'));

  // ── IFF state icons — colours read from settings at init time ────────────
  _registerIffIcons('add');
}

// Registers or updates all IFF + emergency icons using current settings.
// mode: 'add' (first load) | 'update' (after colour change)
function _registerIffIcons(mode) {
  const fn = mode === 'add'
    ? (name, data) => map.addImage(name, data)
    : (name, data) => map.updateImage(name, data);

  const fr = (settings && settings.colFriendly)    || '#4488cc';
  const bo = (settings && settings.colBogey)       || '#ccaa00';
  const ne = (settings && settings.colNeutral)     || '#888888';
  const ba = (settings && settings.colBandit)      || '#cc6600';
  const ho = (settings && settings.colHostile)     || '#cc2222';
  const eg = (settings && settings.colEmergGen)    || '#cc2222';
  const er = (settings && settings.colEmergRadio)  || '#b8a000';
  const eh = (settings && settings.colEmergHijack) || '#cc6600';

  // Triangles — bandit / hostile (all categories)
  fn('tri-iff-bandit',    createTriangleIcon(ba));
  fn('tri-iff-hostile',   createTriangleIcon(ho));
  // Airborne (hollow diamond)
  fn('sq-iff-friendly',   createSquareIcon(fr));
  fn('sq-iff-bogey',      createSquareIcon(bo));
  fn('sq-iff-neutral',    createSquareIcon(ne));
  // On-ground aircraft silhouette
  fn('ac-iff-friendly',   createAircraftIcon(fr));
  fn('ac-iff-bogey',      createAircraftIcon(bo));
  fn('ac-iff-neutral',    createAircraftIcon(ne));
  // Ground vehicles (filled square)
  fn('gnd-iff-friendly',  createGroundIcon(fr));
  fn('gnd-iff-bogey',     createGroundIcon(bo));
  fn('gnd-iff-neutral',   createGroundIcon(ne));
  // Ships (circle)
  fn('ship-iff-friendly', createShipIcon(fr));
  fn('ship-iff-bogey',    createShipIcon(bo));
  fn('ship-iff-neutral',  createShipIcon(ne));
  // Emergency blinking squares
  fn('emerg-gen',    createEmergencySquare(eg));
  fn('emerg-radio',  createEmergencySquare(er));
  fn('emerg-hijack', createEmergencySquare(eh));
}

// Called whenever IFF / emergency colours change.
export function updateIffIcons() {
  if (!mapReady) return;
  _registerIffIcons('update');
}

// Re-colour theme-sensitive icons when switching light / dark mode.
// Icon images in MapLibre have baked-in colors; we must re-register them.
export function updateIcons(lightMode) {
  const ac  = lightMode ? LIGHT_COALITION_COLOR : COALITION_COLOR;
  // Ground color palette in light mode: darker for contrast on the light map
  const gnd = lightMode
    ? { 1: '#505050', 2: '#aa3322', 3: '#334d80' }
    : GROUND_COLOR;

  map.updateImage('sq-neutral',   createSquareIcon(ac[1]));
  map.updateImage('sq-red',       createSquareIcon(ac[2]));
  map.updateImage('sq-blue',      createSquareIcon(ac[3]));
  map.updateImage('ac-neutral',   createAircraftIcon(ac[1]));
  map.updateImage('ac-red',       createAircraftIcon(ac[2]));
  map.updateImage('ac-blue',      createAircraftIcon(ac[3]));
  map.updateImage('gnd-neutral',  createGroundIcon(gnd[1]));
  map.updateImage('gnd-red',      createGroundIcon(gnd[2]));
  map.updateImage('gnd-blue',     createGroundIcon(gnd[3]));
  map.updateImage('ship-neutral', createShipIcon(ac[1]));
  map.updateImage('ship-red',     createShipIcon(ac[2]));
  map.updateImage('ship-blue',    createShipIcon(ac[3]));
}
