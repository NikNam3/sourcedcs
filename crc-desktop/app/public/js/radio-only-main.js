// The radio-only page's entry (docs/adr/0161 §2): the radio panel, the /feed connection and the top line, and nothing of
// the map, the dock or the strips (tests/radio-only-graph.test.mjs). radio-only.html loads /js/config.js first.
import { loadSettings } from './settings.js';
import { initRadioPanel } from './radio/radio-panel.js';
import { initRadioOnlyBar } from './radio/radio-only-bar.js';
import { startRadioOnlyFeed } from './radio/radio-only-feed.js';

loadSettings();
const bar = initRadioOnlyBar();
initRadioPanel({ radioOnly: true });
startRadioOnlyFeed({ onLink: bar.setLink });
