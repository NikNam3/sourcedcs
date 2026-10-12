// freeze:selfcheck mutation M17. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M17`.
// Caught by the hub-peer-marsa-order trace: one Mutation yields a peer delta and a MARSA delta (R0 step 1).
export default {
  id: "M17",
  what: "frame order: the skeleton sends the MARSA delta before the peer delta",
  file: "src/efsp/wire/slots.js",
  find: "const SLOT_ORDER = ['primary', 'peer', 'marsa', 'carrier'];",
  replace: "const SLOT_ORDER = ['primary', 'marsa', 'peer', 'carrier'];",
  detect: ["freeze-hub"],
};
