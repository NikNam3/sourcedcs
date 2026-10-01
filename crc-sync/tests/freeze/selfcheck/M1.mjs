// freeze:selfcheck mutation M1. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M1`.
export default {
  id: "M1",
  what: "an ack reason: NOT_OWNER -> NOT_YOURS",
  file: "src/efsp/board-store.js",
  find: "reason: 'NOT_OWNER', detail: `${strip.ownerPositionId} holds this Strip`",
  replace: "reason: 'NOT_YOURS', detail: `${strip.ownerPositionId} holds this Strip`",
  detect: ["freeze-table","freeze-scenarios","freeze-hub"],
};
