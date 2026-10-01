// freeze:selfcheck mutation M2. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M2`.
export default {
  id: "M2",
  what: "a state transition: ConvertToArrival lands in HANDED_TO_TOWER, not INBOUND",
  file: "src/efsp/board-store.js",
  find: "    strip.state = 'INBOUND';",
  replace: "    strip.state = 'HANDED_TO_TOWER';",
  detect: ["freeze-table","freeze-scenarios","freeze-hub"],
};
