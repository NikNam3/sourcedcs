'use strict';

// The preload's Global PTT bridge (docs/adr/0161 §3), or null outside Electron. A leaf: it imports nothing.

export function globalPttBridge() {
  return (typeof window !== 'undefined' && window.crcGlobalPtt) || null;
}
