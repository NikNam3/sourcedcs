// freeze:selfcheck mutation M17. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M17`.
// Caught by the hub-peer-marsa-order trace: one Mutation yields a peer delta and a MARSA delta (R0 step 1).
export default {
  id: "M17",
  what: "frame order: ws-hub sends the MARSA delta before the peer delta",
  file: "src/ws-hub.js",
  find: "        if (result.peerBroadcast) this._broadcastEfsp(result.peerBroadcast);\n        // WP6 (docs/adr/0051)",
  replace: "        if (result.marsaBroadcast) this._broadcastEfsp(result.marsaBroadcast);\n        // WP6 (docs/adr/0051)",
  detect: ["freeze-hub"],
  also: { find: "        if (result.marsaBroadcast) this._broadcastEfsp(result.marsaBroadcast);\n        // docs/adr/0074", replace: "        if (result.peerBroadcast) this._broadcastEfsp(result.peerBroadcast);\n        // docs/adr/0074" },
};
