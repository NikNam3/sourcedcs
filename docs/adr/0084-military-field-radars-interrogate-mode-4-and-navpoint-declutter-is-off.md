# 0084 — military field radars interrogate Mode 4, and navpoint declutter is off

Amends `0066` (its default that ATC radars carry no Mode 4 interrogator). `0066` itself is
unchanged; this ADR is the correction. Decided by the human at the wave-1 merge
(`docs/parallel/decisions.md` H53, H70).

## Context

`0066` made a contact's IFF colour depend on what the session's own radars could interrogate. It
took the default that airport, approach and carrier-approach radars have no Mode 4/5 interrogator,
which is true of civil ATC. Under that default, the squadron's own traffic showed **neutral** on
every Tower and Approach scope.

The squadron's fields (Incirlik, Konya, Akrotiri) and the carrier (CVN-72 `UNION`) are military,
and their approach radars are military ones.

Separately, H6 turned every declutter behaviour off until the end of the EFSP work. L10 turned the
formation label declutter off; the navpoint declutter ("Hide numbered navpoints", "5-letter names
only") was left on as map hygiene.

## Decision

1. `DEFAULT_CAPS` in `crc-sync/src/radars.js` gives `airport`, `approach` and `carrierApproach`
   radars `mode4: true`. Own traffic with Mode 4 switched on is friendly on Tower and Approach
   scopes too. A radar type can still turn it off through `caps` in `sensor-specs.json`.
2. Navpoint declutter defaults off, and an existing install is switched off once
   (`navDeclutterOffH70`), as the formation declutter was. A controller may turn it back on in
   Settings. It will be reworked once AIRAC data lands.

## Consequences

- `0066`'s colour table changes in the rows "own AI fighter / APP-TWR" and "own player, SRS on /
  APP-TWR": both are **friendly** when Mode 4 answers, instead of neutral.
- Traffic that answers only Mode 3/C is still neutral on those scopes, and silent traffic is a
  bogey. `0066`'s classification order is unchanged.
- The map shows every navpoint (`WP1`, `NAV003`, …) until the AIRAC work.
