// freeze:selfcheck mutation M8. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M8`.
export default {
  id: "M8",
  what: "the persisted replay window set to 0",
  file: "src/efsp/board-store.js",
  find: "const REPLAY_PERSIST_WINDOW_MS = 10 * 60 * 1000;",
  replace: "const REPLAY_PERSIST_WINDOW_MS = 0;",
  detect: ["freeze-hub","freeze-scenarios"],
};
