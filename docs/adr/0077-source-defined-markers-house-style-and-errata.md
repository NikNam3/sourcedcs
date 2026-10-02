# 0077 — `[SOURCE-DEFINED]` markers: the house style, and errata to earlier ADRs

Status: Accepted

## Context

`EFSPImplementationGuide.md` §13 says EFSP invents no doctrine, and defect D11 is a number, a threshold or a sentence
that is SOURCE's own choice presented as the FAA's. The L9 audit found such places in the usage guide and the code;
L20 (the comment and doc-pointer sweep on the post-refactor layout) re-found and marked them. Several earlier facility
notes already cite "ADR 0077" for this, and no ADR existed. ADRs are never edited once committed (P4), so a statement
in one that later proved wrong cannot be fixed in place: it is corrected here, once, with its evidence.

## Decision

**1. What a marker means.** `[SOURCE-DEFINED]` marks a value, threshold, state set, label set, rule or sentence that
is SOURCE's own choice (squadron or project policy, or our model of something), not read from the guide, its Annex or
a cited FAA or ICAO document.

**2. Where one is required.** On every number, threshold, state or label set, rule or sentence that is ours and is
neither cited to a guide or Annex clause (a citation on a parent section covers its untagged sub-clauses) nor in a
tuning file whose `_comment` already says so. It is not required on an engineering bound (a cache cap, a retry count,
a ring size, a timeout that changes no meaning): those say "engineering bound" in plain words.

**3. House style.** In code: `// [SOURCE-DEFINED] (docs/adr/00NN) — <what is ours>.`, with a decision row (`H22`,
`S-L1d`) when there is no ADR. In a tuning JSON read through `tuning-file.js` (which skips `_` keys): inside
`_comment` or `_note`. A facility file (`config/efsp-facility-*.json`) never takes a `_comment` key, because the
facility loader is not the tuning loader; its notes live in `facility-schema.js`. A marker is never deleted unless the
value it marks is gone.

**4. Rendered labels carry no inline marker.** A label makes no claim, and a bracketed tag in front of a controller is
noise. The usage guide's section "What is ours and what is sourced" (§8F1) lists them once. The one exception is the
metrics panel's notes, which ship the literal prefix (`adr/0072`).

**5. "SOURCE practice"** inside a rendered string is a convention, not a tag: it says "this is how the squadron does
it, not a published rule". It stays as written.

**6. Mirrored pairs.** A client module that mirrors a server module (`nla.js` and `authority/**` with `efsp-nla.js`,
`bay/authority-mirror.js` and `sfa-state.js`; `runway-status.js` with `runway-status-rules.js` and
`ordnance-advisory.js`; `scramble.js` with `alert-scramble.js`; `strip-template.js` with `block-map.js`;
`time-chains.js` on both sides) carries the same marker with the same sense on both sides. The drift tests compare
strings and tables (and, for `time-chains.js`, the whole body with comments), so a marker or a reworded rule on one
side is written on the other in the same change.

## Errata to earlier ADRs

Each row says where the earlier ADR is wrong or out of date, what is true now, and the evidence. The earlier text
stays as committed; read it through this table.

| ADR:line | Says | Is | Evidence |
|---|---|---|---|
| `0033:21` | "Ground and Clearance Delivery are not radar positions in any facility, real or simulated." | That is the squadron's model, not a fact about real facilities: in this model GC and CD work no scope (`positionRadars` is an empty array for OPS, CD and GC). Nothing in the guide or an FAA text was cited for the "real" half of the sentence. The usage guide §8B says "in our model" | L9 inventory B9 and E5; `crc-sync/config/efsp-facility-incirlik.json` `positionRadars`; `facility-schema.js` note on `positionRadars` |
| `0042` (`:24`, `:48`), `0048:52`, `0059:93` | name the file `radar-specs.json` (`0064:506` already notes it) | the file is `crc-sync/config/sensor-specs.json`; it holds every sensor figure, the `presentation` map and the transponder rules | `ls crc-sync/config/sensor-specs.json`; `git ls-files` finds no `radar-specs.json` |
| `0048:14` | `theater-settings.json` is read by `theater-settings.js` and holds transition altitude, heading correction and game-time offset | the file and module are gone. Per-theater facts are in `config/theaters.json`, read once at start-up and never written (UTC offset, transition altitude, grid convergence, an optional magnetic variation override), with an optional field-by-field override in `state/theaters.json`; the variation itself is the World Magnetic Model at the mission date (`adr/0085`) | `crc-sync/src/theaters.js`; commit `290b31a`; `adr/0085`; decisions H62 |
| `0079:80-85` | `theater-settings.js` loads only the keys it knows, and `state/theater-settings.json` holds transition altitude and heading correction | same module and file removed (above); the in-game Zulu rule of `0079` itself is unchanged and `gameTimeOffset` has no replacement | `crc-sync/src/theaters.js`; `adr/0085` |
| `0081` (the `efsp-resync` description, `:71-80`, `:186`) | the answer to `efsp-resync` is a delta or a snapshot, described without a reply type of its own | the answer has its own wire type, `efsp-resync-reply`, with `answer: 'snapshot'` or `'delta'` (R3-47); the delta-or-snapshot decision, `boardEpoch` and the epoch rule are as `0081` says | `crc-sync/src/efsp/efsp-ws.js` (`efsp-resync` case; the reply wrapper, `type: 'efsp-resync-reply'`); decisions R3-47 |

Not errata, so not listed: the old words in earlier ADRs (seat, covering chain, FDR, TWR, GND, APP, STCA, field state,
hand-over). `docs/glossary.md` is their key. The consolidation chain the facility files ship differs from guide
§4.8.6 rule 2 in four places (no AP to CTR and no TAC_C2 to CTR, no RSU to LC, the carrier chain without CV_PRIFLY,
JTAC to TAC_C2); those are the decisions of `0013`, `0075`, `0074` and `0080` and are listed in the usage guide's §8F1.

## Consequences

- A reader who finds a number or a rule in code can tell from the marker whether it is the guide's or ours, and a
  reader of the usage guide can tell the same without a marker on screen.
- New ADRs from this one on use the glossary's words only.
- A fault that needs a code change is a finding for a lane, not ADR material.
