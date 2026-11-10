# Lane RADIO-SET: position radios, guards, VHF bands, link groups, the new panel (ADR 0158 step 3)

Read first: `CLAUDE.md`, ADR 0158 (whole, especially §2 and §3), `docs/parallel/radio/README.md` (the contract),
`docs/parallel/lane-rules.md`, ADR 0131 and 0138 (the frequency table), `crc-desktop/README.md` ("Client modules"), and
the panel being replaced: `crc-desktop/app/public/js/srs-radio.js`, `settings.js`, `dock.js`/`dock-handle.js` (how
panels mount), `panels/efsp/frequency-state.js` (the client's frequency rows).

## Goal

The radio set as a pure function, and the new radio panel drawn from it. It talks to a stub engine until the supervisor
joins it to RADIO-CORE's `radio-engine.js`.

## Files (ADR 0158 §6). One job each, about 300 lines at most, split by job if it grows

`crc-desktop/app/public/js/radio/`:

| File | Notes |
|---|---|
| `bands.js` | leaf |
| `radio-set.js` | leaf, pure; inputs passed in, not imported where avoidable |
| `link-groups.js` | leaf, pure |
| `radio-prefs.js` | leaf: per-radio-identity volume, pan, mute, group membership, manual radios, devices, PTT key; persisted through `settings.js` |
| `radio-panel.js` | the DOM; split it by section, for example `radio-row.js` and `link-group-editor.js`, rather than grow one file |
| `radio-engine-stub.js` | the stub engine, deleted at integration |

`crc-sync/src/radio/bands.js`, with a parity test holding the two `bands.js` equal (see how the existing client/server
parity tests read each other's files).

## Requirements (ADR 0158 §2, §3 and the rulings)

- **Position radios.** For each Position this session staffs, find its frequency rows in `frequency-state.js`'s rows:
  `kind: 'POSITION'`, its `positionId` and Facility. The first row of each band, in table order (shipped rows first,
  then added rows in the order they were added), is the Position's radio.
  - The human confirmed "first row is fine".
  - A row outside both bands gets no radio. The panel notes it once, in grey (dark-cockpit, memory).
  - Find where the client knows which Positions it staffs (EFSP state). Read it, don't copy it.
- **Guards.** Always 243.000 UHF and 121.500 VHF, two separate radios, **not linked to each other or to anything** by
  default.
- **Manual radios.** Add, retune, remove; kept in `radio-prefs.js`.
- **Link groups.**
  - One automatic group holds every Position radio not unlinked.
  - The controller can create, rename and delete groups (default names A, B, C…) and move any radio (Position, guard,
    manual) into one or out of all of them.
  - A radio is in at most one group. Membership is kept by radio identity, so a group survives a retune and a restart.
  - A Position radio moved to a user group stays there when the Position is staffed again.
  - **A frequency is in at most one group**: if a second radio on the same frequency would join another group,
    `link-groups.js` keeps the first and sets `conflict` on the second.
  - Write these rules as pure functions with thorough unit tests: staff, unstaff, retune, a conflict, delete a group
    with radios in it (they become unlinked).
- **Per-radio identity**, not frequency, for volume, pan and mute.
- **The panel.**
  - Rows by group, with the automatic group first, then the user groups, then the unlinked radios.
  - Each row shows the label, the frequency, the band, RX/TX lit from the engine state, volume, pan, mute, and a link
    menu (move to a group or unlink).
  - A small group editor (create, rename, delete).
  - A PTT target selection: transmit on the selected radio's group.
  - Device pickers and the PTT key, taken from `srs-radio.js`'s current features. Port what is there; drop nothing
    the controller uses today without logging it.
  - Dark-cockpit style (memory: grey unless a problem, show only what the controller needs) and the existing panel
    look; check how the other panels are styled.
- **Mount.** The new panel mounts as its own dock panel (for example "RADIO 2"), beside the existing SRS panel, which
  stays the default. The supervisor swaps them at integration.
- Acyclic module graph, no `window` globals (the two tests named in the README).

## Not this lane

Anything in `app/srs/`, audio, the codec, the engine (RADIO-CORE); the relay and leases (step 4); ATIS (step 5);
crc-sync, except `src/radio/bands.js` and its parity test.

## Deliverables

- the code and unit tests;
- `docs/wip/RADIO-SET.md`: the defaults you took, what the usage guide should say, findings for RADIO-CORE.

ADR: none (0158 covers it). Report per lane-rules rule 8.
