# 0105: Ground control is not consolidated at local control; a tower controller takes ground by combining, and every Position carries its frequencies

**Status.** Accepted, built by GCLC (lane `lane/GCLC-combine`). Rulings: decisions.md H101, H102 (the question) and **H104**
(the desk's answers GCLC-1..4). The research is `docs/parallel/research/gc-lc-consolidation.md`, cited as "research §n". It
began as the draft `docs/wip/DOC-GCLC-adr-draft.md` and is written in the post-RENAME vocabulary (consolidation, staffed,
strip type).

**Settled H104 (what the desk answered).**
- **GCLC-1 (b):** the GC to LC consolidation link is removed. When GC signs off holding Strips, the controller signed on at
  LC is **offered** "Take GC as well?". Accepting signs them on to GC, a real combination (JO 7210.3 ¶2-6-5, ¶2-2-3). Combining
  LC with GC or CD warns and never blocks, and the warning is stronger while LUAW is in use.
- **GCLC-2 (a):** LUAW while LC and GC are combined warns and never blocks.
- **GCLC-3 (a):** the other links (CD to GC, LC to AP, SFA/PAR to AP, the carrier) are unchanged and become a later design lane
  ("the next controller takes the hat"). Nothing here makes that harder.
- **GCLC-4:** frequencies per Position are infrastructure for a later radio-panel overhaul, built as data (below), not a label.

**Differs from the draft (as built):**

1. The offer is a **directed frame** `efsp-position-offer`, reusing ADR 0100 section 6's directed channel (sent after the
   round trip's broadcasts to sessions signed on to LC), and only to LC's Primary. Accepting is an ordinary
   `efsp-set-positions` with GC added: no new accept message, no new Mutation, so no undo declaration (sign-on and sign-off are
   not Mutations and ADR 0100 does not cover them).
2. Frequencies are in scope (H104 GCLC-4 answered the draft's open question 3), as `positionFrequencies` in facility config.
3. The LUAW warning is raised at two moments: when the combination is made (the sign-on ack) and when a Strip enters LUAW
   while the acting LC Primary also holds GC or CD (the Mutation ack's `warning`, `LUAW_WHILE_COMBINED`). The persistent
   marker in the panel escalates live from the Board.

## Context

Guide §4.8.6 rule 2 gives a consolidation chain `CD→GC→LC→AP→CTR`, and `efsp-facility-incirlik.json` ships
`GC: "LC"`. It is the only Incirlik link with neither an FAA source nor an ADR of ours (`facility-schema.js`, the
`consolidation:` note).

What the FAA says (JO 7210.3EE ¶2-6-5, ¶10-3-8, ¶2-2-3, ¶3-3-3; JO 7110.65BB ¶3-1-3, ¶3-1-4; research §1):

- One controller may combine ground and local, but only "during periods of significantly reduced traffic levels"
  (¶2-6-5b), and **never while LUAW operations are conducted** (¶2-6-5c). ¶10-3-8a4 names ground control
  explicitly and allows LC to be combined only with other *local* positions.
- "Consolidated/combined" means one certified controller **signed on and responsible** for each consolidated
  position (¶2-2-3). The person takes on the other position's functions; no traffic is moved.
- The two jobs are distinct. LC has "primary responsibility for operations conducted on the active runway"; GC owns
  the movement area, and needs LC's approval for every runway crossing (¶3-1-3a to c). Every allocated frequency
  stays continuously monitored (¶3-3-3), so a combined controller works both the ground and the tower frequency.
- USAF practice (DAFMAN 13‑204v3) could not be read and is unverified. ¶2-6-5 is applied to Incirlik by analogy.

What the EFSP does (research §2):

1. When GC is vacated, its Strips are reassigned to LC (`reassignPositionStrips`). LC **may not act** on PUSHBACK,
   TAXI or TAXI_IN (`DEPARTURE_STATE_OWNERS`, `ARRIVAL_STATE_OWNERS`; refused by `nlaPrecheck` and
   `validateBayImpliedTransition`). The Strips land in `lc-coordination` and stay frozen until somebody signs on to
   GC. A transfer or NLA aimed at an empty GC also ends at LC in a state LC cannot advance.
2. Combination (guide §4.8.4) already models the FAA meaning: one controller signed on to GC and LC, two Bay groups,
   permissions per acting Position. Nothing warns when LC is combined with a non-local Position.
3. Every DEPARTURE goes RUNWAY_QUEUE → LUAW → DEPARTED. RUNWAY_QUEUE has no other next state, so the EFSP is always
   "conducting LUAW". Nothing relates LUAW to staffing.
4. The EFSP has no per-Position frequency. The only exception is SFA's pool.

## Options considered

| | Option | For | Against |
|---|---|---|---|
| A | Leave as is | No change | Says "consolidated" and does parking; LC cannot work what lands on it; no LUAW rule |
| B | **Remove GC→LC; take ground by combining; warn on LC + non-local, more strongly in LUAW** | The FAA meaning (¶2-2-3); every Strip workable; uses combination and the D19 warning, which exist | A guide §4.8.6 deviation; NLAs into an empty GC are inhibited rather than parked |
| C | Keep GC→LC; block consolidation and combination while a Strip is in LUAW | Adds the hard FAA rule | Keeps the parking; every departure passes LUAW, so the block would bite at every takeoff and would block the vacating GC (guide rule 5) |
| D | Consolidation means "take the hat" on every link (no Strip moves) | One meaning everywhere; removes the frozen-Strip class on CD→GC, LC→AP and the carrier | Touches every Facility, D19, Primary rules, the soak and the goldens: a design lane |

## Decision (proposed)

**Option B.**

1. **Config.** `efsp-facility-incirlik.json` `consolidation` becomes `{ CD: "GC", LC: "AP", SFA: "AP", PAR: "AP" }`.
   GC ends its chain. [SOURCE-DEFINED] deviation from guide §4.8.6 rule 2, recorded in the `facility-schema.js` note
   and in usage guide §8F1's consolidation row, beside ADR 0013, 0074, 0075 and 0080.
2. **When GC is vacated with Strips and nobody on it.** **The Strips stay GC's** (`ownerPositionId: GC`, nothing is
   reassigned, nothing is stamped `consolidatedFrom`) while nobody holds GC. The existing D19 path applies: warn
   `routedTo: null`, with the count, and do not block (rule 5). In addition, if LC has a Primary, that controller is
   **offered GC** ("GC is unstaffed with N Strips. Take GC as well?"). Accepting signs them on to GC: a combination, two Bay
   groups, and GC's rules govern GC's Strips, so they are advanceable again.
3. **Combination warning (¶2-6-5b, c; ¶10-3-8a4).** When one controller's signed-on set holds LC and also GC or CD,
   the sign-on ack carries a warning, from whichever side the combination was made:
   - always: "LC combined with GC: only at significantly reduced traffic (JO 7210.3 ¶2-6-5b). Monitor both
     frequencies (¶3-3-3)."
   - and when any DEPARTURE at the Facility is in RUNWAY_QUEUE or LUAW: "LUAW in use: LC must not be combined with a
     non-local position (¶2-6-5c, ¶10-3-8a4)."

   The warning is **non-blocking**, and the LC Bay group header shows a persistent "COMBINED: GC" marker for as long
   as the combination lasts. The wording and the trigger are [SOURCE-DEFINED]. The doctrine they cite is the FAA's,
   applied to a USAF field by analogy (research §1.7).
4. **NLA into an empty GC.** CD's CLEARED→PUSHBACK and LC's LANDED→TAXI_IN are inhibited with "no receiving Position
   present: sign on to GC", which is today's inhibit plus a hint. They are no longer silently routed to LC.
5. **Unchanged.** CD→GC, LC→AP and SFA/PAR→AP keep today's reassignment. Whether they become option D is a separate
   question (Open, 2). The LUAW lifecycle is unchanged (Open, 1).

## Consequences

- A lone tower controller signs on to GC and LC (and CD), as a quiet FAA tower does. Every Strip there can be
  worked. Nothing freezes in `lc-coordination`.
- A GC that signs off with Strips while nobody holds LC leaves them with GC and a D19 warning, as AP and CTR already
  do at the end of their chains. Guide §4.8.7's "time a Position spends unstaffed while it still owns Strips" will
  show it.
- Tests and goldens that assume GC→LC must change. Known: `efsp-facility-config.test.mjs` (the consolidation
  deepEqual), and any freeze golden or soak traffic that vacates GC. `efsp-board-store.test.mjs`'s
  `reassignPositionStrips('GC','LC')` cases test the mechanism, not the config, and can stay.
- A new warning kind on the positions ack, plus the client's rendering of it and of the COMBINED marker.
- The guide stays as written (it is never edited for our deviations). §8F1 gains the row.

## Frequencies as data (H104 GCLC-4)

- **Config.** Facility JSON gains an optional key `positionFrequencies`: `{ "<Position>": [ { "label": "GND", "mhz": 275.8 } ] }`.
  `facility-schema.js` checks it: the Position belongs to the Facility, `label` is a short unique string within the Position,
  and `mhz` passes `airspace-schema.js`'s `isValidFrequency` (a number from 30 to 400 MHz, the one definition the airspace
  frequencies and the flight-data frequency already use). A Position may carry several (UHF primary, VHF, backup). A Position
  with none is simply absent. The shipped Incirlik values are placeholders [SOURCE-DEFINED], squadron data to confirm.
- **Wire.** Every Position entry (snapshot and delta `positions`) carries `frequencies` and `combinedWith` (the other
  Positions of this Facility whose Primary is the same controller). The positions ack carries `monitoring`: the frequencies of
  every Position the session is Primary at, each tagged with its `positionId`, and `combination` (below).
- **Combined.** A controller who is Primary at LC and GC "has" both; `monitoring` is the union, so a panel can show both and
  say "monitor both" (¶3-3-3). The radio bridge is untouched: this is data a later radio-panel can bind to.
- **Panel.** Where the panel names a Position (its tab) it shows that Position's frequencies; a combined controller's tabs
  carry a COMBINED marker and the other Position's frequency.

## Open questions (remaining)

1. **Block in LUAW?** Answered by H104 GCLC-2 (a): warn only. Revisit if a takeoff clearance from the hold-short line
   (RUNWAY_QUEUE to DEPARTED) is ever added, which would make LUAW a choice.
2. **Option D later?** H104 GCLC-3 (a): yes, as its own lane. This ADR leaves `consolidatedAt`, `reassignPositionStrips` and
   the hand-back untouched for the other links.
3. **USAF rule.** Can anyone in the squadron confirm DAFMAN 13-204v3's rule, or Incirlik's practice, for combining
   ground and tower? And the real Incirlik GC and LC frequencies.
4. **When nobody holds GC and nobody holds LC.** GC's Strips stay GC's with the D19 warning; they are advanceable by the
   next controller to sign on to GC and nobody else (as AP and CTR already are at the end of their chains).
