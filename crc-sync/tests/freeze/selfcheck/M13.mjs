// freeze:selfcheck mutation M13. A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M13`.
export default {
  id: "M13",
  what: "the wire dispatch loses efsp-resync",
  file: "src/efsp/efsp-ws.js",
  find: "    case 'efsp-resync':        return _handleResync(ctx, session, msg);\n",
  replace: "",
  detect: ["freeze-tables","freeze-hub"],
};
