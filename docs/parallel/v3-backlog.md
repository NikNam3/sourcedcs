# Major v3 backlog

Ideas the human has deferred to the next major version. Not scheduled; nothing here is briefed. Each entry names the
decision that put it here.

## Airspace from openAIP (H146)

Import the jurisdiction and special-use airspaces from **openAIP** instead of typing them into the theater config by
hand.

- **What it is:** openAIP (openaip.net), a crowd-sourced aeronautical database with a REST API
  (`https://api.core.openaip.net/api/airspaces`, free account + API key). Records carry type, ICAO class, vertical
  limits and polygon geometry.
- **Checked by the human (2026-10-13):** it covers Turkey and its data looks correct (the LTAG CTR and Adana MTMA
  match AIP Türkiye: LTAG AD 2.17, page dated 14 MAY 26; ENR 2.1.3, AIRAC AMDT 08/26).
- **Licence:** reportedly CC BY-NC 4.0 (non-commercial, attribution "openAIP"); confirm on openaip.net before building.
  The squadron's use is non-commercial.
- **Shape of the work (sketch, not decided):** an import step (by theater/country, bbox of the DCS map) into the
  airspace registry's shipped/`state/` layers, keeping the theater config as the source of truth that the import
  writes and the airspaces panel still edits; the API key as a crc-sync env var like the MapTiler keys; attribution
  in the UI; how imported areas map to our jurisdiction owners (TOWER/RAPCON/CARRIER/CENTER) and to H144's
  no-overlap rule; refresh per AIRAC cycle.
- **Today (v2):** U-JURISDICTION ships the areas in theater config, hand-entered from AIP Türkiye (ADR 0125).

## Release scope (H159, 2026-10-21)

v3 brings: openAIP airspace (above), AIRAC data (H152), an **upgraded radio panel**, an **upgraded airport panel**,
**upgraded carrier panels** (v2 ships only a first working prototype), and a second airfield (Konya, H156 RP-Q2) on the
role-based Positions of ADR 0132. Nothing of these is briefed yet.

## Performance (U-PERF, S-ARCH-95; none matters at squadron load)
- Board `_persist` after every Mutation is ~50 % of crc-sync's busy time in the soak and grows with the Board (whole-snapshot JSON); a fix (debounced/incremental save) needs an ADR beside ADR 0081 (save before ack).
- `getFacilityConfig` deep-clones the whole facility on every call; `forwarding-obligations.js` and `par-monitor.js` read one flag.
- Obligations rerun after every delivery; CA is O(n²) in tracks; the `par` ticker rebuilds approach geometry with PAR unheld.
- Client frame time never measured (no Electron trace).
