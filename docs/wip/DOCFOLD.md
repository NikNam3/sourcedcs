# DOCFOLD: waves 2 and 3a folded into the guide and the briefing

Branch `lane/DOCFOLD-wave2-3`, from `efsp-wp5-correlation` at `c12cd7c`. Docs only: `docs/efsp-briefing.md`
and `docs/efsp-usage-guide.md`. One commit per lane folded (L1b, L12, L13, L14, L15, L16, F3+F4, F2, L22,
L24, L27, L23, L26+U6, L18 client half) plus one for the cross-cutting rewrites (header, section 1, the
bug table, section 5, the guide's status list). The wip files are untouched.

## Folded

L1b, L12, L13, L14, L15, L16, L22, L24, L27, F2, F3, F4, L23, L26, U6, L18 (client half).
Not folded: UI-A, L17, L19 (running), E2E and E2E-fix notes, **L25 (merged, miztoyaml, not in the brief)**,
L28 (not started). `CLAUDE.md` is not mine and was not edited.

## Contradictions between the guide (or briefing) and merged behaviour, as found

All of these are now fixed in the two files unless marked OPEN.

1. Guide section 1 and 8G said the field-state panel did not exist and nobody could close a runway from
   crc-desktop; the panel is merged (L1b). The guide still called works a "barrier change" (H52 renamed it).
2. Guide sections 4B/6 said HUNG raises no advisory and that Tower alone sees ORDNANCE; the advisory chip is
   merged and H55/S-L12 put `3G` on APP/CTR/MISSION faces when not CLEAN. Briefing 3G said `3G` was on
   neither MISSION and that nothing acts on `HUNG`.
3. Guide section 6 said `alertStatus` has "no Block yet"; Block `14E` exists (L13). The guide listed
   alert/scramble as not built. The L13 wip note says OPS can set `14E` only while it owns the Strip:
   stale, `permission.js`'s `NON_OWNER_BLOCK_WRITES` lets OPS write it at any state (S-L13, verified).
4. Guide section 1 listed ATO import as parser-only; guide section 6 said `modeOne`/`modeTwo` have no setter
   (`applyAtoTasking` writes them).
5. Guide sections 1 and 10 said there is no metrics dashboard; METRICS exists.
6. Guide 4A said you edit `STEREO` (`9F`) by typing a name; it is a picker. Briefing section 4 listed typed
   time Blocks as storing raw strings (F4 and L16 fixed it).
7. Guide 8E's `HDG` indicator did not say magnetic; the conformance monitor compared magnetic with grid before
   F2's follow-up. The guide had nothing on magnetic headings, the transition altitude, or the APRT panel
   losing its theater inputs.
8. Briefing 3I's soak paragraph said the soak fails on F1/F2/F3; L27 and L24 fixed them.
9. Guide section 10 described the audit trail without `facilityId`, peer entries, `blockId`/`value`,
   `Archive`, `NotPersisted`, or the retry semantics.
10. Guide 6 said `ALT` takes a single altitude; it takes a block (U6, `0091`).
11. Guide 8C1's "known gaps, being fixed" list (B1-B7, F10) is all fixed (L23).
12. L23's wip note says a receiver dropping ends the proposer's link "also after a completed handoff"; S-L23
    decided only PROPOSED/ACTIVE links end and `receiveCoordinationPeerGone` checks that (verified in code).
    The guide follows the decision, not the note.
13. **OPEN, CLAUDE.md (not mine):** says "The soak currently fails on known findings owned by wave-2 lanes"
    (no longer true) and that `soak:selfcheck` proves every detector fires (`drop-broadcast` fails at the
    base commit too, S-L26). It also needs `config/theaters.json`'s new fields (TA, projection meridian,
    variation override) per F2's note.
14. **OPEN, L18's wip spec** names the runway-request kinds `CLOSE, OPEN, BARRIER_CHANGE`; they are
    `CLOSE, OPEN, WORKS` since L1b.
15. L22's wip note says a point-out to you is a yellow block; the code is a flashing yellow FDB while
    proposed, steady once accepted (the guide follows the code).
16. Stale wip statements I did not carry forward: L12 and L13 say client field state (`getEfspFieldState`) does
    not exist and show a stand-in/placeholder (L1b merged; `e2e/ordnance-hung.spec.js`'s `standInFieldState`
    should be deleted); L24's "an archived drop backfills as UNKNOWN facility" (L26 fixed it, test 9 title
    already says it keeps its Facility).

## Defaults taken

- Folded each lane's "what the guide should say" into a numbered guide section (new: 8H alert/scramble, 8I ATO
  and AR join, 8J mission sessions, archiving and magnetic headings; extended: 4A, 4B, 4B's new Times
  subsection, 6, 8C1, 8E, 8F's new STARS subsection, 8G, 10) and "what the briefing should say" into a new
  briefing section 3J, one paragraph per lane.
- Rewrote the briefing's section 4 table: fixed items are removed (listed in one sentence above it), new open
  items added. Rewrote section 5 for what is left (UI-A, L17, L19, L18 server half, L28, L20); ADR numbers
  for L17/L19/L20/L28 are the plan's (`0074`, `0076`, `0077`, `0087`).
- Test counts are the last recorded ones in `decisions.md` (S-M-wave3a, S-GRPC): the worktree has no
  `node_modules` and a docs lane runs no suites. Say so in the briefing.
- I did not mark the wip files "folded" (the earlier DOC lane did): the brief said to leave them for the
  integrator.
- The sparse claims I could not verify cheaply (L24's F7 `_nlaHistory` is deleted by `archiveStrip`) are
  stated with that caveat in the briefing.

## Walks not done / not verified

- I verified identifiers, labels and rules against the code with grep and by reading the relevant functions
  (panel button labels, chip texts, `permission.js`, `presentation.js`'s `schemeOf`, `parseZuluHhmm`,
  `applyAtoTasking`'s allow-list, `ARCHIVE_AFTER_MS`, `receiveCoordinationPeerGone`, `NON_OWNER_BLOCK_WRITES`).
  I did not run any suite or any app.
- Not verified in a browser: any rendered text in the new guide sections (e.g. the FIELD STATE panel's exact
  phrasing, the METRICS panel's layout). The wording follows the lanes' own notes and the source.

## Findings for the supervisor

- Merged and unfolded: **L25** (and E2E-fix). The brief's list did not include L25.
- `CLAUDE.md` needs the two edits in item 13.
- Briefing section 4 now carries U1-U5 and U8 as UI-A's; U6 and U7 are fixed.
