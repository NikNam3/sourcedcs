# ESM-1Ta: partition a tests as ES modules

Files (crc-desktop/tests, all `.test.mjs` now): client-mirror-parity, ws-message-contract, bay-descriptor-parity,
efsp-block-map-parity, efsp-nla-client, efsp-coordination-client, efsp-ui-reachability, efsp-strip-template,
efsp-time-chains, overflight-shared-state-names; helper `helpers/mirror-source.mjs` (only partition a uses it).

Counts (before at 165a517 -> after): 18->18, 8->8, 3->3, 10->10, 28->28, 13->13, 138->138, 72->72, 17->17, 2->2.

Notes
- crc-sync CommonJS stays required through `createRequire`; text scans (`constLiteral`) accept `export const`.
- efsp-coordination-client reads bay-view.js constants (COORDINATION_TARGETS etc.) with `constLiteral` instead of a vm run.
- efsp-strip-template: the stereo cache is filled through the real `listStereoRoutesClient` (fake fetchImpl); `getEfspFdr`
  through `applyEfspSnapshot` + `_resetEfspStateForTest`.
- efsp-ui-reachability: `renderStrip`/`renderAirspaceBoard` are async (a fresh module graph per render via
  fresh-graph.mjs); `sandbox` is a Proxy over that generation's module namespaces; senders through `setEfspSender`,
  held Positions through the real `sendEfspSetPositions`, `renderAllOpenEfspBays` and the refusal through test setters.
  Slower than the vm version (about 100 s for the file).
- time-chains byte compare uses helpers/module-body.mjs.
- WIRE's edits (3bc1c73) are ported into ws-message-contract and overflight-shared-state-names. Both need WIRE's crc-sync
  files (`efsp/wire/**`), which this branch lacks, so they fail here and pass on the merged unit.
