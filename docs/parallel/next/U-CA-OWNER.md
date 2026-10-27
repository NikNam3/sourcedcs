# Briefing: U-CA-OWNER: a conflict alert is shown only to the Positions working the aircraft

Written 2026-10-27 by the supervisor. One agent, Opus 5.5. **Dispatch after U-VFR-REDO merged** (it changes who has track
control: the STARS handoff, VFR strips). Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-CA-OWNER`, branch `lane/U-CA-OWNER`; E2E lane named at dispatch). `nice -n 19`.
Grep `decisions.md` (H176, S-ARCH-112, ADR 0118, 0145), never read it whole. ADR: next free number.

## Ruling (H176, human 2026-10-27)

The human asked whether a Position not responsible for a flight should see its conflict alert at all; the supervisor
found it does today and proposed restricting it; human: "jup que that after the vfr redo".

- **CA:** shown only at the Position(s) with track control of either aircraft (the Position holding its Strip,
  VFR strips included).
- **MCI:** shown only at the Position with track control of the tracked aircraft (plus today's per-Facility base
  altitude and inhibit, `deliverableTo`).
- Everyone else: nothing. Two untracked: nothing (unchanged).
- The suppress (ADR 0145) then only ever exists where the alert is shown: remove S-ARCH-112's extension that opens the
  label menu for a non-owner in a suppressible CA.

## Cases to prove (human 2026-10-27: "is the case where one aircaft participating in the CA belons to controller A and the other to Controller B handled correctly?")

- **A owns one aircraft, B the other (two sessions):** both are shown the alert, nobody else; each sees the other's
  Position letter on the other data block (`atc-scope.js` ~161, the coordination cue of ¶5-14-6); A's suppress leaves B's
  alert flashing and the reverse. A spec with two sessions.
- **One session holds A and B (consolidated):** today ADR 0145 suppresses only at the acting Position and the client shows
  "suppressed" only when every Position it is shown at suppressed it, so one click leaves it flashing. Fix: a suppress
  from a session applies at every Position that session holds where the alert is shown (one person, one acknowledgement).
  A spec for it.
- Not built, keep it so: suppressing at another controller's Position after coordination (¶5-14-6 c.4).

## Where

`crc-sync/src/ws-hub.js` ~l.215–219 (today: every ATC session that sees both tracks), `crc-sync/src/conflict-alert.js`
(`deliverableTo`, `presentFor`, `setSuppressed`'s "shown there" check), the client label-menu open rule
(`crc-desktop/app/public/js/panels/efsp/label-menu.js`, `map-interactions.js`). Track control = the Strip holder as
U-VFR-REDO leaves it; a handoff in progress: both the initiating and the receiving Position until accepted (check the
STARS manual wording if available, else take this default and log it). One acting Position (rule 9).

FAA: JO 7110.65BB ¶5-14-6 ("If another controller is involved in the alert, initiate coordination"; not suppressed
"at or for another control position without being coordinated"). The exact STARS display routing is in the STARS
manuals, not the order: search for it, quote what you find, else say so in the ADR.

## Gates (superseded 2026-10-27: lanes run no gates, the supervisor tests)

Per the test policy: touched files while working; once before the report both unit suites, freeze, `soak:selfcheck`
(`ws-hub.js`), the CA specs (`command grep -l -i -e conflict -e suppress crc-desktop/e2e/*.spec.js`) on your E2E lane.
Final message per rule 8.
