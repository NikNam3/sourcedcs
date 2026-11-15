// An assigned altitude limit (crc-sync docs/adr/0163): "<080" is at or below 8,000 ft, ">FL240" at or above FL240.
// crc-sync sends it as an altitude block with one open end (`{ lowFt: null, highFt: 8000 }`) and the canonical text
// as the entry's `value`; the client shows that text unchanged on the strip, the data block and the label menu.
// A leaf module: it imports nothing.

/** True when the block has exactly one open end. */
export function isAltitudeLimit(block) {
  return !!block && (block.lowFt == null) !== (block.highFt == null);
}

/** The limit's one altitude in feet, or null when the block is not a limit. */
export function limitFt(block) {
  if (!isAltitudeLimit(block)) return null;
  return block.lowFt == null ? block.highFt : block.lowFt;
}

/** 'at or below ' / 'at or above ' for a limit, '' for anything else (an alert's words). */
export function limitWords(block) {
  if (!isAltitudeLimit(block)) return '';
  return block.lowFt == null ? 'at or below ' : 'at or above ';
}

/**
 * The data block's trend arrow for a limit: toward the allowed side, only when the flight is more than `slackFt`
 * past the limit; '' on the allowed side, where any altitude conforms.
 */
export function limitTrend(block, currentFt, slackFt = 200) {
  if (!isAltitudeLimit(block) || !Number.isFinite(currentFt)) return '';
  if (block.lowFt == null) return currentFt > block.highFt + slackFt ? '↓' : '';
  return currentFt < block.lowFt - slackFt ? '↑' : '';
}
