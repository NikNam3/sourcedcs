'use strict';
// Semantic view of a USMTF message, for comparing two layouts of the same
// content (research §1.2 / L3 §5.3 rule 5):
//   - the first line is the classification;
//   - a linear set is un-wrapped (each newline and the whitespace after it is
//     deleted) and becomes { set, fields[] };
//   - a columnar set (name starts with a digit) becomes
//     { set, header[], rows[][] }, every cell trimEnd()ed.

function splitRow(line) {
  return line.replace(/\/\/$/, '').replace(/^\//, '').split('/').map((c) => c.trimEnd());
}

function normaliseUsmtf(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  const out = { classification: lines[0], sets: [] };
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    const col = /^(\d[A-Z0-9]+)\/?$/.exec(line);
    if (col) {
      const header = splitRow(lines[i + 1]);
      const rows = [];
      i += 2;
      while (i < lines.length) {
        const l = lines[i];
        rows.push(splitRow(l));
        i++;
        if (l.endsWith('//')) break;
      }
      out.sets.push({ set: col[1], header, rows });
      continue;
    }
    let logical = line;
    i++;
    while (!logical.endsWith('//') && i < lines.length) {
      logical += lines[i].replace(/^\s+/, '');
      i++;
    }
    const fields = logical.slice(0, -2).split('/');
    out.sets.push({ set: fields.shift(), fields });
  }
  return out;
}

// The un-wrapped logical strings of a message, one per set (columnar sets
// joined with '\n'). Handy for "this exact set is present" assertions.
function logicalSets(text) {
  return normaliseUsmtf(text).sets.map((s) => (s.fields
    ? s.set + '/' + s.fields.join('/') + '//'
    : s.set));
}

module.exports = { normaliseUsmtf, logicalSets };
