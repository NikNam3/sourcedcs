// freeze:selfcheck mutation M5b. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M5b`.
// Caught by the hub-peer-marsa-order trace: one Mutation yields a peer delta and a MARSA delta (R0 step 1).
export default {
  id: "M5b",
  what: "frame order: the skeleton sends the MARSA delta before the primary delta",
  file: "src/efsp/wire/slots.js",
  find: "const SLOT_ORDER = ['primary', 'peer', 'marsa', 'carrier', 'sfa'];",
  replace: "const SLOT_ORDER = ['marsa', 'peer', 'primary', 'carrier', 'sfa'];",
  detect: ["freeze-hub"],
};
