'use strict';
// Regenerates test/fixtures/usmtf/ojw1v5-trimmed.yaml from the squadron's
// reference package (decision H16). The source file is outside the repo and
// carries real callsigns; only this trimmed, anonymised copy is committed.
//
//   node test/helpers/trim-ojw1v5.js /home/nklx/Downloads/ojw1v5.yaml
//
// The recipe is spelled out in docs/wip/L11.md. After running it, grep the
// output for RMBLE, PRCVL, LNCLT, RCKET and VMRS: there must be no hit.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const RENAME = { RMBLE31: 'FALCN31', PRCVL11: 'HORNT11', LNCLT21: 'BLADE21' };
const UNIT_RENAME = { '78th VMRS': 'TEST SQN' };
const MAX_AIM_POINTS = 2;

function main(src) {
  const pkg = yaml.load(fs.readFileSync(src, 'utf8'));
  const out = {};

  // ato first, as the editor saves it (runtime shape)
  const ato = pkg.ato;
  delete ato.irl_date;
  delete ato.irl_time_zulu;
  const usedTargets = new Set();
  ato.missions.forEach((m) => {
    if (RENAME[m.callsign]) m.callsign = RENAME[m.callsign];
    if (m.unit && UNIT_RENAME[m.unit]) m.unit = UNIT_RENAME[m.unit];
    delete m.dtc_cartridge;
    (m.targets || []).forEach((t) => {
      usedTargets.add(t.target_id);
      if (Array.isArray(t.aim_points)) t.aim_points = t.aim_points.slice(0, MAX_AIM_POINTS);
    });
    // Keep the marshal ref, one orbit point and one plain point.
    const sps = m.steer_points || [];
    const ref = sps.find((s) => s.id);
    const orbit = sps.find((s) => s.orbit);
    const plain = sps.find((s) => !s.id && !s.orbit);
    m.steer_points = [plain, ref, orbit].filter(Boolean);
  });
  ato.targets = (ato.targets || [])
    .filter((t) => usedTargets.has(t.id))
    .map((t) => ({ ...t, aim_points: (t.aim_points || []).slice(0, MAX_AIM_POINTS) }));
  out.ato = ato;

  // spins: only the C3 table
  out.spins = {
    version: pkg.spins.version,
    sections: pkg.spins.sections.filter((s) => /\bc3\b|iff\b/i.test(s.title || '') && s.table),
    operation: pkg.spins.operation,
    classification: pkg.spins.classification,
  };

  out.schema_version = pkg.schema_version;
  out.header = pkg.header;

  const r = pkg.registry;
  const callsigns = {};
  Object.keys(r.callsigns).forEach((k) => {
    const keepTanker = r.tankers && Object.values(r.tankers).some((t) => t.callsign === k);
    if (keepTanker) callsigns[k] = r.callsigns[k];
    else if (RENAME[k]) callsigns[RENAME[k]] = r.callsigns[k];
  });
  const targets = {};
  Object.keys(r.targets).forEach((k) => {
    if (!usedTargets.has(k)) return;
    targets[k] = { ...r.targets[k], aim_points: (r.targets[k].aim_points || []).slice(0, MAX_AIM_POINTS) };
  });
  out.registry = {
    callsigns,
    airfields: { LTAG: r.airfields.LTAG },
    carriers: r.carriers,
    tankers: r.tankers,
    targets,
    steerpoints: r.steerpoints,
    control_agencies: r.control_agencies,
  };

  const text = yaml.dump(out, { lineWidth: -1, noRefs: true, sortKeys: false });
  const dst = path.join(__dirname, '..', 'fixtures', 'usmtf', 'ojw1v5-trimmed.yaml');
  fs.writeFileSync(dst, '# Trimmed, anonymised copy of the squadron reference ATO ojw1v5.yaml (decision H16).\n' +
    '# Regenerate with test/helpers/trim-ojw1v5.js; recipe in docs/wip/L11.md.\n' + text);
  const bad = /RMBLE|PRCVL|LNCLT|RCKET|VMRS/.exec(text);
  if (bad) throw new Error('Anonymisation failed: found ' + bad[0]);
  console.log('wrote', dst);
}

main(process.argv[2] || '/home/nklx/Downloads/ojw1v5.yaml');
