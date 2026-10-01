// freeze:selfcheck mutation M7. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M7`.
export default {
  id: "M7",
  what: "causedBy dropped from a peer-write audit entry",
  file: "src/efsp/board/audit.js",
  find: "clientMutationId: null, causedBy: causedBy || null, op,",
  replace: "clientMutationId: null, op,",
  detect: ["freeze-scenarios","freeze-hub"],
};
