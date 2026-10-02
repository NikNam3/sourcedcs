'use strict';
import { _connectionBannerEl, _efspPanelRootEl } from './state.js';
import { isEfspBoardStale } from '../efsp-nla.js';

// Board staleness (guide §5.6 rule 5) — lastEfspHeartbeatAt is set on every
// efsp-heartbeat (app.js), independent of Bay/Position state, so it keeps
// ticking even while the panel is an inactive dock tab. The interval polls
// it rather than scheduling a fresh timeout per heartbeat — simpler, and
// the check itself is cheap (see isEfspBoardStale in efsp-nla.js).
let _lastEfspHeartbeatAt = null;
let _staleCheckInterval = null;

export function noteEfspHeartbeat() {
  _lastEfspHeartbeatAt = Date.now();
}

function _checkEfspStaleness() {
  if (!_connectionBannerEl) return;
  const stale = isEfspBoardStale(_lastEfspHeartbeatAt, Date.now());
  if (_efspPanelRootEl) _efspPanelRootEl.classList.toggle('efsp-board-stale', stale);
  _connectionBannerEl.textContent = stale ? 'Board may be out of date — no update received' : '';
}

export function startEfspStalenessCheck() {
  // One check per second is plenty for a 10s-default threshold — no need to
  // schedule a fresh timeout per heartbeat (§5.6 rule 5's banner). Started
  // once, not per initEfspPanel() call in case dock.js ever re-inits.
  if (!_staleCheckInterval) _staleCheckInterval = setInterval(_checkEfspStaleness, 1000);
}
