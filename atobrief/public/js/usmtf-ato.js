// ═══════════════════════════════════════════════════════════
// usmtf-ato.js — atobrief package → USMTF Air Tasking Order (ADR 0078)
//
// Two pure layers, usable in the browser (window.UsmtfAto) and in Node
// (module.exports):
//
//   atobriefToAtoDoc(pkg, opts) → { doc, warnings, errors }   the MAPPER
//   renderUsmtf(doc)            → { text, warnings }          the RENDERER
//   buildUsmtf(pkg, opts)       = renderUsmtf(atobriefToAtoDoc(pkg))
//
// The renderer knows USMTF and nothing about atobrief. The mapper knows the
// atobrief YAML (both the file shape and the editor's runtime shape) and
// nothing about USMTF layout. A new YAML field touches only the mapper.
//
// Nothing here touches STATE, window, document, jsyaml, Date.now() or
// Math.random(). Every DTG is IN-GAME UTC, derived from header.ato_date and
// the package's own times, never the wall clock.
//
// ── Source caveat (docs/parallel/research/usmtf-ato.md, lines 9–15) ──
// MIL-STD-6040 is Distribution Statement C (US Government agencies and their
// contractors only), and was NOT consulted. Everything here comes from public
// academic papers, public DCS and flight-sim community documents, and a few
// training excerpts. The set names and the overall grammar agree across all
// the sources, and several field orders are confirmed independently. Anything
// marked [COMMUNITY] or [PROFILE] is not confirmed by an official text.
// [PROFILE] / [SOURCE-DEFINED] means a SOURCE DCS convention that the
// research note defines so that our own exporter (this file) and parser
// (crc-sync, lane L3) agree. It is not a claim about the standard.
//
//   MSNACFT — fixed 11 fields [SOURCE-DEFINED]:
//     count/ACTYP:type/callsign/cfg1/cfg2/L16cs/TACAN/JU/M1/M2/M3
//   ARINFO  — fixed 16 positions [SOURCE-DEFINED], after the 455 vAEW
//     example, with '-' in 11, 14 and 15 and the TACAN in 16.
// ═══════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UsmtfAto = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Module constants (P5: never read from the environment) ───────────
  var DEFAULTS = {
    unit:        'SOURCE DCS',
    country:     'US',
    service:     'F',
    originator:  'SOURCEDCS AOC',
    messageKind: 'EXER',
  };

  var MAX_LINE = 69;          // traditional teletype limit (research §1.2)
  var INDENT   = '     ';     // 5-space continuation indent
  var MONTHS   = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // Control-agency type → CONTROLA f1. One table, so the pending decision H45
  // (what ABM / IC / RADAR really are) is a one-line change. Anything not in
  // the table exports as OTR, with info AGENCY_TYPE_OTR.
  var AGENCY_TYPE_MAP = {
    AWACS: 'AWAC',
    AWAC:  'AWAC',
    CRC:   'CRC',
    OTR:   'OTR',
  };

  // Tanker AR system (atobrief vocabulary) → USMTF code. BOM is attested;
  // DROGUE is exported as-is because CDT is unverified (research §1.5).
  var AR_SYSTEM_MAP = {
    BOOM:   'BOM',
    BOM:    'BOM',
    DROGUE: 'DROGUE',
    CDT:    'CDT',
  };

  // Copied from atobrief/public/js/app.js COORD_RE_SRC (a browser global there,
  // so this module keeps its own copy). DMS and DM, 1–3-digit degrees.
  var COORD_RE_SRC = String.raw`([NS])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″\s]*)?\s*([EW])\s*(\d+)[°d][^\d]*(\d+(?:\.\d+)?)['\s]*(?:(\d+(?:\.\d+)?)["″]?)?`;

  // ════════════════════════════════════════════════════════════════════
  // Warnings
  // ════════════════════════════════════════════════════════════════════

  // Aggregated per (code, mission): a repeat bumps `count` instead of adding
  // a line. `gap()` builds one per-export info listing every mission.
  function Warnings() {
    this.list = [];
    this._idx = {};
    this._gaps = {};
  }
  Warnings.prototype.add = function (code, severity, message, extra) {
    extra = extra || {};
    var key = code + '|' + (extra.missionNumber == null ? '' : extra.missionNumber);
    var hit = this._idx[key];
    if (hit) { hit.count = (hit.count || 1) + 1; return hit; }
    var w = { code: code, severity: severity };
    if (extra.missionNumber != null) w.missionNumber = extra.missionNumber;
    if (extra.path) w.path = extra.path;
    w.message = message;
    this._idx[key] = w;
    this.list.push(w);
    return w;
  };
  Warnings.prototype.warn = function (code, message, extra) { return this.add(code, 'warning', message, extra); };
  Warnings.prototype.info = function (code, message, extra) { return this.add(code, 'info', message, extra); };
  Warnings.prototype.gap = function (code, label, what) {
    var g = this._gaps[code];
    if (!g) {
      g = { code: code, severity: 'info', missions: [], message: '' };
      g._label = what;
      this._gaps[code] = g;
      this.list.push(g);
    }
    if (g.missions.indexOf(label) < 0) g.missions.push(label);
    g.message = what + ': ' + g.missions.join(', ');
    return g;
  };
  Warnings.prototype.done = function () {
    return this.list.map(function (w) {
      var o = {};
      Object.keys(w).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = w[k]; });
      return o;
    });
  };

  // ════════════════════════════════════════════════════════════════════
  // Helpers (exported as _internal for tests)
  // ════════════════════════════════════════════════════════════════════

  function pad(n, w) { return String(n).padStart(w, '0'); }

  function isBlank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

  // Dtg = { year, month (1-12), day, hour, minute }, in-game UTC.
  // form: 'full' DDHHMMZMONYYYY · 'mon' DDHHMMZMON · 'short' DDHHMMZ
  function formatDtg(dtg, form) {
    if (!dtg) return '-';
    var s = pad(dtg.day, 2) + pad(dtg.hour, 2) + pad(dtg.minute, 2) + 'Z';
    if (form === 'short') return s;
    s += MONTHS[dtg.month - 1];
    if (form === 'mon') return s;
    return s + pad(dtg.year, 4);
  }

  // Pure calendar arithmetic (Date.UTC on explicit fields; no clock read).
  function addMinutes(dtg, minutes) {
    var t = Date.UTC(dtg.year, dtg.month - 1, dtg.day, dtg.hour, dtg.minute) + minutes * 60000;
    var d = new Date(t);
    return {
      year:   d.getUTCFullYear(),
      month:  d.getUTCMonth() + 1,
      day:    d.getUTCDate(),
      hour:   d.getUTCHours(),
      minute: d.getUTCMinutes(),
    };
  }

  // '0300Z' | '0300' | '0300L' | 300 (a YAML number: an unquoted 0240 loads
  // as 240) → { minutes: 0..1439, local: bool } or null.
  function parseHhmm(v) {
    if (v == null) return null;
    var s;
    if (typeof v === 'number') {
      if (!Number.isInteger(v) || v < 0) return null;
      s = pad(v, 4);
    } else if (typeof v === 'string') {
      s = v.trim().toUpperCase();
    } else {
      return null;
    }
    var m = /^(\d{3,4})([ZL])?$/.exec(s);
    if (!m) return null;
    var digits = pad(m[1], 4);
    var hh = +digits.slice(0, 2);
    var mm = +digits.slice(2, 4);
    if (hh > 23 || mm > 59) return null;
    return { minutes: hh * 60 + mm, local: m[2] === 'L' };
  }

  // Put an HHMM on the ATO timeline: the day of TIMEFRAM FROM, or the next
  // day when it is earlier than FROM's HHMM (month and year roll with it).
  function placeTime(minutes, from) {
    var fromMin = from.hour * 60 + from.minute;
    var base = { year: from.year, month: from.month, day: from.day, hour: 0, minute: 0 };
    return addMinutes(base, minutes + (minutes < fromMin ? 1440 : 0));
  }

  // 'YYYY-MM-DD' string, or a Date (js-yaml loads an unquoted date as one).
  function parseIsoDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate() };
    }
    if (typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var chk = new Date(Date.UTC(y, mo - 1, d));
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
    return { year: y, month: mo, day: d };
  }

  function parseCoord(str) {
    if (str == null) return null;
    var m = String(str).match(new RegExp(COORD_RE_SRC, 'i'));
    if (!m) return null;
    var lat = (m[1].toUpperCase() === 'N' ? 1 : -1) * (+m[2] + +m[3] / 60 + +(m[4] || 0) / 3600);
    var lon = (m[5].toUpperCase() === 'E' ? 1 : -1) * (+m[6] + +m[7] / 60 + +(m[8] || 0) / 3600);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon };
  }

  // {lat, lon} decimal degrees → DDMMSS[NS]DDDMMSS[EW], rounded to whole
  // seconds (the carry into minutes and degrees falls out of the arithmetic).
  function formatLatLon(ll) {
    function part(v, degW) {
      var ts = Math.round(Math.abs(v) * 3600);
      var d = Math.floor(ts / 3600);
      var mi = Math.floor((ts % 3600) / 60);
      var s = ts % 60;
      return pad(d, degW) + pad(mi, 2) + pad(s, 2);
    }
    return part(ll.lat, 2) + (ll.lat < 0 ? 'S' : 'N') + part(ll.lon, 3) + (ll.lon < 0 ? 'W' : 'E');
  }

  function dmsToUsmtf(str) {
    var ll = parseCoord(str);
    return ll ? formatLatLon(ll) : null;
  }

  // Upper-case, `/` and anything outside A–Z 0–9 space . , - ( ) : + become a
  // space, spaces collapse, trim. Warns CHARSET_REPLACED when anything other
  // than case, `_` or whitespace changed. Empty → '-'.
  function sanitiseField(s, warnings, where) {
    if (s == null) return '-';
    var up = String(s).toUpperCase();
    var out = up.replace(/[^A-Z0-9 .,\-():+]/g, ' ').replace(/\s+/g, ' ').trim();
    var benign = up.replace(/[_\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (warnings && out !== benign) {
      warnings.warn('CHARSET_REPLACED',
        'Characters outside the USMTF set were replaced by spaces' + (where && where.path ? ' (' + where.path + ')' : ''),
        where);
    }
    return out === '' ? '-' : out;
  }

  // Mode 1: 2 digits, first 0-7 and second 0-3 → '1dd'. Modes 2/3: 4 octal
  // digits → '2dddd' / '3dddd'. null → '-'. A malformed code → '-' plus
  // IFF_MALFORMED. Mode 3 7500/7600/7700 is emitted, with IFF_RESERVED.
  function iffToken(mode, code, warnings, where) {
    if (isBlank(code)) return '-';
    var c = String(code).trim();
    var ok = mode === 1 ? /^[0-7][0-3]$/.test(c) : /^[0-7]{4}$/.test(c);
    if (!ok) {
      if (warnings) warnings.warn('IFF_MALFORMED', 'Mode ' + mode + ' code "' + c + '" is not valid; exported as -', where);
      return '-';
    }
    if (mode === 3 && (c === '7500' || c === '7600' || c === '7700') && warnings) {
      warnings.warn('IFF_RESERVED', 'Mode 3 ' + c + ' is a reserved emergency code', where);
    }
    return String(mode) + c;
  }

  // 251 → '251.0'; '261.500' → '261.5'; '318.425' kept.
  function formatFreq(v, warnings, where) {
    if (isBlank(v)) return '-';
    var s = String(v).trim();
    var n = Number(s);
    if (!isFinite(n) || n <= 0) {
      if (warnings) warnings.warn('BAD_FREQUENCY', 'Frequency "' + s + '" is not a number', where);
      return '-';
    }
    if (!/^\d+(\.\d+)?$/.test(s)) s = String(n);
    var parts = s.split('.');
    var frac = (parts[1] || '').replace(/0+$/, '');
    return String(Number(parts[0])) + '.' + (frac || '0');
  }

  function formatAltitude(ft) {
    if (isBlank(ft)) return '-';
    var n = Number(ft);
    return isFinite(n) ? String(Math.round(n / 100)) : '-';
  }

  function formatOffload(klb) {
    if (isBlank(klb)) return '-';
    var n = Number(klb);
    return isFinite(n) ? n.toFixed(1) : '-';
  }

  // L3 §5.6 normalisation: upper-case, drop spaces, '-' and '_'; seedable iff
  // the result is 1–7 of [A-Z0-9].
  function callsignSeedable(cs) {
    if (isBlank(cs)) return false;
    return /^[A-Z0-9]{1,7}$/.test(String(cs).toUpperCase().replace(/[\s\-_]/g, ''));
  }

  // atobrief/DCS callsign → USMTF form: upper-case, '-'/'_' → space. Never
  // abbreviated (research §2.3).
  function normaliseCallsign(cs) {
    if (isBlank(cs)) return null;
    return String(cs).toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ── Line layout ─────────────────────────────────────────────────────

  // Linear set: tokens 'SETID/', 'f1/', …, 'fn//'. Break only right after a
  // '/', greedy up to MAX_LINE, continuation lines indented by 5 spaces.
  function wrapLinearSet(fields, warnings, where) {
    var tokens = fields.map(function (f, i) { return f + (i === fields.length - 1 ? '//' : '/'); });
    return wrapTokens(tokens, warnings, where);
  }

  function wrapTokens(tokens, warnings, where) {
    var lines = [];
    var line = '';
    tokens.forEach(function (tok) {
      if (line === '') { line = tok; return; }
      if (line.length + tok.length <= MAX_LINE) { line += tok; return; }
      lines.push(line);
      line = INDENT + tok;
    });
    if (line !== '') lines.push(line);
    if (warnings && lines.some(function (l) { return l.length > MAX_LINE; })) {
      warnings.warn('LINE_TOO_LONG', 'A field is too long to fit in ' + MAX_LINE + ' characters', where);
    }
    return lines;
  }

  // Free text: the structural prefix ('NARR/' or 'GENTEXT/heading/') then the
  // text, which may break only after a space that stays at the line end, so
  // deleting "\n + leading whitespace" gives the text back exactly.
  function wrapFreeText(prefixFields, text, warnings, where) {
    var tokens = prefixFields.map(function (f) { return f + '/'; });
    var words = String(text).split(' ');
    words.forEach(function (w, i) {
      tokens.push(w + (i === words.length - 1 ? '//' : ' '));
    });
    return wrapTokens(tokens, warnings, where);
  }

  // Columnar set: name alone, then '/'-prefixed header and rows. Every column
  // but the last is padded to (longest of header and values) + 1. The last
  // row ends in '//'. Rows are never wrapped.
  function layoutColumnar(setId, headers, rows, warnings, where) {
    var last = headers.length - 1;
    var widths = headers.map(function (h, i) {
      var w = h.length;
      rows.forEach(function (r) { w = Math.max(w, String(r[i]).length); });
      return w + 1;
    });
    function fmt(cells) {
      return '/' + cells.map(function (c, i) {
        return i < last ? String(c).padEnd(widths[i]) : String(c);
      }).join('/');
    }
    var lines = [setId, fmt(headers)];
    rows.forEach(function (r) { lines.push(fmt(r)); });
    lines[lines.length - 1] += '//';
    if (warnings && lines.some(function (l) { return l.length > MAX_LINE; })) {
      warnings.warn('LINE_TOO_LONG', setId + ' has a row longer than ' + MAX_LINE + ' characters', where);
    }
    return lines;
  }

  function trimFields(fields, min) {
    var f = fields.slice();
    while (f.length > min && f[f.length - 1] === '-') f.pop();
    return f;
  }

  // ════════════════════════════════════════════════════════════════════
  // RENDERER: AtoDoc → USMTF text
  // ════════════════════════════════════════════════════════════════════

  function renderUsmtf(doc) {
    var W = new Warnings();
    var out = [];

    function S(v, where) { return sanitiseField(v, W, where); }
    function opt(prefix, v, where) { return isBlank(v) ? '-' : prefix + S(v, where); }
    function dtg(prefix, d, form) { return d ? prefix + formatDtg(d, form) : '-'; }
    function freq(letter, f, where) {
      if (!f) return '-';
      if (!isBlank(f.designator)) return letter + 'DESIG:' + S(f.designator, where);
      var v = formatFreq(f.freqMhz, W, where);
      return v === '-' ? '-' : letter + 'FREQ:' + v;
    }
    function num(v) { return (v == null || !isFinite(Number(v))) ? '-' : String(Math.round(Number(v))); }
    function linear(fields, where) { wrapLinearSet(fields, W, where).forEach(function (l) { out.push(l); }); }
    function free(prefix, text, where) {
      var t = S(text, where);
      wrapFreeText(prefix, t, W, where).forEach(function (l) { out.push(l); });
    }
    function columnar(setId, headers, rows, where) {
      layoutColumnar(setId, headers, rows, W, where).forEach(function (l) { out.push(l); });
    }

    out.push(S(doc.classification || 'UNCLAS'));
    var kind = doc.messageKind === 'OPER' ? 'OPER' : 'EXER';
    linear(trimFields([kind, S(doc.operation)], 2));
    var msg = doc.msgid || {};
    linear(trimFields(['MSGID', 'ATO', S(msg.originator), opt('', msg.serial), isBlank(msg.month) ? '-' : S(msg.month)], 3));
    linear(['AKNLDG', 'NO']);
    var tf = doc.timeframe || {};
    linear(trimFields(['TIMEFRAM', dtg('FROM:', tf.from, 'full'), dtg('TO:', tf.to, 'full'), dtg('ASOF:', tf.asof, 'full')], 3));
    (doc.generalText || []).forEach(function (g) { free(['GENTEXT', S(g.heading)], g.text); });

    var units = doc.units || [];
    if (units.length) {
      linear(['TSKCNTRY', S(doc.country)]);
      linear(['SVCTASK', S(doc.service)]);
    }
    units.forEach(function (u) {
      linear(trimFields(['TASKUNIT', S(u.name), opt('ICAO:', u.icao)], 2));
      (u.missions || []).forEach(function (m) { renderMission(m); });
      if (!isBlank(u.remarks)) free(['GENTEXT', 'UNIT REMARKS'], u.remarks);
    });

    function renderMission(m) {
      var where = { missionNumber: m.missionNumber || undefined };
      var dep = m.departure || {}, rec = m.recovery || {};
      var mt = m.missionType || {};
      linear(['AMSNDAT', 'N',
        opt('', m.missionNumber, where), opt('', m.amcMissionNumber, where), opt('', m.packageId, where),
        m.isPackageCommander ? 'MC' : '-',
        opt('', mt.primary, where), opt('', mt.secondary, where), opt('', m.alertStatus, where),
        opt('DEPLOC:', dep.location, where), dtg('', dep.time, 'mon'),
        opt('ARRLOC:', rec.location, where), dtg('', rec.time, 'mon')], where);

      (m.aircraft || []).forEach(function (a) {
        var cfg = a.config || {}, dl = a.datalink || {}, iff = a.iff || {};
        linear(['MSNACFT', num(a.count), opt('ACTYP:', a.aircraftType, where), opt('', a.callsign, where),
          opt('', cfg.primary, where), opt('', cfg.secondary, where),
          opt('', dl.l16Callsign, where), opt('', dl.tacan, where), opt('', dl.ju, where),
          iffToken(1, iff.modeOne, W, where), iffToken(2, iff.modeTwo, W, where),
          iffToken(3, iff.modeThree, W, where)], where);
      });

      var loc = m.location;
      if (loc && loc.kind === 'GTGTLOC') {
        (loc.targets || []).forEach(function (t) {
          var dm = t.dmpi ? formatLatLon(t.dmpi) : null;
          linear(trimFields(['GTGTLOC', 'P', dtg('TOT:', t.tot, 'mon'), dtg('NET:', t.net, 'mon'),
            dtg('NLT:', t.nlt, 'short'), opt('', t.name, where), opt('ID:', t.id, where),
            opt('', t.type, where), '-', dm ? 'DMPIS:' + dm : '-', dm ? 'WE' : '-',
            t.elevationFt == null ? '-' : num(t.elevationFt) + 'FT'], 5), where);
        });
      } else if (loc) {
        linear(trimFields(['AMSNLOC', dtg('', loc.start, 'mon'), dtg('', loc.stop, 'mon'),
          opt('', loc.name, where), loc.altitudeFt == null ? '-' : formatAltitude(loc.altitudeFt),
          loc.priority == null ? '-' : num(loc.priority)], 2), where);
      }

      if (m.control) {
        var c = m.control;
        linear(trimFields(['CONTROLA', opt('', c.type, where), opt('', c.callsign, where),
          freq('P', c.primary, where), freq('S', c.secondary, where),
          opt('NAME:', c.reportInPoint, where)], 3), where);
      }

      (m.arInfo || []).forEach(function (r) {
        linear(['ARINFO', opt('', r.tankerCallsign, where), opt('', r.tankerMissionNumber, where),
          iffToken(3, r.tankerModeThree, W, where), opt('NAME:', r.arcp, where),
          r.altitudeFt == null ? '-' : formatAltitude(r.altitudeFt),
          dtg('ARCT:', r.arct, 'short'), dtg('NDAR:', r.endAr, 'mon'),
          r.offloadKlb == null ? '-' : 'KLBS:' + formatOffload(r.offloadKlb),
          freq('P', r.primary, where), freq('S', r.secondary, where), '-',
          opt('ACTYP:', r.tankerType, where), opt('', r.system, where), '-', '-',
          opt('', r.tacan, where)], where);
      });

      if (m.packageCommander) {
        var pc = m.packageCommander;
        linear(['PKGCMD', opt('', pc.packageId, where), opt('', pc.unit, where),
          opt('', pc.missionNumber, where), opt('', pc.callsign, where)], where);
      }

      if (m.packageData && m.packageData.length) {
        columnar('9PKGDAT', ['PKGID', 'UNIT', 'MSNNO', 'PMSN', 'NO', 'ACTYPE', 'ACSIGN'],
          m.packageData.map(function (p) {
            return [opt('', p.packageId, where), opt('', p.unit, where), opt('', p.missionNumber, where),
              opt('', p.missionType, where), num(p.count), opt('AC:', p.aircraftType, where),
              opt('', p.callsign, where)];
          }), where);
      }

      if (m.refuelTask) {
        var rt = m.refuelTask;
        linear(trimFields(['REFTSK', opt('', rt.system, where),
          rt.totalOffloadKlb == null ? '-' : 'KLBS:' + formatOffload(rt.totalOffloadKlb),
          rt.alertOffloadKlb == null ? '-' : 'KLBS:' + formatOffload(rt.alertOffloadKlb),
          freq('P', rt.primary, where), freq('S', rt.secondary, where), opt('', rt.tacan, where)], 2), where);
      }

      if (m.refuelRows && m.refuelRows.length) {
        columnar('5REFUEL', ['MSNNO', 'RECCS', 'NO', 'ACTYPE', 'OFLD', 'ARCT', 'SEQ', 'TYP', 'ARS'],
          m.refuelRows.map(function (r) {
            return [opt('', r.missionNumber, where), opt('', r.callsign, where), num(r.count),
              opt('AC:', r.aircraftType, where),
              r.offloadKlb == null ? '-' : 'KLB:' + formatOffload(r.offloadKlb),
              dtg('', r.arct, 'short'), r.sequence == null ? '-' : 'A:' + num(r.sequence),
              opt('A:', r.fuelType, where), opt('', r.system, where)];
          }), where);
      }

      if (m.controlRows && m.controlRows.length) {
        columnar('7CONTROL', ['MSNNO', 'ACSIGN', 'NO', 'ACTYPE', 'MSNTY', 'TOSTA', 'RIP'],
          m.controlRows.map(function (r) {
            return [opt('', r.missionNumber, where), opt('', r.callsign, where), num(r.count),
              opt('AC:', r.aircraftType, where), opt('', r.missionType, where),
              dtg('', r.onStation, 'short'), opt('', r.reportInPoint, where)];
          }), where);
      }

      (m.narrative || []).forEach(function (n) { if (!isBlank(n)) free(['NARR'], n, where); });
    }

    return { text: out.join('\n') + '\n', warnings: W.done() };
  }

  // ════════════════════════════════════════════════════════════════════
  // MAPPER: atobrief package → AtoDoc
  // ════════════════════════════════════════════════════════════════════

  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function str(v) { return isBlank(v) ? null : String(v).trim(); }

  function stripMsn(v) {
    if (isBlank(v)) return null;
    var s = String(v).trim().replace(/^MSN/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return s === '' ? null : s;
  }

  // Registry category → [{ key, item }] whether it is a dict or a list.
  function entries(cat, idKey) {
    if (Array.isArray(cat)) {
      return cat.filter(obj).map(function (item, i) {
        var k = item[idKey || 'id'];
        if (k == null && idKey !== 'callsign') k = item.callsign;
        return { key: k == null ? String(i) : String(k), item: item };
      });
    }
    var o = obj(cat);
    if (!o) return [];
    return Object.keys(o).filter(function (k) { return k.charAt(0) !== '_' && obj(o[k]); })
      .map(function (k) { return { key: k, item: o[k] }; });
  }

  function atobriefToAtoDoc(pkg, opts) {
    opts = opts || {};
    var W = new Warnings();
    var errors = [];
    if (!obj(pkg) || !obj(pkg.ato)) {
      errors.push({ code: 'NOT_A_PACKAGE', severity: 'error', message: 'Not an atobrief package: no "ato" section' });
      return { doc: null, warnings: [], errors: errors };
    }
    var header = obj(pkg.header) || {};
    var ato = pkg.ato;
    var reg = obj(pkg.registry) || {};
    var usm = obj(header.usmtf) || {};
    var def = Object.assign({}, DEFAULTS, opts.defaults || {});

    var date = parseIsoDate(header.ato_date) || parseIsoDate(ato.ato_day);
    if (!date) {
      errors.push({ code: 'NO_ATO_DATE', severity: 'error', path: 'header.ato_date',
        message: 'header.ato_date must be a YYYY-MM-DD in-game date; no DTG can be formed without it' });
      return { doc: null, warnings: W.done(), errors: errors };
    }

    var localOffset = Number(ato.local_offset_hours) || 0;
    function hhmm(v, path, mn) {
      if (isBlank(v)) return null;
      var p = parseHhmm(v);
      if (!p) {
        W.warn('BAD_TIME', 'Time "' + v + '" is not HHMM[Z]' + (path ? ' at ' + path : ''), { missionNumber: mn, path: path });
        return null;
      }
      return p.local ? ((p.minutes - localOffset * 60) % 1440 + 1440) % 1440 : p.minutes;
    }

    // ── Header ──
    var startRaw = ato.ingame_start_time != null ? ato.ingame_start_time : ato.ingame_start_local;
    var startMin = hhmm(startRaw, 'ato.ingame_start_time');
    if (startMin == null) {
      startMin = 0;
      W.warn('TIMEFRAME_DEFAULTED', 'No valid ato.ingame_start_time; TIMEFRAM starts at 0000Z', { path: 'ato.ingame_start_time' });
    }
    var from = { year: date.year, month: date.month, day: date.day, hour: Math.floor(startMin / 60), minute: startMin % 60 };
    function at(v, path, mn) {
      var mins = hhmm(v, path, mn);
      return mins == null ? null : placeTime(mins, from);
    }
    var to = addMinutes(from, 24 * 60 - 1);
    W.info('TIMEFRAME_END_DERIVED', 'TIMEFRAM TO is FROM + 24 h - 1 min');

    var asof = null;
    if (!isBlank(usm.asof)) {
      var am = /^(\d{4}-\d{2}-\d{2})\s+(\S+)$/.exec(String(usm.asof).trim());
      var ad = am && parseIsoDate(am[1]);
      var at_ = am && parseHhmm(am[2]);
      if (ad && at_ && !at_.local) {
        asof = { year: ad.year, month: ad.month, day: ad.day, hour: Math.floor(at_.minutes / 60), minute: at_.minutes % 60 };
      } else {
        W.warn('BAD_TIME', 'header.usmtf.asof must be "YYYY-MM-DD HHMMZ" (in-game)', { path: 'header.usmtf.asof' });
      }
    }

    var cls = str(header.classification) || str(ato.classification);
    if (cls && !/^UNCLAS(SIFIED)?$/i.test(cls)) {
      W.info('CLASSIFICATION_FORCED_UNCLAS', 'The package says "' + cls + '"; the USMTF export is always UNCLAS (decision H44)',
        { path: 'header.classification' });
    }

    var operation = str(header.operation) || str(ato.operation);
    if (!operation) {
      operation = 'UNNAMED OPERATION';
      W.warn('OPERATION_MISSING', 'No header.operation; exported as UNNAMED OPERATION', { path: 'header.operation' });
    }

    var kind = String(usm.message_kind || def.messageKind || 'EXER').toUpperCase();
    if (kind !== 'EXER' && kind !== 'OPER') {
      W.warn('BAD_MESSAGE_KIND', 'header.usmtf.message_kind must be EXER or OPER; using EXER', { path: 'header.usmtf.message_kind' });
      kind = 'EXER';
    }

    var generalText = [];
    var cws = Array.isArray(ato.codewords) ? ato.codewords : [];
    var cwItems = cws.map(function (cw, i) {
      if (!obj(cw) || isBlank(cw.word)) return null;
      var d = at(cw.time, 'ato.codewords[' + i + '].time');
      return { word: String(cw.word).trim(), dtg: d, i: i };
    }).filter(Boolean);
    cwItems.sort(function (a, b) {
      var ta = a.dtg ? Date.UTC(a.dtg.year, a.dtg.month - 1, a.dtg.day, a.dtg.hour, a.dtg.minute) : Infinity;
      var tb = b.dtg ? Date.UTC(b.dtg.year, b.dtg.month - 1, b.dtg.day, b.dtg.hour, b.dtg.minute) : Infinity;
      return ta === tb ? a.i - b.i : ta - tb;
    });
    if (cwItems.length) {
      generalText.push({ heading: 'CODEWORDS', text: cwItems.map(function (c) {
        return c.dtg ? c.word + ' AT ' + formatDtg(c.dtg, 'short') : c.word;
      }).join(', ') });
    }

    // ── Registry lookups ──
    var tankers = {};
    var tankerList = entries(reg.tankers, 'id');
    tankerList.forEach(function (e) {
      tankers[e.key] = e;
      if (!isBlank(e.item.callsign) && !tankers[String(e.item.callsign)]) tankers[String(e.item.callsign)] = e;
    });
    var agencies = {};
    entries(reg.control_agencies, 'id').forEach(function (e) { agencies[e.key] = e; });
    var targets = {};
    entries(reg.targets, 'id').forEach(function (e) { targets[e.key] = e.item; });
    var steerpoints = {};
    entries(reg.steerpoints, 'id').forEach(function (e) { steerpoints[e.key] = e.item; });
    var airfields = obj(reg.airfields) || {};
    var callsignReg = obj(reg.callsigns) || {};
    var unitReg = obj(reg.units) || {};
    function callsignType(cs) {
      if (isBlank(cs)) return null;
      var hit = callsignReg[cs];
      if (!hit) {
        var n = normaliseCallsign(cs);
        Object.keys(callsignReg).some(function (k) {
          if (normaliseCallsign(k) === n) { hit = callsignReg[k]; return true; }
          return false;
        });
      }
      return obj(hit) && !isBlank(hit.type) ? String(hit.type) : null;
    }

    // SPINS C3 (the section editor-spins.js _spinsIsIff finds): number → modes.
    var c3 = {};
    var c3Rows = [];
    var sections = obj(pkg.spins) && Array.isArray(pkg.spins.sections) ? pkg.spins.sections : [];
    sections.forEach(function (s, si) {
      if (!obj(s) || !/\bc3\b|iff\b/i.test(String(s.title || '')) || !obj(s.table)) return;
      var hdrs = (s.table.headers || []).map(function (h) { return String(h).toUpperCase(); });
      var iMsn = hdrs.indexOf('MSN'), iMode = hdrs.indexOf('MODE'), iCode = hdrs.indexOf('CODE');
      if (iMsn < 0) iMsn = 0;
      if (iMode < 0) iMode = 1;
      if (iCode < 0) iCode = 2;
      (s.table.rows || []).forEach(function (r, ri) {
        if (!Array.isArray(r)) return;
        var key = stripMsn(r[iMsn]);
        var mode = String(r[iMode] == null ? '' : r[iMode]).trim();
        if (!key || ['1', '2', '3'].indexOf(mode) < 0 || isBlank(r[iCode])) return;
        c3Rows.push({ key: key, mode: mode, code: r[iCode], path: 'spins.sections[' + si + '].table.rows[' + ri + ']' });
      });
    });

    // ── Missions: first pass (identity) ──
    var missions = Array.isArray(ato.missions) ? ato.missions.filter(obj) : [];
    if (!missions.length) W.warn('NO_MISSIONS', 'The package has no missions; the ATO carries its header only');
    var seen = {};
    var infos = missions.map(function (m, i) {
      var num_ = stripMsn(m.mission_number);
      var label = num_ || (normaliseCallsign(m.callsign) || '#' + (i + 1));
      if (!num_) {
        W.warn('MISSING_MISSION_NUMBER', 'Mission ' + label + ' has no mission number; L3 will skip it',
          { path: 'ato.missions[' + i + '].mission_number' });
      } else if (seen[num_]) {
        W.warn('DUPLICATE_MISSION_NUMBER', 'Mission number ' + num_ + ' is used more than once', { missionNumber: num_ });
      }
      if (num_) seen[num_] = true;
      var unitName = str(m.unit);
      return { m: m, i: i, num: num_, label: label, unit: unitName || str(usm.default_unit) || def.unit,
        defaultUnit: !unitName, callsign: normaliseCallsign(m.callsign) };
    });
    var byNum = {};
    infos.forEach(function (inf) { if (inf.num && !byNum[inf.num]) byNum[inf.num] = inf; });

    c3Rows.forEach(function (r) {
      if (!byNum[r.key]) W.info('IFF_ROW_UNMATCHED', 'SPINS C3 row for ' + r.key + ' matches no mission', { path: r.path });
    });

    function iffCode(v, mode, mn, path) {
      if (isBlank(v)) return null;
      if (typeof v === 'number') {
        W.warn('IFF_NOT_STRING', 'Mode ' + mode + ' code at ' + path + ' is a number; leading zeros may be lost — quote it',
          { missionNumber: mn, path: path });
      }
      return String(v).trim().padStart(mode === '1' ? 2 : 4, '0');
    }

    function missionIff(inf) {
      var mi = obj(inf.m.iff) || {};
      var p = 'ato.missions[' + inf.i + '].iff';
      var res = {
        modeOne:   iffCode(mi.mode1, '1', inf.num, p + '.mode1'),
        modeTwo:   iffCode(mi.mode2, '2', inf.num, p + '.mode2'),
        modeThree: iffCode(mi.mode3, '3', inf.num, p + '.mode3'),
      };
      var keys = { '1': 'modeOne', '2': 'modeTwo', '3': 'modeThree' };
      c3Rows.forEach(function (r) {
        if (r.key !== inf.num) return;
        var code = iffCode(r.code, r.mode, inf.num, r.path);
        var k = keys[r.mode];
        if (res[k] == null) res[k] = code;
        else if (res[k] !== code) {
          W.warn('IFF_SPINS_MISMATCH', 'Mission ' + inf.num + ' Mode ' + r.mode + ' is ' + res[k] +
            ' but SPINS C3 says ' + code + '; the mission value is exported', { missionNumber: inf.num });
        }
      });
      return res;
    }
    infos.forEach(function (inf) { inf.iff = missionIff(inf); });

    function acOf(inf) {
      var ac = obj(inf.m.aircraft) || {};
      var n = parseInt(ac.count, 10);
      if (!(n > 0)) {
        W.warn('BAD_AIRCRAFT_COUNT', 'Mission ' + inf.label + ' has no valid aircraft count; exported as 1',
          { missionNumber: inf.num, path: 'ato.missions[' + inf.i + '].aircraft.count' });
        n = 1;
      }
      return { count: n, type: str(ac.type), loadout: str(ac.loadout) };
    }
    infos.forEach(function (inf) { inf.ac = acOf(inf); });

    // Support missions: a registry tanker / agency links to its mission.
    var tankerMission = {};   // tanker key → info
    var agencyMission = {};   // agency key → info
    tankerList.forEach(function (e) {
      var n = stripMsn(e.item.mission_number);
      if (n && byNum[n]) tankerMission[e.key] = byNum[n];
      else if (n) W.warn('UNKNOWN_SUPPORT_MISSION', 'Tanker ' + e.key + ' names mission ' + n + ', which is not in the ATO',
        { path: 'registry.tankers.' + e.key + '.mission_number' });
    });
    Object.keys(agencies).forEach(function (k) {
      var n = stripMsn(agencies[k].item.mission_number);
      if (n && byNum[n]) agencyMission[k] = byNum[n];
      else if (n) W.warn('UNKNOWN_SUPPORT_MISSION', 'Control agency ' + k + ' names mission ' + n + ', which is not in the ATO',
        { path: 'registry.control_agencies.' + k + '.mission_number' });
    });

    function tacanOf(v, path, mn) {
      if (isBlank(v)) return null;
      var t = String(v).trim().toUpperCase();
      if (!/^\d{1,3}[XY]$/.test(t)) W.warn('BAD_TACAN', 'TACAN "' + v + '" is not like 39X; exported as given', { missionNumber: mn, path: path });
      return t;
    }
    function arSystem(v, path) {
      if (isBlank(v)) return null;
      var k = String(v).trim().toUpperCase();
      if (AR_SYSTEM_MAP[k]) return AR_SYSTEM_MAP[k];
      W.warn('BAD_AR_SYSTEM', 'AR system "' + v + '" is not BOOM or DROGUE; exported as given', { path: path });
      return k;
    }
    function freqOf(v) { return isBlank(v) ? null : { freqMhz: String(v).trim() }; }
    function firstTos(inf) {
      var tl = targetsOf(inf.m);
      for (var i = 0; i < tl.length; i++) if (!isBlank(tl[i].tos)) return tl[i].tos;
      return null;
    }
    function targetsOf(m) {
      if (Array.isArray(m.targets)) return m.targets.filter(obj);
      if (obj(m.target)) return [m.target];
      return [];
    }

    // Per-mission resolved control (agency key) and refuels.
    infos.forEach(function (inf) {
      var ctrl = obj(inf.m.control);
      inf.agencyKey = null;
      if (ctrl && !isBlank(ctrl.agency_id)) {
        if (agencies[ctrl.agency_id]) inf.agencyKey = String(ctrl.agency_id);
        else W.warn('UNKNOWN_AGENCY', 'Control agency "' + ctrl.agency_id + '" is not in registry.control_agencies',
          { missionNumber: inf.num, path: 'ato.missions[' + inf.i + '].control.agency_id' });
      } else if (ctrl && (!isBlank(ctrl.primary_freq_mhz) || !isBlank(ctrl.report_in_point))) {
        W.warn('CONTROL_WITHOUT_AGENCY', 'Mission ' + inf.label + ' has control data but no agency; CONTROLA needs a callsign and is left out',
          { missionNumber: inf.num });
      }
      inf.refuels = [];
      (Array.isArray(inf.m.refuel) ? inf.m.refuel : (obj(inf.m.refuel) ? [inf.m.refuel] : [])).forEach(function (r, ri) {
        if (!obj(r)) return;
        var path = 'ato.missions[' + inf.i + '].refuel[' + ri + ']';
        var te = !isBlank(r.tanker_id) ? tankers[String(r.tanker_id)] : null;
        if (!te) {
          W.warn('UNKNOWN_TANKER', 'Refuel tanker "' + (r.tanker_id || '') + '" is not in registry.tankers; ARINFO skipped',
            { missionNumber: inf.num, path: path + '.tanker_id' });
          return;
        }
        var fromMin = hhmm(r.time_from, path + '.time_from', inf.num);
        inf.refuels.push({ r: r, ri: ri, te: te, path: path,
          arct: fromMin == null ? null : placeTime(fromMin, from),
          endAr: at(r.time_to, path + '.time_to', inf.num) });
      });
      inf.refuels.sort(function (a, b) {
        var ta = a.arct ? Date.UTC(a.arct.year, a.arct.month - 1, a.arct.day, a.arct.hour, a.arct.minute) : Infinity;
        var tb = b.arct ? Date.UTC(b.arct.year, b.arct.month - 1, b.arct.day, b.arct.hour, b.arct.minute) : Infinity;
        return ta === tb ? a.ri - b.ri : ta - tb;
      });
    });

    // Packages: id → { members[], commander }
    var packages = {};
    infos.forEach(function (inf) {
      var pid = str(inf.m.package_id);
      inf.packageId = pid ? pid.toUpperCase() : null;
      if (!inf.packageId) return;
      var p = packages[inf.packageId] || (packages[inf.packageId] = { members: [], commander: null });
      p.members.push(inf);
      if (inf.m.package_commander === true) {
        if (!p.commander) p.commander = inf;
        else W.warn('PACKAGE_MULTIPLE_COMMANDERS', 'Package ' + inf.packageId + ' has more than one commander; ' +
          p.commander.label + ' is used', { missionNumber: inf.num });
      }
    });
    Object.keys(packages).forEach(function (pid) {
      if (!packages[pid].commander) W.info('PACKAGE_WITHOUT_COMMANDER', 'Package ' + pid + ' has no package_commander; no PKGCMD/9PKGDAT');
    });

    // ── Second pass: build Mission objects ──
    var supportRefs = {};
    var docMissions = infos.map(function (inf) {
      var m = inf.m;
      var mn = inf.num;
      var P = 'ato.missions[' + inf.i + ']';
      var where = { missionNumber: mn };

      if (isBlank(m.mission_type)) W.warn('MISSION_TYPE_MISSING', 'Mission ' + inf.label + ' has no mission type', where);

      // Aircraft
      var dl = obj(m.datalink) || {};
      function dlStr(v, key, width) {
        if (isBlank(v)) return null;
        if (typeof v === 'number') {
          W.warn('DATALINK_NOT_STRING', P + '.datalink.' + key + ' is a number; leading zeros may be lost — quote it', where);
          return width ? String(v).padStart(width, '0') : String(v);
        }
        return String(v).trim().toUpperCase();
      }
      var aircraft = [{
        count: inf.ac.count,
        aircraftType: inf.ac.type,
        callsign: inf.callsign,
        config: { primary: inf.ac.loadout, secondary: null },
        datalink: {
          l16Callsign: dlStr(dl.l16_callsign, 'l16_callsign'),
          tacan: dl.tacan == null ? null : tacanOf(dl.tacan, P + '.datalink.tacan', mn),
          ju: dlStr(dl.ju, 'ju', 5),
        },
        iff: inf.iff,
      }];
      if (!inf.callsign) W.warn('CALLSIGN_MISSING', 'Mission ' + inf.label + ' has no callsign', where);
      else if (!callsignSeedable(inf.callsign)) {
        W.gap('CALLSIGN_NOT_SEEDABLE', inf.label, 'Callsign does not normalise to 1–7 of A–Z 0–9 (L3 cannot seed it)');
      }

      // Location: GTGTLOC per timed target, else AMSNLOC
      var tl = targetsOf(m);
      var timed = tl.filter(function (t) { return !isBlank(t.tot_net) || !isBlank(t.tot_nlt); });
      var vul = obj(m.vul);
      var location;
      if (timed.length) {
        if (tl.some(function (t) { return !isBlank(t.tos) || !isBlank(t.toffs); })) {
          W.info('TOS_DROPPED_FOR_GTGTLOC', 'Mission ' + inf.label + ' has NET/NLT targets; its TOS/TOFFS are not exported', where);
        }
        if (vul && (!isBlank(vul.start) || !isBlank(vul.end))) {
          W.info('VUL_DROPPED_FOR_GTGTLOC', 'Mission ' + inf.label + ' has NET/NLT targets; its vul window is not exported', where);
        }
        location = { kind: 'GTGTLOC', targets: timed.map(function (t) {
          var ti = tl.indexOf(t);
          var tp = P + '.targets[' + ti + ']';
          var rt = !isBlank(t.target_id) ? targets[String(t.target_id)] : null;
          if (!isBlank(t.target_id) && !rt) {
            W.warn('UNKNOWN_TARGET', 'Target "' + t.target_id + '" is not in registry.targets', { missionNumber: mn, path: tp + '.target_id' });
          }
          var dmpi = null;
          var coordSrc = rt ? rt.coords : t.coords;
          if (!isBlank(coordSrc)) {
            dmpi = parseCoord(coordSrc);
            if (!dmpi) W.warn('BAD_COORDS', 'Coordinates "' + coordSrc + '" could not be parsed', { missionNumber: mn, path: tp });
          }
          var elev = rt && !isBlank(rt.elevation) ? /(\d+)/.exec(String(rt.elevation)) : null;
          return {
            tot: null,
            net: at(t.tot_net, tp + '.tot_net', mn),
            nlt: at(t.tot_nlt, tp + '.tot_nlt', mn),
            name: rt ? str(rt.name) : null,
            id: str(t.target_id),
            type: rt ? str(rt.type) : null,
            dmpi: dmpi,
            elevationFt: elev ? Number(elev[1]) : null,
          };
        }) };
      } else {
        var start = null, stop = null;
        if (vul && (!isBlank(vul.start) || !isBlank(vul.end))) {
          start = at(vul.start, P + '.vul.start', mn);
          stop = at(vul.end, P + '.vul.end', mn);
        } else {
          var tosT = null;
          tl.forEach(function (t) { if (!tosT && !isBlank(t.tos)) tosT = t; });
          if (tosT) {
            var tpi = tl.indexOf(tosT);
            start = at(tosT.tos, P + '.targets[' + tpi + '].tos', mn);
            stop = at(tosT.toffs, P + '.targets[' + tpi + '].toffs', mn);
          }
          if (tl.some(function (t) { return t !== tosT && isBlank(t.tos) && !isBlank(t.toffs); })) {
            W.info('TOFFS_WITHOUT_TOS', 'Mission ' + inf.label + ' has a target with TOFFS but no TOS; it is ignored', where);
          }
        }
        var name = null, alt = null;
        var sps = Array.isArray(m.steer_points) ? m.steer_points : [];
        for (var si = 0; si < sps.length; si++) {
          var sp = sps[si];
          if (!obj(sp)) continue;
          var rsp = !isBlank(sp.id) ? steerpoints[String(sp.id)] : null;
          var orbit = obj(sp.orbit) || (rsp && obj(rsp.orbit));
          if (!orbit) continue;
          name = str(sp.name) || (rsp ? str(rsp.name) : null);
          alt = !isBlank(orbit.alt_ft) ? Number(orbit.alt_ft)
            : !isBlank(sp.altitude_ft) ? Number(sp.altitude_ft)
            : (rsp && !isBlank(rsp.altitude_ft)) ? Number(rsp.altitude_ft) : null;
          if (alt != null && !isFinite(alt)) alt = null;
          break;
        }
        // A tanker's own mission falls back to the tanker's ARCP and altitude.
        tankerList.forEach(function (e) {
          if (tankerMission[e.key] !== inf) return;
          if (!name) name = str(e.item.arcp);
          if (alt == null && !isBlank(e.item.altitude_ft) && isFinite(Number(e.item.altitude_ft))) alt = Number(e.item.altitude_ft);
        });
        var prio = !isBlank(m.priority) && isFinite(Number(m.priority)) ? Number(m.priority) : null;
        location = { kind: 'AMSNLOC', start: start, stop: stop, name: name, altitudeFt: alt, priority: prio };
      }

      // Control
      var control = null;
      var ctrl = obj(m.control) || {};
      if (inf.agencyKey) {
        var ag = agencies[inf.agencyKey].item;
        var at_ = String(ag.type || '').trim().toUpperCase();
        var ctype = AGENCY_TYPE_MAP[at_];
        if (!ctype) {
          ctype = 'OTR';
          W.info('AGENCY_TYPE_OTR', 'Agency type "' + (ag.type || '') + '" has no USMTF code yet; exported as OTR (decision H45 pending)',
            { path: 'registry.control_agencies.' + inf.agencyKey + '.type' });
        }
        control = {
          type: ctype,
          callsign: normaliseCallsign(ag.callsign) || normaliseCallsign(inf.agencyKey),
          primary: freqOf(!isBlank(ctrl.primary_freq_mhz) ? ctrl.primary_freq_mhz : ag.primary_freq_mhz),
          secondary: freqOf(!isBlank(ctrl.secondary_freq_mhz) ? ctrl.secondary_freq_mhz : ag.secondary_freq_mhz),
          reportInPoint: str(ctrl.report_in_point),
        };
      }

      // Air refuelling as receiver
      var arInfo = inf.refuels.map(function (rf) {
        var t = rf.te.item;
        var tm = tankerMission[rf.te.key];
        var tcs = normaliseCallsign(t.callsign) || normaliseCallsign(rf.te.key);
        if (!tm) supportRefs['tanker:' + rf.te.key] = 'tanker ' + (tcs || rf.te.key);
        var offload = !isBlank(rf.r.offload_klb) && isFinite(Number(rf.r.offload_klb)) ? Number(rf.r.offload_klb) : null;
        return {
          tankerCallsign: tcs,
          tankerMissionNumber: tm ? tm.num : null,
          tankerModeThree: tm ? tm.iff.modeThree : null,
          arcp: str(t.arcp),
          altitudeFt: !isBlank(t.altitude_ft) && isFinite(Number(t.altitude_ft)) ? Number(t.altitude_ft) : null,
          arct: rf.arct,
          endAr: rf.endAr,
          offloadKlb: offload,
          primary: freqOf(t.freq_mhz),
          secondary: freqOf(t.secondary_freq_mhz),
          tankerType: callsignType(t.callsign) || callsignType(rf.te.key) || (tm ? tm.ac.type : null),
          system: arSystem(t.system, 'registry.tankers.' + rf.te.key + '.system'),
          tacan: tacanOf(t.tacan, 'registry.tankers.' + rf.te.key + '.tacan', mn),
        };
      });
      if (inf.agencyKey && !agencyMission[inf.agencyKey]) {
        supportRefs['agency:' + inf.agencyKey] = 'agency ' + inf.agencyKey;
      }

      // Package
      var packageCommander = null, packageData = null;
      var pk = inf.packageId ? packages[inf.packageId] : null;
      var isCmdr = !!(pk && pk.commander === inf);
      if (pk && pk.commander && !isCmdr) {
        var c = pk.commander;
        packageCommander = { packageId: inf.packageId, unit: c.unit, missionNumber: c.num, callsign: c.callsign };
      }
      if (isCmdr) {
        packageData = pk.members.map(function (x) {
          return { packageId: inf.packageId, unit: x.unit, missionNumber: x.num,
            missionType: str(x.m.mission_type) ? String(x.m.mission_type).trim().toUpperCase() : null,
            count: x.ac.count, aircraftType: x.ac.type, callsign: x.callsign };
        });
      }

      // Tanker's own mission: REFTSK + 5REFUEL
      var refuelTask = null, refuelRows = null;
      tankerList.forEach(function (e) {
        if (refuelTask || tankerMission[e.key] !== inf) return;
        var t = e.item;
        var sys = arSystem(t.system, 'registry.tankers.' + e.key + '.system');
        refuelTask = {
          system: sys,
          totalOffloadKlb: !isBlank(t.offload_klb) && isFinite(Number(t.offload_klb)) ? Number(t.offload_klb) : null,
          alertOffloadKlb: !isBlank(t.alert_offload_klb) && isFinite(Number(t.alert_offload_klb)) ? Number(t.alert_offload_klb) : null,
          primary: freqOf(t.freq_mhz),
          secondary: freqOf(t.secondary_freq_mhz),
          tacan: tacanOf(t.tacan, 'registry.tankers.' + e.key + '.tacan', mn),
        };
        var rows = [];
        infos.forEach(function (rx) {
          rx.refuels.forEach(function (rf) {
            if (rf.te.key !== e.key) return;
            rows.push({ rx: rx, rf: rf });
          });
        });
        rows.sort(function (a, b) {
          var ta = a.rf.arct ? Date.UTC(a.rf.arct.year, a.rf.arct.month - 1, a.rf.arct.day, a.rf.arct.hour, a.rf.arct.minute) : Infinity;
          var tb = b.rf.arct ? Date.UTC(b.rf.arct.year, b.rf.arct.month - 1, b.rf.arct.day, b.rf.arct.hour, b.rf.arct.minute) : Infinity;
          return ta === tb ? (a.rx.i - b.rx.i) || (a.rf.ri - b.rf.ri) : ta - tb;
        });
        refuelRows = rows.map(function (x, k) {
          var off = x.rf.r.offload_klb;
          return {
            missionNumber: x.rx.num, callsign: x.rx.callsign, count: x.rx.ac.count, aircraftType: x.rx.ac.type,
            offloadKlb: !isBlank(off) && isFinite(Number(off)) ? Number(off) : null,
            arct: x.rf.arct, sequence: k + 1, fuelType: str(t.fuel) ? String(t.fuel).trim().toUpperCase() : null,
            system: sys,
          };
        });
        if (!refuelRows.length) refuelRows = null;
      });

      // Controlling agency's own mission: 7CONTROL
      var controlRows = null;
      Object.keys(agencyMission).forEach(function (k) {
        if (controlRows || agencyMission[k] !== inf) return;
        var rows = infos.filter(function (x) { return x.agencyKey === k && x !== inf; }).map(function (x) {
          var xc = obj(x.m.control) || {};
          var xp = 'ato.missions[' + x.i + ']';
          var tosta = !isBlank(xc.check_in_time) ? at(xc.check_in_time, xp + '.control.check_in_time', x.num)
            : (firstTos(x) ? at(firstTos(x), xp + '.targets.tos', x.num) : null);
          return { missionNumber: x.num, callsign: x.callsign, count: x.ac.count, aircraftType: x.ac.type,
            missionType: str(x.m.mission_type) ? String(x.m.mission_type).trim().toUpperCase() : null,
            onStation: tosta, reportInPoint: str(xc.report_in_point) };
        });
        controlRows = rows.length ? rows : null;
      });

      var narrative = [];
      if (Array.isArray(m.narrative)) m.narrative.forEach(function (n) { if (!isBlank(n)) narrative.push(String(n)); });
      else if (!isBlank(m.narrative)) narrative.push(String(m.narrative));

      // Gap infos (aggregated per export)
      if (!inf.packageId) W.gap('PACKAGE_DATA_MISSING', inf.label, 'No package id (M2)');
      if (inf.iff.modeOne == null || inf.iff.modeTwo == null) W.gap('IFF_MODE12_MISSING', inf.label, 'No Mode 1/2 (M4)');
      if (inf.iff.modeThree == null) W.gap('IFF_MODE3_MISSING', inf.label, 'No Mode 3 (mission iff.mode3 or SPINS C3)');
      var d0 = aircraft[0].datalink;
      if (d0.l16Callsign == null && d0.tacan == null && d0.ju == null) W.gap('DATALINK_MISSING', inf.label, 'No datalink (M5)');
      if (isBlank(m.alert_status)) W.gap('ALERT_STATUS_MISSING', inf.label, 'No alert status (M16)');
      if (control && !control.reportInPoint) W.gap('RIP_MISSING', inf.label, 'No report-in point');
      var hasVul = location.kind === 'GTGTLOC'
        ? location.targets.some(function (t) { return t.net || t.nlt || t.tot; })
        : !!(location.start || location.stop);
      if (!hasVul) W.gap('VUL_MISSING', inf.label, 'No vul window (M6)');
      if (arInfo.some(function (a) {
        return a.tankerMissionNumber == null || a.tankerModeThree == null || a.arcp == null || a.offloadKlb == null || a.system == null;
      })) W.gap('AR_DETAIL_MISSING', inf.label, 'AR detail missing: tanker mission/IFF, ARCP, offload or system (M12)');

      return {
        missionNumber: mn,
        amcMissionNumber: null,
        packageId: inf.packageId,
        isPackageCommander: isCmdr,
        missionType: { primary: str(m.mission_type) ? String(m.mission_type).trim().toUpperCase() : null, secondary: null },
        alertStatus: str(m.alert_status) ? String(m.alert_status).trim().toUpperCase() : null,
        departure: { location: str(m.deploy), time: at(m.takeoff_time, P + '.takeoff_time', mn) },
        recovery: { location: str(m.recovery), time: at(m.recovery_time, P + '.recovery_time', mn) },
        aircraft: aircraft,
        location: location,
        control: control,
        arInfo: arInfo,
        packageCommander: packageCommander,
        packageData: packageData,
        refuelTask: refuelTask,
        refuelRows: refuelRows,
        controlRows: controlRows,
        narrative: narrative,
      };
    });

    var supportList = Object.keys(supportRefs).map(function (k) { return supportRefs[k]; });
    if (supportList.length) {
      supportList.forEach(function (s) {
        W.gap('SUPPORT_MISSIONS_NOT_EXPORTED', s,
          'Referenced tankers/agencies with no linked mission (set registry mission_number to export theirs)');
      });
    }

    // Units, in order of first appearance
    var units = [];
    var unitIdx = {};
    var defaulted = [];
    infos.forEach(function (inf, k) {
      if (inf.defaultUnit) defaulted.push(inf.label);
      var u = unitIdx[inf.unit];
      if (!u) {
        var ur = obj(unitReg[inf.unit]) || {};
        var icao = str(ur.base);
        if (!icao) {
          var dep = str(inf.m.deploy);
          icao = dep && obj(airfields[dep]) ? dep : null;
        }
        u = unitIdx[inf.unit] = { name: inf.unit, icao: icao, remarks: str(ur.remarks), missions: [] };
        units.push(u);
      }
      u.missions.push(docMissions[k]);
    });
    if (defaulted.length) {
      W.warn('DEFAULT_UNIT', 'Missions with no unit are tasked to "' + (str(usm.default_unit) || def.unit) + '": ' + defaulted.join(', '));
    }

    var doc = {
      classification: 'UNCLAS',
      messageKind: kind,
      operation: operation,
      msgid: {
        originator: str(usm.originator) || def.originator,
        serial: str(usm.serial),
        month: MONTHS[from.month - 1],
      },
      timeframe: { from: from, to: to, asof: asof },
      generalText: generalText,
      country: str(usm.country) || def.country,
      service: str(usm.service) || def.service,
      units: units,
    };
    return { doc: doc, warnings: W.done(), errors: errors };
  }

  function buildUsmtf(pkg, opts) {
    var mapped = atobriefToAtoDoc(pkg, opts);
    if (mapped.errors.length) return { text: null, doc: null, warnings: mapped.warnings, errors: mapped.errors };
    var r = renderUsmtf(mapped.doc);
    return { text: r.text, doc: mapped.doc, warnings: mapped.warnings.concat(r.warnings), errors: [] };
  }

  function packageToUsmtf(pkg, opts) {
    var r = buildUsmtf(pkg, opts);
    if (r.errors.length) {
      var e = new Error('USMTF export refused: ' + r.errors.map(function (x) { return x.code; }).join(', '));
      e.errors = r.errors;
      e.warnings = r.warnings;
      throw e;
    }
    return r.text;
  }

  // '<operation>_<ato_date>.usmtf.txt', restricted to [A-Za-z0-9._-].
  function usmtfFileName(pkg) {
    var h = (pkg && obj(pkg.header)) || {};
    var a = (pkg && obj(pkg.ato)) || {};
    var op = str(h.operation) || str(a.operation) || 'ATO';
    var d = parseIsoDate(h.ato_date) || parseIsoDate(a.ato_day);
    var ds = d ? pad(d.year, 4) + '-' + pad(d.month, 2) + '-' + pad(d.day, 2) : 'undated';
    return (op + '_' + ds).replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '') + '.usmtf.txt';
  }

  return {
    DEFAULTS: DEFAULTS,
    AGENCY_TYPE_MAP: AGENCY_TYPE_MAP,
    atobriefToAtoDoc: atobriefToAtoDoc,
    renderUsmtf: renderUsmtf,
    buildUsmtf: buildUsmtf,
    packageToUsmtf: packageToUsmtf,
    usmtfFileName: usmtfFileName,
    _internal: {
      formatDtg: formatDtg, addMinutes: addMinutes, parseHhmm: parseHhmm, placeTime: placeTime,
      parseIsoDate: parseIsoDate, parseCoord: parseCoord, formatLatLon: formatLatLon,
      dmsToUsmtf: dmsToUsmtf, sanitiseField: sanitiseField, iffToken: iffToken,
      formatFreq: formatFreq, formatAltitude: formatAltitude, formatOffload: formatOffload,
      wrapLinearSet: wrapLinearSet, wrapFreeText: wrapFreeText, layoutColumnar: layoutColumnar,
      callsignSeedable: callsignSeedable, normaliseCallsign: normaliseCallsign, Warnings: Warnings,
    },
  };
}));
