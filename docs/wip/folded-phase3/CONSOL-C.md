# CONSOL-C working note

Lane CONSOL-C (client half of ADR 0110), branch `lane/CONSOL-C-consol-c`, base `c3172419` (contains CONSOL-S). `E2E_LANE` 7.

## What was built

- `panels/efsp/combination-rules.js` (pure): `NON_LOCAL` = OPS, CD, GC, AP, SFA, PAR (was `NON_LOCAL_TOWER` = GC, CD; the parity test now runs, its `todo` is gone);
  `nonLocalCitation` (OPS/CD/GC cite ¶2-6-5b, AP/SFA/PAR ¶2-6-12); `hatRows(positions, selfId, strips, acting, {hidden, callsignOf})` derives the rows:
  one "Take Q as well?" per `hatOffers` entry on a Position whose Primary is `self.controllerId` (with the callsigns, the runway count, the combination
  preview, severe on `onRunway` or LUAW in use), one "Take Q?" per Position this session observes that has no Primary and owns Strips; `vacatedBetween`.
  `offerText` and `offerStands` are gone.
- `panels/efsp/panel/combination.js`: no module-variable offer, no handler; rows are re-derived on every redraw (the panel already subscribes to `snapshot`,
  `board`, `positions`, so a delta that carries Positions redraws it). Take = `sendEfspSetPositions(declared + Q)` (the Observer case sends the same set; F1 on the
  server makes them Primary). "Not now" and a Position this controller vacated itself are hidden until the count (or runway count) grows; the hidden entry is
  dropped once the offer lapses.
- `efsp-state.js` (a few lines): `efspSelf` from `msg.self` on the snapshot (the resync reply is unwrapped into a snapshot, so it covers it), `getEfspSelf()`.
- `efsp-messages.js`: `efsp-position-offer` handler removed. `radar-panel.js`: warning wording for `offeredTo` (+ `onRunway`), `routedTo` kept for hand-back.
  `refusal.js`: `UNSTAFFED_RECEIVER` (the server's detail, which names both Positions, wins; the code's text is the fallback; `NO_RECEIVING_POSITION` already existed).
  `metrics-panel.js`: `transfers.toUnstaffed`. `efsp-panel.css`: offer row wraps and takes the severe colour.
- crc-sync: `combination.legacyOfferAfterSignOff`, the directed `efsp-position-offer` frame and `directedFor`'s `primaryOnly` branch removed; tests moved to assert the
  standing offer. `wire:record`: "WIRE_PROTOCOL stays 2 (last release speaks 1, already ahead of it); surface recorded" (`wire-surface.json` loses the type).
  Goldens: 3 lines (two directed frames, one type-set entry).
- Usage guide: Facility table, the TACTICAL hand-back bullet (~918), 8F1's consolidation row, 8K, 8L, 8M rewritten as "Taking a hat", two stale
  "or the Position it is consolidated at" phrases (§2, the Bay table), the `SystemReassign` line.

## Tests

crc-desktop: `efsp-combination-rules` (13), `metrics-panel`, parity without `todo`, `module-graph` fixture re-recorded (exports changed). New `e2e/consol-hat.spec.js`
(4): LC signs off with a Strip -> AP's row (callsign, ¶2-6-12) -> Take LC -> `COMBINED LC + AP`, the ack warning `offeredTo: AP`; a later sign-on and a reload see it;
"Not now" then a second departure delivered to the empty LC brings it back with 2 Strips; an Observer is asked "Take it?" and becomes Primary. `gclc-combine` second test
rewritten on the real flow (GC signs off holding a Strip). Run on lane 7: smoke, gclc-combine, consol-hat, signon-reconnect, tactical-positions, l15-metrics, l17-carrier: all green.

## Release note

"Consolidation changed: when a Position is left its Strips stay put and the next controller on its list is offered the hat ('Take CD as well?'), shown to
anyone who signs on later and after a reconnect; an Observer of a Position with no Primary is offered Primary. Combining LC with AP, SFA or PAR now warns too.
crc-sync and crc-desktop must be released together (the offer frame is gone; the wire protocol number is unchanged at 2)."

## Defaults taken (P2)

- Row text appends "It has Observers, who are offered Primary first." when `observersFirst`, and lists up to six callsigns.
- A self-vacated Position is hidden by recording its live count at the moment the acked Position set loses it; the runway count is pinned to Infinity so only a new Strip re-shows it.
- `NON_LOCAL_TOWER` renamed `NON_LOCAL` (the parity test is the only other importer; edited).
- The e2e sign-off warning is read from the `efsp-positions-ack` frame, not from `#efsp-position-warnings`: that element is cached by the radar panel and stays empty while the radar panel is not open.

## Findings for others

- `docs/glossary.md` rows `consolidatedPositions` and `routedToConsolidated`, and CLAUDE.md's crc-sync paragraph, still use the old meaning (already noted by CONSOL-S; supervisor).
- `LUAW_WHILE_COMBINED_TEXT` changed from "GC/CD" to "a non-local Position" (client text only; the server sends the code).
- The Observer row counts Strips from the local Board, so it only shows what this session is allowed to read (read scope); not walked for a read-scoped session.
- Not walked: the offer in a session that reads only what it owns (ADR 0080 read scope): `hatOffers` counts all Strips server-side, while the callsign list is local.
