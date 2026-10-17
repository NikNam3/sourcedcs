'use strict';

// Every `reason` an `ok:false` ack can carry to a controller (the five ack families and the Board). The client
// (crc-desktop's panel/refusal.js MUTATION_ERROR_MESSAGES) must word each one; tests/refusal-codes.test.mjs fails when
// source gains a refusal code this list lacks, and crc-desktop's efsp-refusal-banner.test.mjs fails when its table
// lacks a code listed here. Audit-only reasons (CRASH_BEFORE_PERSIST, NOT_PERSISTED), per-item skip reasons (EXISTS)
// and transition reasons (JOINED, MISSION_RELOAD, ...) are not refusals and are not listed.
const REFUSAL_CODES = Object.freeze([
  'VALIDATION_ERROR', 'STALE_REV', 'NOT_FOUND', 'NLA_INHIBITED', 'NO_RECEIVING_POSITION', 'NOT_HOLDING_POSITION',
  'NOT_OWNER', 'PERMISSION_DENIED', 'NOT_STAFFED', 'ALREADY_PRIMARY', 'NOT_OBSERVER', 'ASSIGNMENT_REQUIRED',
  'BAY_FULL', 'UNDO_BLOCKED', 'UNDO_UNAVAILABLE', 'INTERNAL_ERROR', 'FREQUENCY_IN_USE',
]);

module.exports = { REFUSAL_CODES };
