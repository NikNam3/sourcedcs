# Architecture check (H103): combined fix plan

Sources: `docs/wip/ARCH-S.md` (crc-sync), `docs/wip/ARCH-W.md` (web, infra, seams, tests), `docs/wip/ARCH-C.md`
(crc-desktop). State checked on `efsp-wp5-correlation` after every post-refactor feature merged: crc-sync 2403/2403,
freeze 48/48, crc-desktop 1108/1108, sourcedcs-web 141/141, full Playwright 184/184. Nothing here is fixed yet; the
human approves the plan first (desk round AC).

## Real bugs (15)

| # | Bug | Where | Size | Phase-1 lane |
|---|---|---|---|---|
| B1 | A reconnect silently signs the controller off everywhere; the client never re-declares its Positions | crc-sync `ws-hub.js:579`, client `efsp-ws.js:103`, `efsp-messages.js:137` | M | DESK-SIGNON |
| B2 | A control repair at sign-on/off is never persisted (`.length` read on a number); cross-Facility repair not broadcast | `efsp-ws.js:377` (verified by the supervisor) | S | SERVER-BUGS |
| B3 | An exception inside an op leaves partial writes broadcast but never audited or persisted; replay cache stores the refusal | `board-store.js:260` | M | SERVER-BUGS |
| B4 | The single `warning` field: LUAW-combined overwrites an op's own warning | `efsp-ws.js:103` | S | SERVER-BUGS (+ DESK-ACKS) |
| B5 | The runway-status delta skips the read-scope filter | `ws-hub.js` broadcast paths | S | SERVER-BUGS |
| B6 | The system TOFI entry bumps an unchanged Strip's rev (possible STALE_REV refusals) | `board/tofi.js` | S | SERVER-BUGS |
| B7 | Strip chips go stale while a Bay is open (SCRAMBLE on others' traffic, the TOFI regime chip) | `bay-view.js:532-612` | S | DESK-RENDER |
| B8 | The SRS push-to-talk can stick open (keyup lost in inputs or after alt-tab) | `srs-radio.js:418` | S | DESK-RENDER |
| B9 | The Undo button is rebuilt every 250 ms and loses clicks; typed airspace Delay note lost on any update | `undo-slot.js:144`, `airspace-panel.js:410` | S | DESK-RENDER |
| B10 | sourcedcs-web voice-history and activity-score files written non-atomically; a corrupt file reads as empty and is overwritten | sourcedcs-web | S | WEB-DATA |
| B11 | The web airspace admin disagrees with crc-desktop/crc-sync (DM without hemisphere letters, lower == upper, unchecked booking altitudes) | sourcedcs-web | S | WEB-DATA |
| B12 | The "Update required" download link is dead (external-link gate allows only the booking origin) | crc-desktop `main.js` | S | DESK-LINKS |
| B13 | Casdoor popup after a runtime endpoint change | crc-desktop main/preload | S | DESK-LINKS |
| B14 | The deploy gate reads the protocol from source but deploys mutable `:latest`; fails open when sourcedcs.page is unreachable | `.github/workflows/deploy.yml` | M | DEPLOY-GATE-2 |
| B15 | A missing service token looks like an outage (401 web vs 503 crc-sync; the booking pull folds both) | both services | S | SEAMS |

Security, for the human (auth is out of scope by standing rule, so this is a decision): crc-desktop's local
`POST /api/sync-config` accepts any caller, so any web page open on the machine can repoint crc-desktop at another
crc-sync or Casdoor (localhost CSRF).

## Phases

**Phase 1: bugs (3 lanes at a time).** SERVER-BUGS (B2-B6), DESK-SIGNON (B1 + the e2e helper that waits on the
client's own claim), DESK-RENDER (B7-B9); then WEB-DATA (B10, B11 + a parser parity test), DESK-LINKS (B12, B13, and
the CSRF fix if approved), DEPLOY-GATE-2 (B14 + a gate test table + RUNBOOK).

**Phase 2: tests and tooling.** TMP-HYGIENE (one `TMPDIR` line per preload; split the 23 s exhaustive walk),
E2E-STAB (the 450 ms sleeps against the 400 ms guard go through an injected clock, fewer `waitForTimeout`s, per-test
board reset, an e2e-boot unit test that would have caught `371bedde`), FREEZE-GRAIN (per-trace id namespaces and
per-record digests so one new uuid call stops rewriting 44 goldens).

**Phase 3: structure.** SERVER-SEAMS (inject the six `Date.now()` sites, config read at start not require time, one
delta builder per family and one broadcast path, shared store bookkeeping, split `createApp`), DESK-ACKS (one
`send(msg, {onAck})`, structured warnings and attestation instead of regex on prose, the five raw refusal codes),
DESK-SYNC (one sync cursor for Boards and stores), DESK-GRAPH (break the 59-module import cycle, end `window` globals
in production and `bay-view`'s 50 re-exports), SEAMS (one service-token helper, env naming), DESK-TIDY (topology
module, parity tests for four client rule tables, dead exports, CSS naming, real-server airspace e2e).

## Holding up well

The Board seam test, the registries, the clock allow-list, strict EFSP state, the vocabulary in identifiers,
`board-store.js` still a 445-line facade, sourcedcs-web `server.js` at 244 lines, most client mirrors under parity
tests, no ASACS variable read anywhere.
