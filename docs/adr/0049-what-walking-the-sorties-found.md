# 0049 — Five things walking the WP5 and radar sorties by hand found that the suites did not

## Context

`docs/adr/0042`–`0047` shipped with 918 crc-sync tests and 282 crc-desktop tests, all green, including fourteen scenario walks. The suites were then set aside and each sortie was walked by hand against the code — not "does the assertion pass" but "what does a controller actually do next, and what does the system do about it".

That is the technique the briefing's §3D table credits with every one of the seventeen defects found in the previous pass, and the reason it keeps working is that a test asserts what its author already thought of. Five more things came out of it, all in machinery that had just been written, reviewed and covered.

Recorded together because they came from one exercise and share a shape: **each one is a state transition nobody had a reason to sit through.**

## Decision

### 1. Coverage was never re-sent when the radar list changed

`ws-hub.js` grew `refreshAllCoverage()` in `docs/adr/0042`, and only `setMissionData` ever called it. But the radar list also changes *within* a mission, every time an AWACS takes off or lands or a ship spawns — and `positionRadars` gives `TAC_C2`/`AIC`/`GCI` a `coalition: 'own'` airborne selector, so for an MRU the list is *entirely* made of radars that come and go.

Walked as a sortie: a GCI controller takes their Position with no AWACS airborne, and correctly sees an empty picture with the **NO RADAR COVERAGE** banner. The AWACS then takes off. The coverage sweep picks it up, so contacts start arriving and drawing — while the coverage panel still lists nothing and **the banner saying they have no coverage is still up**. Nothing would clear it until they re-declared their Positions or the mission reloaded.

The sweep noticed; the client was never told. Fixed by comparing the resolved radar-id set on each coverage tick and refreshing when it differs — once per takeoff, not once per tick.

### 2. Illumination outlived the radar that produced it

The swept set is scoped to **occupied** Positions (`docs/adr/0043`: "an unattended airfield's radar costs nothing"). `CoverageEngine._illuminated` was only pruned when a *track* left `TrackStore`, never when a *radar* stopped sweeping.

Walked: the last controller holding Approach vacates. Its radar stops sweeping, but its entries stay put with their timestamps frozen. Minutes later somebody takes Approach again, `_refreshCoverage` sends them a snapshot, and `isVisibleThrough` still says yes — so they are handed contacts stamped `illuminatedAt` from before the gap. The client fades from that stamp, so the contacts arrive already faded and expire on the spot.

Self-correcting within one scan, which is exactly why no test caught it and why it would have read as a bug rather than as radar behaviour. `_pruneUnsweptRadars` now drops radars nobody is looking through, before the sweep rather than after; a contact another manned radar also sees keeps that radar and stays.

### 3. A correlation record for a finished flight was never retired

`releaseFdr` frees the beacon code and **does not delete the FDR** — deliberately, and it predates this work. So an FDR whose Strips are all `DROPPED` lives forever, and its correlation record lived with it: never swept again (eligibility requires a live Strip), frozen at whatever it last was, still carrying a `trackId` the flight has no claim on, and still sent in every snapshot. Over a long session the snapshot grows without bound.

`retireFinished` now drops records for FDRs with no live Strip anywhere. **Retired, not cleared:** the flight is finished rather than lost, so a warning would say something is wrong when nothing is. And the distinction from eligibility is load-bearing — a Strip sitting at `PROPOSED` is live but ineligible, has no contact *yet*, and must not be retired. Both halves are asserted.

### 4. A correlated contact outside your coverage rendered as a callsign

This is the seam between the two phases, and it only appears when both are in place.

Correlation is worked out once, server-side, against every contact the server knows about — a fact about the flight (`docs/adr/0045`). Coverage is per-Position and about the controller (`docs/adr/0042`). So a Strip can be correctly correlated to a contact **this** controller cannot see: an en-route flight bound on somebody else's radar, or — routinely — any flight at all while a Ground controller is looking at a Strip.

`correlationBadgeFor` fell back to `record.trackId` when the contact was not in the local picture, so the badge read `TRK 101`. A bare DCS unit id, rendered in the slot where a callsign goes, next to a Strip whose ring never appears when clicked. It reads as a correlation to an aircraft called "101".

The badge now says what is true: `TRK ··`, dimmed and italic, with "correlated, but the contact is outside your radar coverage" and the matching rung in the tooltip. Guide §6.6 rule 4 asks that selecting a Strip highlight its contact; when the contact is outside your picture, the honest answer is that there is nothing to highlight.

### 5. Binding was pointer-only, and the ring was stale after a reconnect

Two smaller ones from the same walk.

Guide §7.1 rule 5: *"A dot-command surface is a primary feature, not a power-user extra."* Rule 4: data-entry positions *"MUST have an efficient keyboard path."* WP5 shipped binding as a popover reachable only by clicking a badge. `.bind <track id>` and `.unbind` now sit beside `.find`/`.drop`/`.undo`. `.bind` with no argument refuses and says to use the picker — guessing a contact on the controller's behalf is the one thing the server declines to do, so the keyboard path must not do it either.

And `case 'efsp-snapshot'` did not refresh the correlation ring. On a reconnect with a Strip still selected, the ring stayed absent until the next reconcile delta happened to touch that flight — which on a quiet board could be a long time.

## Alternatives considered

- **Refresh coverage on every `grpcClient.on('unit')`.** Rejected for `docs/adr/0046`'s reason: that fires hundreds of times a second for a picture that has not meaningfully changed. Comparing the id set on the existing 250 ms tick costs one join and fires once per actual change.
- **Keep illumination and let the client discard stamps older than the fade window.** Rejected: it pushes a server bookkeeping mistake onto every client to paper over, and the client cannot tell "stale because the radar stopped" from "stale because the beam is slow".
- **Clear a finished flight's record to `UNCORRELATED` rather than retiring it.** Rejected: that is the shape used when a match is *lost*, and it would put a `NO TRK` on a flight that has landed and gone. Different fact, different handling.
- **Keep retired records for their history.** Rejected: `transitions[]` is a live record's own history, and what a controller actually *did* — every bind and unbind — is in the Mutation log, which is where attributable history belongs. Retention of the audit log is §11.3's question and WP8's to answer.
- **Show the raw track id when a contact is outside coverage**, on the grounds that it is information. Rejected: it is information in a slot the controller reads as a callsign. An id that looks like a name is worse than no name.
- **Send every controller every contact so this case cannot arise.** Rejected — that is undoing `docs/adr/0042`.
- **A `.trk` verb taking a callsign rather than a track id.** Rejected: a callsign is the thing that is ambiguous in the first place; the whole point of rung 1 is naming a specific contact.

## Consequences

- **Every one of the five has a test named for the walk rather than for the code**, so the reason survives: `tests/coverage.test.mjs`'s "illumination does not outlive the radar that produced it" and the two-radar variant, `tests/efsp-correlation-reconciler.test.mjs`'s retire pair including the live-but-ineligible case, `crc-desktop/tests/efsp-correlation-client.test.js`'s three out-of-coverage cases, and four `.bind`/`.unbind` parse cases.
- **One of the new tests caught an existing test's fixture.** `'a fuzzy match reports its confidence'` had never supplied a track, so under the corrected behaviour it began reporting "outside coverage" — correctly. The fixture was wrong and the assertion had been passing for the wrong reason. Worth noting as its own small lesson: the fix exposed a test that was green without being right.
- **crc-sync 913 → 918, crc-desktop 279 → 282.**
- **The `TRK ··` state is in the controller guide** (§8C), with the sentence that explains why it exists: correlation is about the flight, coverage is about you.
- **A Ground controller now sees `TRK ··` on every Strip**, because they have no scope at all. That is accurate rather than noisy — they genuinely cannot see any of it — but it is a lot of identical badges, and if it grates in use the right answer is to suppress the badge entirely when coverage is empty, not to go back to printing track ids.
- **What this exercise says about the suites:** all five gaps sat in transitions — a radar appearing, a Position being vacated and retaken, a flight ending, a reconnect. The scenario walks cover a flight's life; none of them covered the *facility* changing underneath one. That is the gap in the sortie suite itself, and it is worth a WP8 pass of its own: manning churn and radar churn as first-class scenarios rather than as setup for something else.
