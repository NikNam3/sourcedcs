'use strict';


// The Strips the client holds (DESK-SPLIT, split out of efsp-state.js): a leaf, so the per-store state modules read Strips without importing efsp-state.js.

export const efspStrips = new Map();     // stripId -> Strip

export function getEfspStrip(stripId) { return efspStrips.get(stripId) || null; }

export function getAllEfspStrips() { return [...efspStrips.values()]; }
