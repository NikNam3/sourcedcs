// freeze:selfcheck mutation M4. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M4`.
// BOARD-1: SetFlag's four lines became `this._state.bump(strip, by)`; the mutation writes the bump back out inline
// without its touch, so it is still "SetFlag changes the Strip but does not touch it" and nothing else.
export default {
  id: "M4",
  what: "a missing _touch in SetFlag (the Strip is not in the next delta)",
  file: "src/efsp/board-store.js",
  find: "    strip.flags[op.flag] = op.value;\n    this._state.bump(strip, by);\n",
  replace: "    strip.flags[op.flag] = op.value;\n    strip.rev += 1;\n    strip.updatedAt = this._clock.now();\n    strip.updatedBy = by || null;\n",
  detect: ["freeze-table","freeze-scenarios","freeze-hub"],
};
