// The built-in radio's engine (ADR 0158 step 2): the contract in docs/parallel/radio/README.md, plus
// setAudioOptions, testMic and setIdentity (S-RADIO-1 RQ3, S-RADIO-2 RQ18). It only wires the parts together; each part
// has its own file. Nothing runs until the first call: importing this module opens no device and no socket.
//
//   setRadios(radios)                          the radio set's `radios`, whole, every time it changes
//   setPtt(down, radioId)                      transmit on radioId's whole group (or radioId alone if unlinked)
//   setRadioAudio(radioId, {volume, pan, muted})
//   setDevices({inputId, outputId, inputLabel?, outputLabel?})
//   setAudioOptions({inputGain, outputGain, soundSet, noise})
//   setIdentity({name})                        the name in the SRS client list (default "CRC")
//   setIntercomUnit(unitId|null)               join that SRS client's intercom (H183; state.srsClients lists them)
//   testMic() -> Promise<{peak, blocks}>
//   onState(fn) -> unsubscribe                 radio-engine-state.js has the fields

import { SAMPLE_RATE, BLOCK_MS, DEFAULT_INPUT_GAIN, DEFAULT_OUTPUT_GAIN, GAIN_MAX } from './radio-audio-constants.js';
import { getEngineState, setEngineState, subscribeEngineState } from './radio-engine-state.js';
import { createSrsSocket } from './srs-socket.js';
import { opusSupported, createOpusEncoder, createOpusDecoder } from './opus-codec.js';
import { createRadioEffects, SOUND_SETS, DEFAULT_SOUND_SET } from './radio-effects.js';
import { createRxMixer } from './rx-mixer.js';
import { createRxPath } from './rx-path.js';
import { createTxPath } from './tx-path.js';
import { createMicCapture } from './mic-capture.js';
import { createVoiceProcessor } from './voice-processor.js';
import { txRadioIdsFor } from './tx-group.js';
import { pickDevice } from './device-pick.js';
import { runMicTest } from './mic-test.js';

const TICK_MS = 50;
const clampGain = (g, d) => (Number.isFinite(Number(g)) ? Math.max(0, Math.min(GAIN_MAX, Number(g))) : d);

let parts = null; // built on first use
let radios = [];
let name = 'CRC';
let devices = { inputId: null, outputId: null, inputLabel: null, outputLabel: null };
const options = { inputGain: DEFAULT_INPUT_GAIN, outputGain: DEFAULT_OUTPUT_GAIN, soundSet: DEFAULT_SOUND_SET, noise: true };
let micTap = null;
let micDeviceId = null;
let intercomUnit = null;

const wireRadios = () => radios.map(r => ({ id: r.id, mhz: r.mhz, modulation: r.modulation || 'AM', label: r.label || r.id }));
const modulationOf = (id) => ((radios.find(r => r.id === id) || {}).modulation || 'AM');

function build() {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  const effects = createRadioEffects(ctx);
  effects.preload();
  const mixer = createRxMixer(ctx, effects);
  mixer.setOutputGain(options.outputGain);
  const processor = createVoiceProcessor({ volume: options.inputGain, blockMs: BLOCK_MS });

  const socket = createSrsSocket({
    url: `ws://${location.host}/srs`,
    onOpen: () => {
      socket.send({ type: 'hello', name });
      socket.send({ type: 'radios', radios: wireRadios() });
      if (intercomUnit !== null) socket.send({ type: 'intercom-unit', unitId: intercomUnit });
    },
    onMessage: (m) => { if (m.type === 'state') onServerState(m); },
    onFrame: ({ header, opus }) => { if (getEngineState().opusSupported) rx.receive(header, opus); },
    onClose: () => { tx.up(); setEngineState({ connected: false, udpReady: false }); closeMic(); },
  });
  const tx = createTxPath({
    socket, effects, dest: mixer.master, options: () => options,
    createEncoder: (onFrame) => createOpusEncoder(onFrame, (e) => setEngineState({ error: `Opus encoder: ${e.message}` })),
    onChange: (ids) => setEngineState({ txRadioIds: ids }),
  });
  const rx = createRxPath({
    ctx, mixer, effects, options: () => options, modulationOf,
    txRadioIds: () => new Set(tx.radioIds()),
    createDecoder: (onPcm) => createOpusDecoder(onPcm),
  });
  const mic = createMicCapture((raw) => {
    const block = processor.process(raw); // always, as audio.py: the limiter's gain follows the voice
    if (micTap) micTap(block);
    tx.block(block);
  });
  setInterval(() => { rx.tick(); setEngineState({ rxRadioIds: rx.rxRadioIds() }); }, TICK_MS);
  opusSupported().then((ok) => setEngineState({ opusSupported: ok }));
  parts = { ctx, effects, mixer, processor, socket, tx, rx, mic };
  socket.open();
  applyOutputDevice();
  return parts;
}
const engine = () => parts || build();

function onServerState(m) {
  setEngineState({
    connected: !!m.connected, udpReady: !!m.udpReady, enabled: m.enabled ?? null, error: m.error || null,
    overflowRadioIds: m.overflowRadioIds || [], invalidRadioIds: m.invalidRadioIds || [],
    srsClients: m.srsClients || [], intercomUnitId: m.unitId || 1,
  });
  if (m.connected) openMic(); else closeMic();
}

async function devicesNow() {
  try { return await navigator.mediaDevices.enumerateDevices(); } catch { return []; }
}

async function openMic(force = false) {
  const p = engine();
  if (p.mic.isOpen() && !force) return;
  const pick = pickDevice(await devicesNow(), 'audioinput', { id: devices.inputId, label: devices.inputLabel });
  micDeviceId = pick.deviceId;
  setEngineState({ deviceNote: pick.note });
  try { await p.mic.start(micDeviceId); } catch (e) { setEngineState({ error: `microphone: ${e.message || e.name}` }); }
}
function closeMic() { if (parts) parts.mic.stop(); }

async function applyOutputDevice() {
  const p = engine();
  const pick = pickDevice(await devicesNow(), 'audiooutput', { id: devices.outputId, label: devices.outputLabel });
  if (pick.note) setEngineState({ deviceNote: pick.note });
  if (typeof p.ctx.setSinkId !== 'function') return;
  try { await p.ctx.setSinkId(pick.deviceId || ''); } catch (e) { setEngineState({ error: `speaker: ${e.message || e.name}` }); }
}

/** @param {Array<{id:string, mhz:number, modulation?:string, label?:string, groupId?:string|null, receiveOnly?:boolean}>} next */
export function setRadios(next) {
  radios = Array.isArray(next) ? next.slice() : [];
  const p = engine();
  p.socket.send({ type: 'radios', radios: wireRadios() });
  p.mixer.keepOnly(radios.map(r => r.id));
  if (p.tx.isDown() && !p.tx.radioIds().every(id => radios.some(r => r.id === id))) p.tx.up();
}

export function setPtt(down, radioId) {
  const p = engine();
  if (!down) { p.tx.up(); return; }
  if (p.ctx.state === 'suspended') p.ctx.resume();
  const s = getEngineState();
  if (!s.opusSupported || !s.udpReady) return;
  p.tx.down(txRadioIdsFor(radios, radioId));
}

export function setRadioAudio(radioId, a) {
  const v = {};
  if (a && a.volume !== undefined) v.volume = clampGain(a.volume, 1);
  if (a && a.pan !== undefined) v.pan = Number(a.pan) || 0;
  if (a && a.muted !== undefined) v.muted = !!a.muted;
  engine().mixer.setRadioAudio(radioId, v);
}

export function setDevices(d) {
  const before = devices;
  devices = { ...devices, ...(d || {}) };
  engine();
  if (devices.inputId !== before.inputId || devices.inputLabel !== before.inputLabel) {
    if (parts.mic.isOpen()) openMic(true);
  }
  if (devices.outputId !== before.outputId || devices.outputLabel !== before.outputLabel) applyOutputDevice();
}

export function setAudioOptions(o) {
  const p = engine();
  if (!o) return;
  if (o.inputGain !== undefined) { options.inputGain = clampGain(o.inputGain, DEFAULT_INPUT_GAIN); p.processor.setVolume(options.inputGain); }
  if (o.outputGain !== undefined) { options.outputGain = clampGain(o.outputGain, DEFAULT_OUTPUT_GAIN); p.mixer.setOutputGain(options.outputGain); }
  if (o.soundSet !== undefined && SOUND_SETS.includes(o.soundSet)) options.soundSet = o.soundSet;
  if (o.noise !== undefined) { options.noise = !!o.noise; p.rx.updateNoise(); }
}

export function setIdentity(id) {
  const next = id && typeof id.name === 'string' && id.name.trim() ? id.name.trim() : 'CRC';
  if (next === name) return;
  name = next;
  if (parts) parts.socket.reconnect(); // the SRS name is sent in SYNC: a new session, the same GUID
}

export function setIntercomUnit(unitId) {
  intercomUnit = Number.isInteger(unitId) && unitId > 0 ? unitId : null;
  engine().socket.send({ type: 'intercom-unit', unitId: intercomUnit });
}

export async function testMic() {
  const p = engine();
  if (!p.mic.isOpen()) await openMic();
  if (p.ctx.state === 'suspended') await p.ctx.resume();
  return runMicTest((tap) => { micTap = tap; }, p.ctx, p.mixer.master);
}

/** @returns {() => void} unsubscribe. The first call also starts the engine. */
export function onState(fn) {
  engine();
  return subscribeEngineState(fn);
}
