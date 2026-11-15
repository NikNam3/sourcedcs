# 0166: An intercom PTT key, and the intercom on by default on SRS's shared unit

**Status.** Proposed (2026-11-15). [SOURCE-DEFINED]: the human's request of 2026-11-15: "add the option for a separate
keybind for the intercom radios. intercom should be on by default with the id 100...001 (which is the srs id for
intercom)". Decision Desk IC-Q1 (a: no intercom key until set), IC-Q2 (a: on by default), IC-Q3 (a: a removal is
stored as `false`, a stored null counts as never set).

## Context

crc-desktop's built-in radio (ADR 0158) has one PTT key. It keys the PTT target's group; to talk on the intercom the
controller has to make the intercom the target, then make the group the target again. The intercom was off until the
controller pressed + INTERCOM, and its shared unit was unit id 1, which crc-desktop took from lxsrs_v2's `client.py`.
No SRS client uses 1 for anything shared, so a CRC on the intercom talked only to other CRCs.

What SRS itself does (ciribob/DCS-SimpleRadioStandalone, commit `d01f540ce5e363e9ac841775c8f7e2253138cd81`):

- `DCS-SR-Client/Network/DCS/Models/DCSState/DCSPlayerRadioInfo.cs:28`: `UnitIdOffset = 100000000; // this is where non
  aircraft "Unit" Ids start from for satcom intercom`.
- `DCS-SR-Client/Network/DCS/DCSRadioSyncHandler.cs:672-675`: the external AWACS mode (SRS used outside DCS, as GCI
  controllers do) sets `IntercomOffset = 1` and sends `unitId = UnitIdOffset + IntercomOffset`, so **100000001**.
- `DCS-SR-Client/Utils/RadioHelper.cs:520-531` (`SetIntercom`) and
  `UI/ClientWindow/AwacsRadioOverlayWindow/AwacsIntercomControlGroup.xaml.cs:115-125`: the overlay's intercom number
  spinner moves the unit id to `UnitIdOffset + n`; 1 is the default.
- `Common/Models/Player/PlayerRadioInfoBase.cs:134-140` (`CanHearTransmission`): an INTERCOM packet is heard on an
  INTERCOM radio when the sender's unit id equals the receiver's own `unitId` or that radio's `IntercomUnitId`.
- `Common/Network/Server/UDPVoiceRouter.cs:348-366`: the server sends a packet only to the clients whose
  `CanHearTransmission` accepts it (gateway clients get everything). Intercom is routed by unit id, never by frequency.
- The unit id is used for nothing else on the server except pairing aircraft seats in the LotATC export
  (`Common/Network/Server/ServerState.cs:223-258`), which concerns DCS aircraft only.

## Decision

### 1. An intercom PTT key

- RADIO → SETUP gets **Intercom PTT**: PRESS A KEY and CLEAR. None until set. It is stored in the radio prefs as
  `intercomPttKey` (a `KeyboardEvent.code`, or null).
- Holding it keys **only the intercom**, whatever the PTT target is. The PTT key keys what it keyed before. Without an
  intercom radio (removed) the intercom key keys nothing.
- One key is never both. The intercom key cannot be set to the PTT key (SETUP says so in grey). Setting the PTT key to
  the intercom's clears the intercom key.
- **Both held:** one transmission at a time (an SRS packet carries the intercom alone, H183). The key pressed first
  transmits, and the other waits: a press never cuts off a call that is already going out. When the first is let go
  and the other is still held, the other starts at once. A key whose radio is missing never holds the other back.
  `radio-ptt-arbiter.js` holds this rule.
- Each key has its own `ptt-controller.js` (blur, visibility and the maximum transmit time apply to each), so the rules
  of ADR 0161 §3 hold for both.
- **Global PTT** (ADR 0161 §3) gets a second input, **Global intercom PTT**, which needs no new native binary:
  `uiohook-napi` already reports every key, so the listener matches two bindings instead of one; on Wayland the portal
  gets a second shortcut, `crc_intercom`, beside `crc_ptt`. A bind names every one of our shortcuts the desktop
  already knows, so a session never binds fewer than are already bound. The gate (`ptt-gate.js`) keeps one binding and
  one edge filter per channel (`ptt`, `intercom`). An edge reaches the renderer as `(down, channel)`, and the fuse is
  reported per channel. The privacy rules are unchanged: only a press or release of a bound input leaves the main
  process, and a capture that returns the other channel's input is refused as taken.

### 2. The intercom is on by default

- A controller who never had intercom prefs gets the intercom row, receiving, on the shared unit.
- Removing it stores `intercom: false`, and it stays removed until + INTERCOM. A stored `null` or no key at all counts as
  never set. Before this ADR, null meant both "never added" and "removed", so a controller who had removed the intercom
  sees it once more, and removing it again stores `false`. There is no other migration code.

### 3. The shared unit is SRS's own, 100000001

- `SHARED_INTERCOM_UNIT_ID = 100000001` in `crc-desktop/app/srs/srs-session.js`, which used to be `UNIT_ID = 1`. It is
  the unit id every CRC sends (in RADIO_UPDATE and on every voice packet) unless the controller joined another
  client's intercom. So every CRC, and every SRS client in external AWACS mode on intercom 1, share the intercom.
- Nothing else changes meaning. The unit id on a non-intercom packet is not used by SRS. crc-sync's relay keeps its own
  `RELAY_UNIT_ID = 1` (`crc-sync/src/radio/relay-decision.js`): the relay has no intercom radio and never relays
  intercom (ADR 0160), so its unit id puts it on no intercom. `srs-session.js` is not one of the files crc-sync copies
  (`crc-sync/src/radio/srs/`), so no parity change is needed.

### 4. Module layout

| File | Job |
|---|---|
| `crc-desktop/app/public/js/radio/radio-ptt-arbiter.js` | which of the two PTTs transmits (pure) |
| `crc-desktop/app/public/js/radio/radio-ptt.js` | the two window controllers and the Global PTT wiring |
| `crc-desktop/app/public/js/radio/ptt-key-button.js` | the SETUP key chooser (PTT and intercom PTT) |
| `crc-desktop/app/public/js/radio/radio-setup.js` | SETUP: the Intercom PTT row |
| `crc-desktop/app/public/js/radio/global-ptt-setup.js` | SETUP: the Global intercom PTT row |
| `crc-desktop/app/public/js/radio/radio-prefs.js` | `intercomPttKey`, `globalPtt.intercom`, `intercom: false` |
| `crc-desktop/global-ptt/ptt-gate.js` | one binding and one edge filter per channel |
| `crc-desktop/global-ptt/uiohook-listener.js`, `portal-listener.js` | two bindings / two shortcuts |
| `crc-desktop/app/srs/srs-session.js` | `SHARED_INTERCOM_UNIT_ID` |

## Consequences

- CRC controllers and SRS-standalone GCI controllers in external AWACS mode, intercom 1, now hear each other on the
  intercom. A controller who wants a private intercom joins another unit with the row's unit picker, as before.
- The old radio client (lxsrs_v2, the `srs-radio.js` panel) still uses unit 1, so a CRC on the old client and one on
  the built-in radio no longer share the intercom. The built-in radio is the default client.
- The portal's second shortcut has not been tried on a real desktop (GNOME, KDE); the tests use a fake portal.
