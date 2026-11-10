'use strict';

// The radio set's inputs from the EFSP state, read where they live (never copied): the Positions this session is
// signed on at, Primary or Observer (S-RADIO-1 RQ14, efsp-ws.js), and the frequency table rows (frequency-state.js).
// radio-set.js stays pure: the panel passes it what this returns. Both change under change-bus topic `positions`
// (a sign-on ack, a coverage message that moves Primary/Observer, a frequency delta) or `snapshot`.

import { getSignedOnPositions, isObserverAt } from '../panels/efsp/efsp-ws.js';
import { getFrequencyRows } from '../panels/efsp/frequency-state.js';
import { allFacilityIds } from '../panels/efsp/facility-topology.js';

/** Every Facility the client knows: the shipped ones and any the frequency table names. */
function facilityIds(rows) {
  const ids = [...allFacilityIds()];
  for (const r of rows) if (r.facilityId && !ids.includes(r.facilityId)) ids.push(r.facilityId);
  return ids;
}

/** `{ staffed: [{ facilityId, positionId, observer }], rows }`, in staffing order per Facility. */
export function readRadioInputs() {
  const rows = getFrequencyRows();
  const staffed = facilityIds(rows).flatMap(facilityId => getSignedOnPositions(facilityId).map(positionId => ({
    facilityId, positionId, observer: isObserverAt(facilityId, positionId),
  })));
  return { staffed, rows };
}
