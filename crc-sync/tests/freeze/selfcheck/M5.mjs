// freeze:selfcheck mutation M5. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M5`.
export default {
  id: "M5",
  what: "frame order: ws-hub sends the peer delta before the primary delta",
  file: "src/ws-hub.js",
  find: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);",
  replace: "        if (result.peerBroadcast) this._broadcastEfsp(result.peerBroadcast);",
  detect: ["freeze-hub"],
  also: { find: "        if (result.peerBroadcast) this._broadcastEfsp(result.peerBroadcast);\n        // WP6 (docs/adr/0051)", replace: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);\n        // WP6 (docs/adr/0051)" },
};
