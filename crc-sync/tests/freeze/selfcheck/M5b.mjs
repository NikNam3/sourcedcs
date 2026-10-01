// freeze:selfcheck mutation M5b. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M5b`.
export default {
  id: "M5b",
  what: "frame order: ws-hub sends the MARSA delta before the primary delta",
  file: "src/ws-hub.js",
  find: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);",
  replace: "        if (result.marsaBroadcast) this._broadcastEfsp(result.marsaBroadcast);",
  detect: ["freeze-hub"],
  also: { find: "        if (result.marsaBroadcast) this._broadcastEfsp(result.marsaBroadcast);\n        // docs/adr/0074", replace: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);\n        // docs/adr/0074" },
};
