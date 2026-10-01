// freeze:selfcheck mutation M15. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M15`.
export default {
  id: "M15",
  what: "a Board method outside code uses is renamed (getDeltaSince)",
  file: "src/efsp/board-store.js",
  find: "  getDeltaSince(",
  replace: "  getDeltaSinceRenamed(",
  detect: ["freeze-guards","freeze-hub","freeze-scenarios"],
};
