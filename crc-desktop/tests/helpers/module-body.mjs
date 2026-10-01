/* The body of a hand-copied module, with its export syntax removed (ESM-1, questioner W1-T-7).
 *
 * The client copy of a server file (time-chains.js) is an ES module that exports with the `export` keyword; the
 * crc-sync original ends in a guarded CommonJS `module.exports` block. The byte-for-byte parity tests on both sides
 * compare moduleBody(a) with moduleBody(b): the export syntax is the one difference allowed. */

export function moduleBody(src) {
  return src
    .replace(/^export (?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '')
    .replace(/\n*if \(typeof module !== 'undefined' && module\.exports\) \{\n[\s\S]*?\n\}\n*$/, '\n')
    .replace(/\n*$/, '\n');
}

/** The names a module exports with `export function|const|let|var|class NAME`, sorted. */
export function exportedNames(src) {
  return [...src.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]).sort();
}
