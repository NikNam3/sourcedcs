// Shared WebSocket stand-ins and waits for the hub tests (ARCH-S 5d). One fake socket for every file that drives a WsHub.

export const OPEN = 1; // WebSocket.OPEN

/**
 * A client socket the hub can send to. `sent` holds every frame already parsed; `of(type)` filters it; `on()` is a
 * no-op so a hub that registers listeners does not need a real socket.
 */
export function fakeWs(readyState = OPEN) {
  const sent = [];
  return { readyState, send: (raw) => sent.push(JSON.parse(raw)), on() {}, sent, of(type) { return sent.filter(m => m.type === type); } };
}
