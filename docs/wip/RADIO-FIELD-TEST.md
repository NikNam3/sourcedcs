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
3. **A pilot tuned to two frequencies of one network hears themselves, and everyone else double.** Read in the SRS source
   (ciribob master `d01f540`, 2026-10-12):
   - One packet carrying several frequencies plays once, on the best radio (`UDPClientAudioProcessor.cs`: `i == 0 ||
     IRL_RADIO_RX_INTERFERENCE`). So a controller's own group transmission is not doubled.
   - The pilot's original and crc-sync's relayed copy are two packets. Each plays on its own radio: the jitter buffer is
     per `OriginalClientGuid` and per receiving radio (`ClientAudioProvider.cs`), so nothing de-duplicates them.
   - The receive path has no `OriginalClientGuid == own` check, so a pilot's own relayed voice plays. (The commented-out
     check at `RetransmitAudio` covers retransmission only.)
   - The relay cannot send as the pilot to be excluded from the recipients: the server stores the sender's address
     against the packet's `Guid` (`UDPVoiceRouter.cs`, `client.VoipPort = udpPacket.ReceivedFrom`), so that would break
     the pilot's own audio.
   - Possible mitigation, not built: crc-sync sees every client's radios (the server's `RADIO_UPDATE`), so it can skip a
     target frequency when nobody tuned to it needs the copy, i.e. everyone on it already hears a source frequency.
     What is left: a pilot on both while another pilot is only on the second. Only a change in the SRS client removes that.
