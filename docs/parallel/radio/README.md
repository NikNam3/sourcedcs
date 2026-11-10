# Radio rework, wave 1 (ADR 0158 build steps 2 and 3)

Two lanes in parallel plus a questioner, supervised by the main session. Every lane follows
`docs/parallel/lane-rules.md` (worktree, commits, no test gates, P2 defaults) and ADR 0158 §6, which says: **no god files**.
Each file has one job, and a file that would grow past about 300 lines is split by job. No central "radio manager".

| Lane | Worktree | Branch | Step | Owns |
|---|---|---|---|---|
| RADIO-CORE | `/home/nklx/dev/personal/sourcedcs-RADIO-CORE` | `lane/RADIO-CORE` | 2 | `crc-desktop/app/srs/**`, `app/server.js` (the `/srs` route only), renderer audio and engine modules (below) |
| RADIO-SET | `/home/nklx/dev/personal/sourcedcs-RADIO-SET` | `lane/RADIO-SET` | 3 | the derived radio set, link groups, bands (both repos), prefs, the new panel DOM |

Questions go to `docs/parallel/questions-radio.md` (the questioner) and are settled in `docs/parallel/decisions.md`
(the supervisor). Lanes read `decisions.md` in the main checkout by absolute path.

## The contract between the lanes (binding for both)

RADIO-SET produces the radio set; RADIO-CORE consumes it. Neither lane imports the other's files. The supervisor
integrates the two after both report.

```js
// app/public/js/radio/radio-set.js (RADIO-SET) returns:
{
  radios: [{
    id: 'POSITION:<positionId>:UHF' | 'POSITION:<positionId>:VHF' | 'GUARD:UHF' | 'GUARD:VHF' | 'MANUAL:<id>',
    kind: 'POSITION' | 'GUARD' | 'MANUAL',
    positionId: string | null,
    band: 'UHF' | 'VHF' | null,       // null: outside both bands (no Position radio is made for such a row)
    mhz: number,
    modulation: 'AM',                  // the only one ADR 0158 uses; keep it a field
    label: string,
    groupId: string | null,            // null: unlinked
    conflict: string | null,           // e.g. 'frequency already in group B'
  }],
  groups: [{ id: string, name: string, auto: boolean, radioIds: string[] }],
}
```

```js
// app/public/js/radio/radio-engine.js (RADIO-CORE) exports:
setRadios(radios)                 // the radio set's `radios`, whole, every time it changes
setPtt(down, radioId)             // transmit on radioId's whole group (or radioId alone if unlinked)
setRadioAudio(radioId, { volume, pan, muted })
setDevices({ inputId, outputId })
onState(fn)                       // fn({ connected, error, rxRadioIds:[...], txRadioIds:[...], opusSupported })
```

Until integration, RADIO-SET's panel talks to a stub engine with the same exports (`radio-engine-stub.js`, which RADIO-SET
owns and the supervisor deletes on integration). The existing `srs-radio.js` and `lxsrs_v2` stay untouched and stay the
default. Neither lane removes or edits them.
