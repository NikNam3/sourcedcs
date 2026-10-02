# ADR (draft, no number): Ground control is not consolidated at local control; a tower controller takes ground by combining

**Status.** Draft (DOC-GCLC, 2026-10-02). Proposed for desk RP-F1 / NX-3 (decisions.md H101, H102). The research is in
`docs/parallel/research/gc-lc-consolidation.md`, cited below as "research §n". It is not built. A lane that builds
it copies this file to `docs/adr/NNNN-…`, checks the "As found" section against the code of the day, and marks it
Built at the end. It is written in the post-RENAME vocabulary (consolidation, staffed, strip type).

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
2. **When GC is vacated with Strips and nobody on it.** The existing D19 path applies: warn `routedTo: null`, with
   the count, and do not block (rule 5). In addition, if LC has a Primary, that controller is **offered GC**
   ("GC is unstaffed with N Strips. Take GC as well?"). Accepting signs them on to GC: a combination, two Bay groups,
   and the Strips keep `ownerPositionId: GC`. Nothing is reassigned and nothing is stamped `consolidatedFrom`.
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

## Open questions (for the human)

1. **Block in LUAW?** The FAA has no exception during LUAW operations. We warn only, because every EFSP departure
   passes LUAW. The alternatives are to block, or to add RUNWAY_QUEUE→DEPARTED (a takeoff clearance from the hold
   short line) so that LUAW becomes a choice and a warning tied to it means something.
2. **Option D later?** Should every consolidation link mean "the consolidating controller takes the hat", which
   would end the parking on CD→GC, LC→AP and the carrier too?
3. **Frequencies.** Should facility config carry display-only Position frequencies, so the combination warning and
   marker can name them? These would be squadron data to verify.
4. **USAF rule.** Can anyone in the squadron confirm DAFMAN 13‑204v3's rule, or Incirlik's practice, for combining
   ground and tower?
