// freeze:selfcheck mutation M12. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M12`.
export default {
  id: "M12",
  what: "a permission table row: HELD is also CTR's to act on",
  file: "src/efsp/permission.js",
  find: "  HELD:              ['CD', 'GND'],",
  replace: "  HELD:              ['CD', 'GND', 'CTR'],",
  detect: ["freeze-tables","freeze-table"],
};
