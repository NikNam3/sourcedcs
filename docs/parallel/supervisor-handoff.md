# Supervisor handoff

Start here if you are the supervising session for the EFSP parallel lanes. Read, in order:

1. `docs/efsp-parallel-plan.md`: the lanes, the waves, the shared-file rules (§2), and your role (§1).
2. `docs/parallel/decisions.md`: **the record.** Every ruling (P = process, D = supervisor round 1,
   H = human, S-* = supervisor). It wins over any briefing. Lanes read it by absolute path
   (`/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`), so a new row reaches them
   without a rebase.
3. `docs/parallel/wave1/L1.md` … `L11.md`: the wave-1 briefings. Each ends with a supervisor addendum
   that points back at `decisions.md`.

## State (2026-09-30)

- **Integration branch:** `efsp-wp5-correlation`. Cut lane worktrees from it (P1: `lane/L<n>-<slug>`).
- **Pre-wave work is done and committed**:
  - F1 mission clock (ADR 0079);
  - ADR 0060, the ADR corrections;
  - the 0058 Notes;
  - the plan and every briefing.
- **Wave 1 is ready to dispatch:** L1–L11, with up to 11 agents at once. Launch a **questioning
  agent** alongside, as P-roles in plan §1 describe.
- The local crc-sync on :3000 runs the committed code. **Restart it after any change under
  `crc-sync/src/`** (Node doesn't hot-reload).

## The Decision Desk (how questions reach the human)

- Page: https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7. The source is
  `docs/parallel/decision-desk.html`. Republish from that file with `url` set to the link above;
  read the artifact first.
- Capabilities: `db` with rule `{path:"questions", read:"view", write:"admin"}`, plus `user`.
- The `questions` collection is written by you. Fields:
  - identity and grouping: `lane`, `laneName`, `title`, `round`, `order`;
  - content: `context`, `question`, `options[{key,label,description}]`;
  - recommendation: `recommended`, `recommendNote`;
  - state: `blocking`, `status` (`open` | `settled` | `withdrawn`), `resolution`.
- The `answers` collection is written by the human and keyed by question id:
  `{choice, note, updatedAt}`. `choice` may be null when only a note is given.
- The loop:
  1. List `answers` via ArtifactData.
  2. For each new answer, log an `H<n>` row in `decisions.md`.
  3. Update the question to `status:'settled'` with a one-line `resolution`. Updates to existing
     docs need `if_version`; read the doc first.
- Put new questions from the lanes or the questioner here, with options and a recommendation.
  Rule on anything that isn't genuinely the human's call yourself (P2), and log it.

### Open on the desk now

- **Blocking:**
  - **C1:** when to build coalition isolation (L21).
  - **C2:** where a session's coalition comes from.
  - The recommended defaults are "design ADR during wave 1, build solo right after it" and "from the
    Facility/Position". Until answered, the wave-1 rule in H14 holds: no code reads a global own
    coalition.
- **Not blocking:**
  - S2: hostiles on ATC scopes.
  - S3: owner letter after TOFI.
  - A1: atobrief's missing ATO fields.
  - L11-2: classification line.
  - L11-8: ABM/IC/RADAR agency types.
  - Q76: soak traffic profile. It follows H12: 1–4 controllers, 3–20 aircraft.
  - Lanes take the listed default until one is answered.

## Things waiting on a lane or a later wave

- **L2 mockup gate (H10):** L2 makes a Strip mockup, and you publish it as an artifact for the human.
  L2 continues with server work only until the human approves.
- **ATC scope:**
  - Approved as variant B of `docs/parallel/research/stars-mockups.html`
    (https://claude.ai/artifact/WX2iTcgENzLETakrdXLfDq), recorded as H41.
  - Built by **L22**, after L10 and L1b. It includes a per-user "ATC map background" toggle for the
    strict look.
  - ERAM for CTR is a later lane.
- **L21 coalition isolation:** planned, with timing set by C1.
- **Bugs for later lanes:**
  - **L8:**
    - B1: a transfer to JTAC strands the Strip.
    - B2: TOFI exit is blocked while the AIC holds the line.
    - B3: a covering reassign doesn't move the Bay.
    - B4: a transfer lands in another Position's Bay.
    - B5: the JTAC may bind or declare MARSA. H40 says the JTAC sees only Strips handed to it.
  - **L1:**
    - SetState bypasses runway suspension.
    - NLA always queues to `rwy-05`.
  - **L6 / wave 2:**
    - Order keys grow without rebalancing.
    - DROPPED Strips and FDRs are never evicted. The fix is scheduled by H36.
  - **Questioner Q43:** typed time Blocks store strings where epoch ms is expected. Any HHMM editor
    must resolve against the mission clock's date (`missionNow()`), never the wall date (F1 note).
- **F1 follow-ups:**
  - Check the theater offsets for Normandy (0), TheChannel (+2) and SinaiMap (+2) in the mission
    editor. They sit in `crc-sync/config/theaters.json`.
  - Magnetic variation (H15) is to be added to that same per-theater table.
- **Pre-existing, not caused by F1:** crc-sync logs `[grpc] unit stream ended, reconnecting` in a
  tight loop, about 5,000 times per session. It is worth a look outside the lanes.

## Rules you must keep

- **Never commit without the human's go-ahead.** Lanes commit on their own branches only. You merge
  in plan §3 order, but only when the human says so.
- **ADRs are never edited once committed** (P4). Corrections go in new ADRs.
- **Tuning files are read once at startup and never written by code** (P5).
- No backwards compatibility (alpha). The wire carries only what sensors know (ADR 0059).
- Declutter behaviours stay off until the end of the EFSP work (H6).
