// freeze:selfcheck mutation M9. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M9`.
export default {
  id: "M9",
  what: "the persisted body's key order: two registry entries swapped (flightData before boards)",
  file: "src/efsp/stores.js",
  find: "module.exports = { REGISTRY, RESTORE_ORDER };",
  replace: "[REGISTRY[0], REGISTRY[1]] = [REGISTRY[1], REGISTRY[0]];\nmodule.exports = { REGISTRY, RESTORE_ORDER };",
  detect: ["freeze-hub"],
};
