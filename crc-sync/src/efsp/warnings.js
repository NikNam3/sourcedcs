'use strict';

// The warnings an op's result carries (docs/wip/SERVER-BUGS.md, B4). A warning accepts the Mutation and says something
// worth reading; a result holds `warnings: [{ code, detail? }]` and the mutation ack sends the list as it is. `code` is
// what a client keys its wording on, `detail` the server's own sentence for the cases that have one.

/** One warning. */
function warn(code, detail) {
  return detail === undefined ? { code } : { code, detail };
}

/** A store's single-code `warning` (the beacon allocator's) as a list, or undefined when it has none. */
function fromCode(code) {
  return code ? [warn(code)] : undefined;
}

module.exports = { warn, fromCode };
