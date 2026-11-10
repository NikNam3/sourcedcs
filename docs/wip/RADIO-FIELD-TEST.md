# Radio field test (2026-11-10, local crc-sync + crc-desktop on main, squadron SRS server)

## Fixed during the test
- RX broken/choppy: packet numbers were read back from AudioDecoder timestamps, which Chromium restates (44245e35).
- RX too quiet, 5x only raised the static: volume now applies to the voice alone; voice unfiltered as lxsrs_v2 (09a528d1).
- Update-required overlay had no way to the connection settings (cd64a234).

## Seen working
- OPS to GND relay; two pilots on 323.300 relayed onto the other six frequencies of their network.
- No own audio came back (CRC_SRS_DEBUG log: no `OURS` line).

## Open (the human: "don't fix this second", fix before 2.2.0)
1. **A pilot's transmission is ended early for a moment.** The release tone plays and the static stops while the pilot
   keeps talking; about 40 ms later the static (a new transmission) resumes. Likely cause, not yet confirmed: the
   renderer's main thread stalls (map work) for more than `RX_TIMEOUT_MS` (450 ms); when it resumes, the 50 ms `rx.tick`
   timer runs before the queued `/srs` frames are handled, sees no packet for 450 ms and ends the sender, and the next
   frame starts a new one. Candidates: judge the timeout on the frames' arrival time at the local server (carried in the
   frame header), or end a sender only after the queued frames are handled; check with a long-task trace first.
   Still seen after the volume and layout fixes (the human, 2026-11-10 evening: "incoming audio still sometimes cuts
   off"), so it is not caused by the band-pass or the mixer.
2. **The controller cuts out for pilots now and then** (TX). Suspect the same main-thread stalls bunching the frames
   sent; measure the send spacing at the local server before changing anything.
