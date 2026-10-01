// freeze:selfcheck mutation M3. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M3`.
export default {
  id: "M3",
  what: "an audit field: actorId dropped from the Mutation-log entry",
  file: "src/efsp/board/audit.js",
  find: "      actorId: by || null,\n      at: this._clock.now(),\n      before,",
  replace: "      actorId: null,\n      at: this._clock.now(),\n      before,",
  detect: ["freeze-table","freeze-scenarios","freeze-hub"],
};
