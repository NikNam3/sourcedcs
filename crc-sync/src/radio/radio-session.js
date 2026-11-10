'use strict';

// A radio-only /feed session (docs/adr/0161, decisions S-RO-1 RO1): crc-desktop's radio window, opened with `&role=radio`.
// It belongs to a signed-in user, but it is never that user as a controller: it does not keep or cancel a sign-off, and
// it holds no Position, however many the same user holds elsewhere. It gets `status`, `update-required`, the relay's
// directed frames and the frequency table's rows (its + RADIO picks). The role is a query parameter, not a frame, so it
// is outside the wire scan; an old server ignores it.

/** The hub frames such a session is sent; the relay's are directed, so they never pass this check. */
const SENT_TO_RADIO_ONLY = new Set(['status', 'efsp-frequency-delta']);

function isRadioOnlyRequest(req) {
  return new URL((req && req.url) || '/', 'http://x').searchParams.get('role') === 'radio';
}

/** May this broadcast reach `session`? Everything may reach a controller's session (or an unknown socket). */
function mayReceive(session, msg) {
  return !(session && session.radioOnly) || SENT_TO_RADIO_ONLY.has(msg.type);
}

module.exports = { isRadioOnlyRequest, mayReceive };
