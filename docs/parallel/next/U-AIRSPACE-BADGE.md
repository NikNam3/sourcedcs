# Briefing: U-AIRSPACE-BADGE (server + client): the Strip's airspace badge is amber only inside an unactivated block

Written 2026-10-21 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-AIRSPACE-BADGE`, branch `lane/U-AIRSPACE-BADGE`, `E2E_LANE=7`). **Commit at every
green step, at least every ~15 minutes.** ADR number **0134** (yours; P4: ADR 0119 is never edited, yours supersedes
only its badge colour rule).

Running beside you: **U-TERRAIN-DCS** (`crc-sync/src/terrain.js`, `coverage.js`, `grpc-client.js` Eval, theaters,
client `elevation.js`/`los.js`/`map-setup.js`), **U-ROLE-POSITIONS** (ADR 0132: `authority/`, `position-store.js`,
`facility-config.js`, every `DEFAULT_FACILITY_ID` user, client sends). Stay out of their files; if you must touch a
function that names a Facility or Position, keep the hunk minimal and say so in your report.

## Why

**H155 item 4** (read it in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`): today the Strip's
airspace badge (`crc-desktop/app/public/js/panels/efsp/strip-indicators.js` ~l.49–61) is amber whenever the Strip's
approved airspace (`strip.airspaceEntry.airspaceId`) is not ACTIVE, so a parked aircraft approved early shows amber.
Ruling: **amber only while the flight is inside its approved airspace and that airspace is not ACTIVE; grey otherwise**
(on the ground, en route, approved early). Why: activation decides who owns the block (JO 7110.65 ¶9-3-1 c / ¶9-3-4),
so the warning matters only while the user is working an unprotected block. Dark cockpit (H115–H119).

## Design (take the recommended default, log it, P2)

1. **The "inside" fact comes from the server.** The client has no airspace containment code and must not grow one.
   `crc-sync/src/efsp/airspace-entry-alert.js` already computes, each tick, which tracked flights are inside which
   airspace (the alert and the airspace card's flight list, ADR 0124 §1), with the airborne/speed/age filters. Reuse
   that geometry; do not write a second containment test. Recommended: the same tick yields, per live Strip with an
   `airspaceEntry`, whether its correlated flight is inside that airspace (3D: lateral + vertical limits, same
   altitude source the alert uses, `indicatedAltFt`), and the hub delivers it to every session holding that Strip
   (the same per-session `deliverableTo`-style path the alert uses, or the existing surveillance hint for the Strip,
   `surveillanceHintsForStrip`, if that is the natural carrier: read both and choose; say why in the ADR).
2. **Inside means airborne inside** (ours, say so): a flight on the ground under the block, or without a correlated
   track, is not inside. Unknown (no track, no altitude) = grey, never amber.
3. **Client:** the badge is amber when `inside && airspace.state !== 'ACTIVE'`; the tooltip keeps `<name> is <STATE>,
   not active`; grey otherwise, tooltip unchanged from today's grey case. `bay/strip-signature.js` reads the same
   inputs for re-render: make sure a change of the inside fact re-renders the Strip (change bus topic, no renderer
   call from the handler).
4. Wire: if you add a key to a hub frame, run `cd crc-sync && npm run wire:record` (protocol 2; the last release
   speaks 1, so it should stay 2 — the script decides).
5. Walk the pilot cases (memory: walk pilot requests): approved early on the ground → grey; takes off, enters while
   the block is COLD → amber; block activated while inside → grey; leaves → grey; entry approval cancelled while
   inside → badge gone; a second Strip of the same flight (handoff) gets the same fact.

## Tests, gates

Unit tests for the server fact (inside/outside/ground/no track/vertical limits, delivery to each Strip holder only)
and the client badge model. e2e: one spec for the badge (inject frames as the existing airspace-entry specs do),
`E2E_LANE=7`. Before the report: both unit suites, `npm run walk`, `npm run freeze` (golden changes: `freeze:update`,
check the diff is small), `soak:selfcheck` if the hub or wire moved, `wire:record`, module-graph fixture if client
exports change (`GOLDEN_RECORD=1 node --test tests/module-graph.test.mjs`). Every command under `nice -n 19`.

## Output

Commits; ADR 0134; `docs/wip/U-AIRSPACE-BADGE.md` (guide wording for the badge, defaults taken, walks done);
final message per rule 8.
