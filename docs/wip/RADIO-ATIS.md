# RADIO-ATIS: ATIS on two frequencies (ADR 0158 §5, step 5)

## What changed

- **Config.** `crc-sync/src/apt-config.js`: each airport entry gains `vhfFreq` (string, '' = none). A value must be a
  plain MHz number (`^\d{1,3}(\.\d{1,3})?$`) in the VHF band from `src/radio/bands.js`, or ''. A patch with a bad
  `vhfFreq` is refused whole (returns false, nothing persisted, no broadcast). New entries default `vhfFreq: ''`; an
  entry saved before this has no `vhfFreq` and loads as it is (readers take missing as ''). No migration, lenient read
  kept (an unreadable `apt-config.json` still starts empty). The dead module-level `statePaths(... process.env ...)`
  read at the top of the file (shadowed by the one inside `createAptConfig`, and a require-time env read) is removed.
- **Transmit.** `POST /api/atis-transmit` is now `crc-sync/src/atis-transmit.js` (`createAtisTransmitHandler`), mounted
  by `app/http-routes.js`. Body: `{ ownerId, frequencies: [hz, hz?], ssml, coalition, position }` or
  `{ stop: true, ownerId, frequencies }`. One or two distinct positive whole-Hz values, else 400. The single
  `frequency` field is gone (no backwards compatibility; old clients are blocked by the same release's protocol bump).
  - Start: `AtisStore#firstRefused(freqs, ownerId)` checks every frequency first; if one is held by another client the
    start is refused whole: `409 { error: "Another client is already transmitting on 121.500", reason: 'in-use',
    frequency }`, nothing started. Otherwise one `grpcClient.transmitAtis` per frequency, concurrently, both registered
    in the store, `atisActive` broadcast (lists both). The answer waits for **both** calls (`Promise.allSettled`):
    `200 { ok, duration_ms: max }`, or `503 { error: "121.500: <reason>", frequencies: [failed] }`.
  - Stop: releases and cancels each named frequency (owner only), broadcasts.
  - `grpc-client.js` is untouched (still one frequency per call).
- **Client.** `crc-desktop/app/public/js/panels/aprt-atis-freqs.js` (new, pure, imports `radio/bands.js`): band hints,
  the Hz list, the in-use check over both. `aprt-panel.js`: VHF input wiring, the loop posts `frequencies`, STOP
  releases the frequencies the loop last started on (and a tick releases a frequency edited out mid-loop), the 409
  line names the frequency, the live "IN USE" line covers both. `settings.aprtAtisVhfFreq` (new key, per airport),
  filled from the `apt-config` frame's `entry.vhfFreq` in `app.js`. `index.html`: the FREQ input is relabelled
  **UHF (MHz)** (placeholder 251.000) and a **VHF (MHz)** input (placeholder "optional") sits beside it, same style.
  `css/aprt-panel.css`: `.aprt-atis-freq-bad` (red border) when an input's value is wrong for its band.
- **Tests.** `crc-sync/tests/atis-transmit.test.mjs` (new, 8), `crc-sync/tests/atis-store.test.mjs` (+1),
  `crc-sync/tests/apt-config.test.mjs` (+4, two shapes updated for `vhfFreq: ''`),
  `crc-desktop/tests/aprt-atis-freqs.test.mjs` (new, 3). `crc-desktop/tests/fixtures/module-graph-exports.json` gains
  the new module's exports (hand-edited, not re-recorded).

## Wire

The scan (`tools/wire-surface.js`) takes only the top-level keys of the `atis` frame (`version`, `type`, `active`) and
the `apt-config` frame (`version`, `type`, `airports`), and the message type `aptConfigSet`. None changed: `vhfFreq`
is inside an airport entry and inside the `aptConfigSet` message, `atisActive` entries keep `{frequency, ownerId}`.
`POST /api/atis-transmit` is REST, not scanned. **No `wire:record` needed for this lane**; the REST body change
relies on the protocol bump RADIO-RELAY's family brings to the same release (crc-desktop 2.2.0).

## Defaults taken

1. **The UHF frequency is not band-checked**, on the server or as a block in the client: it never was (a free string,
   placeholder "121.500"), so a saved VHF value in it must stay settable and still transmit. The client only marks the
   input red (title "Not in the UHF band.") when its value lies outside UHF. Dark cockpit: grey otherwise.
2. **The VHF frequency is refused outside the VHF band** (server refuses the patch; client does not send it and keeps
   the input red until corrected).
3. **TRANSMIT still requires the UHF frequency** (as it required FREQ before); VHF alone is not enough. VHF is optional.
4. **A bad patch is refused whole** rather than applying its other fields.
5. **The ownership check is unchanged**: another client is refused only while a call of the holder is in flight
   (`canStart`, 8 s TTL), as before; the presence list (`atisActive`, 45 s) only drives the "IN USE" hint. See finding 1.
6. **Duplicate frequencies**: the client sends a frequency once (UHF and VHF inputs equal → one); the server refuses a
   repeated frequency with 400.
7. **A failure on one frequency fails the tick** (503 naming it); the client's loop stops and STOP releases both, as a
   one-frequency failure did before.
8. **The old `frequency` body field is not accepted** (lane rule 5).

## Usage guide text (for `docs/efsp-usage-guide.md` or the APRT section, wherever ATIS is described)

> **ATIS on UHF and VHF.** The ATIS block in the Airport panel has two frequency boxes: **UHF** and **VHF**. VHF is
> optional. With both filled, TRANSMIT broadcasts the same ATIS on both frequencies at once, and the next broadcast
> starts only after both have finished. STOP stops both. A box turns red if its frequency is outside its band (VHF
> 118.000 to 136.975, UHF 225.000 to 399.975); a red VHF frequency is not saved and not transmitted. Both frequencies
> are saved for the airport and shared with every controller. If another controller's ATIS is already on either
> frequency, the line beside TRANSMIT says **IN USE** with that frequency, and TRANSMIT is refused until it is free.

## Findings for the supervisor / other lanes

1. **Ownership gap during the 5 s pause (pre-existing).** `AtisStore#canStart` looks only at in-flight calls, so in the
   pause between two of A's ticks a client B can start on the same frequency, and both loops then alternate. The
   existing test `finish only clears the entry if it is still the same in-flight call` pins this. Closing it means
   letting a fresh presence entry (`_active`, 45 s) refuse another owner too. Not done here (behaviour change);
   supervisor to decide.
2. **`module-graph-exports.json` hand-edited** (one new entry, `panels/aprt-atis-freqs.js`); RADIO-RELAY will likely
   touch the same fixture: expect a trivial merge conflict, or re-record with `GOLDEN_RECORD=1`.
3. Not walked: the real panel in Electron and a real DCS-gRPC SRS on two frequencies (no gates in lanes). Manual test:
   fill UHF and VHF at an airfield, BUILD, TRANSMIT, check both frequencies in SRS, STOP, check `atisActive` clears both;
   from a second client, TRANSMIT on the VHF alone and check the 409 line names 121.xxx.
