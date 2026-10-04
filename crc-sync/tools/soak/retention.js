'use strict';

// The Strip retention the SOAK runs with, not production's (ADR 0107). Production keeps a finished Strip 12 h
// (`ARCHIVE_AFTER_MS`, archiver.js); at 12 h a 4 h soak would never leave the fill phase, so the heap gates would
// never be judged. The soak host therefore constructs the archiver with the 2 h retention it has always used (the
// number every threshold in report.js was measured against). `--retention-min <m>` overrides it; it travels to
// the host through the environment, which a forked host inherits and an in-process host shares.

const SOAK_RETENTION_MIN_DEFAULT = 120;
const ENV_KEY = 'CRCSYNC_SOAK_RETENTION_MIN';

function retentionMinFromEnv(env = process.env) {
  const n = Number(env[ENV_KEY]);
  return Number.isFinite(n) && n > 0 ? n : SOAK_RETENTION_MIN_DEFAULT;
}

/** One line for the report: what the soak's retention is, against production's. */
function describeRetention(retentionMin, productionMs) {
  const h = (min) => `${Math.round(min / 6) / 10} h`;
  return `soak retention ${h(retentionMin)} (production ${h(productionMs / 60000)})`;
}

module.exports = { SOAK_RETENTION_MIN_DEFAULT, ENV_KEY, retentionMinFromEnv, describeRetention };
