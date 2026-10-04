'use strict';

// Small pieces of live client state that several modules read and `app.js` (or one panel) writes: the link status
// lights, the selected contact and airfield, the bullseye pick, the blink phase. A leaf (DESK-GRAPH): it imports
// nothing, so a reader never needs `app.js`. An imported binding is read-only, so each write goes through its setter.

export let grpcStatus       = 'disconnected';
export let srsStatus        = 'disconnected';
export let noRadarsActive   = false; // true when the Positions we are signed on to grant no radar at all
export let lastUpdateMs     = null;
export let selectedRef      = null; // string track id (reference)
export let selectedApt      = null;
export let approachRwyCourse = null; // used for approach-vector line
export let bullseyePickTarget = null; // 'blue' | 'red' | null — awaiting a map click to set bullseye override
export let _pulseBright     = true;

export function setGrpcStatus(v) { grpcStatus = v; }
export function setSrsStatus(v) { srsStatus = v; }
export function setNoRadarsActive(v) { noRadarsActive = v; }
export function setLastUpdateMs(v) { lastUpdateMs = v; }
export function setSelectedRef(v) { selectedRef = v; }
export function setPulseBright(v) { _pulseBright = v; }
export function _setSelectedApt(v) { selectedApt = v; }
export function _setApproachRwyCourse(v) { approachRwyCourse = v; }
export function _setBullseyePickTarget(v) { bullseyePickTarget = v; }
