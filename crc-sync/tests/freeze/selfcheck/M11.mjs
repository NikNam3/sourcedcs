// freeze:selfcheck mutation M11. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M11`.
export default {
  id: "M11",
  what: "the order-key rebalance threshold 40 -> 400",
  file: "src/efsp/order-key.js",
  find: "const REBALANCE_KEY_LENGTH = 40;",
  replace: "const REBALANCE_KEY_LENGTH = 400;",
  detect: ["freeze-hub"],
};
