# GRPC: unit-stream reconnect loop (re-investigation)

Branch `lane/GRPC-reconnect-loop`.

## Finding

The loop (about 5,000 `[grpc] unit stream ended, reconnecting` lines a session) is the bug LG already
fixed and merged (`3b27390`, `docs/wip/LG.md`, `docs/parallel/research/grpc-reconnect-loop.md`).
Cause: `StreamUnits({poll_rate: 0})` made DCS-gRPC panic after the full sync and end the stream with
OK, and the client retried at a fixed 1 s. The logs counted in the research note (5,066 `ended` lines,
about 40 a minute) came from the pre-LG client, and every item the briefing asks for is already on this
branch and tested in `crc-sync/tests/grpc-client-stream.test.mjs`:

- poll_rate floor 1, max_backoff default 5 (never `08 00` on the wire);
- backoff `min(30 s, 1 s * 2^n)` with jitter, reset only after a stream stayed up 5 s (not on first data);
- `ended` log once, then at most one summary a minute with a counter.

If the dev crc-sync on :3000 still shows the loop, it is running pre-LG code and needs a restart (not done by this lane).

## Change in this lane

A hard floor on the reconnect rate: `_backoffDelay` is now `max(base, jittered)`, so jitter can no
longer produce a delay under 1 s (before, 0.5 s at retry 0, i.e. up to 2 attempts/s for a server that
ends a stream just after the 5 s stability window). One new test.

## Human live check (still pending, unchanged from LG.md)

The four-point 10-minute check in `docs/wip/LG.md` (one `connected`, parked units persist, `gone` in
about 1 s, no DCS-gRPC panic). Nothing here needs more live verification.
