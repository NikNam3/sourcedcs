// freeze:selfcheck mutation M10. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M10`.
export default {
  id: "M10",
  what: "a rule dropped from createEfsp()'s per-Facility wiring (liveStripsForFdr)",
  file: "src/efsp/index.js",
  find: "      liveStripsForFdr: (fdrId, excludeStripId) => {",
  replace: "      _notWired_liveStripsForFdr: (fdrId, excludeStripId) => {",
  detect: ["freeze-guards"],
};
