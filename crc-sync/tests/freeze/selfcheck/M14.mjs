// freeze:selfcheck mutation M14 (retargeted from freeze guard 3 to tests/clock-policy.test.mjs, R0 step 6). A lane that moves the code this targets retargets THIS file only (file/find/replace),
// then re-proves it with `npm run freeze:selfcheck M14`.
export default {
  id: "M14",
  what: "a new Date.now() site in nla.js",
  file: "src/efsp/nla.js",
  find: "module.exports = {",
  replace: "const _freezeProbe = () => Date.now();\nmodule.exports = {",
  detect: ["clock-policy"],
};
