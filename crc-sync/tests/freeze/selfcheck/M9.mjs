// freeze:selfcheck mutation M9. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M9`.
export default {
  id: "M9",
  what: "the persisted body's key order: fdr before boards",
  file: "src/efsp/index.js",
  find: "      boards,\n      fdr: fdrStore.snapshot(),",
  replace: "      fdr: fdrStore.snapshot(),\n      boards,",
  detect: ["freeze-hub"],
};
