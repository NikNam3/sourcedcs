// ═══════════════════════════════════════════════════════════
// loadout.js — Loadout code parser and visual renderer
//
// FORMAT:  AAA+NXccc[L] NXccc[L] ...   (weapon groups separated by NX)
//
//   AAA  = 3-digit air-to-air code (each digit = count)
//          digit 1 → Fox 3 (active radar, e.g. AIM-120)
//          digit 2 → Fox 1 (semi-active radar, e.g. AIM-7)
//          digit 3 → Fox 2 (IR, e.g. AIM-9)
//
//   +    = gun ammo present (omitted if no gun)
//
//   NXccc[L] = one weapon group:
//              N   = quantity (single digit)
//              X   = literal separator
//              ccc = base weapon code (1–3 digits)
//              L   = variant letter, present only for weapon families that
//                    share a base number (AGM-65/88/154).  Absent for
//                    single-variant families (GBU-38 → '38', AGM-158 → '158').
//
// EXAMPLES:
//   301            → 3×Fox3, 0×Fox1, 1×Fox2, no gun
//   501+           → 5×Fox3, 0×Fox1, 1×Fox2, gun
//   301+3X381X114  → 3×Fox3, 0×Fox1, 1×Fox2, gun, 3×GBU-38, 1×AGM-114
//   002+2X88C      → 0×Fox3, 0×Fox1, 2×Fox2, gun, 2×AGM-88C HARM
//   301+3X65D2X65K → 3×Fox3, 0×Fox1, 1×Fox2, gun, 3×AGM-65D, 2×AGM-65K
//
// PARSING RULE for weapon groups (post-+ section):
//   Split on boundaries where a digit is followed by 'X'.
//   "3X65D2X65K" → ["3X65D", "2X65K"]
//   The digit before X is always quantity; remainder is the code (numeric,
//   or numeric + variant letter for multi-variant families).
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Weapon database ──────────────────────────────────────────
// Codes match the numeric portion of designations:
//   missiles: last 2-3 digits of the designation number
//   bombs:    2-3 digit number from GBU/Mk/CBU designation
const WEAPON_DB = {
  // ── Air-to-Air (code used in AA section, not A2G groups) ─
  // Handled separately via the 3-digit air-to-air prefix

  // ── Air-to-Ground Missiles (AGM) ────────────────────────
  '62':   { name: 'AGM-62',   full: 'AGM-62 Walleye',                    cat: 'agm', color: '#c084fc' },
  '65':   { name: 'AGM-65',   full: 'AGM-65 Maverick',                   cat: 'agm', color: '#c084fc' },
  '65D':  { name: 'AGM-65D',  full: 'AGM-65D Maverick (IIR)',             cat: 'agm', color: '#c084fc' },
  '65E':  { name: 'AGM-65E',  full: 'AGM-65E Maverick (Laser/Lg Whd)',    cat: 'agm', color: '#c084fc' },
  '65F':  { name: 'AGM-65F',  full: 'AGM-65F Maverick (IIR Naval)',       cat: 'agm', color: '#c084fc' },
  '65G':  { name: 'AGM-65G',  full: 'AGM-65G Maverick (IIR/Lg Whd)',      cat: 'agm', color: '#c084fc' },
  '65H':  { name: 'AGM-65H',  full: 'AGM-65H Maverick (CCD)',             cat: 'agm', color: '#c084fc' },
  '65K':  { name: 'AGM-65K',  full: 'AGM-65K Maverick (CCD Imp)',         cat: 'agm', color: '#c084fc' },
  '65L':  { name: 'AGM-65L',  full: 'AGM-65L Maverick (CCD Laser)',       cat: 'agm', color: '#c084fc' },
  '65R':  { name: 'AGM-65R',  full: 'AGM-65R Maverick (Imaging IR)',      cat: 'agm', color: '#c084fc' },
  '88':   { name: 'AGM-88',   full: 'AGM-88 HARM (Anti-Radiation)',       cat: 'agm', color: '#ff8c00' },
  '88B':  { name: 'AGM-88B',  full: 'AGM-88B HARM (Anti-Radiation)',      cat: 'agm', color: '#ff8c00' },
  '88C':  { name: 'AGM-88C',  full: 'AGM-88C HARM (Anti-Radiation)',      cat: 'agm', color: '#ff8c00' },
  '114':  { name: 'AGM-114',  full: 'AGM-114 Hellfire',                   cat: 'agm', color: '#c084fc' },
  '122':  { name: 'AGM-122',  full: 'AGM-122 Sidearm (Anti-Radiation)',   cat: 'agm', color: '#ff8c00' },
  '130':  { name: 'AGM-130',  full: 'AGM-130 (Powered Bomb)',             cat: 'agm', color: '#c084fc' },
  '141':  { name: 'ADM-141',  full: 'ADM-141 TALD (Decoy)',               cat: 'agm', color: '#7a7875' },
  '154':  { name: 'AGM-154',  full: 'AGM-154 JSOW',                      cat: 'agm', color: '#c084fc' },
  '154A': { name: 'AGM-154A', full: 'AGM-154A JSOW (Unitary)',            cat: 'agm', color: '#c084fc' },
  '154C': { name: 'AGM-154C', full: 'AGM-154C JSOW (Penetrator)',         cat: 'agm', color: '#c084fc' },
  '158':  { name: 'AGM-158',  full: 'AGM-158 JASSM',                     cat: 'agm', color: '#c084fc' },
  '179':  { name: 'AGM-179',  full: 'AGM-179 JAGM (Joint Air-Ground)',    cat: 'agm', color: '#c084fc' },

  // ── Guided Bombs (GBU) ───────────────────────────────────
  '10':  { name: 'GBU-10',  full: 'GBU-10 Paveway II (2000lb LGB)', cat: 'gbu', color: '#4fc3f7' },
  '12':  { name: 'GBU-12',  full: 'GBU-12 Paveway II (500lb LGB)',  cat: 'gbu', color: '#4fc3f7' },
  '16':  { name: 'GBU-16',  full: 'GBU-16 Paveway II (1000lb LGB)', cat: 'gbu', color: '#4fc3f7' },
  '24':  { name: 'GBU-24',  full: 'GBU-24 Paveway III (2000lb)',    cat: 'gbu', color: '#4fc3f7' },
  '27':  { name: 'GBU-27',  full: 'GBU-27 Paveway III (Bunker)',    cat: 'gbu', color: '#4fc3f7' },
  '28':  { name: 'GBU-28',  full: 'GBU-28 Bunker Buster (5000lb)',  cat: 'gbu', color: '#1a3a6b' },
  '31':  { name: 'GBU-31',  full: 'GBU-31 JDAM (2000lb GPS)',       cat: 'gbu', color: '#39a0ff' },
  '32':  { name: 'GBU-32',  full: 'GBU-32 JDAM (1000lb GPS)',       cat: 'gbu', color: '#39a0ff' },
  '38':  { name: 'GBU-38',  full: 'GBU-38 JDAM (500lb GPS)',        cat: 'gbu', color: '#39a0ff' },
  '39':  { name: 'GBU-39',  full: 'GBU-39 SDB (250lb Small Diam.)', cat: 'gbu', color: '#39a0ff' },
  '54':  { name: 'GBU-54',  full: 'GBU-54 Laser JDAM (500lb)',      cat: 'gbu', color: '#39a0ff' },

  // ── Cluster Bombs (CBU) ──────────────────────────────────
  '87':  { name: 'CBU-87',  full: 'CBU-87 CEM Cluster Bomb',        cat: 'cbu', color: '#ff4444' },
  '97':  { name: 'CBU-97',  full: 'CBU-97 SFW Cluster Bomb',        cat: 'cbu', color: '#ff4444' },
  '99':  { name: 'CBU-99',  full: 'CBU-99 Rockeye (Anti-Armor)',     cat: 'cbu', color: '#ff4444' },
  '103': { name: 'CBU-103', full: 'CBU-103 WCMD CEM Cluster',        cat: 'cbu', color: '#ff4444' },
  '105': { name: 'CBU-105', full: 'CBU-105 WCMD SFW Cluster',        cat: 'cbu', color: '#ff4444' },

  // ── Unguided Bombs (Mk) ──────────────────────────────────
  '82':  { name: 'Mk 82',   full: 'Mk 82 (500lb Dumb Bomb)',        cat: 'mk',  color: '#7a7875' },
  '83':  { name: 'Mk 83',   full: 'Mk 83 (1000lb Dumb Bomb)',       cat: 'mk',  color: '#7a7875' },
  '84':  { name: 'Mk 84',   full: 'Mk 84 (2000lb Dumb Bomb)',       cat: 'mk',  color: '#7a7875' },
  '20':  { name: 'Mk 20',   full: 'Mk 20 Rockeye (Cluster)',        cat: 'mk',  color: '#7a7875' },

  // ── Rockets (LAU pods) ───────────────────────────────────
  '3':   { name: 'LAU-3',   full: 'LAU-3 (19× Hydra 70mm)',        cat: 'rkt', color: '#ffb020' },
  '61':  { name: 'LAU-61',  full: 'LAU-61 (19× Hydra 70mm)',        cat: 'rkt', color: '#ffb020' },
  '68':  { name: 'LAU-68',  full: 'LAU-68 (7× Hydra 70mm)',         cat: 'rkt', color: '#ffb020' },
  '131': { name: 'LAU-131', full: 'LAU-131 (7× Hydra 70mm)',        cat: 'rkt', color: '#ffb020' },
};

// MFD theme overrides (slightly brighter already in DB since MFD is dark)
const WEAPON_COLORS_PRO = {
  'agm': '#4a1a6b',  // purple
  'gbu': '#1a3a6b',  // navy
  'cbu': '#9b1c1c',  // dark red
  'mk':  '#4a4845',  // gray
  'rkt': '#7c5000',  // amber
};
const WEAPON_COLORS_MFD = {
  'agm': '#c084fc',
  'gbu': '#4fc3f7',
  'cbu': '#ff4444',
  'mk':  '#7a7875',
  'rkt': '#ffb020',
};

function weaponColor(cat) {
  return (STATE.theme === 'movie' ? WEAPON_COLORS_MFD : WEAPON_COLORS_PRO)[cat] || '#7a7875';
}

// ── Air-to-air reference ─────────────────────────────────────
const AA_SLOTS = [
  { fox: 3, name: 'Fox 3', full: 'AIM-120 AMRAAM (Active Radar)',    cat: 'fox3' },
  { fox: 1, name: 'Fox 1', full: 'AIM-7 Sparrow (Semi-Active Radar)', cat: 'fox1' },
  { fox: 2, name: 'Fox 2', full: 'AIM-9 Sidewinder (IR)',            cat: 'fox2' },
];
const FOX_COLORS_PRO = { fox3: '#003d6b', fox1: '#4a1a6b', fox2: '#1a5c2e' };
const FOX_COLORS_MFD = { fox3: '#4fc3f7', fox1: '#c084fc', fox2: '#39ff7a' };
function foxColor(cat) {
  return (STATE.theme === 'movie' ? FOX_COLORS_MFD : FOX_COLORS_PRO)[cat];
}

// ── Parser ───────────────────────────────────────────────────
/**
 * parseLoadout('301+3X381X114') → {
 *   aa: [{fox:3, name:'Fox 3', count:3}, {fox:1, name:'Fox 1', count:0}, {fox:2, name:'Fox 2', count:1}],
 *   gun: true,
 *   weapons: [{qty:3, code:'38', info:{...}}, {qty:1, code:'114', info:{...}}],
 *   raw: '301+3X381X114'
 * }
 */
function parseLoadout(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  const plusIdx = str.indexOf('+');
  const hasGun  = plusIdx !== -1;

  // Air-to-air prefix: always 3 digits; AG part follows '+' or starts at position 3
  const aaStr = hasGun ? str.slice(0, plusIdx) : str.slice(0, 3);
  const agStr = hasGun ? str.slice(plusIdx + 1) : str.slice(3);

  // Parse AA: each character is a count
  const aa = AA_SLOTS.map((slot, i) => ({
    ...slot,
    count: parseInt(aaStr[i] || '0', 10) || 0,
  }));

  // Parse weapon groups from agStr
  // Strategy: find all positions where digit is followed by 'X'
  // Split into tokens: everything between those boundaries
  const weapons = [];
  if (agStr.length > 0) {
    // Find split points: index of each digit that precedes 'X'
    // Pattern: a digit at position i where str[i+1] === 'X'
    const splitPoints = [];
    for (let i = 0; i < agStr.length - 1; i++) {
      if (/\d/.test(agStr[i]) && agStr[i + 1] === 'X') {
        splitPoints.push(i);
      }
    }

    splitPoints.forEach((start, idx) => {
      const end = idx + 1 < splitPoints.length ? splitPoints[idx + 1] : agStr.length;
      const token = agStr.slice(start, end); // e.g. "3X38" or "1X114"
      const xPos  = token.indexOf('X');
      if (xPos < 0) return;

      const qty  = parseInt(token.slice(0, xPos), 10);
      const code = token.slice(xPos + 1);           // "38" or "114"

      weapons.push({
        qty,
        code,
        info: WEAPON_DB[code] || { name: code, full: `Unknown (code ${code})`, cat: 'unknown', color: '#7a7875' },
      });
    });
  }

  return { aa, gun: hasGun, weapons, raw: str };
}

// ── Detail panel widget (expanded, with full names) ──────────
/**
 * Returns a DOM element showing the full loadout breakdown
 * for use in the mission detail panel.
 */
function loadoutWidget(raw) {
  const parsed = parseLoadout(raw);
  if (!parsed) {
      return el('div', 'dv sm', '—');
  }

  const wrap = el('div', 'lo-widget');

  // Raw code display
  const rawLine = el('div', 'lo-raw', parsed.raw);
  wrap.appendChild(rawLine);

  // Section: Air-to-Air
  const aaSection = el('div', 'lo-section');
  aaSection.appendChild(el('div', 'lo-section-lbl', 'AIR-TO-AIR'));
  const aaGrid = el('div', 'lo-aa-grid');
  parsed.aa.forEach(slot => {
    const cell = el('div', 'lo-aa-cell' + (slot.count === 0 ? ' lo-zero' : ''));
    const countEl = el('div', 'lo-aa-count', String(slot.count));
    countEl.style.color = slot.count > 0 ? foxColor(slot.cat) : 'var(--text-3)';
    cell.appendChild(countEl);
    cell.appendChild(el('div', 'lo-aa-name', slot.name));
    cell.appendChild(el('div', 'lo-aa-full', slot.full));
    cell.title = slot.full;
    aaGrid.appendChild(cell);
  });

  // Gun cell
  const gunCell = el('div', 'lo-aa-cell' + (parsed.gun ? '' : ' lo-zero'));
  const gunCount = el('div', 'lo-aa-count', parsed.gun ? '+' : '—');
  gunCount.style.color = parsed.gun ? 'var(--amber)' : 'var(--text-3)';
  gunCell.appendChild(gunCount);
  gunCell.appendChild(el('div', 'lo-aa-name', 'GUN'));
  gunCell.appendChild(el('div', 'lo-aa-full', parsed.gun ? 'Gun ammo loaded' : 'No gun ammo'));
  aaGrid.appendChild(gunCell);

  aaSection.appendChild(aaGrid);
  wrap.appendChild(aaSection);

  // Section: Weapons (if any)
  if (parsed.weapons.length > 0) {
    const wpnSection = el('div', 'lo-section');
    wpnSection.appendChild(el('div', 'lo-section-lbl', 'STORES'));
    parsed.weapons.forEach(w => {
      const row = el('div', 'lo-wpn-row');
      const badge = el('span', 'lo-wpn-badge', w.info.name);
      badge.style.background = weaponColor(w.info.cat);
      row.appendChild(badge);
      row.appendChild(el('span', 'lo-wpn-qty', `${w.qty}×`));
      row.appendChild(el('span', 'lo-wpn-full', w.info.full));
      wpnSection.appendChild(row);
    });
    wrap.appendChild(wpnSection);
  }

  return wrap;
}
