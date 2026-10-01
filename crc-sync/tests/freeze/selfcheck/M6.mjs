// freeze:selfcheck mutation M6. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M6`.
export default {
  id: "M6",
  what: "a refusal detail string",
  file: "src/efsp/board-store.js",
  find: "detail: `no such Bay here: ${bayId}`",
  replace: "detail: `no such bay: ${bayId}`",
  detect: ["freeze-table","freeze-scenarios","freeze-hub"],
};
