// freeze:selfcheck mutation M16. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M16`.
export default {
  id: "M16",
  what: "the allocator hands out a different first beacon code",
  file: "src/efsp/flight-data-store.js",
  find: "const flightDataId = crypto.randomUUID();\n    const now = this._clock.now();\n    const equipmentCodes",
  replace: "const flightDataId = crypto.randomUUID(); crypto.randomUUID();\n    const now = this._clock.now();\n    const equipmentCodes",
  detect: ["freeze-hub","freeze-table","freeze-scenarios"],
};
