// freeze:selfcheck mutation M16. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M16`.
export default {
  id: "M16",
  what: "the allocator hands out a different first beacon code",
  file: "src/efsp/fdr-store.js",
  find: "const fdrId = crypto.randomUUID();",
  replace: "const fdrId = crypto.randomUUID(); crypto.randomUUID();",
  detect: ["freeze-hub","freeze-table","freeze-scenarios"],
};
