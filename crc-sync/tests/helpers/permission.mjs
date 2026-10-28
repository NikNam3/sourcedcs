// The class-dependent permission predicates (canMutate, canCorrelate, canDeclareMarsa, PERMISSIONS) are built from a
// facility config (src/efsp/permission.js's createPermission), not read from a module singleton. A test that wants the
// shipped answers builds them here. Call it AFTER the test set its env, like any other config read.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export function classPermission(facilityConfig = require('../../src/efsp/facility-config.js').createFacilityConfig()) {
  return require('../../src/efsp/permission.js').createPermission({ classOf: facilityConfig.getPositionClass });
}
