// freeze:selfcheck mutation M4. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M4`.
export default {
  id: "M4",
  what: "a missing _touch in SetFlag (the Strip is not in the next delta)",
  file: "src/efsp/board-store.js",
  find: "    strip.flags[op.flag] = op.value;\n    strip.rev += 1;\n    strip.updatedAt = this._clock.now();\n    strip.updatedBy = by || null;\n    this._touch(strip.stripId);\n",
  replace: "    strip.flags[op.flag] = op.value;\n    strip.rev += 1;\n    strip.updatedAt = this._clock.now();\n    strip.updatedBy = by || null;\n",
  detect: ["freeze-table","freeze-scenarios","freeze-hub"],
};
