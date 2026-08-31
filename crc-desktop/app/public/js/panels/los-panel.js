'use strict';

// ── LOS terrain profile chart ─────────────────────────────────────────────
// Shown while hovering a radar row in the Panels control: a terrain-vs-
// distance chart along that radar's current (live) beam bearing, with the
// curvature-adjusted sight line and the point where terrain first blocks it.
// Split out of the former ui.js "god file" — see panels/topbar.js for why
// this stays a plain script rather than an IIFE.

let losProfileRadarId = null;
let losProfileTimer   = null;

function currentBeamBearing(radar) {
  const now = Date.now();
  if (!radarSweepStart.has(radar.id)) return radar.heading || 0;
  if (radar.angleFromNose === 360) {
    return ((now - radarSweepStart.get(radar.id)) % radar.sweepMs) / radar.sweepMs * 360;
  }
  const halfAngle = radar.angleFromNose / 2;
  const cycleMs   = radar.sweepMs * 2;
  const phase     = ((now - radarSweepStart.get(radar.id)) % cycleMs) / cycleMs;
  const tNorm     = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return (radar.heading - halfAngle + tNorm * radar.angleFromNose + 360) % 360;
}

// `triggerEl` is the hovered row — the radar panel is a dockable panel now
// (can be anywhere on screen), so position next to whatever's actually
// being hovered instead of a fixed offset from the panel's old hardcoded
// left-edge location.
function showLosProfile(radar, triggerEl) {
  if (!settings.radarDebug) return;
  const $panel = document.getElementById('los-profile-panel');
  const $label = document.getElementById('los-profile-radar-label');
  if (!$panel) return;
  losProfileRadarId = radar.id;
  if ($label) $label.textContent = radar.label;
  if (triggerEl) {
    const rowRect   = triggerEl.getBoundingClientRect();
    const panelRect = triggerEl.closest('#radars-panel')?.getBoundingClientRect();
    $panel.style.top  = Math.max(32, rowRect.top) + 'px';
    $panel.style.left = (panelRect ? panelRect.right : rowRect.right) + 8 + 'px';
  }
  $panel.classList.add('open');
  drawLosProfile();
  clearInterval(losProfileTimer);
  losProfileTimer = setInterval(drawLosProfile, 200);
}

function hideLosProfile() {
  losProfileRadarId = null;
  clearInterval(losProfileTimer);
  losProfileTimer = null;
  const $panel = document.getElementById('los-profile-panel');
  if ($panel) $panel.classList.remove('open');
}

function drawLosProfile() {
  const $canvas = document.getElementById('los-profile-canvas');
  if (!$canvas || !losProfileRadarId) return;
  const radar = getAllRadars().find(r => r.id === losProfileRadarId);
  if (!radar) { hideLosProfile(); return; }

  const bearing = currentBeamBearing(radar);
  const { points, blockedAtM } = losBeamProfile(radar, bearing, radar.rangeM);

  const ctx = $canvas.getContext('2d');
  const W = $canvas.width, H = $canvas.height;
  ctx.clearRect(0, 0, W, H);

  const known = points.filter(p => p.terrainM != null);
  if (known.length < 2) {
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.fillText('Loading terrain data…', 8, H / 2);
    return;
  }

  let minH = radar.elevM, maxH = radar.elevM;
  for (const p of points) {
    if (p.terrainM != null) { minH = Math.min(minH, p.terrainM); maxH = Math.max(maxH, p.terrainM); }
    minH = Math.min(minH, p.sightM);
    maxH = Math.max(maxH, p.sightM);
  }
  const pad = (maxH - minH) * 0.1 || 10;
  minH -= pad; maxH += pad;

  const xOf = d => (d / radar.rangeM) * W;
  const yOf = h => H - ((h - minH) / (maxH - minH)) * H;

  // Terrain fill (gaps where a tile is still loading are simply skipped)
  ctx.beginPath();
  let started = false;
  let lastX = 0;
  for (const p of points) {
    if (p.terrainM == null) continue;
    const x = xOf(p.d), y = yOf(p.terrainM);
    if (!started) { ctx.moveTo(x, H); ctx.lineTo(x, y); started = true; }
    else ctx.lineTo(x, y);
    lastX = x;
  }
  if (started) {
    ctx.lineTo(lastX, H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(138, 106, 58, 0.45)';
    ctx.fill();
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Reference sight line
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xOf(p.d), y = yOf(p.sightM);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#33aa55';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Blocked-at marker
  if (blockedAtM < radar.rangeM - 1) {
    const x = xOf(blockedAtM);
    ctx.strokeStyle = '#cc4444';
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Radar antenna marker
  ctx.fillStyle = '#4488cc';
  ctx.beginPath();
  ctx.arc(xOf(0), yOf(radar.elevM), 3, 0, Math.PI * 2);
  ctx.fill();
}
