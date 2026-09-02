# 0001 — JSON wire format for EFSP, not protobuf

## Context

`EFSPImplementationGuide.md` §5.1 mandates protobuf for all EFSP messages, defined once in `proto/efsp/v1/`, with WebSocket frames protobuf-encoded (a JSON-encoded protobuf mode permitted only behind a development flag).

crc-sync's existing browser-facing WebSocket feed (`src/ws-hub.js`) is plain JSON with a versioned envelope (`{version, type, ...}`) and an already-working monotonic-sequence, snapshot/delta resync mechanism (`src/tracks.js`, `src/collab-store.js`). crc-desktop's renderer has no build step at all — every panel is a plain `<script>` tag sharing global scope (`app/public/js/panels/*.js`), loaded by `app/server.js`, a local Express static server. Neither side of this connection has ever used protobuf; crc-sync's only protobuf usage is DCS-gRPC (service-to-service telemetry ingest), unrelated to the browser leg.

## Decision

EFSP messages are plain JSON over the existing `/feed` WebSocket, following crc-sync's established envelope/sequence/snapshot-delta pattern exactly (see `src/efsp/board-store.js`, `src/efsp/efsp-ws.js`). No `.proto` files, no codegen step, no protobuf runtime added to the browser.

## Alternatives considered

- **Protobuf over WebSocket, as specified.** Rejected: no existing gRPc-Web or browser-protobuf code to build on, and it requires introducing a compiled-artifact build step into a renderer that has deliberately stayed build-step-free.
- **JSON-encoded protobuf (the guide's permitted dev-mode).** Rejected as unnecessary complexity: since JSON is the *permanent* choice here, not a debug fallback, there's no reason to also carry `.proto` schema files that nothing ever compiles from.

## Consequences

- No compiler-enforced cross-language contract between crc-sync (Node/CommonJS) and crc-desktop (browser JS). Schema drift between the two is a real risk, mitigated only by a shared binding-table fixture used by both sides' test suites (`src/efsp/block-map.js` server-side, `app/public/js/panels/efsp/strip-template.js` client-side) — not a compiled guarantee.
- Message shapes are documented in code comments (`efsp-ws.js`) rather than a `.proto` file; any future move to protobuf would mean re-deriving the schema, not just adding a compile step.
- Consistent with every other message type crc-sync already sends (`squawk-map`, `theater-settings`, `apt-config`, `delta`) — no special-case transport for EFSP.
