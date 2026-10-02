# SJ-C working file

Lane SJ-C, branch `lane/SJ-C-split-join-ui`, ADR 0099 (client half). Wire from `docs/wip/SJ-S.md` (final).

## Code as found (step 0, post-rename names)

| Briefing symbol | On this base |
|---|---|
| popover module `bay/popovers/formation.js` | new; siblings `marsa.js`, `bind.js`, `tofi.js` are the pattern (portalled by `_mountPopover`, dismiss listener tests the target) |
| Strip menu | `_stripMenuItems` in `strip-view.js`; items carry `group`, so "Formation" is a new group |
| dot-command verbs | `panel/dot-commands.js` `_dispatchDotCommand` (parser `dot-command.js` is verb-agnostic) |
| strip template rows | `9A-SPEED` already in the DEPARTURE, ARRIVAL and OVERFLIGHT Block Maps (`kind: 'clearance', field: 'speed'`); ARRIVAL already reads the cell. Only the compact face lists (`strip-fields.js`) lacked it |
| client flight-data mirror of `clearance.speed` | nothing to add: `getPath`/`clearance` read is generic, the cell arrives with the flight data |
| indicator row | `INDICATOR_ORDER` + `_litIndicator` in `strip-view.js` |
| refusal display | global banner (`_showMutationError`, `panel/refusal.js`); `MUTATION_ERROR_MESSAGES` had no `ASSIGNMENT_REQUIRED` |
| acting Position | `_resolveActingPositionId` (owner if signed on, else first signed on) |

## What shipped

- `formation-rules.js` (pure): mirrors of eligibility, ground states and grant holders (held to the server by `tests/efsp-formation-rules.test.mjs`), `.split` parser, form validation, offers, SPLIT chip text.
- Strip menu group "Formation": `Split…` (listed disabled with the reason on a single aircraft or open exchange) and `Join formation…` (only when a lead exists and the flight has no other live Strip).
- `.split <k> <CALLSIGN> [<H270|S250|SM.80|A120|FL240>] [MARSA]`, `.join <LEAD>`.
- `SPLIT` chip, title "split from VIPER1 at 1432Z".
- Speed Block (`9A-SPEED`) added to the DEPARTURE/ARRIVAL/OVERFLIGHT compact faces and AP/CTR/SFA lists.

## Shared files touched (few lines each)

`strip-view.js` (menu items, chip, imports), `panel/dot-commands.js` (two verbs), `panel/refusal.js` (one message), `strip-fields.js` (face lists), `css/efsp-panel.css` (appended). Not touched: UNDO-C's toast, `undoable`/`undone` handling, `efsp-undo-voided`.

## Defaults taken

- Server refusals show in the existing refusal banner (the popover closes on send); client prevalidation shows inline in the popover. Keeping the popover open for the ack would need a per-mutation ack hook in `refusal.js`, which UNDO-C is working in.
- Callsign is checked client-side only for format and "not the lead's own"; live-duplicate checking is left to the server.
- Join: the selected Strip is the joiner (as ADR 0099), the picker lists leads. `.join` takes the lead's callsign.
- Split offered/enabled only to the Position that owns the Strip and is in the grant set; a tactical or carrier Position never sees the group.
- Bare altitude digits and `A`/`FL` forms are passed to the server unchanged; heading is zero-padded to 3 digits.

## Not done / findings

- Ack `split`/`join`/`warning` text (mixed formation) goes through `_showMutationWarning`, which has a fixed message map and shows the raw string otherwise; no extra work.
- Usage-guide split/join section: see below, written to `docs/efsp-usage-guide.md` per the briefing.
