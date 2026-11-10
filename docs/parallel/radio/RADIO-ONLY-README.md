# Radio-only wave (ADR 0161)

Two lanes and a questioner, supervised by the main session. `docs/parallel/lane-rules.md` binds. No god files.

| Lane | Worktree | Owns |
|---|---|---|
| RO-MODE | `../sourcedcs-RO-MODE`, `lane/RO-MODE` | ADR §1, §2: `launch-mode.js`, the mode handling in `main.js`, `radio-only.html`, `radio-only-main.js`, `radio/radio-only-feed.js`, the RADIO ONLY and FULL CRC buttons, the panel's radio-only differences |
| RO-PTT | `../sourcedcs-RO-PTT`, `lane/RO-PTT` | ADR §3: `global-ptt/**`, `app/preload.js`, `ptt-controller.js`, `radio/radio-ptt.js`, `radio/global-ptt-setup.js`, `radio-setup.js`, `package.json` and its packaging test |

**Contact between them.** RO-PTT adds one line to `main.js` (`require('./global-ptt').attach(win, ...)`) right after the
window is created, and RO-MODE creates the window; each keeps its `main.js` change small. RO-MODE passes the default for
Global PTT through `/js/config.js` as `var RADIO_ONLY = true|false`; RO-PTT reads it with `typeof RADIO_ONLY` for the
default (on in radio-only, off in the full app). Questions: `docs/parallel/questions-radio-only.md`; decisions in
`docs/parallel/decisions.md`.
