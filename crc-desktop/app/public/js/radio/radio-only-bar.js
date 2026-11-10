'use strict';

// The radio-only window's top line (docs/adr/0161 §2). Dark cockpit: with the link up it holds only FULL CRC; without it,
// one grey line that there is no linking, with what can be done about it. Never a gate: the radio below keeps running.

import { el } from './radio-dom.js';
import { LINK } from './radio-only-feed.js';
import { openSyncLogin } from '../sync.js';
import { showConnWidget } from '../sync-connection.js';

/** The grey line for a link state; empty when there is nothing to say. */
export function linkLine(link) {
  if (link === LINK.NO_LOGIN) return 'not logged in: no linking';
  if (link === LINK.NO_FEED) return 'no connection to crc-sync: no linking';
  return '';
}

function button(text, title, onClick) {
  const b = el('button', 'radio-small-btn', text, { type: 'button', title });
  b.addEventListener('click', onClick);
  return b;
}

/** Fills `#radio-only-bar`. @returns {{ setLink(link): void }} */
export function initRadioOnlyBar() {
  const root = document.getElementById('radio-only-bar');
  const line = el('span', 'radio-note radio-only-line');
  const login = button('LOG IN', 'Log in to link frequencies through crc-sync', () => openSyncLogin());
  const connection = button('CONNECTION', 'The crc-sync and Casdoor addresses', () => showConnWidget());
  login.hidden = true;
  connection.hidden = true;
  root.append(line, login, connection);
  // Only in Electron: it stores the launch mode and relaunches (main.js).
  if (window.crcLaunch) root.appendChild(button('FULL CRC', 'Start the full CRC', () => window.crcLaunch.switchTo('full')));
  return {
    setLink(link) {
      line.textContent = linkLine(link);
      login.hidden = link !== LINK.NO_LOGIN && link !== LINK.NO_FEED;
      connection.hidden = login.hidden;
    },
  };
}
