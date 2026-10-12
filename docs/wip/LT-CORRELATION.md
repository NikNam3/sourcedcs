# LT-CORRELATION (live-test finding T12)

Branch `lane/LT-CORRELATION`, cut from `efsp-wp5-correlation` at `61964280`. Server only; no Playwright, no wire change.

## T12: what was wrong

A new CTR OVERFLIGHT Strip with Block 5 = `0003` stayed `NO TRK` while a contact's label read `0003`.

**Not a code-source mismatch.** The label and the beacon rung read one source, and the tests now show it
(`crc-sync/tests/efsp-correlation-code-source.test.mjs`):

- `ws-hub.js` → `surveillance/index.js#describe` → `Transponders#transponderOf` → `presentTrack`'s `ssr.code`, which
  `track-label.js` prints; and `app/monitors.js`'s `beaconOf` → the same `Transponders` instance → `transponderOf(t).code`.
- SRS squawk 0003 in every shape the client parses (IFF `mode3: 3`, `mode3: '0003'`, PascalCase `Mode3/Status`,
  lowercase `iff`, the legacy top-level `Transponder.Mode3`) gives `'0003'` on both sides, and a Block 5 of `0003`
  correlates on the beacon rung. `octalCode` pads leading zeros correctly.
- Transponder off (`status 0`), SRS's `mode3: -1`, or an SRS client name that differs from the DCS player name: no code
  on either side.
- An own AI aircraft: both sides see the same synthetic 6xxx code. Block 5 can never hold one (the code allocator
  refuses the synthetic block), so **an AI contact is never acquired by an assigned code**, only by callsign or a binding.
  That is by design (ADR 0059), not T12. A hostile AI aircraft squawks nothing.
- Block 5 accepts only 4 octal digits (`isValidCodeFormat`), so `3` cannot be stored for `0003`.

**The cause is in the reconciler.** With the code seen on both sides, only two things in the beacon rung leave a
squawking contact unmatched without a `TRK ×n`:

1. **The former-holder exclusion (ADR 0076 S-L27), the likely T12 cause.** It is keyed on the **contact**, not the Strip:
   any finished flight (its Strips all dropped, or its flight data deleted) that ever held that contact, by any rung,
   a provisional callsign match included, kept the contact from every later flight's code for as long as the contact
   stayed in the picture. "A new Strip" does not rule it out: in a local test the human's jet is the one contact that
   earlier Strips (the PAR flight, or any test Strip whose callsign matched it) correlated to. Nothing on screen shows the
   exclusion; the Strip just says "no contact matches this flight". **Fixed per H135** (below).
2. **Another live flight assigned the same code** (§3.10.2 rule 7 accepts a duplicate with a warning). The first flight
   in sweep order took the contact; the second said "no contact matches this flight", which is wrong. Now its `NO TRK`
   says `the contact squawking 0003 is correlated to VIPER1` (the same applies when the contact went to another flight
   by an explicit binding). The callsign rungs still get their turn first.

I cannot prove from the code alone which of the two the human hit; both now behave and say why.

## What changed

- `crc-sync/src/efsp/correlation-reconciler.js`
  - **H135:** the beacon rung (rung 2) has **no former-holder exclusion**: an active Strip's assigned discrete code
    acquires the contact squawking it (JO 7110.65BB ¶5-3-3 d; ¶5-3-4 a; ¶5-2-1 b.2 NOTE: a terminated flight's data is
    removed, so a finished flight holds no code). The callsign rungs (3, 4; ours, for players who do not squawk) keep
    `_formerHolder`. Cited in the constructor comment and at the rung. Supersedes ADR 0076 S-L27 **for the beacon rung
    only**; no ADR written (H135).
  - A `TRACK_LOST` whose code is squawked by exactly one contact that another flight already has names that flight in
    its detail (record content only; no new warning kind, no wire key).
- Tests: `crc-sync/tests/efsp-correlation-reconciler.test.mjs` (+4: H135 beacon rung takes a former holder's contact; the
  callsign rung still does not; the duplicate-code detail; the callsign rung still matches after the code was taken) and
  the new `crc-sync/tests/efsp-correlation-code-source.test.mjs` (9: the code-source cases above).

## ¶5-4-6 e NOTE (received code in the data block on a mismatch)

**Already done, more often than the FAA.** For a contact named by a callsign (a correlated or provisional flight), the
data block's code line (`track-label.js` `trackCodeTag`) shows the **received** code (`ssr.code`, from the
transponder), never the assigned one. ERAM/STARS show it **only** on a mismatch and remove it when the pilot squawks
the assigned code; ours shows it always. Showing it only on a mismatch needs the assigned code on the client side
(the correlated flight data's `beaconAssigned`, which the client already has), so it is a client change in
`track-label.js`, outside this lane: noted for the declutter work. The Strip side already renders assigned vs observed
(§3.10.2 rule 1, `beaconObserved`), and an exact-callsign match squawking another code is `TRK?` (provisional).

## Usage guide wording (§8C)

Replace the `NO TRK` row's "What to do" note and add one paragraph after the table:

> | `NO TRK` | **uncorrelated.** Nothing on your scope matches this flight. Hover it: if the contact squawking this
> flight's code is already another flight's, it says which one | `Bind…` it if you can see which one it is |

> **The assigned code finds the jet, whatever it flew as before.** A contact squawking a Strip's Block 5 code is
> correlated to that Strip even if an earlier, finished flight had that same jet, which is how the FAA's automation
> acquires a flight (JO 7110.65BB ¶5-3-3 d, ¶5-3-4). A callsign match is stricter: a jet that an earlier flight
> finished with is not handed to a new flight just because the callsign is reused; give the new flight a code, or bind it.
> Two flights assigned the same code cannot both have the one contact squawking it: the second says `NO TRK` and names
> the first.

Briefing (`docs/efsp-briefing.md`), correlation: "Beacon rung: no former-holder exclusion (H135, supersedes ADR 0076
S-L27 for rung 2); callsign rungs keep it. A `TRACK_LOST` whose code another flight has names that flight."

## Defaults taken

- The duplicate-code case keeps the existing "first flight in sweep order wins" (pinned by the existing test "one contact
  never correlates to two flights"); I only made the loser's message say why. Making both `TRK ×2`-style ambiguous
  instead would be a behaviour change no ruling covers.
- The name in the detail is the holding flight's callsign; `another flight` when it has none.

## Findings for other lanes / the supervisor

- The reconciler's `tick()` docstring says "if two flight data would claim one contact at the SAME rung, neither gets it
  and both are told it was ambiguous". The code does not do that (first in order claims); only two **contacts** for one
  flight are ambiguous. Left as is (default above); the comment overstates.
- ¶5-4-6 e: show the received code on the data block only on a mismatch (client, `track-label.js`), for declutter.
- An AI contact can never be acquired by code (synthetic block refused for Block 5). If the squadron wants AI flights
  acquired by code, that is a design question, not a bug.

## Gates

crc-sync unit 2660 → 2673 (all pass); crc-desktop unit 1267 (all pass, unchanged); `npm run freeze` 56/56, no golden
changed; `npm run walk` 23/23. No Board/wire/sync/hub/soak file moved, so no `soak:selfcheck`; no wire change, so no
`wire:record` (`wire-protocol.test.mjs` passes).
